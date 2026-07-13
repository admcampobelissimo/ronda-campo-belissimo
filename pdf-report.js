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

  /* ---------------- CORPO: grade contínua de 3 colunas ----------------
     O nome do setor vira uma etiqueta pequena dentro do próprio card (em
     vez de um título separado quebrando a grade) — assim setores com só
     1 área (Academia, Cinema, etc.) não deixam a linha inteira vazia. */
  const cols = 3;
  const colGutter = 6;
  const colW = (contentW - colGutter * (cols - 1)) / cols;
  const photoH = colW * 0.72; // proporção ~4:3, fixa para todas as fotos

  // Recorta a foto (modo "cover") num retângulo de proporção fixa, para as
  // miniaturas ficarem todas do mesmo tamanho, sem depender da orientação
  // da foto original (retrato/paisagem).
  function cropToCover(dataUrl, targetRatio) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const srcRatio = img.naturalWidth / img.naturalHeight;
        let sx, sy, sw, sh;
        if (srcRatio > targetRatio) {
          sh = img.naturalHeight; sw = sh * targetRatio;
          sx = (img.naturalWidth - sw) / 2; sy = 0;
        } else {
          sw = img.naturalWidth; sh = sw / targetRatio;
          sx = 0; sy = (img.naturalHeight - sh) / 2;
        }
        const outW = 480;
        const canvas = document.createElement("canvas");
        canvas.width = outW; canvas.height = Math.round(outW / targetRatio);
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("Falha ao processar imagem"));
      img.src = dataUrl;
    });
  }

  async function buildCard(area) {
    const entry = stateAreas[area.id];
    const photo = await getPhoto(area.id);
    const croppedUrl = photo && photo.dataUrl ? await cropToCover(photo.dataUrl, colW / photoH) : null;

    const obsText = entry.obs && entry.obs.trim() ? entry.obs.trim() : "Sem observações.";
    const obsLines = doc.splitTextToSize(obsText, colW);
    const nameLines = doc.splitTextToSize(area.name, colW);

    const height = 4 + nameLines.length * 4.3 + 3.8 + photoH + 3.5 + obsLines.length * 3.9 + 5;
    return { area, entry, croppedUrl, obsLines, nameLines, height };
  }

  function drawCard(card, x, top) {
    let cy = top;
    doc.setFont(undefined, "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...GOLD);
    doc.text(card.area.group.toUpperCase(), x, cy);
    cy += 4;

    doc.setFont(undefined, "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(card.nameLines, x, cy);
    cy += card.nameLines.length * 4.3;

    doc.setFont(undefined, "normal");
    doc.setFontSize(7.3);
    doc.setTextColor(130);
    doc.text(formatDateTime(card.entry.timestamp), x, cy);
    cy += 3.8;

    if (card.croppedUrl) {
      doc.addImage(card.croppedUrl, "JPEG", x, cy, colW, photoH);
    } else {
      doc.setDrawColor(225);
      doc.setFillColor(246, 247, 249);
      doc.roundedRect(x, cy, colW, photoH, 2, 2, "FD");
      doc.setFontSize(7.5);
      doc.setTextColor(160);
      doc.text("Sem foto", x + colW / 2, cy + photoH / 2, { align: "center" });
    }
    cy += photoH + 3.5;

    doc.setFont(undefined, "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(80);
    doc.text(card.obsLines, x, cy);
  }

  const todasAreas = FLAT_AREAS.filter((a) => stateAreas[a.id] && stateAreas[a.id].done);
  for (let i = 0; i < todasAreas.length; i += cols) {
    const rowAreas = todasAreas.slice(i, i + cols);
    const rowCards = [];
    for (const a of rowAreas) rowCards.push(await buildCard(a));
    const rowH = Math.max(...rowCards.map((c) => c.height));

    ensureSpace(rowH + 5);

    rowCards.forEach((card, idx) => drawCard(card, margin + idx * (colW + colGutter), y));

    y += rowH + 6;
    doc.setDrawColor(238);
    doc.line(margin, y - 3, pageW - margin, y - 3);
  }

  addFooters();
  return doc.output("blob");
}
