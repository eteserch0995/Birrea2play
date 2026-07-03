-- Cronómetro único por evento (cuenta regresiva) — 2026-06-25
-- Un solo cronómetro por evento, vive en la tabla `events`.
-- Controlado por el gestor dueño del evento o por admin; los jugadores solo lo
-- ven (read-only) desde "ver evento en curso".
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.events
  add column if not exists timer_status        text    not null default 'idle',  -- 'idle' | 'running' | 'paused'
  add column if not exists timer_duration_sec  integer not null default 1500,     -- duración configurada (default 25:00)
  add column if not exists timer_ends_at       timestamptz,                       -- fin absoluto (cuando running)
  add column if not exists timer_remaining_sec integer;                           -- restante (cuando idle/paused)

-- Backfill para filas existentes: idle con remaining = duración
update public.events
  set timer_remaining_sec = coalesce(timer_remaining_sec, timer_duration_sec)
  where timer_remaining_sec is null;

-- ── Lectura: estado del timer + hora del servidor (para sync exacta) ──────────
create or replace function public.get_event_timer(p_event_id uuid)
returns table (
  timer_status        text,
  timer_duration_sec  integer,
  timer_ends_at       timestamptz,
  timer_remaining_sec integer,
  server_now          timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.timer_status, e.timer_duration_sec, e.timer_ends_at, e.timer_remaining_sec, now()
  from public.events e
  where e.id = p_event_id;
$$;

grant execute on function public.get_event_timer(uuid) to anon, authenticated;

-- ── Control: config / start / pause / reset ──────────────────────────────────
-- SECURITY DEFINER con caller-check explícito: aunque hay GRANT a authenticated,
-- adentro validamos que el caller sea admin o el dueño (created_by) del evento.
create or replace function public.set_event_timer(
  p_event_id     uuid,
  p_action       text,
  p_duration_sec integer default null
)
returns table (
  timer_status        text,
  timer_duration_sec  integer,
  timer_ends_at       timestamptz,
  timer_remaining_sec integer,
  server_now          timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_user_id    uuid;
  v_role       text;
  v_created_by uuid;
  v_status     text;
  v_duration   integer;
  v_remaining  integer;
  v_ends_at    timestamptz;
begin
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select id, role into v_user_id, v_role
    from public.users where auth_id = v_uid;
  if v_user_id is null then
    raise exception 'Usuario no encontrado';
  end if;

  select e.created_by, e.timer_status, e.timer_duration_sec, e.timer_remaining_sec, e.timer_ends_at
    into v_created_by, v_status, v_duration, v_remaining, v_ends_at
    from public.events e
    where e.id = p_event_id
    for update;
  if not found then
    raise exception 'Evento no encontrado';
  end if;

  -- Caller-check NULL-safe: deniega por defecto (role NULL no es 'admin').
  if v_role is distinct from 'admin' and v_created_by is distinct from v_user_id then
    raise exception 'Sin permiso para controlar el cronómetro de este evento';
  end if;

  if p_action = 'config' then
    if p_duration_sec is null or p_duration_sec <= 0 then
      raise exception 'Duración inválida';
    end if;
    update public.events set
      timer_status        = 'idle',
      timer_duration_sec  = least(p_duration_sec, 86400),  -- tope defensivo 24h
      timer_remaining_sec = least(p_duration_sec, 86400),
      timer_ends_at       = null
      where id = p_event_id;

  elsif p_action = 'start' then
    -- Idempotente: si ya está corriendo no reinicia (evita doble-tap que lo alarga).
    -- Reanuda desde lo restante; si no hay (o llegó a 0) usa la duración completa.
    if v_status is distinct from 'running' then
      v_remaining := coalesce(nullif(v_remaining, 0), v_duration);
      if v_remaining is null or v_remaining <= 0 then
        v_remaining := v_duration;
      end if;
      update public.events set
        timer_status        = 'running',
        timer_ends_at       = now() + make_interval(secs => v_remaining),
        timer_remaining_sec = null
        where id = p_event_id;
    end if;

  elsif p_action = 'pause' then
    -- Solo pausa si está corriendo; usa var local v_ends_at (evita ambigüedad columna/OUT).
    if v_status = 'running' then
      update public.events set
        timer_status        = 'paused',
        timer_remaining_sec = greatest(0, ceil(extract(epoch from (coalesce(v_ends_at, now()) - now())))::int),
        timer_ends_at       = null
        where id = p_event_id;
    end if;

  elsif p_action = 'reset' then
    update public.events set
      timer_status        = 'idle',
      timer_remaining_sec = v_duration,
      timer_ends_at       = null
      where id = p_event_id;

  else
    raise exception 'Acción inválida: %', p_action;
  end if;

  return query
    select e.timer_status, e.timer_duration_sec, e.timer_ends_at, e.timer_remaining_sec, now()
    from public.events e
    where e.id = p_event_id;
end;
$$;

grant execute on function public.set_event_timer(uuid, text, integer) to authenticated;
