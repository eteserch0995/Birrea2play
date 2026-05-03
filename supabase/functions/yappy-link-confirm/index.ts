/**
 * yappy-link-confirm — Edge Function
 *
 * Cuando el usuario dice "Ya pagué $X via el link de Yappy":
 *   1. Consulta el historial de movimientos de hoy en la API de Yappy.
 *   2. Busca una transacción EJECUTADA con ese monto (±$0.05) en los últimos 15 min.
 *   3. Si la encuentra y no fue usada antes → acredita el wallet inmediatamente.
 *   4. Si no la encuentra → crea un pending_recarga para revisión del admin.
 *
 * Retorna:
 *   { verified: true,  credited: true }   — pago confirmado y acreditado
 *   { verified: false, pending: true  }   — no encontrado, en revisión
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE   = Deno.env.get('YAPPY_BASE_URL')   ?? 'https://apipagosbg.bgeneral.cloud';
const API_KEY      = Deno.env.get('YAPPY_API_KEY')    ?? '';
const SECRET_KEY   = Deno.env.get('YAPPY_SECRET_KEY') ?? '';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SVCKEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Yappy auth ───────────────────────────────────────────────────────────────

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getYappyToken(): Promise<string> {
  const date = todayStr();
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(API_KEY + date));
  const code = bytesToHex(sig);

  const res  = await fetch(`${YAPPY_BASE}/v1/session/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': API_KEY, 'Secret-Key': SECRET_KEY },
    body:    JSON.stringify({ body: { code } }),
  });
  const data = await res.json();
  const token = data.body?.token;
  if (!token) throw new Error(`Yappy login fallido (HTTP ${res.status}): ${data.status?.description ?? JSON.stringify(data)}`);
  return token;
}

// ─── Movement history ─────────────────────────────────────────────────────────

async function getMovements(token: string): Promise<any[]> {
  const today = todayStr();
  const res   = await fetch(`${YAPPY_BASE}/v1/movement/history`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Api-Key':       API_KEY,
      'Secret-Key':    SECRET_KEY,
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      body: {
        pagination: { start_date: today, end_date: today, limit: 50 },
        filter:     [{ id: 'ROLE', value: 'CREDIT' }],
      },
    }),
  });
  const data = await res.json();
  return data.body?.transactions ?? data.body ?? [];
}

// ─── Match: monto exacto (±$0.05) dentro de los últimos 15 min ───────────────

const EXECUTED_STATUSES = new Set(['COMPLETED', 'EXECUTED', 'E', 'EXITOSO', 'SUCCESS', 'APPROVED']);
const LOOKBACK_MS       = 15 * 60 * 1000;

function findMatch(transactions: any[], amount: number): any | null {
  const amtNum  = Number(amount);
  const cutoff  = Date.now() - LOOKBACK_MS;

  for (const tx of transactions) {
    const txAmt    = Number(tx.amount ?? tx.monto ?? tx.value ?? 0);
    const txStatus = String(tx.status ?? tx.estado ?? '').toUpperCase().trim();
    const txDateRaw = tx.date ?? tx.created_at ?? tx.fecha ?? tx.transactionDate;
    const txTime   = txDateRaw ? new Date(txDateRaw).getTime() : Date.now();

    const amtOk    = Math.abs(txAmt - amtNum) <= 0.05;
    const statusOk = EXECUTED_STATUSES.has(txStatus);
    const timeOk   = txTime >= cutoff;

    if (amtOk && statusOk && timeOk) return tx;
  }
  return null;
}

// ─── User auth ────────────────────────────────────────────────────────────────

async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''));
  return (error || !data?.user) ? null : data.user;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return jsonRes({ error: 'Method not allowed' }, 405);

  const authUser = await requireUser(req);
  if (!authUser) return jsonRes({ error: 'No autorizado' }, 401);

  const { data: profile } = await supabaseAdmin
    .from('users').select('id').eq('auth_id', authUser.id).maybeSingle();
  if (!profile) return jsonRes({ error: 'Perfil no encontrado' }, 403);

  let payload: { amount?: number; amount_paid?: number; amount_credito?: number; tier_label?: string };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  const amount = Number(payload.amount ?? payload.amount_paid);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return jsonRes({ error: 'Monto inválido (mín $1.00, máx $500.00)' }, 400);
  }
  const amountCredito = Number(payload.amount_credito ?? amount);
  const tierLabel     = payload.tier_label ?? null;

  // ── Paso 1: consultar historial Yappy ────────────────────────────────────────
  let match: any = null;
  let apiError: string | null = null;

  if (API_KEY && SECRET_KEY) {
    try {
      const token = await getYappyToken();
      const txs   = await getMovements(token);
      match       = findMatch(txs, amount);

      if (match) {
        const txId      = String(match.transactionId ?? match.id ?? match.transaction_id ?? '');
        const descripcion = txId ? `yappy_link:${txId}` : `yappy_link:${Date.now()}`;

        // Idempotencia: si ya fue acreditado con este txId, no duplicar
        if (txId) {
          const { data: existing } = await supabaseAdmin
            .from('wallet_transactions')
            .select('id')
            .ilike('descripcion', `yappy_link:${txId}`)
            .maybeSingle();
          if (existing) {
            console.log(`[yappy-link-confirm] txId ${txId} ya acreditado — ignorando`);
            return jsonRes({ verified: true, credited: true, duplicate: true });
          }
        }

        const { error: rpcErr } = await supabaseAdmin.rpc('credit_wallet', {
          p_user_id:     profile.id,
          p_monto:       amount,
          p_tipo:        'recarga_yappy',
          p_descripcion: descripcion,
        });

        if (rpcErr) {
          console.error('[yappy-link-confirm] credit_wallet error:', rpcErr.message);
          return jsonRes({ error: 'Error acreditando wallet' }, 500);
        }

        console.log(`[yappy-link-confirm] VERIFICADO: user=${profile.id}, amount=${amount}, txId=${txId}`);
        return jsonRes({ verified: true, credited: true, amount });
      }

      console.log(`[yappy-link-confirm] no match en historial para amount=${amount}`);
    } catch (e) {
      apiError = (e as Error).message;
      console.warn('[yappy-link-confirm] API Yappy no disponible:', apiError);
    }
  } else {
    apiError = 'Credenciales Yappy no configuradas';
    console.warn('[yappy-link-confirm]', apiError);
  }

  // ── Paso 2: no encontrado → crear pending_recarga para admin ─────────────────
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from('pending_recargas')
    .select('id')
    .eq('user_id', profile.id)
    .eq('amount_paid', amount)
    .eq('status', 'pending')
    .gte('created_at', fiveMinsAgo)
    .maybeSingle();

  if (existing) {
    return jsonRes({ error: 'Ya tienes una solicitud pendiente para este monto — el admin la revisará pronto' }, 409);
  }

  const { error: insertErr } = await supabaseAdmin.from('pending_recargas').insert({
    user_id:        profile.id,
    tier_label:     tierLabel,
    amount_paid:    amount,
    amount_credito: amountCredito,
    notas:          apiError ? `API no disponible: ${apiError}` : 'No encontrado en historial del momento',
  });

  if (insertErr) {
    console.error('[yappy-link-confirm] insert pending error:', insertErr.message);
    return jsonRes({ error: 'Error creando solicitud' }, 500);
  }

  console.log(`[yappy-link-confirm] PENDIENTE: user=${profile.id}, amount=${amount}`);
  return jsonRes({ verified: false, pending: true, amount });
});
