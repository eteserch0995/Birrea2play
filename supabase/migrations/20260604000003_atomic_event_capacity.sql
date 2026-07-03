-- Fix race condition de cupos (caso real 2026-06-04: Oscar Cowen y Fernando
-- Rodriguez pagaron Yappy con 25 seg de diferencia por el ULTIMO cupo de
-- "Ronda Mundial Mixta" -> 21/20). La validacion de capacidad era solo-UI
-- (checkCapacity en el cliente) y el IPN de Yappy inscribe post-pago sin
-- validar. Solucion en 3 piezas:
--   1) Trigger BEFORE INSERT/UPDATE con SELECT ... FOR UPDATE del evento:
--      serializa las inscripciones concurrentes del mismo evento y rechaza
--      ocupar cupo si esta lleno (total y por genero en Mixto con cuota).
--      Bypass service_role: un pago YA cobrado que entra por IPN/webhook no
--      se rechaza (el cierre del hueco Yappy es la RESERVA previa que el
--      cliente crea como authenticated y SI pasa por este trigger).
--   2) promote_waitlist ahora promueve al primero EN ORDEN cuyo genero tenga
--      cupo (antes podia promover a un hombre al liberarse cupo de mujer y
--      el promovido no podia pagar) y tolera el rechazo del trigger.
--   3) Limpieza de reservas Yappy huerfanas (cliente cerro el browser a
--      mitad del pago) en expire_pending_cash_requests (cron cada 30 min).

-- ── 1) Trigger de capacidad ────────────────────────────────────────────────
create or replace function public._trfn_enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ev          record;
  v_genero      text;
  v_ocup        integer;
  v_cupo_genero integer;
begin
  -- Solo validar cuando la fila PASA a ocupar cupo
  if TG_TABLE_NAME = 'event_registrations' then
    if NEW.status not in ('confirmed','pending') then return NEW; end if;
    if TG_OP = 'UPDATE' and OLD.status in ('confirmed','pending') then return NEW; end if;
  else
    if NEW.status not in ('confirmed','pending_payment') then return NEW; end if;
    if TG_OP = 'UPDATE' and OLD.status in ('confirmed','pending_payment') then return NEW; end if;
  end if;

  -- Pagos ya cobrados via IPN/webhook: no rechazar dinero real.
  if auth.role() = 'service_role' then return NEW; end if;

  select genero, cupos_ilimitado, cupos_total, cupos_hombres, cupos_mujeres
    into v_ev from public.events where id = NEW.event_id for update;  -- serializa por evento
  if not found then return NEW; end if;
  if v_ev.cupos_ilimitado is true or v_ev.cupos_total is null then return NEW; end if;

  -- Ocupacion total (excluyendo la fila previa de la misma identidad)
  select
    (select count(*) from public.event_registrations r
      where r.event_id = NEW.event_id and r.status in ('confirmed','pending')
        and (TG_TABLE_NAME <> 'event_registrations' or r.user_id <> NEW.user_id))
    +
    (select count(*) from public.event_guests g
      where g.event_id = NEW.event_id and g.status in ('confirmed','pending_payment')
        and (TG_TABLE_NAME <> 'event_guests' or g.id <> NEW.id)
        and (g.invited_by is null or exists (
          select 1 from public.event_registrations r2
          where r2.event_id = NEW.event_id and r2.user_id = g.invited_by
            and r2.status in ('confirmed','pending'))))
  into v_ocup;

  if v_ocup >= v_ev.cupos_total then
    raise exception 'Evento lleno (% de % cupos). No se realizo ningun cobro.', v_ocup, v_ev.cupos_total;
  end if;

  -- Cuota por genero (Mixto con desglose)
  if v_ev.genero = 'Mixto' and v_ev.cupos_hombres is not null and v_ev.cupos_mujeres is not null then
    if TG_TABLE_NAME = 'event_registrations' then
      select genero into v_genero from public.users where id = NEW.user_id;
    else
      v_genero := NEW.genero;
    end if;
    if v_genero in ('Masculino','Femenino') then
      v_cupo_genero := case v_genero when 'Masculino' then v_ev.cupos_hombres else v_ev.cupos_mujeres end;
      select
        (select count(*) from public.event_registrations r
          join public.users u on u.id = r.user_id
          where r.event_id = NEW.event_id and r.status in ('confirmed','pending') and u.genero = v_genero
            and (TG_TABLE_NAME <> 'event_registrations' or r.user_id <> NEW.user_id))
        +
        (select count(*) from public.event_guests g
          where g.event_id = NEW.event_id and g.status in ('confirmed','pending_payment') and g.genero = v_genero
            and (TG_TABLE_NAME <> 'event_guests' or g.id <> NEW.id)
            and (g.invited_by is null or exists (
              select 1 from public.event_registrations r2
              where r2.event_id = NEW.event_id and r2.user_id = g.invited_by
                and r2.status in ('confirmed','pending'))))
      into v_ocup;
      if v_ocup >= v_cupo_genero then
        raise exception 'No hay mas cupos de % (%/%). No se realizo ningun cobro.',
          case v_genero when 'Masculino' then 'hombres' else 'mujeres' end, v_ocup, v_cupo_genero;
      end if;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_capacity_evreg on public.event_registrations;
create trigger trg_capacity_evreg
  before insert or update on public.event_registrations
  for each row execute function public._trfn_enforce_event_capacity();

drop trigger if exists trg_capacity_guest on public.event_guests;
create trigger trg_capacity_guest
  before insert or update on public.event_guests
  for each row execute function public._trfn_enforce_event_capacity();

-- ── 2) promote_waitlist genero-aware y tolerante al trigger ────────────────
create or replace function public.promote_waitlist(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_next record;
begin
  -- No promover si el evento ya no esta activo (ej. se esta cancelando).
  if (select status from public.events where id = p_event_id) not in ('open','active') then
    return null;
  end if;
  -- Promover al primero EN ORDEN DE LLEGADA que quepa: el trigger de
  -- capacidad valida total + genero en el UPDATE; si lo rechaza (ej. se
  -- libero cupo de mujer y el candidato es hombre con bucket lleno),
  -- probamos el siguiente de la lista.
  for v_next in
    select r.id, r.user_id
    from public.event_registrations r
    where r.event_id = p_event_id and r.status = 'waitlist'
    order by r.created_at asc
    for update of r skip locked
  loop
    begin
      update public.event_registrations
        set status='pending', metodo_pago='waitlist_promoted', monto_pagado=0
        where id = v_next.id;
      return v_next.user_id;
    exception when others then
      continue;  -- no cabe (genero/total): probar el siguiente
    end;
  end loop;
  return null;
end;
$function$;

-- ── 3) Limpieza de reservas Yappy huerfanas (corre en el cron de 30 min) ───
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

  -- Cupos zombie de efectivo (rechazadas/expiradas sin solicitud viva)
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

  -- Reservas Yappy huerfanas: el cliente reserva 'pending' (yappy_boton,
  -- monto 0, created_at renovado) al iniciar el pago y la libera si falla;
  -- si cierra el browser queda colgada -> liberar tras 20 min. El IPN
  -- confirma con monto real > 0, nunca matchea este criterio.
  update public.event_registrations
     set status = 'cancelled'
   where status = 'pending' and metodo_pago = 'yappy_boton'
     and coalesce(monto_pagado, 0) = 0
     and created_at < now() - interval '20 minutes';

  return v_count;
end;
$function$;
