-- Admin quita a un inscrito (con cuenta) de un evento, con motivo, devolviendo
-- el 100% de lo pagado a sus créditos y SIN auto-promover la lista de espera
-- (el admin pone el reemplazo manualmente). Decisiones Sergio 2026-06-04.

create table if not exists public.event_removals (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references public.events(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  nombre        text,
  motivo        text not null,
  refund_amount numeric default 0,
  removed_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.event_removals enable row level security;
drop policy if exists event_removals_admin_all on public.event_removals;
create policy event_removals_admin_all on public.event_removals
  for all to authenticated
  using ((select role from public.users where auth_id = auth.uid()) in ('admin','gestor'))
  with check ((select role from public.users where auth_id = auth.uid()) in ('admin','gestor'));

-- Skip de auto-promoción de lista de espera (flag transaccional) para que el
-- reemplazo manual del admin no choque con una promoción automática.
create or replace function public._trfn_promote_waitlist_on_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_setting('app.skip_waitlist_promote', true) = '1' then return new; end if;
  if old.status in ('confirmed','pending') and new.status = 'cancelled' then
    perform public.promote_waitlist(new.event_id);
  end if;
  return new;
end;
$function$;

create or replace function public._trfn_promote_waitlist_on_guest_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_setting('app.skip_waitlist_promote', true) = '1' then
    return case when TG_OP = 'DELETE' then old else new end;
  end if;
  if TG_OP = 'DELETE' then
    if old.status in ('confirmed','pending_payment') then
      perform public.promote_waitlist(old.event_id);
    end if;
    return old;
  end if;
  if old.status in ('confirmed','pending_payment') and new.status = 'cancelled' then
    perform public.promote_waitlist(new.event_id);
  end if;
  return new;
end;
$function$;

create or replace function public.admin_remove_registration(p_registration_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid     uuid := (select auth.uid());
  v_caller  uuid;
  v_role    text;
  v_reg     record;
  v_paid    numeric := 0;
  v_refund  numeric := 0;
  v_wallet  uuid;
  v_nombre  text;
begin
  if auth.role() <> 'service_role' then
    if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
    select id, role into v_caller, v_role from public.users where auth_id = v_uid;
    if coalesce(v_role,'') not in ('admin','gestor') then
      raise exception 'unauthorized: solo admin/gestor';
    end if;
  end if;
  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'motivo requerido';
  end if;

  select * into v_reg from public.event_registrations where id = p_registration_id for update;
  if not found then raise exception 'inscripción no encontrada'; end if;
  if v_reg.status = 'cancelled' then
    return jsonb_build_object('alreadyCancelled', true, 'refunded', false, 'amount', 0);
  end if;

  if v_reg.metodo_pago in ('wallet','yappy_boton') and coalesce(v_reg.monto_pagado,0) > 0 then
    v_paid := v_reg.monto_pagado;
  elsif v_reg.metodo_pago = 'efectivo' and coalesce(v_reg.monto_pagado,0) > 0 then
    if exists (select 1 from public.cash_payment_requests c
               where c.user_id = v_reg.user_id and c.event_id = v_reg.event_id
                 and c.status = 'approved' and c.cobrado = true) then
      v_paid := v_reg.monto_pagado;
    end if;
  end if;

  perform set_config('app.skip_waitlist_promote', '1', true);

  update public.event_registrations set status = 'cancelled' where id = p_registration_id;

  v_refund := round(v_paid, 2);
  if v_refund > 0 then
    select id into v_wallet from public.wallets where user_id = v_reg.user_id;
    if v_wallet is not null then
      update public.wallets set balance = balance + v_refund where id = v_wallet;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
      values (v_wallet, 'reembolso', v_refund, 'Reembolso (100%) — removido del evento por el administrador');
    end if;
  end if;

  select nombre into v_nombre from public.users where id = v_reg.user_id;
  insert into public.event_removals (event_id, user_id, nombre, motivo, refund_amount, removed_by)
  values (v_reg.event_id, v_reg.user_id, v_nombre, btrim(p_motivo), v_refund, v_caller);

  return jsonb_build_object('ok', true, 'refunded', v_refund > 0, 'amount', v_refund,
                            'user_id', v_reg.user_id, 'nombre', v_nombre);
end;
$function$;

revoke execute on function public.admin_remove_registration(uuid, text) from public, anon;
grant execute on function public.admin_remove_registration(uuid, text) to authenticated, service_role;
