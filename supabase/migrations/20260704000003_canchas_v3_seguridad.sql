-- ============================================================
-- 2026-07-04 — Canchas v3 (3/5): seguridad
-- Aplicada a prod vía MCP como `canchas_v3_seguridad`.
-- Hallazgos de la revisión: el gestor podía auto-aprobarse por RLS,
-- INSERT directo sin rol/montos server-side, y RPCs legacy v1 con
-- GRANT a anon (cancha_auto_pay invocable sin login).
-- ============================================================

-- (1) INSERT directo eliminado: toda creación pasa por crear_cancha_reserva (SECDEF)
drop policy if exists reservas_insert_gestor on public.cancha_reservas;

-- (2) UPDATE directo solo admin global: aprobar/rechazar/cancelar/pagar van por RPC.
--     Antes el gestor dueño podía hacer update({status:'approved', estado_pago:'pagado'})
--     sobre su propia fila desde devtools.
drop policy if exists reservas_update on public.cancha_reservas;
create policy reservas_update_admin_only on public.cancha_reservas
  for update
  using (
    (select u.role from public.users u where u.auth_id = (select auth.uid())) = 'admin'
  );

-- (3) Legacy v1 (cancha_slots, 0 filas, sin uso): revocar de clientes.
--     cancha_auto_pay tenía GRANT a authenticated/PUBLIC y su caller-check
--     evalúa NULL para anon (no levanta excepción) → lockdown total a service_role.
revoke execute on function public.cancha_auto_pay(uuid) from public, anon, authenticated;
revoke execute on function public.gestor_liberar_cancha(uuid) from public, anon, authenticated;
revoke execute on function public.claim_cancha_slot(uuid) from public, anon, authenticated;

-- (4) Cron del modelo legacy apagado (pagaba a la cancha desde el pool de un
--     evento vinculado por cancha_slot_id — 0 eventos lo usan; el modelo v3
--     recauda abono+saldo y liquida con marcar_reserva_liquidada)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cancha-24h-check') then
    perform cron.unschedule('cancha-24h-check');
  end if;
end $$;
