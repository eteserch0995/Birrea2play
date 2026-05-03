-- Tabla para rastrear órdenes del Botón de Pago Yappy
-- Cada orden tiene un orderId único (máx 15 chars) enviado a Yappy en create_order
-- El IPN de Yappy actualiza el status y acredita el wallet si status='E'

create table if not exists public.yappy_orders (
  id             bigserial    primary key,
  order_id       varchar(15)  not null unique,
  transaction_id text,
  user_id        uuid         not null references public.users(id) on delete cascade,
  amount         numeric(10,2) not null check (amount > 0),
  status         text         not null default 'pending'
                              check (status in ('pending','executed','rejected','cancelled','expired','unknown')),
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now()
);

create index if not exists yappy_orders_user_id_idx  on public.yappy_orders (user_id);
create index if not exists yappy_orders_status_idx   on public.yappy_orders (status);

-- Permitir que las Edge Functions lean/escriban con service_role (ya tienen acceso)
-- RLS: los usuarios solo pueden ver sus propias órdenes
alter table public.yappy_orders enable row level security;

drop policy if exists "Users read own yappy orders" on public.yappy_orders;
create policy "Users read own yappy orders"
  on public.yappy_orders for select
  using (
    user_id = (
      select id from public.users
      where auth_id = auth.uid()
      limit 1
    )
  );
