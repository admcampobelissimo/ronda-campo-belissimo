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

// Envia o zip e SÓ retorna com sucesso se o tamanho confirmado pelo Drive
// bater com o tamanho local — caso contrário lança erro (e nada é apagado
// depois, pois quem chama só prossegue para a exclusão após isto resolver).
async function uploadZipToDrive(zipBytes, filename) {
  const folderId = await findOrCreateFolder();
  const metadata = { name: filename, parents: [folderId] };
  const boundary = "ronda_cb_" + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`;
  const body = new Blob([head, zipBytes, `\r\n--${boundary}--`]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size",
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
  const expectedSize = zipBytes.byteLength;
  if (Number(json.size) !== expectedSize) {
    throw new Error("O arquivo confirmado pelo Drive não bate com o tamanho enviado — nada foi apagado do Supabase.");
  }
  return json;
}

function slug(str) {
  return String(str).replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function runArchive({ teamId, teamName, cutoff, setLoading }) {
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

  // Fase 1: gerar um PDF por ronda. Falha isolada = pula essa ronda e segue
  // (nada é apagado nesta fase, então uma falha aqui não tem risco nenhum).
  const files = {};
  const rondaMeta = [];
  const skipped = [];
  for (let i = 0; i < rondas.length; i++) {
    const r = rondas[i];
    setLoading(true, `Gerando PDF ${i + 1}/${rondas.length}...`);
    try {
      const { blob, items } = await gerarPdfParaRonda(r.id);
      const dateStr = (r.finished_at || r.started_at).slice(0, 10).replace(/-/g, "");
      const who = slug(r.profiles?.full_name || "funcionario");
      const filename = `Ronda_${dateStr}_${who}_${r.id.slice(0, 8)}.pdf`;
      files[filename] = new Uint8Array(await blob.arrayBuffer());
      rondaMeta.push({ rondaId: r.id, filename, items });
    } catch (err) {
      console.error("Falha ao gerar PDF da ronda", r.id, err);
      skipped.push({ rondaId: r.id, motivo: "Falha ao gerar PDF: " + err.message });
    }
  }

  if (rondaMeta.length === 0) {
    return { archivedCount: 0, skipped, total: rondas.length };
  }

  // Fase 2: zipar tudo e autoconferir antes de gastar uma chamada de rede.
  setLoading(true, "Compactando arquivos...");
  const manifest = {
    equipe: teamName,
    dataCorte: cutoff,
    geradoEm: new Date().toISOString(),
    rondas: rondaMeta.map((r) => ({ rondaId: r.rondaId, arquivo: r.filename }))
  };
  files["manifest.json"] = window.fflate.strToU8(JSON.stringify(manifest, null, 2));

  const zipped = window.fflate.zipSync(files, { level: 6 });
  const check = window.fflate.unzipSync(zipped);
  if (Object.keys(check).length !== Object.keys(files).length) {
    throw new Error("Falha ao validar o arquivo compactado — nada foi enviado nem apagado.");
  }

  // Fase 3: upload — só passa daqui se o Drive confirmar o tamanho certo.
  setLoading(true, "Enviando para o Google Drive...");
  const zipName = `Arquivo_${slug(teamName)}_ate_${cutoff.replace(/-/g, "")}_gerado_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.zip`;
  await uploadZipToDrive(zipped, zipName);

  // Fase 4: só agora libera espaço — uma ronda de cada vez, e só marca como
  // arquivada (limpa o caminho da foto) se a exclusão no Storage não deu erro.
  let archivedCount = 0;
  for (let i = 0; i < rondaMeta.length; i++) {
    const rm = rondaMeta[i];
    setLoading(true, `Liberando espaço ${i + 1}/${rondaMeta.length}...`);
    const paths = rm.items.filter((it) => it.photo_storage_path).map((it) => it.photo_storage_path);
    try {
      if (paths.length > 0) {
        const { error: removeError } = await supabase.storage.from("ronda-photos").remove(paths);
        if (removeError) throw removeError;
        const ids = rm.items.filter((it) => it.photo_storage_path).map((it) => it.id);
        const { error: updateError } = await supabase.from("ronda_items").update({ photo_storage_path: null }).in("id", ids);
        if (updateError) throw updateError;
      }
      const { error: archivedError } = await supabase.from("rondas").update({ archived_at: new Date().toISOString() }).eq("id", rm.rondaId);
      if (archivedError) throw archivedError;
      archivedCount++;
    } catch (err) {
      console.error("PDF arquivado, mas falha ao liberar espaço da ronda", rm.rondaId, err);
      skipped.push({ rondaId: rm.rondaId, motivo: "PDF já está no Drive, mas falhou ao apagar a foto original: " + err.message });
    }
  }

  return { archivedCount, skipped, total: rondas.length, zipName };
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
    ${summary.zipName ? `<p class="admin-empty">Arquivo: ${summary.zipName}</p>` : ""}
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
    const teamName = teamSelect.options[teamSelect.selectedIndex]?.textContent || "Equipe";
    const cutoff = dateInput.value;
    if (!teamId) { showToast("Selecione uma equipe."); return; }
    if (!cutoff) { showToast("Selecione a data de corte."); return; }
    if (!hasValidToken()) { showToast('Clique em "Conectar ao Google Drive" primeiro.'); return; }

    btnArquivar.disabled = true;
    resultEl.innerHTML = "";
    setLoading(true, "Buscando rondas elegíveis...");
    try {
      const summary = await runArchive({ teamId, teamName, cutoff, setLoading });
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
