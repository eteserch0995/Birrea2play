-- 2026-06-03 — Auto-finalizar eventos vencidos + cron (Acción 3 de la auditoría de efectivo).
-- Cierra eventos cuyo (fecha+hora+duracion) ya pasó (hora Panamá), con guard de 2h para no
-- re-cerrar un evento recién reactivado/editado.
create or replace function public.auto_finish_overdue_events()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update public.events
  set status = 'finished', event_finished_at = coalesce(event_finished_at, now())
  where status in ('active','open')
    and ((fecha + hora)::timestamp + (coalesce(duracion_horas,1) || ' hours')::interval)
        < (now() at time zone 'America/Panama')
    and (updated_at is null or updated_at < now() - interval '2 hours');
  get diagnostics v_count = row_count;
  return v_count;
end;$$;
revoke execute on function public.auto_finish_overdue_events() from public, anon;
grant  execute on function public.auto_finish_overdue_events() to service_role;

-- Cron cada 30 min (upsert por nombre).
select cron.schedule('auto-finish-events', '*/30 * * * *', $$ select public.auto_finish_overdue_events(); $$);
