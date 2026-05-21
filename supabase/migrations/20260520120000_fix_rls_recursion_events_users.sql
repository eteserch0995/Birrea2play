-- Rompe el ciclo de recursión infinita entre events y users RLS.
--
-- Ciclo previo:
--   events.events_select  -> consulta users (auth_id = auth.uid())
--   users."Public reads basic user info"  -> JOIN events 3 veces
--   events_select aplicado de nuevo  -> consulta users  -> recursión  -> error 42P17
--
-- Efecto: cualquier SELECT a events (anon o authenticated) fallaba con HTTP 500,
-- causando el mensaje "No se pudo cargar el evento" al abrir links compartidos.
--
-- Solución mínima quirúrgica: eliminar la policy en users que hace JOIN events.
-- Cobertura no se pierde: users_select USING (true) ya permite SELECT público a users.
--
-- Aplicada el 2026-05-20.

DROP POLICY IF EXISTS "Public reads basic user info" ON public.users;
