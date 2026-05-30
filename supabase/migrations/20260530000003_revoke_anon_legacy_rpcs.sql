-- ============================================================
-- 2026-05-30 — Hardening: quitar EXECUTE de anon en RPCs legacy
-- ============================================================
-- Las funciones wc_* del Mundial ya NO son ejecutables por anon
-- (sesion 8, wc_revoke_public). Estas RPCs SECURITY DEFINER de la app de
-- eventos todavia eran ejecutables por anon.
--
-- OJO (trampa [[feedback-supabase-default-privileges-anon]]): el EXECUTE de
-- estas funciones NO estaba grantado a anon directamente, sino a PUBLIC
-- (ACL "=X/..."). anon lo hereda de PUBLIC, asi que REVOKE ... FROM anon es
-- un no-op. Hay que REVOKE ... FROM PUBLIC. Pero PUBLIC tambien cubre a
-- authenticated en funciones que no tengan grant explicito, por eso se
-- re-GRANT a authenticated/service_role para no romper a los usuarios
-- logueados ni a las edge functions (que usan service_role).
--
-- Todas estas RPCs son acciones de usuario autenticado / gestor / admin y ya
-- validan caller internamente ([[feedback-rls-security-definer-caller-check]]),
-- asi que esto es defensa en profundidad + limpia el advisor.
--
-- NO se tocan:
--   - Triggers / event_trigger (no son llamables via PostgREST).
--   - create_user_profile: la usa el signup (sesion puede ser anon). Intacta.
--
-- Reversible: grant execute on function public.<fn>(<args>) to anon;
-- ------------------------------------------------------------

revoke execute on function public.add_web_push_sub(jsonb)                           from public, anon;
grant  execute on function public.add_web_push_sub(jsonb)                           to authenticated, service_role;

revoke execute on function public.admin_set_efectivo_bloqueado(uuid, boolean)       from public, anon;
grant  execute on function public.admin_set_efectivo_bloqueado(uuid, boolean)       to authenticated, service_role;

revoke execute on function public.apply_efectivo_penalty(uuid)                      from public, anon;
grant  execute on function public.apply_efectivo_penalty(uuid)                      to authenticated, service_role;

revoke execute on function public.approve_gender_change(uuid)                       from public, anon;
grant  execute on function public.approve_gender_change(uuid)                       to authenticated, service_role;

revoke execute on function public.cancel_cancha_slot_reserva(uuid)                  from public, anon;
grant  execute on function public.cancel_cancha_slot_reserva(uuid)                  to authenticated, service_role;

revoke execute on function public.cancel_guests_for_registration(uuid, uuid)        from public, anon;
grant  execute on function public.cancel_guests_for_registration(uuid, uuid)        to authenticated, service_role;

revoke execute on function public.claim_cancha_slot(uuid)                           from public, anon;
grant  execute on function public.claim_cancha_slot(uuid)                           to authenticated, service_role;

revoke execute on function public.confirmar_invitado_yappy(uuid, numeric, text)     from public, anon;
grant  execute on function public.confirmar_invitado_yappy(uuid, numeric, text)     to authenticated, service_role;

revoke execute on function public.credit_wallet(uuid, numeric, text, text)          from public, anon;
grant  execute on function public.credit_wallet(uuid, numeric, text, text)          to authenticated, service_role;

revoke execute on function public.declare_mvp(uuid, uuid, integer)                  from public, anon;
grant  execute on function public.declare_mvp(uuid, uuid, integer)                  to authenticated, service_role;

revoke execute on function public.get_user_active_plan(uuid)                        from public, anon;
grant  execute on function public.get_user_active_plan(uuid)                        to authenticated, service_role;

revoke execute on function public.inscribir_con_wallet(uuid, uuid, numeric, text)   from public, anon;
grant  execute on function public.inscribir_con_wallet(uuid, uuid, numeric, text)   to authenticated, service_role;

revoke execute on function public.inscribir_yappy_evento(uuid, uuid, numeric, text) from public, anon;
grant  execute on function public.inscribir_yappy_evento(uuid, uuid, numeric, text) to authenticated, service_role;

revoke execute on function public.purchase_plan(uuid, uuid)                         from public, anon;
grant  execute on function public.purchase_plan(uuid, uuid)                         to authenticated, service_role;

revoke execute on function public.remove_web_push_sub(text)                         from public, anon;
grant  execute on function public.remove_web_push_sub(text)                         to authenticated, service_role;
