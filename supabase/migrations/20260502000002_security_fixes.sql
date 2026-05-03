-- ─── Security & Performance Fixes ────────────────────────────────────────────

-- 1. standings view: security_invoker so RLS is evaluated as the calling user
drop view if exists public.standings;
create view public.standings with (security_invoker = true) as
select team_id, event_id, equipo, color, grupo, pj, pg, pe, pp, gf, gc, pts
from (
  select
    t.id          as team_id,
    t.event_id,
    t.nombre      as equipo,
    t.color,
    t.grupo,
    count(m.id)   as pj,
    count(case when (m.team_home_id = t.id and m.goles_home > m.goles_away)
                  or (m.team_away_id = t.id and m.goles_away > m.goles_home)
               then 1 end) as pg,
    count(case when m.goles_home = m.goles_away then 1 end) as pe,
    count(case when (m.team_home_id = t.id and m.goles_home < m.goles_away)
                  or (m.team_away_id = t.id and m.goles_away < m.goles_home)
               then 1 end) as pp,
    coalesce(sum(case when m.team_home_id = t.id then m.goles_home
                      when m.team_away_id  = t.id then m.goles_away end), 0) as gf,
    coalesce(sum(case when m.team_home_id = t.id then m.goles_away
                      when m.team_away_id  = t.id then m.goles_home end), 0) as gc,
    (count(case when (m.team_home_id = t.id and m.goles_home > m.goles_away)
                   or (m.team_away_id = t.id and m.goles_away > m.goles_home)
                then 1 end) * 3
     + count(case when m.goles_home = m.goles_away then 1 end)) as pts
  from teams t
  left join matches m on (
    (m.team_home_id = t.id or m.team_away_id = t.id)
    and m.status = 'finished'
    and (m.fase is null or m.fase = 'grupos')
  )
  group by t.id, t.event_id, t.nombre, t.color, t.grupo
) sub
order by pts desc, (gf - gc) desc;

-- 2. create_wallet_for_user: fix mutable search_path (security definer needs fixed path)
create or replace function public.create_wallet_for_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into wallets (user_id) values (new.id);
  return new;
end;
$$;

-- 3. update_updated_at: fix mutable search_path
create or replace function public.update_updated_at()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 4. RLS: replace bare auth.uid() with (select auth.uid()) to cache per-query
--    Resolves auth_rls_initplan advisor warnings — no semantic change.

drop policy if exists "news_insert" on public.news;
create policy "news_insert" on public.news for insert
  with check ((select auth.uid()) is not null);

drop policy if exists "gr_insert" on public.gestor_requests;
create policy "gr_insert" on public.gestor_requests for insert
  with check ((select auth.uid()) is not null);

drop policy if exists "gr_select" on public.gestor_requests;
create policy "gr_select" on public.gestor_requests for select
  using (
    user_id = (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

drop policy if exists "gr_update" on public.gestor_requests;
create policy "gr_update" on public.gestor_requests for update
  using (
    (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );

drop policy if exists "subs_select" on public.user_subscriptions;
create policy "subs_select" on public.user_subscriptions for select
  using (user_id = (select id from public.users where auth_id = (select auth.uid())));

drop policy if exists "pfp_select" on public.pf_pending_payments;
create policy "pfp_select" on public.pf_pending_payments for select
  using (user_id = (select id from public.users where auth_id = (select auth.uid())));

drop policy if exists "Users read own yappy orders" on public.yappy_orders;
create policy "Users read own yappy orders" on public.yappy_orders for select
  using (
    user_id = (
      select id from public.users
      where auth_id = (select auth.uid())
      limit 1
    )
  );
