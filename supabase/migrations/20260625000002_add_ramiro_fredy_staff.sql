-- Da a Ramiro Chong acceso operativo al módulo de beneficios de
-- Fredy Sport Center: escáner, historial de canjes y galería.
do $$
declare
  v_user_id uuid;
  v_company_id uuid;
begin
  select id
    into v_user_id
  from public.users
  where lower(trim(correo)) = 'prueba300@123.com'
  limit 1;

  if v_user_id is null then
    raise exception 'No se encontró el usuario Ramiro Chong (prueba300@123.com)';
  end if;

  select id
    into v_company_id
  from public.partner_companies
  where lower(trim(nombre)) = 'fredy sport center'
  limit 1;

  if v_company_id is null then
    raise exception 'No se encontró la empresa Fredy Sport Center en partner_companies';
  end if;

  insert into public.partner_company_staff (company_id, user_id, is_primary)
  values (v_company_id, v_user_id, false)
  on conflict (company_id, user_id) do nothing;
end
$$;
