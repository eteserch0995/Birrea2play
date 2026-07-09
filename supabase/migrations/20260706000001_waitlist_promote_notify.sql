-- ════════════════════════════════════════════════════════════════════════
-- FIX ETERNO waitlist (2026-07-06, reporte Sergio evento "Birria Mixta 5vs5"):
-- al liberarse un cupo la promoción SÍ dispara (trigger _trfn_promote_waitlist
-- _on_cancel), pero al promovido NUNCA se le avisaba de forma confiable: la
-- notificación era client-side (notifyPromotedFromWaitlist) y solo corría en la
-- sesión del que cancelaba. Resultado: el promovido queda 'pending/
-- waitlist_promoted' ocupando cupo sin enterarse, no paga, y el evento sigue
-- viéndose lleno hasta que el TTL de 4h lo cancela (y vuelve a promover en
-- silencio). Caso real hoy: user 5ac56775… promovido 14:46 sin aviso.
--
-- Solución: promote_waitlist notifica al promovido SERVER-SIDE vía
-- net.http_post → edge waitlist-notify (push + email). Cubre TODAS las rutas de
-- cancelación (usuario, invitado, efectivo rechazado, admin, cron TTL) porque
-- todas terminan llamando a promote_waitlist. El aviso es best-effort: si
-- net/pg_net fallara, la promoción NO se revierte.
--
-- Mantiene el comportamiento de 20260625000001 (evento gratis → confirmado
-- automático; evento con precio → pending 'waitlist_promoted' con ventana 4h)
-- y el sellado de created_at = now() del TTL (20260604000004).
-- ════════════════════════════════════════════════════════════════════════

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
    return null;  -- evento inexistente o no activo (ej. se está cancelando)
  end if;

  -- Promover al primero, en orden de llegada, que cumpla capacidad total y
  -- cuota de género. El trigger de capacidad valida cada UPDATE; si rechaza
  -- (bucket de género lleno) probamos el siguiente.
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
               created_at   = now()  -- sella el inicio de su ventana de 4h
         where id = v_next.id;
      end if;

      -- Aviso server-side al promovido (best-effort, nunca revierte la promoción).
      begin
        perform net.http_post(
          url     := 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/waitlist-notify',
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'x-sync-secret', '9f3c1ade7b62408d5e1142aa0c7be93d6f08a214'
                     ),
          body    := jsonb_build_object(
                       'user_id',  v_next.user_id,
                       'event_id', p_event_id,
                       'free',     (v_precio <= 0)
                     )
        );
      exception when others then
        null;  -- pg_net caído / no instalado: la promoción se mantiene igual
      end;

      return v_next.user_id;
    exception when others then
      continue;  -- no cabe (género/total): probar el siguiente
    end;
  end loop;

  return null;
end;
$function$;
