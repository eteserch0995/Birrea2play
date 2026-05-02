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

    // 3. Parsear body
    let body: { userId?: string; amount?: number | string; reference?: string };
    try { body = await req.json(); } catch { return json({ error: 'Body inválido' }, 400); }

    const { userId, amount, reference } = body;
    if (!userId || amount === undefined || !reference) {
      return json({ error: 'Faltan campos requeridos' }, 400);
    }

    // 4. Verificar que el userId del body coincide con el perfil del JWT
    if (userId !== profile.id) {
      console.warn('[yappy-confirm] userId no coincide', { enviado: userId, perfil: profile.id });
      return json({ error: 'userId no coincide con sesión' }, 403);
    }

    // 5. Validar monto
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0 || amountNum > 1000) {
      return json({ error: 'Monto inválido' }, 400);
    }
    // Redondear a 2 decimales para evitar acreditar $9.999999 como $10
    const amountRounded = Math.round(amountNum * 100) / 100;

    // 6. Idempotencia: verificar si ya se procesó esta referencia
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

    // 7. Acreditar wallet — RPC firma: credit_wallet(p_user_id, p_monto, p_tipo, p_descripcion)
    // FIX #10: usar amountRounded para evitar acreditar montos con diferencias de redondeo flotante
    const { error: rpcError } = await supabaseAdmin.rpc('credit_wallet', {
      p_user_id:     userId,
      p_monto:       amountRounded,
      p_tipo:        'recarga_yappy',
      p_descripcion: descripcion,
    });

    if (rpcError) {
      console.error('[yappy-confirm] credit_wallet error:', rpcError.message);
      return json({ error: 'Error acreditando wallet' }, 500);
    }

    return json({ success: true });
  } catch (e) {
    console.error('[yappy-confirm] error no capturado:', (e as Error).message);
    return json({ error: 'Error interno' }, 500);
  }
});
