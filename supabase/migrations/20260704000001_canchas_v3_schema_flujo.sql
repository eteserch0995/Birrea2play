-- ============================================================
-- 2026-07-04 — Canchas v3 (1/5): schema del flujo de aprobación
-- Aplicada a prod vía MCP como `canchas_v3_schema_flujo`.
-- Visión: abono → aprobación de la cancha → saldo por la app.
-- ============================================================

-- (1) Toggle de la cancha: permitir reservas de hora y media (1h base + 30 min extra)
alter table public.canchas
  add column if not exists permite_media_hora_extra boolean not null default false;

comment on column public.canchas.permite_media_hora_extra is
  'Si true, el gestor puede reservar duraciones de hora + 30 min (ej. 1.5h). El precio sigue siendo por hora (prorrateado). Decisión Sergio 2026-07-04: nunca bloques de 30 min.';

-- (2) cancha_reservas: saldo restante, rechazo y liquidación a la cancha
alter table public.cancha_reservas
  add column if not exists saldo_pagado         numeric(10,2) not null default 0,
  add column if not exists yappy_saldo_order_id text,
  add column if not exists motivo_rechazo       text,
  add column if not exists aprobada_at          timestamptz,
  add column if not exists liquidada            boolean not null default false,
  add column if not exists liquidada_at         timestamptz;

comment on column public.cancha_reservas.liquidada is
  'true cuando el admin ya transfirió a la cancha (por Yappy, fuera de la app) lo recaudado de esta reserva. La plataforma recauda abono+saldo y liquida después.';

-- (3) estado_pago: nuevo estado intermedio abono_pagado
--     (pagar el abono YA NO aprueba: queda esperando aprobación de la cancha)
alter table public.cancha_reservas drop constraint if exists cancha_reservas_estado_pago_check;
alter table public.cancha_reservas add constraint cancha_reservas_estado_pago_check
  check (estado_pago = any (array[
    'no_requerido'::text, 'pendiente'::text, 'abono_pagado'::text,
    'pagado'::text, 'fallido'::text, 'expirado'::text, 'reembolsado'::text
  ]));

-- (4) wallet_transactions: FIX — cancelar_cancha_reserva_usuario inserta
--     'reembolso_cancha' pero el CHECK no lo incluía → toda cancelación con
--     reembolso reventaba. Se agrega al catálogo.
alter table public.wallet_transactions drop constraint if exists wallet_transactions_tipo_check;
alter table public.wallet_transactions add constraint wallet_transactions_tipo_check
  check ((tipo)::text = any ((array[
    'recarga_yappy'::varchar, 'recarga_tarjeta'::varchar, 'inscripcion'::varchar,
    'compra_tienda'::varchar, 'mvp_premio'::varchar, 'ajuste_admin'::varchar,
    'plan_mensual'::varchar, 'reembolso'::varchar, 'bono_referido'::varchar,
    'premio_polla'::varchar, 'bono_pwa'::varchar, 'pago_cancha'::varchar,
    'cobro_cancha'::varchar, 'reembolso_cancha'::varchar
  ])::text[]));

-- (5) yappy_orders: nuevo tipo saldo_cancha (segundo pago, día de la reserva)
alter table public.yappy_orders drop constraint if exists yappy_orders_tipo_check;
alter table public.yappy_orders add constraint yappy_orders_tipo_check
  check (tipo = any (array[
    'recarga'::text, 'evento'::text, 'invitado'::text, 'compra_tienda'::text,
    'wc_enrollment'::text, 'donacion'::text, 'abono_cancha'::text, 'rifa'::text,
    'saldo_cancha'::text
  ]));
