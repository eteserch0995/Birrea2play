-- Fix: la policy users_update bloqueaba a TODO usuario no-admin con referred_by IS NULL
-- (165/166 usuarios en prod). Causa: el WITH CHECK comparaba `referred_by = (subquery)`,
-- que evalua a NULL cuando referred_by es NULL => el WITH CHECK falla => error
-- "new row violates row-level security policy for table users" al guardar el perfil
-- (EditProfileScreen -> updateUserProfile -> UPDATE public.users).
--
-- Fix: comparaciones NULL-safe con IS NOT DISTINCT FROM. Se preserva el anti-tamper del
-- hardening de referidos: un no-admin sigue sin poder cambiar role / efectivo_bloqueado /
-- referred_by (verificado por simulacion: intentar cambiarlos da row-level security error).

DROP POLICY IF EXISTS users_update ON public.users;

CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING (
    auth_id = (SELECT auth.uid())
    OR (SELECT u.role FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))::text = 'admin'
  )
  WITH CHECK (
    (SELECT u.role FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))::text = 'admin'
    OR (
      auth_id = (SELECT auth.uid())
      AND role               IS NOT DISTINCT FROM (SELECT u.role               FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))
      AND efectivo_bloqueado IS NOT DISTINCT FROM (SELECT u.efectivo_bloqueado FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))
      AND referred_by        IS NOT DISTINCT FROM (SELECT u.referred_by        FROM public.users u WHERE u.auth_id = (SELECT auth.uid()))
    )
  );
