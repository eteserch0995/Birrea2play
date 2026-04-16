/**
 * yappy.js — Birrea2Play
 * Integración con Yappy PA (Banco General)
 * Basado en swagger.yml v1.1.0 — Yappy Commerce Integration
 *
 * ARQUITECTURA DEL API:
 * El API de Yappy es un API de LECTURA de movimientos del merchant.
 * NO existe endpoint para crear cobros de forma programática (push).
 * El flujo correcto para cobrar al cliente es:
 *   1. El cliente abre su app Yappy y envía el pago al alias del merchant
 *   2. El merchant consulta /v1/movement/history filtrando por referencia
 *   3. Al detectar el pago → acreditar wallet / confirmar inscripción
 *
 * Para pagos en tiempo real se recomienda implementar un webhook
 * vía Supabase Edge Function que Yappy notificará.
 */

import CryptoJS from 'crypto-js';

// ─── Credenciales (EXPO_PUBLIC_ para que Expo las incluya en el bundle) ───────
const API_KEY    = process.env.EXPO_PUBLIC_YAPPY_API_KEY    ?? 'UBPWA-74629696';
const SECRET_KEY = process.env.EXPO_PUBLIC_YAPPY_SECRET_KEY ?? 'WVBfOEZDNDRDNUYtNTc0RS0zN0M3LUEzRDItQUU4MzhERTYyMzkx';
const SEED_CODE  = process.env.EXPO_PUBLIC_YAPPY_SEED_CODE  ?? 'JVKAI-35449642';
const BASE_URL   = process.env.EXPO_PUBLIC_YAPPY_BASE_URL   ?? 'https://api.yappy.com.pa';

// ─── Token cache diario ───────────────────────────────────────────────────────
let _tokenCache = { token: null, date: null };

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Código diario: SHA-256(SEED_CODE + API_KEY + fecha)
 * El swagger muestra que el code es un hex string de 64 chars (SHA-256 output).
 * SEED_CODE actúa como prefijo secreto del mensaje.
 */
function generateDailyCode() {
  const message = SEED_CODE + API_KEY + todayStr();
  return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}

// ─── Helper HTTP ─────────────────────────────────────────────────────────────
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
  try {
    json = await res.json();
  } catch {
    throw new Error(`Yappy respondió sin JSON (HTTP ${res.status})`);
  }

  // Yappy devuelve code 'YP-0000' para éxito
  const statusCode = json.status?.code ?? json.code;
  if (statusCode && statusCode !== 'YP-0000') {
    throw new Error(`Yappy ${statusCode}: ${json.status?.description ?? json.message ?? 'Error desconocido'}`);
  }
  return json;
}

// ─── Autenticación ────────────────────────────────────────────────────────────

/**
 * Login — POST /v1/session/login
 * Body: { body: { code: "sha256hex" } }
 * Response: { body: { token: "JWT...", state: "OPEN", open_at: "..." }, status: {...} }
 */
export async function yappyLogin() {
  const today = todayStr();
  if (_tokenCache.token && _tokenCache.date === today) return _tokenCache.token;

  const code = generateDailyCode();
  const data = await request('/v1/session/login', {
    method: 'POST',
    body:   JSON.stringify({ body: { code } }),   // ← body wrapper obligatorio
  });

  // Token está en data.body.token (string JWT)
  const token = data.body?.token ?? data.body?.token?.token;
  if (!token) throw new Error('Yappy no devolvió token de sesión');

  _tokenCache = { token, date: today };
  return token;
}

/**
 * Logout — GET /v1/session/logout
 */
export async function yappyLogout(token) {
  await request('/v1/session/logout', {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  _tokenCache = { token: null, date: null };
}

// ─── Métodos de cobro ─────────────────────────────────────────────────────────

/**
 * GET /v1/collection-method
 * Retorna los métodos de cobro del merchant:
 * tipos: DIRECTORIO | BOTON_DE_PAGO | PUNTO_YAPPY | INTEGRACION_YAPPY | PUNTO_DE_VENTA
 */
export async function getCollectionMethods(token) {
  const data = await request('/v1/collection-method', {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  // data.type es el array de CollectionMethodDTO
  return data.type ?? data.data ?? [];
}

// ─── Historial de movimientos ─────────────────────────────────────────────────

/**
 * POST /v1/movement/history
 * Lista transacciones recibidas (CREDIT) por el merchant.
 *
 * @param {string} token
 * @param {object} opts
 * @param {string} opts.startDate   - 'YYYY-MM-DD'
 * @param {string} opts.endDate     - 'YYYY-MM-DD'
 * @param {number} [opts.limit]     - default 20
 * @param {string} [opts.role]      - 'CREDIT' (cobros recibidos) | 'DEBIT'
 * @param {string} [opts.alias]     - Filtrar por alias de caja (ej. 'CAJA01')
 */
export async function getMovementHistory(token, opts = {}) {
  const { startDate, endDate, limit = 20, role = 'CREDIT', alias } = opts;

  const body = {
    pagination: {
      start_date: startDate ?? todayStr(),
      end_date:   endDate   ?? todayStr(),
      limit,
    },
    filter: [
      { id: 'ROLE', value: role },
      ...(alias ? [{ id: 'COLLECTION_ALIAS', value: alias }] : []),
    ],
  };

  const data = await request('/v1/movement/history', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ body }),
  });

  return data.body?.transactions ?? data.body ?? [];
}

// ─── Detalle de transacción ───────────────────────────────────────────────────

/**
 * GET /v1/movement/{transaction-id}
 * Statuses: PENDING | EXECUTED | COMPLETED | REJECTED | FAILED
 */
export async function getTransactionDetail(token, transactionId) {
  const data = await request(`/v1/movement/${transactionId}`, {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.body ?? data ?? null;
}

// ─── Polling por referencia ───────────────────────────────────────────────────

/**
 * Espera (polling) hasta encontrar una transacción COMPLETED con la referencia dada.
 * Útil para verificar que el cliente pagó después de que envió el Yappy.
 *
 * @param {string} token
 * @param {string} reference       - referencia única que le diste al cliente (ej. 'wallet-abc-1234')
 * @param {{ intervalMs?, maxAttempts? }} opts
 * @returns {Promise<object>} La transacción completada
 */
export function pollForPayment(token, reference, opts = {}) {
  const { intervalMs = 5000, maxAttempts = 24 } = opts; // 24 × 5s = 2 min
  const today = todayStr();

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const txs = await getMovementHistory(token, {
          startDate: today,
          endDate:   today,
          limit:     50,
          role:      'CREDIT',
        });

        // Buscar transacción que coincida con la referencia en metadata o description
        const match = txs.find((tx) => {
          const desc = (tx.description ?? '').toLowerCase();
          const ref  = reference.toLowerCase();
          const meta = (tx.metadata ?? []).find(m => m.value?.toLowerCase?.()?.includes(ref));
          return desc.includes(ref) || !!meta;
        });

        if (match) {
          if (match.status === 'COMPLETED' || match.status === 'EXECUTED') {
            clearInterval(interval);
            resolve(match);
          } else if (match.status === 'REJECTED' || match.status === 'FAILED') {
            clearInterval(interval);
            reject(new Error(`Pago ${match.status.toLowerCase()}`));
          }
        }

        if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Tiempo de espera agotado — no se detectó el pago Yappy'));
        }
      } catch (e) {
        clearInterval(interval);
        reject(e);
      }
    }, intervalMs);
  });
}

// ─── Devolución de transacción ────────────────────────────────────────────────

/**
 * PUT /v1/transaction/{transaction-id}
 * Genera una devolución/reverso de una transacción.
 */
export async function returnTransaction(token, transactionId) {
  const data = await request(`/v1/transaction/${transactionId}`, {
    method:  'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// ─── Flujo de alto nivel ──────────────────────────────────────────────────────

/**
 * Genera instrucciones de pago para mostrar al cliente y hace polling
 * hasta detectar el pago en el historial de movimientos.
 *
 * FLUJO:
 * 1. App obtiene alias del merchant con getCollectionMethods()
 * 2. Muestra al cliente: "Envía $X.XX a [alias] con la referencia [ref]"
 * 3. Hace polling en el historial hasta encontrar la transacción
 * 4. Al confirmar → acreditar wallet / activar inscripción
 *
 * @param {object} p
 * @param {number}   p.amount       - Monto en USD
 * @param {string}   p.reference    - Referencia única (ej. 'wallet-userId-timestamp')
 * @param {function} p.onInstructions - Callback con { alias, amount, reference } para mostrar al usuario
 */
export async function startYappyPayment({ amount, reference, onInstructions }) {
  const token   = await yappyLogin();
  const methods = await getCollectionMethods(token);

  // Preferir INTEGRACION_YAPPY, luego DIRECTORIO, luego cualquiera
  const method = methods.find(m => m.type === 'INTEGRACION_YAPPY')
              ?? methods.find(m => m.type === 'DIRECTORIO')
              ?? methods[0];

  const alias = method?.alias ?? method?.details?.find(d => d.id === 'alias')?.value ?? 'birrea2play';

  if (onInstructions) {
    onInstructions({ alias, amount, reference });
  }

  // Polling hasta confirmar el pago
  const tx = await pollForPayment(token, reference);
  return tx;
}
