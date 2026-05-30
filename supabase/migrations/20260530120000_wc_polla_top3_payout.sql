-- ============================================================
-- 2026-05-30 — Polla Mundialista: premio a TOP 3 (60 / 25 / 15 del pozo neto)
-- Reemplaza wc_admin_finalize_polla (antes: ganador unico / winner-takes-all).
--
-- Pozo neto = inscritos_polla_pagados * polla_price * (1 - fee_rate).
-- Reparto del pozo neto:
--   3+ inscritos: 1o 60%  ·  2o 25%  ·  3o 15%
--   2 inscritos : 1o 70%  ·  2o 30%
--   1 inscrito  : 1o 100%
-- (El pozo siempre se reparte entero; el 1er lugar absorbe el redondeo.)
--
-- Re-ejecutable: borra payouts 'pending' de polla y recalcula; respeta los 'paid'.
-- Cambia la firma de retorno (ahora devuelve hasta 3 filas con rank_position).
-- ============================================================

drop function if exists public.wc_admin_finalize_polla(uuid, uuid, uuid, text, text, int, int);

create function public.wc_admin_finalize_polla(
  p_actual_champion_team_id    uuid,
  p_actual_runner_up_team_id   uuid,
  p_actual_third_place_team_id uuid,
  p_actual_top_scorer_name     text,
  p_actual_mvp_name            text,
  p_actual_final_score_home    int,
  p_actual_final_score_away    int
) returns table (
  rank_position        int,
  winner_user_id       uuid,
  winner_enrollment_id uuid,
  total_points         numeric,
  prize                numeric,
  prize_pct            int
)
language plpgsql security definer set search_path = public as $$
declare
  v_role       text;
  v_pool       public.wc_pools%rowtype;
  v_total_paid int;
  v_pozo_total numeric;
  v_bp         record;
  v_pts        numeric;
  v_amounts    numeric[];
  v_pcts       int[];
  v_rank       int := 0;
  v_amt        numeric;
  v_pct        int;
  r            record;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from public.users where auth_id = (select auth.uid());
    if v_role <> 'admin' then raise exception 'unauthorized: only admin'; end if;
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026' for update;

  -- 1) Resolver bonus picks + recalcular total_points de cada enrollment
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

  -- 2) Pozo neto de la Polla
  select count(*) into v_total_paid from public.wc_enrollments where mode = 'polla' and payment_status = 'paid';
  if v_total_paid = 0 then raise exception 'No hay inscritos pagados a la Polla'; end if;
  v_pozo_total := v_total_paid * v_pool.polla_price * (1 - v_pool.fee_rate);

  -- 3) Montos por lugar (exactos: el 1er lugar absorbe el redondeo a centavos)
  if v_total_paid = 1 then
    v_amounts := array[ round(v_pozo_total, 2) ];
    v_pcts    := array[ 100 ];
  elsif v_total_paid = 2 then
    v_amounts := array[ round(v_pozo_total * 0.70, 2), 0 ];
    v_amounts[2] := round(v_pozo_total - v_amounts[1], 2);
    v_pcts    := array[ 70, 30 ];
  else
    v_amounts := array[ round(v_pozo_total * 0.60, 2), round(v_pozo_total * 0.25, 2), 0 ];
    v_amounts[3] := round(v_pozo_total - v_amounts[1] - v_amounts[2], 2);
    v_pcts    := array[ 60, 25, 15 ];
  end if;

  -- 4) Reset de un calculo previo (re-ejecutable). Respeta los payouts ya pagados.
  update public.wc_enrollments
    set is_winner = false, rank_position = null, prize_amount = null
    where mode = 'polla' and payment_status = 'paid';
  delete from public.wc_payouts where pool_mode = 'polla' and status = 'pending';

  -- 5) Rankear TOP 3 con tiebreakers (pts -> exactos -> fase final -> marcador final -> random)
  for r in
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
    select enrollment_id, user_id, total_points
    from ranked
    order by total_points desc, exact_count desc, final_phase_pts desc, final_score_diff asc, random()
    limit 3
  loop
    v_rank := v_rank + 1;
    if v_rank > array_length(v_amounts, 1) then exit; end if;
    v_amt := v_amounts[v_rank];
    v_pct := v_pcts[v_rank];
    if v_amt <= 0 then continue; end if;

    update public.wc_enrollments
      set is_winner = true, rank_position = v_rank, prize_amount = v_amt
      where id = r.enrollment_id;

    insert into public.wc_payouts (enrollment_id, user_id, pool_mode, amount, payment_method, status, notes)
    select r.enrollment_id, r.user_id, 'polla', v_amt, 'bank_transfer', 'pending',
           format('Premio Polla Mundialista 2026 — %s lugar (%s%% del pozo)', v_rank, v_pct)
    where not exists (
      select 1 from public.wc_payouts
      where enrollment_id = r.enrollment_id and pool_mode = 'polla' and status = 'paid'
    );

    return query select v_rank, r.user_id, r.enrollment_id, r.total_points, v_amt, v_pct;
  end loop;
end;
$$;

revoke execute on function public.wc_admin_finalize_polla(uuid, uuid, uuid, text, text, int, int) from public, anon;
grant execute on function public.wc_admin_finalize_polla(uuid, uuid, uuid, text, text, int, int) to authenticated;

comment on function public.wc_admin_finalize_polla is
  'Admin cierra la Polla Mundialista: resuelve bonus picks, rankea con tiebreakers y reparte el pozo neto al TOP 3 (60/25/15; 70/30 si hay 2; 100% si hay 1). Re-ejecutable: borra payouts pending de polla y recalcula, respeta los paid.';
