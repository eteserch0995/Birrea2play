-- 2026-06-03 — Aprobación atómica de efectivo (Acción 2) + lockdown de expire (P1 auditoría).
create or replace function public.admin_approve_cash_request(p_request_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_caller uuid; v_ok boolean; v_r record;
begin
  if auth.role() <> 'service_role' then
    select id, (role in ('admin','gestor')) into v_caller, v_ok from public.users where auth_id=(select auth.uid());
    if v_caller is null or not v_ok then raise exception 'unauthorized: solo admin/gestor'; end if;
  end if;
  select * into v_r from public.cash_payment_requests where id = p_request_id for update;
  if not found then raise exception 'solicitud no encontrada'; end if;
  if v_r.status <> 'pending' then raise exception 'la solicitud no esta pendiente (estado: %)', v_r.status; end if;
  if v_r.expires_at is not null and v_r.expires_at < now() then
    update public.cash_payment_requests set status='expired' where id=p_request_id;
    raise exception 'la solicitud expiro';
  end if;
  insert into public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
    values (v_r.event_id, v_r.user_id, 'efectivo', v_r.amount, 'confirmed')
    on conflict (event_id, user_id) do update set metodo_pago='efectivo', monto_pagado=v_r.amount, status='confirmed';
  update public.cash_payment_requests set status='approved' where id = p_request_id;
  return jsonb_build_object('ok', true, 'user_id', v_r.user_id, 'event_id', v_r.event_id);
end;$$;
revoke execute on function public.admin_approve_cash_request(bigint) from public, anon;
grant  execute on function public.admin_approve_cash_request(bigint) to authenticated, service_role;

-- expire solo admin/gestor (o service_role)
create or replace function public.expire_pending_cash_requests()
returns integer language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
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
  return v_count;
end;$$;
