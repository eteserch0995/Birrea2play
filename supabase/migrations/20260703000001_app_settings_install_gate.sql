-- Migration: app_settings + install_gate (kill switch remoto del embudo PWA)
-- Espejo EXACTO de lo aplicado en prod vía MCP el 2026-07-03. No re-ejecutar
-- contra el proyecto rumreditrvxkcnlhawut (ya existe) — este archivo es para
-- que el repo/migraciones locales queden en sync con el estado real de prod.

-- ─── Tabla ───────────────────────────────────────────────────────────────────
-- key/value genérico para flags de producto controlados desde SQL sin deploy.
-- Primer uso: 'install_gate' = {"enabled":bool,"bonus":bool,"cloud":bool}
-- que apaga/prende nube de instalación, gate por acción y bono $1 sin tocar código.

create table if not exists public.app_settings (
  key        text        primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.app_settings enable row level security;

-- Lectura pública (anon + authenticated): el cliente necesita leer el flag
-- ANTES de saber si el usuario está logueado (mobile web recién llega).
create policy "app_settings_public_read"
  on public.app_settings
  for select
  to anon, authenticated
  using (true);

-- Escritura solo admin: caller check vía public.users.role, NO por header/claim
-- (mismo patrón que el resto de RPCs sensibles del proyecto).
create policy "app_settings_admin_write"
  on public.app_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from users u
      where u.auth_id = (select auth.uid())
        and u.role::text = 'admin'
    )
  )
  with check (
    exists (
      select 1 from users u
      where u.auth_id = (select auth.uid())
        and u.role::text = 'admin'
    )
  );

-- ─── Seed ────────────────────────────────────────────────────────────────────
-- on conflict do nothing: si ya existe (prod), no pisa el valor actual configurado
-- por Sergio vía SQL editor / admin panel.

insert into public.app_settings (key, value)
values ('install_gate', '{"enabled":true,"bonus":true,"cloud":true}'::jsonb)
on conflict (key) do nothing;

comment on table public.app_settings is
  'Flags de producto key/value leídos por el cliente (RLS: lectura pública, escritura solo admin). Kill switch remoto del embudo de instalación PWA (install_gate) sin requerir deploy.';
