-- 2026-06-03 — Métrico de birrias endurecido + enforcement server-side del pago en efectivo
-- (Acción 1 + cierre del loophole de la auditoría).

-- Birrias jugadas: confirmadas en eventos finished, EXCLUYENDO efectivo no cobrado.
create or replace function public.efectivo_birrias(p_user_id uuid)
returns int language sql security definer stable set search_path = public as $$
  select count(distinct er.event_id)::int
  from public.event_registrations er
  join public.events e on e.id = er.event_id
  where er.user_id = p_user_id
    and er.status = 'confirmed'
    and e.status = 'finished'
    and (er.metodo_pago <> 'efectivo'
         or exists (select 1 from public.cash_payment_requests cpr
                    where cpr.user_id = er.user_id and cpr.event_id = er.event_id and cpr.cobrado = true));
$$;

create or replace function public.efectivo_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (select auth.uid()); v_user uuid; v_bloq boolean; v_forz boolean; v_count int; v_min int := 3;
begin
  if v_uid is null then return jsonb_build_object('allowed',false,'eventos',0,'min',v_min,'bloqueado',false,'forzado',false); end if;
  select id, coalesce(efectivo_bloqueado,false), coalesce(efectivo_forzado,false) into v_user, v_bloq, v_forz from public.users where auth_id=v_uid;
  if v_user is null then return jsonb_build_object('allowed',false,'eventos',0,'min',v_min,'bloqueado',false,'forzado',false); end if;
  v_count := public.efectivo_birrias(v_user);
  return jsonb_build_object('allowed',(not v_bloq) and (v_forz or v_count>=v_min),'eventos',v_count,'min',v_min,'bloqueado',v_bloq,'forzado',v_forz);
end;$$;

-- Trigger: rechaza inserts/updates de efectivo de usuarios no elegibles (no service_role).
create or replace function public.enforce_efectivo_eligibility()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_target uuid; v_bloq boolean; v_forz boolean; v_count int; v_status text;
begin
  if coalesce(NEW.metodo_pago,'') <> 'efectivo' then return NEW; end if;
  if auth.role() = 'service_role' then return NEW; end if;
  v_status := coalesce(NEW.status, '');
  if v_status not in ('pending','confirmed','pending_payment') then return NEW; end if; -- no bloquear cancelaciones
  v_target := case TG_TABLE_NAME when 'event_guests' then NEW.invited_by else NEW.user_id end;
  if v_target is null then return NEW; end if;
  select coalesce(efectivo_bloqueado,false), coalesce(efectivo_forzado,false) into v_bloq, v_forz from public.users where id = v_target;
  if v_bloq then raise exception 'EFECTIVO_BLOQUEADO: pago en efectivo no disponible para este usuario'; end if;
  if v_forz then return NEW; end if;
  v_count := public.efectivo_birrias(v_target);
  if v_count < 3 then raise exception 'EFECTIVO_REQUISITO: requiere haber participado en al menos 3 birrias (actual: %)', v_count; end if;
  return NEW;
end;$$;

drop trigger if exists trg_efectivo_evreg on public.event_registrations;
create trigger trg_efectivo_evreg before insert or update of metodo_pago, status
  on public.event_registrations for each row execute function public.enforce_efectivo_eligibility();

drop trigger if exists trg_efectivo_guest on public.event_guests;
create trigger trg_efectivo_guest before insert or update of metodo_pago
  on public.event_guests for each row execute function public.enforce_efectivo_eligibility();
