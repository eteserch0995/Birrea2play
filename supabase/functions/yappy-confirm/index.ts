/**
 * yappy-confirm — Edge Function
 * El celular detectó el pago Yappy y pide al servidor acreditar el wallet.
 * Requiere: Authorization: Bearer <JWT del usuario>
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  try {
    // 1. Verificar JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'No autorizado' }, 401);
    const jwt = authHeader.replace('Bearer ', '');

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !user) return json({ error: 'No autorizado' }, 401);

    // 2. Resolver public.users.id desde auth.users.id
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (profErr || !profile) {
      console.error('[yappy-confirm] perfil no encontrado para auth_id:', user.id);
      return json({ error: 'Perfil no encontrado' }, 403);
    }

    // 3. Parsear body — SOLO confiamos en `reference` del cliente. El `amount`
    //    se lee server-side desde `yappy_orders.amount` (no aceptar amount del cliente:
    //    bypass de cobro encontrado por pentest 2026-05-21).
    let body: { reference?: string };
    try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }

    const { reference } = body;
    if (!reference) {
      return json({ error: 'Falta reference' }, 400);
    }

    // 4. Buscar orden Yappy real (debe estar 'executed' y pertenecer al user del JWT)
    //    yappy_orders.order_id es el reference que el cliente envía.
    const { data: yappyOrder, error: ordErr } = await supabaseAdmin
      .from('yappy_orders')
      .select('user_id, amount, status')
      .eq('order_id', reference)
      .maybeSingle();

    if (ordErr) {
      console.error('[yappy-confirm] error buscando yappy_orders:', ordErr.message);
      return json({ error: 'Error verificando orden' }, 500);
    }
    if (!yappyOrder) {
      console.warn('[yappy-confirm] orden no encontrada:', reference);
      return json({ error: 'Orden no encontrada' }, 404);
    }
    if (yappyOrder.user_id !== profile.id) {
      console.warn('[yappy-confirm] orden no pertenece al user JWT', {
        order_user: yappyOrder.user_id, jwt_user: profile.id,
      });
      return json({ error: 'Orden no pertenece a tu sesión' }, 403);
    }
    if (yappyOrder.status !== 'executed') {
      return json({ error: `Orden en estado ${yappyOrder.status} (esperado 'executed')` }, 409);
    }

    // 5. Monto desde DB (no del cliente). Redondear a 2 decimales.
    const amountRounded = Math.round(Number(yappyOrder.amount) * 100) / 100;
    if (!Number.isFinite(amountRounded) || amountRounded <= 0 || amountRounded > 1000) {
      return json({ error: 'Monto inválido en orden' }, 400);
    }

    // 6. Idempotencia: verificar si ya se acreditó esta referencia
    const descripcion = `yappy:${reference}`;
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('wallet_transactions')
      .select('id')
      .eq('descripcion', descripcion)
      .maybeSingle();

    if (existErr) {
      console.error('[yappy-confirm] error verificando duplicado:', existErr.message);
      return json({ error: 'Error verificando duplicado' }, 500);
    }
    if (existing) return json({ success: true, duplicate: true });

    // 7. Acreditar wallet — RPC con service_role bypassa el caller check interno.
    const { error: rpcError } = await supabaseAdmin.rpc('credit_wallet', {
      p_user_id:     profile.id,
      p_monto:       amountRounded,
      p_tipo:        'recarga_yappy',
      p_descripcion: descripcion,
    });

    if (rpcError) {
      console.error('[yappy-confirm] credit_wallet error:', rpcError.message);
      return json({ error: 'Error acreditando wallet' }, 500);
    }

    return json({ success: true, amount: amountRounded });
  } catch (e) {
    console.error('[yappy-confirm] error no capturado:', (e as Error).message);
    return json({ error: 'Error interno' }, 500);
  }
});
