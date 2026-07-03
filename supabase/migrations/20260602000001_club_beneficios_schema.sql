-- ============================================================
-- 2026-06-02 — Club Birreoso (Club de Beneficios) — esquema base
-- Aditivo: tablas nuevas + RLS + 2 RPCs. No toca nada existente.
-- Plan: vault proyectos/club-beneficios-plan.md
-- ============================================================

-- 1) Empresas aliadas (las crea el admin)
create table public.partner_companies (
  id uuid primary key default uuid_generate_v4(),
  nombre text not null,
  categoria text not null,
  logo_url text, descripcion text,
  direccion text, distrito text,
  telefono text, whatsapp text, instagram text, website text,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Staff del comercio (varias cuentas operan el escaner) — admin
create table public.partner_company_staff (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.partner_companies(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index idx_pcs_user on public.partner_company_staff(user_id);

-- 3) Beneficios (configurable) — admin
create table public.partner_benefits (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.partner_companies(id) on delete cascade,
  titulo text not null, descripcion text, terminos text, imagen_url text,
  tipo text not null default 'porcentaje' check (tipo in ('porcentaje','monto','2x1','regalo','otro')),
  valor_num numeric,
  channel text not null default 'presencial' check (channel in ('presencial','online','ambos')),
  valido_desde timestamptz, valido_hasta timestamptz,
  max_uses_per_user int default 1,
  codigo_online text,
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pb_company on public.partner_benefits(company_id);

-- 4) Galeria de productos (staff del comercio o admin)
create table public.partner_products (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.partner_companies(id) on delete cascade,
  nombre text not null, descripcion text, precio numeric, imagen_url text,
  orden int not null default 0, activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_pp_company on public.partner_products(company_id);

-- 5) Cupones / canjes (cada uso es una fila; el QR lleva 'code')
create table public.benefit_redemptions (
  id uuid primary key default uuid_generate_v4(),
  benefit_id uuid not null references public.partner_benefits(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  code text not null unique,
  status text not null default 'pending' check (status in ('pending','redeemed','void')),
  channel_used text, method text,
  generated_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by_user_id uuid references public.users(id) on delete set null
);
create index idx_br_user on public.benefit_redemptions(user_id);
create index idx_br_benefit on public.benefit_redemptions(benefit_id);

-- ============================================================
-- Helper: es el caller staff de la empresa?
-- ============================================================
create or replace function public.is_company_staff(p_company_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.partner_company_staff s
    join public.users u on u.id = s.user_id
    where s.company_id = p_company_id and u.auth_id = (select auth.uid())
  );
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.partner_companies     enable row level security;
alter table public.partner_company_staff enable row level security;
alter table public.partner_benefits      enable row level security;
alter table public.partner_products      enable row level security;
alter table public.benefit_redemptions   enable row level security;

-- companies: lectura publica de activas; escritura admin
create policy "pc_select" on public.partner_companies for select to anon, authenticated using (activo = true);
create policy "pc_admin_all" on public.partner_companies for all to authenticated
  using ((select role from public.users where auth_id=(select auth.uid()))='admin')
  with check ((select role from public.users where auth_id=(select auth.uid()))='admin');

-- staff: el propio user ve su pertenencia; admin gestiona
create policy "pcs_select_own" on public.partner_company_staff for select to authenticated
  using (user_id = (select id from public.users where auth_id=(select auth.uid())));
create policy "pcs_admin_all" on public.partner_company_staff for all to authenticated
  using ((select role from public.users where auth_id=(select auth.uid()))='admin')
  with check ((select role from public.users where auth_id=(select auth.uid()))='admin');

-- benefits: lectura publica de activos; escritura admin
create policy "pb_select" on public.partner_benefits for select to anon, authenticated using (activo = true);
create policy "pb_admin_all" on public.partner_benefits for all to authenticated
  using ((select role from public.users where auth_id=(select auth.uid()))='admin')
  with check ((select role from public.users where auth_id=(select auth.uid()))='admin');

-- products: lectura publica de activos; escritura admin o staff de la empresa
create policy "pp_select" on public.partner_products for select to anon, authenticated using (activo = true);
create policy "pp_admin_all" on public.partner_products for all to authenticated
  using ((select role from public.users where auth_id=(select auth.uid()))='admin')
  with check ((select role from public.users where auth_id=(select auth.uid()))='admin');
create policy "pp_staff_all" on public.partner_products for all to authenticated
  using (public.is_company_staff(company_id))
  with check (public.is_company_staff(company_id));

-- redemptions: socio ve los suyos; staff ve los de su empresa; admin todo. (insert/validate via RPC)
create policy "br_select_own" on public.benefit_redemptions for select to authenticated
  using (user_id = (select id from public.users where auth_id=(select auth.uid())));
create policy "br_select_staff" on public.benefit_redemptions for select to authenticated
  using (exists (select 1 from public.partner_benefits b where b.id = benefit_id and public.is_company_staff(b.company_id)));
create policy "br_admin_all" on public.benefit_redemptions for all to authenticated
  using ((select role from public.users where auth_id=(select auth.uid()))='admin')
  with check ((select role from public.users where auth_id=(select auth.uid()))='admin');

-- ============================================================
-- RPC: generar cupon (socio)
-- ============================================================
create or replace function public.generate_benefit_coupon(p_benefit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_user uuid; v_b record; v_used int; v_pending record; v_code text;
begin
  if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
  select id into v_user from public.users where auth_id = v_uid;
  if v_user is null then raise exception 'unauthorized: sin perfil'; end if;

  select bf.*, c.nombre as company_nombre, c.activo as company_activo
    into v_b
  from public.partner_benefits bf join public.partner_companies c on c.id = bf.company_id
  where bf.id = p_benefit_id;
  if not found then raise exception 'beneficio no existe'; end if;
  if not v_b.activo or not v_b.company_activo then raise exception 'beneficio no disponible'; end if;
  if v_b.valido_desde is not null and v_b.valido_desde > now() then raise exception 'beneficio aun no vigente'; end if;
  if v_b.valido_hasta is not null and v_b.valido_hasta < now() then raise exception 'beneficio vencido'; end if;

  select * into v_pending from public.benefit_redemptions
    where benefit_id = p_benefit_id and user_id = v_user and status = 'pending'
    order by generated_at desc limit 1;
  if found then
    return jsonb_build_object('code', v_pending.code, 'status','pending', 'reused', true,
      'benefit', v_b.titulo, 'company', v_b.company_nombre, 'channel', v_b.channel);
  end if;

  if v_b.max_uses_per_user is not null then
    select count(*) into v_used from public.benefit_redemptions
      where benefit_id = p_benefit_id and user_id = v_user and status = 'redeemed';
    if v_used >= v_b.max_uses_per_user then
      raise exception 'ya alcanzaste el maximo de usos de este beneficio';
    end if;
  end if;

  v_code := 'B2P-' || upper(substr(md5(uuid_generate_v4()::text), 1, 6));
  insert into public.benefit_redemptions(benefit_id, user_id, code) values (p_benefit_id, v_user, v_code);
  return jsonb_build_object('code', v_code, 'status','pending', 'reused', false,
    'benefit', v_b.titulo, 'company', v_b.company_nombre, 'channel', v_b.channel);
end;$$;

-- ============================================================
-- RPC: validar/canjear cupon (staff del comercio o admin)
-- ============================================================
create or replace function public.validate_coupon(p_code text, p_channel text default 'presencial', p_method text default 'scan')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller uuid; v_is_admin boolean; v_r record; v_b record; v_socio record;
begin
  if v_uid is null then raise exception 'unauthorized: anonymous'; end if;
  select id, (role='admin') into v_caller, v_is_admin from public.users where auth_id = v_uid;
  if v_caller is null then raise exception 'unauthorized: sin perfil'; end if;

  select * into v_r from public.benefit_redemptions where code = p_code for update;
  if not found then raise exception 'cupon no encontrado'; end if;

  select bf.id as benefit_id, bf.titulo, bf.company_id
    into v_b
  from public.partner_benefits bf where bf.id = v_r.benefit_id;

  if not v_is_admin and not public.is_company_staff(v_b.company_id) then
    raise exception 'unauthorized: no sos staff de este comercio';
  end if;

  if v_r.status = 'redeemed' then
    raise exception 'cupon ya canjeado el %', to_char(v_r.redeemed_at, 'YYYY-MM-DD HH24:MI');
  end if;
  if v_r.status = 'void' then raise exception 'cupon anulado'; end if;

  update public.benefit_redemptions
    set status='redeemed', redeemed_at=now(), redeemed_by_user_id=v_caller,
        channel_used=p_channel, method=p_method
    where id = v_r.id;

  select nombre, foto_url into v_socio from public.users where id = v_r.user_id;
  return jsonb_build_object('ok', true, 'code', v_r.code, 'redeemed_at', now(),
    'socio', v_socio.nombre, 'socio_foto', v_socio.foto_url,
    'benefit', v_b.titulo, 'company_id', v_b.company_id);
end;$$;

-- Grants: quitar public/anon, dejar authenticated + service_role
revoke execute on function public.generate_benefit_coupon(uuid) from public, anon;
revoke execute on function public.validate_coupon(text, text, text) from public, anon;
revoke execute on function public.is_company_staff(uuid) from public, anon;
grant execute on function public.generate_benefit_coupon(uuid) to authenticated, service_role;
grant execute on function public.validate_coupon(text, text, text) to authenticated, service_role;
grant execute on function public.is_company_staff(uuid) to authenticated, service_role;

-- updated_at triggers (reusa update_updated_at existente)
create trigger trg_partner_companies_updated before update on public.partner_companies for each row execute function update_updated_at();
create trigger trg_partner_benefits_updated  before update on public.partner_benefits  for each row execute function update_updated_at();
