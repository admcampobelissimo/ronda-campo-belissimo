import { supabase } from "./supabase-client.js";
import { getPendingUploads, updateUploadJob } from "./db.js";

const MAX_ATTEMPTS = 8;
let draining = false;

// Converte a dataURL (já processada/carimbada) num Blob para subir ao Storage.
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

function storagePath(job) {
  return `${job.teamId}/${job.employeeId}/${job.rondaId}/${job.subPlaceId}.jpg`;
}

// Tenta enviar todos os itens pendentes da fila. Seguro de chamar várias
// vezes (ex: ao voltar internet e ao carregar a página) — usa um trava
// simples para não rodar em paralelo consigo mesma.
export async function drainQueue(onProgress) {
  if (draining) return;
  draining = true;
  try {
    const jobs = await getPendingUploads();
    for (const job of jobs) {
      if (job.attempts >= MAX_ATTEMPTS) continue;
      try {
        const blob = await dataUrlToBlob(job.dataUrl);
        const path = storagePath(job);

        const { error: uploadError } = await supabase.storage
          .from("ronda-photos")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (uploadError) throw uploadError;

        const { error: upsertError } = await supabase.from("ronda_items").upsert(
          {
            ronda_id: job.rondaId,
            sub_place_id: job.subPlaceId,
            photo_storage_path: path,
            observation: job.observation || null,
            captured_at: job.capturedAt
          },
          { onConflict: "ronda_id,sub_place_id" }
        );
        if (upsertError) throw upsertError;

        await updateUploadJob(job.id, { status: "done" });
        if (onProgress) onProgress({ ok: true, job });
      } catch (err) {
        console.error("Falha ao sincronizar foto:", err);
        await updateUploadJob(job.id, { attempts: (job.attempts || 0) + 1, lastError: String(err) });
        if (onProgress) onProgress({ ok: false, job, error: err });
      }
    }
  } finally {
    draining = false;
  }
}

export function initUploadQueueAutoSync() {
  window.addEventListener("online", () => drainQueue());
  drainQueue();
  // Reforço periódico: cobre o caso de a conexão voltar sem disparar o evento "online".
  setInterval(() => { if (navigator.onLine) drainQueue(); }, 60000);
}
