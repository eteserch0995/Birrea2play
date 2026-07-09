-- ============================================================
-- 2026-07-04 — Canchas v3 (5/5): grilla de disponibilidad en minutos
-- Aplicada a prod vía MCP como `canchas_v3_disponibilidad_minutos`.
-- get_available_slots(p_duracion_horas int) no soporta 1.5h.
-- Esta versión recibe minutos y respeta permite_media_hora_extra:
-- devuelve cada inicio posible del día con su disponibilidad real.
-- ============================================================

create or replace function public.get_disponibilidad_slots(
  p_cancha_id uuid,
  p_fecha date,
  p_duracion_min integer default 60
) returns table(
  hora_inicio time,
  hora_fin time,
  disponible boolean,
  motivo text
) language plpgsql stable security definer set search_path to 'public' as $$
DECLARE
  v_caller_id uuid;
  v_cancha    canchas%ROWTYPE;
  v_horario   cancha_horarios%ROWTYPE;
  v_dow       int;
  v_paso_min  int;
  v_ini       time;
  v_fin       time;
  v_extra_ok  boolean;
BEGIN
  v_caller_id := (SELECT u.id FROM users u WHERE u.auth_id = auth.uid());
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_cancha FROM canchas WHERE canchas.id = p_cancha_id AND activa = true;
  IF NOT FOUND THEN RETURN; END IF;

  v_extra_ok := COALESCE(v_cancha.permite_media_hora_extra, false);

  -- Validar duración pedida con las mismas reglas de crear_cancha_reserva
  IF p_duracion_min < 60
     OR (p_duracion_min % 60 <> 0 AND NOT (v_extra_ok AND p_duracion_min % 30 = 0))
     OR (v_cancha.duracion_min_minutos IS NOT NULL AND p_duracion_min < v_cancha.duracion_min_minutos)
     OR (v_cancha.duracion_max_minutos IS NOT NULL AND p_duracion_min > v_cancha.duracion_max_minutos) THEN
    RETURN;
  END IF;

  v_dow := EXTRACT(DOW FROM p_fecha)::int;
  SELECT * INTO v_horario FROM cancha_horarios
   WHERE cancha_horarios.cancha_id = p_cancha_id AND dia_semana = v_dow AND activo = true
   ORDER BY tarifa_id NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  -- Paso de la grilla: 30 min si la cancha permite +30 o el horario acepta inicios :30
  v_paso_min := CASE WHEN v_extra_ok OR COALESCE(v_horario.medias_horas, false) THEN 30 ELSE 60 END;

  v_ini := v_horario.hora_apertura;
  LOOP
    v_fin := v_ini + make_interval(mins => p_duracion_min);
    EXIT WHEN v_fin > v_horario.hora_cierre OR v_fin <= v_ini; -- <= cubre wrap de medianoche

    hora_inicio := v_ini;
    hora_fin    := v_fin;
    IF p_fecha < CURRENT_DATE
       OR (p_fecha = CURRENT_DATE AND v_ini <= (NOW() AT TIME ZONE 'America/Panama')::time) THEN
      disponible := false;
      motivo     := 'pasado';
    ELSIF cancha_slot_disponible(p_cancha_id, p_fecha, v_ini, v_fin) THEN
      disponible := true;
      motivo     := NULL;
    ELSE
      disponible := false;
      motivo     := 'ocupado';
    END IF;
    RETURN NEXT;

    v_ini := v_ini + make_interval(mins => v_paso_min);
  END LOOP;
END;
$$;

revoke execute on function public.get_disponibilidad_slots(uuid, date, integer) from public, anon;
grant  execute on function public.get_disponibilidad_slots(uuid, date, integer) to authenticated, service_role;
