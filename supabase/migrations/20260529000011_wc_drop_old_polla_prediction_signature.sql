-- Fix: PostgreSQL no puede decidir entre 2 versiones de wc_submit_polla_prediction.
-- Dropear la versión vieja (4 params, sin p_pred_winner_team_id).
-- La versión nueva (5 params) se mantiene desde la migración wc_bracket_pre_mundial.
drop function if exists public.wc_submit_polla_prediction(uuid, uuid, integer, integer);
