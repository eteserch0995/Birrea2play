-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: hotfix advisors seguridad
-- ============================================================
-- En Supabase, las funciones nuevas heredan EXECUTE a PUBLIC y a los
-- roles anon/authenticated/service_role automáticamente. Aunque cada
-- RPC tiene caller validation interno (patrón [[feedback-rls-security-definer-caller-check]]),
-- conviene revocar PUBLIC y anon para reducir el ataque superficial.
--
-- Queda permitido:  authenticated, service_role, postgres
-- Revocado:         PUBLIC, anon
--
-- Las RPCs admin (wc_admin_*) siguen accesibles a authenticated pero
-- internamente validan role='admin' o auth.role()='service_role'.
-- ────────────────────────────────────────────────────────────

revoke execute on function public.wc_create_pending_enrollment(uuid, text)      from public, anon;
revoke execute on function public.wc_pay_enrollment_wallet(uuid, uuid)          from public, anon;
revoke execute on function public.wc_pay_enrollment_yappy(uuid, uuid, numeric, text) from public, anon;
revoke execute on function public.wc_admin_grant_enrollment(uuid, text)         from public, anon;
revoke execute on function public.wc_submit_bonus_picks(uuid, uuid, uuid, uuid, text, int, text, int, int, int) from public, anon;
revoke execute on function public.wc_submit_survivor_pick(uuid, uuid, uuid)     from public, anon;
revoke execute on function public.wc_submit_polla_prediction(uuid, uuid, int, int) from public, anon;
revoke execute on function public.wc_resolve_polla_match(uuid)                  from public, anon;
revoke execute on function public.wc_resolve_survivor_match_day(uuid)           from public, anon;
revoke execute on function public.wc_admin_override_match_result(uuid, int, int, int, int, text) from public, anon;
revoke execute on function public.wc_admin_finalize_survivor()                  from public, anon;
revoke execute on function public.wc_admin_set_pool_visibility(boolean, boolean, boolean) from public, anon;
