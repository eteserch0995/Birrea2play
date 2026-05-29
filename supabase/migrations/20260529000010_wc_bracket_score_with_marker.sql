-- ============================================================
-- 2026-05-29 — Mundial 2026: marcador opcional en KO + scoring bonus
-- ============================================================
-- Permite predecir marcador opcional en partidos KO con scoring bonus:
--   winner wrong               → 0 pts
--   winner correcto            → 5 pts × multiplier (base)
--   + diferencia exacta        → 7 pts × multiplier (5 + 2 bonus)
--   + marcador exacto          → 8 pts × multiplier (5 + 3 bonus)
-- ────────────────────────────────────────────────────────────

create or replace function public.wc_submit_polla_prediction(
  p_user_id        uuid,
  p_match_id       uuid,
  p_pred_score_home int default null,
  p_pred_score_away int default null,
  p_pred_winner_team_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_match      public.wc_matches%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_pred_id    uuid;
begin
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  select * into v_enrollment from public.wc_enrollments
    where user_id = p_user_id and mode = 'polla';
  if not found then raise exception 'No estás inscrito a la Polla'; end if;
  if v_enrollment.payment_status <> 'paid' then raise exception 'Inscripción no pagada'; end if;

  select * into v_match from public.wc_matches where id = p_match_id;
  if not found then raise exception 'Partido no encontrado'; end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Cierre de polla: ya pasó el deadline (cerró: %)', v_pool.enrollment_deadline;
  end if;

  if v_match.phase = 'group' then
    if p_pred_score_home is null or p_pred_score_away is null then
      raise exception 'Partido de grupos requiere marcador (home y away)';
    end if;
    if p_pred_score_home < 0 or p_pred_score_home > 20
       or p_pred_score_away < 0 or p_pred_score_away > 20 then
      raise exception 'Marcador fuera de rango (0..20)';
    end if;
    insert into public.wc_predictions (enrollment_id, match_id, pred_score_home, pred_score_away, pred_winner_team_id)
      values (v_enrollment.id, p_match_id, p_pred_score_home, p_pred_score_away, null)
      on conflict (enrollment_id, match_id) do update set
        pred_score_home = excluded.pred_score_home,
        pred_score_away = excluded.pred_score_away,
        pred_winner_team_id = null,
        hit_level = null, points_earned = 0, resolved_at = null
      returning id into v_pred_id;
  else
    if p_pred_winner_team_id is null then
      raise exception 'Partidos eliminatoria requieren predicción de ganador';
    end if;
    if not exists (select 1 from public.wc_teams where id = p_pred_winner_team_id) then
      raise exception 'Equipo inválido';
    end if;
    -- Marcador opcional en KO
    if p_pred_score_home is not null or p_pred_score_away is not null then
      if p_pred_score_home is null or p_pred_score_away is null then
        raise exception 'Si predice marcador, debe llenar home y away';
      end if;
      if p_pred_score_home < 0 or p_pred_score_home > 20
         or p_pred_score_away < 0 or p_pred_score_away > 20 then
        raise exception 'Marcador fuera de rango (0..20)';
      end if;
    end if;
    insert into public.wc_predictions (enrollment_id, match_id, pred_score_home, pred_score_away, pred_winner_team_id)
      values (v_enrollment.id, p_match_id, p_pred_score_home, p_pred_score_away, p_pred_winner_team_id)
      on conflict (enrollment_id, match_id) do update set
        pred_score_home = excluded.pred_score_home,
        pred_score_away = excluded.pred_score_away,
        pred_winner_team_id = excluded.pred_winner_team_id,
        hit_level = null, points_earned = 0, resolved_at = null
      returning id into v_pred_id;
  end if;

  return v_pred_id;
end;
$$;

revoke execute on function public.wc_submit_polla_prediction(uuid, uuid, int, int, uuid) from public, anon;
grant execute on function public.wc_submit_polla_prediction(uuid, uuid, int, int, uuid) to authenticated;

create or replace function public.wc_resolve_polla_match(p_match_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_match       public.wc_matches%rowtype;
  v_pred        record;
  v_hit_level   text;
  v_base_points numeric;
  v_total_pts   numeric;
  v_resolved    int := 0;
  v_diff_actual int;
  v_diff_pred   int;
  v_sign_actual int;
  v_sign_pred   int;
  v_winner_id   uuid;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin or service_role';
    end if;
  end if;

  select * into v_match from public.wc_matches where id = p_match_id for update;
  if not found then raise exception 'Partido no encontrado'; end if;
  if v_match.status <> 'finished' or v_match.score_home is null or v_match.score_away is null then
    raise exception 'Partido no está finalizado o falta marcador';
  end if;

  if v_match.went_to_penalties then
    if v_match.penalties_home > v_match.penalties_away then v_winner_id := v_match.team_home_id;
    elsif v_match.penalties_away > v_match.penalties_home then v_winner_id := v_match.team_away_id;
    else v_winner_id := null; end if;
  else
    if v_match.score_home > v_match.score_away then v_winner_id := v_match.team_home_id;
    elsif v_match.score_away > v_match.score_home then v_winner_id := v_match.team_away_id;
    else v_winner_id := null; end if;
  end if;

  v_diff_actual := v_match.score_home - v_match.score_away;
  v_sign_actual := sign(v_diff_actual);

  for v_pred in
    select id, enrollment_id, pred_score_home, pred_score_away, pred_winner_team_id
    from public.wc_predictions where match_id = p_match_id
  loop
    v_hit_level := 'miss';
    v_base_points := 0;

    if v_match.phase = 'group' then
      if v_pred.pred_score_home is not null and v_pred.pred_score_away is not null then
        v_diff_pred := v_pred.pred_score_home - v_pred.pred_score_away;
        v_sign_pred := sign(v_diff_pred);
        if v_pred.pred_score_home = v_match.score_home and v_pred.pred_score_away = v_match.score_away then
          v_hit_level := 'exact'; v_base_points := 8;
        elsif v_sign_pred = v_sign_actual and v_diff_pred = v_diff_actual then
          v_hit_level := 'winner_diff'; v_base_points := 5;
        elsif v_sign_pred = v_sign_actual then
          v_hit_level := 'winner'; v_base_points := 3;
        end if;
      end if;
    else
      -- KO: winner correcto = 5 base. Bonus por marcador exacto = +3, por diferencia = +2.
      if v_pred.pred_winner_team_id is not null
         and v_winner_id is not null
         and v_pred.pred_winner_team_id = v_winner_id then
        v_base_points := 5;
        v_hit_level := 'winner';
        if v_pred.pred_score_home is not null and v_pred.pred_score_away is not null then
          if v_pred.pred_score_home = v_match.score_home and v_pred.pred_score_away = v_match.score_away then
            v_base_points := 8;
            v_hit_level := 'exact';
          elsif (v_pred.pred_score_home - v_pred.pred_score_away) = v_diff_actual then
            v_base_points := 7;
            v_hit_level := 'winner_diff';
          end if;
        end if;
      end if;
    end if;

    v_total_pts := v_base_points * v_match.multiplier;

    update public.wc_predictions
      set hit_level = v_hit_level, points_earned = v_total_pts, resolved_at = now()
      where id = v_pred.id;

    update public.wc_enrollments
      set match_points = (
            select coalesce(sum(points_earned),0) from public.wc_predictions
            where enrollment_id = v_pred.enrollment_id and resolved_at is not null
          ),
          total_points = (
            select coalesce(sum(points_earned),0) from public.wc_predictions
            where enrollment_id = v_pred.enrollment_id and resolved_at is not null
          ) + coalesce(bonus_points, 0)
      where id = v_pred.enrollment_id;

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

revoke execute on function public.wc_resolve_polla_match(uuid) from public, anon;
grant execute on function public.wc_resolve_polla_match(uuid) to authenticated, service_role;
