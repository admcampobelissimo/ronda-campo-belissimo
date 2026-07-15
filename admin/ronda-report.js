import { supabase } from "../supabase-client.js";
import { gerarRelatorioPDF } from "../pdf-report.js";

const FREQ_LABELS = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };

// Busca os metadados de uma ronda + todos os seus itens (área, observação,
// caminho da foto no Storage). Usado tanto pela tela de histórico (visualizar)
// quanto pelo gerador de PDF (individual ou em lote, no arquivamento).
export async function fetchRondaItemsData(rondaId) {
  const { data: ronda, error: rondaError } = await supabase
    .from("rondas")
    .select("id, turno, frequency, started_at, finished_at, team_id, profiles(full_name), teams(name)")
    .eq("id", rondaId)
    .single();
  if (rondaError) throw rondaError;

  const { data: items, error: itemsError } = await supabase
    .from("ronda_items")
    .select("id, sub_place_id, observation, captured_at, photo_storage_path, sub_places(name, place_id, requires_photo, places(name))")
    .eq("ronda_id", rondaId);
  if (itemsError) throw itemsError;

  return { ronda, items: items || [] };
}

// Monta o PDF de uma ronda a partir dos dados do Supabase, buscando cada foto
// via signed URL (o bucket é privado). Reaproveitado pelo botão individual
// "Gerar PDF" do histórico e pelo arquivamento em lote pro Google Drive.
export async function gerarPdfParaRonda(rondaId) {
  const { ronda, items } = await fetchRondaItemsData(rondaId);

  const AREAS = [];
  const FLAT_AREAS = [];
  const stateAreas = {};
  const groupSeen = new Map();
  for (const it of items) {
    const groupName = it.sub_places && it.sub_places.places ? it.sub_places.places.name : "Outros";
    if (!groupSeen.has(groupName)) { groupSeen.set(groupName, []); AREAS.push({ group: groupName, areas: groupSeen.get(groupName) }); }
    const name = it.sub_places ? it.sub_places.name : it.sub_place_id;
    groupSeen.get(groupName).push(name);
    FLAT_AREAS.push({
      id: it.sub_place_id,
      group: groupName,
      name,
      requiresPhoto: it.sub_places ? it.sub_places.requires_photo !== false : true
    });
    stateAreas[it.sub_place_id] = { done: true, timestamp: it.captured_at, obs: it.observation };
  }

  const photoCache = {};
  async function getPhoto(subPlaceId) {
    if (photoCache[subPlaceId] !== undefined) return photoCache[subPlaceId];
    const item = items.find((i) => i.sub_place_id === subPlaceId);
    if (!item || !item.photo_storage_path) { photoCache[subPlaceId] = null; return null; }
    const { data } = await supabase.storage.from("ronda-photos").createSignedUrl(item.photo_storage_path, 3600);
    if (!data) { photoCache[subPlaceId] = null; return null; }
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = data.signedUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
    const result = { dataUrl: canvas.toDataURL("image/jpeg", 0.85), width: img.naturalWidth, height: img.naturalHeight };
    photoCache[subPlaceId] = result;
    return result;
  }

  const blob = await gerarRelatorioPDF({
    AREAS, FLAT_AREAS, stateAreas,
    meta: {
      colaborador: ronda.profiles ? ronda.profiles.full_name : "—",
      equipe: ronda.teams ? ronda.teams.name : "—",
      turno: ronda.turno || null,
      frequency: ronda.frequency ? FREQ_LABELS[ronda.frequency] : null,
      startedAt: ronda.started_at
    },
    getPhoto,
    logoUrl: "../assets/logo.png"
  });

  return { blob, ronda, items };
}
