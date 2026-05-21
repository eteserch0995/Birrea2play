-- 2026-05-14 — Add 'tercer_lugar' to matches.fase check constraint
-- The app code references m.fase === 'tercer_lugar' but the constraint was missing it.
alter table public.matches
  drop constraint if exists matches_fase_check;

alter table public.matches
  add constraint matches_fase_check
    check (fase in ('grupos','semis','cuartos','octavos','tercer_lugar','final'));
