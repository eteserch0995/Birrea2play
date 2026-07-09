-- ════════════════════════════════════════════════════════════════════════
-- FIX ETERNO pago MIXTO (2026-07-06, caso real Gilisca Almillátegui):
-- pagó la parte Yappy ($4.50) pero quedó SIN inscripción y le salió error.
--
-- CAUSA RAÍZ: la restricción event_registrations_metodo_pago_check NO incluía
-- 'mixto', así que el INSERT final de inscribir_mixto SIEMPRE violaba el CHECK
-- (23514) → el pago Yappy se cobraba y la inscripción nunca se creaba. El mixto
-- estaba roto desde que se agregó; solo se notó poco porque casi nadie lo usa.
-- Causa secundaria: race — el cliente llamaba inscribir_mixto antes de que el
-- IPN marcara la orden 'executed'.
--
-- FIX:
--  1) Agregar 'mixto' al CHECK de metodo_pago.
--  2) completar_mixto_por_orden(order_id): completa la inscripción mixta desde la
--     orden Yappy ejecutada, del lado del SERVIDOR (service_role/admin). Debita los
--     créditos correspondientes (precio - Yappy, tolerante a saldo) y crea el
--     registro 'mixto'. Idempotente (dup guard) y tolerante a cupo (honra el pago,
--     igual que inscribir_yappy_evento). El edge yappy-ipn la invoca al confirmar
--     el pago mixto → ya no depende de que el cliente gane la carrera.
--  3) (cliente) inscribir_mixto sigue como respaldo; "Ya estás inscrito" se trata
--     como éxito en la UI. (bundle 2026-07-06.4)
-- ════════════════════════════════════════════════════════════════════════

alter table public.event_registrations drop constraint event_registrations_metodo_pago_check;
alter table public.event_registrations add constraint event_registrations_metodo_pago_check
  check (metodo_pago = any (array['wallet','yappy','tarjeta','gratis','efectivo','yappy_boton','waitlist_promoted','mixto']));

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
  v_fee          numeric;
  v_w            record;
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

  if exists (select 1 from public.event_registrations
             where event_id = v_o.event_id and user_id = v_o.user_id and status <> 'cancelled') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

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
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_w.id, 'inscripcion', -v_wallet_monto,
                'Inscripción mixta (créditos + Yappy $' || to_char(coalesce(v_o.amount,0),'FM990.00') || '): '
                || (select nombre from public.events where id = v_o.event_id));
      end if;
    end if;
  end if;

  insert into public.event_registrations (event_id, user_id, status, metodo_pago, monto_pagado, app_fee)
  values (v_o.event_id, v_o.user_id, 'confirmed', 'mixto', v_precio, v_fee)
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'mixto', monto_pagado = v_precio;

  return jsonb_build_object('ok', true, 'wallet_debitado', v_wallet_monto, 'yappy', v_o.amount, 'precio', v_precio);
end;
$function$;

revoke execute on function public.completar_mixto_por_orden(text) from public, anon, authenticated;
grant  execute on function public.completar_mixto_por_orden(text) to service_role;
