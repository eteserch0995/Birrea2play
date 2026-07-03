-- Fix: uuid_generate_v4() requiere la extensión uuid-ossp (no habilitada).
-- Cambia los DEFAULT de las 5 tablas del club + parchea el RPC.
-- gen_random_uuid() es built-in en PG 13+ sin extensión.

alter table public.partner_companies       alter column id set default gen_random_uuid();
alter table public.partner_company_staff   alter column id set default gen_random_uuid();
alter table public.partner_benefits        alter column id set default gen_random_uuid();
alter table public.partner_products        alter column id set default gen_random_uuid();
alter table public.benefit_redemptions     alter column id set default gen_random_uuid();

-- Reparchear la función (también usaba uuid_generate_v4 internamente)
create or replace function public.generate_benefit_coupon(p_benefit_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := (select auth.uid());
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
    return jsonb_build_object('code', v_pending.code, 'status', 'pending', 'reused', true,
      'benefit', v_b.titulo, 'company', v_b.company_nombre, 'channel', v_b.channel);
  end if;

  if v_b.max_uses_per_user is not null then
    select count(*) into v_used from public.benefit_redemptions
      where benefit_id = p_benefit_id and user_id = v_user and status = 'redeemed';
    if v_used >= v_b.max_uses_per_user then
      raise exception 'ya alcanzaste el maximo de usos de este beneficio';
    end if;
  end if;

  v_code := 'B2P-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  insert into public.benefit_redemptions(benefit_id, user_id, code) values (p_benefit_id, v_user, v_code);
  return jsonb_build_object('code', v_code, 'status', 'pending', 'reused', false,
    'benefit', v_b.titulo, 'company', v_b.company_nombre, 'channel', v_b.channel);
end;$$;
