-- 2026-05-21 — Columnas seed_home/seed_away en matches para mostrar el LUGAR
-- del equipo en el bracket (ej. "1°A", "2°B").
--
-- Sin esto, el bracket solo mostraba nombre + color del equipo (via join con teams)
-- pero el usuario no podía saber si "Panamá" era el 1° del grupo A o el 2° del grupo B.
--
-- El seed se conserva al avanzar de fase: si "1°A" gana semis, sigue siendo "1°A" en final.

alter table public.matches
  add column if not exists seed_home text,
  add column if not exists seed_away text;

comment on column public.matches.seed_home is
  'Posición original del equipo home del bracket (ej "1°A"). Se conserva al avanzar de fase.';
comment on column public.matches.seed_away is
  'Posición original del equipo away del bracket (ej "2°B").';
