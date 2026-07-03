-- ============================================================================
-- P0 — LOTE 1: funciones que OTORGAN VALOR cerradas a service_role + validacion
--               server-side de monto/pago + premio MVP via trigger.
-- Auditoria 2026-06-29. Cierra: credit_wallet self-credit (Critico), subpago/doble
-- debito en inscribir_con_wallet (Critico/Alto), inscripcion gratis via failsafe
-- (Alto #10), invitado confirmado gratis (Alto #11).
-- NO rompe flujos legitimos: callers edge usan service_role; el failsafe de Yappy
-- queda atado a una orden 'executed' real; el premio MVP pasa a un trigger idempotente.
-- ============================================================================

-- 1) credit_wallet -> service_role (server) O super admin. Cierra el "auto-acreditar
--    saldo ilimitado": el guard anterior (owner-check) dejaba que un authenticated
--    acreditara su PROPIA wallet. Ahora solo lo pueden invocar las edge functions
--    (service_role) o el super admin (is_super_admin = true, flag protegido por
--    trg_prevent_super_admin_change -> no auto-editable). Los callers cliente del premio
--    MVP (a un TERCERO -> ya fallaban) se reemplazan por el trigger del paso 2.
create or replace function public.credit_wallet(
  p_user_id uuid, p_monto numeric, p_tipo text, p_descripcion text default null::text
) returns void language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare v_wallet_id uuid;
begin
  if auth.role() <> 'service_role'
     and not exists (
       select 1 from public.users
       where auth_id = (select auth.uid()) and is_super_admin = true
     ) then
    raise exception 'unauthorized: credit_wallet solo service_role o super admin';
  end if;
  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  if not found then raise exception 'Wallet no encontrado para user %', p_user_id; end if;
  update public.wallets set balance = balance + p_monto where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, p_tipo, p_monto, p_descripcion);
end;
$function$;
revoke execute on function public.credit_wallet(uuid,numeric,text,text) from public, anon;
grant  execute on function public.credit_wallet(uuid,numeric,text,text) to authenticated, service_role;

-- 2) Premio MVP via trigger (corre como owner -> no necesita credit_wallet). Idempotente
--    por fila de mvp_results. Reemplaza las 2 llamadas cliente a credit_wallet.
create or replace function public._trfn_award_mvp_prize() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_wallet_id uuid;
begin
  if new.user_id is null or coalesce(new.premio_wallet,0) <= 0 then return new; end if;
  select id into v_wallet_id from public.wallets where user_id = new.user_id;
  if v_wallet_id is null then return new; end if;
  update public.wallets set balance = balance + new.premio_wallet where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, 'mvp_premio', new.premio_wallet, 'Premio MVP del evento');
  return new;
end;
$function$;
drop trigger if exists trg_award_mvp_prize on public.mvp_results;
create trigger trg_award_mvp_prize after insert on public.mvp_results
  for each row execute function public._trfn_award_mvp_prize();

-- 3) inscribir_con_wallet: (a) validar monto >= events.precio y COBRAR el precio real
--    (quita el control del monto al cliente -> cierra subpago a $0.01); (b) re-chequear
--    idempotencia DESPUES del FOR UPDATE (cierra el doble-debito por concurrencia).
create or replace function public.inscribir_con_wallet(
  p_user_id uuid, p_event_id uuid, p_monto numeric, p_descripcion text default 'Inscripción'::text
) returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_wallet_id uuid; v_balance numeric; v_precio numeric;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null then raise exception 'unauthorized: anonymous caller not allowed'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = auth.uid()) then
      raise exception 'unauthorized: caller is not p_user_id'; end if;
  end if;

  select precio into v_precio from public.events where id = p_event_id;
  if v_precio is null then raise exception 'Evento no existe'; end if;
  if p_monto < v_precio then
    raise exception 'monto insuficiente: % < precio % del evento', p_monto, v_precio; end if;

  -- Lock del wallet PRIMERO (serializa concurrencia del mismo usuario).
  select id, balance into v_wallet_id, v_balance
    from public.wallets where user_id = p_user_id for update;
  if not found then raise exception 'Wallet no encontrado'; end if;

  -- Idempotencia re-evaluada DESPUES del lock: si ya quedo confirmada, no debitar otra vez.
  if exists (select 1 from public.event_registrations
             where event_id = p_event_id and user_id = p_user_id and status = 'confirmed') then
    return;
  end if;

  if v_balance < v_precio then raise exception 'Saldo insuficiente'; end if;

  update public.wallets set balance = v_balance - v_precio where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, 'inscripcion', -v_precio, p_descripcion);
  insert into public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  values (p_event_id, p_user_id, 'wallet', v_precio, 'confirmed')
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'wallet', monto_pagado = v_precio;
end;
$function$;

-- 4) inscribir_yappy_evento: el caller NO-service debe tener una orden Yappy 'executed'
--    real para este order/user/event. Cierra "inscripcion gratis llamando la RPC con el
--    precio correcto sin pagar". El failsafe legitimo (tras pago real) sigue funcionando.
create or replace function public.inscribir_yappy_evento(
  p_user_id uuid, p_event_id uuid, p_monto numeric, p_order_id text
) returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_precio numeric; v_ev record; v_ocup integer; v_ya_ocupaba boolean;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null then raise exception 'unauthorized: anonymous caller'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = auth.uid()) then
      raise exception 'unauthorized: caller is not p_user_id'; end if;
    select precio into v_precio from public.events where id = p_event_id;
    if v_precio is null then raise exception 'Evento no existe'; end if;
    if p_monto < v_precio then
      raise exception 'monto insuficiente: % < precio % del evento', p_monto, v_precio; end if;
    -- NUEVO: exigir orden Yappy realmente pagada (executed) para este caller cliente.
    if not exists (
      select 1 from public.yappy_orders
      where order_id = p_order_id and user_id = p_user_id
        and event_id = p_event_id and status = 'executed'
    ) then
      raise exception 'unauthorized: no hay orden Yappy pagada (executed) para esta inscripcion';
    end if;
  end if;

  if exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and user_id = p_user_id and status = 'confirmed'
  ) then
    return;
  end if;

  select cupos_ilimitado, cupos_total into v_ev from public.events where id = p_event_id;
  v_ya_ocupaba := exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and user_id = p_user_id and status in ('confirmed','pending')
  );

  if v_ev.cupos_ilimitado is not true and v_ev.cupos_total is not null and not v_ya_ocupaba then
    select
      (select count(*) from public.event_registrations r
         where r.event_id = p_event_id and r.status in ('confirmed','pending'))
      +
      (select count(*) from public.event_guests g
         where g.event_id = p_event_id and g.status in ('confirmed','pending_payment')
           and (g.invited_by is null or exists (
             select 1 from public.event_registrations r2
             where r2.event_id = p_event_id and r2.user_id = g.invited_by
               and r2.status in ('confirmed','pending'))))
    into v_ocup;
    if v_ocup >= v_ev.cupos_total then
      begin
        insert into public.oversell_alerts (event_id, user_id, metodo, monto, detalle)
        values (p_event_id, p_user_id, 'yappy_boton', p_monto,
          format('Pago Yappy confirmado tras liberarse su reserva; evento lleno (%s/%s). Order %s. Honrado: sobrecupo +1.',
                 v_ocup, v_ev.cupos_total, p_order_id));
      exception when others then null;
      end;
    end if;
  end if;

  insert into public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  values (p_event_id, p_user_id, 'yappy_boton', p_monto, 'confirmed')
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'yappy_boton', monto_pagado = p_monto;
end;
$function$;

-- 5) confirmar_invitado_yappy -> SOLO service_role (unico caller real: yappy-ipn).
--    Cierra "invitado confirmado gratis" llamando la RPC directo sin pagar.
create or replace function public.confirmar_invitado_yappy(
  p_guest_id uuid, p_monto numeric, p_order_id text
) returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_invited_by uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized: confirmar_invitado_yappy solo server-side (service_role)';
  end if;
  select invited_by into v_invited_by from public.event_guests where id = p_guest_id;
  if v_invited_by is null then raise exception 'guest % no encontrado', p_guest_id; end if;
  update public.event_guests
  set status = 'confirmed', metodo_pago = 'yappy_boton', monto_pagado = p_monto
  where id = p_guest_id;
end;
$function$;
revoke execute on function public.confirmar_invitado_yappy(uuid,numeric,text) from public, anon, authenticated;
grant  execute on function public.confirmar_invitado_yappy(uuid,numeric,text) to service_role;
