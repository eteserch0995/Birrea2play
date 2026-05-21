-- ============================================================
-- 2026-05-18 — Canchas, slots y rol cancha_admin
-- ============================================================
-- Permite a administradores de canchas físicas publicar horarios
-- libres (slots) para que gestores los reclamen y conviertan en
-- eventos. Slots pueden ser públicos o bloqueados para un gestor
-- específico (caso "cancha recurrente con gestor frecuente").
-- ────────────────────────────────────────────────────────────

-- 1) Extender rol: agregar 'cancha_admin' al check constraint
--    (drop y recreate porque check constraints no se modifican in-place)
alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check
  check (role in ('player','gestor','admin','cancha_admin'));

-- 2) Tabla canchas
create table if not exists public.canchas (
  id            uuid primary key default uuid_generate_v4(),
  owner_id      uuid not null references public.users(id) on delete cascade,
  nombre        text not null,
  direccion     text,
  distrito      text,
  telefono      text,
  precio_hora   numeric(10,2),
  foto_url      text,
  maps_url      text,
  notas         text,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_canchas_owner on public.canchas(owner_id);

-- 3) Tabla cancha_slots — horarios publicados por la cancha
create table if not exists public.cancha_slots (
  id                       uuid primary key default uuid_generate_v4(),
  cancha_id                uuid not null references public.canchas(id) on delete cascade,
  fecha                    date not null,
  hora_inicio              time not null,
  hora_fin                 time not null,
  precio_hora              numeric(10,2),
  visibility               text not null default 'public'
                           check (visibility in ('public','reserved_for_gestor')),
  reserved_for_gestor_id   uuid references public.users(id) on delete set null,
  status                   text not null default 'available'
                           check (status in ('available','claimed','expired','cancelled')),
  notas                    text,
  created_at               timestamptz not null default now(),
  constraint chk_slot_horas check (hora_fin > hora_inicio),
  constraint chk_slot_reserved_consistency check (
    (visibility = 'reserved_for_gestor' and reserved_for_gestor_id is not null) or
    (visibility = 'public' and reserved_for_gestor_id is null)
  )
);

create index if not exists idx_slots_cancha     on public.cancha_slots(cancha_id);
create index if not exists idx_slots_fecha      on public.cancha_slots(fecha);
create index if not exists idx_slots_status     on public.cancha_slots(status);
create index if not exists idx_slots_reserved   on public.cancha_slots(reserved_for_gestor_id)
  where reserved_for_gestor_id is not null;

-- 4) Tabla cancha_slot_reservas — gestor que toma el slot
create table if not exists public.cancha_slot_reservas (
  id          uuid primary key default uuid_generate_v4(),
  slot_id     uuid not null unique references public.cancha_slots(id) on delete cascade,
  gestor_id   uuid not null references public.users(id) on delete cascade,
  event_id    uuid references public.events(id) on delete set null,
  status      text not null default 'reserved'
              check (status in ('reserved','converted','cancelled')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_slot_reservas_gestor on public.cancha_slot_reservas(gestor_id);
create index if not exists idx_slot_reservas_event  on public.cancha_slot_reservas(event_id);

-- 5) RLS
alter table public.canchas              enable row level security;
alter table public.cancha_slots         enable row level security;
alter table public.cancha_slot_reservas enable row level security;

-- ── canchas ────────────────────────────────────────────────
-- SELECT: cualquiera autenticado puede ver canchas activas
drop policy if exists "Canchas: select activas" on public.canchas;
create policy "Canchas: select activas" on public.canchas for select
  using (activa = true or owner_id = (select id from public.users where auth_id = (select auth.uid())));

-- INSERT: sólo cancha_admin puede crear, y debe ser owner
drop policy if exists "Canchas: insert cancha_admin" on public.canchas;
create policy "Canchas: insert cancha_admin" on public.canchas for insert
  with check (
    owner_id = (select id from public.users where auth_id = (select auth.uid()))
    and (select role from public.users where auth_id = (select auth.uid())) in ('cancha_admin','admin')
  );

-- UPDATE / DELETE: sólo owner o admin
drop policy if exists "Canchas: update owner" on public.canchas;
create policy "Canchas: update owner" on public.canchas for update
  using (
    owner_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

drop policy if exists "Canchas: delete owner" on public.canchas;
create policy "Canchas: delete owner" on public.canchas for delete
  using (
    owner_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- ── cancha_slots ──────────────────────────────────────────
-- SELECT pública: slots disponibles públicos
-- SELECT privada: el gestor reservado, el owner de la cancha, o admin
drop policy if exists "Slots: select visibles" on public.cancha_slots;
create policy "Slots: select visibles" on public.cancha_slots for select
  using (
    (visibility = 'public')
    or (reserved_for_gestor_id = (select id from public.users where auth_id = (select auth.uid())))
    or (cancha_id in (
          select id from public.canchas
          where owner_id = (select id from public.users where auth_id = (select auth.uid()))
        ))
    or ((select role from public.users where auth_id = (select auth.uid())) = 'admin')
  );

-- INSERT/UPDATE/DELETE: sólo owner de la cancha
drop policy if exists "Slots: insert owner" on public.cancha_slots;
create policy "Slots: insert owner" on public.cancha_slots for insert
  with check (
    cancha_id in (
      select id from public.canchas
      where owner_id = (select id from public.users where auth_id = (select auth.uid()))
    )
  );

drop policy if exists "Slots: update owner" on public.cancha_slots;
create policy "Slots: update owner" on public.cancha_slots for update
  using (
    cancha_id in (
      select id from public.canchas
      where owner_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

drop policy if exists "Slots: delete owner" on public.cancha_slots;
create policy "Slots: delete owner" on public.cancha_slots for delete
  using (
    cancha_id in (
      select id from public.canchas
      where owner_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- ── cancha_slot_reservas ──────────────────────────────────
-- SELECT: el gestor de la reserva, el owner de la cancha, admin
drop policy if exists "Reservas: select involucrados" on public.cancha_slot_reservas;
create policy "Reservas: select involucrados" on public.cancha_slot_reservas for select
  using (
    gestor_id = (select id from public.users where auth_id = (select auth.uid()))
    or slot_id in (
      select s.id from public.cancha_slots s
      join public.canchas c on c.id = s.cancha_id
      where c.owner_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- INSERT: gestor reclama slot (RPC abajo se encarga de la validación atómica)
drop policy if exists "Reservas: insert gestor" on public.cancha_slot_reservas;
create policy "Reservas: insert gestor" on public.cancha_slot_reservas for insert
  with check (
    gestor_id = (select id from public.users where auth_id = (select auth.uid()))
    and (select role from public.users where auth_id = (select auth.uid())) in ('gestor','admin')
  );

-- UPDATE: gestor dueño de la reserva o owner de la cancha
drop policy if exists "Reservas: update involucrados" on public.cancha_slot_reservas;
create policy "Reservas: update involucrados" on public.cancha_slot_reservas for update
  using (
    gestor_id = (select id from public.users where auth_id = (select auth.uid()))
    or slot_id in (
      select s.id from public.cancha_slots s
      join public.canchas c on c.id = s.cancha_id
      where c.owner_id = (select id from public.users where auth_id = (select auth.uid()))
    )
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

-- 6) RPC: claim_cancha_slot — reserva atómica
--    Cambia status del slot a 'claimed' y crea la reserva en una sola transacción.
--    Falla si el slot no está available o si es reservado para otro gestor.
create or replace function public.claim_cancha_slot(
  p_slot_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_role         text;
  v_slot         public.cancha_slots%rowtype;
  v_reserva_id   uuid;
begin
  -- Resolver usuario actual
  select id, role into v_user_id, v_role
    from public.users
    where auth_id = auth.uid();

  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  if v_role not in ('gestor','admin') then
    raise exception 'Sólo gestores pueden reclamar slots';
  end if;

  -- Bloqueo de fila para evitar race conditions
  select * into v_slot
    from public.cancha_slots
    where id = p_slot_id
    for update;

  if not found then
    raise exception 'Slot no existe';
  end if;

  if v_slot.status <> 'available' then
    raise exception 'Slot no disponible (status: %)', v_slot.status;
  end if;

  if v_slot.visibility = 'reserved_for_gestor'
     and v_slot.reserved_for_gestor_id <> v_user_id then
    raise exception 'Este slot está reservado para otro gestor';
  end if;

  -- Marcar slot como claimed
  update public.cancha_slots
    set status = 'claimed'
    where id = p_slot_id;

  -- Crear reserva
  insert into public.cancha_slot_reservas (slot_id, gestor_id, status)
    values (p_slot_id, v_user_id, 'reserved')
    returning id into v_reserva_id;

  return v_reserva_id;
end;
$$;

grant execute on function public.claim_cancha_slot(uuid) to authenticated;

-- 7) RPC: cancel_cancha_slot_reserva — libera el slot
create or replace function public.cancel_cancha_slot_reserva(
  p_reserva_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid;
  v_role     text;
  v_reserva  public.cancha_slot_reservas%rowtype;
  v_slot     public.cancha_slots%rowtype;
begin
  select id, role into v_user_id, v_role
    from public.users
    where auth_id = auth.uid();

  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select * into v_reserva
    from public.cancha_slot_reservas
    where id = p_reserva_id
    for update;

  if not found then
    raise exception 'Reserva no existe';
  end if;

  -- Permisos: gestor dueño, owner de cancha, o admin
  select * into v_slot from public.cancha_slots where id = v_reserva.slot_id;

  if v_reserva.gestor_id <> v_user_id
     and v_role <> 'admin'
     and not exists (
       select 1 from public.canchas
       where id = v_slot.cancha_id
         and owner_id = v_user_id
     )
  then
    raise exception 'Sin permisos para cancelar esta reserva';
  end if;

  if v_reserva.status = 'cancelled' then
    return;
  end if;

  update public.cancha_slot_reservas
    set status = 'cancelled'
    where id = p_reserva_id;

  -- Liberar el slot sólo si no fue convertido a evento
  if v_reserva.status <> 'converted' then
    update public.cancha_slots
      set status = 'available'
      where id = v_reserva.slot_id;
  end if;
end;
$$;

grant execute on function public.cancel_cancha_slot_reserva(uuid) to authenticated;
