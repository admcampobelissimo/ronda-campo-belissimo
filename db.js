// IndexedDB local: guarda as fotos processadas (para o PDF instantâneo do
// colaborador) e uma fila de upload para o Supabase Storage (para resistir a
// quedas de internet — a foto é salva localmente na hora e sincronizada
// depois, sem bloquear a ronda).
const DB_NAME = "rondaCB_db";
const DB_VERSION = 2;
const STORE_PHOTOS = "photos";
const STORE_QUEUE = "uploadQueue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        db.createObjectStore(STORE_PHOTOS);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePhoto(id, record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, "readwrite");
    tx.objectStore(STORE_PHOTOS).put(record, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPhoto(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, "readonly");
    const req = tx.objectStore(STORE_PHOTOS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPhotos() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, "readwrite");
    tx.objectStore(STORE_PHOTOS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueUpload(job) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const req = tx.objectStore(STORE_QUEUE).add({ status: "pending", attempts: 0, ...job });
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingUploads() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const req = tx.objectStore(STORE_QUEUE).getAll();
    req.onsuccess = () => resolve((req.result || []).filter((j) => j.status !== "done"));
    req.onerror = () => reject(req.error);
  });
}

export async function updateUploadJob(id, changes) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const job = getReq.result;
      if (!job) return resolve();
      store.put({ ...job, ...changes });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Atualiza a observação de um job ainda pendente (foto tirada mas não
// enviada ainda) para que o texto mais recente viaje junto quando o upload
// finalmente acontecer.
export async function updateQueuedObservation(rondaId, subPlaceId, observation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const req = store.getAll();
    req.onsuccess = () => {
      const job = (req.result || []).find(
        (j) => j.status !== "done" && j.rondaId === rondaId && j.subPlaceId === subPlaceId
      );
      if (job) store.put({ ...job, observation });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearUploadQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
