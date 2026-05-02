/**
 * yappy-check — Edge Function
 * Verifica si existe un pago Yappy con la referencia indicada.
 * Si está COMPLETED y el monto es correcto, acredita el wallet (idempotente).
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const YAPPY_BASE         = Deno.env.get('YAPPY_BASE_URL') ?? 'https://api.yappy.com.pa';
const API_KEY            = Deno.env.get('YAPPY_API_KEY')  ?? '';
const SECRET_KEY         = Deno.env.get('YAPPY_SECRET_KEY') ?? '';
const SEED_CODE          = Deno.env.get('YAPPY_SEED_CODE') ?? '';
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVCKEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

let _token: string | null = null;
let _tokenDate: string | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateHash(): Promise<string> {
  const message = SEED_CODE + API_KEY + todayStr();
  const data    = new TextEncoder().encode(message);
  const buf     = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getYappyToken(): Promise<string> {
  const today = todayStr();
  if (_token && _tokenDate === today) return _token;

  const hash = await generateHash();
  const res  = await fetch(`${YAPPY_BASE}/v1/session/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': API_KEY },
    body:    JSON.stringify({ body: { code: hash } }),
  });
  const json = await res.json();
  if (json.status?.code !== 'YP-0000') {
    throw new Error(`Yappy auth ${json.status?.code}`);
  }
  _token     = json.body.token as string;
  _tokenDate = today;
  return _token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: { userId: string; amount: number; reference: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { userId, amount, reference } = body;
  if (!userId || !amount || !reference) {
    return new Response(JSON.stringify({ error: 'Faltan parámetros' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  // Verificar JWT y ownership del userId
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

  try {
    // Idempotencia: ya fue procesado?
    const { data: existing } = await supabase
      .from('wallet_transactions')
      .select('id')
      .like('descripcion', `%${reference}%`)
      .eq('tipo', 'recarga_yappy')
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ found: true, status: 'ALREADY_PROCESSED' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Consultar historial Yappy
    const token   = await getYappyToken();
    const today   = todayStr();
    const histRes = await fetch(`${YAPPY_BASE}/v1/movement/history`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Api-Key':       API_KEY,
        'Secret-Key':    SECRET_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        body: {
          pagination: { start_date: today, end_date: today, limit: 50 },
          filter:     [{ id: 'ROLE', value: 'CREDIT' }],
        },
      }),
    });
    const histJson = await histRes.json();
    const txs: any[] = histJson.body?.transactions ?? histJson.body ?? [];

    // Buscar transacción que contenga la referencia
    const ref   = reference.toLowerCase();
    const match = txs.find((tx) => {
      const desc    = (tx.description ?? '').toLowerCase();
      const hasMeta = (tx.metadata ?? []).some(
        (m: any) => m.value?.toString().toLowerCase().includes(ref)
      );
      return desc.includes(ref) || hasMeta;
    });

    if (!match) {
      return new Response(JSON.stringify({ found: false, status: 'NOT_FOUND' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const txStatus = (match.status ?? '').toUpperCase();

    if (txStatus === 'REJECTED' || txStatus === 'FAILED' || txStatus === 'DECLINED') {
      return new Response(JSON.stringify({ found: true, status: txStatus }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (txStatus !== 'COMPLETED' && txStatus !== 'EXECUTED') {
      return new Response(JSON.stringify({ found: true, status: 'PENDING' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Validar monto (antifraude)
    const paid = parseFloat(match.amount ?? match.value ?? '0');
    if (paid < amount) {
      console.error(`Yappy amount mismatch: expected ${amount}, got ${paid}`);
      return new Response(JSON.stringify({ found: true, status: 'AMOUNT_MISMATCH' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Acreditar wallet
    const { error: rpcErr } = await supabase.rpc('credit_wallet', {
      p_user_id:     userId,
      p_monto:       amount,
      p_tipo:        'recarga_yappy',
      p_descripcion: `Recarga Yappy $${amount.toFixed(2)} — ref ${reference}`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return new Response(JSON.stringify({ found: true, status: 'COMPLETED' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('yappy-check error:', e.message);
    return new Response(JSON.stringify({ error: 'Error interno' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
