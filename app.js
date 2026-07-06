import { supabase } from "./supabase-client.js";
import { login, logout, getSessionProfile } from "./auth.js";
import { fetchTeam, fetchTeamAreas } from "./areas-repo.js";
import { savePhoto, getPhoto, clearPhotos, enqueueUpload, updateQueuedObservation, clearUploadQueue } from "./db.js";
import { drainQueue, initUploadQueueAutoSync } from "./upload-queue.js";
import { gerarRelatorioPDF } from "./pdf-report.js";
import { formatDateTime, formatDate, formatTime, pad } from "./format.js";
import { CONDO_NOME } from "./config.js";

const STATE_KEY = "rondaCB_state_v1";

/* ---------------------------------------------------------
   ESTADO (localStorage - metadados da ronda em andamento)
--------------------------------------------------------- */
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; }
}
function saveState(s) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch (e) {
    console.error("Falha ao salvar estado local:", e);
    showToast("Aviso: armazenamento do dispositivo está cheio. Gere o relatório logo.");
  }
}
function clearState() { localStorage.removeItem(STATE_KEY); }

let state = loadState();
let profile = null;   // { id, username, full_name, role, team_id, active }
let team = null;      // { id, name }
let AREAS = [];
let FLAT_AREAS = [];

/* ---------------------------------------------------------
   ELEMENTOS DA UI
--------------------------------------------------------- */
const screenLogin = document.getElementById("screen-login");
const screenSetup = document.getElementById("screen-setup");
const screenChecklist = document.getElementById("screen-checklist");
const screenSummary = document.getElementById("screen-summary");
const checklistFooter = document.getElementById("checklistFooter");

const inputUsuario = document.getElementById("inputUsuario");
const inputSenha = document.getElementById("inputSenha");
const btnLogin = document.getElementById("btnLogin");
const loginError = document.getElementById("loginError");

const setupWelcome = document.getElementById("setupWelcome");
const selectTurno = document.getElementById("selectTurno");
const btnIniciar = document.getElementById("btnIniciar");
const resumeNote = document.getElementById("resumeNote");

const groupsContainer = document.getElementById("groupsContainer");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const btnGerarRelatorio = document.getElementById("btnGerarRelatorio");
const btnVoltar = document.getElementById("btnVoltar");

const headerInfo = document.getElementById("headerInfo");
const headerColaborador = document.getElementById("headerColaborador");
const headerMeta = document.getElementById("headerMeta");
const btnLogout = document.getElementById("btnLogout");

const summaryText = document.getElementById("summaryText");
const btnShare = document.getElementById("btnShare");
const btnDownload = document.getElementById("btnDownload");
const btnNovaRonda = document.getElementById("btnNovaRonda");

const cameraInput = document.getElementById("cameraInput");
const toastEl = document.getElementById("toast");
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

let activeAreaId = null;
let lastPdfBlob = null;

function showToast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), ms);
}
function setLoading(on, text) {
  loadingOverlay.hidden = !on;
  if (text) loadingText.textContent = text;
}
function showScreen(name) {
  screenLogin.hidden = name !== "login";
  screenSetup.hidden = name !== "setup";
  screenChecklist.hidden = name !== "checklist";
  screenSummary.hidden = name !== "summary";
  checklistFooter.hidden = name !== "checklist";
  headerInfo.hidden = name === "login";
  window.scrollTo(0, 0);
}

/* ---------------------------------------------------------
   TELA 0 - LOGIN
--------------------------------------------------------- */
btnLogin.addEventListener("click", async () => {
  const username = inputUsuario.value.trim();
  const password = inputSenha.value;
  loginError.hidden = true;
  if (!username || !password) {
    loginError.textContent = "Informe usuário e senha.";
    loginError.hidden = false;
    return;
  }
  setLoading(true, "Entrando...");
  try {
    profile = await login(username, password);
    inputSenha.value = "";
    await afterLogin();
  } catch (err) {
    loginError.textContent = err.message || "Não foi possível entrar.";
    loginError.hidden = false;
  } finally {
    setLoading(false);
  }
});

btnLogout.addEventListener("click", async () => {
  await logout();
  profile = null; team = null; state = null;
  showScreen("login");
});

async function afterLogin() {
  if (profile.role === "admin") {
    window.location.href = "admin/admin.html";
    return;
  }
  setLoading(true, "Carregando checklist da equipe...");
  try {
    team = await fetchTeam(profile.team_id);
    const data = await fetchTeamAreas(profile.team_id);
    AREAS = data.AREAS;
    FLAT_AREAS = data.FLAT_AREAS;

    updateHeader();
    initUploadQueueAutoSync();

    const existing = loadState();
    if (existing && existing.employeeId === profile.id && existing.rondaId) {
      state = existing;
      initSetupScreen();
      renderChecklist();
      showScreen("checklist");
    } else {
      state = null;
      initSetupScreen();
      showScreen("setup");
    }
  } catch (err) {
    console.error(err);
    showToast("Não foi possível carregar as áreas da sua equipe.");
  } finally {
    setLoading(false);
  }
}

function updateHeader() {
  headerColaborador.textContent = profile.full_name;
  headerMeta.textContent = `${team ? team.name : ""}`;
}

/* ---------------------------------------------------------
   TELA 1 - INÍCIO DA RONDA
--------------------------------------------------------- */
function initSetupScreen() {
  setupWelcome.textContent = `${profile.full_name} • ${team ? team.name : ""} — selecione o turno para iniciar.`;
  if (state && state.rondaId) {
    selectTurno.value = state.turno || "";
    const doneCount = Object.values(state.areas).filter((a) => a.done).length;
    resumeNote.hidden = false;
    resumeNote.textContent = `Você tem uma ronda em andamento iniciada às ${formatTime(state.startedAt)} (${doneCount}/${FLAT_AREAS.length} concluídas). Ao continuar, ela será retomada.`;
    btnIniciar.textContent = "Continuar Ronda";
  } else {
    resumeNote.hidden = true;
    btnIniciar.textContent = "Iniciar Ronda";
  }
}

btnIniciar.addEventListener("click", async () => {
  const turno = selectTurno.value;
  if (!turno) { showToast("Selecione o turno."); selectTurno.focus(); return; }

  if (state && state.rondaId) {
    renderChecklist();
    showScreen("checklist");
    return;
  }

  setLoading(true, "Iniciando ronda...");
  try {
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("rondas")
      .insert({ employee_id: profile.id, team_id: profile.team_id, turno, started_at: startedAt })
      .select()
      .single();
    if (error) throw error;

    state = {
      rondaId: data.id,
      employeeId: profile.id,
      teamId: profile.team_id,
      colaborador: profile.full_name,
      equipe: team ? team.name : "",
      turno,
      startedAt,
      areas: {}
    };
    saveState(state);
    renderChecklist();
    showScreen("checklist");
  } catch (err) {
    console.error(err);
    showToast("Não foi possível iniciar a ronda. Verifique sua internet e tente de novo.");
  } finally {
    setLoading(false);
  }
});

/* ---------------------------------------------------------
   TELA 2 - CHECKLIST
--------------------------------------------------------- */
function areaCardHtml(area) {
  const entry = state.areas[area.id];
  const done = !!(entry && entry.done);
  return `
    <div class="area-card ${done ? "done" : ""}" data-id="${area.id}">
      <div class="area-row">
        <div class="area-info">
          <span class="area-status-dot"></span>
          <span class="area-name">${area.name}</span>
        </div>
        <button type="button" class="btn-camera" data-action="foto" aria-label="Tirar foto de ${area.name}">${done ? "🔄" : "📷"}</button>
      </div>
      <div class="area-photo-wrap" ${done ? "" : "hidden"}>
        <img class="area-photo" src="${done ? entry.thumb || "" : ""}" alt="Foto ${area.name}">
        <span class="area-timestamp">${done ? formatDateTime(entry.timestamp) : ""}</span>
      </div>
      <textarea class="area-obs" placeholder="Observação (opcional): ex. piso sujo, móvel danificado, espelho quebrado...">${entry && entry.obs ? entry.obs : ""}</textarea>
    </div>`;
}

function renderChecklist() {
  groupsContainer.innerHTML = AREAS.map((g, gi) => {
    const groupAreas = FLAT_AREAS.filter((a) => a.group === g.group);
    const doneInGroup = groupAreas.filter((a) => state.areas[a.id] && state.areas[a.id].done).length;
    return `
      <details class="group" ${gi === 0 ? "open" : ""} data-group="${g.group}">
        <summary>
          ${g.group}
          <span class="group-count" data-group-count="${g.group}">${doneInGroup}/${groupAreas.length}</span>
        </summary>
        <div class="group-areas">
          ${groupAreas.map(areaCardHtml).join("")}
        </div>
      </details>`;
  }).join("");
  updateProgress();
}

function updateProgress() {
  const total = FLAT_AREAS.length;
  const done = Object.values(state.areas).filter((a) => a.done).length;
  progressFill.style.width = `${(done / total) * 100}%`;
  progressLabel.textContent = `${done}/${total} concluídas`;
}

function updateGroupCount(groupName) {
  const groupAreas = FLAT_AREAS.filter((a) => a.group === groupName);
  const done = groupAreas.filter((a) => state.areas[a.id] && state.areas[a.id].done).length;
  const el = groupsContainer.querySelector(`[data-group-count="${CSS.escape(groupName)}"]`);
  if (el) el.textContent = `${done}/${groupAreas.length}`;
}

groupsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest('[data-action="foto"]');
  if (!btn) return;
  const card = btn.closest(".area-card");
  activeAreaId = card.dataset.id;
  cameraInput.value = "";
  cameraInput.click();
});

// Salva localmente a cada tecla; sincroniza com o Supabase quando o campo perde o foco.
groupsContainer.addEventListener("input", (e) => {
  if (!e.target.classList.contains("area-obs")) return;
  const card = e.target.closest(".area-card");
  const id = card.dataset.id;
  if (!state.areas[id]) state.areas[id] = { done: false, timestamp: null, obs: "" };
  state.areas[id].obs = e.target.value;
  saveState(state);
});

groupsContainer.addEventListener(
  "change",
  (e) => {
    if (!e.target.classList.contains("area-obs")) return;
    const card = e.target.closest(".area-card");
    syncObservation(card.dataset.id);
  },
  true
);

async function syncObservation(areaId) {
  const entry = state.areas[areaId];
  if (!entry) return;
  await updateQueuedObservation(state.rondaId, areaId, entry.obs || "");
  try {
    await supabase.from("ronda_items").upsert(
      { ronda_id: state.rondaId, sub_place_id: areaId, observation: entry.obs || null },
      { onConflict: "ronda_id,sub_place_id" }
    );
  } catch (err) {
    console.error("Falha ao sincronizar observação (será reenviada com a foto):", err);
  }
}

btnVoltar.addEventListener("click", () => {
  showScreen("setup");
  initSetupScreen();
});

/* ---------------------------------------------------------
   CAPTURA DE FOTO + CARIMBO DE DATA/HORA
--------------------------------------------------------- */
cameraInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !activeAreaId) return;
  const area = FLAT_AREAS.find((a) => a.id === activeAreaId);

  setLoading(true, "Processando foto...");
  try {
    const now = new Date();
    const processed = await processPhoto(file, now, area.name);
    await savePhoto(area.id, processed);

    if (!state.areas[area.id]) state.areas[area.id] = { done: false, timestamp: null, obs: "" };
    state.areas[area.id].done = true;
    state.areas[area.id].timestamp = now.toISOString();
    state.areas[area.id].thumb = processed.thumb;
    saveState(state);

    await enqueueUpload({
      teamId: state.teamId,
      employeeId: state.employeeId,
      rondaId: state.rondaId,
      subPlaceId: area.id,
      dataUrl: processed.dataUrl,
      observation: state.areas[area.id].obs || null,
      capturedAt: now.toISOString()
    });
    drainQueue(); // dispara em segundo plano, não bloqueia a UI

    refreshAreaCard(area.id);
    updateGroupCount(area.group);
    updateProgress();
    showToast(`Foto registrada: ${area.name}`);
  } catch (err) {
    console.error(err);
    showToast("Não foi possível processar a foto. Tente novamente.");
  } finally {
    setLoading(false);
    activeAreaId = null;
  }
});

function refreshAreaCard(id) {
  const card = groupsContainer.querySelector(`.area-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const area = FLAT_AREAS.find((a) => a.id === id);
  card.outerHTML = areaCardHtml(area);
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Decodifica o arquivo já corrigindo a rotação EXIF (fotos de câmera real trazem
// esse metadado; sem isso o canvas desenha a imagem deitada/espelhada).
async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      try { return await createImageBitmap(file); } catch (e2) { /* cai no fallback abaixo */ }
    }
  }
  const objUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler a foto da câmera."));
      el.src = objUrl;
    });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

// Redimensiona a foto, desenha carimbo de data/hora e devolve dataURLs + metadados
function processPhoto(file, now, areaName) {
  return withTimeout((async () => {
    const source = await loadImageSource(file);
    const srcW = source.width || source.naturalWidth;
    const srcH = source.height || source.naturalHeight;
    if (!srcW || !srcH) throw new Error("Foto inválida ou vazia.");

    const MAX_W = 1440;
    const scale = Math.min(1, MAX_W / srcW);
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, w, h);
    if (source.close) source.close();

    const barH = Math.max(34, Math.round(h * 0.09));
    ctx.fillStyle = "rgba(7, 26, 51, 0.75)";
    ctx.fillRect(0, h - barH, w, barH);

    const fontSize = Math.max(15, Math.round(barH * 0.36));
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";

    ctx.font = `700 ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(areaName, 14, h - barH / 2 - fontSize * 0.55);

    ctx.font = `600 ${Math.round(fontSize * 0.86)}px Arial, sans-serif`;
    ctx.fillText(formatDateTime(now) + " • " + CONDO_NOME, 14, h - barH / 2 + fontSize * 0.55);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);

    const thumbCanvas = document.createElement("canvas");
    const tW = Math.min(320, w);
    const tH = Math.round(h * (tW / w));
    thumbCanvas.width = tW; thumbCanvas.height = tH;
    thumbCanvas.getContext("2d").drawImage(canvas, 0, 0, tW, tH);
    const thumb = thumbCanvas.toDataURL("image/jpeg", 0.6);

    return { dataUrl, thumb, width: w, height: h, timestamp: now.toISOString() };
  })(), 20000, "Tempo esgotado ao processar a foto. Tente novamente.");
}

/* ---------------------------------------------------------
   GERAÇÃO DO PDF
--------------------------------------------------------- */
btnGerarRelatorio.addEventListener("click", async () => {
  const done = Object.values(state.areas).filter((a) => a.done).length;
  if (done === 0) {
    showToast("Registre ao menos uma foto antes de gerar o relatório.");
    return;
  }
  setLoading(true, "Gerando relatório PDF...");
  try {
    const blob = await gerarRelatorioPDF({
      AREAS, FLAT_AREAS, stateAreas: state.areas,
      meta: { colaborador: state.colaborador, equipe: state.equipe, turno: state.turno, startedAt: state.startedAt },
      getPhoto
    });
    lastPdfBlob = blob;

    try {
      await supabase.from("rondas").update({ finished_at: new Date().toISOString() }).eq("id", state.rondaId);
    } catch (err) {
      console.error("Falha ao marcar ronda como concluída (será sincronizado depois):", err);
    }

    const pendentes = FLAT_AREAS.length - done;
    summaryText.textContent = `${done} de ${FLAT_AREAS.length} áreas concluídas` + (pendentes > 0 ? ` — ${pendentes} pendente(s).` : ".");
    showScreen("summary");
  } catch (err) {
    console.error(err);
    showToast("Erro ao gerar o PDF. Tente novamente.");
  } finally {
    setLoading(false);
  }
});

/* ---------------------------------------------------------
   TELA 3 - RESUMO / COMPARTILHAR
--------------------------------------------------------- */
function pdfFileName() {
  const d = new Date();
  return `Ronda_CampoBelissimo_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
}

btnShare.addEventListener("click", async () => {
  if (!lastPdfBlob) return;
  const file = new File([lastPdfBlob], pdfFileName(), { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Relatório de Ronda", text: `Relatório de ronda - ${CONDO_NOME}` });
    } catch (err) {
      if (err && err.name !== "AbortError") showToast("Não foi possível compartilhar o relatório.");
    }
  } else {
    showToast('Compartilhamento direto não disponível. Use "Baixar PDF".');
  }
});

btnDownload.addEventListener("click", () => {
  if (!lastPdfBlob) return;
  const url = URL.createObjectURL(lastPdfBlob);
  const a = document.createElement("a");
  a.href = url; a.download = pdfFileName();
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

btnNovaRonda.addEventListener("click", async () => {
  await clearPhotos();
  await clearUploadQueue();
  clearState();
  state = null;
  lastPdfBlob = null;
  selectTurno.value = "";
  initSetupScreen();
  showScreen("setup");
});

/* ---------------------------------------------------------
   INICIALIZAÇÃO
--------------------------------------------------------- */
(async function init() {
  setLoading(true, "Verificando sessão...");
  try {
    profile = await getSessionProfile();
  } catch (e) {
    profile = null;
  }
  setLoading(false);

  if (profile) {
    await afterLogin();
  } else {
    showScreen("login");
  }
})();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
