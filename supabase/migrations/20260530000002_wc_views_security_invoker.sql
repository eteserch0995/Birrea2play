-- ============================================================
-- 2026-05-30 — Mundial 2026: vistas a SECURITY INVOKER
-- ============================================================
-- El advisor de seguridad de Supabase marca como ERROR las vistas
-- wc_group_standings y wc_thirds_ranking: al no tener la opcion
-- security_invoker corren con los privilegios del OWNER (comportamiento
-- "security definer") y por lo tanto bypassean el RLS de las tablas base.
--
-- Verificado ANTES de aplicar (2026-05-30):
--   - wc_matches y wc_teams tienen RLS activo con policy SELECT
--     USING (true) para los roles {anon, authenticated}. Por lo tanto
--     pasar las vistas a security_invoker NO cambia lo que el cliente
--     puede leer (sigue viendo standings y ranking de terceros).
--   - wc_propagate_brackets() (SECURITY DEFINER) lee wc_group_standings
--     internamente; al correr como definer mantiene privilegios de owner,
--     asi que la propagacion del bracket tampoco se ve afectada.
--
-- Efecto: cierra los 2 unicos ERROR de seguridad del advisor. Reversible
-- con: alter view ... set (security_invoker = off);
-- ------------------------------------------------------------

alter view public.wc_group_standings set (security_invoker = on);
alter view public.wc_thirds_ranking  set (security_invoker = on);
