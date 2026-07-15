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

// Gera uma versão do logo pintada numa cor sólida (mantendo a transparência
// original), para usar sobre o fundo escuro do cabeçalho — o logo original é
// cinza claro e ficaria com contraste ruim direto sobre a faixa azul-marinho.
function recolorLogo(dataUrl, color) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Falha ao processar o logo"));
    img.src = dataUrl;
  });
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

  // Faixa fina reservada no topo das páginas 2 em diante (a capa tem seu
  // próprio cabeçalho grande, desenhado à parte).
  const runningHeaderH = 16;

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
  async function addRunningHeaders() {
    const total = doc.internal.getNumberOfPages();
    if (total < 2) return;

    let whiteLogo = null;
    try {
      whiteLogo = await recolorLogo(await loadImageAsBase64(logoUrl), "#ffffff");
    } catch (e) { whiteLogo = null; }

    for (let i = 2; i <= total; i++) {
      doc.setPage(i);
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, pageW, runningHeaderH, "F");
      doc.setFillColor(...GOLD);
      doc.rect(0, runningHeaderH, pageW, 0.9, "F");

      if (whiteLogo) {
        const logoH = 8.5, logoW = logoH * (1214 / 186);
        doc.addImage(whiteLogo, "PNG", margin, (runningHeaderH - logoH) / 2, logoW, logoH);
      } else {
        doc.setFont(undefined, "bold");
        doc.setFontSize(10.5);
        doc.setTextColor(255, 255, 255);
        doc.text(CONDO_NOME, margin, runningHeaderH / 2 + 3.2);
      }

      doc.setFont(undefined, "normal");
      doc.setFontSize(9);
      doc.setTextColor(...GOLD_LIGHT);
      doc.text("Relatório de Ronda", pageW - margin, runningHeaderH / 2 + 3.2, { align: "right" });
    }
  }

  let y = margin;
  function ensureSpace(h) {
    if (y + h > pageH - 16) {
      doc.addPage();
      y = runningHeaderH + 12; // reserva espaço para a faixa fina desenhada no final
    }
  }

  const done = Object.values(stateAreas).filter((a) => a.done).length;
  const total = FLAT_AREAS.length;
  const pendentesList = FLAT_AREAS.filter((a) => !(stateAreas[a.id] && stateAreas[a.id].done));

  /* ---------------- CAPA: faixa azul marinho + logo grande ---------------- */
  const bannerH = 18;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, bannerH, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, bannerH, pageW, 1.4, "F");

  y = bannerH + 14;

  try {
    const logoW = 90, logoH = logoW * (186 / 1214);
    doc.addImage(await loadImageAsBase64(logoUrl), "PNG", margin, y, logoW, logoH);
    y += logoH + 10;
  } catch (e) { y += 6; }

  doc.setFont(undefined, "bold");
  doc.setFontSize(20);
  doc.setTextColor(...NAVY);
  doc.text("Relatório de Ronda", margin, y);
  y += 8;

  doc.setFont(undefined, "normal");
  doc.setFontSize(12);
  doc.setTextColor(90);
  doc.text(CONDO_NOME, margin, y);
  y += 10;

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
     1 área (Academia, Cinema, etc.) não deixam a linha inteira vazia.
     Todos os cards de uma mesma linha reservam a MESMA altura pro bloco
     do nome (baseada no card com mais linhas), pra foto/observação de
     cada um começar sempre na mesma altura, sem sobrepor o vizinho. */
  const cols = 3;
  const colGutter = 6;
  const colW = (contentW - colGutter * (cols - 1)) / cols;
  const photoH = colW * 0.72; // proporção ~4:3, fixa para todas as fotos
  const nameLineH = 4.3;

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

    // splitTextToSize mede a largura com a fonte ATUALMENTE ativa no doc —
    // por isso precisa bater exatamente com a fonte usada depois em drawCard,
    // senão a quebra de linha é calculada errada e o texto acaba vazando
    // para a coluna vizinha.
    const obsText = entry.obs && entry.obs.trim() ? entry.obs.trim() : "Sem observações.";
    doc.setFont(undefined, "normal");
    doc.setFontSize(7.6);
    const obsLines = doc.splitTextToSize(obsText, colW);

    doc.setFont(undefined, "bold");
    doc.setFontSize(9.5);
    const nameLines = doc.splitTextToSize(area.name, colW);

    return { area, entry, croppedUrl, obsLines, nameLines };
  }

  function cardHeight(card, maxNameLines) {
    return 4 + maxNameLines * nameLineH + 3.8 + photoH + 3.5 + card.obsLines.length * 3.9 + 5;
  }

  function drawCard(card, x, top, maxNameLines) {
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
    cy += maxNameLines * nameLineH; // altura reservada igual pra toda a linha

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

    const maxNameLines = Math.max(...rowCards.map((c) => c.nameLines.length));
    const rowH = Math.max(...rowCards.map((c) => cardHeight(c, maxNameLines)));

    ensureSpace(rowH + 5);

    rowCards.forEach((card, idx) => drawCard(card, margin + idx * (colW + colGutter), y, maxNameLines));

    y += rowH + 6;
    doc.setDrawColor(238);
    doc.line(margin, y - 3, pageW - margin, y - 3);
  }

  addFooters();
  await addRunningHeaders();
  return doc.output("blob");
}
