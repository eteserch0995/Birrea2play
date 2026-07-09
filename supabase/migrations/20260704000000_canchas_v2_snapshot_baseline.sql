-- ============================================================
-- 2026-07-04 — SNAPSHOT BASELINE del módulo canchas v2 (22-24 jun)
-- ⚠️ DOCUMENTACIÓN / RECUPERACIÓN — NO aplicar sobre prod (todo esto YA existe).
--
-- Contexto: el módulo de reservas v2 se construyó en prod entre el 22 y el
-- 24 de junio 2026 en ~27 migraciones aplicadas vía MCP que NUNCA se
-- espejaron a este repo (drift detectado en la revisión del 2026-07-04:
-- cancha_recreate_and_mejoras_v2 ... v8_marcar_reserva_pagada_admin).
-- Este archivo captura el estado de las TABLAS (DDL generado del catálogo
-- de prod el 2026-07-04, ya incluye columnas v3), constraints clave, RLS
-- y las funciones núcleo. Las migraciones 20260704000001..5 (canchas_v3_*)
-- contienen las definiciones actuales de los RPCs del flujo.
--
-- Pendiente de gobernanza: `supabase db pull` con el CLI logueado de Sergio
-- exportaría el historial completo (backlog #8 del proyecto).
-- ============================================================

-- ── TABLAS (estado prod 2026-07-04) ──────────────────────────

create table if not exists public.canchas (
  id uuid not null default uuid_generate_v4() primary key,
  owner_id uuid not null references public.users(id),
  nombre text not null,
  direccion text,
  distrito text,
  telefono text,
  precio_hora numeric(10,2),
  foto_url text,
  maps_url text,
  notas text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  requiere_deposito boolean not null default false,
  porcentaje_deposito integer not null default 50,
  duracion_min_minutos integer default 60,
  duracion_max_minutos integer default 120,
  abono_tipo text default 'porcentaje', -- CHECK: ninguno|fijo|porcentaje|total
  abono_monto_fijo numeric(10,2) default null,
  hold_minutos integer default 15,
  es_combinada boolean not null default false,
  permite_media_hora_extra boolean not null default false -- v3 (20260704000001)
);

create table if not exists public.cancha_horarios (
  id uuid not null default uuid_generate_v4() primary key,
  cancha_id uuid not null references public.canchas(id) on delete cascade,
  tarifa_id uuid, -- null = horario general de la cancha
  dia_semana smallint not null, -- 0=domingo .. 6=sábado
  hora_apertura time not null,
  hora_cierre time not null,
  duracion_slot_min integer not null default 60, -- CHECK IN (30,60,90,120)
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  horario_libre boolean default false,
  medias_horas boolean not null default false,
  unique (cancha_id, tarifa_id, dia_semana)
);

create table if not exists public.cancha_tarifas (
  id uuid not null default gen_random_uuid() primary key,
  cancha text default '', -- legacy texto libre (usado por CanchaCostoPicker/costo por evento)
  deporte text not null,
  formato_jpe integer not null, -- jugadores por equipo, CHECK > 0
  precio_hora numeric(10,2) not null, -- CHECK >= 0 · SIEMPRE por hora
  activo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  cancha_id uuid references public.canchas(id) on delete cascade, -- null = catálogo de referencia
  descripcion text,
  bloquea_tarifas uuid[] not null default '{}'
);

create table if not exists public.cancha_reservas (
  id uuid not null default uuid_generate_v4() primary key,
  cancha_id uuid not null references public.canchas(id) on delete cascade,
  tarifa_id uuid references public.cancha_tarifas(id),
  gestor_id uuid not null references public.users(id),
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  status text not null default 'pending',        -- CHECK: pending|approved|rejected|cancelled|completed
  monto_total numeric(10,2),
  deposito_pagado numeric(10,2) not null default 0,
  notas text,
  created_at timestamptz not null default now(),
  yappy_order_id text,
  deposito_fee numeric default 0,
  deposito_yappy_pagado boolean default false,
  codigo_reserva text unique,                    -- CR-XXXXXX (generar_codigo_reserva)
  estado_pago text default 'no_requerido',       -- CHECK: no_requerido|pendiente|abono_pagado|pagado|fallido|expirado|reembolsado
  expira_en timestamptz,                         -- hold del abono (15 min default)
  cancelada_por text,                            -- CHECK: gestor|cancha_admin|sistema
  deposito_requerido numeric(10,2),
  updated_at timestamptz default now(),
  intentos_pago smallint not null default 0,
  tarjeta_token text,
  canal text default 'app',                      -- CHECK: app|whatsapp|llamada|presencial|interno
  saldo_pagado numeric(10,2) not null default 0, -- v3
  yappy_saldo_order_id text,                     -- v3
  motivo_rechazo text,                           -- v3
  aprobada_at timestamptz,                       -- v3
  liquidada boolean not null default false,      -- v3
  liquidada_at timestamptz                       -- v3
);

-- Anti doble-reserva A NIVEL DE MOTOR (clave del módulo):
-- EXCLUDE USING gist (cancha_id WITH =, tsrange(fecha+hora_inicio, fecha+hora_fin, '[)') WITH &&)
--   WHERE (status NOT IN ('cancelled','rejected','completed'))
-- Nombre en prod: no_overlapping_reservas (requiere extensión btree_gist).

create table if not exists public.cancha_bloqueos_externos (
  id uuid not null default gen_random_uuid() primary key,
  cancha_id uuid not null references public.canchas(id) on delete cascade,
  recurrencia_id uuid, -- → cancha_recurrencias (null = bloqueo puntual)
  fecha date,
  hora_inicio time not null,
  hora_fin time not null,
  cliente_nombre text not null,
  cliente_telefono text,
  cliente_correo text,
  fuente_canal text default 'otro',
  monto_acordado numeric(10,2),
  estado_pago_ext text default 'pendiente',
  nota_interna text,
  activo boolean default true,
  creado_por uuid,
  created_at timestamptz default now()
);

create table if not exists public.cancha_recurrencias (
  id uuid not null default gen_random_uuid() primary key,
  cancha_id uuid not null references public.canchas(id) on delete cascade,
  frecuencia text not null, -- semanal|mensual|trimestral
  dias_semana integer[],
  dia_mes integer,
  semana_del_mes integer,
  hora_inicio time not null,
  hora_fin time not null,
  fecha_inicio date not null,
  fecha_fin date,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.cancha_bases (
  id uuid not null default uuid_generate_v4() primary key,
  cancha_combinada_id uuid not null references public.canchas(id) on delete cascade,
  cancha_base_id uuid not null references public.canchas(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ── RLS (estado prod 2026-07-04, post canchas_v3_seguridad) ──
-- canchas:            SELECT activas o propias · INSERT/UPDATE/DELETE owner (cancha_admin/admin)
-- cancha_horarios:    SELECT activo=true u owner · ALL owner/admin
-- cancha_tarifas:     SELECT activo=true · ALL owner/admin
-- cancha_bloqueos:    SELECT authenticated · ALL owner
-- cancha_recurrencias:SELECT authenticated · ALL owner
-- cancha_bases:       SELECT authenticated · ALL owner de la combinada
-- cancha_reservas:    SELECT gestor propio / owner de la cancha / admin
--                     INSERT: ❌ ninguna policy (solo vía RPC crear_cancha_reserva)
--                     UPDATE: solo role admin (reservas_update_admin_only) — todo lo demás vía RPC

-- ── FUNCIONES núcleo v2 que NO están en otra migración del repo ──
-- (definiciones vivas en prod; las del flujo v3 están en 20260704000002)
--   cancha_slot_disponible(cancha, fecha, ini, fin, exclude?) → boolean
--     (revisa reservas activas + combinadas/bases + bloqueos puntuales y recurrentes)
--   generar_codigo_reserva() → 'CR-XXXXXX' único
--   expirar_reservas_cancha_vencidas() → cancela pending/pendiente con hold vencido (cron cancha-expiry */5 min)
--   completar_reservas_pasadas() → approved→completed pasada la hora (cron completar-reservas-pasadas :30)
--   crear_bloqueo_externo(...) → TABLE(id, tiene_conflictos, conflictos_detalle[]) (owner/admin; advierte conflictos)
--   eliminar_bloqueo_externo(bloqueo) → boolean (soft delete)
--   preview_bloqueo_recurrente(...) → TABLE(fecha, ini, fin, disponible, conflicto_tipo)
--   get_bloqueos_del_dia(fecha) → TABLE(...) (owner/admin)
--   buscar_reserva_por_codigo(codigo) → TABLE(... puede_aprobar, puede_marcar_pagada, puede_cancelar, es_mi_cancha)
--   get_admin_summary(fecha) → TABLE(totales del día)
--   get_available_slots(cancha, fecha, duracion_horas int) → TABLE(...) (legacy horas enteras; usar get_disponibilidad_slots)
--   get_canchas_con_bases() → TABLE(cancha + tarifas jsonb + bases jsonb)
--
-- Crons activos del módulo: cancha-expiry (*/5 min), completar-reservas-pasadas (:30 de cada hora).
-- cancha-24h-check fue DESAGENDADO el 2026-07-04 (modelo legacy v1).
