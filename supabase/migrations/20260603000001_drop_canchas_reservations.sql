-- 2026-06-03 — Fase 0 del Club Birreoso: remover el modulo de RESERVAS de canchas (slots).
-- Estaba sin uso (0 filas en canchas/cancha_slots/cancha_slot_reservas, 0 usuarios cancha_admin).
-- NO toca cancha_tarifas ni events.cancha_costo/cancha_tarifa_id/duracion_horas
-- (esa es la feature de COSTO de cancha por evento, sigue activa).
drop function if exists public.claim_cancha_slot(uuid) cascade;
drop function if exists public.cancel_cancha_slot_reserva(uuid) cascade;
drop table if exists public.cancha_slot_reservas cascade;
drop table if exists public.cancha_slots cascade;
drop table if exists public.canchas cascade;

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('player','gestor','admin'));
