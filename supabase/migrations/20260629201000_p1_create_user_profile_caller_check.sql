-- P1: cierra el IDOR de create_user_profile. La RPC (SECDEF, GRANT anon/authenticated) hacia
-- upsert por auth_id SIN validar que el caller fuera dueno de p_auth_id => cualquiera podia
-- sobreescribir el perfil de otro pasando su auth_id (enumerable por el leak de users_select).
-- Seguro: email-confirm es instantaneo (el signup tiene sesion -> auth.uid() = nuevo usuario),
-- y el trigger handle_new_auth_user ya crea el perfil; service_role (edge) sigue libre.
create or replace function public.create_user_profile(
  p_auth_id uuid, p_nombre text, p_correo text,
  p_telefono text default null::text, p_residencia text default null::text,
  p_cedula text default null::text, p_contacto_emergencia text default null::text,
  p_deporte text default 'Fútbol 7'::text, p_nivel text default 'Recreativo'::text,
  p_posicion text default null::text, p_foto_url text default null::text, p_genero text default null::text
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_user_id uuid;
begin
  -- Caller-check: solo service_role o el propio dueno del auth_id.
  if auth.role() <> 'service_role' and (select auth.uid()) is distinct from p_auth_id then
    raise exception 'unauthorized: solo podes crear/editar tu propio perfil';
  end if;

  insert into public.users (
    auth_id, nombre, correo, telefono, residencia, cedula,
    contacto_emergencia, deporte, nivel, posicion, foto_url, genero
  ) values (
    p_auth_id, p_nombre, p_correo, p_telefono, p_residencia, p_cedula,
    p_contacto_emergencia, p_deporte, p_nivel, p_posicion, p_foto_url,
    nullif(p_genero, '')
  )
  on conflict (auth_id) do update set
    nombre              = coalesce(nullif(excluded.nombre,              ''), public.users.nombre),
    correo              = coalesce(nullif(excluded.correo,              ''), public.users.correo),
    telefono            = coalesce(nullif(excluded.telefono,            ''), public.users.telefono),
    residencia          = coalesce(nullif(excluded.residencia,          ''), public.users.residencia),
    cedula              = coalesce(nullif(excluded.cedula,              ''), public.users.cedula),
    contacto_emergencia = coalesce(nullif(excluded.contacto_emergencia, ''), public.users.contacto_emergencia),
    deporte             = coalesce(nullif(excluded.deporte,             ''), public.users.deporte),
    nivel               = coalesce(nullif(excluded.nivel,               ''), public.users.nivel),
    posicion            = coalesce(nullif(excluded.posicion,            ''), public.users.posicion),
    foto_url            = coalesce(nullif(excluded.foto_url,            ''), public.users.foto_url),
    genero              = coalesce(nullif(excluded.genero,              ''), public.users.genero),
    updated_at          = now()
  returning id into v_user_id;
  return v_user_id;
end;
$function$;
