/**
 * yappy-boton — Edge Function
 *
 * Crea órdenes de pago a través del Botón de Pago Yappy V2.
 * Base URL: https://apipagosbg.bgeneral.cloud  (globalmente accesible, sin restricción de DNS)
 *
 * Variables de entorno requeridas (Supabase dashboard > Project settings > Edge Functions):
 *   YAPPY_MERCHANT_ID   — ID del comercio (UUID de Yappy Comercial > Métodos de cobro > Botón de Pago)
 *   YAPPY_SECRET_KEY    — Clave secreta en base64 (generada en Yappy Comercial, solo visible una vez)
 *   YAPPY_DOMAIN        — URL del dominio configurado en Yappy Comercial (ej. https://birrea2play.com)
 *   YAPPY_IPN_URL       — URL pública del endpoint yappy-ipn (ej. https://<ref>.supabase.co/functions/v1/yappy-ipn)
 *   SUPABASE_URL        — auto-poblada
 *   SUPABASE_SERVICE_ROLE_KEY — auto-poblada
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE   = 'https://apipagosbg.bgeneral.cloud';
const MERCHANT_ID  = (Deno.env.get('YAPPY_MERCHANT_ID')  ?? '').trim();
const SECRET_KEY   = (Deno.env.get('YAPPY_SECRET_KEY')   ?? '').trim();
const DOMAIN       = (Deno.env.get('YAPPY_DOMAIN')       ?? 'https://birrea2play.com').trim();

// SECRET_KEY is base64-encoded "<hmac_key>.<api_key>"
// Index 0 → HMAC signing (used in IPN verification)
// Index 1 → x-api-key header for Yappy API requests
function getSecretSegment(index: number): string {
  try { return atob(SECRET_KEY).split('.')[index] ?? ''; }
  catch { return ''; }
}
const IPN_URL = 'https://rumreditrvxkcnlhawut.supabase.co/functions/v1/yappy-ipn';

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
      'x-api-key': getSecretSegment(1),
    },
    body: JSON.stringify({ merchantId: MERCHANT_ID, urlDomain: DOMAIN }),
  });
  const data = await res.json();
  if (!res.ok || !data.body?.token) {
    throw new Error(`Yappy validate-merchant falló (HTTP ${res.status}): ${JSON.stringify(data.status ?? data)}`);
  }
  const epochTime = data.body.epochTime ?? data.body.epoch_time ?? data.epochTime ?? Math.floor(Date.now() / 1000);
  // DEBUG: exponer respuesta completa de validate/merchant
  console.log('[yappy-boton] validate/merchant raw:', JSON.stringify(data));
  return { token: data.body.token, epochTime };
}

async function createOrder(
  sessionToken: string,
  epochTime: number,
  orderId: string,
  amount: number,
  aliasYappy: string,
): Promise<{ transactionId: string; token: string; documentName: string }> {
  const total = amount.toFixed(2);
  const orderBody = {
    merchantId:     MERCHANT_ID,
    orderId,
    domain:         DOMAIN,
    paymentDate:    epochTime,
    aliasYappy,
    ipnUrl:         IPN_URL,   // variante 1
    urlIPN:         IPN_URL,   // variante 2 — algunos docs de Yappy usan urlIPN
    notificationUrl: IPN_URL,  // variante 3 — por si acaso
    discount:       '0.00',
    taxes:          '0.00',
    subtotal:       total,
    total,
  };
  console.log('[yappy-boton] payment-wc body:', JSON.stringify({
    ...orderBody,
    // No loguear token ni claves sensibles
  }));
  const res = await fetch(`${YAPPY_BASE}/payments/payment-wc`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': sessionToken,
      'x-api-key':     getSecretSegment(1),
    },
    body: JSON.stringify(orderBody),
  });
  const data = await res.json();
  console.log('[yappy-boton] payment-wc response:', JSON.stringify({
    step: 'create_order',
    yappyStatusCode: data.status?.code ?? '',
    yappyDescription: data.status?.description ?? '',
    payloadSentSafe: { merchantId: MERCHANT_ID, orderId, domain: DOMAIN, paymentDate: epochTime, aliasYappy, ipnUrl: IPN_URL, discount: '0.00', taxes: '0.00', subtotal: total, total },
  }));

  const statusCode = data.status?.code ?? '';
  const statusDesc = data.status?.description ?? '';

  // "0000" es éxito — cualquier otro código es error
  if (statusCode && statusCode !== '0000') {
    const errMessages: Record<string, string> = {
      'E007':      'Este pedido ya fue registrado',
      'E009':      'ID de orden inválido (máx 15 caracteres)',
      'E010':      'Monto incorrecto',
      'E011':      'Error en el dominio configurado — verifica YAPPY_DOMAIN en secrets',
      'YAPPY-004': 'Campo vacío o nombre incorrecto en el request',
    };
    throw new Error(errMessages[statusCode] ?? `Yappy ${statusCode}: ${statusDesc || JSON.stringify(data)}`);
  }

  if (!res.ok && !data.body) {
    throw new Error(`Yappy HTTP ${res.status}: ${statusDesc || JSON.stringify(data)}`);
  }

  if (!data.body?.transactionId) {
    throw new Error(`Yappy respondió ${statusCode || 'OK'} pero no devolvió transactionId`);
  }

  return {
    transactionId: data.body.transactionId,
    token:         data.body.token,
    documentName:  data.body.documentName,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  if (!MERCHANT_ID || !SECRET_KEY) {
    console.error('[yappy-boton] faltan YAPPY_MERCHANT_ID / YAPPY_SECRET_KEY');
    return jsonRes({ error: 'Servidor mal configurado — contacta soporte' }, 500);
  }

  const authUser = await requireUser(req);
  if (!authUser) return jsonRes({ error: 'No autorizado' }, 401);

  // Resolver public.users.id desde auth.users.id
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!profile) {
    console.error('[yappy-boton] perfil no encontrado para auth_id:', authUser.id);
    return jsonRes({ error: 'Perfil no encontrado' }, 403);
  }

  let payload: { action?: string; amount?: number; phoneNumber?: string; tipo?: string; event_id?: string };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  if (payload.action !== 'create-order') {
    return jsonRes({ error: `Acción desconocida: ${payload.action}` }, 400);
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return jsonRes({ error: 'Monto inválido (mín $1.00, máx $500.00)' }, 400);
  }

  // aliasYappy: solo dígitos, número panameño sin prefijo de país
  const aliasYappy = (payload.phoneNumber ?? '').replace(/\D/g, '');
  if (!aliasYappy) {
    return jsonRes({ error: 'Ingresa tu número Yappy' }, 400);
  }

  if (!MERCHANT_ID) return jsonRes({ error: 'Servidor mal configurado — falta MERCHANT_ID' }, 500);
  if (!DOMAIN)      return jsonRes({ error: 'Servidor mal configurado — falta DOMAIN' }, 500);

  // orderId: máx 15 chars alfanuméricos, único por transacción
  const prefix  = authUser.id.replace(/-/g, '').slice(0, 2).toUpperCase();
  const orderId = (prefix + Date.now().toString()).slice(0, 15);

  console.log('YAPPY_CREATE_ORDER_CODE_VERSION', { version: '2026-05-03-debug-v3' });
  console.log('YAPPY_CREATE_ORDER_START', {
    orderId,
    amount,
    aliasLast4: aliasYappy.slice(-4),
    domain: DOMAIN,
    ipnUrl: IPN_URL,
  });

  try {
    const { token: sessionToken, epochTime } = await validateMerchant();
    const orderData = await createOrder(sessionToken, epochTime, orderId, amount, aliasYappy);

    console.log('YAPPY_CREATE_ORDER_SUCCESS', {
      orderId,
      transactionId: orderData.transactionId,
      hasToken: !!orderData.token,
      hasDocumentName: !!orderData.documentName,
    });

    // Guardar orden pendiente en DB para tracking y IPN
    const tipo     = payload.tipo === 'evento' ? 'evento' : 'recarga';
    const event_id = tipo === 'evento' ? (payload.event_id ?? null) : null;
    const { error: dbErr } = await supabaseAdmin.from('yappy_orders').upsert({
      order_id:       orderId,
      transaction_id: orderData.transactionId,
      user_id:        profile.id,
      amount,
      status:         'pending',
      tipo,
      event_id,
    }, { onConflict: 'order_id' });

    if (dbErr) console.error('YAPPY_DB_SAVE_ERROR', { orderId, error: dbErr.message });
    else        console.log('YAPPY_ORDER_SAVED', { orderId, userId: profile.id, amount });

    return jsonRes({ ok: true, orderId, ...orderData });
  } catch (e) {
    const msg = (e as Error).message;
    console.error('YAPPY_CREATE_ORDER_ERROR', { orderId, error: msg });
    return jsonRes({ error: msg }, 502);
  }
});
