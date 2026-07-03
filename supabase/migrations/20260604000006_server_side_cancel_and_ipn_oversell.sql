-- ════════════════════════════════════════════════════════════════════════
-- FIX 2026-06-04 (auditoría 34 agentes): cancelación + refund server-side, y
-- honor+flag de sobreventa por IPN Yappy tardío. Decisiones de Sergio:
--   (1) cancelación/refund se calcula y aplica 100% server-side (el cliente
--       ya no decide monto ni %); cierra #4 (refund manipulable),
--       #5 (doble refund por doble-tap), #6 (zona horaria del 48h).
--   (2) Pago Yappy que llega tarde a evento lleno: SE HONRA (el usuario ya
--       pagó) y se registra una alerta de sobrecupo para el admin.
-- NOTA: el lockdown de RLS (#18/#19) y la revocación de credit_wallet (#3
--       acuñar créditos) se hace MAÑANA tras el evento (más superficie).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.oversell_alerts (
  id          bigint generated always as identity primary key,
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  metodo      text,
  monto       numeric,
  detalle     text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.oversell_alerts enable row level security;
drop policy if exists oversell_admin_all on public.oversell_alerts;
create policy oversell_admin_all on public.oversell_alerts
  for all to authenticated
  using ((select role from public.users where auth_id = auth.uid()) in ('admin','gestor'))
  with check ((select role from public.users where auth_id = auth.uid()) in ('admin','gestor'));

create or replace function public.cancel_event_registration(
  p_registration_id uuid,
  p_cancel_guests   boolean default false
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
  v_can_refund   boolean;
  v_paid         numeric := 0;
  v_pct          numeric;
  v_refund       numeric := 0;
  v_wallet_id    uuid;
  v_guests       integer := 0;
  v_penalty      boolean := false;
begin
  if auth.role() <> 'service_role' then
    if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
    select id, role into v_caller_id, v_caller_role from public.users where auth_id = v_uid;
  end if;

  select * into v_reg from public.event_registrations where id = p_registration_id for update;
  if not found then raise exception 'inscripción no encontrada'; end if;

  if auth.role() <> 'service_role'
     and v_reg.user_id <> v_caller_id
     and coalesce(v_caller_role,'') not in ('admin','gestor') then
    raise exception 'unauthorized: no es tu inscripción';
  end if;

  if v_reg.status = 'cancelled' then
    return jsonb_build_object('alreadyCancelled', true, 'refunded', false, 'amount', 0, 'pct', 0,
                              'guestsCancelled', 0, 'penaltyApplied', false);
  end if;

  select fecha, hora, status into v_ev from public.events where id = v_reg.event_id;

  v_start := ((v_ev.fecha::text || ' ' || coalesce(v_ev.hora::text, '00:00:00'))::timestamp)
             at time zone 'America/Panama';
  v_can_refund := (v_start - now()) >= interval '48 hours';

  if v_reg.metodo_pago in ('wallet','yappy_boton') and coalesce(v_reg.monto_pagado,0) > 0 then
    v_paid := v_reg.monto_pagado;
  elsif v_reg.metodo_pago = 'efectivo' and coalesce(v_reg.monto_pagado,0) > 0 then
    if exists (select 1 from public.cash_payment_requests c
               where c.user_id = v_reg.user_id and c.event_id = v_reg.event_id
                 and c.status = 'approved' and c.cobrado = true) then
      v_paid := v_reg.monto_pagado;
    end if;
  end if;

  update public.event_registrations set status = 'cancelled' where id = p_registration_id;

  if p_cancel_guests then
    begin
      v_guests := coalesce(public.cancel_guests_for_registration(v_reg.user_id, v_reg.event_id), 0);
    exception when others then v_guests := 0; end;
  end if;

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

  if not v_can_refund and v_reg.metodo_pago in ('efectivo','pending') and v_paid = 0 then
    begin perform public.apply_efectivo_penalty(v_reg.user_id); v_penalty := true;
    exception when others then null; end;
  end if;

  return jsonb_build_object(
    'alreadyCancelled', false, 'refunded', v_refund > 0, 'amount', v_refund, 'pct', v_pct,
    'guestsCancelled', v_guests, 'penaltyApplied', v_penalty);
end;
$function$;

revoke execute on function public.cancel_event_registration(uuid, boolean) from public, anon;
grant execute on function public.cancel_event_registration(uuid, boolean) to authenticated, service_role;

-- inscribir_yappy_evento: HONRA el pago y, si confirma en evento ya lleno
-- (reserva del user fue cancelada y el cupo reasignado), registra alerta de
-- sobrecupo para el admin. El insert de alerta es tolerante: nunca bloquea el cobro.
create or replace function public.inscribir_yappy_evento(p_user_id uuid, p_event_id uuid, p_monto numeric, p_order_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_precio numeric;
  v_ev     record;
  v_ocup   integer;
  v_ya_ocupaba boolean;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null then raise exception 'unauthorized: anonymous caller'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = auth.uid()) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
    select precio into v_precio from public.events where id = p_event_id;
    if v_precio is null then raise exception 'Evento no existe'; end if;
    if p_monto < v_precio then
      raise exception 'monto insuficiente: % < precio % del evento', p_monto, v_precio;
    end if;
  end if;

  if exists (select 1 from public.event_registrations
             where event_id = p_event_id and user_id = p_user_id and status = 'confirmed') then
    return;
  end if;

  select cupos_ilimitado, cupos_total into v_ev from public.events where id = p_event_id;
  v_ya_ocupaba := exists (select 1 from public.event_registrations
    where event_id = p_event_id and user_id = p_user_id and status in ('confirmed','pending'));

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
