-- Polla Gratis: en EMPATE exacto (mismos puntos y misma cercanía al marcador) se
-- REPARTE el premio en partes iguales (decisión Sergio 2026-06-08). El grupo de
-- empatados ocupa posiciones consecutivas; se suma el premio de esas posiciones
-- (1°=20, 2°=10, 3°=5, resto 0) y se divide por la cantidad de empatados. El total
-- repartido sigue siendo como máximo 35 créditos.
create or replace function public.wc_free_polla_finalize(
  p_actual_champion_team_id uuid, p_actual_runner_up_team_id uuid, p_actual_third_place_team_id uuid,
  p_actual_top_scorer_name text, p_actual_mvp_name text,
  p_actual_final_score_home integer, p_actual_final_score_away integer
) returns table(out_rank integer, out_user_id uuid, out_nombre text, out_points numeric, out_prize numeric)
language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_role text;
  v_pool public.wc_pools%rowtype;
  f record;
  grp record;
  v_pts numeric;
  v_pos integer := 0;
  v_start integer;
  v_combined numeric;
  v_per numeric;
  v_remainder numeric;
  v_idx integer;
  v_prize numeric;
  v_wallet uuid;
begin
  if auth.role() <> 'service_role' then
    select role into v_role from public.users where auth_id = (select auth.uid());
    if v_role <> 'admin' then raise exception 'unauthorized: only admin'; end if;
  end if;

  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026' for update;
  if v_pool.free_polla_finalized then raise exception 'La Polla Gratis ya fue finalizada'; end if;

  -- 1) puntuar cada entrada (misma escala que la polla paga)
  for f in select * from public.wc_free_polla loop
    v_pts := 0;
    if f.champion_team_id    = p_actual_champion_team_id    then v_pts := v_pts + 50; end if;
    if f.runner_up_team_id   = p_actual_runner_up_team_id   then v_pts := v_pts + 30; end if;
    if f.third_place_team_id = p_actual_third_place_team_id then v_pts := v_pts + 20; end if;
    if lower(btrim(f.top_scorer_name)) = lower(btrim(p_actual_top_scorer_name)) then v_pts := v_pts + 25; end if;
    if lower(btrim(f.mvp_name))        = lower(btrim(p_actual_mvp_name))        then v_pts := v_pts + 15; end if;
    update public.wc_free_polla set bonus_points = v_pts where id = f.id;
  end loop;

  -- 2) agrupar por (puntos, cercanía al marcador) y repartir el premio del grupo
  for grp in
    select fp.bonus_points as pts,
           (abs(fp.final_score_home - p_actual_final_score_home)
          + abs(fp.final_score_away - p_actual_final_score_away)) as diff,
           count(*) as sz
    from public.wc_free_polla fp
    group by 1, 2
    order by pts desc, diff asc
  loop
    v_start := v_pos + 1;
    -- premio combinado de las posiciones que ocupa el grupo
    select coalesce(sum(case p when 1 then 20 when 2 then 10 when 3 then 5 else 0 end), 0)
      into v_combined
      from generate_series(v_start, v_start + grp.sz - 1) as p;
    v_per := floor(v_combined / grp.sz * 100) / 100;          -- por persona (2 decimales)
    v_remainder := round(v_combined - v_per * grp.sz, 2);     -- centavos sobrantes -> al 1ro

    v_idx := 0;
    for f in
      select * from public.wc_free_polla fp
      where fp.bonus_points = grp.pts
        and (abs(fp.final_score_home - p_actual_final_score_home)
           + abs(fp.final_score_away - p_actual_final_score_away)) = grp.diff
      order by fp.created_at asc
    loop
      v_idx := v_idx + 1;
      v_prize := v_per + (case when v_idx = 1 then v_remainder else 0 end);
      update public.wc_free_polla set rank_position = v_start, prize_credits = v_prize where id = f.id;
      if v_prize > 0 and not f.awarded then
        select w.id into v_wallet from public.wallets w where w.user_id = f.user_id;
        if v_wallet is not null then
          update public.wallets set balance = balance + v_prize where id = v_wallet;
          insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
          values (v_wallet, 'premio_polla', v_prize,
                  format('Premio Polla Gratis Mundial 2026 - %s° lugar%s', v_start,
                         case when grp.sz > 1 then ' (empate, repartido)' else '' end));
          update public.wc_free_polla set awarded = true where id = f.id;
        end if;
      end if;
    end loop;
    v_pos := v_pos + grp.sz;
  end loop;

  update public.wc_pools set free_polla_finalized = true, free_polla_open = false where season = 'fifa_wc_2026';

  return query
    select fp.rank_position, fp.user_id, u.nombre::text, fp.bonus_points, fp.prize_credits
    from public.wc_free_polla fp join public.users u on u.id = fp.user_id
    where fp.prize_credits > 0
    order by fp.rank_position asc, u.nombre asc;
end; $function$;
revoke execute on function public.wc_free_polla_finalize(uuid,uuid,uuid,text,text,integer,integer) from public, anon;
grant execute on function public.wc_free_polla_finalize(uuid,uuid,uuid,text,text,integer,integer) to authenticated, service_role;
