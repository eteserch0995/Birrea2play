-- Polla Gratis del Mundial 2026 — tercer modo, sin pago, solo por puntos.
-- Decisiones Sergio 2026-06-08: gratis, 1 por usuario logueado (anti-fraude básico),
-- 50 cupos, solo el "form inicial" (campeón/sub/3°/goleador/MVP/marcador final, SIN
-- partidos ni fases), premio = créditos al wallet (1°=20, 2°=10, 3°=5). Separada de
-- la polla paga (tabla propia, no se mezcla). Cierra antes del arranque del Mundial.

-- 1) tipo de transacción para el premio
alter table public.wallet_transactions drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions add constraint wallet_transactions_tipo_check
  check (tipo = any (array['recarga_yappy','recarga_tarjeta','inscripcion','compra_tienda',
                           'mvp_premio','ajuste_admin','reembolso','bono_referido','premio_polla']));

-- 2) config en wc_pools (admin puede abrir/cerrar y ajustar cupos sin deploy)
alter table public.wc_pools
  add column if not exists free_polla_open      boolean not null default true,
  add column if not exists free_polla_slots     integer not null default 50,
  add column if not exists free_polla_finalized  boolean not null default false;

-- 3) tabla de entradas (1 por usuario)
create table if not exists public.wc_free_polla (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.users(id) on delete cascade,
  champion_team_id    uuid references public.wc_teams(id),
  runner_up_team_id   uuid references public.wc_teams(id),
  third_place_team_id uuid references public.wc_teams(id),
  top_scorer_name     text not null,
  mvp_name            text not null,
  final_score_home    integer not null,
  final_score_away    integer not null,
  bonus_points        numeric not null default 0,
  rank_position       integer,
  prize_credits       numeric not null default 0,
  awarded             boolean not null default false,
  created_at          timestamptz not null default now()
);
alter table public.wc_free_polla enable row level security;
-- el dueño ve su entrada; el admin ve todas. Inserts solo vía RPC (SECURITY DEFINER).
drop policy if exists wc_free_polla_select on public.wc_free_polla;
create policy wc_free_polla_select on public.wc_free_polla
  for select to authenticated
  using (
    user_id in (select id from public.users where auth_id = auth.uid())
    or (select role from public.users where auth_id = auth.uid()) = 'admin'
  );
revoke all on table public.wc_free_polla from anon;

-- 4) RPC: unirse a la Polla Gratis (cap 50 atómico, 1 por user, cierra en deadline)
create or replace function public.wc_free_polla_join(
  p_champion_team_id uuid, p_runner_up_team_id uuid, p_third_place_team_id uuid,
  p_top_scorer_name text, p_mvp_name text,
  p_final_score_home integer, p_final_score_away integer
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_uid   uuid := (select auth.uid());
  v_me    uuid;
  v_pool  public.wc_pools%rowtype;
  v_used  integer;
begin
  if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
  select id into v_me from public.users where auth_id = v_uid;
  if v_me is null then raise exception 'usuario no encontrado'; end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  if not found then raise exception 'Mundial no configurado'; end if;
  if not v_pool.free_polla_open then raise exception 'La Polla Gratis está cerrada'; end if;
  if v_pool.enrollment_deadline <= now() then raise exception 'Cerrada: el Mundial ya arrancó'; end if;

  -- validaciones de picks (mismas reglas que la polla paga)
  if p_champion_team_id is null or p_runner_up_team_id is null or p_third_place_team_id is null then
    raise exception 'Elegí campeón, subcampeón y 3er lugar';
  end if;
  if p_champion_team_id = p_runner_up_team_id
     or p_champion_team_id = p_third_place_team_id
     or p_runner_up_team_id = p_third_place_team_id then
    raise exception 'Campeón, subcampeón y 3er lugar deben ser equipos distintos';
  end if;
  if coalesce(btrim(p_top_scorer_name),'') = '' or coalesce(btrim(p_mvp_name),'') = '' then
    raise exception 'Escribí el goleador y el MVP';
  end if;
  if p_final_score_home is null or p_final_score_away is null
     or p_final_score_home < 0 or p_final_score_away < 0
     or p_final_score_home > 20 or p_final_score_away > 20 then
    raise exception 'Marcador de la final inválido (0-20)';
  end if;

  if exists (select 1 from public.wc_free_polla where user_id = v_me) then
    raise exception 'Ya estás participando en la Polla Gratis';
  end if;

  -- serializa la admisión para respetar el cupo exacto
  perform pg_advisory_xact_lock(hashtext('wc_free_polla'));
  select count(*) into v_used from public.wc_free_polla;
  if v_used >= v_pool.free_polla_slots then
    raise exception 'Cupos agotados (%/%).', v_used, v_pool.free_polla_slots;
  end if;

  insert into public.wc_free_polla
    (user_id, champion_team_id, runner_up_team_id, third_place_team_id,
     top_scorer_name, mvp_name, final_score_home, final_score_away)
  values
    (v_me, p_champion_team_id, p_runner_up_team_id, p_third_place_team_id,
     btrim(p_top_scorer_name), btrim(p_mvp_name), p_final_score_home, p_final_score_away);

  return jsonb_build_object('ok', true, 'slot', v_used + 1, 'slots_total', v_pool.free_polla_slots);
end; $function$;
revoke execute on function public.wc_free_polla_join(uuid,uuid,uuid,text,text,integer,integer) from public, anon;
grant execute on function public.wc_free_polla_join(uuid,uuid,uuid,text,text,integer,integer) to authenticated, service_role;

-- 5) RPC: estado para la pantalla (mi entrada + cupos + abierto/cerrado)
create or replace function public.wc_free_polla_status()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_uid  uuid := (select auth.uid());
  v_me   uuid;
  v_pool public.wc_pools%rowtype;
  v_used integer;
  v_mine jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_me from public.users where auth_id = v_uid;
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  select count(*) into v_used from public.wc_free_polla;
  select to_jsonb(f) into v_mine from public.wc_free_polla f where f.user_id = v_me;
  return jsonb_build_object(
    'entered', v_mine is not null,
    'my_entry', v_mine,
    'slots_used', v_used,
    'slots_total', coalesce(v_pool.free_polla_slots, 50),
    'open', coalesce(v_pool.free_polla_open, false),
    'closed', v_pool.enrollment_deadline <= now(),
    'finalized', coalesce(v_pool.free_polla_finalized, false)
  );
end; $function$;
revoke execute on function public.wc_free_polla_status() from public, anon;
grant execute on function public.wc_free_polla_status() to authenticated, service_role;

-- 6) RPC: leaderboard (nombre + puntos + rank, SIN exponer los picks de otros)
create or replace function public.wc_free_polla_leaderboard()
returns table(nombre text, bonus_points numeric, rank_position integer, is_me boolean)
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_me uuid;
begin
  select id into v_me from public.users where auth_id = (select auth.uid());
  return query
    select u.nombre::text, f.bonus_points, f.rank_position, (f.user_id = v_me) as is_me
    from public.wc_free_polla f
    join public.users u on u.id = f.user_id
    order by coalesce(f.rank_position, 9999) asc, f.bonus_points desc, f.created_at asc;
end; $function$;
revoke execute on function public.wc_free_polla_leaderboard() from public, anon;
grant execute on function public.wc_free_polla_leaderboard() to authenticated, service_role;

-- 7) RPC admin: finalizar — puntúa, ranquea y acredita 20/10/5 al wallet (idempotente)
create or replace function public.wc_free_polla_finalize(
  p_actual_champion_team_id uuid, p_actual_runner_up_team_id uuid, p_actual_third_place_team_id uuid,
  p_actual_top_scorer_name text, p_actual_mvp_name text,
  p_actual_final_score_home integer, p_actual_final_score_away integer
) returns table(out_rank integer, out_user_id uuid, out_nombre text, out_points numeric, out_prize numeric)
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_role  text;
  v_pool  public.wc_pools%rowtype;
  f       record;
  v_pts   numeric;
  v_rank  integer := 0;
  v_prize numeric;
  v_wallet uuid;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from public.users where auth_id = (select auth.uid());
    if v_role <> 'admin' then raise exception 'unauthorized: only admin'; end if;
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026' for update;
  if v_pool.free_polla_finalized then raise exception 'La Polla Gratis ya fue finalizada'; end if;

  -- puntuar cada entrada (misma escala que la polla paga)
  for f in select * from public.wc_free_polla loop
    v_pts := 0;
    if f.champion_team_id    = p_actual_champion_team_id    then v_pts := v_pts + 50; end if;
    if f.runner_up_team_id   = p_actual_runner_up_team_id   then v_pts := v_pts + 30; end if;
    if f.third_place_team_id = p_actual_third_place_team_id then v_pts := v_pts + 20; end if;
    if lower(btrim(f.top_scorer_name)) = lower(btrim(p_actual_top_scorer_name)) then v_pts := v_pts + 25; end if;
    if lower(btrim(f.mvp_name))        = lower(btrim(p_actual_mvp_name))        then v_pts := v_pts + 15; end if;
    update public.wc_free_polla set bonus_points = v_pts where id = f.id;
  end loop;

  -- ranking: puntos desc, cercanía al marcador real asc, primero en anotarse asc
  v_rank := 0;
  for f in
    select fp.*, (abs(fp.final_score_home - p_actual_final_score_home)
                + abs(fp.final_score_away - p_actual_final_score_away)) as score_diff
    from public.wc_free_polla fp
    order by fp.bonus_points desc, (abs(fp.final_score_home - p_actual_final_score_home)
            + abs(fp.final_score_away - p_actual_final_score_away)) asc, fp.created_at asc
  loop
    v_rank := v_rank + 1;
    v_prize := case v_rank when 1 then 20 when 2 then 10 when 3 then 5 else 0 end;
    update public.wc_free_polla
      set rank_position = v_rank, prize_credits = v_prize
      where id = f.id;

    -- acreditar a top 3 (directo: credit_wallet valida caller==dueño, acá el admin
    -- acredita a terceros → UPDATE/INSERT directo en función SECURITY DEFINER)
    if v_prize > 0 and not f.awarded then
      select w.id into v_wallet from public.wallets w where w.user_id = f.user_id;
      if v_wallet is not null then
        update public.wallets set balance = balance + v_prize where id = v_wallet;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_wallet, 'premio_polla', v_prize,
                format('Premio Polla Gratis Mundial 2026 - %s° lugar', v_rank));
        update public.wc_free_polla set awarded = true where id = f.id;
      end if;
    end if;
  end loop;

  update public.wc_pools set free_polla_finalized = true, free_polla_open = false
    where season = 'fifa_wc_2026';

  return query
    select fp.rank_position, fp.user_id, u.nombre::text, fp.bonus_points, fp.prize_credits
    from public.wc_free_polla fp join public.users u on u.id = fp.user_id
    where fp.rank_position <= 3 order by fp.rank_position asc;
end; $function$;
revoke execute on function public.wc_free_polla_finalize(uuid,uuid,uuid,text,text,integer,integer) from public, anon;
grant execute on function public.wc_free_polla_finalize(uuid,uuid,uuid,text,text,integer,integer) to authenticated, service_role;
