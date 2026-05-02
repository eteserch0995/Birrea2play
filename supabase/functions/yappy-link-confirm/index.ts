/**
 * yappy-link-confirm — Edge Function
 * Acredita el wallet cuando el usuario confirma que pagó via el link estático de Yappy.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const authUser = await requireUser(req);
  if (!authUser) return jsonRes({ error: 'No autorizado' }, 401);

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  if (!profile) return jsonRes({ error: 'Perfil no encontrado' }, 403);

  let payload: { amount?: number };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 500) {
    return jsonRes({ error: 'Monto inválido (mín $1.00, máx $500.00)' }, 400);
  }

  const descripcion = `yappy_link:${Date.now()}`;

  const { error: rpcError } = await supabaseAdmin.rpc('credit_wallet', {
    p_user_id:     profile.id,
    p_monto:       amount,
    p_tipo:        'recarga_yappy',
    p_descripcion: descripcion,
  });

  if (rpcError) {
    console.error('[yappy-link-confirm] credit_wallet error:', rpcError.message);
    return jsonRes({ error: 'Error acreditando wallet' }, 500);
  }

  console.log(`[yappy-link-confirm] acreditado: user=${profile.id}, amount=${amount}`);
  return jsonRes({ ok: true, amount });
});
