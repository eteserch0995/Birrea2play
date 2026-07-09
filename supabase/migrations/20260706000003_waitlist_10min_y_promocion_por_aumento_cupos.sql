-- ════════════════════════════════════════════════════════════════════════
-- Autopromoción de lista de espera al AUMENTAR cupos + ventana de pago
-- 10 MINUTOS (decisión Sergio 2026-07-06).
--
-- v2 (2026-07-07) — REPARO tras ronda de auditoría adversarial. La v1 tenía
-- huecos reales confirmados por trazado de código (no hipotéticos): oversell
-- cuando el cron cancela a un promovido CON un pago Yappy/mixto realmente en
-- curso y el IPN (service_role) lo revive encima del cupo ya reasignado;
-- sub-promoción cuando el admin sube dos buckets de género (greatest() en vez
-- de sumar deltas); un candidato de género 'Otro'/NULL podía robarle un cupo
-- de género recién abierto a la mujer/hombre que realmente esperaba; el pago
-- MIXTO estaba roto de fondo (yappy_orders_tipo_check no incluía 'mixto' Y
-- completar_mixto_por_orden trataba CUALQUIER fila no-cancelada como "ya
-- hecho", incluido el 'pending'/waitlist_promoted del propio promovido —
-- exactamente el caso que R3 pedía que funcionara); el email de respaldo
-- (send-notification) estaba con el código ya escrito pero nunca invocado;
-- el secreto x-sync-secret estaba hardcodeado; y elegir "Efectivo" era un
-- atajo de un toque para estirar la ventana de 10 min a 4 horas. Cada arreglo
-- puntual se explica en su sección. Todo sigue re-ejecutable de punta a punta.
--
-- GAP QUE CIERRA (R1): hoy promote_waitlist() SOLO se invoca al cancelar
-- (_trfn_promote_waitlist_on_cancel / _on_guest_cancel, 20260604000008).
-- Si el ADMIN aumenta cupos_total, cupos_hombres, cupos_mujeres, o prende
-- cupos_ilimitado en un evento CON lista de espera, hasta hoy NADIE se
-- promovía solo — el cupo nuevo quedaba libre hasta que alguien cancelara
-- o el admin promoviera a mano. Este archivo agrega el trigger que faltaba.
--
-- R2: la ventana del promovido para pagar baja de 4 HORAS a 10 MINUTOS.
-- Se separa en una función y un cron PROPIOS (expire_promoted_waitlist,
-- cada 1 minuto) para no acoplarla a expire_pending_cash_requests, que
-- sigue corriendo cada 30 min y sigue cubriendo SOLO efectivo (por su
-- propio cash_payment_requests.expires_at, default +4h) y yappy_boton
-- huérfano (20 min) — esos dos plazos NO cambian (invariante explícita).
--
-- R3/R4 — reparado donde el trazado de código mostró que NO estaba tan
-- validado como decía la v1 (ver secciones de promote_waitlist,
-- inscribir_yappy_evento, completar_mixto_por_orden y el ALTER de
-- yappy_orders_tipo_check más abajo).
-- ════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- FIX 0 (soporte de R3 — hallazgo nuevo, confirmado por lectura de código):
-- yappy_orders_tipo_check NO incluía 'mixto'. yappy-boton/index.ts (L176)
-- SÍ acepta y manda tipo:'mixto' al crear la orden, así que el INSERT/UPSERT
-- en yappy_orders violaba el CHECK (23514) y la orden NUNCA se creaba — el
-- pago mixto fallaba de entrada, antes de llegar siquiera a
-- completar_mixto_por_orden. Mismo patrón exacto que ya se usó para esta
-- constraint (20260626000001, 20260629193000, 20260704000001): drop + add
-- re-ejecutable. IMPORTANTE (verificado en vivo 2026-07-07 antes de escribir
-- este ALTER, con rollback, contra rumreditrvxkcnlhawut): la constraint HOY
-- ya incluye 'membresia_club' además de los 9 valores rastreables en los
-- migrations (recarga/evento/invitado/compra_tienda/wc_enrollment/donacion/
-- abono_cancha/rifa/saldo_cancha) — alguien agregó 'membresia_club' fuera de
-- este repo (dashboard/hotfix) y un copy-paste de los archivos previos lo
-- habría DROPEADO por error (regresión real: hubiera roto el pago de
-- membresía de socio). Se preservan los 10 valores reales confirmados en
-- vivo y se agrega 'mixto' (11vo).
-- ───────────────────────────────────────────────────────────────────────
alter table public.yappy_orders drop constraint if exists yappy_orders_tipo_check;
alter table public.yappy_orders add constraint yappy_orders_tipo_check
  check (tipo = any (array[
    'recarga','evento','invitado','compra_tienda','wc_enrollment','donacion',
    'abono_cancha','rifa','saldo_cancha','membresia_club','mixto'
  ]::text[]));

-- ───────────────────────────────────────────────────────────────────────
-- FIX 1 (soporte de C1 — cierra el hallazgo "Otro/NULL salta la cuota"):
-- promote_waitlist gana un 2do parámetro OPCIONAL p_gender_filter (default
-- null = comportamiento IDÉNTICO a hoy, ningún caller existente se rompe).
-- Cuando el trigger de C1 sabe que creció ESPECÍFICAMENTE un bucket de
-- género, ahora puede pedir "promové solo candidatos de género X" en vez de
-- barrer la lista entera en orden FIFO género-ciego — así un candidato con
-- genero NULL/'Otro' ya NO puede colarse en un cupo que el admin abrió para
-- un género puntual (antes sí podía: el trigger de capacidad sólo aplica la
-- cuota de género a 'Masculino'/'Femenino' y deja pasar NULL/'Otro' contra el
-- total general).
--
-- IMPORTANTE (evita un bug de ambigüedad de sobrecarga): NO se puede crear
-- promote_waitlist(uuid, text default null) con CREATE OR REPLACE mientras
-- siga viva la firma anterior promote_waitlist(uuid) — Postgres las trataría
-- como dos funciones DISTINTAS (difieren en cantidad de parámetros) y una
-- llamada con 1 solo argumento (como hacen HOY _trfn_promote_waitlist_on_
-- cancel/_on_guest_cancel) pasaría a ser AMBIGUA ("function ... is not
-- unique"), rompiendo la promoción al cancelar. Por eso se DROPea la firma
-- vieja primero — re-ejecutable (DROP IF EXISTS + CREATE OR REPLACE).
--
-- También se saca el secreto x-sync-secret hardcodeado del literal (hallazgo
-- confirmado: rotarlo a futuro rompería el 100% de los avisos en silencio, y
-- versionarlo en texto plano es una fuga). Se prueba PRIMERO current_setting
-- ('app.wc_sync_secret', true) — el MISMO patrón ya usado en
-- 20260530000001 — y sólo si no está configurado se cae al literal actual.
-- Verificado en vivo (2026-07-07, proyecto rumreditrvxkcnlhawut): HOY esa
-- setting NO está configurada (current_setting devuelve NULL) — por eso el
-- literal se deja como fallback real y no se hace un swap ciego: reemplazar
-- el literal por current_setting SIN fallback habría dejado los avisos
-- devolviendo 401 desde el primer despliegue de este archivo. Con el
-- coalesce, hoy no cambia nada; el día que Sergio configure la setting a
-- nivel de BD, se usa sola sin otro deploy.
-- ───────────────────────────────────────────────────────────────────────
drop function if exists public.promote_waitlist(uuid);

create or replace function public.promote_waitlist(p_event_id uuid, p_gender_filter text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_next   record;
  v_precio numeric;
  v_secret text;
begin
  select coalesce(precio, 0)
    into v_precio
    from public.events
   where id = p_event_id
     and status in ('open', 'active');

  if not found then
    return null;  -- evento inexistente o no activo (ej. se está cancelando)
  end if;

  -- Promover al primero, en orden de llegada, que cumpla capacidad total y
  -- cuota de género. El trigger de capacidad valida cada UPDATE; si rechaza
  -- (bucket de género lleno) probamos el siguiente. Si p_gender_filter viene
  -- seteado (llamado desde el trigger de aumento de cupos por bucket), se
  -- restringe a candidatos de ESE género — así un NULL/'Otro' nunca puede
  -- tomar un cupo que el admin abrió específicamente para hombres o mujeres.
  for v_next in
    select r.id, r.user_id
      from public.event_registrations r
     where r.event_id = p_event_id
       and r.status = 'waitlist'
       and (
         p_gender_filter is null
         or exists (
           select 1 from public.users u
            where u.id = r.user_id and u.genero = p_gender_filter
         )
       )
     order by r.created_at asc
     for update of r skip locked
  loop
    begin
      if v_precio <= 0 then
        update public.event_registrations
           set status       = 'confirmed',
               metodo_pago  = 'gratis',
               monto_pagado = 0,
               created_at   = now()
         where id = v_next.id;
      else
        update public.event_registrations
           set status       = 'pending',
               metodo_pago  = 'waitlist_promoted',
               monto_pagado = 0,
               created_at   = now()  -- sella el inicio de su ventana de 10 min
         where id = v_next.id;
      end if;

      -- Aviso server-side al promovido (best-effort, nunca revierte la promoción).
      begin
        v_secret := coalesce(
          current_setting('app.wc_sync_secret', true),
          '9f3c1ade7b62408d5e1142aa0c7be93d6f08a214'
        );
        perform net.http_post(
          url     := 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/waitlist-notify',
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'x-sync-secret', v_secret
                     ),
          body    := jsonb_build_object(
                       'user_id',  v_next.user_id,
                       'event_id', p_event_id,
                       'free',     (v_precio <= 0)
                     )
        );
      exception when others then
        null;  -- pg_net caído / no instalado: la promoción se mantiene igual
      end;

      return v_next.user_id;
    exception when others then
      continue;  -- no cabe (género/total): probar el siguiente
    end;
  end loop;

  return null;
end;
$function$;

-- Sin caller cliente (grep confirmado); cerrar el mismo hueco de higiene que
-- ya tienen las demás funciones que otorgan/mueven cupo real.
revoke execute on function public.promote_waitlist(uuid, text) from public, anon, authenticated;
grant  execute on function public.promote_waitlist(uuid, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────
-- FIX 2 (soporte de R3/C4 — cierra "doble cobro" en la vía Yappy pura):
-- inscribir_yappy_evento: si al llegar ya existe una inscripción 'confirmed'
-- con OTRO metodo_pago (ej. el promovido, apurado por el reloj de 10 min,
-- pagó con créditos mientras ESTE Yappy seguía cobrándose en el banco), el
-- monto de este Yappy YA NO se pierde en silencio (antes: return sin más) —
-- se acredita a sus créditos. Idempotente por order_id (mismo patrón
-- 'descripcion' que ya usa yappy-ipn para no re-acreditar recargas). El resto
-- de la función (guard de service_role/orden executed, chequeo de capacidad +
-- oversell_alerts, upsert final) queda BYTE-IGUAL a la versión vigente
-- (20260629190000).
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.inscribir_yappy_evento(
  p_user_id uuid, p_event_id uuid, p_monto numeric, p_order_id text
) returns void language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_precio numeric; v_ev record; v_ocup integer; v_ya_ocupaba boolean;
  v_existing_metodo text; v_desc text; v_wallet_id uuid;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null then raise exception 'unauthorized: anonymous caller'; end if;
    if not exists (select 1 from public.users where id = p_user_id and auth_id = auth.uid()) then
      raise exception 'unauthorized: caller is not p_user_id'; end if;
    select precio into v_precio from public.events where id = p_event_id;
    if v_precio is null then raise exception 'Evento no existe'; end if;
    if p_monto < v_precio then
      raise exception 'monto insuficiente: % < precio % del evento', p_monto, v_precio; end if;
    if not exists (
      select 1 from public.yappy_orders
      where order_id = p_order_id and user_id = p_user_id
        and event_id = p_event_id and status = 'executed'
    ) then
      raise exception 'unauthorized: no hay orden Yappy pagada (executed) para esta inscripcion';
    end if;
  end if;

  select metodo_pago into v_existing_metodo
    from public.event_registrations
   where event_id = p_event_id and user_id = p_user_id and status = 'confirmed';

  if found then
    if v_existing_metodo = 'yappy_boton' then
      return;  -- idempotencia normal: reintento del IPN o del failsafe cliente
    end if;
    -- Confirmado por OTRO método mientras ESTE Yappy seguía en curso (hallazgo
    -- "doble cobro" confirmado): el dinero de este Yappy no se pierde en
    -- silencio, se acredita a sus créditos. Idempotente por order_id.
    v_desc := 'yappy_extra:' || p_order_id;
    if not exists (select 1 from public.wallet_transactions where descripcion = v_desc) then
      select id into v_wallet_id from public.wallets where user_id = p_user_id;
      if v_wallet_id is not null then
        update public.wallets set balance = balance + p_monto where id = v_wallet_id;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_wallet_id, 'reembolso', p_monto, v_desc);
      end if;
    end if;
    return;
  end if;

  select cupos_ilimitado, cupos_total into v_ev from public.events where id = p_event_id;
  v_ya_ocupaba := exists (
    select 1 from public.event_registrations
    where event_id = p_event_id and user_id = p_user_id and status in ('confirmed','pending')
  );

  if v_ev.cupos_ilimitado is not true and v_ev.cupos_total is not null and not v_ya_ocupaba then
    select
      (select count(*) from public.event_registrations r
         where r.event_id = p_event_id and r.status in ('confirmed','pending'))
      +
      (select count(*) from public.event_guests g
         where g.event_id = p_event_id and g.status in ('confirmed','pending_payment')
           and (g.invited_by is null or exists (
             select 1 from public.event_registrations r2
             where r2.event_id = p_event_id and r2.user_id = g.invited_by
               and r2.status in ('confirmed','pending'))))
    into v_ocup;
    if v_ocup >= v_ev.cupos_total then
      begin
        insert into public.oversell_alerts (event_id, user_id, metodo, monto, detalle)
        values (p_event_id, p_user_id, 'yappy_boton', p_monto,
          format('Pago Yappy confirmado tras liberarse su reserva; evento lleno (%s/%s). Order %s. Honrado: sobrecupo +1.',
                 v_ocup, v_ev.cupos_total, p_order_id));
      exception when others then null;
      end;
    end if;
  end if;

  insert into public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  values (p_event_id, p_user_id, 'yappy_boton', p_monto, 'confirmed')
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'yappy_boton', monto_pagado = p_monto;
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────
-- FIX 3 (soporte de R3 — el más grave de los hallazgos de mixto): el guard
-- de "ya hecho" de completar_mixto_por_orden era
--   "if exists (... status <> 'cancelled') then return already:true"
-- Esto trata CUALQUIER fila no-cancelada como "ya resuelto" — INCLUIDO el
-- caso NORMAL de un promovido de waitlist pagando dentro de su ventana (su
-- fila sigue 'pending'/'waitlist_promoted' durante TODO el pago, confirmado
-- por lectura de EventDetailScreen.confirmarYappyMixto, que nunca la toca).
-- Resultado: completar_mixto_por_orden NUNCA completaba el pago mixto para
-- exactamente el usuario que R3 pide que funcione — el dinero Yappy quedaba
-- cobrado y la inscripción jamás se confirmaba server-side (el cliente sí
-- tiene un respaldo, inscribir_mixto, pero ese es un código no versionado en
-- este repo y corre como authenticated, no como esta vía server-side).
--
-- Ahora el guard sólo trata como "ya hecho" el caso REAL de ya-confirmado:
--   - confirmed + mixto        -> no-op (reintento del IPN sobre la misma orden)
--   - confirmed + OTRO método  -> se acredita el monto Yappy a créditos (idem
--                                 fix de doble-cobro de inscribir_yappy_evento)
--   - cualquier otro estado (pending/waitlist/cancelled/sin fila) -> continúa
--     y completa el pago mixto de verdad.
-- Se agrega también el mismo chequeo de capacidad + oversell_alerts que ya
-- tenía inscribir_yappy_evento (acá no existía: el sobrecupo por mixto era
-- 100% silencioso, sin log ni alerta). El débito de wallet, precio_para,
-- fee y el upsert final quedan BYTE-IGUAL a 20260706000002.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.completar_mixto_por_orden(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_o            record;
  v_precio       numeric;
  v_wallet_monto numeric;
  v_fee          numeric;
  v_w            record;
  v_existing     record;
  v_desc         text;
  v_wallet_id    uuid;
  v_ev           record;
  v_ocup         integer;
  v_ya_ocupaba   boolean;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = auth.uid()) not in ('admin','super_admin') then
      raise exception 'solo service_role/admin';
    end if;
  end if;

  select * into v_o from public.yappy_orders
   where order_id = p_order_id and tipo = 'mixto' and status = 'executed';
  if v_o.order_id is null then
    raise exception 'orden mixta ejecutada no encontrada: %', p_order_id;
  end if;

  select status, metodo_pago into v_existing
    from public.event_registrations
   where event_id = v_o.event_id and user_id = v_o.user_id;

  if v_existing.status = 'confirmed' then
    if v_existing.metodo_pago = 'mixto' then
      return jsonb_build_object('ok', true, 'already', true);  -- reintento del IPN, ya completo
    end if;
    -- Confirmado por OTRO método mientras esta orden mixta (parte Yappy)
    -- seguía en curso: el monto Yappy ya cobrado no se pierde en silencio,
    -- se acredita a sus créditos. Idempotente por order_id.
    v_desc := 'yappy_extra:' || p_order_id;
    if not exists (select 1 from public.wallet_transactions where descripcion = v_desc) then
      select id into v_wallet_id from public.wallets where user_id = v_o.user_id;
      if v_wallet_id is not null then
        update public.wallets set balance = balance + coalesce(v_o.amount, 0) where id = v_wallet_id;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_wallet_id, 'reembolso', coalesce(v_o.amount, 0), v_desc);
      end if;
    end if;
    return jsonb_build_object('ok', true, 'already', true, 'credited_extra', true);
  end if;

  -- Sólo 'confirmed' (arriba) actúa como guarda de idempotencia. Cualquier
  -- otro estado (pending/waitlist/cancelled/sin fila) continúa y completa
  -- el pago mixto real — este es el fix del hallazgo de arriba.
  v_ya_ocupaba := coalesce(v_existing.status, '') in ('confirmed','pending');

  v_precio := public.precio_para(v_o.event_id, v_o.user_id);
  if v_precio is null then raise exception 'evento sin precio'; end if;
  select coalesce(app_fee_per_player, 0) into v_fee from public.events where id = v_o.event_id;
  v_fee := least(v_fee, v_precio);

  v_wallet_monto := round(greatest(v_precio - coalesce(v_o.amount,0), 0), 2);
  if v_wallet_monto > 0 then
    select id, balance into v_w from public.wallets where user_id = v_o.user_id for update;
    if v_w.id is not null then
      v_wallet_monto := least(v_wallet_monto, v_w.balance);
      if v_wallet_monto > 0 then
        update public.wallets set balance = balance - v_wallet_monto where id = v_w.id;
        insert into public.wallet_transactions (wallet_id, tipo, monto, descripcion)
        values (v_w.id, 'inscripcion', -v_wallet_monto,
                'Inscripción mixta (créditos + Yappy $' || to_char(coalesce(v_o.amount,0),'FM990.00') || '): '
                || (select nombre from public.events where id = v_o.event_id));
      end if;
    end if;
  end if;

  -- Alerta de sobrecupo (best-effort, nunca bloquea) — mismo patrón que
  -- inscribir_yappy_evento, que completar_mixto_por_orden nunca tuvo. Sólo si
  -- esta fila NO ocupaba ya un cupo (si seguía 'pending', ej. el promovido
  -- pagando a tiempo, no es un cupo NUEVO y el trigger de capacidad ya lo
  -- deja pasar sin recontar).
  if not v_ya_ocupaba then
    select cupos_ilimitado, cupos_total into v_ev from public.events where id = v_o.event_id;
    if v_ev.cupos_ilimitado is not true and v_ev.cupos_total is not null then
      select
        (select count(*) from public.event_registrations r
           where r.event_id = v_o.event_id and r.status in ('confirmed','pending'))
        +
        (select count(*) from public.event_guests g
           where g.event_id = v_o.event_id and g.status in ('confirmed','pending_payment')
             and (g.invited_by is null or exists (
               select 1 from public.event_registrations r2
               where r2.event_id = v_o.event_id and r2.user_id = g.invited_by
                 and r2.status in ('confirmed','pending'))))
      into v_ocup;
      if v_ocup >= v_ev.cupos_total then
        begin
          insert into public.oversell_alerts (event_id, user_id, metodo, monto, detalle)
          values (v_o.event_id, v_o.user_id, 'mixto', v_o.amount,
            format('Pago mixto confirmado tras liberarse su reserva; evento lleno (%s/%s). Order %s. Honrado: sobrecupo +1.',
                   v_ocup, v_ev.cupos_total, p_order_id));
        exception when others then null;
        end;
      end if;
    end if;
  end if;

  insert into public.event_registrations (event_id, user_id, status, metodo_pago, monto_pagado, app_fee)
  values (v_o.event_id, v_o.user_id, 'confirmed', 'mixto', v_precio, v_fee)
  on conflict (event_id, user_id) do update
    set status = 'confirmed', metodo_pago = 'mixto', monto_pagado = v_precio;

  return jsonb_build_object('ok', true, 'wallet_debitado', v_wallet_monto, 'yappy', v_o.amount, 'precio', v_precio);
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────
-- C1 (R1): trigger AFTER UPDATE en events — promueve al aumentar cupos.
--
-- v2: corrige DOS hallazgos reales sobre la v1:
--  (a) "sub-promoción": v_cap usaba greatest(delta_total, delta_hombres,
--      delta_mujeres) — si el admin sube AMBOS buckets de género a la vez
--      (ej. +2 hombres y +2 mujeres, total sin cambios porque ya había
--      holgura) el bucle cortaba a los 2 primeros y dejaba 2 personas con
--      cupo real disponible varadas en la lista, sin aviso. Ahora se suman
--      los deltas de género (una cota ALTA es inofensiva porque
--      promote_waitlist se autotermina al devolver null; una cota BAJA
--      descartaba promociones reales — el hallazgo señaló que se había
--      elegido el lado equivocado del margen).
--  (b) "género 'Otro'/NULL roba el cupo": ahora se promueve en TRES pasos
--      (hombres género-filtrado, mujeres género-filtrado, y holgura de
--      total sin filtro) en vez de un solo bucle género-ciego — así un
--      candidato sin género binario definido ya no puede colarse en un
--      cupo que el admin abrió específicamente para un género, adelante de
--      quien sí calificaba.
-- También se agrega un RAISE WARNING (visible en logs) cuando se detectó un
-- aumento pero NO se promovió a nadie habiendo lista de espera (ej. subir
-- sólo cupos_mujeres con el total ya lleno) — antes era 100% silencioso,
-- justo el patrón de bug que esta serie de migraciones existe para cerrar.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public._trfn_promote_waitlist_on_cupos_increase()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_total_up      boolean;
  v_hombres_up    boolean;
  v_mujeres_up    boolean;
  v_ilimitado_up  boolean;
  v_delta_total   integer;
  v_delta_hombres integer;
  v_delta_mujeres integer;
  v_reserved      integer;
  v_slack         integer;
  v_added         integer := 0;
  v_promoted      uuid;
  v_i             integer;
  c_hard_cap      constant integer := 500;  -- tope duro defensivo (no "colgar" el UPDATE del admin)
begin
  -- admin_remove_registration (20260604000008) prende este flag transaccional
  -- para su reemplazo manual: no auto-promover mientras esté activo.
  if current_setting('app.skip_waitlist_promote', true) = '1' then
    return new;
  end if;

  -- Solo eventos abiertos/activos. promote_waitlist ya lo valida también,
  -- pero cortamos acá primero para no barrer la waitlist de un evento
  -- draft/finished/cancelled en cada UPDATE que le llegue a esa fila.
  if new.status not in ('open', 'active') then
    return new;
  end if;

  -- GOTCHA (memoria del proyecto): "col > NULL" da NULL, no false, y un OR
  -- de puros NULL/false también puede dar NULL -> "if not(NULL)" en plpgsql
  -- se trata como false. Por eso cada bandera se fuerza a boolean real
  -- exigiendo "is not null" en ambos lados ANTES de comparar con ">".
  v_total_up   := (new.cupos_total   is not null and old.cupos_total   is not null and new.cupos_total   > old.cupos_total);
  v_hombres_up := (new.cupos_hombres is not null and old.cupos_hombres is not null and new.cupos_hombres > old.cupos_hombres);
  v_mujeres_up := (new.cupos_mujeres is not null and old.cupos_mujeres is not null and new.cupos_mujeres > old.cupos_mujeres);
  v_ilimitado_up := (coalesce(new.cupos_ilimitado, false) and not coalesce(old.cupos_ilimitado, false));

  if not (v_total_up or v_hombres_up or v_mujeres_up or v_ilimitado_up) then
    return new;  -- ningún cupo creció (bajó, quedó igual, o cambió otra columna): nada que promover
  end if;

  if v_ilimitado_up then
    -- Sin delta numérico que medir (pasó a ilimitado): tope duro. promote_
    -- waitlist se autotermina al vaciarse la waitlist o al no caber nadie
    -- más, así que en la práctica esto sólo itera lo que la lista realmente
    -- tenga. El tope existe para blindar contra un bug/loop en otro lado,
    -- no como techo operativo esperado (evento de esta app rara vez tiene
    -- waitlists de cientos). Si algún día SÍ lo golpea, queda un warning.
    v_i := 0;
    while v_i < c_hard_cap loop
      v_promoted := public.promote_waitlist(new.id);
      exit when v_promoted is null;
      v_i := v_i + 1;
    end loop;
    v_added := v_i;
    if v_i = c_hard_cap then
      raise warning 'trg_promote_waitlist_on_cupos_increase: evento % llegó al tope duro (%) promoviendo tras pasar a cupos_ilimitado; puede quedar gente en la lista sin promover en esta corrida (la próxima cancelación/aumento seguirá promoviendo).', new.id, c_hard_cap;
    end if;
  else
    v_delta_total   := case when v_total_up   then new.cupos_total   - old.cupos_total   else 0 end;
    v_delta_hombres := case when v_hombres_up then new.cupos_hombres - old.cupos_hombres else 0 end;
    v_delta_mujeres := case when v_mujeres_up then new.cupos_mujeres - old.cupos_mujeres else 0 end;

    -- Cupos "reservados" por bucket de género + holgura de total que no es
    -- de ningún bucket específico (total subió más de lo que subieron los
    -- géneros, o subió SOLO el total). Nunca negativo.
    v_reserved := least(v_delta_hombres + v_delta_mujeres, c_hard_cap);
    v_slack    := least(greatest(v_delta_total - v_reserved, 0), c_hard_cap);

    -- Paso 1: candidatos HOMBRES, sólo si creció ESE bucket. Género-filtrado
    -- -> un 'Otro'/NULL nunca puede tomar este cupo reservado.
    v_i := 0;
    while v_i < least(v_delta_hombres, c_hard_cap) loop
      v_promoted := public.promote_waitlist(new.id, 'Masculino');
      exit when v_promoted is null;
      v_i := v_i + 1;
      v_added := v_added + 1;
    end loop;

    -- Paso 2: candidatos MUJERES, idem.
    v_i := 0;
    while v_i < least(v_delta_mujeres, c_hard_cap) loop
      v_promoted := public.promote_waitlist(new.id, 'Femenino');
      exit when v_promoted is null;
      v_i := v_i + 1;
      v_added := v_added + 1;
    end loop;

    -- Paso 3: holgura de TOTAL que no es de ningún bucket (o el aumento fue
    -- puramente de cupos_total, sin tocar género): sin filtro, cualquiera de
    -- la lista puede tomarlo, en orden de llegada.
    v_i := 0;
    while v_i < v_slack loop
      v_promoted := public.promote_waitlist(new.id);
      exit when v_promoted is null;
      v_i := v_i + 1;
      v_added := v_added + 1;
    end loop;
  end if;

  -- Diagnóstico (antes 100% silencioso): un aumento detectado que no
  -- promovió a nadie con lista de espera viva suele significar que el total
  -- sigue tope (ej. sólo se subió cupos_mujeres) o que cupos_total no es
  -- coherente con cupos_hombres+cupos_mujeres. No bloquea nada, sólo queda
  -- en los logs de Postgres/Supabase para poder auditarlo.
  if v_added = 0 and exists (
    select 1 from public.event_registrations
     where event_id = new.id and status = 'waitlist'
  ) then
    raise warning 'trg_promote_waitlist_on_cupos_increase: evento % aumentó cupos (total %->%, hombres %->%, mujeres %->%, ilimitado %->%) pero NO promovió a nadie pese a tener lista de espera — revisar si cupos_total alcanza y si es coherente con hombres+mujeres.',
      new.id, old.cupos_total, new.cupos_total, old.cupos_hombres, new.cupos_hombres,
      old.cupos_mujeres, new.cupos_mujeres, old.cupos_ilimitado, new.cupos_ilimitado;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_promote_waitlist_on_cupos_increase on public.events;
create trigger trg_promote_waitlist_on_cupos_increase
  after update on public.events
  for each row execute function public._trfn_promote_waitlist_on_cupos_increase();

-- ───────────────────────────────────────────────────────────────────────
-- C2 (R2): ventana del promovido 4h -> 10min, en cron/función propios
-- ───────────────────────────────────────────────────────────────────────

-- 1) expire_pending_cash_requests (última versión previa: 20260604000004)
--    PIERDE el bloque "Promovidos de lista de espera... 4 horas" — se muda
--    a expire_promoted_waitlist() de abajo. Todo lo demás queda BYTE-IGUAL:
--    expira cash_payment_requests por su propio expires_at (tabla separada,
--    default +4h, sin tocar), limpia cupos zombie de efectivo, y libera
--    yappy_boton huérfano a los 20 min. Ninguno de esos plazos cambia
--    (invariante explícita: "efectivo y yappy_boton NO alteran su plazo").
create or replace function public.expire_pending_cash_requests()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) not in ('admin','gestor') then
      raise exception 'unauthorized: solo admin/gestor';
    end if;
  end if;
  update public.cash_payment_requests set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics v_count = row_count;

  -- Cupos zombie de efectivo (rechazadas/expiradas sin solicitud viva)
  update public.event_registrations r
     set status = 'cancelled'
   where r.status = 'pending' and r.metodo_pago = 'efectivo'
     and exists (select 1 from public.cash_payment_requests c
                 where c.event_id = r.event_id and c.user_id = r.user_id)
     and not exists (
       select 1 from public.cash_payment_requests c
       where c.event_id = r.event_id and c.user_id = r.user_id
         and (c.status = 'approved' or (c.status = 'pending' and (c.expires_at is null or c.expires_at > now())))
     );

  -- Reservas Yappy huerfanas (cliente cerro el browser a mitad del pago)
  update public.event_registrations
     set status = 'cancelled'
   where status = 'pending' and metodo_pago = 'yappy_boton'
     and coalesce(monto_pagado, 0) = 0
     and created_at < now() - interval '20 minutes';

  return v_count;
end;
$function$;

revoke execute on function public.expire_pending_cash_requests() from public, anon;
grant  execute on function public.expire_pending_cash_requests() to authenticated, service_role;

-- 2) expire_promoted_waitlist(): cancela promovidos que no pagaron dentro de
--    su ventana de 10 minutos. Cancelar dispara _trfn_promote_waitlist_on_
--    cancel (20260604000008) -> cascada al siguiente de la lista, con SU
--    PROPIA ventana de 10 min (created_at se re-sella en cada promoción) y
--    su propio aviso server-side (promote_waitlist, sin cambios de código).
--
--    v2 agrega DOS exclusiones que la v1 no tenía, ambas confirmadas por
--    trazado de código real (no hipotéticas):
--
--    (a) Pago Yappy/mixto REALMENTE en curso: confirmarYappyBoton y
--        confirmarYappyMixto (EventDetailScreen.js) NUNCA renuevan ni tocan
--        la fila del promovido mientras Yappy procesa (a diferencia del
--        comprador directo, que sí reserva 'yappy_boton') — su created_at
--        queda fijo en el momento de la promoción durante TODO el pago
--        (polling real: hasta 60 intentos x 5s = 5 min, más la confirmación
--        del banco y la entrega del IPN). Sin esta exclusión, el cron podía
--        cancelar la fila justo cuando Yappy la estaba cobrando de verdad,
--        y el IPN (service_role, bypassa el trigger de capacidad) la revivía
--        ENCIMA del cupo ya reasignado al siguiente -> sobrecupo real. A 4h
--        (v1 original del feature) esta carrera era casi imposible; a 10 min
--        con cron cada 1 min pasa a ser rutinaria. 15 min de gracia (desde
--        que se CREÓ la orden, no desde la promoción) cubre el polling real
--        con margen; si la orden nunca resuelve (falla/expira en Yappy), deja
--        de proteger a los 15 min y el siguiente tick la cancela igual.
--
--    (b) Promovido que "escapa" por Efectivo: si eligió Efectivo, su
--        metodo_pago pasa a 'efectivo' (sale del filtro de abajo) y por
--        default heredaría las 4h de cash_payment_requests — un atajo
--        trivial para estirar el cupo 24x (hallazgo confirmado). El cliente
--        (EventDetailScreen.payWithEfectivo) ahora crea esa solicitud con
--        expires_at = +10 min SÓLO cuando viene de una promoción (ver
--        client_changes); acá se reconoce ese caso por la DURACIÓN de la
--        ventana en sí — (expires_at - created_at) < 1 hora — en vez de una
--        columna nueva, así se distingue de una solicitud de efectivo NORMAL
--        (+4h, sin tocar, invariante). Se revisa cada 1 min en vez de
--        esperar el cron de 30 min de efectivo, para que la cascada de
--        promoción siga siendo rápida.
create or replace function public.expire_promoted_waitlist()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then
    if (select role from public.users where auth_id = (select auth.uid())) not in ('admin','gestor') then
      raise exception 'unauthorized: solo admin/gestor';
    end if;
  end if;

  update public.event_registrations r
     set status = 'cancelled'
   where r.status = 'pending' and r.metodo_pago = 'waitlist_promoted'
     and r.created_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.yappy_orders o
        where o.event_id = r.event_id
          and o.user_id  = r.user_id
          and o.tipo in ('evento','mixto')
          and o.status in ('pending','executed')
          and o.created_at > now() - interval '15 minutes'
     );
  get diagnostics v_count = row_count;

  -- (b) Cash requests de VENTANA CORTA (originadas en una promoción, ver
  --     arriba) que ya vencieron: marcarlas expiradas primero...
  update public.cash_payment_requests
     set status = 'expired'
   where status = 'pending'
     and expires_at < now()
     and (expires_at - created_at) < interval '1 hour';

  -- ...y liberar el cupo 'pending'/efectivo asociado si no quedó ninguna
  -- solicitud viva para ese evento/usuario (mismo criterio "zombie" que usa
  -- expire_pending_cash_requests, acotado a las de ventana corta para no
  -- adelantar de más las solicitudes de efectivo normales de 4h).
  update public.event_registrations r
     set status = 'cancelled'
   where r.status = 'pending' and r.metodo_pago = 'efectivo'
     and exists (
       select 1 from public.cash_payment_requests c
        where c.event_id = r.event_id and c.user_id = r.user_id
          and c.status = 'expired'
          and (c.expires_at - c.created_at) < interval '1 hour'
     )
     and not exists (
       select 1 from public.cash_payment_requests c
        where c.event_id = r.event_id and c.user_id = r.user_id
          and (c.status = 'approved' or (c.status = 'pending' and (c.expires_at is null or c.expires_at > now())))
     );

  return v_count;
end;
$function$;

-- No hay caller cliente (grep confirmado) — sólo el cron de abajo. A
-- diferencia de expire_pending_cash_requests (sí llamado desde Gestor/Admin
-- Panel), acá se puede cerrar también a `authenticated` sin romper nada.
revoke execute on function public.expire_promoted_waitlist() from public, anon, authenticated;
grant  execute on function public.expire_promoted_waitlist() to service_role;

-- 3) Cron DEDICADO cada 1 minuto (ventana corta -> necesita chequeo
--    frecuente; a propósito NO se suma al cron de 30 min de cash-requests
--    para no diluir el TTL de 10 min con el de efectivo/yappy_boton).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-promoted-waitlist') then
    perform cron.unschedule('expire-promoted-waitlist');
  end if;
end $$;
select cron.schedule('expire-promoted-waitlist', '* * * * *', $$select public.expire_promoted_waitlist()$$);

-- ════════════════════════════════════════════════════════════════════════
-- NOTAS DE VALIDACIÓN (C4 / R3-R4) — estado tras esta v2, confirmado por
-- lectura de código el 2026-07-07:
--
--  • inscribir_con_wallet (20260629190000, SIN cambios): re-chequea
--    idempotencia DESPUÉS del lock del wallet, upsert "on conflict do update
--    set status='confirmed'" convierte cualquier pending/waitlist_promoted
--    sin re-cobrar. No tenía el hueco de doble-cobro de Yappy (el wallet no
--    tiene una "orden" externa que pueda llegar tarde), así que no necesitó
--    el mismo fix.
--
--  • inscribir_yappy_evento y completar_mixto_por_orden: reparados arriba
--    (idempotencia por método + crédito del sobrante en vez de perderlo en
--    silencio). completar_mixto_por_orden además ya no trata la fila
--    'pending'/waitlist_promoted del propio promovido como "ya hecho".
--
--  • _trfn_enforce_event_capacity (20260605000001, SIN cambios acá): sigue
--    saltando la re-validación cuando OLD.status ya ocupaba cupo (confirmed
--    o pending) y sigue bypasseando auth.role()='service_role'. El hallazgo
--    de oversell NO estaba en este trigger sino en la carrera cron-vs-pago-
--    en-vuelo (reparada arriba, expire_promoted_waitlist ya no cancela con
--    una orden real en curso). El hallazgo de género 'Otro'/NULL saltando la
--    cuota SÍ vive en este trigger (línea "if v_genero in ('Masculino',
--    'Femenino')") — no se tocó: es compartido con TODA inscripción directa
--    (no sólo promociones), cambiar su regla de negocio (¿'Otro' cuenta
--    contra qué bucket?) es una decisión de producto de Sergio, no algo para
--    resolver unilateralmente en un fix de waitlist. Se mitigó donde SÍ es
--    responsabilidad de este ticket: promote_waitlist ahora puede pedir
--    candidatos de un género específico, así que la ORDEN DE PROMOCIÓN por
--    aumento de bucket ya no deja que 'Otro'/NULL le gane el turno a quien
--    el admin realmente quiso beneficiar.
--
--  • Cliente (EventDetailScreen.js): confirmarYappyBoton (~L554-587) y
--    payWithEfectivo (~L655-670) ya excluyen al promovido de re-reservar o
--    de ser bloqueado por "ya tenés un pago pendiente" vía "isPromotedReg";
--    payWithWallet (~L338) no lo bloquea porque sólo excluye por
--    status='confirmed'. openPayModal -> PaymentModal ya ofrece los 3
--    métodos instantáneos (créditos/Yappy/mixto), no sólo "contactar
--    gestor". payWithEfectivo ahora da ventana corta (10 min) real cuando
--    viene de una promoción, en vez de heredar en silencio las 4h de
--    efectivo normal (ver client_changes).
--
--  • Cancelar (usuario, invitado, admin_reject_cash_request, cron TTL) sigue
--    disparando _trfn_promote_waitlist_on_cancel / _on_guest_cancel
--    (20260604000008, SIN cambios) -> promote_waitlist -> ventana de 10 min
--    y el mismo aviso server-side.
--
--  • send-notification (edge function): el email de respaldo estaba
--    construido pero nunca invocado ("Email desactivado — solo web push",
--    force_email recibido y jamás usado) — reparado (ver edge_patch). Con
--    la ventana en 10 min, depender sólo de web push opt-in dejaba a la
--    mayoría de una lista de espera sin ningún aviso real.
--
--  • FUERA DE ALCANCE, documentado y NO tocado en este archivo (serían
--    cambios no pedidos o de mayor alcance del declarado):
--      - docs/terminos.html sigue diciendo "4 horas" para la promoción de
--        waitlist (texto legal público) — pendiente de que Sergio decida
--        actualizarlo.
--      - wc-sync-results (cron ya existente, ajeno a este archivo) usa el
--        mismo patrón current_setting('app.wc_sync_secret', true) SIN
--        fallback (20260530000001) — verificado en vivo que esa setting NO
--        está configurada hoy, así que ese cron podría estar fallando en
--        silencio de forma independiente a este ticket. Vale la pena que
--        Sergio lo revise.
--      - El "reminder" a mitad de ventana (re-notificar a los ~5 min para
--        cubrir la latencia de entrega de push/email) se consideró y NO se
--        implementó: con el email de respaldo ya funcionando, hay 2 canales
--        reales en el primer intento; agregar un segundo disparo requeriría
--        extraer la lógica de aviso de promote_waitlist a un helper nuevo,
--        más superficie para un archivo ya grande. Queda como mejora futura
--        razonable, no como bloqueante para esta entrega.
--      - cupos_ilimitado con lista de espera muy profunda sigue promoviendo
--        de forma síncrona dentro de la transacción del UPDATE del admin
--        (hasta el tope duro de 500): para los deltas normales de esta app
--        (decenas, no cientos) el costo es despreciable; una cola async
--        sería la solución de fondo pero es una re-arquitectura fuera de
--        alcance de un solo archivo de migración. Mitigado con el warning
--        al tocar el tope y dejado documentado como trade-off consciente.
-- ════════════════════════════════════════════════════════════════════════
