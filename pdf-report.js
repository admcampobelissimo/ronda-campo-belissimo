import { formatDate, formatDateTime, formatTime } from "./format.js";
import { CONDO_NOME } from "./config.js";

const NAVY = [11, 37, 69];
const GOLD = [182, 141, 64];
const GOLD_LIGHT = [212, 176, 106];

function loadImageAsBase64(url) {
  return fetch(url).then((r) => r.blob()).then((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }));
}

// Gera o PDF do relatório de ronda. Reutilizável tanto pelo colaborador
// (fotos vindas do IndexedDB local, ronda em andamento) quanto pelo painel
// do admin (fotos vindas do Supabase Storage, ronda já finalizada) — quem
// chama decide isso através de `getPhoto`.
//
// AREAS: [{ group, areas: [nome,...] }]
// FLAT_AREAS: [{ id, group, name }]
// stateAreas: { [id]: { done, timestamp, obs } }
// meta: { colaborador, equipe, turno, startedAt }
// getPhoto: async (areaId) => { dataUrl, width, height } | null
// logoUrl: caminho relativo do logo.png a partir de quem chamou (não usado
// mais na capa, mas mantido no parâmetro por compatibilidade)
export async function gerarRelatorioPDF({ AREAS, FLAT_AREAS, stateAreas, meta, getPhoto }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = 210, pageH = 297, margin = 15, contentW = pageW - margin * 2;
  let y = margin;

  function addFooters() {
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(CONDO_NOME + " — Relatório de Ronda", margin, pageH - 8);
      doc.text(`Página ${i}/${total}`, pageW - margin, pageH - 8, { align: "right" });
    }
  }
  function ensureSpace(h) {
    if (y + h > pageH - 16) { doc.addPage(); y = margin; }
  }

  const done = Object.values(stateAreas).filter((a) => a.done).length;
  const total = FLAT_AREAS.length;
  const pendentesList = FLAT_AREAS.filter((a) => !(stateAreas[a.id] && stateAreas[a.id].done));

  /* ---------------- CAPA: faixa azul marinho ---------------- */
  const bannerH = 50;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, bannerH, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, bannerH, pageW, 1.4, "F");

  doc.setFont(undefined, "bold");
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text(CONDO_NOME, margin, 27);

  doc.setFont(undefined, "normal");
  doc.setFontSize(12);
  doc.setTextColor(...GOLD_LIGHT);
  doc.text("RELATÓRIO DE RONDA · ÁREAS COMUNS", margin, 38);

  y = bannerH + 16;

  const info = [
    ["Data", formatDate(meta.startedAt)],
    ["Colaborador", meta.colaborador],
    ["Equipe", meta.equipe],
    ["Turno", meta.turno],
    ["Início da ronda", formatTime(meta.startedAt)],
    ["Áreas vistoriadas", `${done} de ${total}`],
    ["Geração do relatório", formatDateTime(new Date())]
  ];
  doc.setFontSize(12);
  info.forEach(([label, value]) => {
    doc.setFont(undefined, "bold");
    doc.setTextColor(...NAVY);
    doc.text(label + ":", margin, y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(60);
    doc.text(String(value), margin + 55, y);
    y += 9;
  });
  y += 3;

  if (pendentesList.length > 0) {
    ensureSpace(14);
    doc.setFont(undefined, "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(192, 57, 43);
    doc.text(`Áreas pendentes (${pendentesList.length}):`, margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.setFontSize(10);
    doc.setTextColor(90);
    const pendText = pendentesList.map((a) => a.name).join(", ");
    const lines = doc.splitTextToSize(pendText, contentW);
    doc.text(lines, margin, y);
    y += lines.length * 5 + 4;
  }

  y += 4;
  doc.setDrawColor(220);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  /* ---------------- CORPO: grade de 2 colunas por linha ---------------- */
  const colGutter = 8;
  const colW = (contentW - colGutter) / 2;
  const maxPhotoH = 58;

  async function buildCard(area) {
    const entry = stateAreas[area.id];
    const photo = await getPhoto(area.id);

    let imgW = 0, imgH = 0;
    if (photo && photo.dataUrl && photo.width && photo.height) {
      imgW = colW;
      imgH = imgW * (photo.height / photo.width);
      if (imgH > maxPhotoH) { imgH = maxPhotoH; imgW = imgH * (photo.width / photo.height); }
    }
    const obsText = entry.obs && entry.obs.trim() ? entry.obs.trim() : "Sem observações.";
    const obsLines = doc.splitTextToSize(obsText, colW);
    const nameLines = doc.splitTextToSize(area.name, colW);

    const photoBlockH = photo && photo.dataUrl ? imgH + 4 : 22; // reserva espaço p/ "Sem foto"
    const height = nameLines.length * 5 + 4.5 + photoBlockH + 4 + obsLines.length * 4.2 + 6;

    return { area, entry, photo, imgW, imgH, obsLines, nameLines, height };
  }

  function drawCard(card, x, top) {
    let cy = top;
    doc.setFont(undefined, "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...NAVY);
    doc.text(card.nameLines, x, cy);
    cy += card.nameLines.length * 5;

    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(formatDateTime(card.entry.timestamp), x, cy);
    cy += 4.5;

    if (card.photo && card.photo.dataUrl) {
      doc.addImage(card.photo.dataUrl, "JPEG", x, cy, card.imgW, card.imgH);
      cy += card.imgH + 4;
    } else {
      doc.setDrawColor(225);
      doc.setFillColor(246, 247, 249);
      doc.roundedRect(x, cy, colW, 18, 2, 2, "FD");
      doc.setFontSize(8.5);
      doc.setTextColor(160);
      doc.text("Sem foto disponível", x + colW / 2, cy + 10, { align: "center" });
      cy += 22;
    }

    doc.setFont(undefined, "normal");
    doc.setFontSize(8.7);
    doc.setTextColor(80);
    doc.text(card.obsLines, x, cy);
  }

  for (const g of AREAS) {
    const groupAreas = FLAT_AREAS.filter((a) => a.group === g.group && stateAreas[a.id] && stateAreas[a.id].done);
    if (groupAreas.length === 0) continue;

    ensureSpace(12);
    doc.setFont(undefined, "bold");
    doc.setFontSize(13);
    doc.setTextColor(...GOLD);
    doc.text(g.group, margin, y);
    y += 8;

    for (let i = 0; i < groupAreas.length; i += 2) {
      const leftCard = await buildCard(groupAreas[i]);
      const rightCard = groupAreas[i + 1] ? await buildCard(groupAreas[i + 1]) : null;
      const rowH = Math.max(leftCard.height, rightCard ? rightCard.height : 0);

      ensureSpace(rowH + 6);

      drawCard(leftCard, margin, y);
      if (rightCard) drawCard(rightCard, margin + colW + colGutter, y);

      y += rowH + 7;
      doc.setDrawColor(235);
      doc.line(margin, y - 4, pageW - margin, y - 4);
    }
  }

  addFooters();
  return doc.output("blob");
}
