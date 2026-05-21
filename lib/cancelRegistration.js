import { supabase } from './supabase';
import { getRefundStatus } from './eventHelpers';
import { logWarn } from './logger';

/**
 * Cancel a player's event registration, cancel all their guests for the same
 * event, and issue a wallet refund if the event starts in 48+ hours.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.eventId
 * @param {string} opts.eventFecha  - 'YYYY-MM-DD'
 * @param {string} opts.eventHora   - 'HH:MM:SS'
 * @param {number} opts.monto       - amount paid (for refund eligibility)
 * @param {string} opts.registrationId
 * @param {string} opts.metodoPago  - 'wallet' | 'yappy_boton' | 'efectivo' | etc.
 * @returns {{ refunded: boolean, amount: number, guestsCancelled: number }}
 */
export async function cancelRegistration({
  userId, eventId, eventFecha, eventHora, monto, registrationId, metodoPago,
  cancelGuests = false,
}) {
  const { canRefund } = getRefundStatus(eventFecha, eventHora);

  // 1. Mark registration cancelled — do this FIRST so it always succeeds
  //    even if the user has no wallet row (e.g. paid cash, no wallet created).
  const { error: regErr } = await supabase
    .from('event_registrations')
    .update({ status: 'cancelled' })
    .eq('id', registrationId);
  if (regErr) throw regErr;

  // 2. Optionally cancel all guests invited by this user for this event
  let guestsCancelled = 0;
  let guestsCancelFailed = false;
  if (cancelGuests) {
    try {
      const { data: cancelledCount } = await supabase.rpc('cancel_guests_for_registration', {
        p_user_id:  userId,
        p_event_id: eventId,
      });
      guestsCancelled = cancelledCount ?? 0;
    } catch (e) {
      logWarn({ screen: 'cancelRegistration', action: 'cancelGuests.rpc', userId, eventId, technical: e });
      try {
        const { data: guests, error: guestsErr } = await supabase
          .from('event_guests')
          .select('id')
          .eq('event_id', eventId)
          .eq('invited_by', userId)
          .in('status', ['confirmed', 'pending_payment']);
        if (guestsErr) throw guestsErr;
        const guestIds = (guests ?? []).map((g) => g.id).filter(Boolean);
        if (guestIds.length > 0) {
          const { error: tpErr } = await supabase
            .from('team_players')
            .delete()
            .in('guest_id', guestIds);
          if (tpErr) throw tpErr;

          const { error: guestsUpdateErr, count } = await supabase
            .from('event_guests')
            .update({ status: 'cancelled' })
            .in('id', guestIds)
            .select('id', { count: 'exact', head: true });
          if (guestsUpdateErr) throw guestsUpdateErr;
          guestsCancelled = count ?? guestIds.length;
        }
      } catch (fallbackErr) {
        guestsCancelFailed = true;
        logWarn({ screen: 'cancelRegistration', action: 'cancelGuests.fallback', userId, eventId, technical: fallbackErr });
      }
    }
  }

  // 3. Refund if eligible, amount > 0, and was paid via wallet
  //    (Yappy and cash payments are not auto-refunded — handled by admin)
  const refundable = metodoPago === 'wallet';
  if (canRefund && monto > 0 && refundable) {
    // Use atomic RPC (balance = balance + monto) to avoid lost-update race condition.
    try {
      await supabase.rpc('credit_wallet', {
        p_user_id:     userId,
        p_monto:       monto,
        p_tipo:        'reembolso',
        p_descripcion: 'Reembolso: cancelación de inscripción',
      });
      return { refunded: true, amount: monto, guestsCancelled, guestsCancelFailed, penaltyApplied: false };
    } catch (e) {
      // Wallet doesn't exist or RPC failed — cancellation already saved, skip refund.
      console.warn('cancelRegistration: refund failed —', e.message);
      return { refunded: false, amount: 0, guestsCancelled, guestsCancelFailed, penaltyApplied: false };
    }
  }

  // 4. Late-cancellation penalty for cash payments (within 48h window)
  //    Block the user from paying with cash in future events.
  const isCashLate = !canRefund && (metodoPago === 'efectivo' || metodoPago === 'pending');
  if (isCashLate) {
    try {
      await supabase.rpc('apply_efectivo_penalty', { p_user_id: userId });
    } catch (e) {
      console.warn('cancelRegistration: penalty apply failed —', e.message);
    }
    return { refunded: false, amount: 0, guestsCancelled, guestsCancelFailed, penaltyApplied: true };
  }

  return { refunded: false, amount: 0, guestsCancelled, guestsCancelFailed, penaltyApplied: false };
}
