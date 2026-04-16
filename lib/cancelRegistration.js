import { supabase } from './supabase';
import { getRefundStatus } from './eventHelpers';

/**
 * Cancel a player's event registration.
 * Issues a wallet refund if the event starts in 48+ hours.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.eventId
 * @param {string} opts.eventFecha  - 'YYYY-MM-DD'
 * @param {string} opts.eventHora   - 'HH:MM:SS'
 * @param {number} opts.monto       - amount paid
 * @param {string} opts.registrationId
 * @returns {{ refunded: boolean, amount: number }}
 */
export async function cancelRegistration({ userId, eventId, eventFecha, eventHora, monto, registrationId }) {
  const { canRefund } = getRefundStatus(eventFecha, eventHora);

  // 1. Mark registration cancelled — do this FIRST so it always succeeds
  //    even if the user has no wallet row (e.g. paid cash, no wallet created).
  const { error: regErr } = await supabase
    .from('event_registrations')
    .update({ status: 'cancelled' })
    .eq('id', registrationId);
  if (regErr) throw regErr;

  // 2. Refund if eligible and there is something to refund
  if (canRefund && monto > 0) {
    // Use atomic RPC (balance = balance + monto) to avoid lost-update race condition.
    // If the user has no wallet row, the RPC will throw — catch gracefully.
    try {
      await supabase.rpc('credit_wallet', {
        p_user_id:     userId,
        p_monto:       monto,
        p_tipo:        'reembolso',
        p_descripcion: 'Reembolso: cancelación de inscripción',
      });
      return { refunded: true, amount: monto };
    } catch (e) {
      // Wallet doesn't exist for this user — cancellation already saved, just skip refund.
      console.warn('cancelRegistration: no wallet for refund —', e.message);
      return { refunded: false, amount: 0 };
    }
  }

  return { refunded: false, amount: 0 };
}
