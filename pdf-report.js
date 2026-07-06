import { formatDate, formatDateTime, formatTime } from "./format.js";
import { CONDO_NOME } from "./config.js";

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
// logoUrl: caminho relativo do logo.png a partir de quem chamou
export async function gerarRelatorioPDF({ AREAS, FLAT_AREAS, stateAreas, meta, getPhoto, logoUrl = "assets/logo.png" }) {
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

  try {
    const logoW = 62, logoH = logoW * (186 / 1214);
    doc.addImage(await loadImageAsBase64(logoUrl), "PNG", margin, y, logoW, logoH);
    y += logoH + 10;
  } catch (e) { y += 4; }

  doc.setFont(undefined, "bold");
  doc.setFontSize(18);
  doc.setTextColor(11, 37, 69);
  doc.text("Relatório de Ronda", margin, y);
  y += 7;

  doc.setFont(undefined, "normal");
  doc.setFontSize(11);
  doc.setTextColor(90);
  doc.text(CONDO_NOME, margin, y);
  y += 9;

  doc.setDrawColor(220);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const done = Object.values(stateAreas).filter((a) => a.done).length;
  const total = FLAT_AREAS.length;
  const pendentesList = FLAT_AREAS.filter((a) => !(stateAreas[a.id] && stateAreas[a.id].done));

  const info = [
    ["Colaborador", meta.colaborador],
    ["Equipe", meta.equipe],
    ["Turno", meta.turno],
    ["Data", formatDate(meta.startedAt)],
    ["Início da ronda", formatTime(meta.startedAt)],
    ["Geração do relatório", formatDateTime(new Date())],
    ["Áreas vistoriadas", `${done} de ${total}`]
  ];
  doc.setFontSize(10.5);
  info.forEach(([label, value]) => {
    doc.setFont(undefined, "bold");
    doc.setTextColor(11, 37, 69);
    doc.text(label + ":", margin, y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(50);
    doc.text(String(value), margin + 48, y);
    y += 6.4;
  });
  y += 2;

  if (pendentesList.length > 0) {
    ensureSpace(14);
    doc.setFont(undefined, "bold");
    doc.setTextColor(192, 57, 43);
    doc.text(`Áreas pendentes (${pendentesList.length}):`, margin, y);
    y += 6;
    doc.setFont(undefined, "normal");
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

  for (const g of AREAS) {
    const groupAreas = FLAT_AREAS.filter((a) => a.group === g.group && stateAreas[a.id] && stateAreas[a.id].done);
    if (groupAreas.length === 0) continue;

    ensureSpace(12);
    doc.setFont(undefined, "bold");
    doc.setFontSize(13);
    doc.setTextColor(182, 141, 64);
    doc.text(g.group, margin, y);
    y += 7;

    for (const area of groupAreas) {
      const entry = stateAreas[area.id];
      const photo = await getPhoto(area.id);

      let imgW = contentW, imgH = 70;
      if (photo && photo.width && photo.height) {
        imgH = Math.min(95, imgW * (photo.height / photo.width));
        imgW = imgH * (photo.width / photo.height);
        if (imgW > contentW) { imgW = contentW; imgH = imgW * (photo.height / photo.width); }
      }
      const obsLines = doc.splitTextToSize(entry.obs && entry.obs.trim() ? entry.obs.trim() : "Sem observações.", contentW);
      const blockH = 7 + imgH + 5 + obsLines.length * 4.6 + 8;

      ensureSpace(blockH);

      doc.setFont(undefined, "bold");
      doc.setFontSize(11);
      doc.setTextColor(11, 37, 69);
      doc.text(area.name, margin, y);
      y += 5;

      doc.setFont(undefined, "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Foto registrada em ${formatDateTime(entry.timestamp)}`, margin, y);
      y += 5;

      if (photo && photo.dataUrl) {
        doc.addImage(photo.dataUrl, "JPEG", margin, y, imgW, imgH);
        y += imgH + 5;
      }

      doc.setFont(undefined, "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(90);
      doc.text("Observação:", margin, y);
      doc.setFont(undefined, "normal");
      doc.setTextColor(70);
      doc.text(obsLines, margin + 24, y);
      y += obsLines.length * 4.6 + 8;

      doc.setDrawColor(235);
      doc.line(margin, y - 4, pageW - margin, y - 4);
    }
  }

  addFooters();
  return doc.output("blob");
}
