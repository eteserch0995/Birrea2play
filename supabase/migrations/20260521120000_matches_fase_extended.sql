-- 2026-05-21 — Extiende matches.fase para cubrir TODOS los valores que el código usa hoy.
--
-- Hallazgo: la migración previa `20260514000001_matches_fase_tercer_lugar.sql` nunca quedó
-- aplicada en prod (el constraint solo permitía grupos/octavos/cuartos/semis/final). Además
-- el código en `AdminPanel.js` (rama "Eliminación directa") inserta `fase = 'eliminacion'`,
-- valor que NUNCA estuvo en el constraint. Resultado: error al generar fixture.
--
-- Esta migración alinea el constraint con el código actual.

alter table public.matches
  drop constraint if exists matches_fase_check;

alter table public.matches
  add constraint matches_fase_check
    check (fase in (
      'grupos',
      'octavos',
      'cuartos',
      'semis',
      'tercer_lugar',
      'final',
      'eliminacion'
    ));

comment on constraint matches_fase_check on public.matches is
  'Fases válidas según código en app/ y lib/eventHelpers.js (2026-05-21).';
