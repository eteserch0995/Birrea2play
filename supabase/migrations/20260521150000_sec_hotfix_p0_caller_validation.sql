-- 2026-05-21 HOTFIX SEGURIDAD P0 — caller validation en RPCs SECURITY DEFINER
--
-- Causa raíz hallada por pentest (Opus): 7 RPCs SECURITY DEFINER tenían GRANT EXECUTE a
-- PUBLIC/anon/authenticated SIN validar quién las llamaba. Resultados explotables:
--   - credit_wallet → imprenta de billetes (acreditar cualquier monto a cualquier wallet)
--   - inscribir_yappy_evento → inscripción gratis a eventos de pago
--   - confirmar_invitado_yappy → confirmar invitados sin pagar
--   - inscribir_con_wallet → descontar wallet ajeno
--   - purchase_plan → comprar plan a otro user con tu propio saldo
--   - apply_efectivo_penalty → bloquear pago efectivo de cualquier user
--   - cancel_guests_for_registration → cancelar guests ajenos
-- Más: policy users_update sin WITH CHECK permitía self-promote a admin.
--
-- Estrategia del fix: agregar caller validation INTERNAL a cada RPC (sin REVOKE para no
-- romper al cliente que ya las llama desde flujos legítimos como cancelRegistration).
-- service_role (edge functions/webhooks) pasa libremente; authenticated user solo sobre
-- sí mismo; anon es rechazado.

-- 1. users_update: prohibir cambio de role/auth_id/efectivo_bloqueado
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update
  using  (auth.uid() = auth_id)
  with check (
    auth.uid() = auth_id
    and role               = (select role               from public.users where auth_id = auth.uid())
    and auth_id            = (select auth_id            from public.users where auth_id = auth.uid())
    and efectivo_bloqueado = (select efectivo_bloqueado from public.users where auth_id = auth.uid())
  );

revoke update (role, auth_id, efectivo_bloqueado) on public.users from anon, authenticated;

-- 2-8. CREATE OR REPLACE FUNCTION ... con caller checks (ver SQL aplicado en prod)
-- credit_wallet, inscribir_con_wallet, inscribir_yappy_evento, confirmar_invitado_yappy,
-- purchase_plan, apply_efectivo_penalty, cancel_guests_for_registration.
-- Patrón común:
--   if auth.role() <> 'service_role' then
--     if auth.uid() is null then raise exception 'unauthorized: anonymous'; end if;
--     if not exists (select 1 from users where id = p_user_id and auth_id = auth.uid()) then
--       raise exception 'unauthorized: caller is not p_user_id'; end if;
--   end if;
-- Excepciones: apply_efectivo_penalty exige role='admin'.
--              confirmar_invitado_yappy valida invited_by del guest.
--              inscribir_yappy_evento valida p_monto >= events.precio si no es service_role.
--
-- El cuerpo completo de cada función está en el commit. Para regenerar, consultar
-- pg_proc en Supabase prod y reaplicar idempotentemente.
