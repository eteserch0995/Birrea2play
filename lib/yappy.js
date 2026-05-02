import CryptoJS from 'crypto-js';
import { supabase } from './supabase';

const API_KEY    = process.env.EXPO_PUBLIC_YAPPY_API_KEY;
const SECRET_KEY = process.env.EXPO_PUBLIC_YAPPY_SECRET_KEY;
const BASE_URL   = process.env.EXPO_PUBLIC_YAPPY_BASE_URL ?? 'https://api.yappy.com.pa';

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let _tokenCache = { token: null, date: null };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// HMAC-SHA256(API_KEY + DATE, key = SECRET_KEY) — per Yappy Integration Manual
function generateDailyCode() {
  const message = API_KEY + todayStr();
  return CryptoJS.HmacSHA256(message, SECRET_KEY).toString(CryptoJS.enc.Hex);
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Api-Key':      API_KEY,
      'Secret-Key':   SECRET_KEY,
      ...(options.headers ?? {}),
    },
  });
  let json;
  try { json = await res.json(); } catch {
    throw new Error(`Yappy respondió sin JSON (HTTP ${res.status})`);
  }
  const code = json.status?.code ?? json.code;
  if (code && code !== 'YP-0000') {
    throw new Error(`Yappy ${code}: ${json.status?.description ?? 'Error desconocido'}`);
  }
  return json;
}

async function yappyLogin() {
  const today = todayStr();
  if (_tokenCache.token && _tokenCache.date === today) return _tokenCache.token;
  const data = await request('/v1/session/login', {
    method: 'POST',
    body:   JSON.stringify({ body: { code: generateDailyCode() } }),
  });
  const token = data.body?.token;
  if (!token) throw new Error('Yappy no devolvió token');
  _tokenCache = { token, date: today };
  return token;
}

async function getCollectionMethods(token) {
  const data = await request('/v1/collection-method', {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.type ?? data.data ?? [];
}

async function getMovementHistory(token) {
  const today = todayStr();
  const data = await request('/v1/movement/history', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    JSON.stringify({
      body: {
        pagination: { start_date: today, end_date: today, limit: 50 },
        filter:     [{ id: 'ROLE', value: 'CREDIT' }],
      },
    }),
  });
  return data.body?.transactions ?? data.body ?? [];
}

async function confirmarPagoServidor({ userId, amount, reference }) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FUNCTIONS_URL}/yappy-confirm`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
      'apikey':        ANON_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ userId, amount, reference }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? 'Error confirmando pago');
  return json;
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

/**
 * Obtiene el alias Yappy del comercio desde la API.
 */
export async function getYappyAlias() {
  const token   = await yappyLogin();
  const methods = await getCollectionMethods(token);
  const method  = methods.find(m => m.type === 'INTEGRACION_YAPPY')
               ?? methods.find(m => m.type === 'DIRECTORIO')
               ?? methods[0];
  return (
    method?.alias ??
    method?.details?.find(d => d.id === 'alias')?.value ??
    'birrea2play'
  );
}

/**
 * Construye el deep link para abrir la app Yappy con el pago pre-llenado.
 */
export function buildYappyDeepLink({ alias, amount, reference }) {
  const desc = encodeURIComponent(`Birrea2Play $${Number(amount).toFixed(2)}`);
  return (
    `yappy://payment` +
    `?alias=${encodeURIComponent(alias)}` +
    `&amount=${encodeURIComponent(String(amount))}` +
    `&description=${desc}` +
    `&reference=${encodeURIComponent(reference)}`
  );
}

export const YAPPY_FALLBACK_URL =
  'https://play.google.com/store/apps/details?id=com.bancogeneral.yappy';

/**
 * Inicia el polling de movimientos Yappy para detectar el pago del usuario.
 * Devuelve { promise, cancel } — llama cancel() para detener sin error visible.
 */
export function pollForYappyPayment({ userId, amount, reference, onProgress }) {
  const INTERVAL_MS  = 5_000;
  const MAX_ATTEMPTS = 60; // 60 × 5 s = 5 min

  let cancelled  = false;
  let intervalId = null;

  const promise = new Promise(async (resolve, reject) => {
    let token;
    try {
      token = await yappyLogin();
    } catch (e) {
      return reject(new Error('Error auth Yappy: ' + e.message));
    }

    let attempts = 0;
    intervalId = setInterval(async () => {
      if (cancelled) { clearInterval(intervalId); return; }
      attempts++;

      try {
        const txs = await getMovementHistory(token);
        const ref = reference.toLowerCase();

        const match = txs.find(tx => {
          const desc = (tx.description ?? '').toLowerCase();
          return (
            desc.includes(ref) ||
            (tx.metadata ?? []).some(m =>
              m.value?.toString().toLowerCase().includes(ref)
            )
          );
        });

        if (match) {
          const st = (match.status ?? '').toUpperCase();
          if (st === 'COMPLETED' || st === 'EXECUTED') {
            clearInterval(intervalId);
            try {
              await confirmarPagoServidor({ userId, amount, reference });
              resolve(match);
            } catch (e) { reject(e); }
            return;
          }
          if (st === 'REJECTED' || st === 'FAILED' || st === 'DECLINED') {
            clearInterval(intervalId);
            return reject(new Error('Pago rechazado por Yappy'));
          }
        }

        if (onProgress) onProgress({ attempts, maxAttempts: MAX_ATTEMPTS });

        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(intervalId);
          reject(new Error('Tiempo de espera agotado — no se detectó el pago'));
        }
      } catch (e) {
        clearInterval(intervalId);
        reject(e);
      }
    }, INTERVAL_MS);
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    },
  };
}
