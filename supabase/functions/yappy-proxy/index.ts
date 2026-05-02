/**
 * yappy-proxy — Edge Function
 *
 * Proxy server-side para TODAS las llamadas a la API Yappy (Banco General).
 *
 * Razón: la API `https://api.yappy.com.pa` está geo-restringida a IPs de Panamá
 * y rechaza requests directos desde el dispositivo móvil (resultado: "Network Error"
 * sin código HTTP — el TCP/TLS handshake se cierra antes de cualquier respuesta).
 * Adicionalmente, mover las credenciales (API_KEY / SECRET_KEY / SEED_CODE) al
 * servidor evita exponerlas en el bundle del APK/IPA.
 *
 * Acciones soportadas (campo `action` del body):
 *   - "login"             → POST /v1/session/login          (interno, normalmente no se llama desde el cliente)
 *   - "collection-method" → GET  /v1/collection-method       (devuelve métodos de cobro / alias del comercio)
 *   - "movement-history"  → POST /v1/movement/history        (transacciones del día — usado por el polling)
 *
 * Auth: requiere `Authorization: Bearer <JWT del usuario Supabase>`.
 *
 * Variables de entorno requeridas (configurar en Supabase dashboard):
 *   - YAPPY_BASE_URL                  (default: https://api.yappy.com.pa)
 *   - YAPPY_API_KEY                   (provista por Banco General)
 *   - YAPPY_SECRET_KEY                (provista por Banco General)
 *   - YAPPY_SEED_CODE                 (provista por Banco General)
 *   - YAPPY_HASH_MODE                 (opcional: "hmac" | "sha256-seed", default: "hmac")
 *   - SUPABASE_URL                    (auto-poblada por la plataforma)
 *   - SUPABASE_SERVICE_ROLE_KEY       (auto-poblada por la plataforma)
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE   = Deno.env.get('YAPPY_BASE_URL')   ?? 'https://api.yappy.com.pa';
const API_KEY      = Deno.env.get('YAPPY_API_KEY')    ?? '';
const SECRET_KEY   = Deno.env.get('YAPPY_SECRET_KEY') ?? '';
const SEED_CODE    = Deno.env.get('YAPPY_SEED_CODE')  ?? '';
const HASH_MODE    = (Deno.env.get('YAPPY_HASH_MODE') ?? 'hmac').toLowerCase();

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SVCKEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Token cache (in-memory, vive lo que dura el isolate) ─────────────────────
type TokenCache = { token: string | null; date: string | null; expiresAt: number };
let _tokenCache: TokenCache = { token: null, date: null, expiresAt: 0 };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Genera el código diario para `/v1/session/login`.
 * Yappy admite (según versión del manual de integración) dos modos:
 *  - "hmac"        : HMAC-SHA256(API_KEY + DATE, key=SECRET_KEY)  ← actual cliente
 *  - "sha256-seed" : SHA-256(SEED_CODE + API_KEY + DATE)           ← yappy-init/check legacy
 * Configurable vía YAPPY_HASH_MODE para no atarnos a una sola versión.
 */
async function generateDailyCode(): Promise<string> {
  const date = todayStr();

  if (HASH_MODE === 'sha256-seed') {
    const message = SEED_CODE + API_KEY + date;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    return bytesToHex(buf);
  }

  // HMAC-SHA256 (default)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(API_KEY + date),
  );
  return bytesToHex(sig);
}

async function yappyFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${YAPPY_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Api-Key':      API_KEY,
      'Secret-Key':   SECRET_KEY,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Yappy respuesta no-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  return { httpStatus: res.status, body: parsed };
}

async function getYappyToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  const today = todayStr();

  if (
    !forceRefresh &&
    _tokenCache.token &&
    _tokenCache.date === today &&
    _tokenCache.expiresAt - now > 5 * 60 * 1000
  ) {
    return _tokenCache.token;
  }

  const code = await generateDailyCode();
  const { httpStatus, body } = await yappyFetch('/v1/session/login', {
    method: 'POST',
    body:   JSON.stringify({ body: { code } }),
  });

  const yappyCode = body.status?.code ?? body.code;
  if (yappyCode && yappyCode !== 'YP-0000') {
    throw new Error(`Yappy login ${yappyCode}: ${body.status?.description ?? 'error'} (HTTP ${httpStatus})`);
  }

  const token = body.body?.token;
  if (!token) throw new Error(`Yappy login sin token (HTTP ${httpStatus})`);

  const expiresAt = body.body?.expires_at
    ? new Date(body.body.expires_at).getTime()
    : now + 23 * 60 * 60 * 1000;

  _tokenCache = { token, date: today, expiresAt };
  return token;
}

// ─── Auth: validar JWT del usuario ────────────────────────────────────────────
async function requireUser(req: Request): Promise<{ ok: true } | { ok: false; res: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, res: json({ error: 'No autorizado' }, 401) };
  }
  const jwt = authHeader.replace('Bearer ', '');
  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data?.user) {
    return { ok: false, res: json({ error: 'No autorizado' }, 401) };
  }
  return { ok: true };
}

// ─── Handlers por acción ──────────────────────────────────────────────────────

async function handleCollectionMethod(): Promise<Response> {
  let token = await getYappyToken();
  let { httpStatus, body } = await yappyFetch('/v1/collection-method', {
    method:  'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  // Reintento si el token fue invalidado server-side
  if (httpStatus === 401 || body.status?.code === 'YP-0401') {
    token = await getYappyToken(true);
    ({ httpStatus, body } = await yappyFetch('/v1/collection-method', {
      method:  'GET',
      headers: { Authorization: `Bearer ${token}` },
    }));
  }

  return json({ httpStatus, ...body });
}

async function handleMovementHistory(): Promise<Response> {
  const today = todayStr();
  const payload = JSON.stringify({
    body: {
      pagination: { start_date: today, end_date: today, limit: 50 },
      filter:     [{ id: 'ROLE', value: 'CREDIT' }],
    },
  });

  let token = await getYappyToken();
  let { httpStatus, body } = await yappyFetch('/v1/movement/history', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    payload,
  });

  if (httpStatus === 401 || body.status?.code === 'YP-0401') {
    token = await getYappyToken(true);
    ({ httpStatus, body } = await yappyFetch('/v1/movement/history', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    payload,
    }));
  }

  return json({ httpStatus, ...body });
}

async function handleLogin(): Promise<Response> {
  await getYappyToken(true);
  return json({ ok: true, cachedAt: _tokenCache.date, expiresAt: _tokenCache.expiresAt });
}

// Envía solicitud de cobro al teléfono del usuario.
// Endpoint Yappy: POST /v1/charge
async function handleCharge(payload: any): Promise<Response> {
  const { phone, amount, reference, description } = payload;
  if (!phone || !amount) return json({ error: 'Faltan phone o amount' }, 400);

  let token = await getYappyToken();
  const body = JSON.stringify({
    body: {
      phone:       String(phone).replace(/\D/g, ''), // solo dígitos
      amount:      Number(amount),
      description: description ?? `Birrea2Play $${Number(amount).toFixed(2)}`,
      reference:   reference ?? '',
    },
  });

  let res = await yappyFetch('/v1/charge', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });

  if (res.httpStatus === 401 || res.body?.status?.code === 'YP-0401') {
    token = await getYappyToken(true);
    res = await yappyFetch('/v1/charge', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
  }

  const yCode = res.body?.status?.code ?? res.body?.code;
  if (yCode && yCode !== 'YP-0000') {
    return json({ error: `Yappy ${yCode}: ${res.body?.status?.description ?? 'Error'}` }, 502);
  }

  return json({ ok: true, data: res.body?.body ?? res.body });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  if (!API_KEY || !SECRET_KEY) {
    console.error('[yappy-proxy] faltan YAPPY_API_KEY / YAPPY_SECRET_KEY en env');
    return json({ error: 'Servidor mal configurado' }, 500);
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  let payload: { action?: string; [key: string]: any };
  try { payload = await req.json(); }
  catch { return json({ error: 'Body inválido' }, 400); }

  const action = payload.action;
  if (!action) return json({ error: 'Falta `action`' }, 400);

  try {
    switch (action) {
      case 'login':             return await handleLogin();
      case 'collection-method': return await handleCollectionMethod();
      case 'movement-history':  return await handleMovementHistory();
      case 'charge':            return await handleCharge(payload);
      default:                  return json({ error: `Acción desconocida: ${action}` }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message ?? 'error';
    console.error('[yappy-proxy] acción', action, 'falló:', msg);
    return json({ error: msg }, 502);
  }
});
