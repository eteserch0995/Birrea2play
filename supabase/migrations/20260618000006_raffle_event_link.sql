-- ============================================================
-- 2026-06-18 — Rifa: vincular elegibilidad a inscripción confirmada
-- ============================================================
-- Solo pueden comprar tickets y ganar quienes estén inscritos
-- y confirmados en el evento al que pertenece la rifa.
-- ============================================================

-- ── 1) raffle_request_tickets: requiere estar inscrito ───────
create or replace function public.raffle_request_tickets(p_event_id uuid, p_quantity int)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid uuid := (select auth.uid());
  v_me  uuid;
  v_rs  text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_quantity < 1 then raise exception 'Mínimo 1 ticket'; end if;

  select id into v_me from public.users where auth_id = v_uid;
  if v_me is null then raise exception 'Usuario no encontrado'; end if;

  -- Verificar que la rifa esté activa
  select status into v_rs from public.raffle_state where event_id = p_event_id;
  if v_rs is null then raise exception 'La rifa no está activa para este evento'; end if;
  if v_rs not in ('open','spinning','winner_pending') then
    raise exception 'La rifa no acepta tickets en este momento';
  end if;

  -- Verificar inscripción confirmada en el evento
  if not exists (
    select 1 from public.event_registrations
    where event_id = p_event_id
      and user_id  = v_me
      and status   = 'confirmed'
  ) then
    raise exception 'Debés estar inscrito y confirmado en el evento para comprar tickets de la rifa';
  end if;

  insert into public.raffle_tickets (event_id, user_id, quantity, amount_paid)
  values (p_event_id, v_me, p_quantity, p_quantity::numeric);

  return jsonb_build_object('ok', true, 'quantity', p_quantity, 'total', p_quantity::numeric);
end; $$;

revoke execute on function public.raffle_request_tickets(uuid,int) from public, anon;
grant  execute on function public.raffle_request_tickets(uuid,int) to authenticated, service_role;

-- ── 2) raffle_spin: solo sortea entre inscritos confirmados ──
create or replace function public.raffle_spin(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_role       text;
  v_state      public.raffle_state;
  v_winner_id  uuid;
  v_winner_nom text;
begin
  select role into v_role from public.users where auth_id = (select auth.uid());
  if v_role <> 'admin' then raise exception 'Solo admin puede girar'; end if;

  select * into v_state from public.raffle_state where event_id = p_event_id for update;
  if v_state.id is null then raise exception 'Rifa no encontrada'; end if;
  if v_state.status not in ('open','spinning','winner_pending') then
    raise exception 'Estado no válido para girar';
  end if;

  -- Selección ponderada: ticket confirmado + inscripción confirmada en el evento
  select rt.user_id into v_winner_id
  from public.raffle_tickets rt
  cross join generate_series(1, rt.quantity) s(n)
  where rt.event_id = p_event_id
    and rt.status   = 'confirmed'
    and rt.user_id != all(v_state.skipped_user_ids)
    and exists (
      select 1 from public.event_registrations er
      where er.event_id = p_event_id
        and er.user_id  = rt.user_id
        and er.status   = 'confirmed'
    )
  order by random()
  limit 1;

  if v_winner_id is null then
    raise exception 'No hay participantes elegibles (inscripción confirmada + ticket confirmado)';
  end if;

  select nombre into v_winner_nom from public.users where id = v_winner_id;

  update public.raffle_state
    set status            = 'spinning',
        current_winner_id = v_winner_id,
        spin_count        = spin_count + 1,
        updated_at        = now()
    where event_id = p_event_id;

  return jsonb_build_object('ok', true, 'winner_id', v_winner_id, 'winner_nom', v_winner_nom);
end; $$;

revoke execute on function public.raffle_spin(uuid) from public, anon;
grant  execute on function public.raffle_spin(uuid) to authenticated, service_role;

-- ── 3) raffle_get_status: agrega campo is_eligible ───────────
create or replace function public.raffle_get_status(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid          uuid := (select auth.uid());
  v_me           uuid;
  v_state        public.raffle_state;
  v_my_confirmed int;
  v_my_pending   int;
  v_total_pool   int;
  v_winner_nom   text;
  v_participants jsonb;
  v_is_eligible  bool;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_me from public.users where auth_id = v_uid;

  select * into v_state from public.raffle_state where event_id = p_event_id;
  if v_state.id is null then return jsonb_build_object('active', false); end if;

  select coalesce(sum(quantity),0) into v_my_confirmed
    from public.raffle_tickets where event_id=p_event_id and user_id=v_me and status='confirmed';
  select coalesce(sum(quantity),0) into v_my_pending
    from public.raffle_tickets where event_id=p_event_id and user_id=v_me and status='pending';
  select coalesce(sum(quantity),0) into v_total_pool
    from public.raffle_tickets
    where event_id=p_event_id and status='confirmed'
      and exists (
        select 1 from public.event_registrations er
        where er.event_id=p_event_id and er.user_id=raffle_tickets.user_id and er.status='confirmed'
      );

  if v_state.current_winner_id is not null then
    select nombre into v_winner_nom from public.users where id = v_state.current_winner_id;
  end if;

  -- ¿El usuario está inscrito y confirmado en el evento?
  select exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and user_id = v_me and status = 'confirmed'
  ) into v_is_eligible;

  -- Lista de participantes elegibles para la animación
  select jsonb_agg(jsonb_build_object('nombre', split_part(u.nombre,' ',1), 'tickets', t.qty))
    into v_participants
    from (
      select rt.user_id, sum(rt.quantity) as qty
      from public.raffle_tickets rt
      where rt.event_id=p_event_id and rt.status='confirmed'
        and exists (
          select 1 from public.event_registrations er
          where er.event_id=p_event_id and er.user_id=rt.user_id and er.status='confirmed'
        )
      group by rt.user_id
    ) t
    join public.users u on u.id = t.user_id;

  return jsonb_build_object(
    'active',            true,
    'status',            v_state.status,
    'prize_name',        v_state.prize_name,
    'yappy_number',      v_state.yappy_number,
    'spin_count',        v_state.spin_count,
    'my_confirmed',      v_my_confirmed,
    'my_pending',        v_my_pending,
    'total_pool',        v_total_pool,
    'current_winner_id', v_state.current_winner_id,
    'winner_nom',        v_winner_nom,
    'is_winner',         (v_state.current_winner_id = v_me
                          and v_state.status in ('spinning','winner_pending','closed')),
    'winner_confirmed',  v_state.status = 'closed',
    'is_eligible',       v_is_eligible,
    'participants',      coalesce(v_participants, '[]'::jsonb)
  );
end; $$;

revoke execute on function public.raffle_get_status(uuid) from public, anon;
grant  execute on function public.raffle_get_status(uuid) to authenticated, service_role;
