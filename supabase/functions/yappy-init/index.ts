/**
 * yappy-init — Edge Function
 * Autentica con Yappy y devuelve el alias del merchant.
 * Las credenciales NUNCA salen del servidor.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const YAPPY_BASE   = Deno.env.get('YAPPY_BASE_URL') ?? 'https://api.yappy.com.pa';
const API_KEY      = Deno.env.get('YAPPY_API_KEY')  ?? '';
const SECRET_KEY   = Deno.env.get('YAPPY_SECRET_KEY') ?? '';
const SEED_CODE    = Deno.env.get('YAPPY_SEED_CODE') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Token en memoria (se limpia en cold start)
let _token: string | null = null;
let _tokenDate: string | null = null;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateHash(): Promise<string> {
  // SHA-256(SEED_CODE + API_KEY + fecha) — formula usada en la integración
  const message = SEED_CODE + API_KEY + todayStr();
  const data = new TextEncoder().encode(message);
  const buf  = await crypto.subtle.digest('SHA-256', data);
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
    throw new Error(`Yappy auth ${json.status?.code}: ${json.status?.description}`);
  }
  _token     = json.body.token as string;
  _tokenDate = today;
  return _token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const token   = await getYappyToken();
    const res     = await fetch(`${YAPPY_BASE}/v1/collection-method`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Api-Key':       API_KEY,
        'Secret-Key':    SECRET_KEY,
        'Content-Type':  'application/json',
      },
    });
    const json    = await res.json();
    const methods: any[] = json.type ?? json.data ?? [];

    const method = methods.find((m) => m.type === 'INTEGRACION_YAPPY')
      ?? methods.find((m) => m.type === 'DIRECTORIO')
      ?? methods[0];

    const alias = method?.alias
      ?? method?.details?.find((d: any) => d.id === 'alias')?.value
      ?? 'birrea2play';

    return new Response(JSON.stringify({ alias }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('yappy-init error:', e.message);
    return new Response(JSON.stringify({ error: 'Error interno' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
