-- Recaudo Solidario (Venezuela) — flujo de donaciones independiente.
-- Additive only: no toca ramas evento/recarga/wc/abono existentes.
-- Aplicada en prod (rumreditrvxkcnlhawut) el 2026-06-26 vía MCP apply_migration.

-- 1) Permitir tipo='donacion' en yappy_orders (el CHECK actual lo rechazaría).
-- Como este DROP+CREATE reescribe una constraint COMPARTIDA, la lista debe incluir
-- TODOS los tipos que el código vivo inserta; si falta uno, el upsert de esa rama
-- viola el CHECK (23514). 'abono_cancha' SÍ lo insertan yappy-boton/yappy-ipn/cancha,
-- así que se incluye de forma aditiva para no regresionar el cobro de cancha por Yappy.
alter table public.yappy_orders drop constraint if exists yappy_orders_tipo_check;
alter table public.yappy_orders add constraint yappy_orders_tipo_check
  check (tipo = any (array['recarga','evento','invitado','compra_tienda','wc_enrollment','abono_cancha','donacion']));

-- 1b) Columna base de la donación en pf_pending_payments (flujo tarjeta).
-- pf-create-link la ESCRIBE (monto base) y pf-webhook la LEE para el termómetro.
-- Migración autocontenida: no debe depender de columnas creadas fuera del repo.
-- Idempotente (if not exists) y additive: no afecta recarga/wc/cancha.
alter table public.pf_pending_payments
  add column if not exists credito_monto numeric(10,2);

-- 2) Tabla de donaciones.
create table if not exists public.donaciones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  monto         numeric(10,2) not null check (monto > 0),   -- base que cuenta para el termómetro
  monto_cobrado numeric(10,2),                              -- total cobrado (incluye comisión si la cubrió)
  fee           numeric(10,2) not null default 0,           -- comisión agregada (solo tarjeta)
  metodo        text not null check (metodo in ('yappy','tarjeta')),
  order_ref     text not null unique,                       -- idempotencia: 'yappy:<id>' | 'pf:<id>'
  campana       text not null default 'venezuela',
  created_at    timestamptz not null default now()
);

-- 3) RLS: lectura directa bloqueada (privacidad). Solo service_role inserta; agregados vía función.
alter table public.donaciones enable row level security;

-- 4) Registrar donación — idempotente, SOLO service_role (lo llaman los webhooks de pago).
create or replace function public.registrar_donacion(
  p_user_id uuid,
  p_monto numeric,
  p_metodo text,
  p_order_ref text,
  p_fee numeric default 0,
  p_monto_cobrado numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Defensa en profundidad: solo service_role (los webhooks de pago) puede registrar.
  -- Los GRANT/REVOKE ya lo restringen; este assert es la red de seguridad, igual que
  -- las demás RPC de dinero (p.ej. wc_pay_enrollment_card).
  -- coalesce: si auth.role() es NULL (sin claim de rol), NULL <> 'service_role'
  -- evalúa a NULL y el IF no dispararía; tratamos ausencia de rol como NO autorizada.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'unauthorized: only service_role';
  end if;
  if p_metodo not in ('yappy','tarjeta') then
    raise exception 'metodo inválido: %', p_metodo;
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'monto inválido: %', p_monto;
  end if;
  if coalesce(p_fee, 0) < 0 then
    raise exception 'fee inválido: %', p_fee;
  end if;
  -- La base (monto) que cuenta para el termómetro nunca puede exceder lo realmente cobrado.
  if coalesce(p_monto_cobrado, p_monto) < p_monto then
    raise exception 'monto base (%) supera lo cobrado (%)', p_monto, p_monto_cobrado;
  end if;
  insert into public.donaciones (user_id, monto, monto_cobrado, fee, metodo, order_ref)
  values (p_user_id, p_monto, coalesce(p_monto_cobrado, p_monto), coalesce(p_fee, 0), p_metodo, p_order_ref)
  on conflict (order_ref) do nothing;
end;
$$;

revoke all on function public.registrar_donacion(uuid,numeric,text,text,numeric,numeric) from public;
revoke all on function public.registrar_donacion(uuid,numeric,text,text,numeric,numeric) from anon;
revoke all on function public.registrar_donacion(uuid,numeric,text,text,numeric,numeric) from authenticated;
grant execute on function public.registrar_donacion(uuid,numeric,text,text,numeric,numeric) to service_role;

-- 5) Agregados para el termómetro (lectura pública: total + donantes + nº donaciones).
create or replace function public.get_recaudo_stats(p_campana text default 'venezuela')
returns table (total numeric, donantes bigint, cantidad bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(monto), 0)::numeric as total,
    count(distinct user_id)::bigint  as donantes,
    count(*)::bigint                 as cantidad
  from public.donaciones
  where campana = p_campana;
$$;

revoke all on function public.get_recaudo_stats(text) from public;
grant execute on function public.get_recaudo_stats(text) to anon;
grant execute on function public.get_recaudo_stats(text) to authenticated;
grant execute on function public.get_recaudo_stats(text) to service_role;
