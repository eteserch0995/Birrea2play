-- Referidos del Mundial 2026 — Parte 1: schema + fixes de constraints.
-- Modelo (decisiones Sergio 2026-06-08):
--   * Amigo referido: -$2 en la inscripcion (una vez por amigo, primer modo que pague).
--   * Referidor: +$3 de credito wallet cuando el pago del amigo se CONFIRMA (idempotente).
--   * La bolsa crece el monto COMPLETO (wc_pool_stats cuenta count*precio, no paid_amount):
--     el descuento lo absorbe la casa, el pozo no se reduce.
--   * Requisito del referidor: estar inscrito (pagado) en el Mundial.

-- ── 0) FIX bug pre-existente: el CHECK de payment_method no incluia 'card' ──
--    wc_pay_enrollment_card escribe 'card' -> todo pago con tarjeta del Mundial
--    violaba el constraint y hacia rollback en el webhook (0 inscripciones card en prod).
alter table public.wc_enrollments drop constraint if exists wc_enrollments_payment_method_check;
alter table public.wc_enrollments add constraint wc_enrollments_payment_method_check
  check (payment_method = any (array['yappy','wallet','admin_grant','card']));

-- ── 1) wallet_transactions: nuevo tipo 'bono_referido' ──
alter table public.wallet_transactions drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions add constraint wallet_transactions_tipo_check
  check (tipo = any (array['recarga_yappy','recarga_tarjeta','inscripcion','compra_tienda',
                           'mvp_premio','ajuste_admin','reembolso','bono_referido']));

-- ── 2) users.referral_code (codigo corto unico por usuario) ──
alter table public.users add column if not exists referral_code text;

create or replace function public.gen_referral_code()
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_code text; v_try int := 0;
begin
  loop
    v_code := 'B2P-' || upper(substr(md5(gen_random_uuid()::text), 1, 5));
    exit when not exists (select 1 from public.users where referral_code = v_code);
    v_try := v_try + 1;
    if v_try > 30 then
      v_code := 'B2P-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8));
      exit;
    end if;
  end loop;
  return v_code;
end; $$;
revoke execute on function public.gen_referral_code() from public, anon;

-- Backfill seguro (uno por uno garantiza unicidad)
do $$
declare r record;
begin
  for r in select id from public.users where referral_code is null loop
    update public.users set referral_code = public.gen_referral_code() where id = r.id;
  end loop;
end $$;

-- Generacion automatica para nuevos usuarios (cubre TODOS los paths de INSERT)
create or replace function public._trfn_users_referral_code()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if new.referral_code is null then
    new.referral_code := public.gen_referral_code();
  end if;
  return new;
end; $$;

drop trigger if exists trg_users_referral_code on public.users;
create trigger trg_users_referral_code
  before insert on public.users
  for each row execute function public._trfn_users_referral_code();

-- Unicidad (despues del backfill)
create unique index if not exists users_referral_code_key on public.users (referral_code);

-- ── 3) wc_enrollments: referido + descuento ──
alter table public.wc_enrollments
  add column if not exists referred_by uuid references public.users(id) on delete set null,
  add column if not exists referral_discount numeric(10,2) not null default 0;

-- ── 4) Tabla de canjes (idempotencia: 1 bono por par referidor<->referido) ──
create table if not exists public.wc_referral_credits (
  id            bigint generated always as identity primary key,
  referrer_id   uuid not null references public.users(id) on delete cascade,
  referred_id   uuid not null references public.users(id) on delete cascade,
  enrollment_id uuid references public.wc_enrollments(id) on delete set null,
  amount        numeric(10,2) not null default 3,
  created_at    timestamptz not null default now(),
  unique (referrer_id, referred_id)
);
alter table public.wc_referral_credits enable row level security;
drop policy if exists wc_referral_credits_select on public.wc_referral_credits;
create policy wc_referral_credits_select on public.wc_referral_credits
  for select to authenticated
  using (
    referrer_id in (select id from public.users where auth_id = auth.uid())
    or (select role from public.users where auth_id = auth.uid()) = 'admin'
  );
-- Writes solo server-side (service_role / trigger SECURITY DEFINER). Sin policy de insert para authenticated.

-- ── 5) wc_pools.flyer_until (ventana del flyer, control admin sin deploy) ──
alter table public.wc_pools add column if not exists flyer_until timestamptz;
update public.wc_pools
  set flyer_until = '2026-06-11T16:00:00+00:00'
  where season = 'fifa_wc_2026' and flyer_until is null;
