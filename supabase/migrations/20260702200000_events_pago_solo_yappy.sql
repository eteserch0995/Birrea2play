-- Eventos que solo aceptan Yappy como metodo de inscripcion (ocultan wallet/mixto/efectivo).
-- Aditiva: default false = comportamiento identico en todos los eventos existentes.
-- Aplicada a prod via MCP apply_migration el 2026-07-02 (After Birrea 2.0).
alter table public.events add column if not exists pago_solo_yappy boolean not null default false;
comment on column public.events.pago_solo_yappy is 'true = la inscripcion solo ofrece Yappy (oculta creditos, mixto y efectivo). Gating de UI en EventDetailScreen + PaymentModal (prop showWallet/showEfectivo). Agregado 2026-07-02 para After Birrea 2.0.';
