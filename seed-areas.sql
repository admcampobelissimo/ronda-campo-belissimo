-- ============================================================
-- Migra a lista atual de áreas (areas.js) para a equipe "Rondista".
-- Rodar UMA VEZ, depois de rodar schema.sql, no SQL Editor do Supabase.
-- Se precisar rodar de novo, apague antes a equipe "Rondista" pelo
-- painel admin (ou: delete from public.teams where name = 'Rondista';
-- o "on delete cascade" já limpa places/sub_places junto).
-- ============================================================

do $$
declare
  v_team_id uuid;
  v_place_id uuid;
begin
  insert into public.teams (name) values ('Rondista') returning id into v_team_id;

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Academia', 1) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values (v_place_id, 'Academia', 1);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Sala de Ginástica', 2) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values (v_place_id, 'Sala de Ginástica', 1);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Torre Figueira', 3) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Hall Social Figueira 1 e 2', 1),
    (v_place_id, 'Hall Social Figueira 3 e 4', 2),
    (v_place_id, 'Hall de Serviço Figueira', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Torre Paineira', 4) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Hall Social Paineira 1 e 2', 1),
    (v_place_id, 'Hall Social Paineira 3 e 4', 2),
    (v_place_id, 'Hall de Serviço Paineira', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'SPA', 5) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'SPA', 1),
    (v_place_id, 'Sauna Úmida', 2),
    (v_place_id, 'Sauna Seca', 3),
    (v_place_id, 'Sala de Massagem 1', 4),
    (v_place_id, 'Sala de Massagem 2', 5),
    (v_place_id, 'Banheiro SPA', 6),
    (v_place_id, 'Chuveiro SPA', 7);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Bistrô', 6) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Bistrô', 1),
    (v_place_id, 'Copa Bistrô', 2),
    (v_place_id, 'Banheiro Bistrô', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Salão de Festas', 7) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Salão de Festas', 1),
    (v_place_id, 'Copa Salão de Festas', 2),
    (v_place_id, 'Banheiro Salão de Festas', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Brinquedoteca', 8) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Brinquedoteca', 1),
    (v_place_id, 'Banheiro Brinquedoteca', 2),
    (v_place_id, 'Cozinha Brinquedoteca', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Espaço Teen', 9) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Espaço Teen', 1),
    (v_place_id, 'Banheiro Espaço Teen', 2),
    (v_place_id, 'Deck Espaço Teen', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Piscinas', 10) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Piscina Externa', 1),
    (v_place_id, 'Piscina Raia', 2),
    (v_place_id, 'Bar da Piscina', 3);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Espelhos D''Água', 11) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Espelho D''Água 1 (Figueira)', 1),
    (v_place_id, 'Espelho D''Água 2 (Central)', 2),
    (v_place_id, 'Espelho D''Água 3 (Paineira)', 3),
    (v_place_id, 'Espelho D''Água Bistrô', 4);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Esculturas', 12) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Escultura Piscina', 1),
    (v_place_id, 'Escultura Final Alameda', 2);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Cinema', 13) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Cinema', 1);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Esportes', 14) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Quadra Society', 1),
    (v_place_id, 'Quadra de Tênis', 2);

  insert into public.places (team_id, name, sort_order) values (v_team_id, 'Áreas Externas', 15) returning id into v_place_id;
  insert into public.sub_places (place_id, name, sort_order) values
    (v_place_id, 'Alameda', 1),
    (v_place_id, 'Deck Jabuticabeiras', 2),
    (v_place_id, 'Deck Figueira', 3),
    (v_place_id, 'Brinquedão', 4);
end $$;
