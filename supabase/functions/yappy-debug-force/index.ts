/**
 * yappy-debug-force — SOLO PARA DEBUG/TEST
 * Fuerza una orden a 'executed' para verificar si el polling del frontend funciona.
 * Solo activo si ENABLE_YAPPY_DEBUG=true en los secrets.
 * POST { orderId: string }
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ENABLE_DEBUG  = Deno.env.get('ENABLE_YAPPY_DEBUG') === 'true';
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_SVC  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  if (!ENABLE_DEBUG) {
    return new Response(JSON.stringify({ error: 'Debug mode disabled' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { orderId } = await req.json().catch(() => ({}));
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'orderId requerido' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Buscar orden
  const { data: order } = await supabase
    .from('yappy_orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!order) {
    return new Response(JSON.stringify({ error: 'Orden no encontrada', orderId }), {
      status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Forzar executed
  await supabase
    .from('yappy_orders')
    .update({ status: 'executed', updated_at: new Date().toISOString() })
    .eq('order_id', orderId);

  // Acreditar wallet (idempotente)
  const descripcion = `yappy:${orderId}`;
  const { data: existing } = await supabase
    .from('wallet_transactions').select('id').eq('descripcion', descripcion).maybeSingle();

  let credited = false;
  if (!existing) {
    const { error: rpcErr } = await supabase.rpc('credit_wallet', {
      p_user_id:     order.user_id,
      p_monto:       order.amount,
      p_tipo:        'recarga_yappy',
      p_descripcion: descripcion,
    });
    credited = !rpcErr;
  }

  console.log('YAPPY_DEBUG_FORCE_EXECUTED', { orderId, credited, userId: order.user_id });

  return new Response(JSON.stringify({
    success: true, orderId, status: 'executed', credited,
    message: credited ? 'Orden forzada a executed + wallet acreditada' : 'Orden forzada a executed (ya estaba acreditada)',
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
