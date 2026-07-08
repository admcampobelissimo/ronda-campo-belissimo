-- ============================================================
-- Ronda Campo Belissimo — schema completo (rodar uma vez no
-- SQL Editor do Supabase: Dashboard > SQL Editor > New query)
-- ============================================================

-- ------------------------------------------------------------
-- TIPOS
-- ------------------------------------------------------------
create type public.user_role as enum ('admin', 'operacional');

-- ------------------------------------------------------------
-- TABELAS
-- ------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

create table public.sub_places (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (place_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null,
  role public.user_role not null default 'operacional',
  team_id uuid references public.teams(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chk_operacional_has_team check (role <> 'operacional' or team_id is not null)
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));

create table public.rondas (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  turno text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ronda_items (
  id uuid primary key default gen_random_uuid(),
  ronda_id uuid not null references public.rondas(id) on delete cascade,
  sub_place_id uuid not null references public.sub_places(id),
  photo_storage_path text,
  observation text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (ronda_id, sub_place_id)
);

create index idx_places_team on public.places(team_id);
create index idx_subplaces_place on public.sub_places(place_id);
create index idx_profiles_team on public.profiles(team_id);
create index idx_rondas_team on public.rondas(team_id);
create index idx_rondas_employee on public.rondas(employee_id);
create index idx_rondaitems_ronda on public.ronda_items(ronda_id);

-- ------------------------------------------------------------
-- FUNÇÕES AUXILIARES (security definer -> evitam recursão de RLS)
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active = true
  );
$$;

create or replace function public.current_team_id()
returns uuid
language sql security definer stable set search_path = public
as $$
  select team_id from public.profiles where id = auth.uid() and active = true;
$$;

-- ------------------------------------------------------------
-- GARANTIAS "DE VERDADE" (triggers, independentes de RLS/UI)
-- ------------------------------------------------------------

-- Bloqueia criar qualquer admin além de joao.belissimo, para sempre,
-- após o bootstrap inicial (permite role='admin' apenas se ainda não
-- existir nenhum admin, ou se for a própria linha do joao.belissimo).
create or replace function public.enforce_single_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'admin' then
    if exists (
      select 1 from public.profiles
      where role = 'admin' and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000')
    ) then
      raise exception 'Criar administradores adicionais não é permitido.';
    end if;
    if new.username <> 'joao.belissimo' then
      raise exception 'Somente a conta fixa joao.belissimo pode ter o papel de administrador.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_enforce_single_admin
before insert or update on public.profiles
for each row execute function public.enforce_single_admin();

-- Bloqueia excluir, renomear, rebaixar ou desativar joao.belissimo.
create or replace function public.protect_super_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if old.username = 'joao.belissimo' then
      raise exception 'A conta do super-admin não pode ser excluída.';
    end if;
    return old;
  end if;
  if old.username = 'joao.belissimo' then
    if new.username <> 'joao.belissimo' or new.role <> 'admin' or new.active is not true then
      raise exception 'A conta do super-admin não pode ser renomeada, rebaixada ou desativada.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_protect_super_admin
before update or delete on public.profiles
for each row execute function public.protect_super_admin();

-- Permite ao admin trocar a senha de um funcionário direto pelo app,
-- sem precisar da service_role key (usa pgcrypto, já habilitado pelo
-- próprio Supabase Auth).
create or replace function public.admin_reset_password(target_user_id uuid, new_password text)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem redefinir senhas.';
  end if;
  if length(new_password) < 6 then
    raise exception 'A senha precisa ter ao menos 6 caracteres.';
  end if;
  update auth.users
    set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf'))
    where id = target_user_id;
end;
$$;

-- Cria um funcionário (usuário + perfil operacional) direto no banco, já
-- confirmado — evita depender do fluxo público de cadastro do Supabase, que
-- exige e-mail de verdade e tentaria mandar e-mail de confirmação para
-- endereços que não pertencem a ninguém.
create or replace function public.admin_create_employee(
  p_username text, p_password text, p_full_name text, p_team_id uuid
)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_user_id uuid := gen_random_uuid();
  -- mesmo sufixo usado pelo app (FAKE_EMAIL_DOMAIN em config.js) para o login bater;
  -- nenhum e-mail é realmente enviado, pois este insert não passa pela API pública.
  v_email text := lower(p_username) || '@gmail.com';
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem cadastrar funcionários.';
  end if;
  if length(p_password) < 6 then
    raise exception 'A senha precisa ter ao menos 6 caracteres.';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false,
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user_id, v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  insert into public.profiles (id, username, full_name, role, team_id, active)
  values (v_user_id, lower(p_username), p_full_name, 'operacional', p_team_id, true);

  return v_user_id;
end;
$$;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.places enable row level security;
alter table public.sub_places enable row level security;
alter table public.profiles enable row level security;
alter table public.rondas enable row level security;
alter table public.ronda_items enable row level security;

-- TEAMS
create policy "admins full access to teams" on public.teams for all
  using (public.is_admin()) with check (public.is_admin());
create policy "operacional can read own team" on public.teams for select
  using (id = public.current_team_id());

-- PLACES
create policy "admins full access to places" on public.places for all
  using (public.is_admin()) with check (public.is_admin());
create policy "operacional can read own team places" on public.places for select
  using (team_id = public.current_team_id());

-- SUB_PLACES
create policy "admins full access to sub_places" on public.sub_places for all
  using (public.is_admin()) with check (public.is_admin());
create policy "operacional can read own team sub_places" on public.sub_places for select
  using (exists (
    select 1 from public.places p
    where p.id = sub_places.place_id and p.team_id = public.current_team_id()
  ));

-- PROFILES
create policy "admins full access to profiles" on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());
create policy "user can read own profile" on public.profiles for select
  using (id = auth.uid());

-- RONDAS
create policy "admins full access to rondas" on public.rondas for all
  using (public.is_admin()) with check (public.is_admin());
create policy "operacional read own team rondas" on public.rondas for select
  using (team_id = public.current_team_id());
create policy "operacional insert own rondas" on public.rondas for insert
  with check (employee_id = auth.uid() and team_id = public.current_team_id());
create policy "operacional update own rondas" on public.rondas for update
  using (employee_id = auth.uid() and team_id = public.current_team_id())
  with check (employee_id = auth.uid() and team_id = public.current_team_id());

-- RONDA_ITEMS
create policy "admins full access to ronda_items" on public.ronda_items for all
  using (public.is_admin()) with check (public.is_admin());
create policy "operacional read own team ronda_items" on public.ronda_items for select
  using (exists (
    select 1 from public.rondas r
    where r.id = ronda_items.ronda_id and r.team_id = public.current_team_id()
  ));
create policy "operacional insert own ronda_items" on public.ronda_items for insert
  with check (exists (
    select 1 from public.rondas r
    where r.id = ronda_items.ronda_id and r.employee_id = auth.uid()
  ));
create policy "operacional update own ronda_items" on public.ronda_items for update
  using (exists (
    select 1 from public.rondas r
    where r.id = ronda_items.ronda_id and r.employee_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.rondas r
    where r.id = ronda_items.ronda_id and r.employee_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- STORAGE (bucket de fotos)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ronda-photos', 'ronda-photos', false)
on conflict (id) do nothing;

-- Caminho do arquivo: {team_id}/{employee_id}/{ronda_id}/{sub_place_id}.jpg
create policy "admins read all ronda photos" on storage.objects for select
  using (bucket_id = 'ronda-photos' and public.is_admin());

-- Necessária para o arquivamento no Google Drive: só depois de confirmar
-- que o PDF chegou ao Drive, o app apaga a foto original daqui.
create policy "admins delete ronda photos" on storage.objects for delete
  using (bucket_id = 'ronda-photos' and public.is_admin());

create policy "operacional read own team ronda photos" on storage.objects for select
  using (
    bucket_id = 'ronda-photos'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

create policy "operacional upload own ronda photos" on storage.objects for insert
  with check (
    bucket_id = 'ronda-photos'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "operacional update own ronda photos" on storage.objects for update
  using (
    bucket_id = 'ronda-photos'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'ronda-photos'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ============================================================
-- Fim do schema. Próximos passos (fazer nesta ordem):
--   1) Rode este arquivo inteiro aqui no SQL Editor.
--   2) Rode o arquivo seed-areas.sql (cria a equipe "Rondista"
--      com as 43 áreas atuais).
--   3) Authentication > Providers > Email > desligue "Confirm email".
--   4) Authentication > Users > Add user:
--        email:  joao.belissimo@rondacb.internal
--        senha:  (a que você já me passou)
--      Depois de criado, copie o UUID mostrado na lista de usuários.
--   5) Rode, aqui no SQL Editor, colando o UUID copiado:
--
--      insert into public.profiles (id, username, full_name, role, team_id, active)
--      values ('COLE-O-UUID-AQUI', 'joao.belissimo', 'João Belissimo', 'admin', null, true)
--      on conflict (id) do update set role = 'admin', active = true;
--
--   6) Me mande a Project URL e a "anon public" key
--      (Project Settings > API) — nunca a service_role.
-- ============================================================
