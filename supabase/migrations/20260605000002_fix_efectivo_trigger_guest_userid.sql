-- FIX: enforce_efectivo_eligibility tenía 'case TG_TABLE_NAME when ... else
-- NEW.user_id end' — PL/pgSQL resuelve NEW.user_id del record aunque la rama
-- no aplique, y falla con 'record "new" has no field "user_id"' al traer un
-- INVITADO en efectivo (event_guests no tiene user_id). Solución: IF de
-- PL/pgSQL en vez de CASE de SQL, accediendo a NEW.user_id SOLO para
-- event_registrations y a NEW.invited_by para event_guests.
create or replace function public.enforce_efectivo_eligibility()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_target uuid; v_bloq boolean; v_forz boolean; v_count int; v_status text;
begin
  if coalesce(NEW.metodo_pago,'') <> 'efectivo' then return NEW; end if;
  if auth.role() = 'service_role' then return NEW; end if;
  v_status := coalesce(NEW.status, '');
  if v_status not in ('pending','confirmed','pending_payment') then return NEW; end if; -- no bloquear cancelaciones
  if TG_TABLE_NAME = 'event_guests' then
    v_target := NEW.invited_by;
  else
    v_target := NEW.user_id;
  end if;
  if v_target is null then return NEW; end if;
  select coalesce(efectivo_bloqueado,false), coalesce(efectivo_forzado,false) into v_bloq, v_forz from public.users where id = v_target;
  if v_bloq then raise exception 'EFECTIVO_BLOQUEADO: pago en efectivo no disponible para este usuario'; end if;
  if v_forz then return NEW; end if;
  v_count := public.efectivo_birrias(v_target);
  if v_count < 3 then raise exception 'EFECTIVO_REQUISITO: requiere haber participado en al menos 3 birrias (actual: %)', v_count; end if;
  return NEW;
end;$function$;
