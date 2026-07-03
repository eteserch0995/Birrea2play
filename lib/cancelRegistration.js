import { supabase } from './supabase';
import { logWarn } from './logger';

/**
 * Cancela la inscripción de un jugador a un evento. TODA la lógica de dinero
 * (monto realmente pagado, ventana de 48h en hora de Panamá, % de devolución,
 * acreditación al wallet, penalización, cancelación de invitados) ocurre
 * SERVER-SIDE en el RPC atómico `cancel_event_registration` — el cliente ya
 * no calcula ni pasa montos (cierra: refund manipulable, doble-refund por
 * doble-tap, zona horaria incorrecta del límite de 48h).
 *
 * @param {object} opts
 * @param {string} opts.registrationId
 * @param {boolean} opts.cancelGuests
 * @returns {{ refunded: boolean, amount: number, pct: number, alreadyCancelled: boolean,
 *             guestsCancelled: number, penaltyApplied: boolean, refundFailed?: boolean }}
 */
export async function cancelRegistration({ registrationId, cancelGuests = false }) {
  const { data, error } = await supabase.rpc('cancel_event_registration', {
    p_registration_id: registrationId,
    p_cancel_guests:   cancelGuests,
  });
  if (error) {
    logWarn({ screen: 'cancelRegistration', action: 'rpc', technical: error });
    throw new Error(error.message ?? 'No se pudo cancelar la inscripción.');
  }
  return {
    refunded:        !!data?.refunded,
    amount:          data?.amount ?? 0,
    pct:             data?.pct ?? 0,
    alreadyCancelled: !!data?.alreadyCancelled,
    guestsCancelled: data?.guestsCancelled ?? 0,
    guestsCancelFailed: false,
    penaltyApplied:  !!data?.penaltyApplied,
  };
}
