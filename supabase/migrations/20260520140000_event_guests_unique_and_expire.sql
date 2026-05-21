-- 1) UNIQUE parcial: bloquea que el mismo user invite dos veces a la misma
--    persona en el mismo evento. Excluye cancelled para permitir reinvitar.
--    invited_by IS NOT NULL para no bloquear los guests que crea el gestor/admin
--    manualmente sin user que invita.
CREATE UNIQUE INDEX IF NOT EXISTS event_guests_unique_active
  ON public.event_guests (event_id, lower(trim(nombre)), invited_by)
  WHERE status <> 'cancelled' AND invited_by IS NOT NULL;

-- 2) RPC para expirar guests pending_payment huerfanos.
--    Yappy: 15 minutos sin confirmar -> cancelled.
--    Efectivo: 24 horas sin que el gestor confirme -> cancelled.
CREATE OR REPLACE FUNCTION public.expire_pending_guests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.event_guests
  SET status = 'cancelled'
  WHERE status = 'pending_payment'
    AND (
      (metodo_pago = 'yappy_boton' AND created_at < now() - interval '15 minutes')
      OR (metodo_pago = 'efectivo'   AND created_at < now() - interval '24 hours')
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_pending_guests() TO anon, authenticated;
