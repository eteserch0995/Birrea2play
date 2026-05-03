-- 20260503000003 — Cascade delete para eventos
-- mvp_results queda con event_id = NULL (preserva historial de jugadores)
-- Todo lo demás se borra en cascada cuando se elimina un evento

-- event_registrations
ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_event_id_fkey,
  ADD CONSTRAINT event_registrations_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- event_guests
ALTER TABLE public.event_guests
  DROP CONSTRAINT IF EXISTS event_guests_event_id_fkey,
  ADD CONSTRAINT event_guests_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- teams
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_event_id_fkey,
  ADD CONSTRAINT teams_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- matches
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_event_id_fkey,
  ADD CONSTRAINT matches_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- mvp_votes
ALTER TABLE public.mvp_votes
  DROP CONSTRAINT IF EXISTS mvp_votes_event_id_fkey,
  ADD CONSTRAINT mvp_votes_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- mvp_results → SET NULL para conservar el historial en tarjetas de jugador
ALTER TABLE public.mvp_results
  DROP CONSTRAINT IF EXISTS mvp_results_event_id_fkey,
  ADD CONSTRAINT mvp_results_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;

-- cash_payment_requests
ALTER TABLE public.cash_payment_requests
  DROP CONSTRAINT IF EXISTS cash_payment_requests_event_id_fkey,
  ADD CONSTRAINT cash_payment_requests_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- yappy_orders
ALTER TABLE public.yappy_orders
  DROP CONSTRAINT IF EXISTS yappy_orders_event_id_fkey,
  ADD CONSTRAINT yappy_orders_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
