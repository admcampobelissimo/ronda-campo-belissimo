import { supabase } from "./supabase-client.js";

export async function fetchTeam(teamId) {
  const { data, error } = await supabase.from("teams").select("id, name").eq("id", teamId).single();
  if (error) throw error;
  return data;
}

// Busca lugares + sub-lugares da equipe e monta o mesmo formato
// { group, areas: [nome,...] } que o restante do app já sabe renderizar,
// além de uma lista plana com o id real (uuid) de cada sub-lugar.
export async function fetchTeamAreas(teamId) {
  const { data: places, error } = await supabase
    .from("places")
    .select("id, name, sort_order, sub_places(id, name, sort_order)")
    .eq("team_id", teamId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const AREAS = [];
  const FLAT_AREAS = [];
  for (const place of places) {
    const subPlaces = [...(place.sub_places || [])].sort((a, b) => a.sort_order - b.sort_order);
    AREAS.push({ group: place.name, areas: subPlaces.map((s) => s.name) });
    for (const s of subPlaces) {
      FLAT_AREAS.push({ id: s.id, group: place.name, name: s.name });
    }
  }
  return { AREAS, FLAT_AREAS };
}
