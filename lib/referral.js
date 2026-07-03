// Referidos de Panamá Birreas — dos módulos:
//   1) WC (Mundial 2026): captura ?ref=CODE de la URL para la inscripción con descuento.
//   2) Eventos (birreas): código de invitación entre jugadores, $1 para ambos.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Share, Alert } from 'react-native';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// 1) MUNDIAL 2026 — captura ?ref= de la URL
// ─────────────────────────────────────────────────────────────────────────────

const PENDING_WC_REF_KEY   = 'b2p:pending_ref';
const PENDING_EVT_REF_KEY  = 'b2p:pending_event_ref';

// Captura el ?ref= query param en web y lo persiste para pre-cargar en la inscripción WC.
export async function captureRefFromUrl() {
  try {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const ref = params.get('ref');
    if (ref && ref.trim()) {
      await AsyncStorage.setItem(PENDING_WC_REF_KEY, ref.trim().toUpperCase());
    }
  } catch (_) { /* noop */ }
}

export async function getPendingRef() {
  try { return await AsyncStorage.getItem(PENDING_WC_REF_KEY); } catch (_) { return null; }
}

export async function clearPendingRef() {
  try { await AsyncStorage.removeItem(PENDING_WC_REF_KEY); } catch (_) { /* noop */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) EVENTOS — sistema de referidos para birreas
// ─────────────────────────────────────────────────────────────────────────────

// Guarda el código ingresado en el registro para aplicarlo después del login.
export async function savePendingEventRefCode(code) {
  try {
    if (code && code.trim()) {
      await AsyncStorage.setItem(PENDING_EVT_REF_KEY, code.trim().toUpperCase());
    }
  } catch (_) { /* noop */ }
}

export async function getPendingEventRefCode() {
  try { return await AsyncStorage.getItem(PENDING_EVT_REF_KEY); } catch (_) { return null; }
}

export async function clearPendingEventRefCode() {
  try { await AsyncStorage.removeItem(PENDING_EVT_REF_KEY); } catch (_) { /* noop */ }
}

// Aplica el código vía RPC. Retorna { ok, referrer } o { ok:false, error }.
export async function applyReferralCode(code) {
  try {
    const { data, error } = await supabase.rpc('apply_referral_code', { p_code: code });
    if (error) return { ok: false, error: error.message };
    return { ok: true, referrer: data?.referrer ?? null };
  } catch (e) {
    return { ok: false, error: e?.message ?? 'Error desconocido' };
  }
}

// Estado del programa para la tarjeta "Invita y Gana" en el perfil.
// Retorna { code, invited_by, referrals_total, referrals_this_month,
//           earned_total, monthly_cap, cap_remaining } o null en error.
export async function getReferralStatus() {
  try {
    const { data, error } = await supabase.rpc('get_referral_status');
    if (error) return null;
    return data;
  } catch (_) { return null; }
}

// Comparte la invitación a jugar birreas con el código personal.
export async function shareEventReferral({ code }) {
  const message = [
    '⚽ Estoy jugando en Panamá Birreas / Birrea2Play.',
    '',
    `Registrate con mi código *${code}* y los dos ganamos $1 en créditos para pagar birrias.`,
    '',
    '👉 birrea2play.com',
  ].join('\n');

  const url   = 'https://birrea2play.com';
  const title = 'Panamá Birreas — Invitación';

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text: message, url });
      return { ok: true, method: 'web-share' };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, method: 'cancelled' };
    }
  }

  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message, url, title });
      return { ok: true, method: 'native-share' };
    } catch (_) { /* noop */ }
  }

  // Fallback: copiar al portapapeles (web)
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(message);
      Alert.alert('Copiado', 'Pegá la invitación en WhatsApp o donde quieras.');
      return { ok: true, method: 'clipboard' };
    } catch (_) { /* noop */ }
  }

  Alert.alert('Invitación', message);
  return { ok: false, method: 'alert' };
}
