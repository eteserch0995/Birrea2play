-- Pendiente cerrado (2026-06-04): cancelar un INVITADO no disparaba la
-- promocion de la lista de espera (el trigger solo existia en
-- event_registrations). Un guest activo ocupa cupo igual que un inscrito,
-- asi que su cancelacion debe liberar el cupo hacia la waitlist.
--
-- Cubre todos los caminos: cancelacion por el invitador (cancelRegistration /
-- cancel_guests_for_registration), por el gestor, y expiracion automatica
-- (expire_pending_guests). Tambien DELETE fisico por si algun flujo borra.
--
-- Auto-protegido: promote_waitlist -> UPDATE waitlist->pending pasa por el
-- trigger de capacidad (_trfn_enforce_event_capacity), asi que si el guest
-- cancelado era un "huerfano" que ya no contaba como cupo ocupado, la
-- promocion simplemente no encuentra espacio y no promueve a nadie.

create or replace function public._trfn_promote_waitlist_on_guest_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if TG_OP = 'DELETE' then
    if old.status in ('confirmed','pending_payment') then
      perform public.promote_waitlist(old.event_id);
    end if;
    return old;
  end if;
  if old.status in ('confirmed','pending_payment') and new.status = 'cancelled' then
    perform public.promote_waitlist(new.event_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists tr_promote_waitlist_on_guest_cancel on public.event_guests;
create trigger tr_promote_waitlist_on_guest_cancel
  after update or delete on public.event_guests
  for each row execute function public._trfn_promote_waitlist_on_guest_cancel();
