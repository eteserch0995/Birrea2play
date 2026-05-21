-- 2026-05-04 — Guests in teams + player cap enforcement
-- 1. Allow guests to be assigned to teams (team_players.user_id becomes nullable,
--    guest_id added as alternative FK).
-- 2. DB-level check ensures exactly one of user_id / guest_id is set.

-- Step 1: drop NOT NULL on user_id so guests can be assigned
alter table public.team_players
  alter column user_id drop not null;

-- Step 2: add guest_id FK
alter table public.team_players
  add column if not exists guest_id uuid
    references public.event_guests(id) on delete cascade;

-- Step 3: XOR constraint — exactly one must be set
alter table public.team_players
  drop constraint if exists tp_user_or_guest;
alter table public.team_players
  add constraint tp_user_or_guest
    check (
      (user_id is not null and guest_id is null) or
      (user_id is null    and guest_id is not null)
    );
