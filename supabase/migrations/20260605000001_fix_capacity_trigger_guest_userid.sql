-- FIX: _trfn_enforce_event_capacity tiraba 'record "new" has no field "user_id"'
-- al insertar un INVITADO (event_guests no tiene user_id). El bug: las subqueries
-- de ocupación referenciaban NEW.user_id dentro de un OR de SQL; aunque el OR
-- lógicamente no aplicaba para guests, PL/pgSQL igual debe resolver el campo
-- NEW.user_id del record y falla porque event_guests carece de él.
-- Solución: resolver la auto-exclusión (v_self_user / v_self_guest) con IF de
-- PL/pgSQL ANTES de las queries, accediendo a NEW.user_id SOLO en la rama de
-- event_registrations y a NEW.id/NEW.genero SOLO en la de event_guests.
create or replace function public._trfn_enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_reg      boolean := (TG_TABLE_NAME = 'event_registrations');
  v_self_user   uuid := null;
  v_self_guest  uuid := null;
  v_ev          record;
  v_genero      text;
  v_ocup        integer;
  v_cupo_genero integer;
begin
  if v_is_reg then
    if NEW.status not in ('confirmed','pending') then return NEW; end if;
    if TG_OP = 'UPDATE' and OLD.status in ('confirmed','pending') then return NEW; end if;
    v_self_user := NEW.user_id;
  else
    if NEW.status not in ('confirmed','pending_payment') then return NEW; end if;
    if TG_OP = 'UPDATE' and OLD.status in ('confirmed','pending_payment') then return NEW; end if;
    v_self_guest := NEW.id;
  end if;

  if auth.role() = 'service_role' then return NEW; end if;

  select genero, cupos_ilimitado, cupos_total, cupos_hombres, cupos_mujeres
    into v_ev from public.events where id = NEW.event_id for update;
  if not found then return NEW; end if;
  if v_ev.cupos_ilimitado is true or v_ev.cupos_total is null then return NEW; end if;

  select
    (select count(*) from public.event_registrations r
      where r.event_id = NEW.event_id and r.status in ('confirmed','pending')
        and (v_self_user is null or r.user_id <> v_self_user))
    +
    (select count(*) from public.event_guests g
      where g.event_id = NEW.event_id and g.status in ('confirmed','pending_payment')
        and (v_self_guest is null or g.id <> v_self_guest)
        and (g.invited_by is null or exists (
          select 1 from public.event_registrations r2
          where r2.event_id = NEW.event_id and r2.user_id = g.invited_by
            and r2.status in ('confirmed','pending'))))
  into v_ocup;

  if v_ocup >= v_ev.cupos_total then
    raise exception 'Evento lleno (% de % cupos). No se realizo ningun cobro.', v_ocup, v_ev.cupos_total;
  end if;

  if v_ev.genero = 'Mixto' and v_ev.cupos_hombres is not null and v_ev.cupos_mujeres is not null then
    if v_is_reg then
      select genero into v_genero from public.users where id = NEW.user_id;
    else
      v_genero := NEW.genero;
    end if;
    if v_genero in ('Masculino','Femenino') then
      v_cupo_genero := case v_genero when 'Masculino' then v_ev.cupos_hombres else v_ev.cupos_mujeres end;
      select
        (select count(*) from public.event_registrations r
          join public.users u on u.id = r.user_id
          where r.event_id = NEW.event_id and r.status in ('confirmed','pending') and u.genero = v_genero
            and (v_self_user is null or r.user_id <> v_self_user))
        +
        (select count(*) from public.event_guests g
          where g.event_id = NEW.event_id and g.status in ('confirmed','pending_payment') and g.genero = v_genero
            and (v_self_guest is null or g.id <> v_self_guest)
            and (g.invited_by is null or exists (
              select 1 from public.event_registrations r2
              where r2.event_id = NEW.event_id and r2.user_id = g.invited_by
                and r2.status in ('confirmed','pending'))))
      into v_ocup;
      if v_ocup >= v_cupo_genero then
        raise exception 'No hay mas cupos de % (%/%). No se realizo ningun cobro.',
          case v_genero when 'Masculino' then 'hombres' else 'mujeres' end, v_ocup, v_cupo_genero;
      end if;
    end if;
  end if;

  return NEW;
end;
$function$;
