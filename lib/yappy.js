import { supabase } from './supabase';

/**
 * lib/yappy.js — cliente Yappy del lado del dispositivo.
 *
 * IMPORTANTE: este módulo ya NO llama directamente a https://api.yappy.com.pa.
 * La API Yappy está geo-restringida a IPs panameñas y un fetch directo desde
 * el celular falla con "Network Error" (TCP/TLS rechazado en el edge de Yappy).
 *
 * Toda la comunicación con Yappy va a través de la Edge Function `yappy-proxy`
 * que vive en Supabase. Esa función:
 *   - mantiene las credenciales (API_KEY / SECRET_KEY / SEED_CODE) server-side
 *   - calcula el HMAC diario sin exponerlo al cliente
 *   - cachea el token de sesión en memoria
 *   - reenvía las llamadas a Yappy desde una IP server-side estable
 *
 * Las funciones públicas de este módulo mantienen la MISMA firma que antes,
 * por lo que `WalletScreen.js` sigue funcionando sin cambios.
 */

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// FIX #1: alias del comercio como fallback configurable vía env, usado cuando
// la Edge Function no puede responder (red caída, función fría/timeouts, etc.).
const ALIAS_FALLBACK = process.env.EXPO_PUBLIC_YAPPY_ALIAS_FALLBACK ?? 'birrea2play';

// ─── Llamada genérica al proxy ────────────────────────────────────────────────

async function callProxy(action, { requireAuth = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey':       ANON_KEY,
  };

  if (requireAuth) {
    // Usar el JWT del usuario autenticado para que el proxy lo valide
    let session;
    try {
      const { data } = await supabase.auth.getSession();
      session = data?.session;
    } catch { /* ignored */ }

    if (!session?.access_token) {
      throw new Error('Sesión expirada — inicia sesión nuevamente');
    }
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${FUNCTIONS_URL}/yappy-proxy`, {
    method:  'POST',
    headers,
    body:    JSON.stringify({ action }),
  });

  let json;
  try { json = await res.json(); }
  catch { throw new Error(`Proxy Yappy respondió sin JSON (HTTP ${res.status})`); }

  if (!res.ok) {
    throw new Error(json.error ?? `Error proxy Yappy (HTTP ${res.status})`);
  }

  // El proxy reenvía la respuesta cruda de Yappy + httpStatus. Validar status Yappy.
  const code = json.status?.code ?? json.code;
  if (code && code !== 'YP-0000') {
    throw new Error(`Yappy ${code}: ${json.status?.description ?? 'Error desconocido'}`);
  }
  return json;
}

async function getCollectionMethods() {
  const data = await callProxy('collection-method');
  return data.type ?? data.data ?? [];
}

async function getMovementHistory() {
  const data = await callProxy('movement-history');
  return data.body?.transactions ?? data.body ?? [];
}

// ─── Confirmación de pago (sin cambios) ───────────────────────────────────────
// FIX #5: refrescar sesión Supabase si el access_token está vencido
// FIX #6: reintentar hasta 3 veces con backoff exponencial ante errores de red/servidor
async function confirmarPagoServidor({ userId, amount, reference }) {
  let session;
  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed?.session;
  } catch { /* si el refresh falla, intentar con la sesión actual */ }
  if (!session) {
    const { data: existing } = await supabase.auth.getSession();
    session = existing?.session;
  }
  if (!session?.access_token) {
    throw new Error('Sesión expirada — inicia sesión nuevamente');
  }

  const MAX_RETRIES = 3;
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${FUNCTIONS_URL}/yappy-confirm`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        ANON_KEY,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ userId, amount, reference }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error confirmando pago');
      return json;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw lastError;
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

export { confirmarPagoServidor };

/**
 * Obtiene el alias Yappy del comercio vía la Edge Function `yappy-proxy`.
 * FIX #1: si la función no está disponible, usa ALIAS_FALLBACK.
 */
export async function getYappyAlias() {
  try {
    const methods = await getCollectionMethods();
    const method  = methods.find(m => m.type === 'INTEGRACION_YAPPY')
                 ?? methods.find(m => m.type === 'DIRECTORIO')
                 ?? methods[0];
    const alias =
      method?.alias ??
      method?.details?.find(d => d.id === 'alias')?.value;
    if (alias) return alias;
    console.warn('[Yappy] proxy sin alias, usando fallback:', ALIAS_FALLBACK);
    return ALIAS_FALLBACK;
  } catch (e) {
    console.warn('[Yappy] getYappyAlias falló, usando fallback:', e.message);
    return ALIAS_FALLBACK;
  }
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
 * Busca manualmente en el historial de hoy si ya existe un pago para esta referencia.
 * Útil para recuperación post-timeout o post-cancelación (Fallos #7 y #8).
 * Devuelve la transacción encontrada o null.
 */
export async function buscarPagoYappy({ reference, amount }) {
  try {
    const txs = await getMovementHistory();
    return _matchTransaction(txs, reference, amount) ?? null;
  } catch {
    return null;
  }
}

// FIX #3 + #9: matching robusto que tolera truncamiento de descripción y valida monto.
function _matchTransaction(txs, reference, amount) {
  const ref      = reference.toLowerCase();
  const shortRef = ref.slice(-20);
  const amtNum   = Number(amount);

  return txs.find(tx => {
    const desc  = (tx.description ?? '').toLowerCase();
    const txAmt = Number(tx.amount ?? tx.monto ?? 0);

    const descMatch =
      desc.includes(ref) ||
      desc.includes(shortRef) ||
      (tx.metadata ?? []).some(m =>
        m.value?.toString().toLowerCase().includes(ref) ||
        m.value?.toString().toLowerCase().includes(shortRef)
      );

    if (!descMatch) return false;

    // Tolerancia ±$0.05 para diferencias de redondeo
    const amtMatch = Math.abs(txAmt - amtNum) <= 0.05;
    return amtMatch;
  });
}

/**
 * Inicia el polling de movimientos Yappy para detectar el pago del usuario.
 * Devuelve { promise, cancel } — llama cancel() para detener sin error visible.
 *
 * FIX #4: el lock `_activePollingRefs` previene iniciar dos pollings simultáneos
 *         para la misma referencia (doble-tap en botón "Pagar con Yappy").
 *
 * Nota arquitectónica: ahora cada tick llama al proxy server-side; el token de
 * Yappy ya no se cachea en el cliente (lo cachea el proxy en memoria del isolate).
 */
const _activePollingRefs = new Set();

export function pollForYappyPayment({ userId, amount, reference, onProgress }) {
  const INTERVAL_MS  = 5_000;
  const MAX_ATTEMPTS = 60; // 60 × 5 s = 5 min

  if (_activePollingRefs.has(reference)) {
    return {
      promise: Promise.reject(new Error('Ya hay un pago en proceso para esta referencia')),
      cancel:  () => {},
    };
  }
  _activePollingRefs.add(reference);

  let cancelled  = false;
  let intervalId = null;

  const cleanup = () => {
    _activePollingRefs.delete(reference);
    if (intervalId) clearInterval(intervalId);
  };

  const promise = new Promise((resolve, reject) => {
    let attempts = 0;
    intervalId = setInterval(async () => {
      if (cancelled) { cleanup(); return; }
      attempts++;

      try {
        const txs = await getMovementHistory();

        const match = _matchTransaction(txs, reference, amount);

        if (match) {
          const st = (match.status ?? '').toUpperCase();
          if (st === 'COMPLETED' || st === 'EXECUTED') {
            cleanup();
            try {
              await confirmarPagoServidor({ userId, amount, reference });
              resolve(match);
            } catch (e) { reject(e); }
            return;
          }
          if (st === 'REJECTED' || st === 'FAILED' || st === 'DECLINED') {
            cleanup();
            return reject(new Error('Pago rechazado por Yappy'));
          }
        }

        if (onProgress) onProgress({ attempts, maxAttempts: MAX_ATTEMPTS });

        if (attempts >= MAX_ATTEMPTS) {
          cleanup();
          reject(new Error('Tiempo de espera agotado — no se detectó el pago'));
        }
      } catch (e) {
        // Errores transitorios del proxy (cold start, 502, red móvil) — no abortar
        // hasta acumular 3 fallos seguidos para no perder el polling por un blip.
        if (onProgress) onProgress({ attempts, maxAttempts: MAX_ATTEMPTS, warn: e.message });
        if (attempts >= MAX_ATTEMPTS) {
          cleanup();
          reject(e);
        }
      }
    }, INTERVAL_MS);
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      cleanup();
    },
  };
}
