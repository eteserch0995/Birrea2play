-- ============================================================
-- 2026-07-04 — Canchas v3 (2/5): RPCs del flujo de aprobación
-- Aplicada a prod vía MCP como `canchas_v3_rpcs_flujo_aprobacion`.
-- Flujo: solicitud → abono (hold 15') → abono_pagado (pending)
--        → cancha aprueba/rechaza → approved / rejected(+reembolso)
--        → saldo por app (wallet/Yappy) → pagado → completed.
-- ============================================================

-- ── 1. crear_cancha_reserva: 1.5h opcional + siempre requiere aprobación ──
create or replace function public.crear_cancha_reserva(
  p_cancha_id uuid, p_tarifa_id uuid, p_gestor_id uuid,
  p_fecha date, p_hora_inicio time, p_hora_fin time,
  p_precio_hora numeric, p_canal text default 'app'
) returns table(
  id uuid, codigo_reserva text, status text, estado_pago text,
  expira_en timestamptz, monto_total numeric, abono_requerido numeric, abono_tipo text
) language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id       uuid;
  v_caller_role     text;
  v_cancha          canchas%ROWTYPE;
  v_horario         cancha_horarios%ROWTYPE;
  v_tarifa          cancha_tarifas%ROWTYPE;
  v_dow             int;
  v_duracion_min    int;
  v_inicio_minuto   int;
  v_extra_ok        boolean;
  v_precio          numeric(10,2);
  v_monto_total     numeric;
  v_abono_requerido numeric;
  v_expira_en       timestamptz;
  v_estado_pago     text;
  v_codigo          text;
  v_reserva_id      uuid;
  v_canal_val       text;
BEGIN
  -- [P0] Derivar gestor de auth.uid(), NUNCA de p_gestor_id
  v_caller_id := (SELECT u.id FROM users u WHERE u.auth_id = auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  v_caller_role := (SELECT u.role FROM users u WHERE u.id = v_caller_id);
  IF v_caller_role NOT IN ('gestor', 'cancha_admin', 'admin') THEN
    RAISE EXCEPTION 'forbidden: role % cannot create reservations', v_caller_role
      USING ERRCODE = 'P0001';
  END IF;

  v_canal_val := CASE WHEN p_canal IN ('app','whatsapp','llamada','presencial','interno')
                      THEN p_canal ELSE 'app' END;

  SELECT * INTO v_cancha FROM canchas WHERE canchas.id = p_cancha_id AND activa = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'CANCHA_INACTIVA'; END IF;

  IF p_fecha < CURRENT_DATE THEN RAISE EXCEPTION 'FECHA_PASADA'; END IF;

  v_dow := EXTRACT(DOW FROM p_fecha)::int;
  SELECT * INTO v_horario
  FROM cancha_horarios
  WHERE cancha_horarios.cancha_id  = p_cancha_id
    AND dia_semana = v_dow
    AND activo     = true
    AND (cancha_horarios.tarifa_id = p_tarifa_id OR cancha_horarios.tarifa_id IS NULL)
  ORDER BY cancha_horarios.tarifa_id NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'DIA_NO_OPERATIVO'; END IF;
  IF p_hora_inicio < v_horario.hora_apertura THEN RAISE EXCEPTION 'FUERA_HORARIO_APERTURA'; END IF;
  IF p_hora_fin    > v_horario.hora_cierre   THEN RAISE EXCEPTION 'FUERA_HORARIO_CIERRE'; END IF;

  v_extra_ok := COALESCE(v_cancha.permite_media_hora_extra, false);

  -- Inicio: en punto; :30 permitido si el horario lo habilita O la cancha permite +30
  -- (con reservas de 1.5h el bloque siguiente arranca en :30 — sin esto quedaría inservible)
  v_inicio_minuto := EXTRACT(MINUTE FROM p_hora_inicio)::int;
  IF COALESCE(v_horario.medias_horas, false) OR v_extra_ok THEN
    IF v_inicio_minuto NOT IN (0, 30) THEN
      RAISE EXCEPTION 'INICIO_INVALIDO: solo se permiten inicios en :00 o :30';
    END IF;
  ELSE
    IF v_inicio_minuto <> 0 THEN
      RAISE EXCEPTION 'INICIO_INVALIDO: el inicio debe ser en hora exacta (:00)';
    END IF;
  END IF;

  -- Duración: horas completas; +30 min solo si la cancha lo habilitó (decisión Sergio: 1h o 1.5h, nunca bloques de 30)
  v_duracion_min := EXTRACT(EPOCH FROM (p_hora_fin - p_hora_inicio))::int / 60;
  IF v_duracion_min < 60 THEN
    RAISE EXCEPTION 'DURACION_MINIMA_1_HORA';
  END IF;
  IF v_duracion_min % 60 <> 0
     AND NOT (v_extra_ok AND v_duracion_min % 30 = 0) THEN
    RAISE EXCEPTION 'DURACION_DEBE_SER_HORAS_COMPLETAS: % minutos', v_duracion_min;
  END IF;
  IF v_horario.horario_libre = false
     AND v_duracion_min <> v_horario.duracion_slot_min
     AND NOT (v_extra_ok AND v_duracion_min = v_horario.duracion_slot_min + 30) THEN
    RAISE EXCEPTION 'DURACION_INVALIDA_SLOT_FIJO';
  END IF;
  IF v_cancha.duracion_min_minutos IS NOT NULL AND v_duracion_min < v_cancha.duracion_min_minutos THEN
    RAISE EXCEPTION 'DURACION_MENOR_AL_MINIMO';
  END IF;
  IF v_cancha.duracion_max_minutos IS NOT NULL AND v_duracion_min > v_cancha.duracion_max_minutos THEN
    RAISE EXCEPTION 'DURACION_MAYOR_AL_MAXIMO';
  END IF;

  IF NOT cancha_slot_disponible(p_cancha_id, p_fecha, p_hora_inicio, p_hora_fin) THEN
    RAISE EXCEPTION 'SLOT_NO_DISPONIBLE';
  END IF;

  -- [P0] Precio server-side, NUNCA de p_precio_hora
  SELECT * INTO v_tarifa FROM cancha_tarifas WHERE cancha_tarifas.id = p_tarifa_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'tarifa_no_encontrada' USING ERRCODE = 'P0002'; END IF;
  v_precio := v_tarifa.precio_hora;

  v_monto_total := ROUND((v_duracion_min::numeric / 60.0) * v_precio, 2);

  v_abono_requerido := CASE v_cancha.abono_tipo
    WHEN 'ninguno'    THEN 0
    WHEN 'fijo'       THEN COALESCE(v_cancha.abono_monto_fijo, 0)
    WHEN 'porcentaje' THEN ROUND(v_monto_total * v_cancha.porcentaje_deposito::numeric / 100.0, 2)
    WHEN 'total'      THEN v_monto_total
    ELSE CASE WHEN v_cancha.requiere_deposito
      THEN ROUND(v_monto_total * v_cancha.porcentaje_deposito::numeric / 100.0, 2)
      ELSE 0 END
  END;

  -- v3: la reserva SIEMPRE nace pending (la cancha debe aprobar, con o sin abono)
  IF v_abono_requerido > 0 THEN
    v_estado_pago := 'pendiente';
    v_expira_en   := now() + make_interval(mins => COALESCE(v_cancha.hold_minutos, 15));
  ELSE
    v_estado_pago := 'no_requerido';
    v_expira_en   := NULL;
  END IF;

  v_codigo := generar_codigo_reserva();

  BEGIN
    INSERT INTO cancha_reservas (
      cancha_id, tarifa_id, gestor_id, fecha, hora_inicio, hora_fin,
      status, monto_total, deposito_pagado, codigo_reserva,
      estado_pago, expira_en, deposito_requerido, canal
    ) VALUES (
      p_cancha_id, p_tarifa_id, v_caller_id,
      p_fecha, p_hora_inicio, p_hora_fin,
      'pending', v_monto_total, 0, v_codigo,
      v_estado_pago, v_expira_en, v_abono_requerido, v_canal_val
    ) RETURNING cancha_reservas.id INTO v_reserva_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'SLOT_NO_DISPONIBLE';
  END;

  RETURN QUERY SELECT
    v_reserva_id, v_codigo, 'pending'::text, v_estado_pago,
    v_expira_en, v_monto_total, v_abono_requerido, v_cancha.abono_tipo;
END;
$$;

-- ── 2. confirmar_abono_cancha_wallet: pagar abono YA NO aprueba ──
create or replace function public.confirmar_abono_cancha_wallet(
  p_reserva_id uuid, p_gestor_id uuid, p_abono_requerido numeric
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id uuid;
  v_reserva   cancha_reservas%ROWTYPE;
  v_wallet    wallets%ROWTYPE;
  v_deposito  NUMERIC(10,2);
BEGIN
  v_caller_id := (SELECT users.id FROM users WHERE auth_id = auth.uid());
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_reserva.gestor_id <> v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_reserva.estado_pago IN ('abono_pagado', 'pagado') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  IF v_reserva.expira_en IS NOT NULL AND v_reserva.expira_en < NOW() THEN
    UPDATE cancha_reservas SET status='cancelled', estado_pago='expirado',
      cancelada_por='sistema', updated_at=NOW() WHERE cancha_reservas.id = p_reserva_id;
    RETURN jsonb_build_object('ok', false, 'error', 'reserva_expirada');
  END IF;

  IF v_reserva.status NOT IN ('pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  v_deposito := COALESCE(v_reserva.deposito_requerido, v_reserva.monto_total);
  IF v_deposito IS NULL OR v_deposito <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'monto_invalido');
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_caller_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found'); END IF;

  IF v_wallet.balance < v_deposito THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_wallet.balance, 'required', v_deposito);
  END IF;

  UPDATE cancha_reservas SET intentos_pago = COALESCE(intentos_pago, 0) + 1 WHERE cancha_reservas.id = p_reserva_id;
  UPDATE wallets SET balance = balance - v_deposito WHERE wallets.id = v_wallet.id;

  INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
  VALUES (gen_random_uuid(), v_wallet.id, 'pago_cancha', v_deposito,
          'Abono reserva cancha ' || v_reserva.codigo_reserva, p_reserva_id::TEXT, 'completed', NOW());

  -- v3: queda pending esperando aprobación de la cancha; el hold ya no aplica
  UPDATE cancha_reservas SET estado_pago='abono_pagado',
    deposito_pagado=v_deposito, expira_en=NULL, updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_deposito, 'pendiente_aprobacion', true);
END;
$$;

-- ── 3. confirmar_abono_cancha_yappy: no auto-aprueba + honra pagos tardíos ──
create or replace function public.confirmar_abono_cancha_yappy(
  p_reserva_id uuid, p_gestor_id uuid, p_monto_total numeric, p_fee numeric, p_order_id text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_reserva  cancha_reservas%ROWTYPE;
  v_deposito NUMERIC(10,2);
  v_wallet   wallets%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized: server-only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_reserva.yappy_order_id = p_order_id AND v_reserva.estado_pago IN ('abono_pagado','pagado') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  v_deposito := COALESCE(v_reserva.deposito_requerido, v_reserva.monto_total);

  -- Pago Yappy REAL que llegó tarde (hold vencido o ya expirada por el cron):
  -- honrar si el horario sigue libre; si no, reembolsar a créditos. Dinero real jamás se pierde.
  IF (v_reserva.status = 'cancelled' AND v_reserva.estado_pago = 'expirado')
     OR (v_reserva.status = 'pending' AND v_reserva.expira_en IS NOT NULL AND v_reserva.expira_en < NOW()) THEN
    BEGIN
      UPDATE cancha_reservas SET status='pending', estado_pago='abono_pagado',
        expira_en=NULL, cancelada_por=NULL, yappy_order_id=p_order_id,
        deposito_yappy_pagado=true, deposito_pagado=v_deposito,
        intentos_pago=COALESCE(intentos_pago,0)+1, updated_at=NOW()
      WHERE cancha_reservas.id = p_reserva_id;
      RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_deposito, 'revivida', true, 'order_id', p_order_id);
    EXCEPTION WHEN exclusion_violation THEN
      -- el horario ya lo tomó otro → reembolso a créditos del gestor
      SELECT * INTO v_wallet FROM wallets WHERE user_id = v_reserva.gestor_id FOR UPDATE;
      IF FOUND THEN
        UPDATE wallets SET balance = balance + v_deposito WHERE wallets.id = v_wallet.id;
        INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
        VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_deposito,
                'Reembolso: horario tomado, reserva ' || v_reserva.codigo_reserva, p_reserva_id::TEXT, 'completed', NOW());
      END IF;
      UPDATE cancha_reservas SET status='cancelled', estado_pago='reembolsado',
        cancelada_por='sistema', yappy_order_id=p_order_id, updated_at=NOW()
      WHERE cancha_reservas.id = p_reserva_id;
      RETURN jsonb_build_object('ok', false, 'error', 'slot_tomado_reembolsado', 'reembolso', v_deposito);
    END;
  END IF;

  IF v_reserva.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  UPDATE cancha_reservas SET intentos_pago = COALESCE(intentos_pago, 0) + 1 WHERE cancha_reservas.id = p_reserva_id;

  UPDATE cancha_reservas SET estado_pago='abono_pagado',
    yappy_order_id=p_order_id, deposito_yappy_pagado=true,
    deposito_pagado=v_deposito, expira_en=NULL, updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_deposito, 'order_id', p_order_id, 'pendiente_aprobacion', true);
END;
$$;

-- ── 4. confirmar_abono_cancha_tarjeta: espejo de yappy (PagueloFácil) ──
create or replace function public.confirmar_abono_cancha_tarjeta(
  p_reserva_id uuid, p_gestor_id uuid, p_monto_total numeric, p_fee numeric, p_orden_id text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_reserva  cancha_reservas%ROWTYPE;
  v_deposito NUMERIC(10,2);
  v_wallet   wallets%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized: server-only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_reserva.tarjeta_token = p_orden_id AND v_reserva.estado_pago IN ('abono_pagado','pagado') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  v_deposito := COALESCE(v_reserva.deposito_requerido, v_reserva.monto_total);

  IF (v_reserva.status = 'cancelled' AND v_reserva.estado_pago = 'expirado')
     OR (v_reserva.status = 'pending' AND v_reserva.expira_en IS NOT NULL AND v_reserva.expira_en < NOW()) THEN
    BEGIN
      UPDATE cancha_reservas SET status='pending', estado_pago='abono_pagado',
        expira_en=NULL, cancelada_por=NULL, tarjeta_token=p_orden_id,
        deposito_pagado=v_deposito,
        intentos_pago=COALESCE(intentos_pago,0)+1, updated_at=NOW()
      WHERE cancha_reservas.id = p_reserva_id;
      RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_deposito, 'revivida', true, 'token', p_orden_id);
    EXCEPTION WHEN exclusion_violation THEN
      SELECT * INTO v_wallet FROM wallets WHERE user_id = v_reserva.gestor_id FOR UPDATE;
      IF FOUND THEN
        UPDATE wallets SET balance = balance + v_deposito WHERE wallets.id = v_wallet.id;
        INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
        VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_deposito,
                'Reembolso: horario tomado, reserva ' || v_reserva.codigo_reserva, p_reserva_id::TEXT, 'completed', NOW());
      END IF;
      UPDATE cancha_reservas SET status='cancelled', estado_pago='reembolsado',
        cancelada_por='sistema', tarjeta_token=p_orden_id, updated_at=NOW()
      WHERE cancha_reservas.id = p_reserva_id;
      RETURN jsonb_build_object('ok', false, 'error', 'slot_tomado_reembolsado', 'reembolso', v_deposito);
    END;
  END IF;

  IF v_reserva.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  UPDATE cancha_reservas SET intentos_pago = COALESCE(intentos_pago, 0) + 1 WHERE cancha_reservas.id = p_reserva_id;

  UPDATE cancha_reservas SET estado_pago='abono_pagado',
    tarjeta_token=p_orden_id, deposito_pagado=v_deposito, expira_en=NULL, updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_deposito, 'token', p_orden_id, 'pendiente_aprobacion', true);
END;
$$;

-- ── 5. NUEVO aprobar_cancha_reserva: la cancha confirma la solicitud ──
create or replace function public.aprobar_cancha_reserva(p_reserva_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
  v_reserva     cancha_reservas%ROWTYPE;
  v_owner       uuid;
BEGIN
  SELECT users.id, users.role INTO v_caller_id, v_caller_role FROM users WHERE auth_id = auth.uid();
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;
  IF v_caller_role NOT IN ('cancha_admin','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_caller_role = 'cancha_admin' THEN
    SELECT owner_id INTO v_owner FROM canchas WHERE canchas.id = v_reserva.cancha_id;
    IF v_owner IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'forbidden: no eres dueño de esta cancha' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_reserva.status = 'approved' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  IF v_reserva.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;
  -- No aprobar solicitudes cuyo abono requerido sigue sin pagar
  IF v_reserva.estado_pago NOT IN ('abono_pagado','no_requerido') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'abono_no_pagado');
  END IF;

  UPDATE cancha_reservas SET status='approved', aprobada_at=NOW(), updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'codigo', v_reserva.codigo_reserva);
END;
$$;

-- ── 6. NUEVO rechazar_cancha_reserva: rechaza + reembolso 100% a créditos ──
create or replace function public.rechazar_cancha_reserva(p_reserva_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
  v_reserva     cancha_reservas%ROWTYPE;
  v_owner       uuid;
  v_wallet      wallets%ROWTYPE;
  v_reembolso   numeric(10,2);
BEGIN
  SELECT users.id, users.role INTO v_caller_id, v_caller_role FROM users WHERE auth_id = auth.uid();
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;
  IF v_caller_role NOT IN ('cancha_admin','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_caller_role = 'cancha_admin' THEN
    SELECT owner_id INTO v_owner FROM canchas WHERE canchas.id = v_reserva.cancha_id;
    IF v_owner IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'forbidden: no eres dueño de esta cancha' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_reserva.status = 'rejected' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  IF v_reserva.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  -- Reembolso 100% de lo pagado, a créditos internos (decisión por defecto 2026-07-04)
  v_reembolso := COALESCE(v_reserva.deposito_pagado, 0) + COALESCE(v_reserva.saldo_pagado, 0);
  IF v_reembolso > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_reserva.gestor_id FOR UPDATE;
    IF FOUND THEN
      UPDATE wallets SET balance = balance + v_reembolso WHERE wallets.id = v_wallet.id;
      INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
      VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_reembolso,
              'Reembolso: reserva ' || v_reserva.codigo_reserva || ' rechazada por la cancha',
              p_reserva_id::TEXT, 'completed', NOW());
    END IF;
  END IF;

  UPDATE cancha_reservas SET status='rejected',
    estado_pago = CASE WHEN v_reembolso > 0 THEN 'reembolsado' ELSE estado_pago END,
    motivo_rechazo = p_motivo, cancelada_por='cancha_admin', updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'reembolso', v_reembolso);
END;
$$;

-- ── 7. NUEVO pagar_saldo_cancha_wallet: el gestor paga el saldo restante ──
create or replace function public.pagar_saldo_cancha_wallet(p_reserva_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id uuid;
  v_reserva   cancha_reservas%ROWTYPE;
  v_wallet    wallets%ROWTYPE;
  v_saldo     numeric(10,2);
BEGIN
  v_caller_id := (SELECT users.id FROM users WHERE auth_id = auth.uid());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;
  IF v_reserva.gestor_id <> v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_reserva.estado_pago = 'pagado' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;
  IF v_reserva.status NOT IN ('approved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reserva_no_aprobada');
  END IF;

  v_saldo := ROUND(COALESCE(v_reserva.monto_total,0) - COALESCE(v_reserva.deposito_pagado,0) - COALESCE(v_reserva.saldo_pagado,0), 2);
  IF v_saldo <= 0 THEN
    UPDATE cancha_reservas SET estado_pago='pagado', updated_at=NOW() WHERE cancha_reservas.id = p_reserva_id;
    RETURN jsonb_build_object('ok', true, 'saldo', 0);
  END IF;

  SELECT * INTO v_wallet FROM wallets WHERE user_id = v_caller_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found'); END IF;
  IF v_wallet.balance < v_saldo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_balance',
      'balance', v_wallet.balance, 'required', v_saldo);
  END IF;

  UPDATE wallets SET balance = balance - v_saldo WHERE wallets.id = v_wallet.id;
  INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
  VALUES (gen_random_uuid(), v_wallet.id, 'pago_cancha', v_saldo,
          'Saldo reserva cancha ' || v_reserva.codigo_reserva, p_reserva_id::TEXT, 'completed', NOW());

  UPDATE cancha_reservas SET saldo_pagado = COALESCE(saldo_pagado,0) + v_saldo,
    estado_pago='pagado', updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_saldo);
END;
$$;

-- ── 8. NUEVO confirmar_saldo_cancha_yappy: IPN del saldo (service_role) ──
create or replace function public.confirmar_saldo_cancha_yappy(
  p_reserva_id uuid, p_gestor_id uuid, p_monto numeric, p_fee numeric, p_order_id text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_reserva cancha_reservas%ROWTYPE;
  v_wallet  wallets%ROWTYPE;
  v_saldo   numeric(10,2);
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized: server-only' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_reserva.yappy_saldo_order_id = p_order_id AND v_reserva.estado_pago = 'pagado' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  v_saldo := ROUND(COALESCE(v_reserva.monto_total,0) - COALESCE(v_reserva.deposito_pagado,0) - COALESCE(v_reserva.saldo_pagado,0), 2);

  IF v_reserva.status IN ('approved','completed') AND v_saldo > 0 THEN
    UPDATE cancha_reservas SET saldo_pagado = COALESCE(saldo_pagado,0) + v_saldo,
      estado_pago='pagado', yappy_saldo_order_id=p_order_id, updated_at=NOW()
    WHERE cancha_reservas.id = p_reserva_id;
    RETURN jsonb_build_object('ok', true, 'monto_cobrado', v_saldo, 'order_id', p_order_id);
  END IF;

  -- Reserva ya no activa (o saldo 0) y llegó dinero real → créditos al gestor
  IF v_saldo > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_reserva.gestor_id FOR UPDATE;
    IF FOUND THEN
      UPDATE wallets SET balance = balance + v_saldo WHERE wallets.id = v_wallet.id;
      INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
      VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_saldo,
              'Reembolso saldo: reserva ' || v_reserva.codigo_reserva || ' no activa',
              p_reserva_id::TEXT, 'completed', NOW());
    END IF;
    UPDATE cancha_reservas SET yappy_saldo_order_id=p_order_id, updated_at=NOW()
    WHERE cancha_reservas.id = p_reserva_id;
    RETURN jsonb_build_object('ok', false, 'error', 'reserva_no_activa_reembolsado', 'reembolso', v_saldo);
  END IF;

  RETURN jsonb_build_object('ok', true, 'idempotent', true, 'saldo', 0);
END;
$$;

-- ── 9. cancelar_cancha_reserva_usuario: reembolsa abono+saldo (v3) ──
create or replace function public.cancelar_cancha_reserva_usuario(p_reserva_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id uuid;
  v_reserva   cancha_reservas%ROWTYPE;
  v_wallet    wallets%ROWTYPE;
  v_reembolso NUMERIC(10,2);
BEGIN
  v_caller_id := (SELECT users.id FROM users WHERE auth_id = auth.uid());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;
  IF v_reserva.gestor_id <> v_caller_id THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF v_reserva.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
  IF v_reserva.status NOT IN ('pending', 'approved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  v_reembolso := COALESCE(v_reserva.deposito_pagado, 0) + COALESCE(v_reserva.saldo_pagado, 0);
  IF v_reserva.estado_pago IN ('abono_pagado','pagado') AND v_reembolso > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_caller_id FOR UPDATE;
    IF FOUND THEN
      UPDATE wallets SET balance = balance + v_reembolso WHERE wallets.id = v_wallet.id;
      INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
      VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_reembolso,
              'Reembolso cancelación reserva ' || v_reserva.codigo_reserva,
              p_reserva_id::TEXT, 'completed', NOW());
    END IF;
  ELSE
    v_reembolso := 0;
  END IF;

  UPDATE cancha_reservas
  SET status='cancelled',
      estado_pago = CASE WHEN v_reembolso > 0 THEN 'reembolsado' ELSE estado_pago END,
      cancelada_por='gestor', updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'reembolso', v_reembolso);
END;
$$;

-- ── 10. cancelar_cancha_reserva_admin: ahora TAMBIÉN reembolsa (simetría) ──
create or replace function public.cancelar_cancha_reserva_admin(p_reserva_id uuid, p_notas text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
  v_reserva     cancha_reservas%ROWTYPE;
  v_owner       uuid;
  v_wallet      wallets%ROWTYPE;
  v_reembolso   numeric(10,2);
BEGIN
  SELECT users.id, users.role INTO v_caller_id, v_caller_role FROM users WHERE auth_id = auth.uid();
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;
  IF v_caller_role NOT IN ('cancha_admin','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'reserva_not_found'); END IF;

  IF v_caller_role = 'cancha_admin' THEN
    SELECT owner_id INTO v_owner FROM canchas WHERE canchas.id = v_reserva.cancha_id;
    IF v_owner IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'forbidden: no eres dueño de esta cancha' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_reserva.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'idempotent', true); END IF;
  IF v_reserva.status NOT IN ('pending','approved') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status:' || v_reserva.status);
  END IF;

  v_reembolso := COALESCE(v_reserva.deposito_pagado, 0) + COALESCE(v_reserva.saldo_pagado, 0);
  IF v_reembolso > 0 THEN
    SELECT * INTO v_wallet FROM wallets WHERE user_id = v_reserva.gestor_id FOR UPDATE;
    IF FOUND THEN
      UPDATE wallets SET balance = balance + v_reembolso WHERE wallets.id = v_wallet.id;
      INSERT INTO wallet_transactions(id, wallet_id, tipo, monto, descripcion, referencia_externa, status, created_at)
      VALUES (gen_random_uuid(), v_wallet.id, 'reembolso_cancha', v_reembolso,
              'Reembolso: reserva ' || v_reserva.codigo_reserva || ' cancelada por la cancha',
              p_reserva_id::TEXT, 'completed', NOW());
    END IF;
  END IF;

  UPDATE cancha_reservas SET status='cancelled',
    estado_pago = CASE WHEN v_reembolso > 0 THEN 'reembolsado' ELSE estado_pago END,
    cancelada_por='cancha_admin',
    notas = CASE WHEN p_notas IS NOT NULL
                 THEN COALESCE(notas || E'\n', '') || '[Cancha] ' || p_notas
                 ELSE notas END,
    updated_at=NOW()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN jsonb_build_object('ok', true, 'reembolso', v_reembolso);
END;
$$;

-- ── 11. marcar_reserva_pagada_admin: registra cobro en sitio (v3) ──
create or replace function public.marcar_reserva_pagada_admin(p_reserva_id uuid, p_notas text default null)
returns boolean language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_id    uuid;
  v_caller_role  text;
  v_cancha_owner uuid;
  v_reserva      cancha_reservas%ROWTYPE;
  v_saldo        numeric(10,2);
BEGIN
  v_caller_id   := (SELECT u.id FROM users u WHERE u.auth_id = auth.uid());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;

  v_caller_role := (SELECT u.role FROM users u WHERE u.id = v_caller_id);
  IF v_caller_role NOT IN ('cancha_admin','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_reserva FROM cancha_reservas WHERE cancha_reservas.id = p_reserva_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVA_NO_ENCONTRADA'; END IF;

  IF v_caller_role = 'cancha_admin' THEN
    SELECT owner_id INTO v_cancha_owner FROM canchas WHERE canchas.id = v_reserva.cancha_id;
    IF v_cancha_owner <> v_caller_id THEN
      RAISE EXCEPTION 'forbidden: no eres dueño de esta cancha' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_reserva.estado_pago NOT IN ('pendiente','no_requerido','abono_pagado') THEN
    RAISE EXCEPTION 'ESTADO_PAGO_INVALIDO: la reserva ya está en estado %', v_reserva.estado_pago;
  END IF;

  IF v_reserva.status IN ('cancelled','rejected','completed') THEN
    RAISE EXCEPTION 'RESERVA_INACTIVA: no se puede marcar como pagada una reserva en estado %', v_reserva.status;
  END IF;

  -- Lo que falte por cobrar queda registrado como cobrado en sitio
  v_saldo := GREATEST(ROUND(COALESCE(v_reserva.monto_total,0) - COALESCE(v_reserva.deposito_pagado,0) - COALESCE(v_reserva.saldo_pagado,0), 2), 0);

  UPDATE cancha_reservas
  SET
    status          = CASE WHEN status = 'pending' THEN 'approved' ELSE status END,
    aprobada_at     = COALESCE(aprobada_at, now()),
    estado_pago     = 'pagado',
    saldo_pagado    = COALESCE(saldo_pagado,0) + v_saldo,
    expira_en       = NULL,
    canal           = COALESCE(canal, 'presencial'),
    notas           = CASE WHEN p_notas IS NOT NULL
                          THEN COALESCE(notas || E'\n', '') || '[Cancha] ' || p_notas
                          ELSE notas END,
    updated_at      = now()
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN true;
END;
$$;

-- ── 12. get_reservas_del_dia: FIX g.email→g.correo (users no tiene email;
--        la función reventaba al invocarse) + teléfono y saldo para la agenda ──
drop function if exists public.get_reservas_del_dia(date);
create function public.get_reservas_del_dia(p_fecha date default current_date)
returns table(
  reserva_id uuid, codigo_reserva text, cancha_id uuid, cancha_nombre text,
  es_combinada boolean, canchas_base_nombres text[], tarifa_id uuid,
  gestor_id uuid, gestor_nombre text, gestor_email text, gestor_telefono text,
  hora_inicio time, hora_fin time, status text, estado_pago text, canal text,
  monto_total numeric, deposito_requerido numeric, deposito_pagado numeric, saldo_pagado numeric,
  expira_en timestamptz, segundos_hasta_expiracion bigint, cancelada_por text, motivo_rechazo text, notas text
) language plpgsql stable security definer set search_path to 'public' as $$
DECLARE
  v_caller_id   uuid;
  v_caller_role text;
BEGIN
  v_caller_id := (SELECT u.id FROM users u WHERE u.auth_id = auth.uid());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;

  v_caller_role := (SELECT u.role FROM users u WHERE u.id = v_caller_id);
  IF v_caller_role NOT IN ('gestor','cancha_admin','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.codigo_reserva, r.cancha_id,
    c.nombre::text, COALESCE(c.es_combinada, false),
    ARRAY(
      SELECT cb_cancha.nombre::text FROM cancha_bases cb
      JOIN canchas cb_cancha ON cb_cancha.id = cb.cancha_base_id
      WHERE cb.cancha_combinada_id = r.cancha_id
      ORDER BY cb_cancha.nombre
    ),
    r.tarifa_id, r.gestor_id,
    CASE WHEN v_caller_role IN ('cancha_admin','admin') OR r.gestor_id = v_caller_id
         THEN g.nombre::text ELSE NULL END,
    CASE WHEN v_caller_role IN ('cancha_admin','admin') OR r.gestor_id = v_caller_id
         THEN g.correo::text ELSE NULL END,
    CASE WHEN v_caller_role IN ('cancha_admin','admin') OR r.gestor_id = v_caller_id
         THEN g.telefono::text ELSE NULL END,
    r.hora_inicio, r.hora_fin, r.status, r.estado_pago,
    COALESCE(r.canal, 'app'),
    r.monto_total, r.deposito_requerido, r.deposito_pagado, r.saldo_pagado,
    r.expira_en,
    CASE WHEN r.expira_en IS NOT NULL AND r.expira_en > now()
         THEN EXTRACT(EPOCH FROM (r.expira_en - now()))::bigint
         ELSE NULL END,
    r.cancelada_por, r.motivo_rechazo, r.notas
  FROM cancha_reservas r
  JOIN canchas c ON c.id = r.cancha_id
  JOIN users g   ON g.id = r.gestor_id
  WHERE r.fecha = p_fecha
    AND (
      (v_caller_role = 'cancha_admin' AND c.owner_id = v_caller_id)
      OR (v_caller_role = 'gestor'    AND r.gestor_id = v_caller_id)
      OR (v_caller_role = 'admin')
    )
  ORDER BY r.hora_inicio, c.nombre;
END;
$$;

-- ── 13. NUEVO marcar_reserva_liquidada: registro de transferencia a la cancha ──
create or replace function public.marcar_reserva_liquidada(p_reserva_id uuid, p_desmarcar boolean default false)
returns boolean language plpgsql security definer set search_path to 'public' as $$
DECLARE
  v_caller_role text;
BEGIN
  v_caller_role := (SELECT u.role FROM users u WHERE u.auth_id = auth.uid());
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  UPDATE cancha_reservas
  SET liquidada = NOT p_desmarcar,
      liquidada_at = CASE WHEN p_desmarcar THEN NULL ELSE now() END
  WHERE cancha_reservas.id = p_reserva_id;

  RETURN FOUND;
END;
$$;

-- ── Grants: caller-check interno; revocar anon/PUBLIC explícito
--    (REVOKE FROM PUBLIC no remueve grants a anon — revocar por rol) ──
revoke execute on function public.aprobar_cancha_reserva(uuid) from public, anon;
grant  execute on function public.aprobar_cancha_reserva(uuid) to authenticated, service_role;

revoke execute on function public.rechazar_cancha_reserva(uuid, text) from public, anon;
grant  execute on function public.rechazar_cancha_reserva(uuid, text) to authenticated, service_role;

revoke execute on function public.pagar_saldo_cancha_wallet(uuid) from public, anon;
grant  execute on function public.pagar_saldo_cancha_wallet(uuid) to authenticated, service_role;

revoke execute on function public.confirmar_saldo_cancha_yappy(uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
grant  execute on function public.confirmar_saldo_cancha_yappy(uuid, uuid, numeric, numeric, text) to service_role;

revoke execute on function public.marcar_reserva_liquidada(uuid, boolean) from public, anon;
grant  execute on function public.marcar_reserva_liquidada(uuid, boolean) to authenticated, service_role;

revoke execute on function public.get_reservas_del_dia(date) from public, anon;
grant  execute on function public.get_reservas_del_dia(date) to authenticated, service_role;
