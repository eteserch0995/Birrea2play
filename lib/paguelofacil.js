/**
 * paguelofacil.js — Birrea2Play
 * Frontend wrapper para pagos con tarjeta via PágueloFácil.
 * CERO credenciales aquí — el CCLW vive en la Edge Function.
 *
 * Flujo:
 *  1. iniciarPagoTarjeta() → llama Edge Function pf-create-link
 *  2. Edge Function retorna una URL de checkout
 *  3. Se abre en el browser del dispositivo
 *  4. PF redirige a la Edge Function pf-webhook
 *  5. Edge Function acredita wallet y redirige a deep link
 *  6. App captura deep link (birrea2play://wallet?status=success&amount=X)
 */

import { Linking } from 'react-native';
import { supabase } from './supabase';

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Authorization': `Bearer ${session?.access_token ?? ''}`,
    'apikey':        ANON_KEY,
    'Content-Type':  'application/json',
  };
}

/**
 * Inicia un pago con tarjeta.
 * Abre el browser del dispositivo con la URL de checkout de PágueloFácil.
 *
 * @param {{ userId, amount, descripcion?, tipo? }} p
 * @returns {Promise<{ ordenId: string }>}
 */
export async function iniciarPagoTarjeta({ userId, amount, descripcion, tipo = 'recarga_tarjeta' }) {
  const headers = await authHeaders();
  const res     = await fetch(`${FUNCTIONS_URL}/pf-create-link`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ userId, amount, descripcion, tipo }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Error creando enlace de pago');

  const canOpen = await Linking.canOpenURL(json.url);
  if (!canOpen) throw new Error('No se pudo abrir el browser de pago');

  await Linking.openURL(json.url);
  return { ordenId: json.ordenId };
}
