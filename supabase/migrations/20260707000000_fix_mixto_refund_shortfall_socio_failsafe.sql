-- ════════════════════════════════════════════════════════════════════════
-- FIX 2026-07-07 — 3 huecos del método de pago 'mixto' (créditos + Yappy):
--
--  (1) DEVOLUCIÓN rota (bug de plata, reportado por usuario): cancelar un
--      'mixto' devolvía $0. cancel_event_registration solo reconocía
--      'wallet'/'yappy_boton' → v_paid=0 → v_refund=0. Mismo patrón que el
--      bug del CHECK de metodo_pago (20260706000002): agregaron 'mixto' como
--      método pero no lo propagaron a la devolución. La política de reembolso
--      es SIEMPRE a créditos internos sin importar el método, así que 'mixto'
--      se trata idéntico a 'wallet'/'yappy_boton' (monto_pagado × %).
--
--  (2) SUBPAGO silencioso del mixto (hallazgo medio de la auditoría):
--      completar_mixto_por_orden clampa el débito al saldo disponible
--      (least(precio-yappy, balance)) y luego inscribe a precio completo aun
--      si Yappy+créditos no cubrieron el precio (carrera legítima: el saldo
--      bajó entre el cobro Yappy y el IPN; o llamada cruda con amount bajo).
--      Se honra el pago (igual que el sobrecupo) pero AHORA deja rastro:
--      oversell_alerts metodo='mixto_shortfall'. Se trackea el débito REAL
--      con v_debited (v_wallet_monto se sobreescribía y mentía en el edge de
--      "sin wallet").
--
--  (3) FAILSAFE de socios roto en el Yappy puro (hallazgo bajo):
--      inscribir_yappy_evento rama no-service validaba p_monto contra
--      events.precio CRUDO (sin −10%), así que un socio (paga precio×0.9)
--      siempre disparaba 'monto insuficiente' y el failsafe del cliente
--      quedaba inútil — dependían 100% del IPN. Ahora usa precio_para()
--      (socio-aware) con epsilon, igual que el resto de las vías.
-- ════════════════════════════════════════════════════════════════════════

-- ── (1) cancel_event_registration: 'mixto' entra a la devolución ──────────
create or replace function public.cancel_event_registration(p_registration_id uuid, p_cancel_guests boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid          uuid := (select auth.uid());
  v_caller_id    uuid;
  v_caller_role  text;
  v_reg          record;
  v_ev           record;
  v_start        timestamptz;
  v_can_refund   boolean;
  v_paid         numeric := 0;
  v_pct          numeric;
  v_refund       numeric := 0;
  v_wallet_id    uuid;
  v_guests       integer := 0;
  v_penalty      boolean := false;
begin
  -- Caller
  if auth.role() <> 'service_role' then
    if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
    select id, role into v_caller_id, v_caller_role from public.users where auth_id = v_uid;
  end if;

  -- Lock de la fila para idempotencia (evita doble refund por doble-tap)
  select * into v_reg from public.event_registrations where id = p_registration_id for update;
  if not found then raise exception 'inscripción no encontrada'; end if;

  -- Autorización: dueño, o admin/gestor
  if auth.role() <> 'service_role'
     and v_reg.user_id <> v_caller_id
     and coalesce(v_caller_role,'') not in ('admin','gestor') then
    raise exception 'unauthorized: no es tu inscripción';
  end if;

  -- Ya cancelada → no-op (sin segundo refund)
  if v_reg.status = 'cancelled' then
    return jsonb_build_object('alreadyCancelled', true, 'refunded', false, 'amount', 0, 'pct', 0,
                              'guestsCancelled', 0, 'penaltyApplied', false);
  end if;

  select fecha, hora, status into v_ev from public.events where id = v_reg.event_id;

  -- Ventana de 48h en hora REAL de Panamá (no el reloj del dispositivo)
  v_start := ((v_ev.fecha::text || ' ' || coalesce(v_ev.hora::text, '00:00:00'))::timestamp)
             at time zone 'America/Panama';
  v_can_refund := (v_start - now()) >= interval '48 hours';

  -- Monto REALMENTE pagado (server-side, no lo que mande el cliente).
  -- 'mixto' se reembolsa igual que wallet/yappy_boton: monto_pagado guarda el
  -- precio total pagado (parte créditos + parte Yappy) y la devolución SIEMPRE
  -- va a créditos internos, así que no hay que separar los componentes.
  if v_reg.metodo_pago in ('wallet','yappy_boton','mixto') and coalesce(v_reg.monto_pagado,0) > 0 then
    v_paid := v_reg.monto_pagado;
  elsif v_reg.metodo_pago = 'efectivo' and coalesce(v_reg.monto_pagado,0) > 0 then
    if exists (select 1 from public.cash_payment_requests c
               where c.user_id = v_reg.user_id and c.event_id = v_reg.event_id
                 and c.status = 'approved' and c.cobrado = true) then
      v_paid := v_reg.monto_pagado;
    end if;
  end if;
  -- waitlist_promoted / monto 0 → v_paid queda 0 (nada que devolver)

  -- Cancelar (dispara promoción de lista de espera)
  update public.event_registrations set status = 'cancelled' where id = p_registration_id;

  -- Invitados del mismo usuario (reusa el helper que limpia team_players)
  if p_cancel_guests then
    begin
      v_guests := coalesce(public.cancel_guests_for_registration(v_reg.user_id, v_reg.event_id), 0);
    exception when others then
      v_guests := 0;
    end;
  end if;

  -- Devolución: 100% (>=48h) o 50% (<48h), SIEMPRE a créditos internos
  v_pct    := case when v_can_refund then 1 else 0.5 end;
  v_refund := round(v_paid * v_pct, 2);
  if v_refund > 0 then
    select id into v_wallet_id from public.wallets where user_id = v_reg.user_id;
    if v_wallet_id is not null then
      update public.wallets set balance = balance + v_refund where id = v_wallet_id;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (v_wallet_id, 'reembolso', v_refund,
              case when v_can_refund then 'Reembolso (100%): cancelación de inscripción'
                   else 'Devolución 50% — cancelación a menos de 48h del evento' end);
    end if;
  end if;

  -- Penalización SOLO efectivo NO pagado cancelado tarde
  if not v_can_refund and v_reg.metodo_pago in ('efectivo','pending') and v_paid = 0 then
    begin perform public.apply_efectivo_penalty(v_reg.user_id); v_penalty := true;
    exception when others then null; end;
  end if;

  return jsonb_build_object(
    'alreadyCancelled', false,
    'refunded',  v_refund > 0,
    'amount',    v_refund,
    'pct',       v_pct,
    'guestsCancelled', v_guests,
    'penaltyApplied',  v_penalty
  );
end;
$function$;

-- ── (2) completar_mixto_por_orden: rastro de subpago (shortfall) ──────────
create or replace function public.completar_mixto_por_orden(p_order_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_o            record;
  v_precio       numeric;
  v_wallet_monto numeric;
  v_debited      numeric := 0;   -- crédito REALMENTE debitado (no el intencionado)
  v_fee          numeric;
  v_w            record;
  v_existing     record;
  v_desc         text;
  v_wallet_id    uuid;
  v_ev           record;
  v_ocup         integer;
  v_ya_ocupaba   boolean;
  v_falta        numeric;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = auth.uid()) not in ('admin','super_admin') then
      raise exception 'solo service_role/admin';
    end if;
  end if;

  select * into v_o from public.yappy_orders
   where order_id = p_order_id and tipo = 'mixto' and status = 'executed';
  if v_o.order_id is null then
    raise exception 'orden mixta ejecutada no encontrada: %', p_order_id;
  end if;

  select status, metodo_pago into v_existing
    from public.event_registrations
   where event_id = v_o.event_id and user_id = v_o.user_id;

  if v_existing.status = 'confirmed' then
    if v_existing.metodo_pago = 'mixto' then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    v_desc := 'yappy_extra:' || p_order_id;
    if not exists (select 1 from public.wallet_transactions where descripcion = v_desc) then
      select id into v_wallet_id from public.wallets where user_id = v_o.user_id;
      if v_wallet_id is not null then
        update public.wallets set balance = balance + coalesce(v_o.amount, 0) where id = v_wallet_id;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_wallet_id, 'reembolso', coalesce(v_o.amount, 0), v_desc);
      end if;
    end if;
    return jsonb_build_object('ok', true, 'already', true, 'credited_extra', true);
  end if;

  v_ya_ocupaba := coalesce(v_existing.status, '') in ('confirmed','pending');

  v_precio := public.precio_para(v_o.event_id, v_o.user_id);
  if v_precio is null then raise exception 'evento sin precio'; end if;
  select coalesce(app_fee_per_player, 0) into v_fee from public.events where id = v_o.event_id;
  v_fee := least(v_fee, v_precio);

  v_wallet_monto := round(greatest(v_precio - coalesce(v_o.amount,0), 0), 2);
  if v_wallet_monto > 0 then
    select id, balance into v_w from public.wallets where user_id = v_o.user_id for update;
    if v_w.id is not null then
      v_wallet_monto := least(v_wallet_monto, v_w.balance);
      if v_wallet_monto > 0 then
        update public.wallets set balance = balance - v_wallet_monto where id = v_w.id;
        v_debited := v_wallet_monto;   -- débito real (puede ser < intencionado si el saldo bajó)
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_w.id, 'inscripcion', -v_wallet_monto,
                'Inscripción mixta (créditos + Yappy $' || to_char(coalesce(v_o.amount,0),'FM990.00') || '): '
                || (select nombre from public.events where id = v_o.event_id));
      end if;
    end if;
  end if;

  if not v_ya_ocupaba then
    select cupos_ilimitado, cupos_total into v_ev from public.events where id = v_o.event_id;
    if v_ev.cupos_ilimitado is not true and v_ev.cupos_total is not null then
      select
        (select count(*) from public.event_registrations r
           where r.event_id = v_o.event_id and r.status in ('confirmed','pending'))
        +
        (select count(*) from public.event_guests g
           where g.event_id = v_o.event_id and g.status in ('confirmed','pending_payment')
             and (g.invited_by is null or exists (
               select 1 from public.event_registrations r2
               where r2.event_id = v_o.event_id and r2.user_id = g.invited_by
                 and r2.status in ('confirmed','pending'))))
      into v_ocup;
      if v_ocup >= v_ev.cupos_total then
        begin
          insert into public.oversell_alerts (event_id, user_id, metodo, monto, detalle)
          values (v_o.event_id, v_o.user_id, 'mixto', v_o.amount,
            format('Pago mixto confirmado tras liberarse su reserva; evento lleno (%s/%s). Order %s. Honrado: sobrecupo +1.',
                   v_ocup, v_ev.cupos_total, p_order_id));
        exception when others then null;
        end;
      end if;
    end if;
  end if;

  insert into public.event_registrations (event_id, user_id, status, metodo_pago, monto_pagado, app_fee)
  values (v_o.event_id, v_o.user_id, 'confirmed', 'mixto', v_precio, v_fee)
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'mixto', monto_pagado = v_precio;

  -- SUBPAGO: se honró la inscripción a precio completo pero Yappy + créditos
  -- realmente cobrados no cubren el precio (saldo cayó entre el cobro y el IPN,
  -- o monto Yappy manipulado). Se deja rastro para que el admin reconcilie —
  -- mismo criterio que el sobrecupo: honrar el pago pero NO en silencio.
  v_falta := round(v_precio - coalesce(v_o.amount,0) - v_debited, 2);
  if v_falta > 0.01 then
    begin
      insert into public.oversell_alerts (event_id, user_id, metodo, monto, detalle)
      values (v_o.event_id, v_o.user_id, 'mixto_shortfall', v_falta,
        format('Pago mixto incompleto: Yappy $%s + créditos $%s = $%s < precio $%s. Order %s. Honrado; falta $%s.',
               to_char(coalesce(v_o.amount,0),'FM990.00'), to_char(v_debited,'FM990.00'),
               to_char(coalesce(v_o.amount,0) + v_debited,'FM990.00'), to_char(v_precio,'FM990.00'),
               p_order_id, to_char(v_falta,'FM990.00')));
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'wallet_debitado', v_debited, 'yappy', v_o.amount,
                            'precio', v_precio, 'falta', greatest(v_falta, 0));
end;
$function$;

-- ── (3) inscribir_yappy_evento: failsafe socio-aware ──────────────────────
create or replace function public.inscribir_yappy_evento(p_user_id uuid, p_event_id uuid, p_monto numeric, p_order_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_precio numeric; v_ev record; v_ocup integer; v_ya_ocupaba boolean;
  v_existing_metodo text; v_desc text; v_wallet_id uuid;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null then raise exception 'unauthorized: anonymous caller'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = auth.uid()) then
      raise exception 'unauthorized: caller is not p_user_id'; end if;
    -- precio_para = socio-aware (−10% con membresía activa). Antes usaba
    -- events.precio crudo y los socios (pagan precio×0.9) siempre fallaban
    -- este failsafe con 'monto insuficiente'.
    v_precio := public.precio_para(p_event_id, p_user_id);
    if v_precio is null then raise exception 'Evento no existe'; end if;
    if p_monto + 0.011 < v_precio then
      raise exception 'monto insuficiente: % < precio % del evento', p_monto, v_precio; end if;
    if not exists (
      select 1 from public.yappy_orders
      where order_id = p_order_id and user_id = p_user_id
        and event_id = p_event_id and status = 'executed'
    ) then
      raise exception 'unauthorized: no hay orden Yappy pagada (executed) para esta inscripcion';
    end if;
  end if;

  select metodo_pago into v_existing_metodo
    from public.event_registrations
   where event_id = p_event_id and user_id = p_user_id and status = 'confirmed';

  if found then
    if v_existing_metodo = 'yappy_boton' then
      return;
    end if;
    v_desc := 'yappy_extra:' || p_order_id;
    if not exists (select 1 from public.wallet_transactions where descripcion = v_desc) then
      select id into v_wallet_id from public.wallets where user_id = p_user_id;
      if v_wallet_id is not null then
        update public.wallets set balance = balance + p_monto where id = v_wallet_id;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_wallet_id, 'reembolso', p_monto, v_desc);
      end if;
    end if;
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

-- Grants preservados (idénticos a las defs vivas)
revoke execute on function public.completar_mixto_por_orden(text) from public, anon, authenticated;
grant  execute on function public.completar_mixto_por_orden(text) to service_role;
revoke execute on function public.cancel_event_registration(uuid, boolean) from public, anon;
grant  execute on function public.cancel_event_registration(uuid, boolean) to authenticated, service_role;
