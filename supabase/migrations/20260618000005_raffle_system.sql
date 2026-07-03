-- ============================================================
-- 2026-06-18 — Sistema de Rifa (Spin & Win)
-- ============================================================
-- Flujo: admin configura → usuarios compran tickets ($1/ticket
-- vía Yappy, admin confirma) → admin gira ruleta → ganador
-- anunciado en tiempo real para todos → si no está presente,
-- girar de nuevo.
-- ============================================================

-- ── 1) Tabla de tickets ──────────────────────────────────────
create table if not exists public.raffle_tickets (
  id           uuid primary key default uuid_generate_v4(),
  event_id     uuid not null references public.events(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  quantity     int  not null default 1 check (quantity > 0),
  amount_paid  numeric(10,2) not null,   -- quantity * 1.00, guardado al crear
  metodo_pago  text not null default 'yappy',
  status       text not null default 'pending'
               check (status in ('pending','confirmed','cancelled')),
  notes        text,
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_raffle_tickets_event  on public.raffle_tickets(event_id);
create index if not exists idx_raffle_tickets_user   on public.raffle_tickets(event_id, user_id);

-- ── 2) Tabla de estado de la rifa ────────────────────────────
create table if not exists public.raffle_state (
  id                  uuid primary key default uuid_generate_v4(),
  event_id            uuid not null unique references public.events(id) on delete cascade,
  status              text not null default 'setup'
                      check (status in ('setup','open','spinning','winner_pending','closed')),
  prize_name          text not null default 'Camiseta Aniversario',
  yappy_number        text,
  current_winner_id   uuid references public.users(id),
  spin_count          int  not null default 0,
  skipped_user_ids    uuid[] not null default '{}',
  winner_confirmed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Realtime para que todos los clientes vean el estado en vivo
alter publication supabase_realtime add table public.raffle_state;
alter publication supabase_realtime add table public.raffle_tickets;

-- ── 3) RLS ──────────────────────────────────────────────────
alter table public.raffle_tickets enable row level security;
alter table public.raffle_state   enable row level security;

-- Tickets: cada usuario ve los suyos; admin lo ve todo
create policy raffle_tickets_select on public.raffle_tickets
  for select to authenticated
  using (
    user_id in (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- Estado: todos los autenticados ven el estado (para el live widget)
create policy raffle_state_select on public.raffle_state
  for select to authenticated using (true);

-- INSERT/UPDATE solo por RPC (SECURITY DEFINER)

-- ── 4) RPC: admin crea/actualiza la rifa ────────────────────
create or replace function public.raffle_setup(
  p_event_id    uuid,
  p_prize_name  text,
  p_yappy_number text
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role text;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin puede configurar la rifa'; end if;

  insert into public.raffle_state (event_id, prize_name, yappy_number, status)
  values (p_event_id, p_prize_name, p_yappy_number, 'open')
  on conflict (event_id) do update
    set prize_name   = excluded.prize_name,
        yappy_number = excluded.yappy_number,
        status       = case when raffle_state.status = 'setup' then 'open' else raffle_state.status end,
        updated_at   = now();

  return jsonb_build_object('ok', true);
end; $$;

revoke execute on function public.raffle_setup(uuid,text,text) from public, anon;
grant  execute on function public.raffle_setup(uuid,text,text) to authenticated, service_role;

-- ── 5) RPC: usuario solicita tickets ────────────────────────
create or replace function public.raffle_request_tickets(
  p_event_id uuid,
  p_quantity  int
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_me   uuid;
  v_rs   text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_quantity < 1 then raise exception 'Mínimo 1 ticket'; end if;

  select id into v_me from public.users where auth_id = v_uid;
  if v_me is null then raise exception 'Usuario no encontrado'; end if;

  select status into v_rs from public.raffle_state where event_id = p_event_id;
  if v_rs is null then raise exception 'La rifa no está activa para este evento'; end if;
  if v_rs not in ('open', 'spinning', 'winner_pending') then
    raise exception 'La rifa no acepta tickets en este momento';
  end if;

  insert into public.raffle_tickets (event_id, user_id, quantity, amount_paid)
  values (p_event_id, v_me, p_quantity, p_quantity::numeric);

  return jsonb_build_object('ok', true, 'quantity', p_quantity, 'total', p_quantity::numeric);
end; $$;

revoke execute on function public.raffle_request_tickets(uuid,int) from public, anon;
grant  execute on function public.raffle_request_tickets(uuid,int) to authenticated, service_role;

-- ── 6) RPC: admin confirma tickets (pago recibido) ──────────
create or replace function public.raffle_admin_confirm_ticket(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role     text;
  v_admin_id uuid;
begin
  select role, id into v_role, v_admin_id from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin'; end if;

  update public.raffle_tickets
    set status       = 'confirmed',
        confirmed_by = v_admin_id,
        confirmed_at = now()
    where id = p_ticket_id and status = 'pending';

  return jsonb_build_object('ok', true);
end; $$;

revoke execute on function public.raffle_admin_confirm_ticket(uuid) from public, anon;
grant  execute on function public.raffle_admin_confirm_ticket(uuid) to authenticated, service_role;

-- ── 7) RPC: admin cancela tickets ──────────────────────────
create or replace function public.raffle_admin_cancel_ticket(p_ticket_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_role text;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin'; end if;
  update public.raffle_tickets set status = 'cancelled' where id = p_ticket_id;
  return jsonb_build_object('ok', true);
end; $$;

revoke execute on function public.raffle_admin_cancel_ticket(uuid) from public, anon;
grant  execute on function public.raffle_admin_cancel_ticket(uuid) to authenticated, service_role;

-- ── 8) RPC: admin gira la ruleta ────────────────────────────
create or replace function public.raffle_spin(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role       text;
  v_state      public.raffle_state;
  v_winner_id  uuid;
  v_winner_nom text;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin puede girar'; end if;

  select * into v_state from public.raffle_state where event_id = p_event_id for update;
  if v_state.id is null then raise exception 'Rifa no encontrada'; end if;
  if v_state.status not in ('open', 'spinning', 'winner_pending') then
    raise exception 'La rifa no está en un estado válido para girar';
  end if;

  -- Selección aleatoria ponderada: cada ticket confirmado = 1 entrada
  -- Excluye ganadores previos que no estuvieron presentes
  select rt.user_id into v_winner_id
  from public.raffle_tickets rt
  cross join generate_series(1, rt.quantity) s(n)
  where rt.event_id = p_event_id
    and rt.status   = 'confirmed'
    and rt.user_id != all(v_state.skipped_user_ids)
  order by random()
  limit 1;

  if v_winner_id is null then
    raise exception 'No hay tickets confirmados disponibles para sortear';
  end if;

  select nombre into v_winner_nom from public.users where id = v_winner_id;

  update public.raffle_state
    set status            = 'spinning',
        current_winner_id = v_winner_id,
        spin_count        = spin_count + 1,
        updated_at        = now()
    where event_id = p_event_id;

  return jsonb_build_object(
    'ok',         true,
    'winner_id',  v_winner_id,
    'winner_nom', v_winner_nom,
    'spin_count', v_state.spin_count + 1
  );
end; $$;

revoke execute on function public.raffle_spin(uuid) from public, anon;
grant  execute on function public.raffle_spin(uuid) to authenticated, service_role;

-- ── 9) RPC: ganador confirmado (está presente) ──────────────
create or replace function public.raffle_confirm_winner(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role text;
  v_state public.raffle_state;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin'; end if;

  select * into v_state from public.raffle_state where event_id = p_event_id for update;
  if v_state.current_winner_id is null then raise exception 'No hay ganador seleccionado'; end if;

  update public.raffle_state
    set status              = 'closed',
        winner_confirmed_at = now(),
        updated_at          = now()
    where event_id = p_event_id;

  return jsonb_build_object('ok', true, 'winner_id', v_state.current_winner_id);
end; $$;

revoke execute on function public.raffle_confirm_winner(uuid) from public, anon;
grant  execute on function public.raffle_confirm_winner(uuid) to authenticated, service_role;

-- ── 10) RPC: ganador no presente — saltear y girar de nuevo ──
create or replace function public.raffle_skip_winner(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role  text;
  v_state public.raffle_state;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin'; end if;

  select * into v_state from public.raffle_state where event_id = p_event_id for update;
  if v_state.current_winner_id is null then raise exception 'No hay ganador que saltear'; end if;

  update public.raffle_state
    set status           = 'open',
        skipped_user_ids = array_append(skipped_user_ids, current_winner_id),
        current_winner_id = null,
        updated_at        = now()
    where event_id = p_event_id;

  return jsonb_build_object('ok', true, 'skipped', v_state.current_winner_id);
end; $$;

revoke execute on function public.raffle_skip_winner(uuid) from public, anon;
grant  execute on function public.raffle_skip_winner(uuid) to authenticated, service_role;

-- ── 11) RPC: estado completo para la UI ─────────────────────
create or replace function public.raffle_get_status(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid          uuid := (select auth.uid());
  v_me           uuid;
  v_state        public.raffle_state;
  v_my_confirmed int;
  v_my_pending   int;
  v_total_pool   int;
  v_winner_nom   text;
  v_participants  jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_me from public.users where auth_id = v_uid;

  select * into v_state from public.raffle_state where event_id = p_event_id;
  if v_state.id is null then return jsonb_build_object('active', false); end if;

  select coalesce(sum(quantity), 0) into v_my_confirmed
    from public.raffle_tickets
    where event_id = p_event_id and user_id = v_me and status = 'confirmed';

  select coalesce(sum(quantity), 0) into v_my_pending
    from public.raffle_tickets
    where event_id = p_event_id and user_id = v_me and status = 'pending';

  select coalesce(sum(quantity), 0) into v_total_pool
    from public.raffle_tickets where event_id = p_event_id and status = 'confirmed';

  if v_state.current_winner_id is not null then
    select nombre into v_winner_nom from public.users where id = v_state.current_winner_id;
  end if;

  -- Lista de participantes confirmados (nombre + tickets) para animación
  select jsonb_agg(jsonb_build_object('nombre', split_part(u.nombre,' ',1), 'tickets', t.qty))
    into v_participants
    from (
      select user_id, sum(quantity) as qty
      from public.raffle_tickets
      where event_id = p_event_id and status = 'confirmed'
      group by user_id
    ) t
    join public.users u on u.id = t.user_id;

  return jsonb_build_object(
    'active',            true,
    'status',            v_state.status,
    'prize_name',        v_state.prize_name,
    'yappy_number',      v_state.yappy_number,
    'spin_count',        v_state.spin_count,
    'my_confirmed',      v_my_confirmed,
    'my_pending',        v_my_pending,
    'total_pool',        v_total_pool,
    'current_winner_id', v_state.current_winner_id,
    'winner_nom',        v_winner_nom,
    'is_winner',         (v_state.current_winner_id = v_me and v_state.status in ('spinning','winner_pending','closed')),
    'winner_confirmed',  v_state.status = 'closed',
    'participants',      coalesce(v_participants, '[]'::jsonb)
  );
end; $$;

revoke execute on function public.raffle_get_status(uuid) from public, anon;
grant  execute on function public.raffle_get_status(uuid) to authenticated, service_role;
