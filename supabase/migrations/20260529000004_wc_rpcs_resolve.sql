-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: RPCs de resolución y admin
-- ============================================================
-- RPCs llamadas por la edge function de sync (cuando un match cierra)
-- o por admin desde el panel.
--
-- RPCs:
--   wc_resolve_polla_match           — calcula puntos para todas las predicciones de un match
--   wc_resolve_survivor_match_day    — calcula vidas perdidas en una jornada-día
--   wc_admin_override_match_result   — admin overrides el marcador
--   wc_admin_finalize_survivor       — al cerrar fase grupos, calcula ganadores Survivor
--   wc_admin_finalize_polla          — al cerrar Mundial, calcula ganador Polla + resuelve bonus
--   wc_admin_set_pool_visibility     — admin flippa is_visible
-- ────────────────────────────────────────────────────────────

-- 1) wc_resolve_polla_match — al cerrar un partido, calcula puntos de las predicciones
create or replace function public.wc_resolve_polla_match(
  p_match_id uuid
) returns int  -- número de predicciones resueltas
language plpgsql
security definer
set search_path = public
as $$
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
begin
  -- Solo service_role o admin
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

  v_diff_actual := v_match.score_home - v_match.score_away;
  v_sign_actual := sign(v_diff_actual);

  -- Iterar predicciones
  for v_pred in
    select id, enrollment_id, pred_score_home, pred_score_away
    from public.wc_predictions
    where match_id = p_match_id
  loop
    v_diff_pred := v_pred.pred_score_home - v_pred.pred_score_away;
    v_sign_pred := sign(v_diff_pred);

    if v_pred.pred_score_home = v_match.score_home and v_pred.pred_score_away = v_match.score_away then
      v_hit_level := 'exact';
      v_base_points := 8;
    elsif v_sign_pred = v_sign_actual and v_diff_pred = v_diff_actual then
      v_hit_level := 'winner_diff';
      v_base_points := 5;
    elsif v_sign_pred = v_sign_actual then
      v_hit_level := 'winner';
      v_base_points := 3;
    else
      v_hit_level := 'miss';
      v_base_points := 0;
    end if;

    v_total_pts := v_base_points * v_match.multiplier;

    update public.wc_predictions
      set hit_level     = v_hit_level,
          points_earned = v_total_pts,
          resolved_at   = now()
      where id = v_pred.id;

    -- Actualizar match_points del enrollment
    update public.wc_enrollments
      set match_points = (
            select coalesce(sum(points_earned),0)
            from public.wc_predictions
            where enrollment_id = v_pred.enrollment_id and resolved_at is not null
          ),
          total_points = (
            select coalesce(sum(points_earned),0)
            from public.wc_predictions
            where enrollment_id = v_pred.enrollment_id and resolved_at is not null
          ) + coalesce(bonus_points, 0)
      where id = v_pred.enrollment_id;

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

grant execute on function public.wc_resolve_polla_match(uuid) to authenticated, service_role;

-- 2) wc_resolve_survivor_match_day — al cerrar todos los matches del día, calcula vidas
create or replace function public.wc_resolve_survivor_match_day(
  p_match_day_id uuid
) returns int  -- número de enrollments procesados
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_day      public.wc_match_days%rowtype;
  v_unfinished     int;
  v_enrollment     record;
  v_pick           public.wc_picks%rowtype;
  v_team_score     int;
  v_opp_score      int;
  v_pick_result    text;
  v_processed      int := 0;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin or service_role';
    end if;
  end if;

  select * into v_match_day from public.wc_match_days where id = p_match_day_id for update;
  if not found then raise exception 'Jornada no encontrada'; end if;
  if v_match_day.is_settled then return 0; end if;
  if v_match_day.phase <> 'group' then
    raise exception 'Survivor solo se resuelve en fase de grupos';
  end if;

  -- Validar que TODOS los matches del día estén finished
  select count(*) into v_unfinished
    from public.wc_matches
    where match_day_id = p_match_day_id and status <> 'finished';

  if v_unfinished > 0 then
    raise exception 'Aún hay % partidos sin finalizar en esta jornada', v_unfinished;
  end if;

  -- Iterar enrollments Survivor activos (lives > 0 y pagados)
  for v_enrollment in
    select id, lives_remaining
    from public.wc_enrollments
    where mode = 'survivor' and payment_status = 'paid' and lives_remaining > 0
  loop
    -- Buscar pick del user para este día
    select * into v_pick
      from public.wc_picks
      where enrollment_id = v_enrollment.id and match_day_id = p_match_day_id;

    if not found then
      -- No hizo pick → pierde vida (insertar pick virtual 'no_pick')
      insert into public.wc_picks (enrollment_id, match_day_id, team_id, match_id, result, life_lost, resolved_at)
        select v_enrollment.id, p_match_day_id,
               -- team_id placeholder: primer team del primer match del day
               coalesce(team_home_id, team_away_id),
               id, 'no_pick', true, now()
          from public.wc_matches
          where match_day_id = p_match_day_id
          limit 1;

      v_pick_result := 'no_pick';
    else
      -- Resolver según resultado del partido del team del pick
      select
        case when team_home_id = v_pick.team_id then score_home else score_away end,
        case when team_home_id = v_pick.team_id then score_away else score_home end
      into v_team_score, v_opp_score
      from public.wc_matches
      where id = v_pick.match_id;

      if v_team_score > v_opp_score then
        v_pick_result := 'won';
      elsif v_team_score = v_opp_score then
        v_pick_result := 'draw';
      else
        v_pick_result := 'lost';
      end if;

      update public.wc_picks
        set result      = v_pick_result,
            life_lost   = (v_pick_result = 'lost'),
            resolved_at = now()
        where id = v_pick.id;
    end if;

    -- Restar vida si corresponde
    if v_pick_result in ('lost', 'no_pick') then
      update public.wc_enrollments
        set lives_remaining = greatest(lives_remaining - 1, 0),
            eliminated_at_match_day_id = case when lives_remaining - 1 = 0 then p_match_day_id else eliminated_at_match_day_id end,
            eliminated_at = case when lives_remaining - 1 = 0 then now() else eliminated_at end
        where id = v_enrollment.id;
    end if;

    v_processed := v_processed + 1;
  end loop;

  -- Marcar match_day como resuelto
  update public.wc_match_days
    set is_settled = true,
        settled_at = now()
    where id = p_match_day_id;

  return v_processed;
end;
$$;

grant execute on function public.wc_resolve_survivor_match_day(uuid) to authenticated, service_role;

-- 3) wc_admin_override_match_result — admin override del marcador oficial
create or replace function public.wc_admin_override_match_result(
  p_match_id        uuid,
  p_score_home      int,
  p_score_away      int,
  p_penalties_home  int default null,
  p_penalties_away  int default null,
  p_notes           text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_match    public.wc_matches%rowtype;
  v_all_done boolean;
begin
  -- Solo admin
  if auth.role() <> 'service_role' then
    select id into v_admin_id from public.users
      where auth_id = (select auth.uid()) and role = 'admin';
    if v_admin_id is null then
      raise exception 'unauthorized: only admin';
    end if;
  end if;

  if p_score_home < 0 or p_score_away < 0 then
    raise exception 'Marcador inválido';
  end if;

  select * into v_match from public.wc_matches where id = p_match_id for update;
  if not found then raise exception 'Partido no encontrado'; end if;

  -- Upsert wc_results con override
  insert into public.wc_results (
    match_id, admin_override, admin_override_by, admin_override_at,
    admin_score_home, admin_score_away, admin_penalties_home, admin_penalties_away, admin_notes
  ) values (
    p_match_id, true, v_admin_id, now(),
    p_score_home, p_score_away, p_penalties_home, p_penalties_away, p_notes
  )
  on conflict (match_id) do update set
    admin_override        = true,
    admin_override_by     = excluded.admin_override_by,
    admin_override_at     = excluded.admin_override_at,
    admin_score_home      = excluded.admin_score_home,
    admin_score_away      = excluded.admin_score_away,
    admin_penalties_home  = excluded.admin_penalties_home,
    admin_penalties_away  = excluded.admin_penalties_away,
    admin_notes           = excluded.admin_notes;

  -- Actualizar match
  update public.wc_matches
    set score_home        = p_score_home,
        score_away        = p_score_away,
        penalties_home    = p_penalties_home,
        penalties_away    = p_penalties_away,
        went_to_penalties = (p_penalties_home is not null),
        status            = 'finished',
        is_resolved       = true,
        resolved_at       = now()
    where id = p_match_id;

  -- Re-ejecutar scoring de la Polla para este match
  perform public.wc_resolve_polla_match(p_match_id);

  -- Si todos los partidos del match_day están finished y es phase=group, resolver Survivor
  select not exists (
    select 1 from public.wc_matches
    where match_day_id = v_match.match_day_id and status <> 'finished'
  ) into v_all_done;

  if v_all_done and v_match.phase = 'group' then
    perform public.wc_resolve_survivor_match_day(v_match.match_day_id);
  end if;
end;
$$;

grant execute on function public.wc_admin_override_match_result(uuid, int, int, int, int, text) to authenticated;

-- 4) wc_admin_finalize_survivor — calcula ganadores Survivor al cerrar fase de grupos
create or replace function public.wc_admin_finalize_survivor()
returns table (enrollment_id uuid, user_id uuid, prize numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool             public.wc_pools%rowtype;
  v_total_paid       int;
  v_pozo_total       numeric;
  v_max_lives        int;
  v_winners_count    int;
  v_prize_per_winner numeric;
  v_last_md_date     date;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin';
    end if;
  end if;

  -- Verificar que todos los match_days de fase grupo estén settled
  if exists (select 1 from public.wc_match_days where phase = 'group' and is_settled = false) then
    raise exception 'Aún hay jornadas de grupos sin resolver';
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026' for update;

  select count(*) into v_total_paid
    from public.wc_enrollments
    where mode = 'survivor' and payment_status = 'paid';

  v_pozo_total := v_total_paid * v_pool.survivor_price * (1 - v_pool.fee_rate);

  -- Encontrar la cantidad máxima de vidas restantes
  select max(lives_remaining) into v_max_lives
    from public.wc_enrollments
    where mode = 'survivor' and payment_status = 'paid';

  if v_max_lives is null then
    raise exception 'No hay inscritos al Survivor';
  end if;

  if v_max_lives > 0 then
    -- Ganadores: los que tienen lives_remaining = v_max_lives
    select count(*) into v_winners_count
      from public.wc_enrollments
      where mode = 'survivor' and payment_status = 'paid' and lives_remaining = v_max_lives;

    v_prize_per_winner := v_pozo_total / v_winners_count;

    update public.wc_enrollments
      set is_winner = true,
          rank_position = 1,
          prize_amount = v_prize_per_winner
      where mode = 'survivor' and payment_status = 'paid' and lives_remaining = v_max_lives;
  else
    -- Todos quedaron en 0 → ganadores son los que cayeron en la jornada más tardía
    select max(md.date) into v_last_md_date
      from public.wc_enrollments e
      join public.wc_match_days md on e.eliminated_at_match_day_id = md.id
      where e.mode = 'survivor' and e.payment_status = 'paid';

    if v_last_md_date is null then
      raise exception 'No se puede determinar ganador (sin datos de eliminación)';
    end if;

    select count(*) into v_winners_count
      from public.wc_enrollments e
      join public.wc_match_days md on e.eliminated_at_match_day_id = md.id
      where e.mode = 'survivor' and e.payment_status = 'paid' and md.date = v_last_md_date;

    v_prize_per_winner := v_pozo_total / v_winners_count;

    update public.wc_enrollments e
      set is_winner = true,
          rank_position = 1,
          prize_amount = v_prize_per_winner
      from public.wc_match_days md
      where e.eliminated_at_match_day_id = md.id
        and e.mode = 'survivor' and e.payment_status = 'paid' and md.date = v_last_md_date;
  end if;

  -- Crear filas en wc_payouts (status='pending') para cada ganador
  insert into public.wc_payouts (enrollment_id, user_id, pool_mode, amount, payment_method, status, notes)
    select id, user_id, 'survivor', prize_amount, 'bank_transfer', 'pending',
           'Premio Survivor Mundial 2026'
    from public.wc_enrollments
    where mode = 'survivor' and is_winner = true and prize_amount > 0
      and not exists (
        select 1 from public.wc_payouts
        where enrollment_id = public.wc_enrollments.id and pool_mode = 'survivor'
      );

  return query
    select e.id, e.user_id, e.prize_amount
    from public.wc_enrollments e
    where e.mode = 'survivor' and e.is_winner = true;
end;
$$;

grant execute on function public.wc_admin_finalize_survivor() to authenticated;

-- 5) wc_admin_set_pool_visibility — admin flippa is_visible y otros flags
create or replace function public.wc_admin_set_pool_visibility(
  p_is_visible    boolean default null,
  p_survivor_open boolean default null,
  p_polla_open    boolean default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin';
    end if;
  end if;

  update public.wc_pools
    set is_visible    = coalesce(p_is_visible, is_visible),
        survivor_open = coalesce(p_survivor_open, survivor_open),
        polla_open    = coalesce(p_polla_open, polla_open)
    where season = 'fifa_wc_2026';
end;
$$;

grant execute on function public.wc_admin_set_pool_visibility(boolean, boolean, boolean) to authenticated;
