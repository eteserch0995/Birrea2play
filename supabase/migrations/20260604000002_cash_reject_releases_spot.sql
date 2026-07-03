-- Fix: rechazar/expirar una solicitud de efectivo NO liberaba el cupo.
-- GestorPanel.reject() y AdminPanel solo marcaban cash_payment_requests
-- como 'rejected' (y expire_pending_cash_requests como 'expired') pero la
-- inscripcion event_registrations quedaba 'pending' para siempre, ocupando
-- cupo invisible (no sale en la lista de jugadores, que solo muestra
-- confirmados). Caso real: Jorge luis santos en "Ronda Mundial Mixta"
-- (2 solicitudes rechazadas, cupo #20 bloqueado 2 dias) + 3 zombies mas
-- en eventos finalizados (arnulfo, Hector, Cristianeef15).

-- 1) RPC atomico de rechazo (espejo de admin_approve_cash_request):
--    rechaza la solicitud Y cancela la inscripcion 'pending' de efectivo si
--    el usuario no tiene otra solicitud viva (approved o pending sin vencer)
--    para ese evento. La cancelacion dispara tr_promote_waitlist_on_cancel
--    (promueve al primero de la lista de espera en eventos open/active).
create or replace function public.admin_reject_cash_request(p_request_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_caller uuid; v_ok boolean; v_r record; v_released boolean := false;
begin
  if auth.role() <> 'service_role' then
    select id, (role in ('admin','gestor')) into v_caller, v_ok from public.users where auth_id=(select auth.uid());
    if v_caller is null or not v_ok then raise exception 'unauthorized: solo admin/gestor'; end if;
  end if;
  select * into v_r from public.cash_payment_requests where id = p_request_id for update;
  if not found then raise exception 'solicitud no encontrada'; end if;
  if v_r.status <> 'pending' then raise exception 'la solicitud no esta pendiente (estado: %)', v_r.status; end if;

  update public.cash_payment_requests
     set status = 'rejected', gestor_id = coalesce(v_caller, gestor_id)
   where id = p_request_id;

  if not exists (
    select 1 from public.cash_payment_requests c
    where c.event_id = v_r.event_id and c.user_id = v_r.user_id and c.id <> p_request_id
      and (c.status = 'approved' or (c.status = 'pending' and (c.expires_at is null or c.expires_at > now())))
  ) then
    update public.event_registrations
       set status = 'cancelled'
     where event_id = v_r.event_id and user_id = v_r.user_id
       and status = 'pending' and metodo_pago = 'efectivo';
    v_released := found;
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_r.user_id, 'event_id', v_r.event_id, 'spot_released', v_released);
end;$function$;

revoke execute on function public.admin_reject_cash_request(bigint) from public, anon;
grant execute on function public.admin_reject_cash_request(bigint) to authenticated, service_role;

-- 2) expire_pending_cash_requests ahora tambien libera cupos zombie:
--    cancela regs 'pending' de efectivo cuyo dueno no tiene NINGUNA solicitud
--    viva para ese evento (cubre expiradas y rechazos viejos del cliente en
--    cache). Solo toca regs que SI tienen al menos una solicitud (defensivo)
--    y metodo_pago='efectivo' (no toca 'waitlist_promoted' en proceso de pago).
create or replace function public.expire_pending_cash_requests()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) not in ('admin','gestor') then
      raise exception 'unauthorized: solo admin/gestor';
    end if;
  end if;
  update public.cash_payment_requests set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics v_count = row_count;

  update public.event_registrations r
     set status = 'cancelled'
   where r.status = 'pending' and r.metodo_pago = 'efectivo'
     and exists (select 1 from public.cash_payment_requests c
                 where c.event_id = r.event_id and c.user_id = r.user_id)
     and not exists (
       select 1 from public.cash_payment_requests c
       where c.event_id = r.event_id and c.user_id = r.user_id
         and (c.status = 'approved' or (c.status = 'pending' and (c.expires_at is null or c.expires_at > now())))
     );
  return v_count;
end;$function$;

-- 3) Cron cada 30 min: sin esto la limpieza solo corria cuando un admin
--    abria la pantalla de aprobaciones (asi quedo zombie el caso Hector).
select cron.schedule('expire-cash-requests', '*/30 * * * *', $$select public.expire_pending_cash_requests()$$);
