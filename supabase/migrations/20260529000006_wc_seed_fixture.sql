-- ============================================================
-- 2026-05-29 — Módulo Mundial 2026: seed inicial (provisional)
-- ============================================================
-- Carga inicial de 48 equipos en 12 grupos, las jornadas-día y los 104
-- partidos con calendario oficial FIFA (11-jun-2026 → 19-jul-2026).
--
-- ⚠️ DATOS PROVISIONALES: distribución de grupos y emparejamientos
-- basados en información pública previa al sorteo oficial.
-- El admin puede editar TODO desde el panel del Mundial.
-- Cuando se conecte api-football, los datos se sincronizan automáticamente.
--
-- Multipliers por fase:
--   group:1.0, round_32:1.5, round_16:2.0, quarter:2.5, semi:3.0, third_place/final:4.0
-- ────────────────────────────────────────────────────────────

-- ─────────────────────────────────────
-- 1) TEAMS (48 equipos clasificados)
-- ─────────────────────────────────────
insert into public.wc_teams (code, name, name_es, group_letter, is_host, confederation) values
  -- Grupo A
  ('USA', 'United States', 'Estados Unidos', 'A', true,  'CONCACAF'),
  ('NZL', 'New Zealand',   'Nueva Zelanda',  'A', false, 'OFC'),
  ('PAR', 'Paraguay',      'Paraguay',       'A', false, 'CONMEBOL'),
  ('TUN', 'Tunisia',       'Túnez',          'A', false, 'CAF'),
  -- Grupo B
  ('MEX', 'Mexico',        'México',         'B', true,  'CONCACAF'),
  ('JPN', 'Japan',         'Japón',          'B', false, 'AFC'),
  ('SEN', 'Senegal',       'Senegal',        'B', false, 'CAF'),
  ('AUT', 'Austria',       'Austria',        'B', false, 'UEFA'),
  -- Grupo C
  ('CAN', 'Canada',        'Canadá',         'C', true,  'CONCACAF'),
  ('AUS', 'Australia',     'Australia',      'C', false, 'AFC'),
  ('CRC', 'Costa Rica',    'Costa Rica',     'C', false, 'CONCACAF'),
  ('SUI', 'Switzerland',   'Suiza',          'C', false, 'UEFA'),
  -- Grupo D
  ('ARG', 'Argentina',     'Argentina',      'D', false, 'CONMEBOL'),
  ('KOR', 'South Korea',   'Corea del Sur',  'D', false, 'AFC'),
  ('NGA', 'Nigeria',       'Nigeria',        'D', false, 'CAF'),
  ('SCO', 'Scotland',      'Escocia',        'D', false, 'UEFA'),
  -- Grupo E
  ('BRA', 'Brazil',        'Brasil',         'E', false, 'CONMEBOL'),
  ('IRN', 'Iran',          'Irán',           'E', false, 'AFC'),
  ('CIV', 'Ivory Coast',   'Costa de Marfil','E', false, 'CAF'),
  ('SRB', 'Serbia',        'Serbia',         'E', false, 'UEFA'),
  -- Grupo F
  ('ESP', 'Spain',         'España',         'F', false, 'UEFA'),
  ('UZB', 'Uzbekistan',    'Uzbekistán',     'F', false, 'AFC'),
  ('ECU', 'Ecuador',       'Ecuador',        'F', false, 'CONMEBOL'),
  ('PAN', 'Panama',        'Panamá',         'F', false, 'CONCACAF'),
  -- Grupo G
  ('FRA', 'France',        'Francia',        'G', false, 'UEFA'),
  ('MAR', 'Morocco',       'Marruecos',      'G', false, 'CAF'),
  ('KSA', 'Saudi Arabia',  'Arabia Saudita', 'G', false, 'AFC'),
  ('JAM', 'Jamaica',       'Jamaica',        'G', false, 'CONCACAF'),
  -- Grupo H
  ('ENG', 'England',       'Inglaterra',     'H', false, 'UEFA'),
  ('COL', 'Colombia',      'Colombia',       'H', false, 'CONMEBOL'),
  ('EGY', 'Egypt',         'Egipto',         'H', false, 'CAF'),
  ('IRQ', 'Iraq',          'Irak',           'H', false, 'AFC'),
  -- Grupo I
  ('GER', 'Germany',       'Alemania',       'I', false, 'UEFA'),
  ('URU', 'Uruguay',       'Uruguay',        'I', false, 'CONMEBOL'),
  ('GHA', 'Ghana',         'Ghana',          'I', false, 'CAF'),
  ('QAT', 'Qatar',         'Qatar',          'I', false, 'AFC'),
  -- Grupo J
  ('POR', 'Portugal',      'Portugal',       'J', false, 'UEFA'),
  ('NED', 'Netherlands',   'Países Bajos',   'J', false, 'UEFA'),
  ('CMR', 'Cameroon',      'Camerún',        'J', false, 'CAF'),
  ('JOR', 'Jordan',        'Jordania',       'J', false, 'AFC'),
  -- Grupo K
  ('ITA', 'Italy',         'Italia',         'K', false, 'UEFA'),
  ('BEL', 'Belgium',       'Bélgica',        'K', false, 'UEFA'),
  ('DZA', 'Algeria',       'Argelia',        'K', false, 'CAF'),
  ('VEN', 'Venezuela',     'Venezuela',      'K', false, 'CONMEBOL'),
  -- Grupo L
  ('CRO', 'Croatia',       'Croacia',        'L', false, 'UEFA'),
  ('POL', 'Poland',        'Polonia',        'L', false, 'UEFA'),
  ('TUR', 'Turkey',        'Turquía',        'L', false, 'UEFA'),
  ('HON', 'Honduras',      'Honduras',       'L', false, 'CONCACAF')
on conflict (code) do nothing;

-- ─────────────────────────────────────
-- 2) MATCH_DAYS (24 jornadas-día)
-- ─────────────────────────────────────
-- Hora Panamá GMT-5. Pick deadline = first_kickoff - 1h.
-- Fechas: 11-jun a 27-jun grupos, 28-jun a 3-jul R32, 4-jul a 7-jul R16,
-- 9-jul a 11-jul cuartos, 14-jul a 15-jul semis, 18-jul 3°, 19-jul final.

insert into public.wc_match_days (date, first_kickoff_at, pick_deadline, phase) values
  -- Fase de grupos (12 jornadas)
  ('2026-06-11', '2026-06-11 17:00:00+00', '2026-06-11 16:00:00+00', 'group'),  -- 12:00 Panamá
  ('2026-06-12', '2026-06-12 17:00:00+00', '2026-06-12 16:00:00+00', 'group'),
  ('2026-06-13', '2026-06-13 17:00:00+00', '2026-06-13 16:00:00+00', 'group'),
  ('2026-06-14', '2026-06-14 17:00:00+00', '2026-06-14 16:00:00+00', 'group'),
  ('2026-06-15', '2026-06-15 17:00:00+00', '2026-06-15 16:00:00+00', 'group'),
  ('2026-06-16', '2026-06-16 17:00:00+00', '2026-06-16 16:00:00+00', 'group'),
  ('2026-06-17', '2026-06-17 17:00:00+00', '2026-06-17 16:00:00+00', 'group'),
  ('2026-06-18', '2026-06-18 17:00:00+00', '2026-06-18 16:00:00+00', 'group'),
  ('2026-06-19', '2026-06-19 17:00:00+00', '2026-06-19 16:00:00+00', 'group'),
  ('2026-06-20', '2026-06-20 17:00:00+00', '2026-06-20 16:00:00+00', 'group'),
  ('2026-06-21', '2026-06-21 17:00:00+00', '2026-06-21 16:00:00+00', 'group'),
  ('2026-06-22', '2026-06-22 17:00:00+00', '2026-06-22 16:00:00+00', 'group'),
  ('2026-06-23', '2026-06-23 17:00:00+00', '2026-06-23 16:00:00+00', 'group'),
  ('2026-06-24', '2026-06-24 17:00:00+00', '2026-06-24 16:00:00+00', 'group'),
  ('2026-06-25', '2026-06-25 17:00:00+00', '2026-06-25 16:00:00+00', 'group'),
  ('2026-06-26', '2026-06-26 17:00:00+00', '2026-06-26 16:00:00+00', 'group'),
  ('2026-06-27', '2026-06-27 17:00:00+00', '2026-06-27 16:00:00+00', 'group'),
  -- 16avos (R32) - 28 jun a 3 jul
  ('2026-06-28', '2026-06-28 17:00:00+00', '2026-06-28 16:00:00+00', 'round_32'),
  ('2026-06-29', '2026-06-29 17:00:00+00', '2026-06-29 16:00:00+00', 'round_32'),
  ('2026-06-30', '2026-06-30 17:00:00+00', '2026-06-30 16:00:00+00', 'round_32'),
  ('2026-07-01', '2026-07-01 17:00:00+00', '2026-07-01 16:00:00+00', 'round_32'),
  ('2026-07-02', '2026-07-02 17:00:00+00', '2026-07-02 16:00:00+00', 'round_32'),
  ('2026-07-03', '2026-07-03 17:00:00+00', '2026-07-03 16:00:00+00', 'round_32'),
  -- Octavos (R16) - 4 a 7 jul
  ('2026-07-04', '2026-07-04 17:00:00+00', '2026-07-04 16:00:00+00', 'round_16'),
  ('2026-07-05', '2026-07-05 17:00:00+00', '2026-07-05 16:00:00+00', 'round_16'),
  ('2026-07-06', '2026-07-06 17:00:00+00', '2026-07-06 16:00:00+00', 'round_16'),
  ('2026-07-07', '2026-07-07 17:00:00+00', '2026-07-07 16:00:00+00', 'round_16'),
  -- Cuartos - 9 a 11 jul
  ('2026-07-09', '2026-07-09 21:00:00+00', '2026-07-09 20:00:00+00', 'quarter'),
  ('2026-07-10', '2026-07-10 21:00:00+00', '2026-07-10 20:00:00+00', 'quarter'),
  ('2026-07-11', '2026-07-11 21:00:00+00', '2026-07-11 20:00:00+00', 'quarter'),
  -- Semis - 14 y 15 jul
  ('2026-07-14', '2026-07-14 21:00:00+00', '2026-07-14 20:00:00+00', 'semi'),
  ('2026-07-15', '2026-07-15 21:00:00+00', '2026-07-15 20:00:00+00', 'semi'),
  -- 3er lugar - 18 jul
  ('2026-07-18', '2026-07-18 21:00:00+00', '2026-07-18 20:00:00+00', 'third_place'),
  -- Final - 19 jul
  ('2026-07-19', '2026-07-19 19:00:00+00', '2026-07-19 18:00:00+00', 'final')
on conflict (date) do nothing;

-- ─────────────────────────────────────
-- 3) MATCHES de FASE DE GRUPOS (72)
-- ─────────────────────────────────────
-- Cada grupo: 6 partidos. Distribuidos en 3 fechas (J1, J2, J3).
-- Para simplicidad: J1 11-15 jun, J2 16-21 jun, J3 22-27 jun.
-- Sergio puede editar fechas/sedes desde admin.

do $$
declare
  v_team_a uuid; v_team_b uuid; v_team_c uuid; v_team_d uuid;
  v_day_id uuid;
  v_group  text;
  v_groups text[] := array['A','B','C','D','E','F','G','H','I','J','K','L'];
  v_match_num int := 1;
  v_day_idx int;
  v_kickoff timestamptz;
begin
  foreach v_group in array v_groups loop
    -- Resolver los 4 equipos del grupo en orden alfabético del code
    select id into v_team_a from public.wc_teams where group_letter = v_group order by code limit 1 offset 0;
    select id into v_team_b from public.wc_teams where group_letter = v_group order by code limit 1 offset 1;
    select id into v_team_c from public.wc_teams where group_letter = v_group order by code limit 1 offset 2;
    select id into v_team_d from public.wc_teams where group_letter = v_group order by code limit 1 offset 3;

    -- J1: día base 11-jun + (group_idx mod 4). Cada par de grupos comparte día.
    v_day_idx := (ascii(v_group) - ascii('A')) / 2;
    v_kickoff := ('2026-06-11'::date + v_day_idx)::timestamptz + interval '17 hours';
    select id into v_day_id from public.wc_match_days where date = v_kickoff::date;

    -- Partido 1: A vs B
    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff, v_kickoff - interval '1 hour', v_team_a, v_team_b, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;

    -- Partido 2: C vs D (mismo día)
    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff + interval '3 hours', v_kickoff + interval '2 hours', v_team_c, v_team_d, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;

    -- J2: día base 16-jun + offset
    v_kickoff := ('2026-06-16'::date + v_day_idx)::timestamptz + interval '17 hours';
    select id into v_day_id from public.wc_match_days where date = v_kickoff::date;

    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff, v_kickoff - interval '1 hour', v_team_a, v_team_c, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;

    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff + interval '3 hours', v_kickoff + interval '2 hours', v_team_b, v_team_d, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;

    -- J3: día base 22-jun + offset (2 partidos simultáneos para evitar conveniencia)
    v_kickoff := ('2026-06-22'::date + v_day_idx)::timestamptz + interval '17 hours';
    select id into v_day_id from public.wc_match_days where date = v_kickoff::date;

    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff, v_kickoff - interval '1 hour', v_team_a, v_team_d, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;

    insert into public.wc_matches (match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline, team_home_id, team_away_id, multiplier, status)
      values (v_match_num, 'group', v_group, v_day_id, v_kickoff, v_kickoff - interval '1 hour', v_team_b, v_team_c, 1.0, 'scheduled');
    v_match_num := v_match_num + 1;
  end loop;
end $$;

-- ─────────────────────────────────────
-- 4) MATCHES de KNOCKOUT (32) - con placeholders
-- ─────────────────────────────────────
-- R32 = 16 partidos (32 equipos), R16 = 8, Cuartos = 4, Semis = 2, 3°+Final = 2
-- Total: 16 + 8 + 4 + 2 + 1 + 1 = 32 matches eliminatoria.
-- Hot-loaded con placeholders; team_*_id se setean cuando se conoce el cruce.

-- R32 (16avos): 1° vs 2° de grupos. 16 partidos del 28-jun al 3-jul.
do $$
declare
  v_day_id uuid;
  v_kickoff timestamptz;
  v_match_num int := 73;
  v_pair record;
begin
  for v_pair in
    select 1 as match_n, '2026-06-28'::date as md, '1° A' as home, '2° B' as away union all
    select 2,            '2026-06-28',            '1° C',          '2° D' union all
    select 3,            '2026-06-29',            '1° E',          '2° F' union all
    select 4,            '2026-06-29',            '1° G',          '2° H' union all
    select 5,            '2026-06-30',            '1° B',          '2° A' union all
    select 6,            '2026-06-30',            '1° D',          '2° C' union all
    select 7,            '2026-07-01',            '1° F',          '2° E' union all
    select 8,            '2026-07-01',            '1° H',          '2° G' union all
    select 9,            '2026-07-02',            '1° I',          '2° J' union all
    select 10,           '2026-07-02',            '1° K',          '2° L' union all
    select 11,           '2026-07-03',            '1° J',          '2° I' union all
    select 12,           '2026-07-03',            '1° L',          '2° K' union all
    select 13,           '2026-06-28',            '3° A',          '3° C' union all
    select 14,           '2026-06-29',            '3° E',          '3° G' union all
    select 15,           '2026-07-02',            '3° I',          '3° K' union all
    select 16,           '2026-07-01',            '3° B',          '3° D'
  loop
    select id into v_day_id from public.wc_match_days where date = v_pair.md;
    v_kickoff := v_pair.md::timestamptz + interval '17 hours' + interval '1 hour' * (v_match_num % 4);
    insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
      values (v_match_num, 'round_32', v_day_id, v_kickoff, v_kickoff - interval '1 hour', v_pair.home, v_pair.away, 1.5, 'scheduled');
    v_match_num := v_match_num + 1;
  end loop;
end $$;

-- R16 (8vos): 8 partidos del 4 al 7 jul. Placeholders "W M73", etc.
do $$
declare
  v_day_id uuid;
  v_match_num int := 89;
  v_day_idx int := 0;
begin
  for i in 1..8 loop
    select id into v_day_id from public.wc_match_days
      where date = ('2026-07-04'::date + (v_day_idx / 2));
    insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
      values (
        v_match_num, 'round_16', v_day_id,
        ('2026-07-04'::date + (v_day_idx / 2))::timestamptz + interval '17 hours' + interval '4 hours' * (v_day_idx % 2),
        ('2026-07-04'::date + (v_day_idx / 2))::timestamptz + interval '16 hours' + interval '4 hours' * (v_day_idx % 2),
        'Ganador M' || (72 + (i-1)*2 + 1)::text,
        'Ganador M' || (72 + (i-1)*2 + 2)::text,
        2.0, 'scheduled'
      );
    v_match_num := v_match_num + 1;
    v_day_idx := v_day_idx + 1;
  end loop;
end $$;

-- Cuartos: 4 partidos del 9 al 11 jul
do $$
declare
  v_day_id uuid;
  v_match_num int := 97;
  v_dates date[] := array['2026-07-09'::date, '2026-07-09', '2026-07-11', '2026-07-11'];
  v_kickoffs interval[] := array['21 hours'::interval, '24 hours', '21 hours', '24 hours'];
begin
  for i in 1..4 loop
    select id into v_day_id from public.wc_match_days where date = v_dates[i];
    insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
      values (
        v_match_num, 'quarter', v_day_id,
        v_dates[i]::timestamptz + v_kickoffs[i],
        v_dates[i]::timestamptz + v_kickoffs[i] - interval '1 hour',
        'Ganador M' || (88 + (i-1)*2 + 1)::text,
        'Ganador M' || (88 + (i-1)*2 + 2)::text,
        2.5, 'scheduled'
      );
    v_match_num := v_match_num + 1;
  end loop;
end $$;

-- Semis: 2 partidos 14 y 15 jul
do $$
declare
  v_day_id uuid;
  v_match_num int := 101;
  v_dates date[] := array['2026-07-14'::date, '2026-07-15'];
begin
  for i in 1..2 loop
    select id into v_day_id from public.wc_match_days where date = v_dates[i];
    insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
      values (
        v_match_num, 'semi', v_day_id,
        v_dates[i]::timestamptz + interval '21 hours',
        v_dates[i]::timestamptz + interval '20 hours',
        'Ganador M' || (96 + (i-1)*2 + 1)::text,
        'Ganador M' || (96 + (i-1)*2 + 2)::text,
        3.0, 'scheduled'
      );
    v_match_num := v_match_num + 1;
  end loop;
end $$;

-- 3er lugar y Final
insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
  select 103, 'third_place', id,
         '2026-07-18 21:00:00+00'::timestamptz,
         '2026-07-18 20:00:00+00'::timestamptz,
         'Perdedor Semi 1', 'Perdedor Semi 2', 4.0, 'scheduled'
  from public.wc_match_days where date = '2026-07-18';

insert into public.wc_matches (match_number, phase, match_day_id, scheduled_at, prediction_deadline, home_placeholder, away_placeholder, multiplier, status)
  select 104, 'final', id,
         '2026-07-19 19:00:00+00'::timestamptz,
         '2026-07-19 18:00:00+00'::timestamptz,
         'Ganador Semi 1', 'Ganador Semi 2', 4.0, 'scheduled'
  from public.wc_match_days where date = '2026-07-19';

-- ─────────────────────────────────────
-- 5) Notas en wc_pools
-- ─────────────────────────────────────
update public.wc_pools
  set notes = 'Datos provisionales cargados 2026-05-29. Grupos y emparejamientos basados en información pública pre-sorteo. Editar desde admin si difieren del sorteo oficial.'
  where season = 'fifa_wc_2026';
