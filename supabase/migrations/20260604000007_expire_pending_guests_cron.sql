-- #11 (auditoría 2026-06-04): expire_pending_guests no tenía cron — los
-- invitados pending_payment vencidos (15 min Yappy / 24h efectivo) solo se
-- limpiaban de forma oportunista cuando alguien abría EventDetailScreen,
-- dejando cupos ocupados indefinidamente si nadie visitaba el evento.
-- Cron cada 30 min (la cancelación dispara promoción de lista de espera).
select cron.schedule('expire-pending-guests', '*/30 * * * *', $$select public.expire_pending_guests()$$);
