import { supabase } from "./supabase-client.js";

export async function fetchTeam(teamId) {
  const { data, error } = await supabase.from("teams").select("id, name").eq("id", teamId).single();
  if (error) throw error;
  return data;
}

// Busca os lugares (+ sub-lugares) brutos da equipe, sem montar o formato
// de checklist ainda — separado de buildAreas() para permitir filtrar por
// periodicidade sem precisar de uma segunda ida ao banco.
export async function fetchTeamPlaces(teamId) {
  const { data: places, error } = await supabase
    .from("places")
    .select("id, name, sort_order, frequency, sub_places(id, name, sort_order, requires_photo)")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return places || [];
}

// Lista as periodicidades distintas realmente cadastradas entre os lugares
// de uma equipe. A maioria das equipes só tem "diaria" (lista com 1 item) —
// é isso que o app usa para decidir se mostra ou não o seletor de
// periodicidade na tela de início da ronda.
export function distinctFrequencies(places) {
  return [...new Set(places.map((p) => p.frequency).filter(Boolean))];
}

// Monta o mesmo formato { group, areas: [nome,...] } que o restante do app
// já sabe renderizar, além de uma lista plana com o id real (uuid) de cada
// sub-lugar. Quando `frequency` é informado, só entram lugares daquela
// periodicidade.
export function buildAreas(places, frequency = null) {
  const filtered = frequency ? places.filter((p) => p.frequency === frequency) : places;

  const AREAS = [];
  const FLAT_AREAS = [];
  for (const place of filtered) {
    const subPlaces = [...(place.sub_places || [])].sort((a, b) => a.sort_order - b.sort_order);
    AREAS.push({ group: place.name, areas: subPlaces.map((s) => s.name) });
    for (const s of subPlaces) {
      FLAT_AREAS.push({ id: s.id, group: place.name, name: s.name, requiresPhoto: s.requires_photo !== false });
    }
  }
  return { AREAS, FLAT_AREAS };
}

// Atalho de conveniência (busca + monta em uma chamada só) — mantido para
// quem só precisa do resultado final sem se importar com a periodicidade.
export async function fetchTeamAreas(teamId, frequency = null) {
  const places = await fetchTeamPlaces(teamId);
  return buildAreas(places, frequency);
}
