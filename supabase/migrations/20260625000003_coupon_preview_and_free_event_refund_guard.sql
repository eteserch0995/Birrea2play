-- 1) El comercio puede inspeccionar el estado de un QR sin consumirlo.
-- 2) Un evento cuyo precio actual es 0 nunca genera devolución al cancelar
--    o al remover una inscripción, aunque la fila conserve un monto histórico.

create or replace function public.inspect_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid       uuid := (select auth.uid());
  v_caller    uuid;
  v_is_admin  boolean;
  v_r         record;
  v_b         record;
  v_socio     record;
begin
  if v_uid is null then
    raise exception 'unauthorized: anonymous';
  end if;

  select id, (role = 'admin')
    into v_caller, v_is_admin
  from public.users
  where auth_id = v_uid;

  if v_caller is null then
    raise exception 'unauthorized: sin perfil';
  end if;

  select *
    into v_r
  from public.benefit_redemptions
  where code = upper(btrim(p_code));

  if not found then
    return jsonb_build_object(
      'ok', false,
      'status', 'invalid',
      'message', 'Cupón no encontrado'
    );
  end if;

  select bf.id as benefit_id, bf.titulo, bf.company_id, pc.nombre as company
    into v_b
  from public.partner_benefits bf
  join public.partner_companies pc on pc.id = bf.company_id
  where bf.id = v_r.benefit_id;

  if not v_is_admin and not public.is_company_staff(v_b.company_id) then
    raise exception 'unauthorized: no sos staff de este comercio';
  end if;

  select nombre, foto_url
    into v_socio
  from public.users
  where id = v_r.user_id;

  return jsonb_build_object(
    'ok', true,
    'code', v_r.code,
    'status', v_r.status,
    'redeemed_at', v_r.redeemed_at,
    'socio', v_socio.nombre,
    'socio_foto', v_socio.foto_url,
    'benefit', v_b.titulo,
    'company', v_b.company,
    'company_id', v_b.company_id,
    'message', case
      when v_r.status = 'pending' then 'El cupón es válido y está disponible para canje.'
      when v_r.status = 'redeemed' then 'Este cupón ya fue utilizado.'
      when v_r.status = 'void' then 'Este cupón fue anulado.'
      else 'Estado de cupón desconocido.'
    end
  );
end;
$function$;

revoke execute on function public.inspect_coupon(text) from public, anon;
grant execute on function public.inspect_coupon(text) to authenticated, service_role;

create or replace function public.cancel_event_registration(
  p_registration_id uuid,
  p_cancel_guests boolean default false
) returns jsonb
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
  v_can_refund   boolean := false;
  v_paid         numeric := 0;
  v_pct          numeric := 0;
  v_refund       numeric := 0;
  v_wallet_id    uuid;
  v_guests       integer := 0;
  v_penalty      boolean := false;
begin
  if auth.role() <> 'service_role' then
    if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
    select id, role into v_caller_id, v_caller_role
    from public.users where auth_id = v_uid;
  end if;

  select * into v_reg
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then raise exception 'inscripción no encontrada'; end if;

  if auth.role() <> 'service_role'
     and v_reg.user_id <> v_caller_id
     and coalesce(v_caller_role, '') not in ('admin', 'gestor') then
    raise exception 'unauthorized: no es tu inscripción';
  end if;

  if v_reg.status = 'cancelled' then
    return jsonb_build_object(
      'alreadyCancelled', true, 'refunded', false, 'amount', 0, 'pct', 0,
      'guestsCancelled', 0, 'penaltyApplied', false
    );
  end if;

  select fecha, hora, status, coalesce(precio, 0) as precio
    into v_ev
  from public.events
  where id = v_reg.event_id;

  v_start := ((v_ev.fecha::text || ' ' || coalesce(v_ev.hora::text, '00:00:00'))::timestamp)
             at time zone 'America/Panama';

  -- Regla principal: si el evento actualmente es gratis, no existe devolución.
  if v_ev.precio > 0 then
    v_can_refund := (v_start - now()) >= interval '48 hours';

    if v_reg.metodo_pago in ('wallet', 'yappy_boton')
       and coalesce(v_reg.monto_pagado, 0) > 0 then
      v_paid := v_reg.monto_pagado;
    elsif v_reg.metodo_pago = 'efectivo'
          and coalesce(v_reg.monto_pagado, 0) > 0
          and exists (
            select 1
            from public.cash_payment_requests c
            where c.user_id = v_reg.user_id
              and c.event_id = v_reg.event_id
              and c.status = 'approved'
              and c.cobrado = true
          ) then
      v_paid := v_reg.monto_pagado;
    end if;

    v_pct := case when v_can_refund then 1 else 0.5 end;
    v_refund := round(v_paid * v_pct, 2);
  end if;

  update public.event_registrations
  set status = 'cancelled'
  where id = p_registration_id;

  if p_cancel_guests then
    begin
      v_guests := coalesce(
        public.cancel_guests_for_registration(v_reg.user_id, v_reg.event_id),
        0
      );
    exception when others then
      v_guests := 0;
    end;
  end if;

  if v_refund > 0 then
    select id into v_wallet_id
    from public.wallets
    where user_id = v_reg.user_id;

    if v_wallet_id is not null then
      update public.wallets
      set balance = balance + v_refund
      where id = v_wallet_id;

      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (
        v_wallet_id,
        'reembolso',
        v_refund,
        case
          when v_can_refund then 'Reembolso (100%): cancelación de inscripción'
          else 'Devolución 50% — cancelación a menos de 48h del evento'
        end
      );
    end if;
  end if;

  if v_ev.precio > 0
     and not v_can_refund
     and v_reg.metodo_pago in ('efectivo', 'pending')
     and v_paid = 0 then
    begin
      perform public.apply_efectivo_penalty(v_reg.user_id);
      v_penalty := true;
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'alreadyCancelled', false,
    'refunded', v_refund > 0,
    'amount', v_refund,
    'pct', v_pct,
    'guestsCancelled', v_guests,
    'penaltyApplied', v_penalty
  );
end;
$function$;

revoke execute on function public.cancel_event_registration(uuid, boolean) from public, anon;
grant execute on function public.cancel_event_registration(uuid, boolean) to authenticated, service_role;

create or replace function public.admin_remove_registration(
  p_registration_id uuid,
  p_motivo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid          uuid := (select auth.uid());
  v_caller       uuid;
  v_role         text;
  v_reg          record;
  v_event_price  numeric := 0;
  v_paid         numeric := 0;
  v_refund       numeric := 0;
  v_wallet       uuid;
  v_nombre       text;
begin
  if auth.role() <> 'service_role' then
    if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
    select id, role into v_caller, v_role
    from public.users where auth_id = v_uid;
    if coalesce(v_role, '') not in ('admin', 'gestor') then
      raise exception 'unauthorized: solo admin/gestor';
    end if;
  end if;

  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'motivo requerido';
  end if;

  select * into v_reg
  from public.event_registrations
  where id = p_registration_id
  for update;

  if not found then raise exception 'inscripción no encontrada'; end if;

  if v_reg.status = 'cancelled' then
    return jsonb_build_object(
      'alreadyCancelled', true, 'refunded', false, 'amount', 0
    );
  end if;

  select coalesce(precio, 0)
    into v_event_price
  from public.events
  where id = v_reg.event_id;

  -- Aunque monto_pagado conserve el precio anterior, un evento gratis no
  -- devuelve nuevamente fondos al remover al participante.
  if v_event_price > 0 then
    if v_reg.metodo_pago in ('wallet', 'yappy_boton')
       and coalesce(v_reg.monto_pagado, 0) > 0 then
      v_paid := v_reg.monto_pagado;
    elsif v_reg.metodo_pago = 'efectivo'
          and coalesce(v_reg.monto_pagado, 0) > 0
          and exists (
            select 1
            from public.cash_payment_requests c
            where c.user_id = v_reg.user_id
              and c.event_id = v_reg.event_id
              and c.status = 'approved'
              and c.cobrado = true
          ) then
      v_paid := v_reg.monto_pagado;
    end if;
  end if;

  perform set_config('app.skip_waitlist_promote', '1', true);

  update public.event_registrations
  set status = 'cancelled'
  where id = p_registration_id;

  v_refund := round(v_paid, 2);

  if v_refund > 0 then
    select id into v_wallet
    from public.wallets
    where user_id = v_reg.user_id;

    if v_wallet is not null then
      update public.wallets
      set balance = balance + v_refund
      where id = v_wallet;

      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (
        v_wallet,
        'reembolso',
        v_refund,
        'Reembolso (100%) — removido del evento por el administrador'
      );
    end if;
  end if;

  select nombre into v_nombre
  from public.users
  where id = v_reg.user_id;

  insert into public.event_removals (
    event_id, user_id, nombre, motivo, refund_amount, removed_by
  ) values (
    v_reg.event_id, v_reg.user_id, v_nombre, btrim(p_motivo), v_refund, v_caller
  );

  return jsonb_build_object(
    'ok', true,
    'refunded', v_refund > 0,
    'amount', v_refund,
    'user_id', v_reg.user_id,
    'nombre', v_nombre
  );
end;
$function$;

revoke execute on function public.admin_remove_registration(uuid, text) from public, anon;
grant execute on function public.admin_remove_registration(uuid, text) to authenticated, service_role;
