-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: RPCs de usuario
-- ============================================================
-- RPCs SECURITY DEFINER llamados desde el cliente o desde edge functions
-- de pago. Todas validan que el caller sea el dueño de p_user_id (o
-- service_role para las llamadas internas de IPN).
--
-- Patrón de caller validation: [[feedback-rls-security-definer-caller-check]]
--
-- RPCs incluidos:
--   wc_create_pending_enrollment   — crea enrollment status='pending' (paso 1 del flujo)
--   wc_pay_enrollment_wallet       — debita wallet y marca status='paid'
--   wc_pay_enrollment_yappy        — service_role only, llamado por IPN
--   wc_admin_grant_enrollment      — admin only, regalar inscripción
--   wc_submit_bonus_picks          — guarda los 5 bonus picks pre-temporada
--   wc_submit_survivor_pick        — guarda pick del Survivor (valida deadline + max usos)
--   wc_submit_polla_prediction     — guarda predicción de la Polla (valida deadline)
-- ────────────────────────────────────────────────────────────

-- 1) wc_create_pending_enrollment — crea inscripción pendiente
create or replace function public.wc_create_pending_enrollment(
  p_user_id uuid,
  p_mode    text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment_id uuid;
  v_price         numeric;
  v_pool          public.wc_pools%rowtype;
begin
  -- Caller validation
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then
      raise exception 'unauthorized: anonymous';
    end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  if p_mode not in ('survivor','polla') then
    raise exception 'modo inválido: %', p_mode;
  end if;

  -- Verificar pool activo y deadline
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if not found then
    raise exception 'Pool del Mundial 2026 no configurado';
  end if;
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Inscripciones cerradas (deadline: %)', v_pool.enrollment_deadline;
  end if;
  if (p_mode = 'survivor' and not v_pool.survivor_open)
     or (p_mode = 'polla' and not v_pool.polla_open) then
    raise exception 'Modo % no está abierto a inscripciones', p_mode;
  end if;

  v_price := case when p_mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;

  -- Idempotencia: si ya existe enrollment, devolverlo
  select id into v_enrollment_id
    from public.wc_enrollments
    where user_id = p_user_id and mode = p_mode;

  if v_enrollment_id is not null then
    return v_enrollment_id;
  end if;

  insert into public.wc_enrollments (user_id, mode, paid_amount, payment_method, payment_status, lives_remaining)
    values (
      p_user_id,
      p_mode,
      v_price,
      'wallet',  -- placeholder, se actualiza al pagar
      'pending',
      case when p_mode = 'survivor' then 3 else 0 end
    )
    returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;

grant execute on function public.wc_create_pending_enrollment(uuid, text) to authenticated;

-- 2) wc_pay_enrollment_wallet — debita wallet y marca paid
create or replace function public.wc_pay_enrollment_wallet(
  p_user_id       uuid,
  p_enrollment_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_price      numeric;
  v_wallet_id  uuid;
  v_balance    numeric;
begin
  -- Caller validation
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  -- Lock enrollment row
  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'Inscripción no encontrada';
  end if;
  if v_enrollment.user_id <> p_user_id then
    raise exception 'Inscripción pertenece a otro usuario';
  end if;
  if v_enrollment.payment_status = 'paid' then
    return;  -- idempotente
  end if;

  -- Validar deadline del pool
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Inscripciones cerradas (deadline: %)', v_pool.enrollment_deadline;
  end if;

  v_price := case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;

  -- Lock wallet + chequear saldo
  select id, balance into v_wallet_id, v_balance
    from public.wallets where user_id = p_user_id for update;
  if not found then
    raise exception 'Wallet no encontrado';
  end if;
  if v_balance < v_price then
    raise exception 'Saldo insuficiente (balance: %, monto: %)', v_balance, v_price;
  end if;

  -- Debitar
  update public.wallets set balance = v_balance - v_price where id = v_wallet_id;

  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
    values (v_wallet_id, 'inscripcion', -v_price,
            'Inscripción Mundial 2026 - ' || initcap(v_enrollment.mode));

  -- Marcar enrollment paid
  update public.wc_enrollments
    set payment_status = 'paid',
        payment_method = 'wallet',
        paid_amount    = v_price,
        paid_at        = now()
    where id = p_enrollment_id;
end;
$$;

grant execute on function public.wc_pay_enrollment_wallet(uuid, uuid) to authenticated;

-- 3) wc_pay_enrollment_yappy — llamado por edge fn IPN Yappy
--    NO valida caller=p_user_id porque el IPN no tiene JWT del user.
--    Solo service_role puede llamarla; el ANON/AUTHENTICATED ROLE no.
create or replace function public.wc_pay_enrollment_yappy(
  p_user_id       uuid,
  p_enrollment_id uuid,
  p_amount        numeric,
  p_yappy_order_id text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_price      numeric;
begin
  -- Solo service_role
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized: only service_role can call this';
  end if;

  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then
    raise exception 'Inscripción no encontrada';
  end if;
  if v_enrollment.user_id <> p_user_id then
    raise exception 'Inscripción no pertenece al user_id indicado';
  end if;
  if v_enrollment.payment_status = 'paid' then
    return;  -- idempotente
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  v_price := case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;

  if p_amount < v_price then
    raise exception 'Monto Yappy menor al precio (% < %)', p_amount, v_price;
  end if;

  update public.wc_enrollments
    set payment_status = 'paid',
        payment_method = 'yappy',
        payment_ref    = p_yappy_order_id,
        paid_amount    = p_amount,
        paid_at        = now()
    where id = p_enrollment_id;
end;
$$;

grant execute on function public.wc_pay_enrollment_yappy(uuid, uuid, numeric, text) to service_role;

-- 4) wc_admin_grant_enrollment — admin regala una inscripción (testing, regalo, comp)
create or replace function public.wc_admin_grant_enrollment(
  p_user_id uuid,
  p_mode    text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role          text;
  v_enrollment_id uuid;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from public.users where auth_id = (select auth.uid());
    if v_role <> 'admin' then
      raise exception 'unauthorized: only admin can grant';
    end if;
  end if;

  if p_mode not in ('survivor','polla') then
    raise exception 'modo inválido: %', p_mode;
  end if;

  select id into v_enrollment_id
    from public.wc_enrollments
    where user_id = p_user_id and mode = p_mode;

  if v_enrollment_id is not null then
    update public.wc_enrollments
      set payment_status = 'paid',
          payment_method = 'admin_grant',
          paid_amount    = 0,
          paid_at        = now()
      where id = v_enrollment_id;
    return v_enrollment_id;
  end if;

  insert into public.wc_enrollments (
    user_id, mode, paid_amount, payment_method, payment_status, paid_at, lives_remaining
  ) values (
    p_user_id, p_mode, 0, 'admin_grant', 'paid', now(),
    case when p_mode = 'survivor' then 3 else 0 end
  ) returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;

grant execute on function public.wc_admin_grant_enrollment(uuid, text) to authenticated;

-- 5) wc_submit_bonus_picks — guarda los 5 bonus pre-temporada (Polla)
create or replace function public.wc_submit_bonus_picks(
  p_user_id              uuid,
  p_champion_team_id     uuid,
  p_runner_up_team_id    uuid,
  p_third_place_team_id  uuid,
  p_top_scorer_name      text,
  p_top_scorer_player_id int,
  p_mvp_name             text,
  p_mvp_player_id        int,
  p_final_score_home     int,
  p_final_score_away     int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment_id uuid;
  v_pool          public.wc_pools%rowtype;
  v_bonus_id      uuid;
begin
  -- Caller validation
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  -- Validar enrollment Polla existente (puede estar pending o paid)
  select id into v_enrollment_id
    from public.wc_enrollments
    where user_id = p_user_id and mode = 'polla';
  if v_enrollment_id is null then
    raise exception 'Primero debes inscribirte a Polla';
  end if;

  -- Deadline
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if v_pool.enrollment_deadline <= now() then
    raise exception 'Inscripciones cerradas, no se pueden modificar bonus picks';
  end if;

  -- Validar teams existen
  if not exists (select 1 from public.wc_teams where id = p_champion_team_id) then
    raise exception 'Campeón inválido';
  end if;
  if not exists (select 1 from public.wc_teams where id = p_runner_up_team_id) then
    raise exception 'Subcampeón inválido';
  end if;
  if not exists (select 1 from public.wc_teams where id = p_third_place_team_id) then
    raise exception 'Tercer lugar inválido';
  end if;

  -- Validar scores
  if p_final_score_home < 0 or p_final_score_home > 20
     or p_final_score_away < 0 or p_final_score_away > 20 then
    raise exception 'Marcador de la final fuera de rango (0..20)';
  end if;

  -- Upsert
  insert into public.wc_bonus_picks (
    enrollment_id, champion_team_id, runner_up_team_id, third_place_team_id,
    top_scorer_name, top_scorer_player_id, mvp_name, mvp_player_id,
    final_score_home, final_score_away
  ) values (
    v_enrollment_id, p_champion_team_id, p_runner_up_team_id, p_third_place_team_id,
    coalesce(p_top_scorer_name, ''), p_top_scorer_player_id,
    coalesce(p_mvp_name, ''), p_mvp_player_id,
    p_final_score_home, p_final_score_away
  )
  on conflict (enrollment_id) do update set
    champion_team_id     = excluded.champion_team_id,
    runner_up_team_id    = excluded.runner_up_team_id,
    third_place_team_id  = excluded.third_place_team_id,
    top_scorer_name      = excluded.top_scorer_name,
    top_scorer_player_id = excluded.top_scorer_player_id,
    mvp_name             = excluded.mvp_name,
    mvp_player_id        = excluded.mvp_player_id,
    final_score_home     = excluded.final_score_home,
    final_score_away     = excluded.final_score_away
  returning id into v_bonus_id;

  return v_bonus_id;
end;
$$;

grant execute on function public.wc_submit_bonus_picks(uuid, uuid, uuid, uuid, text, int, text, int, int, int) to authenticated;

-- 6) wc_submit_survivor_pick — guarda pick del Survivor
create or replace function public.wc_submit_survivor_pick(
  p_user_id      uuid,
  p_match_day_id uuid,
  p_team_id      uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment    public.wc_enrollments%rowtype;
  v_match_day     public.wc_match_days%rowtype;
  v_match_id      uuid;
  v_team_uses     int;
  v_pick_id       uuid;
begin
  -- Caller validation
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  -- Enrollment Survivor activo
  select * into v_enrollment
    from public.wc_enrollments
    where user_id = p_user_id and mode = 'survivor';
  if not found then
    raise exception 'No estás inscrito al Survivor';
  end if;
  if v_enrollment.payment_status <> 'paid' then
    raise exception 'Inscripción no pagada';
  end if;
  if v_enrollment.lives_remaining <= 0 then
    raise exception 'Estás eliminado del Survivor';
  end if;

  -- Match day válido y dentro de deadline
  select * into v_match_day from public.wc_match_days where id = p_match_day_id;
  if not found then
    raise exception 'Jornada-día no encontrada';
  end if;
  if v_match_day.phase <> 'group' then
    raise exception 'Survivor solo aplica a fase de grupos';
  end if;
  if v_match_day.pick_deadline <= now() then
    raise exception 'Deadline cerrado (cerró: %)', v_match_day.pick_deadline;
  end if;
  if v_match_day.is_settled then
    raise exception 'Esta jornada ya fue resuelta';
  end if;

  -- El team juega ese día (algún partido del match_day lo incluye)
  select id into v_match_id
    from public.wc_matches
    where match_day_id = p_match_day_id
      and (team_home_id = p_team_id or team_away_id = p_team_id)
    limit 1;
  if v_match_id is null then
    raise exception 'Ese equipo no juega en esta jornada';
  end if;

  -- Validar max 2 usos del team en toda la fase de grupos (excluyendo este match_day por si es UPDATE)
  select count(*)
    into v_team_uses
    from public.wc_picks p
    join public.wc_match_days md on p.match_day_id = md.id
    where p.enrollment_id = v_enrollment.id
      and p.team_id = p_team_id
      and p.match_day_id <> p_match_day_id
      and md.phase = 'group';

  if v_team_uses >= 2 then
    raise exception 'Ya usaste este equipo 2 veces (máximo permitido)';
  end if;

  -- Upsert pick
  insert into public.wc_picks (enrollment_id, match_day_id, team_id, match_id, result)
    values (v_enrollment.id, p_match_day_id, p_team_id, v_match_id, 'pending')
    on conflict (enrollment_id, match_day_id) do update set
      team_id  = excluded.team_id,
      match_id = excluded.match_id,
      result   = 'pending',
      life_lost = false,
      resolved_at = null
    returning id into v_pick_id;

  return v_pick_id;
end;
$$;

grant execute on function public.wc_submit_survivor_pick(uuid, uuid, uuid) to authenticated;

-- 7) wc_submit_polla_prediction — guarda predicción de marcador
create or replace function public.wc_submit_polla_prediction(
  p_user_id        uuid,
  p_match_id       uuid,
  p_pred_score_home int,
  p_pred_score_away int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_match      public.wc_matches%rowtype;
  v_pred_id    uuid;
begin
  -- Caller validation
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  -- Enrollment Polla pagado
  select * into v_enrollment from public.wc_enrollments
    where user_id = p_user_id and mode = 'polla';
  if not found then
    raise exception 'No estás inscrito a la Polla';
  end if;
  if v_enrollment.payment_status <> 'paid' then
    raise exception 'Inscripción no pagada';
  end if;

  -- Match válido
  select * into v_match from public.wc_matches where id = p_match_id;
  if not found then
    raise exception 'Partido no encontrado';
  end if;
  if v_match.prediction_deadline <= now() then
    raise exception 'Deadline cerrado para este partido (cerró: %)', v_match.prediction_deadline;
  end if;
  if v_match.status not in ('scheduled','live') then
    raise exception 'Partido no acepta predicciones (status: %)', v_match.status;
  end if;

  if p_pred_score_home < 0 or p_pred_score_home > 20
     or p_pred_score_away < 0 or p_pred_score_away > 20 then
    raise exception 'Marcador fuera de rango (0..20)';
  end if;

  insert into public.wc_predictions (enrollment_id, match_id, pred_score_home, pred_score_away)
    values (v_enrollment.id, p_match_id, p_pred_score_home, p_pred_score_away)
    on conflict (enrollment_id, match_id) do update set
      pred_score_home = excluded.pred_score_home,
      pred_score_away = excluded.pred_score_away,
      hit_level       = null,
      points_earned   = 0,
      resolved_at     = null
    returning id into v_pred_id;

  return v_pred_id;
end;
$$;

grant execute on function public.wc_submit_polla_prediction(uuid, uuid, int, int) to authenticated;
