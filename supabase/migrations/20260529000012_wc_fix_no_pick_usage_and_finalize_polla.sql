-- ============================================================
-- 2026-05-29 — Mundial 2026: 2 fixes P0 de agentes review
-- ============================================================
-- 1) Bug R-001 (agente 06): wc_resolve_survivor_match_day insertaba pick
--    virtual no_pick con team_id real, contaba como uso del equipo y
--    violaba la regla "max 2 veces". Fix: el contador en
--    wc_submit_survivor_pick ahora excluye picks con result='no_pick'.
--
-- 2) wc_admin_finalize_polla (agente 05): RPC mencionada en comments pero
--    no implementada. Cierra el torneo Polla: resuelve bonus_picks,
--    calcula ganador con tiebreakers (puntos → exactos → fase final →
--    marcador final → random), crea wc_payouts.
-- ────────────────────────────────────────────────────────────

-- 1) Fix bug R-001
create or replace function public.wc_submit_survivor_pick(
  p_user_id uuid, p_match_day_id uuid, p_team_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_match_day  public.wc_match_days%rowtype;
  v_match_id   uuid;
  v_team_uses  int;
  v_pick_id    uuid;
begin
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;
  select * into v_enrollment from public.wc_enrollments where user_id = p_user_id and mode = 'survivor';
  if not found then raise exception 'No estás inscrito al Survivor'; end if;
  if v_enrollment.payment_status <> 'paid' then raise exception 'Inscripción no pagada'; end if;
  if v_enrollment.lives_remaining <= 0 then raise exception 'Estás eliminado del Survivor'; end if;
  select * into v_match_day from public.wc_match_days where id = p_match_day_id;
  if not found then raise exception 'Jornada-día no encontrada'; end if;
  if v_match_day.phase <> 'group' then raise exception 'Survivor solo aplica a fase de grupos'; end if;
  if v_match_day.pick_deadline <= now() then
    raise exception 'Deadline cerrado (cerró: %)', v_match_day.pick_deadline;
  end if;
  if v_match_day.is_settled then raise exception 'Esta jornada ya fue resuelta'; end if;

  select id into v_match_id from public.wc_matches
    where match_day_id = p_match_day_id
      and (team_home_id = p_team_id or team_away_id = p_team_id) limit 1;
  if v_match_id is null then raise exception 'Ese equipo no juega en esta jornada'; end if;

  -- Excluye picks 'no_pick' (no son elecciones reales del user) del contador max 2 usos.
  select count(*) into v_team_uses
    from public.wc_picks p
    join public.wc_match_days md on p.match_day_id = md.id
    where p.enrollment_id = v_enrollment.id
      and p.team_id = p_team_id
      and p.match_day_id <> p_match_day_id
      and p.result <> 'no_pick'
      and md.phase = 'group';

  if v_team_uses >= 2 then raise exception 'Ya usaste este equipo 2 veces'; end if;

  insert into public.wc_picks (enrollment_id, match_day_id, team_id, match_id, result)
    values (v_enrollment.id, p_match_day_id, p_team_id, v_match_id, 'pending')
    on conflict (enrollment_id, match_day_id) do update set
      team_id=excluded.team_id, match_id=excluded.match_id, result='pending',
      life_lost=false, resolved_at=null
    returning id into v_pick_id;

  return v_pick_id;
end;
$$;

revoke execute on function public.wc_submit_survivor_pick(uuid, uuid, uuid) from public, anon;
grant execute on function public.wc_submit_survivor_pick(uuid, uuid, uuid) to authenticated;

-- 2) Finalize Polla: cierre del torneo
create or replace function public.wc_admin_finalize_polla(
  p_actual_champion_team_id    uuid,
  p_actual_runner_up_team_id   uuid,
  p_actual_third_place_team_id uuid,
  p_actual_top_scorer_name     text,
  p_actual_mvp_name            text,
  p_actual_final_score_home    int,
  p_actual_final_score_away    int
) returns table (winner_user_id uuid, winner_enrollment_id uuid, total_points numeric, prize numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_role         text;
  v_pool         public.wc_pools%rowtype;
  v_total_paid   int;
  v_pozo_total   numeric;
  v_bp           record;
  v_pts          numeric;
  v_winner_eid   uuid;
  v_winner_uid   uuid;
  v_winner_pts   numeric;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from public.users where auth_id = (select auth.uid());
    if v_role <> 'admin' then raise exception 'unauthorized: only admin'; end if;
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026' for update;

  for v_bp in
    select b.*, e.id as e_id from public.wc_bonus_picks b
    join public.wc_enrollments e on b.enrollment_id = e.id
    where e.mode = 'polla' and e.payment_status = 'paid'
  loop
    v_pts := 0;
    update public.wc_bonus_picks set champion_correct = (champion_team_id = p_actual_champion_team_id) where id = v_bp.id;
    if v_bp.champion_team_id = p_actual_champion_team_id then v_pts := v_pts + 50; end if;
    update public.wc_bonus_picks set runner_up_correct = (runner_up_team_id = p_actual_runner_up_team_id) where id = v_bp.id;
    if v_bp.runner_up_team_id = p_actual_runner_up_team_id then v_pts := v_pts + 30; end if;
    update public.wc_bonus_picks set third_place_correct = (third_place_team_id = p_actual_third_place_team_id) where id = v_bp.id;
    if v_bp.third_place_team_id = p_actual_third_place_team_id then v_pts := v_pts + 20; end if;
    update public.wc_bonus_picks set top_scorer_correct =
      (lower(trim(top_scorer_name)) = lower(trim(p_actual_top_scorer_name))) where id = v_bp.id;
    if lower(trim(v_bp.top_scorer_name)) = lower(trim(p_actual_top_scorer_name)) then v_pts := v_pts + 25; end if;
    update public.wc_bonus_picks set mvp_correct =
      (lower(trim(mvp_name)) = lower(trim(p_actual_mvp_name))) where id = v_bp.id;
    if lower(trim(v_bp.mvp_name)) = lower(trim(p_actual_mvp_name)) then v_pts := v_pts + 15; end if;
    update public.wc_bonus_picks set points_earned = v_pts, resolved_at = now() where id = v_bp.id;
    update public.wc_enrollments
      set bonus_points = v_pts, total_points = coalesce(match_points, 0) + v_pts
      where id = v_bp.e_id;
  end loop;

  with ranked as (
    select e.id as enrollment_id, e.user_id, e.total_points,
      (select count(*) from public.wc_predictions p where p.enrollment_id = e.id and p.hit_level = 'exact') as exact_count,
      (select coalesce(sum(p.points_earned),0) from public.wc_predictions p
       join public.wc_matches m on p.match_id = m.id
       where p.enrollment_id = e.id and m.phase in ('semi','third_place','final')) as final_phase_pts,
      (select coalesce(abs(bp.final_score_home - p_actual_final_score_home) +
                       abs(bp.final_score_away - p_actual_final_score_away), 99)
       from public.wc_bonus_picks bp where bp.enrollment_id = e.id) as final_score_diff
    from public.wc_enrollments e
    where e.mode = 'polla' and e.payment_status = 'paid'
  )
  select enrollment_id, user_id, total_points into v_winner_eid, v_winner_uid, v_winner_pts
  from ranked
  order by total_points desc, exact_count desc, final_phase_pts desc, final_score_diff asc, random() limit 1;

  if v_winner_eid is null then raise exception 'No hay ganador (sin inscritos pagados)'; end if;

  select count(*) into v_total_paid from public.wc_enrollments where mode = 'polla' and payment_status = 'paid';
  v_pozo_total := v_total_paid * v_pool.polla_price * (1 - v_pool.fee_rate);

  update public.wc_enrollments
    set is_winner = true, rank_position = 1, prize_amount = v_pozo_total
    where id = v_winner_eid;

  insert into public.wc_payouts (enrollment_id, user_id, pool_mode, amount, payment_method, status, notes)
    select v_winner_eid, v_winner_uid, 'polla', v_pozo_total, 'bank_transfer', 'pending',
           'Premio Polla Mundial 2026 — ganador único'
    where not exists (
      select 1 from public.wc_payouts where enrollment_id = v_winner_eid and pool_mode = 'polla'
    );

  return query select v_winner_uid, v_winner_eid, v_winner_pts, v_pozo_total;
end;
$$;

revoke execute on function public.wc_admin_finalize_polla(uuid, uuid, uuid, text, text, int, int) from public, anon;
grant execute on function public.wc_admin_finalize_polla(uuid, uuid, uuid, text, text, int, int) to authenticated;
