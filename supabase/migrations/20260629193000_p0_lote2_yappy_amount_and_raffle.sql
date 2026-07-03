-- ============================================================================
-- P0 — LOTE 2: rifa server-side (cierra "tickets gratis" + doble valor) y constraint
--               yappy_orders_tipo_check alineada (abono_cancha + rifa).
-- ============================================================================

-- 1) Alinear el CHECK de tipo con el codigo: incluir 'abono_cancha' (cobro de abono que
--    hoy falla el insert -> dinero perdido) y 'rifa' (hoy cae a 'recarga' -> el pago va al
--    wallet Y se confirman tickets = doble valor).
alter table public.yappy_orders drop constraint if exists yappy_orders_tipo_check;
alter table public.yappy_orders add constraint yappy_orders_tipo_check
  check (tipo = any (array[
    'recarga','evento','invitado','compra_tienda','wc_enrollment','donacion','abono_cancha','rifa'
  ]::text[]));

-- 2) raffle_confirm_tickets_paid -> SOLO service_role (lo invoca yappy-ipn tras pago real),
--    con p_user_id explicito e IDEMPOTENTE por order_ref (notes). Cierra el "free tickets"
--    (antes GRANT authenticated, sin prueba de pago) y el doble-insert por reintento de IPN.
drop function if exists public.raffle_confirm_tickets_paid(uuid, integer);
create or replace function public.raffle_confirm_tickets_paid(
  p_event_id uuid, p_user_id uuid, p_quantity integer, p_order_ref text default null
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_rs text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'unauthorized: raffle_confirm_tickets_paid solo server-side (service_role)';
  end if;
  if p_quantity < 1 then raise exception 'Minimo 1 ticket'; end if;

  -- Idempotencia por orden: si ya confirmamos tickets de esta orden, no duplicar.
  if p_order_ref is not null and exists (
    select 1 from public.raffle_tickets where notes = p_order_ref
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select status into v_rs from public.raffle_state where event_id = p_event_id;
  if v_rs is null then raise exception 'La rifa no esta activa'; end if;
  if v_rs not in ('open','spinning','winner_pending') then
    raise exception 'La rifa no acepta tickets en este momento';
  end if;

  insert into public.raffle_tickets (event_id, user_id, quantity, amount_paid, status, notes)
  values (p_event_id, p_user_id, p_quantity, p_quantity::numeric, 'confirmed', p_order_ref);

  return jsonb_build_object('ok', true, 'quantity', p_quantity);
end;
$function$;
revoke execute on function public.raffle_confirm_tickets_paid(uuid,uuid,integer,text) from public, anon, authenticated;
grant  execute on function public.raffle_confirm_tickets_paid(uuid,uuid,integer,text) to service_role;
