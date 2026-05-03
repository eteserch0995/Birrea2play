-- Phase 1 & 2 fixes — 2026-05-03
-- F1-1: Orders RLS (admin read/update)
-- F1-2: Events RLS (gestor/admin update + delete)
-- F2-2: Events delete policies
-- F2-4: Court photo + Google Maps columns
-- ─────────────────────────────────────────────────────────────────

-- F1-1: Admin can read all orders
drop policy if exists "Admin reads all orders" on public.orders;
create policy "Admin reads all orders" on public.orders for select
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- F1-1: Admin can update orders (mark delivered, etc.)
drop policy if exists "Admin updates orders" on public.orders;
create policy "Admin updates orders" on public.orders for update
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- F1-2: Gestor can update their own events
drop policy if exists "Gestor updates own events" on public.events;
create policy "Gestor updates own events" on public.events for update
  using (created_by = (select id from public.users where auth_id = (select auth.uid())));

-- F1-2: Admin can update any event
drop policy if exists "Admin updates any event" on public.events;
create policy "Admin updates any event" on public.events for update
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- F2-2: Gestor can delete their own events
drop policy if exists "Gestor deletes own events" on public.events;
create policy "Gestor deletes own events" on public.events for delete
  using (created_by = (select id from public.users where auth_id = (select auth.uid())));

-- F2-2: Admin can delete any event
drop policy if exists "Admin deletes any event" on public.events;
create policy "Admin deletes any event" on public.events for delete
  using ((select role from public.users where auth_id = (select auth.uid())) = 'admin');

-- F2-4: Court photo and Google Maps URL
alter table public.events
  add column if not exists cancha_foto_url text,
  add column if not exists maps_url        text;

-- Storage bucket policies for 'event-photos' bucket
-- (Run separately in Supabase dashboard if bucket doesn't exist yet)
-- insert into storage.buckets (id, name, public) values ('event-photos', 'event-photos', true) on conflict do nothing;
