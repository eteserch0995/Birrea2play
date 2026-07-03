-- TTL del promovido de lista de espera (decision Sergio 2026-06-04):
-- el cupo liberado queda RESERVADO solo para el promovido durante 4 horas
-- (mismo plazo que el efectivo). Si no paga, el cron lo cancela y el trigger
-- promueve al siguiente de la lista; si no hay nadie, el cupo queda libre
-- para cualquiera.

-- 1) promote_waitlist sella el MOMENTO de la promocion en created_at
--    (la fila ya salio de la lista; su antiguedad de waitlist ya no se usa).
--    Sin esto el TTL contaria desde que ENTRO a la lista y podria vencer
--    al instante.
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
        set status='pending', metodo_pago='waitlist_promoted', monto_pagado=0,
            created_at=now()  -- sella el inicio de su ventana de 4h
        where id = v_next.id;
      return v_next.user_id;
    exception when others then
      continue;  -- no cabe (genero/total): probar el siguiente
    end;
  end loop;
  return null;
end;
$function$;

-- 2) El cron (cada 30 min) cancela promovidos que no pagaron en 4h.
--    La cancelacion dispara el trigger de promocion -> cascada al siguiente.
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

  -- Reservas Yappy huerfanas (cliente cerro el browser a mitad del pago)
  update public.event_registrations
     set status = 'cancelled'
   where status = 'pending' and metodo_pago = 'yappy_boton'
     and coalesce(monto_pagado, 0) = 0
     and created_at < now() - interval '20 minutes';

  -- Promovidos de lista de espera que no pagaron en su ventana de 4h
  -- (created_at = momento de la promocion, sellado por promote_waitlist).
  update public.event_registrations
     set status = 'cancelled'
   where status = 'pending' and metodo_pago = 'waitlist_promoted'
     and created_at < now() - interval '4 hours';

  return v_count;
end;
$function$;
