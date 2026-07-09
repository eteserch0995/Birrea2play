-- ============================================================
-- 2026-07-04 — Canchas v3 (4/5): notificaciones automáticas
-- Aplicada a prod vía MCP como `canchas_v3_notificaciones`.
-- Trigger sobre cancha_reservas → edge fn cancha-notify (push+email
-- vía send-notification). Mismo patrón que trg_notify_new_event:
-- secreto embebido + exception swallow (jamás rompe la operación).
--
-- ⚠️ El valor real de <WC_SYNC_SECRET> vive en los Supabase secrets y
-- en la definición aplicada en prod (no se versiona en el repo).
-- Si se re-aplica este archivo, reemplazar el placeholder por el
-- secreto real (el mismo de wc-notify / wc-sync-results).
-- ============================================================

create or replace function public._trfn_cancha_reserva_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mode text := null;
begin
  if tg_op = 'INSERT' then
    -- Solicitud sin abono requerido: notificar de una (con abono se notifica al pagar)
    if new.status = 'pending' and new.estado_pago = 'no_requerido' then
      v_mode := 'nueva-solicitud';
    end if;
  else
    if new.estado_pago = 'abono_pagado' and coalesce(old.estado_pago,'') <> 'abono_pagado' then
      v_mode := 'nueva-solicitud';
    elsif new.status = 'approved' and old.status = 'pending' then
      v_mode := 'reserva-aprobada';
    elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
      v_mode := 'reserva-rechazada';
    elsif new.estado_pago = 'pagado' and coalesce(old.estado_pago,'') = 'abono_pagado' then
      v_mode := 'saldo-pagado';
    end if;
  end if;

  if v_mode is not null then
    begin
      perform net.http_post(
        url := 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/cancha-notify',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', '<WC_SYNC_SECRET>'),
        body := jsonb_build_object('mode', v_mode, 'reserva_id', new.id)
      );
    exception when others then
      null; -- jamás romper la reserva por un fallo de notificación
    end;
  end if;

  return new;
end;
$$;

revoke execute on function public._trfn_cancha_reserva_notify() from public, anon, authenticated;

drop trigger if exists trg_cancha_reserva_notify on public.cancha_reservas;
create trigger trg_cancha_reserva_notify
  after insert or update on public.cancha_reservas
  for each row execute function public._trfn_cancha_reserva_notify();
