-- Fix: join_event_waitlist contaba solo event_registrations e ignoraba
-- event_guests y la cuota por genero (cupos_hombres/cupos_mujeres).
-- Caso real (2026-06-04, evento Mixto 14H/6M de 20 cupos): 16 regs activas +
-- 4 invitados = 20/20 lleno, pero el RPC veia 16 < 20 y rechazaba la lista de
-- espera con "El evento tiene cupos disponibles".
--
-- Regla nueva de ocupacion (paridad con computeEventCapacity del cliente):
--   ocupados = regs (confirmed|pending)
--            + guests (confirmed|pending_payment) cuyo invitador siga activo
-- Ademas, en eventos Mixto con desglose por genero, el aspirante puede entrar
-- a la lista si SU genero esta lleno aunque el total tenga espacio.

create or replace function public.join_event_waitlist(p_user_id uuid, p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event           record;
  v_user_genero     text;
  v_ocupados        integer;
  v_ocupados_genero integer;
  v_cupo_genero     integer;
  v_lleno           boolean;
  v_position        integer;
begin
  -- Seguridad: SECURITY DEFINER expuesto a authenticated -> validar caller.
  if auth.role() <> 'service_role' then
    if (select auth.uid()) is null then raise exception 'unauthorized: anonymous'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = (select auth.uid())) then
      raise exception 'unauthorized: caller is not p_user_id';
    end if;
  end if;

  select genero, cupos_ilimitado, cupos_total, cupos_hombres, cupos_mujeres, status
    into v_event from public.events where id = p_event_id;
  if not found then raise exception 'Evento no encontrado'; end if;
  if v_event.status <> 'open' then raise exception 'El evento no esta abierto para inscripciones'; end if;
  if v_event.cupos_ilimitado is true then raise exception 'El evento tiene cupos ilimitados, inscribite directamente'; end if;

  -- Ya tiene fila activa: idempotente (devolver posicion si esta en waitlist).
  if exists (select 1 from public.event_registrations
             where event_id = p_event_id and user_id = p_user_id and status in ('confirmed','pending','waitlist')) then
    select count(*) into v_position from public.event_registrations
      where event_id = p_event_id and status = 'waitlist'
        and created_at <= (select created_at from public.event_registrations where event_id = p_event_id and user_id = p_user_id);
    return coalesce(v_position, 0);
  end if;

  -- Ocupacion REAL: inscripciones activas + invitados activos (el invitado
  -- cuenta solo si su invitador sigue activo, igual que filterActiveEventGuests).
  select
    (select count(*) from public.event_registrations
       where event_id = p_event_id and status in ('confirmed','pending'))
    +
    (select count(*) from public.event_guests g
       where g.event_id = p_event_id
         and g.status in ('confirmed','pending_payment')
         and (g.invited_by is null or exists (
           select 1 from public.event_registrations r2
           where r2.event_id = p_event_id and r2.user_id = g.invited_by
             and r2.status in ('confirmed','pending'))))
  into v_ocupados;

  v_lleno := v_ocupados >= v_event.cupos_total;

  -- Cuota por genero (Mixto con desglose): si el bucket del aspirante esta
  -- lleno tambien se permite lista de espera, aunque el total tenga espacio.
  if not v_lleno and v_event.genero = 'Mixto'
     and v_event.cupos_hombres is not null and v_event.cupos_mujeres is not null then
    select genero into v_user_genero from public.users where id = p_user_id;
    if v_user_genero in ('Masculino','Femenino') then
      v_cupo_genero := case v_user_genero
        when 'Masculino' then v_event.cupos_hombres
        else v_event.cupos_mujeres end;
      select
        (select count(*) from public.event_registrations r
           join public.users u on u.id = r.user_id
           where r.event_id = p_event_id and r.status in ('confirmed','pending')
             and u.genero = v_user_genero)
        +
        (select count(*) from public.event_guests g
           where g.event_id = p_event_id
             and g.status in ('confirmed','pending_payment')
             and g.genero = v_user_genero
             and (g.invited_by is null or exists (
               select 1 from public.event_registrations r2
               where r2.event_id = p_event_id and r2.user_id = g.invited_by
                 and r2.status in ('confirmed','pending'))))
      into v_ocupados_genero;
      v_lleno := v_ocupados_genero >= v_cupo_genero;
    end if;
  end if;

  if not v_lleno then
    raise exception 'El evento tiene cupos disponibles, inscribite directamente';
  end if;

  insert into public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  values (p_event_id, p_user_id, null, 0, 'waitlist')
  on conflict (event_id, user_id) do update set status='waitlist', metodo_pago=null, monto_pagado=0;

  select count(*) into v_position from public.event_registrations
    where event_id = p_event_id and status = 'waitlist'
      and created_at <= (select created_at from public.event_registrations where event_id = p_event_id and user_id = p_user_id);
  return coalesce(v_position, 1);
end;
$function$;
