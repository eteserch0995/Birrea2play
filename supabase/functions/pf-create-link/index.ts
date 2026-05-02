/**
 * pf-create-link — Edge Function
 * Crea un enlace de pago en PágueloFácil y devuelve la URL al frontend.
 * El CCLW nunca sale al cliente.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const IS_PROD        = Deno.env.get('PF_ENV') === 'production';
const PF_BASE        = IS_PROD
  ? 'https://secure.paguelofacil.com'
  : 'https://sandbox.paguelofacil.com';
const CCLW           = Deno.env.get('PF_CCLW') ?? '';
const RETURN_URL_RAW = Deno.env.get('PF_RETURN_URL') ?? '';
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function hexEncode(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: { userId: string; amount: number; descripcion?: string; tipo?: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { userId, amount, descripcion = 'Recarga Birrea2Play', tipo = 'recarga_tarjeta' } = body;
  if (!userId || !amount || amount < 1) {
    return new Response(JSON.stringify({ error: 'Monto mínimo $1.00' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Verificar JWT
  const supabase  = createClient(SUPABASE_URL, SUPABASE_SVCKEY);
  const userToken = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(userToken);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const { data: profile } = await supabase
    .from('users').select('id').eq('auth_id', user.id).single();
  if (!profile || profile.id !== userId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Crear registro de pago pendiente para idempotencia
  const ordenId = `pf-${userId.slice(0, 8)}-${Date.now()}`;
  await supabase.from('pf_pending_payments').insert({
    orden_id:   ordenId,
    user_id:    userId,
    amount,
    tipo,
    descripcion: descripcion.substring(0, 150),
  });

  // Generar enlace PágueloFácil
  const params = new URLSearchParams({
    CCLW,
    CMTN:       amount.toFixed(2),
    CDSC:       descripcion.substring(0, 150),
    RETURN_URL: hexEncode(RETURN_URL_RAW),
    PARM_1:     ordenId,
    EXPIRES_IN: '3600',
    CARD_TYPE:  'CARD,CLAVE',
  });

  try {
    const pfRes = await fetch(`${PF_BASE}/LinkDeamon.cfm`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
    const json = await pfRes.json();

    if (!json.success) {
      throw new Error(json.message ?? 'PF no generó enlace');
    }

    return new Response(JSON.stringify({ url: json.data.url, ordenId }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('pf-create-link error:', e.message);
    return new Response(JSON.stringify({ error: 'Error creando enlace de pago' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
