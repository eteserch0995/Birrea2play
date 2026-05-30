-- ============================================================
-- 2026-05-30 — Mundial: stats agregadas del pozo (sin PII)
-- ============================================================
-- Arregla el pozo subcontado: wc_enrollments tiene RLS "own or admin",
-- asi que el cliente solo veia su propia inscripcion y el pozo salia como
-- si solo el hubiera pagado. Esta funcion SECURITY DEFINER devuelve el
-- agregado (conteo + pozo + distribucion de vidas) SIN exponer datos
-- individuales. Aplicada a prod via apply_migration (name=wc_pool_stats).
-- Tambien: fee_rate de wc_pools se ajusto a 0.085 (comision casa 3.5% +
-- ~5% Yappy) por decision del dueno (UPDATE de datos, no en este archivo).
-- ------------------------------------------------------------

create or replace function public.wc_pool_stats()
returns table (
  mode text, paid_count int, pozo numeric,
  alive3 int, alive2 int, alive1 int, dead int
) language sql security definer set search_path = public as $$
  select e.mode,
    count(*)::int as paid_count,
    round(count(*) * (case e.mode when 'polla' then p.polla_price else p.survivor_price end) * (1 - p.fee_rate), 2) as pozo,
    count(*) filter (where e.mode='survivor' and e.lives_remaining = 3)::int as alive3,
    count(*) filter (where e.mode='survivor' and e.lives_remaining = 2)::int as alive2,
    count(*) filter (where e.mode='survivor' and e.lives_remaining = 1)::int as alive1,
    count(*) filter (where e.mode='survivor' and e.lives_remaining = 0)::int as dead
  from public.wc_enrollments e
  cross join (select polla_price, survivor_price, fee_rate from public.wc_pools where season='fifa_wc_2026' limit 1) p
  where e.payment_status = 'paid'
  group by e.mode, p.polla_price, p.survivor_price, p.fee_rate;
$$;
revoke execute on function public.wc_pool_stats() from public;
grant execute on function public.wc_pool_stats() to anon, authenticated, service_role;
