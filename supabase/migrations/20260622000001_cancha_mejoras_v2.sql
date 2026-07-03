-- ============================================================
-- 2026-06-22 — Mejoras módulo canchas v2
-- ============================================================
-- (1) cancha_slots: visibility 'blocked_external' + campos cliente externo
-- (2) events: cancha_id, cancha_slot_id, flags confirmación/pago cancha
-- (3) wallet_transactions.tipo: tipos 'pago_cancha' / 'cobro_cancha'
-- (4) users: is_super_admin flag (solo service_role puede escribirlo)
-- (5) RPC: cancha_auto_pay (cron edge fn + gestor manual + admin)
-- (6) RPC: gestor_liberar_cancha
-- ────────────────────────────────────────────────────────────

-- ── 1. cancha_slots: bloqueo para clientes externos ──────────

alter table public.cancha_slots
  add column if not exists cliente_externo_nombre   text,
  add column if not exists cliente_externo_telefono text;

-- Ampliar check de visibility a incluir 'blocked_external'
alter table public.cancha_slots
  drop constraint if exists cancha_slots_visibility_check;
alter table public.cancha_slots
  add constraint cancha_slots_visibility_check
  check (visibility in ('public', 'reserved_for_gestor', 'blocked_external'));

-- Actualizar constraint de consistencia para las tres variantes
alter table public.cancha_slots
  drop constraint if exists chk_slot_reserved_consistency;
alter table public.cancha_slots
  add constraint chk_slot_reserved_consistency check (
    (visibility = 'reserved_for_gestor'
       and reserved_for_gestor_id is not null
       and cliente_externo_nombre is null)
    or (visibility = 'public'
       and reserved_for_gestor_id is null
       and cliente_externo_nombre is null)
    or (visibility = 'blocked_external'
       and reserved_for_gestor_id is null
       and cliente_externo_nombre is not null)
  );

-- Los slots blocked_external no requieren cambio de RLS: la policy existente
-- "Slots: select visibles" sólo expone visibility='public' a usuarios generales,
-- y la condición de cancha owner ya cubre al dueño para cualquier visibility.

-- ── 2. events: link a cancha ──────────────────────────────────

alter table public.events
  add column if not exists cancha_id                     uuid
    references public.canchas(id) on delete set null,
  add column if not exists cancha_slot_id                uuid
    references public.cancha_slots(id) on delete set null,
  add column if not exists cancha_confirmacion_pendiente boolean not null default false,
  add column if not exists cancha_pagada                 boolean not null default false;

create index if not exists idx_events_cancha_slot
  on public.events(cancha_slot_id)
  where cancha_slot_id is not null;

create index if not exists idx_events_confirmacion_pendiente
  on public.events(cancha_confirmacion_pendiente)
  where cancha_confirmacion_pendiente = true;

-- ── 3. wallet_transactions.tipo: ampliar ─────────────────────

alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_tipo_check
  check (tipo in (
    'recarga_yappy', 'recarga_tarjeta', 'inscripcion', 'compra_tienda',
    'mvp_premio', 'ajuste_admin', 'plan_mensual', 'reembolso',
    'pago_cancha',  -- débito conceptual: registro de que el pool financió la cancha
    'cobro_cancha'  -- crédito real en wallet del dueño de cancha
  ));

-- ── 4. users: flag super_admin ────────────────────────────────

alter table public.users
  add column if not exists is_super_admin boolean not null default false;

-- Proteger is_super_admin con trigger (no WITH CHECK, que rompería updates de admin en otros users).
create or replace function public.prevent_is_super_admin_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.is_super_admin <> OLD.is_super_admin and auth.role() <> 'service_role' then
    raise exception 'is_super_admin solo puede cambiarse con service_role';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_prevent_super_admin_change on public.users;
create trigger trg_prevent_super_admin_change
  before update on public.users
  for each row execute function public.prevent_is_super_admin_change();

-- ── 5. RPC: cancha_auto_pay ───────────────────────────────────
-- Paga la cancha desde el pool de inscripciones (suma de monto_pagado confirmadas).
-- Credita wallet del dueño de la cancha con el precio del slot.
-- Llamadores válidos:
--   • service_role (edge function cron cancha-24h-check)
--   • admin (manual desde AdminPanel)
--   • gestor que es created_by del evento (confirmación manual)

create or replace function public.cancha_auto_pay(
  p_event_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id    uuid;
  v_caller_role  text;
  v_event        record;
  v_slot         record;
  v_owner_wallet uuid;
  v_pool_total   numeric;
  v_precio       numeric;
  v_reserva_id   uuid;
begin
  -- Resolución de caller
  if auth.role() <> 'service_role' then
    select u.id, u.role into v_caller_id, v_caller_role
    from public.users u
    where u.auth_id = auth.uid();

    if v_caller_role not in ('admin', 'gestor') then
      raise exception 'Sin permisos para ejecutar pago de cancha';
    end if;
  end if;

  -- Cargar evento + pool de inscripciones confirmadas
  select
    e.id, e.nombre, e.fecha, e.cancha_id, e.cancha_slot_id,
    e.cancha_pagada, e.created_by,
    coalesce(pool_q.total, 0) as pool_total
  into v_event
  from public.events e
  left join lateral (
    select sum(er.monto_pagado) as total
    from public.event_registrations er
    where er.event_id = e.id and er.status = 'confirmed'
  ) pool_q on true
  where e.id = p_event_id;

  if not found then
    raise exception 'Evento no encontrado: %', p_event_id;
  end if;

  -- Verificar ownership si es gestor (no service_role / no admin)
  if auth.role() <> 'service_role' and v_caller_role = 'gestor' then
    if v_event.created_by <> v_caller_id then
      raise exception 'Sin permisos: solo el gestor del evento puede confirmar la cancha';
    end if;
  end if;

  if v_event.cancha_slot_id is null then
    raise exception 'El evento no tiene cancha vinculada';
  end if;

  if v_event.cancha_pagada then
    return jsonb_build_object('ok', true, 'msg', 'La cancha ya fue pagada');
  end if;

  -- Cargar slot + datos de la cancha
  select s.id, s.precio_hora, s.cancha_id, c.owner_id, c.nombre as cancha_nombre
  into v_slot
  from public.cancha_slots s
  join public.canchas c on c.id = s.cancha_id
  where s.id = v_event.cancha_slot_id;

  if not found then
    raise exception 'Slot de cancha no encontrado para el evento';
  end if;

  v_precio     := coalesce(v_slot.precio_hora, 0);
  v_pool_total := v_event.pool_total;

  if v_pool_total < v_precio then
    return jsonb_build_object(
      'ok',     false,
      'msg',    'Pool insuficiente para pagar la cancha',
      'pool',   v_pool_total,
      'precio', v_precio,
      'falta',  v_precio - v_pool_total
    );
  end if;

  -- Wallet del dueño de la cancha
  select w.id into v_owner_wallet
  from public.wallets w
  where w.user_id = v_slot.owner_id;

  if v_owner_wallet is null then
    raise exception 'El dueño de la cancha no tiene wallet. Crear wallet primero.';
  end if;

  -- Creditar al dueño de la cancha
  update public.wallets
    set balance = balance + v_precio
    where id = v_owner_wallet;

  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (
    v_owner_wallet,
    'cobro_cancha',
    v_precio,
    'Pago automático — evento: ' || v_event.nombre || ' (' || v_event.fecha::text || ')'
  );

  -- Marcar reserva como convertida
  update public.cancha_slot_reservas
    set status   = 'converted',
        event_id = p_event_id
    where slot_id = v_event.cancha_slot_id
    returning id into v_reserva_id;

  -- Marcar evento pagado
  update public.events
    set cancha_pagada                 = true,
        cancha_confirmacion_pendiente = false
    where id = p_event_id;

  return jsonb_build_object(
    'ok',          true,
    'monto_pagado', v_precio,
    'pool_total',   v_pool_total,
    'reserva_id',   v_reserva_id,
    'cancha',       v_slot.cancha_nombre
  );
end;
$$;

-- service_role (edge function cron) y authenticated (admin + gestor) pueden llamarlo
grant execute on function public.cancha_auto_pay(uuid) to service_role;
grant execute on function public.cancha_auto_pay(uuid) to authenticated;

-- ── 6. RPC: gestor_liberar_cancha ────────────────────────────
-- El gestor decide NO usar la cancha. El slot vuelve a available.
-- Solo el gestor creador o admin pueden llamarlo.
-- Falla si la cancha ya fue pagada.

create or replace function public.gestor_liberar_cancha(
  p_event_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid;
  v_role     text;
  v_event    public.events%rowtype;
  v_reserva  public.cancha_slot_reservas%rowtype;
begin
  select id, role into v_user_id, v_role
  from public.users
  where auth_id = auth.uid();

  if v_user_id is null then
    raise exception 'Usuario no autenticado';
  end if;

  select * into v_event from public.events where id = p_event_id;

  if not found then
    raise exception 'Evento no encontrado';
  end if;

  if v_event.created_by <> v_user_id and v_role <> 'admin' then
    raise exception 'Sin permisos para liberar la cancha de este evento';
  end if;

  if v_event.cancha_pagada then
    raise exception 'La cancha ya fue pagada y no puede liberarse';
  end if;

  if v_event.cancha_slot_id is null then
    return;
  end if;

  -- Cancelar reserva y liberar slot (bloqueo de fila)
  select * into v_reserva
  from public.cancha_slot_reservas
  where slot_id = v_event.cancha_slot_id
  for update;

  if found and v_reserva.status not in ('cancelled', 'converted') then
    update public.cancha_slot_reservas
      set status = 'cancelled'
      where id = v_reserva.id;

    update public.cancha_slots
      set status = 'available'
      where id = v_event.cancha_slot_id;
  end if;

  -- Deslinkar cancha del evento
  update public.events
    set cancha_id                     = null,
        cancha_slot_id                = null,
        cancha_confirmacion_pendiente = false
    where id = p_event_id;
end;
$$;

grant execute on function public.gestor_liberar_cancha(uuid) to authenticated;

-- ── 7. Seed canchas fijas (PLACEHOLDER — requiere datos reales) ───
-- Ejecutar MANUALMENTE desde Supabase Dashboard (service_role) una vez
-- que Sergio provea: correo del admin de Fredy, correo del admin de Villa Lucre,
-- direcciones, teléfonos y precio/hora de cada cancha.
--
-- DO $$
-- DECLARE
--   v_owner_fredy       uuid;
--   v_owner_villaLucre  uuid;
-- BEGIN
--   SELECT id INTO v_owner_fredy
--     FROM public.users WHERE correo = 'CORREO_ADMIN_FREDY@EMAIL.COM';
--
--   SELECT id INTO v_owner_villaLucre
--     FROM public.users WHERE correo = 'CORREO_ADMIN_VILLA_LUCRE@EMAIL.COM';
--
--   INSERT INTO public.canchas
--     (owner_id, nombre, direccion, distrito, telefono, precio_hora)
--   VALUES
--     (v_owner_fredy,
--      'Fredy Sport Center',
--      'DIRECCION_FREDY', 'Panama',
--      'TELEFONO_FREDY', 0.00),
--     (v_owner_villaLucre,
--      'Futbol Total Villa Lucre',
--      'DIRECCION_VILLA_LUCRE', 'Panama',
--      'TELEFONO_VILLA_LUCRE', 0.00)
--   ON CONFLICT DO NOTHING;
-- END $$;
