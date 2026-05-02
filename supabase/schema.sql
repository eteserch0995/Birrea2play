-- ============================================================
-- BIRREA2PLAY — Schema completo (copy & paste, safe to re-run)
-- ============================================================

-- EXTENSIONES
create extension if not exists "uuid-ossp";

-- ============================================================
-- LIMPIAR funciones previas (evita errores de tipo)
-- ============================================================
drop function if exists public.create_user_profile(uuid,text,text,text,text,text,text,text,text,text,text) cascade;
drop function if exists public.credit_wallet(uuid,numeric,text,text) cascade;
drop function if exists public.credit_wallet(uuid,numeric,text) cascade;

-- ============================================================
-- LIMPIAR políticas previas
-- ============================================================
do $$ declare pol record;
begin
  for pol in select policyname, tablename
             from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

drop policy if exists "avatars_select" on storage.objects;
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;

-- ============================================================
-- TABLAS
-- ============================================================

create table if not exists public.users (
  id                      uuid primary key default uuid_generate_v4(),
  auth_id                 uuid unique not null references auth.users(id) on delete cascade,
  nombre                  text not null,
  correo                  text not null,
  telefono                text,
  residencia              text,
  cedula                  text,
  contacto_emergencia     text,
  deporte                 text default 'Fútbol 7',
  nivel                   text default 'Recreativo',
  posicion                text,
  foto_url                text,
  genero                  text check (genero in ('Masculino','Femenino','Otro')),
  role                    text not null default 'player' check (role in ('player','gestor','admin')),
  actividades_completadas int not null default 0,
  -- BUG FIX: push_token used by notifications.js to store Expo push token
  push_token              text,
  created_at              timestamptz not null default now()
);

create table if not exists public.wallets (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null unique references public.users(id) on delete cascade,
  balance    numeric(10,2) not null default 0.00,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id          uuid primary key default uuid_generate_v4(),
  wallet_id   uuid not null references public.wallets(id) on delete cascade,
  -- BUG FIX: added 'reembolso' so cancelRegistration.js can use the correct semantic type
  tipo        text not null check (tipo in ('recarga_yappy','recarga_tarjeta','inscripcion','compra_tienda','mvp_premio','ajuste_admin','plan_mensual','reembolso')),
  monto       numeric(10,2) not null,
  descripcion text,
  created_at  timestamptz not null default now()
);

create table if not exists public.events (
  id                   uuid primary key default uuid_generate_v4(),
  nombre               text not null,
  -- BUG FIX: extended formato check to include 'Copa' and 'Eliminación directa' used in AdminPanel
  formato              text not null check (formato in ('Liga','Torneo','Amistoso','Abierto','Copa','Eliminación directa')),
  deporte              text not null default 'Fútbol',
  fecha                date,
  hora                 time,
  lugar                text,
  -- BUG FIX: direccion and genero are used by AdminEvents form but were missing from schema
  direccion            text,
  genero               text default 'Mixto',
  descripcion          text,
  cupos_total          int,
  cupos_ilimitado      boolean not null default false,
  jugadores_por_equipo int,
  precio               numeric(10,2) not null default 0.00,
  status               text not null default 'draft' check (status in ('draft','open','active','finished','cancelled')),
  visible              boolean not null default true,
  created_by           uuid references public.users(id),
  num_grupos           int default 2,
  equipos_por_grupo    int default 3,
  tiene_octavos        boolean default false,
  tiene_cuartos        boolean default false,
  tiene_semis          boolean default true,
  tiene_tercer_lugar   boolean default true,
  tiene_final          boolean default true,
  jornadas             int default 1,
  ida_y_vuelta         boolean default false,
  mvp_voting_open      boolean not null default false,
  mvp_closes_at        timestamptz,
  event_finished_at    timestamptz,
  created_at           timestamptz not null default now()
);

create table if not exists public.event_registrations (
  id           uuid primary key default uuid_generate_v4(),
  event_id     uuid not null references public.events(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  metodo_pago  text check (metodo_pago in ('wallet','yappy','gratis')),
  monto_pagado numeric(10,2) default 0.00,
  status       text not null default 'confirmed' check (status in ('confirmed','cancelled','pending')),
  created_at   timestamptz not null default now(),
  constraint unique_event_user unique (event_id, user_id)
);

create table if not exists public.event_guests (
  id         uuid primary key default uuid_generate_v4(),
  event_id   uuid not null references public.events(id) on delete cascade,
  nombre     text not null,
  telefono   text,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id         uuid primary key default uuid_generate_v4(),
  event_id   uuid not null references public.events(id) on delete cascade,
  nombre     text not null,
  color      text,
  grupo      text default 'A',
  created_at timestamptz not null default now()
);

create table if not exists public.team_players (
  id         uuid primary key default uuid_generate_v4(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint unique_team_player unique (team_id, user_id)
);

create table if not exists public.matches (
  id               uuid primary key default uuid_generate_v4(),
  event_id         uuid not null references public.events(id) on delete cascade,
  jornada          int not null default 1,
  team_home_id     uuid references public.teams(id) on delete set null,
  team_away_id     uuid references public.teams(id) on delete set null,
  equipo_local     text,
  equipo_visitante text,
  fase             text not null default 'grupos',
  grupo            text,
  goles_home       int,
  goles_away       int,
  status           text not null default 'pending' check (status in ('pending','finished','cancelled')),
  finished_at      timestamptz,
  mvp_closes_at    timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.mvp_votes (
  id           uuid primary key default uuid_generate_v4(),
  event_id     uuid references public.events(id) on delete cascade,
  match_id     uuid references public.matches(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  voted_for_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint unique_vote_per_event unique (event_id, user_id)
);

create table if not exists public.mvp_results (
  id            uuid primary key default uuid_generate_v4(),
  -- BUG FIX: event_id is the primary business key for MVP (one MVP per event).
  -- Added unique constraint on event_id to prevent double-awarding via race condition.
  event_id      uuid unique references public.events(id) on delete cascade,
  -- match_id kept for backwards-compat but no longer used as the unique key.
  match_id      uuid references public.matches(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  votos_totales int not null default 0,
  premio_wallet numeric(10,2) not null default 1.00,
  premio_pagado boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.products (
  id          uuid primary key default uuid_generate_v4(),
  nombre      text not null,
  descripcion text,
  precio      numeric(10,2) not null,
  imagen_url  text,
  -- BUG FIX: categoria and tiene_tallas used by AdminPanel but were missing from schema
  categoria   text default 'general',
  tiene_tallas boolean not null default false,
  stock       int not null default 0,
  tallas      jsonb default '{}',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.users(id) on delete cascade,
  gestor_id    uuid references public.users(id),
  total        numeric(10,2) not null default 0.00,
  -- BUG FIX: status, metodo_pago, and delivered_at used by AdminOrders but were missing
  status       text not null default 'paid' check (status in ('paid','processing','delivered','cancelled')),
  metodo_pago  text,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.order_items (
  id              uuid primary key default uuid_generate_v4(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  product_id      uuid not null references public.products(id),
  qty             int not null default 1,
  precio_unitario numeric(10,2) not null,
  talla           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.news (
  id         uuid primary key default uuid_generate_v4(),
  titulo     text not null,
  contenido  text,
  tipo       text default 'general',
  created_at timestamptz not null default now()
);

create table if not exists public.gestor_requests (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid not null references public.users(id) on delete cascade,
  actividades_completadas int not null default 0,
  motivacion              text,
  status                  text not null default 'pending' check (status in ('pending','approved','rejected')),
  -- BUG FIX: razon_rechazo is used in AdminPanel.confirmReject() but was missing from schema
  razon_rechazo           text,
  reviewed_by             uuid references public.users(id),
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now()
);

-- ============================================================
-- FUNCIONES
-- ============================================================

create or replace function public.create_user_profile(
  p_auth_id             uuid,
  p_nombre              text,
  p_correo              text,
  p_telefono            text default null,
  p_residencia          text default null,
  p_cedula              text default null,
  p_contacto_emergencia text default null,
  p_deporte             text default 'Fútbol 7',
  p_nivel               text default 'Recreativo',
  p_posicion            text default null,
  p_foto_url            text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_user_id uuid;
begin
  insert into public.users (
    auth_id, nombre, correo, telefono, residencia, cedula,
    contacto_emergencia, deporte, nivel, posicion, foto_url
  ) values (
    p_auth_id, p_nombre, p_correo, p_telefono, p_residencia, p_cedula,
    p_contacto_emergencia, p_deporte, p_nivel, p_posicion, p_foto_url
  ) returning id into v_user_id;
  insert into public.wallets (user_id, balance) values (v_user_id, 0.00);
  return v_user_id;
end;
$$;

create or replace function public.credit_wallet(
  p_user_id     uuid,
  p_monto       numeric,
  p_tipo        text,
  p_descripcion text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_wallet_id uuid;
begin
  select id into v_wallet_id from public.wallets where user_id = p_user_id;
  if not found then
    raise exception 'Wallet no encontrado para user %', p_user_id;
  end if;
  update public.wallets set balance = balance + p_monto where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, p_tipo, p_monto, p_descripcion);
end;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.users               enable row level security;
alter table public.wallets             enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.events              enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_guests        enable row level security;
alter table public.teams               enable row level security;
alter table public.team_players        enable row level security;
alter table public.matches             enable row level security;
alter table public.mvp_votes           enable row level security;
alter table public.mvp_results         enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.news                enable row level security;
alter table public.gestor_requests     enable row level security;

-- ============================================================
-- POLÍTICAS
-- ============================================================

create policy "users_select"   on public.users for select using (true);
create policy "users_update"   on public.users for update using (auth.uid() = auth_id);

create policy "wallets_select" on public.wallets for select using (
  user_id = (select id from public.users where auth_id = auth.uid())
);
create policy "wt_select"      on public.wallet_transactions for select using (
  wallet_id in (
    select w.id from public.wallets w
    join public.users u on u.id = w.user_id
    where u.auth_id = auth.uid()
  )
);

create policy "events_select"  on public.events for select using (
  visible = true or created_by = (select id from public.users where auth_id = auth.uid())
);
create policy "events_insert"  on public.events for insert with check (
  (select role from public.users where auth_id = auth.uid()) in ('gestor','admin')
);
create policy "events_update"  on public.events for update using (
  created_by = (select id from public.users where auth_id = auth.uid())
  or (select role from public.users where auth_id = auth.uid()) = 'admin'
);
create policy "events_delete"  on public.events for delete using (
  (select role from public.users where auth_id = auth.uid()) = 'admin'
);

create policy "er_select"      on public.event_registrations for select using (true);
create policy "er_insert"      on public.event_registrations for insert with check (auth.uid() is not null);
create policy "er_update"      on public.event_registrations for update using (
  user_id = (select id from public.users where auth_id = auth.uid())
);

create policy "eg_select"      on public.event_guests for select using (true);
create policy "eg_insert"      on public.event_guests for insert with check (auth.uid() is not null);

create policy "teams_select"   on public.teams        for select using (true);
create policy "teams_insert"   on public.teams        for insert with check (auth.uid() is not null);
create policy "teams_update"   on public.teams        for update using (auth.uid() is not null);
create policy "teams_delete"   on public.teams        for delete using (auth.uid() is not null);
create policy "tp_select"      on public.team_players for select using (true);
create policy "tp_insert"      on public.team_players for insert with check (auth.uid() is not null);
create policy "tp_delete"      on public.team_players for delete using (auth.uid() is not null);

create policy "matches_select" on public.matches for select using (true);
create policy "matches_insert" on public.matches for insert with check (auth.uid() is not null);
create policy "matches_update" on public.matches for update using (auth.uid() is not null);
create policy "matches_delete" on public.matches for delete using (auth.uid() is not null);

create policy "mvpv_select"    on public.mvp_votes   for select using (true);
create policy "mvpv_insert"    on public.mvp_votes   for insert with check (auth.uid() is not null);
create policy "mvpv_delete"    on public.mvp_votes   for delete using (auth.uid() is not null);
create policy "mvpr_select"    on public.mvp_results for select using (true);
create policy "mvpr_insert"    on public.mvp_results for insert with check (auth.uid() is not null);

create policy "prod_select"    on public.products    for select using (activo = true);

create policy "ord_select"     on public.orders for select using (
  user_id   = (select id from public.users where auth_id = auth.uid())
  or gestor_id = (select id from public.users where auth_id = auth.uid())
  or (select role from public.users where auth_id = auth.uid()) = 'admin'
);
create policy "ord_insert"     on public.orders     for insert with check (auth.uid() is not null);
create policy "oi_select"      on public.order_items for select using (
  order_id in (
    select id from public.orders
    where user_id = (select id from public.users where auth_id = auth.uid())
  )
);
create policy "oi_insert"      on public.order_items for insert with check (auth.uid() is not null);

create policy "news_select"    on public.news for select using (true);
create policy "news_insert"    on public.news for insert with check (auth.uid() is not null);

create policy "gr_select"      on public.gestor_requests for select using (
  user_id = (select id from public.users where auth_id = auth.uid())
  or (select role from public.users where auth_id = auth.uid()) = 'admin'
);
create policy "gr_insert"      on public.gestor_requests for insert with check (auth.uid() is not null);
create policy "gr_update"      on public.gestor_requests for update using (
  (select role from public.users where auth_id = auth.uid()) = 'admin'
);

-- ============================================================
-- STORAGE: bucket avatars
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_select" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_insert" on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid() is not null);
create policy "avatars_update" on storage.objects for update using  (bucket_id = 'avatars' and auth.uid() is not null);

-- ============================================================
-- PLANES DE RECARGA / MENSUALIDADES
-- ============================================================

create table if not exists public.wallet_plans (
  id              uuid primary key default uuid_generate_v4(),
  nombre          text not null,
  precio_mensual  numeric(10,2) not null,
  descuento_pct   int not null default 0,
  bonus_wallet    numeric(10,2) not null default 0.00,
  descripcion     text,
  activo          boolean not null default true,
  orden           int not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.users(id) on delete cascade,
  plan_id      uuid not null references public.wallet_plans(id),
  activo       boolean not null default true,
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz not null,
  metodo_pago  text not null default 'wallet',
  created_at   timestamptz not null default now()
);

-- Tabla para idempotencia de pagos PágueloFácil
create table if not exists public.pf_pending_payments (
  id          uuid primary key default uuid_generate_v4(),
  orden_id    text not null unique,
  user_id     uuid not null references public.users(id) on delete cascade,
  amount      numeric(10,2) not null,
  tipo        text not null default 'recarga_tarjeta',
  descripcion text,
  procesado   boolean not null default false,
  oper        text,
  created_at  timestamptz not null default now()
);

alter table public.wallet_plans      enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.pf_pending_payments enable row level security;

create policy "plans_select"  on public.wallet_plans for select using (activo = true);
create policy "subs_select"   on public.user_subscriptions for select using (
  user_id = (select id from public.users where auth_id = auth.uid())
);
create policy "pfp_select"    on public.pf_pending_payments for select using (
  user_id = (select id from public.users where auth_id = auth.uid())
);

-- ============================================================
-- FUNCIÓN: comprar plan mensual desde wallet
-- ============================================================
drop function if exists public.purchase_plan(uuid, uuid);

create or replace function public.purchase_plan(
  p_user_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_plan          wallet_plans;
  v_wallet_id     uuid;
  v_balance       numeric(10,2);
  v_fecha_fin     timestamptz;
begin
  select * into v_plan from public.wallet_plans where id = p_plan_id and activo = true;
  if not found then
    raise exception 'Plan no encontrado o inactivo';
  end if;

  select id, balance into v_wallet_id, v_balance
  from public.wallets where user_id = p_user_id;
  if not found then
    raise exception 'Wallet no encontrado';
  end if;

  if v_balance < v_plan.precio_mensual then
    raise exception 'Saldo insuficiente para adquirir el plan';
  end if;

  -- Desactivar suscripción previa si existe
  update public.user_subscriptions
  set activo = false
  where user_id = p_user_id and activo = true;

  v_fecha_fin := now() + interval '30 days';

  insert into public.user_subscriptions (user_id, plan_id, activo, fecha_inicio, fecha_fin, metodo_pago)
  values (p_user_id, p_plan_id, true, now(), v_fecha_fin, 'wallet');

  -- Debitar costo del plan
  update public.wallets set balance = balance - v_plan.precio_mensual where id = v_wallet_id;
  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, 'plan_mensual', -v_plan.precio_mensual,
          'Suscripción ' || v_plan.nombre || ' — 30 días');

  -- Acreditar bonus si aplica
  if v_plan.bonus_wallet > 0 then
    update public.wallets set balance = balance + v_plan.bonus_wallet where id = v_wallet_id;
    insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
    values (v_wallet_id, 'ajuste_admin', v_plan.bonus_wallet,
            'Bonus bienvenida plan ' || v_plan.nombre);
  end if;
end;
$$;

-- ============================================================
-- FUNCIÓN: obtener plan activo del usuario
-- ============================================================
drop function if exists public.get_user_active_plan(uuid);

create or replace function public.get_user_active_plan(p_user_id uuid)
returns table (
  plan_id        uuid,
  nombre         text,
  descuento_pct  int,
  bonus_wallet   numeric,
  fecha_fin      timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select s.plan_id, p.nombre, p.descuento_pct, p.bonus_wallet, s.fecha_fin
  from public.user_subscriptions s
  join public.wallet_plans p on p.id = s.plan_id
  where s.user_id = p_user_id
    and s.activo = true
    and s.fecha_fin > now()
  limit 1;
end;
$$;

-- ============================================================
-- PLANES INICIALES (semilla)
-- ============================================================
insert into public.wallet_plans (nombre, precio_mensual, descuento_pct, bonus_wallet, descripcion, activo, orden)
values
  ('Plan Básico',   5.00,  5,  0.00, '5% descuento en inscripciones',               true, 1),
  ('Plan Premium',  10.00, 10, 1.00, '10% descuento + $1.00 bonus en wallet',        true, 2),
  ('Plan Elite',    20.00, 20, 3.00, '20% descuento + $3.00 bonus en wallet',        true, 3)
on conflict do nothing;

-- ============================================================
-- MIGRATIONS (safe to run on existing DB — all idempotent)
-- ============================================================

-- BUG FIX: add missing columns to existing tables
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_tipo_check
  check (tipo in ('recarga_yappy','recarga_tarjeta','inscripcion','compra_tienda','mvp_premio','ajuste_admin','plan_mensual','reembolso'));

alter table public.events
  add column if not exists direccion text,
  add column if not exists genero    text default 'Mixto';

alter table public.events
  drop constraint if exists events_formato_check;
alter table public.events
  add constraint events_formato_check
  check (formato in ('Liga','Torneo','Amistoso','Abierto','Copa','Eliminación directa'));

alter table public.events
  alter column cupos_total drop not null;

alter table public.gestor_requests
  add column if not exists razon_rechazo text;

alter table public.products
  add column if not exists descripcion  text,
  add column if not exists categoria    text default 'general',
  add column if not exists tiene_tallas boolean not null default false;

alter table public.orders
  add column if not exists status       text not null default 'paid',
  add column if not exists metodo_pago  text,
  add column if not exists delivered_at timestamptz;

-- Recreate mvp_results unique constraint: event_id instead of match_id
alter table public.mvp_results
  drop constraint if exists mvp_results_match_id_key;
alter table public.mvp_results
  drop constraint if exists mvp_results_event_id_key;
alter table public.mvp_results
  add constraint mvp_results_event_id_key unique (event_id);

-- BUG FIX: push_token used by notifications.js but missing from users schema
alter table public.users
  add column if not exists push_token text;
