-- ============================================================
-- 2026-05-29 — Mundial 2026: auto-propagación del bracket
-- ============================================================
-- Cuando se carga un marcador (vía wc_admin_override_match_result o
-- vía edge fn api-football), los equipos clasificados se asignan
-- automáticamente al siguiente match del bracket.
--
-- - Vista wc_group_standings: tabla de posiciones por grupo (1°, 2°, 3°)
-- - Vista wc_thirds_ranking: ranking de los 12 terceros lugares
-- - RPC wc_propagate_brackets: llena team_home_id/team_away_id de KO
--   matches cuando se conocen los clasificados.
-- - RPC wc_admin_assign_third_place: admin asigna manual el 3° lugar
--   en placeholders del tipo "3° A/B/C/..." (FIFA usa tabla compleja).
-- - wc_admin_override_match_result modificado para invocar propagate al final.
-- ────────────────────────────────────────────────────────────

create or replace view public.wc_group_standings as
with all_matches as (
  select
    m.group_letter,
    m.team_home_id as team_id,
    m.score_home as gf,
    m.score_away as ga,
    case when m.score_home > m.score_away then 3
         when m.score_home = m.score_away then 1
         else 0 end as pts
  from public.wc_matches m
  where m.phase = 'group' and m.status = 'finished' and m.team_home_id is not null
  union all
  select
    m.group_letter,
    m.team_away_id as team_id,
    m.score_away as gf,
    m.score_home as ga,
    case when m.score_away > m.score_home then 3
         when m.score_away = m.score_home then 1
         else 0 end as pts
  from public.wc_matches m
  where m.phase = 'group' and m.status = 'finished' and m.team_away_id is not null
),
totals as (
  select
    group_letter, team_id,
    sum(pts) as points,
    sum(gf) as goals_for,
    sum(ga) as goals_against,
    sum(gf) - sum(ga) as goal_diff,
    count(*) as matches_played
  from all_matches
  group by group_letter, team_id
)
select
  t.group_letter, t.team_id,
  tm.code as team_code, tm.name_es as team_name,
  t.points, t.goals_for, t.goals_against, t.goal_diff, t.matches_played,
  rank() over (
    partition by t.group_letter
    order by t.points desc, t.goal_diff desc, t.goals_for desc
  ) as position
from totals t
join public.wc_teams tm on tm.id = t.team_id;

create or replace view public.wc_thirds_ranking as
select
  s.group_letter, s.team_id, s.team_code, s.team_name,
  s.points, s.goal_diff, s.goals_for,
  rank() over (order by s.points desc, s.goal_diff desc, s.goals_for desc) as third_rank
from public.wc_group_standings s
where s.position = 3;

create or replace function public.wc_propagate_brackets() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_match  record;
  v_team_id uuid;
  v_grp    text;
  v_pos    int;
  v_mn     int;
  v_propagated int := 0;
  v_changed boolean;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin or service_role';
    end if;
  end if;

  for v_match in
    select id, match_number, phase, home_placeholder, away_placeholder, team_home_id, team_away_id
    from public.wc_matches
    where phase <> 'group' and (team_home_id is null or team_away_id is null)
    order by match_number
  loop
    v_changed := false;

    if v_match.team_home_id is null and v_match.home_placeholder is not null then
      v_team_id := null;
      if v_match.home_placeholder ~ '^[12]° Grupo [A-L]$' then
        v_pos := substring(v_match.home_placeholder from 1 for 1)::int;
        v_grp := substring(v_match.home_placeholder from 10 for 1);
        select team_id into v_team_id from public.wc_group_standings
          where group_letter = v_grp and position = v_pos limit 1;
      elsif v_match.home_placeholder ~ '^Ganador M[0-9]+$' then
        v_mn := substring(v_match.home_placeholder from 'M([0-9]+)$')::int;
        select case
            when score_home is null or score_away is null then null
            when went_to_penalties and penalties_home > penalties_away then team_home_id
            when went_to_penalties and penalties_away > penalties_home then team_away_id
            when score_home > score_away then team_home_id
            when score_away > score_home then team_away_id
            else null
          end into v_team_id
          from public.wc_matches where match_number = v_mn and status = 'finished';
      elsif v_match.home_placeholder ~ '^Perdedor M[0-9]+$' then
        v_mn := substring(v_match.home_placeholder from 'M([0-9]+)$')::int;
        select case
            when score_home is null or score_away is null then null
            when went_to_penalties and penalties_home > penalties_away then team_away_id
            when went_to_penalties and penalties_away > penalties_home then team_home_id
            when score_home > score_away then team_away_id
            when score_away > score_home then team_home_id
            else null
          end into v_team_id
          from public.wc_matches where match_number = v_mn and status = 'finished';
      end if;
      if v_team_id is not null then
        update public.wc_matches set team_home_id = v_team_id where id = v_match.id;
        v_changed := true;
      end if;
    end if;

    if v_match.team_away_id is null and v_match.away_placeholder is not null then
      v_team_id := null;
      if v_match.away_placeholder ~ '^[12]° Grupo [A-L]$' then
        v_pos := substring(v_match.away_placeholder from 1 for 1)::int;
        v_grp := substring(v_match.away_placeholder from 10 for 1);
        select team_id into v_team_id from public.wc_group_standings
          where group_letter = v_grp and position = v_pos limit 1;
      elsif v_match.away_placeholder ~ '^Ganador M[0-9]+$' then
        v_mn := substring(v_match.away_placeholder from 'M([0-9]+)$')::int;
        select case
            when score_home is null or score_away is null then null
            when went_to_penalties and penalties_home > penalties_away then team_home_id
            when went_to_penalties and penalties_away > penalties_home then team_away_id
            when score_home > score_away then team_home_id
            when score_away > score_home then team_away_id
            else null
          end into v_team_id
          from public.wc_matches where match_number = v_mn and status = 'finished';
      elsif v_match.away_placeholder ~ '^Perdedor M[0-9]+$' then
        v_mn := substring(v_match.away_placeholder from 'M([0-9]+)$')::int;
        select case
            when score_home is null or score_away is null then null
            when went_to_penalties and penalties_home > penalties_away then team_away_id
            when went_to_penalties and penalties_away > penalties_home then team_home_id
            when score_home > score_away then team_away_id
            when score_away > score_home then team_home_id
            else null
          end into v_team_id
          from public.wc_matches where match_number = v_mn and status = 'finished';
      end if;
      if v_team_id is not null then
        update public.wc_matches set team_away_id = v_team_id where id = v_match.id;
        v_changed := true;
      end if;
    end if;

    if v_changed then v_propagated := v_propagated + 1; end if;
  end loop;
  return v_propagated;
end;
$$;

revoke execute on function public.wc_propagate_brackets() from public, anon;
grant execute on function public.wc_propagate_brackets() to authenticated, service_role;

-- Asignación manual del 3er lugar por admin (FIFA tiene tabla compleja para
-- decidir qué 3° va a qué partido — por ahora se hace manual).
create or replace function public.wc_admin_assign_third_place(
  p_match_id uuid, p_team_id uuid, p_side text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) <> 'admin' then
      raise exception 'unauthorized: only admin';
    end if;
  end if;
  if p_side = 'home' then
    update public.wc_matches set team_home_id = p_team_id where id = p_match_id;
  elsif p_side = 'away' then
    update public.wc_matches set team_away_id = p_team_id where id = p_match_id;
  else
    raise exception 'side debe ser home o away';
  end if;
end;
$$;

revoke execute on function public.wc_admin_assign_third_place(uuid, uuid, text) from public, anon;
grant execute on function public.wc_admin_assign_third_place(uuid, uuid, text) to authenticated;

-- Override modificado para invocar propagate al final
create or replace function public.wc_admin_override_match_result(
  p_match_id uuid, p_score_home int, p_score_away int,
  p_penalties_home int default null, p_penalties_away int default null,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid;
  v_match    public.wc_matches%rowtype;
  v_all_done boolean;
begin
  if auth.role() <> 'service_role' then
    select id into v_admin_id from public.users where auth_id = (select auth.uid()) and role = 'admin';
    if v_admin_id is null then raise exception 'unauthorized: only admin'; end if;
  end if;
  if p_score_home < 0 or p_score_away < 0 then raise exception 'Marcador inválido'; end if;
  select * into v_match from public.wc_matches where id = p_match_id for update;
  if not found then raise exception 'Partido no encontrado'; end if;

  insert into public.wc_results (
    match_id, admin_override, admin_override_by, admin_override_at,
    admin_score_home, admin_score_away, admin_penalties_home, admin_penalties_away, admin_notes
  ) values (
    p_match_id, true, v_admin_id, now(),
    p_score_home, p_score_away, p_penalties_home, p_penalties_away, p_notes
  )
  on conflict (match_id) do update set
    admin_override=true, admin_override_by=excluded.admin_override_by,
    admin_override_at=excluded.admin_override_at,
    admin_score_home=excluded.admin_score_home, admin_score_away=excluded.admin_score_away,
    admin_penalties_home=excluded.admin_penalties_home, admin_penalties_away=excluded.admin_penalties_away,
    admin_notes=excluded.admin_notes;

  update public.wc_matches
    set score_home=p_score_home, score_away=p_score_away,
        penalties_home=p_penalties_home, penalties_away=p_penalties_away,
        went_to_penalties=(p_penalties_home is not null),
        status='finished', is_resolved=true, resolved_at=now()
    where id = p_match_id;

  perform public.wc_resolve_polla_match(p_match_id);

  select not exists (
    select 1 from public.wc_matches
    where match_day_id = v_match.match_day_id and status <> 'finished'
  ) into v_all_done;

  if v_all_done and v_match.phase = 'group' then
    perform public.wc_resolve_survivor_match_day(v_match.match_day_id);
  end if;

  perform public.wc_propagate_brackets();
end;
$$;

revoke execute on function public.wc_admin_override_match_result(uuid, int, int, int, int, text) from public, anon;
grant execute on function public.wc_admin_override_match_result(uuid, int, int, int, int, text) to authenticated;
