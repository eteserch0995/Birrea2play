/**
 * yappy-ipn — Edge Function
 * verify_jwt = false  (deployed with --no-verify-jwt)
 *
 * Yappy llama GET /?orderId=...&hash=...&status=E|C|X&domain=...
 * Valida HMAC-SHA256 según manual Botón de Pago Yappy V2, acredita wallet.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SECRET_KEY_B64  = Deno.env.get('YAPPY_SECRET_KEY')           ?? '';
const DOMAIN_EXPECTED = Deno.env.get('YAPPY_DOMAIN')               ?? 'https://birrea2play.com';
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')               ?? '';
const SUPABASE_SVC    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')  ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ok  = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
const err = (b: unknown, s = 400) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ─── Extraer clave HMAC según manual oficial Yappy V2 ─────────────────────────
// Buffer.from(CLAVE_SECRETA, 'base64').toString() → split('.') → [0]
function getYappyHmacSecret(): string {
  const secretBase64 = SECRET_KEY_B64;
  if (!secretBase64) throw new Error('Missing YAPPY_SECRET_KEY');

  let decoded = '';
  try {
    decoded = atob(secretBase64);
  } catch (e) {
    console.error('YAPPY_SECRET_BASE64_DECODE_FAILED', {
      base64Length: secretBase64.length,
      error: (e as Error).message,
    });
    throw new Error('YAPPY_SECRET_KEY is not valid Base64');
  }

  const parts = decoded.split('.');

  console.log('YAPPY_SECRET_FORMAT_CHECK', {
    hasSecretKey:    !!secretBase64,
    base64Length:    secretBase64.length,
    decodedLength:   decoded.length,
    hasDot:          decoded.includes('.'),
    partsCount:      parts.length,
    firstPartLength: parts[0]?.length ?? 0,
    secondPartLength: parts[1]?.length ?? 0,
  });

  const configuredMerchantId = Deno.env.get('YAPPY_MERCHANT_ID') ?? '';
  console.log('YAPPY_SECRET_MERCHANT_MATCH_CHECK', {
    hasDecodedMerchantPart:                !!parts[1],
    hasConfiguredMerchantId:               !!configuredMerchantId,
    decodedMerchantMatchesConfiguredMerchant: parts[1] === configuredMerchantId,
  });

  if (!decoded.includes('.') || parts.length < 2 || !parts[0]) {
    throw new Error(
      'Invalid YAPPY_SECRET_KEY format — decoded Base64 must contain a dot separator (hmacKey.apiKey)',
    );
  }

  return parts[0];
}

// ─── HMAC-SHA256 hex ──────────────────────────────────────────────────────────
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Handler ──────────────────────────────────────────────────────────────────
serve(async (req) => {
  console.log('YAPPY_IPN_CODE_VERSION', { version: '2026-05-03-v5-secret-guard' });

  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET')    return err({ success: false, error: 'Method not allowed' }, 405);

  console.log('YAPPY_IPN_HIT', { method: req.method, url: req.url, ua: req.headers.get('user-agent') });

  const url     = new URL(req.url);
  const orderId = url.searchParams.get('orderId') ?? url.searchParams.get('orderid') ?? '';
  const hash    = url.searchParams.get('hash')    ?? url.searchParams.get('Hash')    ?? '';
  const status  = url.searchParams.get('status')  ?? url.searchParams.get('Status')  ?? '';
  const domain  = url.searchParams.get('domain')  ?? url.searchParams.get('Domain')  ?? '';

  console.log('YAPPY_IPN_PARAMS', { orderId, status, domain, hasHash: !!hash });

  if (!orderId || !hash || !status || !domain) {
    console.error('YAPPY_IPN_MISSING_PARAMS', { orderId: !!orderId, hash: !!hash, status: !!status, domain: !!domain });
    return err({ success: false, error: 'Missing required IPN params' });
  }

  if (domain !== DOMAIN_EXPECTED) {
    console.error('YAPPY_IPN_DOMAIN_MISMATCH', { received: domain, expected: DOMAIN_EXPECTED });
    return err({ success: false, error: 'Invalid domain' });
  }

  // ── Validar hash usando status RAW (sin normalizar) ───────────────────────
  let secret: string;
  try { secret = getYappyHmacSecret(); }
  catch (e) {
    console.error('YAPPY_IPN_SECRET_ERROR', { error: (e as Error).message });
    return err({ success: false, error: 'Server config error' }, 500);
  }

  // El mensaje usa los valores exactos del querystring — status sin modificar
  const message      = `${orderId}${status}${domain}`;
  const expectedHash = await hmacSha256Hex(secret, message);

  console.log('YAPPY_IPN_HASH_CHECK', {
    orderId,
    status,
    domain,
    message,
    receivedFirst8:  hash.slice(0, 8),
    expectedFirst8:  expectedHash.slice(0, 8),
    receivedLength:  hash.length,
    expectedLength:  expectedHash.length,
  });

  if (expectedHash.toLowerCase() !== hash.toLowerCase()) {
    console.error('YAPPY_IPN_INVALID_HASH', {
      orderId,
      status,
      domain,
      receivedFirst8:  hash.slice(0, 8),
      expectedFirst8:  expectedHash.slice(0, 8),
    });
    return err({ success: false, error: 'Invalid hash' }, 401);
  }

  console.log('YAPPY_IPN_HASH_VALID', { orderId, status, domain });

  // ── Buscar orden ──────────────────────────────────────────────────────────
  const { data: order, error: findErr } = await supabase
    .from('yappy_orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  console.log('YAPPY_IPN_ORDER_LOOKUP', { orderId, found: !!order, error: findErr?.message });

  if (!order) {
    return ok({ success: true, note: 'Order not found — may have been processed already' });
  }

  if (order.status === 'executed') {
    console.log('YAPPY_IPN_ALREADY_EXECUTED', { orderId });
    return ok({ success: true, note: 'Already processed' });
  }

  // ── Mapear status (normalizar DESPUÉS de validar hash) ────────────────────
  const normalizedStatus = status.toLowerCase();
  const statusMap: Record<string, string> = { e: 'executed', c: 'cancelled', x: 'expired' };
  const newStatus = statusMap[normalizedStatus] ?? 'unknown';

  console.log('YAPPY_IPN_STATUS_MAPPED', { orderId, rawStatus: status, normalizedStatus, newStatus });

  await supabase
    .from('yappy_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('order_id', orderId);

  // ── Acreditar wallet O inscribir (solo si ejecutado, con idempotencia) ──────
  if (newStatus === 'executed') {
    const orderTipo = order.tipo ?? 'recarga';
    console.log('YAPPY_IPN_TIPO', { orderId, tipo: orderTipo, event_id: order.event_id });

    if (orderTipo === 'evento' && order.event_id) {
      // Inscripción directa — no tocar wallet
      const { error: rpcErr } = await supabase.rpc('inscribir_yappy_evento', {
        p_user_id:  order.user_id,
        p_event_id: order.event_id,
        p_monto:    order.amount,
        p_order_id: orderId,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_INSCRIBIR_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Event registration failed' }, 500);
      }
      console.log('YAPPY_IPN_EVENTO_INSCRITO', { orderId, userId: order.user_id, event_id: order.event_id });
    } else {
      // Recarga wallet normal
      const descripcion = `yappy:${orderId}`;
      const { data: existing } = await supabase
        .from('wallet_transactions').select('id').eq('descripcion', descripcion).maybeSingle();

      if (existing) {
        console.log('YAPPY_IPN_WALLET_ALREADY_CREDITED', { orderId });
      } else {
        const { error: rpcErr } = await supabase.rpc('credit_wallet', {
          p_user_id:     order.user_id,
          p_monto:       order.amount,
          p_tipo:        'recarga_yappy',
          p_descripcion: descripcion,
        });
        if (rpcErr) {
          console.error('YAPPY_IPN_CREDIT_WALLET_ERROR', { orderId, error: rpcErr.message });
          return err({ success: false, error: 'Wallet credit failed' }, 500);
        }
        console.log('YAPPY_IPN_WALLET_CREDITED', { orderId, userId: order.user_id, amount: order.amount });
      }
    }
  }

  return ok({ success: true, orderId, status: newStatus });
});
