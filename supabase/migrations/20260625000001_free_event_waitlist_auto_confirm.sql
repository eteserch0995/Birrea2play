-- Eventos gratis: al liberarse un cupo, el primero de la lista de espera
-- queda confirmado automáticamente. No debe pasar por un flujo de pago.

create or replace function public.promote_waitlist(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_next   record;
  v_precio numeric;
begin
  select coalesce(precio, 0)
    into v_precio
    from public.events
   where id = p_event_id
     and status in ('open', 'active');

  if not found then
    return null;
  end if;

  -- Promover al primero, en orden de llegada, que cumpla capacidad total
  -- y cuota de género. El trigger de capacidad valida cada UPDATE.
  for v_next in
    select r.id, r.user_id
      from public.event_registrations r
     where r.event_id = p_event_id
       and r.status = 'waitlist'
     order by r.created_at asc
     for update of r skip locked
  loop
    begin
      if v_precio <= 0 then
        update public.event_registrations
           set status       = 'confirmed',
               metodo_pago  = 'gratis',
               monto_pagado = 0,
               created_at   = now()
         where id = v_next.id;
      else
        update public.event_registrations
           set status       = 'pending',
               metodo_pago  = 'waitlist_promoted',
               monto_pagado = 0,
               created_at   = now()
         where id = v_next.id;
      end if;

      return v_next.user_id;
    exception when others then
      continue;
    end;
  end loop;

  return null;
end;
$function$;

-- Reparar promociones ya estancadas en eventos gratis, incluido el caso
-- reportado hoy. No toca pagos reales ni eventos con precio mayor que cero.
update public.event_registrations r
   set status       = 'confirmed',
       metodo_pago  = 'gratis',
       monto_pagado = 0
  from public.events e
 where e.id = r.event_id
   and coalesce(e.precio, 0) <= 0
   and e.status in ('open', 'active')
   and r.status = 'pending'
   and r.metodo_pago = 'waitlist_promoted'
   and coalesce(r.monto_pagado, 0) = 0;
