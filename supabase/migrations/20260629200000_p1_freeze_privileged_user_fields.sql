-- P1: congelar campos privilegiados en users_update. El WITH CHECK no-admin ya impedia
-- cambiar role / efectivo_bloqueado / referred_by, pero NO is_fee_exempt ni efectivo_forzado
-- => un usuario podia auto-asignarse exencion de comision o forzado de efectivo (escalada).
-- Se agregan ambos con comparacion NULL-safe (IS NOT DISTINCT FROM), consistente con el resto.
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update
  using (
    auth_id = (select auth.uid())
    or (select u.role from public.users u where u.auth_id = (select auth.uid()))::text = 'admin'
  )
  with check (
    (select u.role from public.users u where u.auth_id = (select auth.uid()))::text = 'admin'
    or (
      auth_id = (select auth.uid())
      and role               is not distinct from (select u.role               from public.users u where u.auth_id = (select auth.uid()))
      and efectivo_bloqueado is not distinct from (select u.efectivo_bloqueado from public.users u where u.auth_id = (select auth.uid()))
      and efectivo_forzado   is not distinct from (select u.efectivo_forzado   from public.users u where u.auth_id = (select auth.uid()))
      and is_fee_exempt      is not distinct from (select u.is_fee_exempt      from public.users u where u.auth_id = (select auth.uid()))
      and referred_by        is not distinct from (select u.referred_by        from public.users u where u.auth_id = (select auth.uid()))
    )
  );
