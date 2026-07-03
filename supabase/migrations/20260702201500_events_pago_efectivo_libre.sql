-- Efectivo "libre" por-evento: salta el requisito de 3 birrias minimas SOLO en
-- eventos marcados (ej. After Birrea 2.0: gente nueva de la cancha que paga ahi
-- mismo). NO salta efectivo_bloqueado (castigo por-usuario sigue mandando).
-- Aplicada a prod via MCP apply_migration el 2026-07-02.
alter table public.events add column if not exists pago_efectivo_libre boolean not null default false;
comment on column public.events.pago_efectivo_libre is 'true = el pago en efectivo no exige el minimo de 3 birrias en este evento (el bloqueo por-usuario efectivo_bloqueado SIGUE aplicando). Agregado 2026-07-02.';

-- Redefinicion del trigger de elegibilidad: identico al anterior + excepcion
-- por-evento (despues del check de bloqueado, antes de forzado/minimo).
CREATE OR REPLACE FUNCTION public.enforce_efectivo_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Excepcion por-evento (2026-07-02): eventos con pago_efectivo_libre no exigen minimo de birrias
  if exists (select 1 from public.events ev where ev.id = NEW.event_id and coalesce(ev.pago_efectivo_libre,false)) then
    return NEW;
  end if;
  if v_forz then return NEW; end if;
  v_count := public.efectivo_birrias(v_target);
  if v_count < 3 then raise exception 'EFECTIVO_REQUISITO: requiere haber participado en al menos 3 birrias (actual: %)', v_count; end if;
  return NEW;
end;$function$;
