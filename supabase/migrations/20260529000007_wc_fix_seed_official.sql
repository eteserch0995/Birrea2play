-- ============================================================
-- 2026-05-29 — CORRECCIÓN seed Mundial 2026 (fixture oficial)
-- ============================================================
-- Reemplaza el seed provisional con los grupos y partidos oficiales
-- confirmados por Sergio. Borra y re-inserta wc_matches/wc_match_days
-- y actualiza wc_teams a los 48 reales clasificados.
--
-- Grupos finales:
-- A: MEX, ZAF, KOR, CZE
-- B: CAN, BIH, QAT, SUI
-- C: BRA, MAR, HAI, SCO
-- D: USA, PAR, AUS, TUR
-- E: GER, CUW, CIV, ECU
-- F: NED, JPN, TUN, SWE
-- G: BEL, EGY, IRN, NZL
-- H: ESP, CPV, KSA, URU
-- I: FRA, SEN, IRQ, NOR
-- J: ARG, DZA, AUT, JOR
-- K: POR, COD, UZB, COL
-- L: ENG, CRO, GHA, PAN
-- ────────────────────────────────────────────────────────────

-- 1) Limpiar (cascada a wc_picks, wc_predictions si las hubiera)
delete from public.wc_matches;
delete from public.wc_match_days;

-- 2) Quitar teams que NO van al Mundial real
delete from public.wc_teams where code in ('CRC','NGA','SRB','JAM','CMR','ITA','VEN','POL','HON');

-- 3) Upsert los 48 teams reales con sus grupos correctos
insert into public.wc_teams (code, name, name_es, group_letter, is_host, confederation) values
  ('MEX','Mexico','México','A',true,'CONCACAF'),
  ('ZAF','South Africa','Sudáfrica','A',false,'CAF'),
  ('KOR','South Korea','Corea del Sur','A',false,'AFC'),
  ('CZE','Czech Republic','Chequia','A',false,'UEFA'),
  ('CAN','Canada','Canadá','B',true,'CONCACAF'),
  ('BIH','Bosnia and Herzegovina','Bosnia y Herzegovina','B',false,'UEFA'),
  ('QAT','Qatar','Catar','B',false,'AFC'),
  ('SUI','Switzerland','Suiza','B',false,'UEFA'),
  ('BRA','Brazil','Brasil','C',false,'CONMEBOL'),
  ('MAR','Morocco','Marruecos','C',false,'CAF'),
  ('HAI','Haiti','Haití','C',false,'CONCACAF'),
  ('SCO','Scotland','Escocia','C',false,'UEFA'),
  ('USA','United States','Estados Unidos','D',true,'CONCACAF'),
  ('PAR','Paraguay','Paraguay','D',false,'CONMEBOL'),
  ('AUS','Australia','Australia','D',false,'AFC'),
  ('TUR','Turkey','Turquía','D',false,'UEFA'),
  ('GER','Germany','Alemania','E',false,'UEFA'),
  ('CUW','Curaçao','Curazao','E',false,'CONCACAF'),
  ('CIV','Ivory Coast','Costa de Marfil','E',false,'CAF'),
  ('ECU','Ecuador','Ecuador','E',false,'CONMEBOL'),
  ('NED','Netherlands','Países Bajos','F',false,'UEFA'),
  ('JPN','Japan','Japón','F',false,'AFC'),
  ('TUN','Tunisia','Túnez','F',false,'CAF'),
  ('SWE','Sweden','Suecia','F',false,'UEFA'),
  ('BEL','Belgium','Bélgica','G',false,'UEFA'),
  ('EGY','Egypt','Egipto','G',false,'CAF'),
  ('IRN','Iran','Irán','G',false,'AFC'),
  ('NZL','New Zealand','Nueva Zelanda','G',false,'OFC'),
  ('ESP','Spain','España','H',false,'UEFA'),
  ('CPV','Cabo Verde','Cabo Verde','H',false,'CAF'),
  ('KSA','Saudi Arabia','Arabia Saudita','H',false,'AFC'),
  ('URU','Uruguay','Uruguay','H',false,'CONMEBOL'),
  ('FRA','France','Francia','I',false,'UEFA'),
  ('SEN','Senegal','Senegal','I',false,'CAF'),
  ('IRQ','Iraq','Irak','I',false,'AFC'),
  ('NOR','Norway','Noruega','I',false,'UEFA'),
  ('ARG','Argentina','Argentina','J',false,'CONMEBOL'),
  ('DZA','Algeria','Argelia','J',false,'CAF'),
  ('AUT','Austria','Austria','J',false,'UEFA'),
  ('JOR','Jordan','Jordania','J',false,'AFC'),
  ('POR','Portugal','Portugal','K',false,'UEFA'),
  ('COD','DR Congo','RD Congo','K',false,'CAF'),
  ('UZB','Uzbekistan','Uzbekistán','K',false,'AFC'),
  ('COL','Colombia','Colombia','K',false,'CONMEBOL'),
  ('ENG','England','Inglaterra','L',false,'UEFA'),
  ('CRO','Croatia','Croacia','L',false,'UEFA'),
  ('GHA','Ghana','Ghana','L',false,'CAF'),
  ('PAN','Panama','Panamá','L',false,'CONCACAF')
on conflict (code) do update set
  name          = excluded.name,
  name_es       = excluded.name_es,
  group_letter  = excluded.group_letter,
  is_host       = excluded.is_host,
  confederation = excluded.confederation;

-- 4) Match days oficial
insert into public.wc_match_days (date, first_kickoff_at, pick_deadline, phase) values
  ('2026-06-11', '2026-06-11 17:00:00+00', '2026-06-11 16:00:00+00', 'group'),
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
  ('2026-06-28', '2026-06-28 17:00:00+00', '2026-06-28 16:00:00+00', 'round_32'),
  ('2026-06-29', '2026-06-29 17:00:00+00', '2026-06-29 16:00:00+00', 'round_32'),
  ('2026-06-30', '2026-06-30 17:00:00+00', '2026-06-30 16:00:00+00', 'round_32'),
  ('2026-07-01', '2026-07-01 17:00:00+00', '2026-07-01 16:00:00+00', 'round_32'),
  ('2026-07-02', '2026-07-02 17:00:00+00', '2026-07-02 16:00:00+00', 'round_32'),
  ('2026-07-03', '2026-07-03 17:00:00+00', '2026-07-03 16:00:00+00', 'round_32'),
  ('2026-07-04', '2026-07-04 17:00:00+00', '2026-07-04 16:00:00+00', 'round_16'),
  ('2026-07-05', '2026-07-05 17:00:00+00', '2026-07-05 16:00:00+00', 'round_16'),
  ('2026-07-06', '2026-07-06 17:00:00+00', '2026-07-06 16:00:00+00', 'round_16'),
  ('2026-07-07', '2026-07-07 17:00:00+00', '2026-07-07 16:00:00+00', 'round_16'),
  ('2026-07-09', '2026-07-09 21:00:00+00', '2026-07-09 20:00:00+00', 'quarter'),
  ('2026-07-10', '2026-07-10 21:00:00+00', '2026-07-10 20:00:00+00', 'quarter'),
  ('2026-07-11', '2026-07-11 21:00:00+00', '2026-07-11 20:00:00+00', 'quarter'),
  ('2026-07-14', '2026-07-14 21:00:00+00', '2026-07-14 20:00:00+00', 'semi'),
  ('2026-07-15', '2026-07-15 21:00:00+00', '2026-07-15 20:00:00+00', 'semi'),
  ('2026-07-18', '2026-07-18 21:00:00+00', '2026-07-18 20:00:00+00', 'third_place'),
  ('2026-07-19', '2026-07-19 19:00:00+00', '2026-07-19 18:00:00+00', 'final');

-- 5) Matches de grupos (72) via CTE para resolver IDs por código
with day_lookup as (
  select id as day_id, date from public.wc_match_days
),
team_lookup as (
  select id as team_id, code from public.wc_teams
),
match_data (mn, grp, home_code, away_code, mdate) as (values
  (1,'A','MEX','ZAF','2026-06-11'::date),
  (2,'A','KOR','CZE','2026-06-11'::date),
  (3,'B','CAN','BIH','2026-06-12'::date),
  (4,'D','USA','PAR','2026-06-12'::date),
  (5,'B','QAT','SUI','2026-06-13'::date),
  (6,'C','BRA','MAR','2026-06-13'::date),
  (7,'C','HAI','SCO','2026-06-13'::date),
  (8,'D','AUS','TUR','2026-06-13'::date),
  (9,'E','GER','CUW','2026-06-14'::date),
  (10,'F','NED','JPN','2026-06-14'::date),
  (11,'E','CIV','ECU','2026-06-14'::date),
  (12,'F','TUN','SWE','2026-06-14'::date),
  (13,'H','ESP','CPV','2026-06-15'::date),
  (14,'G','BEL','EGY','2026-06-15'::date),
  (15,'H','KSA','URU','2026-06-15'::date),
  (16,'G','IRN','NZL','2026-06-15'::date),
  (17,'I','FRA','SEN','2026-06-16'::date),
  (18,'I','IRQ','NOR','2026-06-16'::date),
  (19,'J','ARG','DZA','2026-06-16'::date),
  (20,'J','AUT','JOR','2026-06-16'::date),
  (21,'K','POR','COD','2026-06-17'::date),
  (22,'L','ENG','CRO','2026-06-17'::date),
  (23,'L','GHA','PAN','2026-06-17'::date),
  (24,'K','UZB','COL','2026-06-17'::date),
  (25,'A','CZE','ZAF','2026-06-18'::date),
  (26,'B','SUI','BIH','2026-06-18'::date),
  (27,'B','CAN','QAT','2026-06-18'::date),
  (28,'A','MEX','KOR','2026-06-18'::date),
  (29,'D','USA','AUS','2026-06-19'::date),
  (30,'C','SCO','MAR','2026-06-19'::date),
  (31,'C','BRA','HAI','2026-06-19'::date),
  (32,'D','TUR','PAR','2026-06-19'::date),
  (33,'F','NED','SWE','2026-06-20'::date),
  (34,'E','GER','CIV','2026-06-20'::date),
  (35,'E','ECU','CUW','2026-06-20'::date),
  (36,'F','TUN','JPN','2026-06-20'::date),
  (37,'H','ESP','KSA','2026-06-21'::date),
  (38,'G','BEL','IRN','2026-06-21'::date),
  (39,'H','URU','CPV','2026-06-21'::date),
  (40,'G','NZL','EGY','2026-06-21'::date),
  (41,'J','ARG','AUT','2026-06-22'::date),
  (42,'I','FRA','IRQ','2026-06-22'::date),
  (43,'I','NOR','SEN','2026-06-22'::date),
  (44,'J','JOR','DZA','2026-06-22'::date),
  (45,'K','POR','UZB','2026-06-23'::date),
  (46,'L','ENG','GHA','2026-06-23'::date),
  (47,'L','PAN','CRO','2026-06-23'::date),
  (48,'K','COL','COD','2026-06-23'::date),
  (49,'B','SUI','CAN','2026-06-24'::date),
  (50,'B','BIH','QAT','2026-06-24'::date),
  (51,'C','BRA','SCO','2026-06-24'::date),
  (52,'C','MAR','HAI','2026-06-24'::date),
  (53,'A','MEX','CZE','2026-06-24'::date),
  (54,'A','KOR','ZAF','2026-06-24'::date),
  (55,'E','ECU','GER','2026-06-25'::date),
  (56,'E','CUW','CIV','2026-06-25'::date),
  (57,'F','TUN','NED','2026-06-25'::date),
  (58,'F','JPN','SWE','2026-06-25'::date),
  (59,'D','USA','TUR','2026-06-25'::date),
  (60,'D','PAR','AUS','2026-06-25'::date),
  (61,'I','NOR','FRA','2026-06-26'::date),
  (62,'I','SEN','IRQ','2026-06-26'::date),
  (63,'H','URU','ESP','2026-06-26'::date),
  (64,'H','CPV','KSA','2026-06-26'::date),
  (65,'G','NZL','BEL','2026-06-26'::date),
  (66,'G','EGY','IRN','2026-06-26'::date),
  (67,'L','PAN','ENG','2026-06-27'::date),
  (68,'L','CRO','GHA','2026-06-27'::date),
  (69,'K','COL','POR','2026-06-27'::date),
  (70,'K','COD','UZB','2026-06-27'::date),
  (71,'J','ARG','JOR','2026-06-27'::date),
  (72,'J','DZA','AUT','2026-06-27'::date)
)
insert into public.wc_matches (
  match_number, phase, group_letter, match_day_id, scheduled_at, prediction_deadline,
  team_home_id, team_away_id, multiplier, status
)
select
  md.mn, 'group', md.grp, d.day_id,
  d.date::timestamptz + interval '17 hours' + (((md.mn - 1) % 6) * interval '30 minutes'),
  d.date::timestamptz + interval '17 hours' + (((md.mn - 1) % 6) * interval '30 minutes') - interval '1 hour',
  h.team_id, a.team_id, 1.0, 'scheduled'
from match_data md
join day_lookup d on d.date = md.mdate
join team_lookup h on h.code = md.home_code
join team_lookup a on a.code = md.away_code;

-- 6) Matches knockout con placeholders correctos (32 matches)
with day_lookup as (select id as day_id, date from public.wc_match_days),
ko_data (mn, phase, mdate, home_ph, away_ph, mult) as (values
  -- R32
  (73,'round_32','2026-06-28'::date,'2° Grupo A','2° Grupo B',1.5),
  (74,'round_32','2026-06-29'::date,'1° Grupo E','3° A/B/C/D/F',1.5),
  (75,'round_32','2026-06-29'::date,'1° Grupo F','2° Grupo C',1.5),
  (76,'round_32','2026-06-29'::date,'1° Grupo C','2° Grupo F',1.5),
  (77,'round_32','2026-06-30'::date,'1° Grupo I','3° C/D/F/G/H',1.5),
  (78,'round_32','2026-06-30'::date,'2° Grupo E','2° Grupo I',1.5),
  (79,'round_32','2026-06-30'::date,'1° Grupo A','3° C/E/F/H/I',1.5),
  (80,'round_32','2026-07-01'::date,'1° Grupo L','3° E/H/I/J/K',1.5),
  (81,'round_32','2026-07-01'::date,'1° Grupo D','3° B/E/F/I/J',1.5),
  (82,'round_32','2026-07-01'::date,'1° Grupo G','3° A/E/H/I/J',1.5),
  (83,'round_32','2026-07-02'::date,'2° Grupo K','2° Grupo L',1.5),
  (84,'round_32','2026-07-02'::date,'1° Grupo H','2° Grupo J',1.5),
  (85,'round_32','2026-07-02'::date,'1° Grupo B','3° D/E/I/J/L',1.5),
  (86,'round_32','2026-07-03'::date,'1° Grupo J','2° Grupo H',1.5),
  (87,'round_32','2026-07-03'::date,'1° Grupo K','3° D/E/I/J/L',1.5),
  (88,'round_32','2026-07-03'::date,'2° Grupo D','2° Grupo G',1.5),
  -- R16
  (89,'round_16','2026-07-04'::date,'Ganador M74','Ganador M77',2.0),
  (90,'round_16','2026-07-04'::date,'Ganador M73','Ganador M75',2.0),
  (91,'round_16','2026-07-05'::date,'Ganador M76','Ganador M78',2.0),
  (92,'round_16','2026-07-05'::date,'Ganador M79','Ganador M80',2.0),
  (93,'round_16','2026-07-06'::date,'Ganador M83','Ganador M84',2.0),
  (94,'round_16','2026-07-06'::date,'Ganador M81','Ganador M82',2.0),
  (95,'round_16','2026-07-07'::date,'Ganador M85','Ganador M86',2.0),
  (96,'round_16','2026-07-07'::date,'Ganador M87','Ganador M88',2.0),
  -- Cuartos
  (97,'quarter','2026-07-09'::date,'Ganador M89','Ganador M90',2.5),
  (98,'quarter','2026-07-10'::date,'Ganador M93','Ganador M94',2.5),
  (99,'quarter','2026-07-11'::date,'Ganador M91','Ganador M92',2.5),
  (100,'quarter','2026-07-11'::date,'Ganador M95','Ganador M96',2.5),
  -- Semis
  (101,'semi','2026-07-14'::date,'Ganador M97','Ganador M98',3.0),
  (102,'semi','2026-07-15'::date,'Ganador M99','Ganador M100',3.0),
  -- 3°
  (103,'third_place','2026-07-18'::date,'Perdedor M101','Perdedor M102',4.0),
  -- Final
  (104,'final','2026-07-19'::date,'Ganador M101','Ganador M102',4.0)
)
insert into public.wc_matches (
  match_number, phase, match_day_id, scheduled_at, prediction_deadline,
  home_placeholder, away_placeholder, multiplier, status
)
select
  k.mn, k.phase, d.day_id,
  case
    when k.phase in ('quarter','semi','third_place') then k.mdate::timestamptz + interval '21 hours' + (((k.mn - 1) % 2) * interval '3 hours')
    when k.phase = 'final' then k.mdate::timestamptz + interval '19 hours'
    else k.mdate::timestamptz + interval '17 hours' + (((k.mn - 1) % 3) * interval '3 hours')
  end as scheduled_at,
  case
    when k.phase in ('quarter','semi','third_place') then k.mdate::timestamptz + interval '20 hours' + (((k.mn - 1) % 2) * interval '3 hours')
    when k.phase = 'final' then k.mdate::timestamptz + interval '18 hours'
    else k.mdate::timestamptz + interval '16 hours' + (((k.mn - 1) % 3) * interval '3 hours')
  end as prediction_deadline,
  k.home_ph, k.away_ph, k.mult, 'scheduled'
from ko_data k
join day_lookup d on d.date = k.mdate;

-- 7) Update notes del pool
update public.wc_pools
  set notes = 'Fixture oficial Mundial 2026 cargado 2026-05-29. Grupos confirmados según sorteo.'
  where season = 'fifa_wc_2026';
