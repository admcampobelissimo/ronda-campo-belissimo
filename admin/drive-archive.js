import { supabase } from "../supabase-client.js";
import { gerarPdfParaRonda } from "./ronda-report.js";
import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_FOLDER_NAME } from "../config.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let folderIdCache = null;

function hasValidToken() {
  return !!accessToken && Date.now() < tokenExpiresAt - 60000;
}

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    throw new Error("A biblioteca de login do Google ainda não carregou. Aguarde alguns segundos e tente de novo.");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {} // sobrescrito a cada chamada de requestAccessToken()
  });
  return tokenClient;
}

// Importante: deve ser chamada como o primeiro passo de um handler de clique
// (sem "await" antes), para o navegador reconhecer o popup como resultado
// direto de uma ação do usuário.
function requestAccessToken() {
  return new Promise((resolve, reject) => {
    let client;
    try {
      client = ensureTokenClient();
    } catch (err) {
      reject(err);
      return;
    }
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(
          resp.error === "access_denied"
            ? "Autorização recusada — não foi possível conectar ao Google Drive."
            : "Erro ao conectar ao Google Drive: " + resp.error
        ));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: hasValidToken() ? "" : "consent" });
  });
}

async function driveFetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`O Google Drive recusou a solicitação (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Acha (ou cria, na primeira vez) a pasta fixa onde todos os relatórios
// arquivados se acumulam — assim tudo fica num só lugar, sem precisar abrir
// zip nenhum.
async function findOrCreateFolder() {
  if (folderIdCache) return folderIdCache;
  const q = encodeURIComponent(
    `name='${GOOGLE_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const list = await driveFetchJson(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  if (list.files && list.files.length > 0) {
    folderIdCache = list.files[0].id;
    return folderIdCache;
  }
  const created = await driveFetchJson("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: GOOGLE_DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  folderIdCache = created.id;
  return folderIdCache;
}

// Envia um arquivo e SÓ retorna com sucesso se o tamanho confirmado pelo
// Drive bater com o tamanho local — caso contrário lança erro, e quem chama
// não prossegue para apagar nada do Supabase.
async function uploadFileToDrive(bytes, filename, folderId, mimeType) {
  const metadata = { name: filename, parents: [folderId] };
  const boundary = "ronda_cb_" + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const body = new Blob([head, bytes, `\r\n--${boundary}--`]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar para o Drive (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  if (Number(json.size) !== bytes.byteLength) {
    throw new Error("O arquivo confirmado pelo Drive não bate com o tamanho enviado.");
  }
  return json;
}

function slug(str) {
  return String(str).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Processa uma ronda de cada vez, de ponta a ponta: gera o PDF, sobe pro
// Drive (na pasta fixa e compartilhada), confirma o tamanho, e só então libera
// espaço no Supabase e marca a ronda como arquivada. Uma falha em qualquer
// etapa pula só aquela ronda (nada é apagado) e segue para a próxima.
async function runArchive({ teamId, cutoff, setLoading }) {
  const cutoffIso = new Date(cutoff + "T23:59:59").toISOString();

  const { data: rondas, error } = await supabase
    .from("rondas")
    .select("id, started_at, finished_at, profiles(full_name)")
    .eq("team_id", teamId)
    .not("finished_at", "is", null)
    .is("archived_at", null)
    .lt("finished_at", cutoffIso)
    .order("finished_at", { ascending: true });
  if (error) throw error;

  if (!rondas || rondas.length === 0) {
    return { archivedCount: 0, skipped: [], total: 0 };
  }

  const folderId = await findOrCreateFolder();
  const skipped = [];
  let archivedCount = 0;

  for (let i = 0; i < rondas.length; i++) {
    const r = rondas[i];
    setLoading(true, `Arquivando ${i + 1}/${rondas.length}...`);
    try {
      const { blob, items } = await gerarPdfParaRonda(r.id);
      const dateStr = (r.finished_at || r.started_at).slice(0, 10).replace(/-/g, "");
      const who = slug(r.profiles?.full_name || "funcionario");
      const filename = `Ronda_${dateStr}_${who}_${r.id.slice(0, 8)}.pdf`;
      const pdfBytes = new Uint8Array(await blob.arrayBuffer());

      const uploaded = await uploadFileToDrive(pdfBytes, filename, folderId, "application/pdf");
      const driveLink = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;

      const paths = items.filter((it) => it.photo_storage_path).map((it) => it.photo_storage_path);
      if (paths.length > 0) {
        const { error: removeError } = await supabase.storage.from("ronda-photos").remove(paths);
        if (removeError) throw removeError;
        const ids = items.filter((it) => it.photo_storage_path).map((it) => it.id);
        const { error: updateError } = await supabase.from("ronda_items").update({ photo_storage_path: null }).in("id", ids);
        if (updateError) throw updateError;
      }
      const { error: archivedError } = await supabase.from("rondas")
        .update({ archived_at: new Date().toISOString(), drive_file_link: driveLink })
        .eq("id", r.id);
      if (archivedError) throw archivedError;
      archivedCount++;
    } catch (err) {
      console.error("Falha ao arquivar a ronda", r.id, err);
      skipped.push({ rondaId: r.id, motivo: err.message });
    }
  }

  return { archivedCount, skipped, total: rondas.length };
}

function renderSummary(el, summary) {
  if (summary.total === 0) {
    el.innerHTML = `<p class="admin-empty">Nenhuma ronda concluída antes dessa data para arquivar.</p>`;
    return;
  }
  const skippedHtml = summary.skipped.length
    ? `<p class="drive-archive-warn">${summary.skipped.length} pulada(s):</p><ul class="drive-archive-skip-list">${summary.skipped.map((s) => `<li>Ronda ${s.rondaId.slice(0, 8)} — ${s.motivo}</li>`).join("")}</ul>`
    : "";
  el.innerHTML = `
    <p class="drive-archive-ok">${summary.archivedCount} de ${summary.total} ronda(s) arquivada(s) e removida(s) do Supabase.</p>
    <p class="admin-empty">Cada uma foi salva como um PDF separado na pasta "${GOOGLE_DRIVE_FOLDER_NAME}" do seu Google Drive.</p>
    ${skippedHtml}`;
}

export function initDriveArchive({ showToast, setLoading }) {
  const btnConectar = document.getElementById("btnConectarDrive");
  const btnArquivar = document.getElementById("btnArquivar");
  const statusEl = document.getElementById("driveStatus");
  const resultEl = document.getElementById("driveArchiveResult");
  const dateInput = document.getElementById("driveCutoffDate");
  const teamSelect = document.getElementById("selectEquipeHistorico");
  if (!btnConectar || !btnArquivar) return; // markup ainda não presente nesta página

  btnConectar.addEventListener("click", async () => {
    try {
      await requestAccessToken();
      statusEl.textContent = "Conectado ao Google Drive.";
      statusEl.classList.add("ok");
      btnArquivar.disabled = false;
    } catch (err) {
      showToast(err.message);
    }
  });

  btnArquivar.addEventListener("click", async () => {
    const teamId = teamSelect.value;
    const cutoff = dateInput.value;
    if (!teamId) { showToast("Selecione uma equipe."); return; }
    if (!cutoff) { showToast("Selecione a data de corte."); return; }
    if (!hasValidToken()) { showToast('Clique em "Conectar ao Google Drive" primeiro.'); return; }

    btnArquivar.disabled = true;
    resultEl.innerHTML = "";
    setLoading(true, "Buscando rondas elegíveis...");
    try {
      const summary = await runArchive({ teamId, cutoff, setLoading });
      renderSummary(resultEl, summary);
    } catch (err) {
      console.error(err);
      showToast("Erro no arquivamento: " + err.message);
    } finally {
      setLoading(false);
      btnArquivar.disabled = false;
    }
  });
}
