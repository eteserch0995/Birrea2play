-- ============================================================
-- 2026-05-30 — Tarjeta (Pagueló Fácil) para inscripción Mundial
-- ============================================================
-- Permite pagar la inscripción al Mundial con tarjeta vía Pagueló Fácil.
-- El cargo a la tarjeta = precio del modo + $1.50 (comisión de la plataforma de cobro).
-- El +$1.50 NO entra al pozo: solo cubre el fee de la pasarela. La inscripción se
-- marca pagada al precio del pozo (el pozo se computa por conteo x precio en finalize).
--
-- Flujo: MundialEnrollScreen -> iniciarPagoTarjeta(tipo='wc_enrollment', wc_enrollment_id)
--   -> pf-create-link (guarda wc_enrollment_id en pf_pending_payments) -> checkout PF
--   -> pf-webhook (al aprobar, si tipo='wc_enrollment' llama wc_pay_enrollment_card).
-- Aplicada a prod via apply_migration (name=wc_card_payment_paguelofacil).
-- ------------------------------------------------------------

alter table public.pf_pending_payments
  add column if not exists wc_enrollment_id uuid references public.wc_enrollments(id) on delete set null;

create or replace function public.wc_pay_enrollment_card(
  p_user_id uuid, p_enrollment_id uuid, p_amount numeric, p_pf_order_id text
) returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_enrollment public.wc_enrollments%rowtype;
  v_pool       public.wc_pools%rowtype;
  v_price      numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'unauthorized: only service_role'; end if;
  select * into v_enrollment from public.wc_enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Inscripcion no encontrada'; end if;
  if v_enrollment.user_id <> p_user_id then raise exception 'user_id mismatch'; end if;
  if v_enrollment.payment_status = 'paid' then return; end if;  -- idempotente
  select * into v_pool from public.wc_pools where season = 'fifa_wc_2026';
  v_price := case when v_enrollment.mode = 'survivor' then v_pool.survivor_price else v_pool.polla_price end;
  if p_amount < v_price then raise exception 'Monto tarjeta menor al precio (% < %)', p_amount, v_price; end if;
  update public.wc_enrollments
    set payment_status='paid', payment_method='card', payment_ref=p_pf_order_id,
        paid_amount=p_amount, paid_at=now()
    where id = p_enrollment_id;
end; $$;

revoke execute on function public.wc_pay_enrollment_card(uuid,uuid,numeric,text) from public, anon;
grant  execute on function public.wc_pay_enrollment_card(uuid,uuid,numeric,text) to service_role;
