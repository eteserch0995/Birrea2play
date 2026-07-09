-- ════════════════════════════════════════════════════════════════════════
-- FIX 2026-07-07 — Recargas con TARJETA (PagueloFácil) que quedan sin acreditar.
--
-- CAUSA RAÍZ: pf-webhook solo se dispara con el REDIRECT del navegador de vuelta
-- a la app (RETURN_URL). Si el usuario paga pero no vuelve (cierra pestaña, se
-- corta la red, la app pasa a background), el pago NUNCA se acredita y la fila
-- pf_pending_payments queda procesado=false para siempre — falla silenciosa.
-- Caso real: Ronaldo Rodríguez pagó $6.00 (orden pf-ceb08da2-1783374255594) y
-- nunca se le aplicó. Hay 19 filas procesado=false ($204.35), mezcla de pagos
-- reales perdidos y de intentos abandonados/retries.
--
-- ESTE PARCHE (paso 1 — herramienta segura de reconciliación manual):
--   acreditar_pf_pendiente(orden_id): acredita a créditos una recarga de tarjeta
--   atascada, IDEMPOTENTE (lock de fila + guard procesado), solo service_role/admin.
--   Deja rastro en wallet_transactions (tipo=recarga_tarjeta) igual que el flujo
--   normal, así aparece en reportes. Convierte una pérdida permanente silenciosa
--   en un fix de 1 paso una vez verificado el cobro en el panel de PagueloFácil.
--
-- Paso 2 (aparte): reconciliador AUTOMÁTICO que consulta la API de PagueloFácil
--   (PF_ACCESS_TOKEN ya existe) vía pg_cron+pg_net / edge, para no depender del
--   redirect. Pendiente de confirmar el endpoint de consulta de PF.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.acreditar_pf_pendiente(p_orden_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_p         record;
  v_wallet_id uuid;
begin
  -- Solo service_role o admin/super_admin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = auth.uid()) not in ('admin','super_admin') then
      raise exception 'solo service_role/admin';
    end if;
  end if;

  select * into v_p from public.pf_pending_payments where orden_id = p_orden_id for update;
  if v_p.orden_id is null then
    raise exception 'orden PF no encontrada: %', p_orden_id;
  end if;

  -- Idempotencia: si ya se procesó, no re-acreditar
  if v_p.procesado then
    return jsonb_build_object('ok', true, 'already', true, 'amount', v_p.amount);
  end if;

  -- Esta reconciliación solo resuelve recargas de wallet con tarjeta. Los demás
  -- tipos (wc_enrollment / abono_cancha / donacion) se resuelven por su propia vía.
  if coalesce(v_p.tipo, 'recarga_tarjeta') <> 'recarga_tarjeta' then
    raise exception 'tipo % no soportado por esta reconciliación (resolver por su flujo)', v_p.tipo;
  end if;

  select id into v_wallet_id from public.wallets where user_id = v_p.user_id;
  if v_wallet_id is null then
    raise exception 'wallet no encontrado para user %', v_p.user_id;
  end if;

  update public.wallets set balance = balance + v_p.amount where id = v_wallet_id;

  insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  values (v_wallet_id, 'recarga_tarjeta', v_p.amount,
          'Recarga Tarjeta $' || to_char(v_p.amount, 'FM990.00')
          || ' — reconciliación manual (PF ref ' || p_orden_id || ')');

  update public.pf_pending_payments
     set procesado = true, oper = coalesce(oper, 'MANUAL-RECONCILE')
   where orden_id = p_orden_id;

  return jsonb_build_object('ok', true, 'credited', v_p.amount, 'user_id', v_p.user_id, 'wallet_id', v_wallet_id);
end;
$function$;

revoke execute on function public.acreditar_pf_pendiente(text) from public, anon, authenticated;
grant  execute on function public.acreditar_pf_pendiente(text) to service_role;
