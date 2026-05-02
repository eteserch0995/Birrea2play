/**
 * yappy-checkout — Edge Function
 *
 * Flujo de redirección web (Botón de Pago Yappy V2 — web redirect).
 * Genera una URL firmada hacia pagosbg.bgeneral.com.
 * El IPN (yappy-ipn) se encarga de acreditar el wallet al confirmar.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE    = 'https://apipagosbg.bgeneral.cloud';
const YAPPY_PAY_URL = 'https://pagosbg.bgeneral.com';
const MERCHANT_ID   = (Deno.env.get('YAPPY_MERCHANT_ID') ?? '').trim();
const SECRET_KEY    = (Deno.env.get('YAPPY_SECRET_KEY')  ?? '').trim();
const DOMAIN        = (Deno.env.get('YAPPY_DOMAIN') ?? 'https://birrea2play.com').trim();
const IPN_URL       = 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/yappy-ipn';
const SUCCESS_BASE  = 'https://birrea2play.com/recarga-ok.html';
const FAIL_URL      = 'https://birrea2play.com/recarga-fail.html';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// SECRET_KEY = base64("<hmac_key>.<api_key>")
// Índice 0 → clave HMAC para firmar pedidos
// Índice 1 → x-api-key para peticiones a la API Yappy
function getSecretSegment(index: number): string {
  try { return atob(SECRET_KEY).split('.')[index] ?? ''; }
  catch { return ''; }
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SVCKEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(auth.replace('Bearer ', ''));
  return (error || !data?.user) ? null : data.user;
}

async function validateMerchant(): Promise<{ token: string; epochTime: number }> {
  const res = await fetch(`${YAPPY_BASE}/payments/validate/merchant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key':    getSecretSegment(1),
    },
    body: JSON.stringify({ merchantId: MERCHANT_ID, urlDomain: DOMAIN }),
  });
  const data = await res.json();
  console.log('[yappy-checkout] validate/merchant:', JSON.stringify(data));
  if (!res.ok || !data.body?.token) {
    throw new Error(`validate-merchant falló (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  const epochTime = data.body.epochTime ?? data.body.epoch_time ?? data.body.unixTimestamp ?? (Date.now() / 1000);
  return { token: data.body.token, epochTime };
}

async function buildSignature(
  total: string,
  subtotal: string,
  taxes: string,
  epochMs: number,
  orderId: string,
  successUrl: string,
  failUrl: string,
): Promise<string> {
  const hmacKey = getSecretSegment(0);
  const message = [total, MERCHANT_ID, subtotal, taxes, String(epochMs), 'YAP', 'VEN', orderId, successUrl, failUrl, DOMAIN].join('');
  const keyBytes  = new TextEncoder().encode(hmacKey);
  const msgBytes  = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig       = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  if (!MERCHANT_ID || !SECRET_KEY) {
    console.error('[yappy-checkout] faltan secrets YAPPY_MERCHANT_ID / YAPPY_SECRET_KEY');
    return jsonRes({ error: 'Servidor mal configurado — contacta soporte' }, 500);
  }

  const authUser = await requireUser(req);
  if (!authUser) return jsonRes({ error: 'No autorizado' }, 401);

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!profile) {
    console.error('[yappy-checkout] perfil no encontrado para auth_id:', authUser.id);
    return jsonRes({ error: 'Perfil no encontrado' }, 403);
  }

  let payload: { amount?: number };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return jsonRes({ error: 'Monto inválido (mín $1.00, máx $500.00)' }, 400);
  }

  const total    = amount.toFixed(2);
  const subtotal = total;
  const taxes    = '0.00';

  const prefix  = authUser.id.replace(/-/g, '').slice(0, 2).toUpperCase();
  const orderId = (prefix + Date.now().toString()).slice(0, 15);

  try {
    const { token: sessionToken, epochTime } = await validateMerchant();
    const epochMs    = Math.round(epochTime) * 1000;
    const successUrl = `${SUCCESS_BASE}?orderId=${orderId}&amount=${total}`;
    const signature  = await buildSignature(total, subtotal, taxes, epochMs, orderId, successUrl, FAIL_URL);

    const params = new URLSearchParams({
      merchantId:      MERCHANT_ID,
      orderId,
      subtotal,
      taxes,
      total,
      paymentDate:     String(epochMs),
      paymentMethod:   'YAP',
      transactionType: 'VEN',
      successUrl,
      failUrl:         FAIL_URL,
      cancelUrl:       FAIL_URL,
      domain:          DOMAIN,
      platform:        'desarrollopropiophp',
      jwtToken:        sessionToken,
      signature,
      sbx:             'no',
    });

    await supabaseAdmin.from('yappy_orders').upsert({
      order_id:       orderId,
      transaction_id: null,
      user_id:        profile.id,
      amount,
      status:         'pending',
    }, { onConflict: 'order_id' });

    const yappyUrl = `${YAPPY_PAY_URL}?${params.toString()}`;
    console.log(`[yappy-checkout] orden ${orderId} creada para user ${profile.id}, amount ${total}`);
    return jsonRes({ url: yappyUrl, orderId });
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[yappy-checkout] error:', msg);
    return jsonRes({ error: msg }, 502);
  }
});
