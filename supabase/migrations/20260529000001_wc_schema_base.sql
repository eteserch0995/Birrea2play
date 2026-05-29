-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: schema base
-- ============================================================
-- Sub-app temporal de pronósticos para FIFA World Cup 2026.
-- Esta migración crea las tablas base del torneo (sin inscripciones
-- de usuarios todavía — eso va en la migración siguiente).
--
-- Visibilidad inicial: oculta (wc_pools.is_visible = false).
-- Solo role='admin' verá el módulo hasta que se active el flag.
--
-- Tablas:
--   wc_pools       — configuración global del torneo (una fila)
--   wc_teams       — los 48 equipos clasificados
--   wc_match_days  — jornadas-día (agrupa partidos del mismo día)
--   wc_matches     — los 104 partidos del Mundial
--
-- Seed de teams + matches: NO en esta migración. Se carga desde
-- la edge function `wc-sync-results` consumiendo api-football, o
-- desde el admin panel manualmente.
-- ────────────────────────────────────────────────────────────

-- 1) wc_pools — configuración global del torneo
create table if not exists public.wc_pools (
  id                    uuid primary key default uuid_generate_v4(),
  season                text not null unique default 'fifa_wc_2026',
  survivor_price        numeric(10,2) not null default 10,
  polla_price           numeric(10,2) not null default 15,
  fee_rate              numeric(5,4)  not null default 0.05,
  enrollment_deadline   timestamptz not null,
  is_visible            boolean not null default false,
  survivor_open         boolean not null default true,
  polla_open            boolean not null default true,
  survivor_winners_paid boolean not null default false,
  polla_winners_paid    boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Fila inicial: deadline = 11-jun-2026 10:00 GMT-5 (15:00 UTC), antes del 1er partido
insert into public.wc_pools (season, enrollment_deadline, is_visible)
  values ('fifa_wc_2026', '2026-06-11 15:00:00+00', false)
  on conflict (season) do nothing;

-- 2) wc_teams — los 48 equipos clasificados al Mundial
create table if not exists public.wc_teams (
  id                uuid primary key default uuid_generate_v4(),
  api_football_id   int unique,
  code              text not null unique,
  name              text not null,
  name_es           text,
  group_letter      text not null check (group_letter ~ '^[A-L]$'),
  flag_url          text,
  is_host           boolean not null default false,
  confederation     text check (confederation in ('UEFA','CONMEBOL','CONCACAF','CAF','AFC','OFC')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_wc_teams_group on public.wc_teams(group_letter);
create index if not exists idx_wc_teams_api on public.wc_teams(api_football_id);
create index if not exists idx_wc_teams_code on public.wc_teams(code);

-- 3) wc_match_days — jornadas-día (un día calendario en hora Panamá GMT-5)
create table if not exists public.wc_match_days (
  id                 uuid primary key default uuid_generate_v4(),
  date               date not null unique,
  first_kickoff_at   timestamptz not null,
  pick_deadline      timestamptz not null,
  phase              text not null check (phase in ('group','round_32','round_16','quarter','semi','third_place','final')),
  is_settled         boolean not null default false,
  settled_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_pick_deadline_before_kickoff check (pick_deadline < first_kickoff_at)
);

create index if not exists idx_wc_match_days_date on public.wc_match_days(date);
create index if not exists idx_wc_match_days_phase on public.wc_match_days(phase);
create index if not exists idx_wc_match_days_deadline on public.wc_match_days(pick_deadline);

-- 4) wc_matches — los 104 partidos
create table if not exists public.wc_matches (
  id                    uuid primary key default uuid_generate_v4(),
  api_football_id       int unique,
  match_number          int unique,
  phase                 text not null check (phase in ('group','round_32','round_16','quarter','semi','third_place','final')),
  group_letter          text check (group_letter ~ '^[A-L]$'),
  match_day_id          uuid not null references public.wc_match_days(id) on delete restrict,
  scheduled_at          timestamptz not null,
  prediction_deadline   timestamptz not null,
  team_home_id          uuid references public.wc_teams(id) on delete restrict,
  team_away_id          uuid references public.wc_teams(id) on delete restrict,
  home_placeholder      text,
  away_placeholder      text,
  score_home            int check (score_home >= 0),
  score_away            int check (score_away >= 0),
  penalties_home        int check (penalties_home >= 0),
  penalties_away        int check (penalties_away >= 0),
  went_to_penalties     boolean not null default false,
  status                text not null default 'scheduled'
                        check (status in ('scheduled','live','finished','postponed','cancelled')),
  multiplier            numeric(3,1) not null default 1.0,
  venue                 text,
  city                  text,
  country               text check (country in ('USA','Mexico','Canada') or country is null),
  is_resolved           boolean not null default false,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_group_only_in_group_phase check (
    (phase = 'group' and group_letter is not null) or
    (phase <> 'group' and group_letter is null)
  ),
  constraint chk_teams_or_placeholder check (
    (team_home_id is not null and team_away_id is not null) or
    (home_placeholder is not null and away_placeholder is not null)
  ),
  constraint chk_prediction_deadline_before_kickoff check (prediction_deadline < scheduled_at),
  constraint chk_score_consistency check (
    (status in ('finished') and score_home is not null and score_away is not null) or
    (status not in ('finished'))
  ),
  constraint chk_penalties_consistency check (
    (went_to_penalties = false and penalties_home is null and penalties_away is null) or
    (went_to_penalties = true  and penalties_home is not null and penalties_away is not null)
  )
);

create index if not exists idx_wc_matches_phase on public.wc_matches(phase);
create index if not exists idx_wc_matches_day on public.wc_matches(match_day_id);
create index if not exists idx_wc_matches_scheduled on public.wc_matches(scheduled_at);
create index if not exists idx_wc_matches_status on public.wc_matches(status);
create index if not exists idx_wc_matches_home on public.wc_matches(team_home_id) where team_home_id is not null;
create index if not exists idx_wc_matches_away on public.wc_matches(team_away_id) where team_away_id is not null;
create index if not exists idx_wc_matches_api on public.wc_matches(api_football_id);
create index if not exists idx_wc_matches_resolved on public.wc_matches(is_resolved, status);

-- 5) RLS — datos públicos del torneo (cualquiera autenticado o anon puede leer).
--    Solo admin/service_role puede modificar (la edge fn corre como service_role).
alter table public.wc_pools     enable row level security;
alter table public.wc_teams     enable row level security;
alter table public.wc_match_days enable row level security;
alter table public.wc_matches   enable row level security;

-- wc_pools
drop policy if exists "WC pools: select" on public.wc_pools;
create policy "WC pools: select" on public.wc_pools for select
  to anon, authenticated
  using (true);

drop policy if exists "WC pools: update admin" on public.wc_pools;
create policy "WC pools: update admin" on public.wc_pools for update
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- wc_teams
drop policy if exists "WC teams: select" on public.wc_teams;
create policy "WC teams: select" on public.wc_teams for select
  to anon, authenticated
  using (true);

drop policy if exists "WC teams: write admin" on public.wc_teams;
create policy "WC teams: write admin" on public.wc_teams for all
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- wc_match_days
drop policy if exists "WC match_days: select" on public.wc_match_days;
create policy "WC match_days: select" on public.wc_match_days for select
  to anon, authenticated
  using (true);

drop policy if exists "WC match_days: write admin" on public.wc_match_days;
create policy "WC match_days: write admin" on public.wc_match_days for all
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- wc_matches
drop policy if exists "WC matches: select" on public.wc_matches;
create policy "WC matches: select" on public.wc_matches for select
  to anon, authenticated
  using (true);

drop policy if exists "WC matches: write admin" on public.wc_matches;
create policy "WC matches: write admin" on public.wc_matches for all
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- 6) Triggers updated_at (reusan public.update_updated_at() ya existente)
drop trigger if exists trg_wc_pools_updated on public.wc_pools;
create trigger trg_wc_pools_updated before update on public.wc_pools
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_match_days_updated on public.wc_match_days;
create trigger trg_wc_match_days_updated before update on public.wc_match_days
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_matches_updated on public.wc_matches;
create trigger trg_wc_matches_updated before update on public.wc_matches
  for each row execute function public.update_updated_at();

-- 7) Comentarios para documentación
comment on table  public.wc_pools     is 'Configuración global del torneo Mundial 2026 (una fila por season).';
comment on column public.wc_pools.is_visible is 'Si false, solo role=admin ve el módulo. Activar manualmente cuando se lance.';
comment on table  public.wc_teams     is '48 equipos clasificados al FIFA WC 2026, agrupados en A..L.';
comment on table  public.wc_match_days is 'Jornadas-día: agrupa partidos del mismo día calendario Panamá (GMT-5). Pick deadline = 1h antes del primer kickoff.';
comment on table  public.wc_matches   is 'Los 104 partidos del Mundial 2026 (72 grupos + 32 eliminatoria). Multiplier por fase.';
comment on column public.wc_matches.multiplier is 'Grupos=1.0, R32=1.5, R16=2.0, Cuartos=2.5, Semis=3.0, Final/3rd=4.0';
