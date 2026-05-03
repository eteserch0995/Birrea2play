-- 20260503000002 — Yappy event payments + inscribir_con_wallet RPC + registration RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Distinguish wallet-recharge orders from event-inscription orders
ALTER TABLE public.yappy_orders
  ADD COLUMN IF NOT EXISTS tipo     text DEFAULT 'recarga'
    CHECK (tipo IN ('recarga', 'evento')),
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

-- 2. Users can INSERT their own confirmed registrations (needed for wallet-pay fallback)
DROP POLICY IF EXISTS "Users insert own registrations" ON public.event_registrations;
CREATE POLICY "Users insert own registrations" ON public.event_registrations FOR INSERT
  WITH CHECK (
    user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1)
  );

-- Gestors/admins can insert any registration (cash-payment approval)
DROP POLICY IF EXISTS "Gestor inserts registrations" ON public.event_registrations;
CREATE POLICY "Gestor inserts registrations" ON public.event_registrations FOR INSERT
  WITH CHECK (
    (SELECT role FROM public.users WHERE auth_id = auth.uid() LIMIT 1) IN ('gestor','admin')
  );

-- 3. inscribir_con_wallet — atomic: debit wallet + log transaction + create registration
CREATE OR REPLACE FUNCTION public.inscribir_con_wallet(
  p_user_id     uuid,
  p_event_id    uuid,
  p_monto       numeric,
  p_descripcion text DEFAULT 'Inscripción'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_id uuid;
  v_balance   numeric;
BEGIN
  -- Idempotency: already confirmed → do nothing
  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  -- Lock wallet row
  SELECT id, balance INTO v_wallet_id, v_balance
  FROM public.wallets
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet no encontrado para el usuario';
  END IF;

  IF v_balance < p_monto THEN
    RAISE EXCEPTION 'Saldo insuficiente (balance: %, monto: %)', v_balance, p_monto;
  END IF;

  UPDATE public.wallets
  SET balance = v_balance - p_monto
  WHERE id = v_wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, tipo, monto, descripcion)
  VALUES (v_wallet_id, 'inscripcion', -p_monto, p_descripcion);

  INSERT INTO public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  VALUES (p_event_id, p_user_id, 'wallet', p_monto, 'confirmed');
END;
$$;

-- 4. inscribir_yappy_evento — called by IPN for tipo=evento orders (SECURITY DEFINER, no RLS)
CREATE OR REPLACE FUNCTION public.inscribir_yappy_evento(
  p_user_id  uuid,
  p_event_id uuid,
  p_monto    numeric,
  p_order_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotency
  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND user_id = p_user_id AND status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.event_registrations (event_id, user_id, metodo_pago, monto_pagado, status)
  VALUES (p_event_id, p_user_id, 'yappy_boton', p_monto, 'confirmed');
END;
$$;
