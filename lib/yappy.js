import CryptoJS from 'crypto-js';
import { supabase } from './supabase';

const API_KEY    = process.env.EXPO_PUBLIC_YAPPY_API_KEY;
const SECRET_KEY = process.env.EXPO_PUBLIC_YAPPY_SECRET_KEY;
const BASE_URL   = process.env.EXPO_PUBLIC_YAPPY_BASE_URL ?? 'https://api.yappy.com.pa';

// FIX #1: alias de comercio como fallback configurable vía env
const ALIAS_FALLBACK = process.env.EXPO_PUBLIC_YAPPY_ALIAS_FALLBACK ?? 'birrea2play';

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// FIX #2: caché incluye expiración real del token (no solo fecha de emisión)
let _tokenCache = { token: null, date: null, expiresAt: 0 };

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

// FIX #2: invalidar caché 5 min antes de la expiración real para evitar mid-polling expiry
async function yappyLogin() {
  const now   = Date.now();
  const today = todayStr();
  // Token válido si fue emitido hoy Y su expiración es en más de 5 minutos
  if (_tokenCache.token && _tokenCache.date === today && _tokenCache.expiresAt - now > 5 * 60 * 1000) {
    return _tokenCache.token;
  }
  const data = await request('/v1/session/login', {
    method: 'POST',
    body:   JSON.stringify({ body: { code: generateDailyCode() } }),
  });
  const token = data.body?.token;
  if (!token) throw new Error('Yappy no devolvió token');
  // La API Yappy emite tokens con expiración diaria; usamos 23 h como TTL conservador
  const expiresAt = data.body?.expires_at
    ? new Date(data.body.expires_at).getTime()
    : now + 23 * 60 * 60 * 1000;
  _tokenCache = { token, date: today, expiresAt };
  return token;
}

// FIX #2: forzar relogin limpiando el caché
function invalidateTokenCache() {
  _tokenCache = { token: null, date: null, expiresAt: 0 };
}

async function getCollectionMethods(token) {
  const data = await request('/v1/collection-method', {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.type ?? data.data ?? [];
}

// FIX #2: acepta token como parámetro para que el polling pueda renovarlo
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

// FIX #5: refrescar sesión Supabase si el access_token está vencido
// FIX #6: reintentar hasta 3 veces con backoff exponencial ante errores de red/servidor
async function confirmarPagoServidor({ userId, amount, reference }) {
  // Intentar refrescar la sesión para obtener un token fresco
  let session;
  try {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed?.session;
  } catch {
    // Si el refresh falla, intentar con la sesión actual
  }
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
        // Backoff exponencial: 2s, 4s antes del siguiente intento
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }
  throw lastError;
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

/**
 * Confirma un pago Yappy ya detectado llamando a la Edge Function yappy-confirm.
 * Exportada para permitir recuperación manual post-timeout / post-cancelación.
 */
export { confirmarPagoServidor };

/**
 * Obtiene el alias Yappy del comercio desde la API.
 * FIX #1: si la API no está disponible (ej. IP fuera de Panamá), usa ALIAS_FALLBACK.
 */
export async function getYappyAlias() {
  try {
    const token   = await yappyLogin();
    const methods = await getCollectionMethods(token);
    const method  = methods.find(m => m.type === 'INTEGRACION_YAPPY')
                 ?? methods.find(m => m.type === 'DIRECTORIO')
                 ?? methods[0];
    const alias =
      method?.alias ??
      method?.details?.find(d => d.id === 'alias')?.value;
    if (alias) return alias;
    // API respondió pero sin alias — usar fallback
    console.warn('[Yappy] API sin alias, usando fallback:', ALIAS_FALLBACK);
    return ALIAS_FALLBACK;
  } catch (e) {
    // FIX #1: API inaccesible (fuera de Panamá, red caída, etc.) — usar fallback
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
    const token = await yappyLogin();
    const txs   = await getMovementHistory(token);
    return _matchTransaction(txs, reference, amount) ?? null;
  } catch {
    return null;
  }
}

// FIX #3 + #9: matching robusto que tolera truncamiento de descripción y valida monto
// La referencia puede aparecer en description, en metadata, o como últimos chars del shortRef.
// También se verifica que el monto no difiera en más de $0.05 (tolerancia de redondeo).
function _matchTransaction(txs, reference, amount) {
  const ref      = reference.toLowerCase();
  // shortRef: los últimos 20 chars de la referencia (suficiente para identificar si está truncada)
  const shortRef = ref.slice(-20);
  const amtNum   = Number(amount);

  return txs.find(tx => {
    const desc = (tx.description ?? '').toLowerCase();
    const txAmt = Number(tx.amount ?? tx.monto ?? 0);

    const descMatch =
      desc.includes(ref) ||
      desc.includes(shortRef) ||
      (tx.metadata ?? []).some(m =>
        m.value?.toString().toLowerCase().includes(ref) ||
        m.value?.toString().toLowerCase().includes(shortRef)
      );

    if (!descMatch) return false;

    // Verificar monto con tolerancia ±$0.05 para diferencias de redondeo
    const amtMatch = Math.abs(txAmt - amtNum) <= 0.05;
    return amtMatch;
  });
}

/**
 * Inicia el polling de movimientos Yappy para detectar el pago del usuario.
 * Devuelve { promise, cancel } — llama cancel() para detener sin error visible.
 *
 * FIX #4: el lock `_activePollingRef` previene iniciar dos pollings simultáneos
 *          para la misma referencia (doble-tap en botón "Pagar con Yappy").
 */
const _activePollingRefs = new Set();

export function pollForYappyPayment({ userId, amount, reference, onProgress }) {
  const INTERVAL_MS  = 5_000;
  const MAX_ATTEMPTS = 60; // 60 × 5 s = 5 min

  // FIX #4: si ya hay un polling activo para esta referencia, rechazar inmediatamente
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

  const promise = new Promise(async (resolve, reject) => {
    // FIX #2: renovar token al inicio del polling
    let token;
    try {
      token = await yappyLogin();
    } catch (e) {
      cleanup();
      return reject(new Error('Error auth Yappy: ' + e.message));
    }

    let attempts = 0;
    intervalId = setInterval(async () => {
      if (cancelled) { cleanup(); return; }
      attempts++;

      try {
        // FIX #2: renovar token en cada tick si está próximo a expirar
        try { token = await yappyLogin(); } catch { /* usa el token anterior */ }

        const txs = await getMovementHistory(token);

        // FIX #3: usar matching robusto con tolerancia de truncamiento y monto
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
        // FIX #2: si el error es 401/token expirado, intentar renovar antes de abortar
        if (e.message?.includes('401') || e.message?.includes('Unauthorized') || e.message?.includes('YP-')) {
          invalidateTokenCache();
          try { token = await yappyLogin(); return; } catch { /* caerá en el siguiente tick */ }
        }
        cleanup();
        reject(e);
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
