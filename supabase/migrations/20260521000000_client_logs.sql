-- Migration: client_logs
-- Tabla para diagnóstico remoto de bugs en clientes Android Chrome (y cualquier web).
-- Creada por DIAGNOSE-MOBILE agent — 2026-05-21
-- Proyecto Supabase: rumreditrvxkcnlhawut

-- ─── Tabla ───────────────────────────────────────────────────────────────────

create table if not exists public.client_logs (
  id            uuid        primary key default gen_random_uuid(),
  created_at    timestamptz not null    default now(),
  session_id    text        not null,
  user_id       uuid        null        references auth.users(id) on delete set null,
  screen        text        null,
  action        text        null,
  level         text        not null    default 'info'
                check (level in ('info', 'warn', 'error')),
  event_id      uuid        null,
  data          jsonb       null,
  user_agent    text        null,
  url           text        null,
  error_message text        null,
  error_stack   text        null
);

-- ─── Índices para las queries de diagnóstico ─────────────────────────────────

create index if not exists client_logs_created_at_idx
  on public.client_logs (created_at desc);

create index if not exists client_logs_session_id_idx
  on public.client_logs (session_id);

create index if not exists client_logs_level_idx
  on public.client_logs (level)
  where level in ('warn', 'error');

create index if not exists client_logs_screen_action_idx
  on public.client_logs (screen, action);

create index if not exists client_logs_event_id_idx
  on public.client_logs (event_id)
  where event_id is not null;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.client_logs enable row level security;

-- Cualquier cliente anónimo puede insertar (anon key = acceso público de la app).
-- Rate limiting real se hace en aplicación (buffer + batch de máx 50 logs/flush).
create policy "anon_can_insert_client_logs"
  on public.client_logs
  for insert
  to anon, authenticated
  with check (true);

-- Solo el rol service_role (admin SQL Editor, Edge Functions internas) puede leer.
-- Ningún usuario autenticado puede ver logs de otros — privacidad por defecto.
create policy "service_role_can_select_client_logs"
  on public.client_logs
  for select
  to service_role
  using (true);

-- ─── TTL automático via pg_cron (opcional, recomendado) ──────────────────────
-- Elimina logs de más de 30 días para no inflar la tabla indefinidamente.
-- Descomentar después de habilitar la extensión pg_cron en el proyecto.
--
-- select cron.schedule(
--   'delete-old-client-logs',
--   '0 3 * * *',
--   $$ delete from public.client_logs where created_at < now() - interval '30 days' $$
-- );

comment on table public.client_logs is
  'Logs de diagnóstico remoto enviados desde clientes web/Android. INSERT abierto a anon; SELECT solo service_role.';
