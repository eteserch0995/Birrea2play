-- Referidos — hardening de advisors (sin ERRORES, limpieza de exposición).
-- 1) Las funciones de TRIGGER no deben ser invocables como RPC por nadie
--    (el trigger igual las ejecuta; Postgres no chequea EXECUTE al disparar).
revoke execute on function public._trfn_users_referral_code() from public, anon, authenticated;
revoke execute on function public._trfn_wc_referral_reward()   from public, anon, authenticated;
-- gen_referral_code: revocar también de authenticated (los grants explícitos por
-- ALTER DEFAULT PRIVILEGES no se quitan con REVOKE FROM PUBLIC).
revoke execute on function public.gen_referral_code()          from public, anon, authenticated;

-- 2) wc_referral_credits: invisible para anon (solo el referidor o admin la leen
--    vía la policy de authenticated).
revoke all on table public.wc_referral_credits from anon;
