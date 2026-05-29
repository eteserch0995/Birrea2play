-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: inscripciones, picks y resultados
-- ============================================================
-- Tablas para que los users participen del torneo.
--
-- wc_enrollments   — inscripción del user a un modo (survivor|polla)
-- wc_picks         — pick del Survivor por jornada-día
-- wc_predictions   — predicción de la Polla por partido (104 partidos)
-- wc_bonus_picks   — 5 bonus picks pre-temporada (obligatorios para Polla)
-- wc_results       — cache de resultados desde api-football (con override admin)
-- wc_payouts       — registro de payouts realizados al ganador
--
-- Política de escritura: INSERT/UPDATE directo desde el cliente NO permitido.
-- Cliente llama a RPCs SECURITY DEFINER que validan deadline y reglas (migración
-- 20260529000003_wc_rpcs.sql). RLS deja la escritura solo a service_role.
-- ────────────────────────────────────────────────────────────

-- 1) wc_enrollments — inscripción a un modo
create table if not exists public.wc_enrollments (
  id                          uuid primary key default uuid_generate_v4(),
  user_id                     uuid not null references public.users(id) on delete cascade,
  mode                        text not null check (mode in ('survivor','polla')),
  paid_amount                 numeric(10,2) not null,
  payment_method              text not null check (payment_method in ('yappy','wallet','admin_grant')),
  payment_ref                 text,
  payment_status              text not null default 'pending'
                              check (payment_status in ('pending','paid','failed','refunded')),
  paid_at                     timestamptz,
  lives_remaining             int not null default 3 check (lives_remaining between 0 and 3),
  eliminated_at_match_day_id  uuid references public.wc_match_days(id) on delete set null,
  eliminated_at               timestamptz,
  total_points                numeric(10,2) not null default 0,
  bonus_points                numeric(10,2) not null default 0,
  match_points                numeric(10,2) not null default 0,
  rank_position               int,
  is_winner                   boolean not null default false,
  prize_amount                numeric(10,2),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (user_id, mode)
);

create index if not exists idx_wc_enrollments_user   on public.wc_enrollments(user_id);
create index if not exists idx_wc_enrollments_mode   on public.wc_enrollments(mode);
create index if not exists idx_wc_enrollments_status on public.wc_enrollments(payment_status);
create index if not exists idx_wc_enrollments_points on public.wc_enrollments(total_points desc)
  where mode = 'polla' and payment_status = 'paid';
create index if not exists idx_wc_enrollments_lives  on public.wc_enrollments(lives_remaining desc, eliminated_at_match_day_id)
  where mode = 'survivor' and payment_status = 'paid';

-- 2) wc_picks — pick del Survivor por jornada-día
create table if not exists public.wc_picks (
  id                uuid primary key default uuid_generate_v4(),
  enrollment_id     uuid not null references public.wc_enrollments(id) on delete cascade,
  match_day_id      uuid not null references public.wc_match_days(id) on delete restrict,
  team_id           uuid not null references public.wc_teams(id) on delete restrict,
  match_id          uuid not null references public.wc_matches(id) on delete restrict,
  result            text not null default 'pending'
                    check (result in ('pending','won','draw','lost','no_pick')),
  life_lost         boolean not null default false,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (enrollment_id, match_day_id)
);

create index if not exists idx_wc_picks_enrollment on public.wc_picks(enrollment_id);
create index if not exists idx_wc_picks_day        on public.wc_picks(match_day_id);
create index if not exists idx_wc_picks_team       on public.wc_picks(team_id);
create index if not exists idx_wc_picks_result     on public.wc_picks(result);

-- 3) wc_predictions — predicción de la Polla por partido
create table if not exists public.wc_predictions (
  id                uuid primary key default uuid_generate_v4(),
  enrollment_id     uuid not null references public.wc_enrollments(id) on delete cascade,
  match_id          uuid not null references public.wc_matches(id) on delete restrict,
  pred_score_home   int not null check (pred_score_home >= 0 and pred_score_home <= 20),
  pred_score_away   int not null check (pred_score_away >= 0 and pred_score_away <= 20),
  hit_level         text check (hit_level in ('miss','winner','winner_diff','exact')),
  points_earned     numeric(10,2) not null default 0,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (enrollment_id, match_id)
);

create index if not exists idx_wc_predictions_enrollment on public.wc_predictions(enrollment_id);
create index if not exists idx_wc_predictions_match      on public.wc_predictions(match_id);
create index if not exists idx_wc_predictions_hit        on public.wc_predictions(hit_level)
  where hit_level is not null;

-- 4) wc_bonus_picks — bonus pre-temporada de Polla (obligatorios)
create table if not exists public.wc_bonus_picks (
  id                    uuid primary key default uuid_generate_v4(),
  enrollment_id         uuid not null unique references public.wc_enrollments(id) on delete cascade,
  champion_team_id      uuid not null references public.wc_teams(id) on delete restrict,
  runner_up_team_id     uuid not null references public.wc_teams(id) on delete restrict,
  third_place_team_id   uuid not null references public.wc_teams(id) on delete restrict,
  top_scorer_name       text not null,
  top_scorer_player_id  int,
  mvp_name              text not null,
  mvp_player_id         int,
  final_score_home      int not null check (final_score_home >= 0 and final_score_home <= 20),
  final_score_away      int not null check (final_score_away >= 0 and final_score_away <= 20),
  champion_correct      boolean,
  runner_up_correct     boolean,
  third_place_correct   boolean,
  top_scorer_correct    boolean,
  mvp_correct           boolean,
  points_earned         numeric(10,2) not null default 0,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_wc_bonus_enrollment on public.wc_bonus_picks(enrollment_id);

-- 5) wc_results — cache de resultados desde api-football (con override admin)
create table if not exists public.wc_results (
  id                      uuid primary key default uuid_generate_v4(),
  match_id                uuid not null unique references public.wc_matches(id) on delete cascade,
  api_score_home          int,
  api_score_away          int,
  api_penalties_home      int,
  api_penalties_away      int,
  api_status              text,
  api_fetched_at          timestamptz,
  api_raw                 jsonb,
  admin_override          boolean not null default false,
  admin_override_by       uuid references public.users(id) on delete set null,
  admin_override_at       timestamptz,
  admin_score_home        int,
  admin_score_away        int,
  admin_penalties_home    int,
  admin_penalties_away    int,
  admin_notes             text,
  effective_score_home    int generated always as (coalesce(admin_score_home, api_score_home)) stored,
  effective_score_away    int generated always as (coalesce(admin_score_away, api_score_away)) stored,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists idx_wc_results_match on public.wc_results(match_id);
create index if not exists idx_wc_results_override on public.wc_results(admin_override) where admin_override = true;

-- 6) wc_payouts — registro de payouts realizados
create table if not exists public.wc_payouts (
  id                uuid primary key default uuid_generate_v4(),
  enrollment_id     uuid not null references public.wc_enrollments(id) on delete restrict,
  user_id           uuid not null references public.users(id) on delete restrict,
  pool_mode         text not null check (pool_mode in ('survivor','polla')),
  amount            numeric(10,2) not null check (amount > 0),
  payment_method    text not null check (payment_method in ('yappy','bank_transfer','wallet_credit','other')),
  payment_ref       text,
  status            text not null default 'pending'
                    check (status in ('pending','paid','failed','cancelled')),
  paid_at           timestamptz,
  paid_by           uuid references public.users(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_wc_payouts_enrollment on public.wc_payouts(enrollment_id);
create index if not exists idx_wc_payouts_user       on public.wc_payouts(user_id);
create index if not exists idx_wc_payouts_status     on public.wc_payouts(status);

-- 7) RLS
alter table public.wc_enrollments enable row level security;
alter table public.wc_picks       enable row level security;
alter table public.wc_predictions enable row level security;
alter table public.wc_bonus_picks enable row level security;
alter table public.wc_results     enable row level security;
alter table public.wc_payouts     enable row level security;

-- Helper: id del user actual desde auth.uid()
-- (lo usamos en múltiples policies, mantenemos como subselect cacheable)

-- ── wc_enrollments ─────────────────────────────────────────
drop policy if exists "WC enrollments: select own or admin" on public.wc_enrollments;
create policy "WC enrollments: select own or admin" on public.wc_enrollments for select
  to authenticated
  using (
    user_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- INSERT/UPDATE solo service_role (vía RPCs). Cliente NO inserta directo.

-- ── wc_picks ───────────────────────────────────────────────
drop policy if exists "WC picks: select own or admin" on public.wc_picks;
create policy "WC picks: select own or admin" on public.wc_picks for select
  to authenticated
  using (
    enrollment_id in (
      select id from public.wc_enrollments
      where user_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- ── wc_predictions ─────────────────────────────────────────
drop policy if exists "WC predictions: select own or admin" on public.wc_predictions;
create policy "WC predictions: select own or admin" on public.wc_predictions for select
  to authenticated
  using (
    enrollment_id in (
      select id from public.wc_enrollments
      where user_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- Visibilidad pública de predicciones de partidos YA finalizados (para transparencia/ranking).
-- Opcional: comentar si Sergio prefiere mantenerlas privadas siempre.
drop policy if exists "WC predictions: select resolved public" on public.wc_predictions;
create policy "WC predictions: select resolved public" on public.wc_predictions for select
  to authenticated
  using (
    resolved_at is not null
    and match_id in (select id from public.wc_matches where status = 'finished')
  );

-- ── wc_bonus_picks ─────────────────────────────────────────
drop policy if exists "WC bonus_picks: select own or admin" on public.wc_bonus_picks;
create policy "WC bonus_picks: select own or admin" on public.wc_bonus_picks for select
  to authenticated
  using (
    enrollment_id in (
      select id from public.wc_enrollments
      where user_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- ── wc_results ─────────────────────────────────────────────
-- Lectura pública (cualquier authenticated puede ver resultados oficiales)
drop policy if exists "WC results: select all" on public.wc_results;
create policy "WC results: select all" on public.wc_results for select
  to anon, authenticated
  using (true);

-- Write solo admin
drop policy if exists "WC results: write admin" on public.wc_results;
create policy "WC results: write admin" on public.wc_results for all
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- ── wc_payouts ─────────────────────────────────────────────
drop policy if exists "WC payouts: select own or admin" on public.wc_payouts;
create policy "WC payouts: select own or admin" on public.wc_payouts for select
  to authenticated
  using (
    user_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

drop policy if exists "WC payouts: write admin" on public.wc_payouts;
create policy "WC payouts: write admin" on public.wc_payouts for all
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  with check ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- 8) Triggers updated_at (reusan public.update_updated_at())
drop trigger if exists trg_wc_enrollments_updated on public.wc_enrollments;
create trigger trg_wc_enrollments_updated before update on public.wc_enrollments
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_picks_updated on public.wc_picks;
create trigger trg_wc_picks_updated before update on public.wc_picks
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_predictions_updated on public.wc_predictions;
create trigger trg_wc_predictions_updated before update on public.wc_predictions
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_bonus_picks_updated on public.wc_bonus_picks;
create trigger trg_wc_bonus_picks_updated before update on public.wc_bonus_picks
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_results_updated on public.wc_results;
create trigger trg_wc_results_updated before update on public.wc_results
  for each row execute function public.update_updated_at();

drop trigger if exists trg_wc_payouts_updated on public.wc_payouts;
create trigger trg_wc_payouts_updated before update on public.wc_payouts
  for each row execute function public.update_updated_at();

-- 9) Comentarios
comment on table  public.wc_enrollments is 'Inscripción de un user a un modo del Mundial. UNIQUE(user_id, mode) — un user, una inscripción por modo.';
comment on table  public.wc_picks       is 'Pick de Survivor por jornada-día. Un pick por user por día. Cliente NO inserta directo: usa RPC submit_survivor_pick.';
comment on table  public.wc_predictions is 'Predicción de Polla por partido. Cliente NO inserta directo: usa RPC submit_polla_prediction.';
comment on table  public.wc_bonus_picks is '5 bonus pre-temporada de Polla (campeón/sub/3°/goleador/MVP) + final_score para tiebreaker. Obligatorios al inscribirse.';
comment on table  public.wc_results     is 'Cache de resultados desde api-football. Admin puede override; effective_score_* es el score efectivo.';
comment on table  public.wc_payouts     is 'Registro de payouts manuales al ganador. Admin crea filas al cerrar el torneo.';
