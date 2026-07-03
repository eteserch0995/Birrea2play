/**
 * yappy-boton — Edge Function
 *
 * Crea órdenes de pago a través del Botón de Pago Yappy V2.
 * Base URL: https://apipagosbg.bgeneral.cloud  (globalmente accesible, sin restricción de DNS)
 *
 * Variables de entorno requeridas:
 *   YAPPY_MERCHANT_ID, YAPPY_SECRET_KEY, YAPPY_DOMAIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE   = 'https://apipagosbg.bgeneral.cloud';
const MERCHANT_ID  = (Deno.env.get('YAPPY_MERCHANT_ID')  ?? '').trim();
const SECRET_KEY   = (Deno.env.get('YAPPY_SECRET_KEY')   ?? '').trim();
const DOMAIN       = (Deno.env.get('YAPPY_DOMAIN')       ?? 'https://birrea2play.com').trim();

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
    merchantId:      MERCHANT_ID,
    orderId,
    domain:          DOMAIN,
    paymentDate:     epochTime,
    aliasYappy,
    ipnUrl:          IPN_URL,
    urlIPN:          IPN_URL,
    notificationUrl: IPN_URL,
    discount:        '0.00',
    taxes:           '0.00',
    subtotal:        total,
    total,
  };
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
    yappyStatusCode: data.status?.code ?? '',
    yappyDescription: data.status?.description ?? '',
  }));

  const statusCode = data.status?.code ?? '';
  const statusDesc = data.status?.description ?? '';

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

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!profile) {
    console.error('[yappy-boton] perfil no encontrado para auth_id:', authUser.id);
    return jsonRes({ error: 'Perfil no encontrado' }, 403);
  }

  let payload: { action?: string; amount?: number; phoneNumber?: string; tipo?: string; event_id?: string; guest_id?: string; wc_enrollment_id?: string; cancha_reserva_id?: string };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  if (payload.action !== 'create-order') {
    return jsonRes({ error: `Acción desconocida: ${payload.action}` }, 400);
  }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return jsonRes({ error: 'Monto inválido (mín $1.00, máx $500.00)' }, 400);
  }

  const aliasYappy = (payload.phoneNumber ?? '').replace(/\D/g, '');
  if (!aliasYappy) {
    return jsonRes({ error: 'Ingresa tu número Yappy' }, 400);
  }

  // Determinar tipo + ids ANTES de cobrar (era despues de createOrder).
  const rawTipo = payload.tipo ?? 'recarga';
  const tipo    = ['evento', 'invitado', 'recarga', 'compra_tienda', 'wc_enrollment', 'abono_cancha', 'donacion', 'rifa'].includes(rawTipo) ? rawTipo : 'recarga';
  const event_id          = (tipo === 'evento' || tipo === 'rifa') ? (payload.event_id ?? null) : null;
  const guest_id          = tipo === 'invitado'      ? (payload.guest_id          ?? null) : null;
  const wc_enrollment_id  = tipo === 'wc_enrollment' ? (payload.wc_enrollment_id  ?? null) : null;
  const cancha_reserva_id = tipo === 'abono_cancha'  ? (payload.cancha_reserva_id ?? null) : null;

  if (tipo === 'wc_enrollment' && !wc_enrollment_id) return jsonRes({ error: 'wc_enrollment_id requerido' }, 400);
  if (tipo === 'abono_cancha'  && !cancha_reserva_id) return jsonRes({ error: 'cancha_reserva_id requerido' }, 400);
  if ((tipo === 'evento' || tipo === 'rifa') && !event_id) return jsonRes({ error: 'event_id requerido' }, 400);
  if (tipo === 'invitado' && !guest_id) return jsonRes({ error: 'guest_id requerido' }, 400);

  // VALIDACION DE MONTO server-side: el cobro debe cubrir el precio real del recurso.
  // Cierra el subpago (ej. $0.01) en evento/invitado — el monto NO se confia del cliente.
  if (tipo === 'evento') {
    const { data: ev } = await supabaseAdmin.from('events').select('precio').eq('id', event_id).maybeSingle();
    if (!ev) return jsonRes({ error: 'Evento no encontrado' }, 404);
    if (amount + 0.001 < Number(ev.precio)) {
      return jsonRes({ error: `Monto insuficiente: el evento cuesta $${Number(ev.precio).toFixed(2)}` }, 400);
    }
  } else if (tipo === 'invitado') {
    const { data: g } = await supabaseAdmin.from('event_guests').select('event_id').eq('id', guest_id).maybeSingle();
    if (!g?.event_id) return jsonRes({ error: 'Invitado no encontrado' }, 404);
    const { data: ev2 } = await supabaseAdmin.from('events').select('precio').eq('id', g.event_id).maybeSingle();
    if (!ev2) return jsonRes({ error: 'Evento no encontrado' }, 404);
    if (amount + 0.001 < Number(ev2.precio)) {
      return jsonRes({ error: `Monto insuficiente: el evento cuesta $${Number(ev2.precio).toFixed(2)}` }, 400);
    }
  }
  // rifa: amount = cantidad de tickets ($1 c/u), ya validado >= 1.

  const prefix  = authUser.id.replace(/-/g, '').slice(0, 2).toUpperCase();
  const orderId = (prefix + Date.now().toString()).slice(0, 15);

  console.log('YAPPY_CREATE_ORDER_START', {
    orderId, amount, tipo, aliasLast4: aliasYappy.slice(-4), domain: DOMAIN, ipnUrl: IPN_URL,
  });

  try {
    const { token: sessionToken, epochTime } = await validateMerchant();
    const orderData = await createOrder(sessionToken, epochTime, orderId, amount, aliasYappy);

    console.log('YAPPY_CREATE_ORDER_SUCCESS', { orderId, transactionId: orderData.transactionId });

    const { error: dbErr } = await supabaseAdmin.from('yappy_orders').upsert({
      order_id:           orderId,
      transaction_id:     orderData.transactionId,
      user_id:            profile.id,
      amount,
      status:             'pending',
      tipo,
      event_id,
      guest_id,
      wc_enrollment_id,
      cancha_reserva_id,
    }, { onConflict: 'order_id' });

    // FAIL-CLOSED: si no podemos registrar la orden, NO confirmamos el cobro (evita cobros
    // huerfanos que el IPN no podria atribuir). Con la constraint de tipo ya alineada
    // (abono_cancha/rifa), el insert no deberia fallar por tipo.
    if (dbErr) {
      console.error('YAPPY_DB_SAVE_ERROR', { orderId, error: dbErr.message });
      return jsonRes({ error: 'No se pudo registrar la orden. Intentá de nuevo.' }, 500);
    }
    console.log('YAPPY_ORDER_SAVED', { orderId, userId: profile.id, amount, tipo });

    return jsonRes({ ok: true, orderId, ...orderData });
  } catch (e) {
    const msg = (e as Error).message;
    console.error('YAPPY_CREATE_ORDER_ERROR', { orderId, error: msg });
    return jsonRes({ error: msg }, 502);
  }
});
