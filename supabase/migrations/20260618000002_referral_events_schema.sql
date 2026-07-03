-- ============================================================
-- 2026-06-18 — Sistema de Referidos para Eventos de Birrea
-- ============================================================
-- Programa "Invita y Gana": cada usuario tiene un código personal.
-- Cuando su invitado completa su primer evento pago, ambos reciben
-- $1 en créditos de wallet.
--
-- Reglas anti-fraude (ver propuesta 2026-06-18):
--   · Solo cuentas nuevas (<30 días) pueden ingresar un código
--   · Solo antes de la primera inscripción confirmada del invitado
--   · El crédito se libera cuando el evento pasa a status='finished'
--   · Solo eventos pagados cuentan (metodo_pago != 'gratis')
--   · Un par (referidor, referido) genera crédito máximo 1 vez
--   · El referido recibe $1 solo la primera vez que completa un evento
--   · El referidor tiene cap de 5 créditos por mes
--   · Anti-cruce: si A ya invitó a B, B no puede invitar a A
--   · No se puede usar el propio código
--   · referred_by solo puede escribirse vía RPC (REVOKE en col)
-- ============================================================

-- ── 0) Asegurar que 'bono_referido' está en el check de wallet_transactions ──
alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_tipo_check
  check (tipo = any (array[
    'recarga_yappy','recarga_tarjeta','inscripcion','compra_tienda',
    'mvp_premio','ajuste_admin','plan_mensual','reembolso',
    'bono_referido','premio_polla'
  ]));

-- ── 1) Columnas en users ──────────────────────────────────────────────────────
alter table public.users
  add column if not exists referred_by      uuid references public.users(id) on delete set null,
  add column if not exists referred_by_at   timestamptz,
  add column if not exists referred_by_code text;   -- auditoría del código ingresado

-- Bloquear escritura directa de estas columnas desde el cliente
revoke update (referred_by, referred_by_at, referred_by_code)
  on public.users from anon, authenticated;

-- Reforzar también en la policy RLS de users_update
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update
  using  ((select auth.uid()) = auth_id)
  with check (
    (select auth.uid()) = auth_id
    and role               = (select role               from public.users where auth_id = (select auth.uid()))
    and auth_id            = (select auth_id            from public.users where auth_id = (select auth.uid()))
    and efectivo_bloqueado = (select efectivo_bloqueado from public.users where auth_id = (select auth.uid()))
    and referred_by        = (select referred_by        from public.users where auth_id = (select auth.uid()))
  );

-- ── 2) Tabla referral_credits (eventos de birrea, separada de wc_referral_credits) ──
create table if not exists public.referral_credits (
  id                    uuid primary key default uuid_generate_v4(),
  referrer_id           uuid not null references public.users(id) on delete cascade,
  referred_id           uuid not null references public.users(id) on delete cascade,
  event_registration_id uuid references public.event_registrations(id) on delete set null,
  event_id              uuid references public.events(id) on delete set null,
  amount                numeric(10,2) not null default 1.00,
  referred_wallet_credited boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (referrer_id, referred_id)   -- 1 bono por par, ever
);

create index if not exists idx_referral_credits_referrer
  on public.referral_credits(referrer_id);
create index if not exists idx_referral_credits_referred
  on public.referral_credits(referred_id);
create index if not exists idx_referral_credits_month
  on public.referral_credits(referrer_id, created_at);

-- ── 3) RLS de referral_credits ───────────────────────────────────────────────
alter table public.referral_credits enable row level security;

drop policy if exists referral_credits_select on public.referral_credits;
create policy referral_credits_select on public.referral_credits
  for select to authenticated
  using (
    referrer_id in (select id from public.users where auth_id = (select auth.uid()))
    or referred_id in (select id from public.users where auth_id = (select auth.uid()))
    or (select role from public.users where auth_id = (select auth.uid())) = 'admin'
  );
-- INSERT/UPDATE/DELETE: solo server-side (SECURITY DEFINER / service_role)

-- ── 4) apply_referral_code — el invitado ingresa el código ──────────────────
create or replace function public.apply_referral_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid          uuid := (select auth.uid());
  v_me           uuid;
  v_me_created   timestamptz;
  v_referrer_id  uuid;
  v_referrer_nom text;
  v_code         text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if v_code = '' then raise exception 'Ingresá un código'; end if;

  select id, created_at into v_me, v_me_created
    from public.users where auth_id = v_uid;
  if v_me is null then raise exception 'Usuario no encontrado'; end if;

  -- Ya tiene referidor asignado
  if exists (select 1 from public.users where id = v_me and referred_by is not null) then
    raise exception 'Ya tenés un código de invitación aplicado';
  end if;

  -- Cuenta demasiado vieja (solo primeros 30 días)
  if v_me_created < now() - interval '30 days' then
    raise exception 'El código solo puede ingresarse en los primeros 30 días de cuenta nueva';
  end if;

  -- Ya participó en algún evento confirmado (ya no aplica)
  if exists (
    select 1 from public.event_registrations
    where user_id = v_me and status = 'confirmed'
  ) then
    raise exception 'Ya participaste en un evento, el código ya no aplica';
  end if;

  -- Buscar referidor por código
  select id, nombre into v_referrer_id, v_referrer_nom
    from public.users where referral_code = v_code;
  if v_referrer_id is null then raise exception 'Código inválido'; end if;
  if v_referrer_id = v_me then raise exception 'No podés usar tu propio código'; end if;

  -- Anti-cruce: si A ya refirió a B antes, B no puede referir a A
  if exists (
    select 1 from public.referral_credits
    where referrer_id = v_me and referred_id = v_referrer_id
  ) then
    raise exception 'No podés usar el código de alguien que vos ya referiste';
  end if;

  -- Aplicar código (solo la RPC puede escribir estas columnas)
  update public.users
    set referred_by      = v_referrer_id,
        referred_by_at   = now(),
        referred_by_code = v_code
    where id = v_me;

  return jsonb_build_object(
    'ok',       true,
    'referrer', split_part(coalesce(v_referrer_nom, ''), ' ', 1)
  );
end; $$;

revoke execute on function public.apply_referral_code(text) from public, anon;
grant  execute on function public.apply_referral_code(text) to authenticated, service_role;

-- ── 5) get_referral_status — estado para la tarjeta "Invita y Gana" ─────────
create or replace function public.get_referral_status()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_uid              uuid := (select auth.uid());
  v_me               uuid;
  v_code             text;
  v_my_referrer_nom  text;
  v_total_count      int;
  v_total_earned     numeric;
  v_monthly_count    int;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select u.id, u.referral_code into v_me, v_code
    from public.users u where u.auth_id = v_uid;

  -- Nombre de quien me invitó (primer nombre)
  select split_part(u2.nombre, ' ', 1) into v_my_referrer_nom
    from public.users u
    join public.users u2 on u2.id = u.referred_by
    where u.id = v_me;

  select count(*), coalesce(sum(amount), 0)
    into v_total_count, v_total_earned
    from public.referral_credits where referrer_id = v_me;

  select count(*) into v_monthly_count
    from public.referral_credits
    where referrer_id = v_me
      and created_at >= date_trunc('month', now());

  return jsonb_build_object(
    'code',                 v_code,
    'invited_by',           v_my_referrer_nom,          -- quien te invitó a vos
    'referrals_total',      v_total_count,
    'referrals_this_month', v_monthly_count,
    'earned_total',         v_total_earned,
    'monthly_cap',          5,
    'cap_remaining',        greatest(5 - v_monthly_count, 0)
  );
end; $$;

revoke execute on function public.get_referral_status() from public, anon;
grant  execute on function public.get_referral_status() to authenticated, service_role;

-- ── 6) Trigger: cuando un evento termina → pagar créditos de referido ────────
create or replace function public._trfn_referral_credits_on_event_finish()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_reg             record;
  v_referrer_id     uuid;
  v_referrer_wallet uuid;
  v_referred_wallet uuid;
  v_monthly_count   int;
  v_rows            int;
  v_referred_nom    text;
begin
  -- Solo en la transición NOT finished → finished
  if not (coalesce(old.status, '') <> 'finished' and new.status = 'finished') then
    return new;
  end if;

  -- Para cada inscripción confirmada y pagada en este evento
  for v_reg in
    select er.user_id, er.id as reg_id
    from public.event_registrations er
    where er.event_id = new.id
      and er.status   = 'confirmed'
      and er.metodo_pago <> 'gratis'
  loop
    -- ¿Este usuario fue invitado por alguien?
    select u.referred_by into v_referrer_id
      from public.users u where u.id = v_reg.user_id;
    continue when v_referrer_id is null;

    -- Cap mensual del referidor (max 5 / mes) — chequear ANTES de insertar
    select count(*) into v_monthly_count
      from public.referral_credits
      where referrer_id = v_referrer_id
        and created_at >= date_trunc('month', now());
    continue when v_monthly_count >= 5;

    -- Insertar registro (idempotente: ON CONFLICT DO NOTHING por UNIQUE)
    insert into public.referral_credits
      (referrer_id, referred_id, event_registration_id, event_id, amount)
    values
      (v_referrer_id, v_reg.user_id, v_reg.reg_id, new.id, 1.00)
    on conflict (referrer_id, referred_id) do nothing;
    get diagnostics v_rows = row_count;
    continue when v_rows = 0;   -- ya se había acreditado antes, saltear

    -- ── Acreditar $1 al referidor ──
    select w.id into v_referrer_wallet
      from public.wallets w where w.user_id = v_referrer_id;
    if v_referrer_wallet is not null then
      select nombre into v_referred_nom from public.users where id = v_reg.user_id;
      update public.wallets set balance = balance + 1.00 where id = v_referrer_wallet;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_referrer_wallet, 'bono_referido', 1.00,
                'Bono referido: ' || coalesce(split_part(v_referred_nom, ' ', 1), 'tu amigo/a')
                || ' completó un evento');
    end if;

    -- ── Acreditar $1 al referido (solo la primera vez — este INSERT fue el único
    --    posible para este par, confirmado por GET DIAGNOSTICS v_rows = 1) ──
    update public.referral_credits
      set referred_wallet_credited = true
      where referrer_id = v_referrer_id and referred_id = v_reg.user_id;

    select w.id into v_referred_wallet
      from public.wallets w where w.user_id = v_reg.user_id;
    if v_referred_wallet is not null then
      update public.wallets set balance = balance + 1.00 where id = v_referred_wallet;
      insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_referred_wallet, 'bono_referido', 1.00,
                '¡Bienvenido/a! Completaste tu primer evento con código de invitación 🎉');
    end if;

  end loop;

  return new;
end; $$;

-- Solo el trigger puede llamar esta función
revoke execute on function public._trfn_referral_credits_on_event_finish()
  from public, anon, authenticated;

drop trigger if exists trg_referral_credits_on_event_finish on public.events;
create trigger trg_referral_credits_on_event_finish
  after update on public.events
  for each row execute function public._trfn_referral_credits_on_event_finish();
