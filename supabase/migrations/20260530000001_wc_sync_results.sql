-- ============================================================
-- 2026-05-30 — Mundial 2026: sync de resultados (api-football)
-- ============================================================
-- Infra para automatizar la carga de resultados desde api-football.
-- Hasta hoy el unico camino era el override manual del admin
-- (wc_admin_override_match_result). Esta migracion agrega el camino
-- automatico que usa la edge function `wc-sync-results`:
--
--   wc_sync_apply_match_result  — service_role only. Aplica un resultado
--      del API a un partido: cachea api_* en wc_results, RESPETA el
--      override del admin, setea el marcador en wc_matches y DELEGA en
--      los resolvers vivos (wc_resolve_polla_match + wc_resolve_survivor
--      _match_day). Es un wrapper fino: no reimplementa el scoring, asi
--      que es inmune a cambios futuros en las reglas (max 1 uso, empate
--      pierde vida, bracket KO, etc.).
--
--   wc_sync_logs                — observabilidad de cada corrida del cron.
--
-- Scheduler: pg_cron + pg_net (plantilla comentada al final). Se activa
-- recien cuando la edge function este deployada y exista el secret.
--
-- Patron caller validation: [[feedback-rls-security-definer-caller-check]]
-- ------------------------------------------------------------

-- ============================================================
-- 1) Tabla de logs de sincronizacion
-- ============================================================
create table if not exists public.wc_sync_logs (
  id                     uuid primary key default uuid_generate_v4(),
  source                 text not null default 'cron'
                         check (source in ('cron','manual','backfill')),
  fixtures_seen          int  not null default 0,
  matches_matched        int  not null default 0,
  matches_finished       int  not null default 0,
  polla_predictions      int  not null default 0,
  survivor_days_settled  int  not null default 0,
  errors                 int  not null default 0,
  detail                 jsonb,
  duration_ms            int,
  created_at             timestamptz not null default now()
);

create index if not exists idx_wc_sync_logs_created on public.wc_sync_logs(created_at desc);

alter table public.wc_sync_logs enable row level security;

-- Lectura solo admin (service_role bypassa RLS para los INSERT del cron).
drop policy if exists "WC sync_logs: select admin" on public.wc_sync_logs;
create policy "WC sync_logs: select admin" on public.wc_sync_logs for select
  to authenticated
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

comment on table public.wc_sync_logs is
  'Bitacora de cada corrida del sync de resultados api-football (edge fn wc-sync-results). Lectura solo admin.';

-- ============================================================
-- 2) RPC: aplicar resultado del API a un partido
-- ============================================================
-- p_new_status ya viene NORMALIZADO al enum interno desde la edge function
-- (la edge fn traduce FT/AET/PEN -> finished, etc.). p_api_status guarda
-- el codigo crudo del API para auditoria.
create or replace function public.wc_sync_apply_match_result(
  p_match_id        uuid,
  p_new_status      text,
  p_api_status      text         default null,
  p_score_home      int          default null,
  p_score_away      int          default null,
  p_penalties_home  int          default null,
  p_penalties_away  int          default null,
  p_api_raw         jsonb        default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match        public.wc_matches%rowtype;
  v_res          public.wc_results%rowtype;
  v_was_finished boolean;
  v_pen_h        int := p_penalties_home;
  v_pen_a        int := p_penalties_away;
  v_polla        int := 0;
  v_surv         int := null;
  v_all_done     boolean := false;
  v_changed      boolean := false;
begin
  -- Solo el cron / backfill (service_role). NUNCA un cliente.
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized: wc_sync_apply_match_result solo service_role';
  end if;

  if p_new_status not in ('scheduled','live','finished','postponed','cancelled') then
    raise exception 'estado normalizado invalido: %', p_new_status;
  end if;

  select * into v_match from public.wc_matches where id = p_match_id for update;
  if not found then
    raise exception 'Partido % no encontrado', p_match_id;
  end if;
  v_was_finished := (v_match.status = 'finished');

  -- Penales: ambos o ninguno (chk_penalties_consistency).
  if v_pen_h is null or v_pen_a is null then
    v_pen_h := null;
    v_pen_a := null;
  end if;

  -- 1) Cache de api_* en wc_results (NO toca columnas admin_*).
  insert into public.wc_results (
    match_id, api_score_home, api_score_away,
    api_penalties_home, api_penalties_away, api_status, api_fetched_at, api_raw
  ) values (
    p_match_id, p_score_home, p_score_away,
    v_pen_h, v_pen_a, p_api_status, now(), p_api_raw
  )
  on conflict (match_id) do update set
    api_score_home     = excluded.api_score_home,
    api_score_away     = excluded.api_score_away,
    api_penalties_home = excluded.api_penalties_home,
    api_penalties_away = excluded.api_penalties_away,
    api_status         = excluded.api_status,
    api_fetched_at     = excluded.api_fetched_at,
    api_raw            = excluded.api_raw;

  select * into v_res from public.wc_results where match_id = p_match_id;

  -- 2) Si el admin ya hizo override, SU marcador manda. Solo refrescamos
  --    el cache del API y salimos (el override ya disparo su cascada).
  if v_res.admin_override then
    return jsonb_build_object(
      'match_id',         p_match_id,
      'action',           'cache_only_admin_override',
      'polla_resolved',   0,
      'survivor_settled', false
    );
  end if;

  -- 3) Aplicar a wc_matches segun estado normalizado.
  if p_new_status = 'finished' then
    if p_score_home is null or p_score_away is null then
      return jsonb_build_object(
        'match_id',         p_match_id,
        'action',           'skipped_finished_without_score',
        'polla_resolved',   0,
        'survivor_settled', false
      );
    end if;

    update public.wc_matches set
      score_home        = p_score_home,
      score_away        = p_score_away,
      penalties_home    = v_pen_h,
      penalties_away    = v_pen_a,
      went_to_penalties = (v_pen_h is not null),
      status            = 'finished',
      is_resolved       = true,
      resolved_at       = now()
    where id = p_match_id;
    v_changed := true;

    -- Cascada Polla (idempotente: recalcula puntos de este partido).
    v_polla := public.wc_resolve_polla_match(p_match_id);

    -- Cascada Survivor: solo grupos y solo si TODOS los del dia terminaron.
    if v_match.phase = 'group' then
      select not exists (
        select 1 from public.wc_matches
        where match_day_id = v_match.match_day_id and status <> 'finished'
      ) into v_all_done;

      if v_all_done then
        v_surv := public.wc_resolve_survivor_match_day(v_match.match_day_id);
      end if;
    end if;

  elsif p_new_status in ('live','scheduled') then
    -- No degradar un partido ya finalizado (override o sync previo) por un
    -- 'live'/'scheduled' tardio del API.
    if not v_was_finished then
      update public.wc_matches set status = p_new_status where id = p_match_id;
      v_changed := true;
    end if;

  elsif p_new_status in ('postponed','cancelled') then
    if not v_was_finished then
      update public.wc_matches set status = p_new_status where id = p_match_id;
      v_changed := true;
    end if;
  end if;

  return jsonb_build_object(
    'match_id',           p_match_id,
    'action',             case when p_new_status = 'finished'
                               then 'finished_applied'
                               else 'status_' || p_new_status end,
    'changed',            v_changed,
    'polla_resolved',     coalesce(v_polla, 0),
    'survivor_settled',   (v_surv is not null),
    'survivor_processed', coalesce(v_surv, 0),
    'all_day_finished',   v_all_done
  );
end;
$$;

revoke execute on function public.wc_sync_apply_match_result(uuid, text, text, int, int, int, int, jsonb) from public, anon, authenticated;
grant  execute on function public.wc_sync_apply_match_result(uuid, text, text, int, int, int, int, jsonb) to service_role;

comment on function public.wc_sync_apply_match_result(uuid, text, text, int, int, int, int, jsonb) is
  'Aplica un resultado de api-football a un partido. Wrapper fino: respeta admin_override y delega scoring en wc_resolve_polla_match + wc_resolve_survivor_match_day. Solo service_role (edge fn wc-sync-results).';

-- ============================================================
-- 3) Scheduler — pg_cron + pg_net (PLANTILLA, activar tras deploy)
-- ============================================================
-- NO se activa en esta migracion: requiere la edge function ya deployada,
-- el secret WC_SYNC_SECRET creado, y las extensiones habilitadas.
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
-- Ventana de partidos (cada 5 min). El secret va en el header; el RPC se
-- invoca DESDE la edge function, no directo desde cron.
--
--   select cron.schedule(
--     'wc-sync-results-5min',
--     '*/5 * * * *',
--     $cron$
--       select net.http_post(
--         url     := 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/wc-sync-results',
--         headers := jsonb_build_object(
--                      'Content-Type', 'application/json',
--                      'x-sync-secret', current_setting('app.wc_sync_secret', true)
--                    ),
--         body    := jsonb_build_object('source', 'cron')
--       );
--     $cron$
--   );
--
-- Para apagar fuera de temporada:  select cron.unschedule('wc-sync-results-5min');
-- ------------------------------------------------------------
