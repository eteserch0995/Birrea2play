-- ============================================================
-- 2026-06-18 — Survivor: RPC público para anunciar al ganador
-- ============================================================
-- wc_survivor_winner: expone nombre + prize del ganador del Survivor
-- sin violar RLS (wc_enrollments tiene "select own or admin").
-- SECURITY DEFINER para que cualquier usuario autenticado/anon vea el resultado.
-- Solo retorna datos si hay un is_winner=true marcado en wc_enrollments.
-- ------------------------------------------------------------

create or replace function public.wc_survivor_winner()
returns table (nombre text, prize_amount numeric)
language sql security definer set search_path = public as $$
  select u.nombre, e.prize_amount
  from public.wc_enrollments e
  join public.users u on u.id = e.user_id
  where e.mode = 'survivor'
    and e.is_winner = true
    and e.payment_status = 'paid'
    and e.updated_at >= now() - interval '3 days'
  limit 1;
$$;

revoke execute on function public.wc_survivor_winner() from public;
grant execute on function public.wc_survivor_winner() to anon, authenticated, service_role;
