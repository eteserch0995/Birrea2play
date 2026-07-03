/**
 * yappy-ipn — Edge Function
 * verify_jwt = false  (deployed with --no-verify-jwt)
 *
 * Yappy llama GET /?orderId=...&hash=...&status=E|C|X&domain=...
 * Las notificaciones nuevas también incluyen confirmationNumber, que forma
 * parte del mensaje firmado.
 * Valida HMAC-SHA256 según manual Botón de Pago Yappy V2, acredita wallet / inscribe / confirma invitado.
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

function getYappyHmacSecret(): string {
  const secretBase64 = SECRET_KEY_B64;
  if (!secretBase64) throw new Error('Missing YAPPY_SECRET_KEY');

  let decoded = '';
  try { decoded = atob(secretBase64); }
  catch (e) {
    throw new Error('YAPPY_SECRET_KEY is not valid Base64');
  }

  const parts = decoded.split('.');
  if (!decoded.includes('.') || parts.length < 2 || !parts[0]) {
    throw new Error('Invalid YAPPY_SECRET_KEY format — decoded Base64 must contain a dot separator (hmacKey.apiKey)');
  }
  return parts[0];
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

serve(async (req) => {
  console.log('YAPPY_IPN_CODE_VERSION', { version: '2026-06-24-v7-confirmation-number' });

  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'GET')    return err({ success: false, error: 'Method not allowed' }, 405);

  const url     = new URL(req.url);
  const orderId = url.searchParams.get('orderId') ?? url.searchParams.get('orderid') ?? '';
  const hash    = url.searchParams.get('hash')    ?? url.searchParams.get('Hash')    ?? '';
  const status  = url.searchParams.get('status')  ?? url.searchParams.get('Status')  ?? '';
  const domain  = url.searchParams.get('domain')  ?? url.searchParams.get('Domain')  ?? '';
  const confirmationNumber =
       url.searchParams.get('confirmationNumber')
    ?? url.searchParams.get('ConfirmationNumber')
    ?? url.searchParams.get('confirmationnumber')
    ?? '';

  console.log('YAPPY_IPN_PARAMS', {
    orderId,
    status,
    domain,
    hasHash: !!hash,
    hasConfirmationNumber: !!confirmationNumber,
  });

  if (!orderId || !hash || !status || !domain) {
    return err({ success: false, error: 'Missing required IPN params' });
  }

  if (domain !== DOMAIN_EXPECTED) {
    console.error('YAPPY_IPN_DOMAIN_MISMATCH', { received: domain, expected: DOMAIN_EXPECTED });
    return err({ success: false, error: 'Invalid domain' });
  }

  let secret: string;
  try { secret = getYappyHmacSecret(); }
  catch (e) {
    console.error('YAPPY_IPN_SECRET_ERROR', { error: (e as Error).message });
    return err({ success: false, error: 'Server config error' }, 500);
  }

  // Formato anterior: orderId + status + domain
  // Formato actual:   orderId + status + domain + confirmationNumber
  // Se conserva el anterior para procesar reintentos de órdenes antiguas.
  const messageOld = `${orderId}${status}${domain}`;
  const signedMessages = confirmationNumber
    ? [
        { format: 'confirmation-number', value: `${messageOld}${confirmationNumber}` },
        { format: 'legacy', value: messageOld },
      ]
    : [{ format: 'legacy', value: messageOld }];

  let matchedFormat = '';
  for (const candidate of signedMessages) {
    const expectedHash = await hmacSha256Hex(secret, candidate.value);
    if (timingSafeHexEqual(expectedHash, hash)) {
      matchedFormat = candidate.format;
      break;
    }
  }

  if (!matchedFormat) {
    console.error('YAPPY_IPN_INVALID_HASH', {
      orderId,
      status,
      domain,
      hasConfirmationNumber: !!confirmationNumber,
    });
    return err({ success: false, error: 'Invalid hash' }, 401);
  }

  console.log('YAPPY_IPN_HASH_OK', { orderId, format: matchedFormat });

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
    // Para tipo=evento: reintentar inscribir en caso de que el IPN anterior haya retornado 500
    // después de actualizar yappy_orders pero antes de completar la inscripción.
    // inscribir_yappy_evento es idempotente: si ya está confirmado, no hace nada.
    if ((order.tipo ?? 'recarga') === 'evento' && order.event_id) {
      const { error: retryErr } = await supabase.rpc('inscribir_yappy_evento', {
        p_user_id:  order.user_id,
        p_event_id: order.event_id,
        p_monto:    order.amount,
        p_order_id: orderId,
      });
      if (retryErr) {
        console.error('YAPPY_IPN_RETRY_INSCRIBIR_ERROR', { orderId, error: retryErr.message });
      } else {
        console.log('YAPPY_IPN_RETRY_INSCRIBIR_OK', { orderId });
      }
    } else if (order.tipo === 'donacion') {
      // Mismo blindaje que 'evento': si un IPN previo marcó la orden 'executed' pero
      // registrar_donacion falló (retornó 500), Yappy reintenta y aquí re-registramos.
      // registrar_donacion es idempotente por order_ref (ON CONFLICT), así que es seguro.
      const { error: retryErr } = await supabase.rpc('registrar_donacion', {
        p_user_id:       order.user_id,
        p_monto:         order.amount,
        p_metodo:        'yappy',
        p_order_ref:     `yappy:${orderId}`,
        p_fee:           0,
        p_monto_cobrado: order.amount,
      });
      if (retryErr) {
        console.error('YAPPY_IPN_RETRY_DONACION_ERROR', { orderId, error: retryErr.message });
      } else {
        console.log('YAPPY_IPN_RETRY_DONACION_OK', { orderId });
      }
    } else if (order.tipo === 'rifa' && order.event_id) {
      // Idempotente por order_ref: re-confirmar tickets si un IPN previo fallo tras 'executed'.
      const { error: retryErr } = await supabase.rpc('raffle_confirm_tickets_paid', {
        p_event_id:  order.event_id,
        p_user_id:   order.user_id,
        p_quantity:  Math.round(Number(order.amount)),
        p_order_ref: `yappy:${orderId}`,
      });
      if (retryErr) console.error('YAPPY_IPN_RETRY_RIFA_ERROR', { orderId, error: retryErr.message });
      else console.log('YAPPY_IPN_RETRY_RIFA_OK', { orderId });
    }
    return ok({ success: true, note: 'Already processed' });
  }

  const normalizedStatus = status.toLowerCase();
  const statusMap: Record<string, string> = { e: 'executed', c: 'cancelled', x: 'expired' };
  const newStatus = statusMap[normalizedStatus] ?? 'unknown';

  await supabase
    .from('yappy_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('order_id', orderId);

  if (newStatus === 'executed') {
    const orderTipo = order.tipo ?? 'recarga';
    console.log('YAPPY_IPN_TIPO', { orderId, tipo: orderTipo, event_id: order.event_id, guest_id: order.guest_id });

    if (orderTipo === 'compra_tienda') {
      // Order is created client-side after polling detects 'executed' — nothing to do here
      console.log('YAPPY_IPN_COMPRA_TIENDA', { orderId, userId: order.user_id, amount: order.amount });

    } else if (orderTipo === 'invitado' && order.guest_id) {
      // Confirmar invitado pagado con Yappy
      const { error: rpcErr } = await supabase.rpc('confirmar_invitado_yappy', {
        p_guest_id: order.guest_id,
        p_monto:    order.amount,
        p_order_id: orderId,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_INVITADO_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Guest confirmation failed' }, 500);
      }
      console.log('YAPPY_IPN_INVITADO_CONFIRMED', { orderId, guest_id: order.guest_id });

    } else if (orderTipo === 'evento' && order.event_id) {
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

    } else if (orderTipo === 'rifa' && order.event_id) {
      // Tickets de rifa — confirmar server-side (idempotente por order_ref). amount = cantidad.
      const { error: rpcErr } = await supabase.rpc('raffle_confirm_tickets_paid', {
        p_event_id:  order.event_id,
        p_user_id:   order.user_id,
        p_quantity:  Math.round(Number(order.amount)),
        p_order_ref: `yappy:${orderId}`,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_RIFA_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Raffle ticket confirmation failed' }, 500);
      }
      console.log('YAPPY_IPN_RIFA_CONFIRMED', { orderId, userId: order.user_id, quantity: order.amount });

    } else if (orderTipo === 'abono_cancha' && order.cancha_reserva_id) {
      // Confirmar abono de reserva de cancha — fee siempre $0.25
      const { error: rpcErr } = await supabase.rpc('confirmar_abono_cancha_yappy', {
        p_reserva_id:  order.cancha_reserva_id,
        p_gestor_id:   order.user_id,
        p_monto_total: order.amount,
        p_fee:         0.25,
        p_order_id:    orderId,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_ABONO_CANCHA_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Abono cancha confirmation failed' }, 500);
      }
      console.log('YAPPY_IPN_ABONO_CANCHA_CONFIRMED', { orderId, reservaId: order.cancha_reserva_id });

    } else if (orderTipo === 'wc_enrollment' && order.wc_enrollment_id) {
      // Inscripción al Mundial 2026 (Survivor o Polla)
      const { error: rpcErr } = await supabase.rpc('wc_pay_enrollment_yappy', {
        p_user_id:       order.user_id,
        p_enrollment_id: order.wc_enrollment_id,
        p_amount:        order.amount,
        p_yappy_order_id: orderId,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_WC_ENROLL_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Mundial enrollment failed' }, 500);
      }
      console.log('YAPPY_IPN_WC_ENROLLED', { orderId, userId: order.user_id, enrollmentId: order.wc_enrollment_id });

    } else if (orderTipo === 'donacion') {
      // Recaudo Solidario (Venezuela) — registrar donación. NO toca wallet. Idempotente por order_ref.
      const { error: rpcErr } = await supabase.rpc('registrar_donacion', {
        p_user_id:       order.user_id,
        p_monto:         order.amount,
        p_metodo:        'yappy',
        p_order_ref:     `yappy:${orderId}`,
        p_fee:           0,
        p_monto_cobrado: order.amount,
      });
      if (rpcErr) {
        console.error('YAPPY_IPN_DONACION_ERROR', { orderId, error: rpcErr.message });
        return err({ success: false, error: 'Donation record failed' }, 500);
      }
      console.log('YAPPY_IPN_DONACION_OK', { orderId, userId: order.user_id, amount: order.amount });

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
