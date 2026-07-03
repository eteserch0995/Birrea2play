/**
 * pf-create-link — Edge Function
 * Crea un enlace de pago en PágueloFácil y devuelve la URL al frontend.
 * El CCLW nunca sale al cliente.
 * Soporta tipo='wc_enrollment' (inscripción Mundial con tarjeta): liga wc_enrollment_id
 * para que pf-webhook marque la inscripción pagada en vez de acreditar wallet.
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

  let body: { userId: string; amount: number; descripcion?: string; tipo?: string; wc_enrollment_id?: string; cancha_reserva_id?: string; credito_monto?: number };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { userId, amount, descripcion = 'Recarga Birrea2Play', tipo = 'recarga_tarjeta', wc_enrollment_id = null, cancha_reserva_id = null, credito_monto = null } = body;
  if (!userId || !amount || amount < 1) {
    return new Response(JSON.stringify({ error: 'Monto mínimo $1.00' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (tipo === 'wc_enrollment' && !wc_enrollment_id) {
    return new Response(JSON.stringify({ error: 'wc_enrollment_id requerido para tipo=wc_enrollment' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (tipo === 'abono_cancha' && !cancha_reserva_id) {
    return new Response(JSON.stringify({ error: 'cancha_reserva_id requerido para tipo=abono_cancha' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  // Donación: credito_monto es la base que cuenta para el termómetro público.
  // Debe existir, ser > 0 y NUNCA exceder el monto realmente cobrado (amount),
  // de lo contrario un cliente podría inflar el recaudo pagando $1.
  // Tope server-side anti fat-finger (espejo del cardMax=2000 del cliente, que no
  // es confiable): ni la base ni el total cobrado pueden exceder el máximo.
  if (tipo === 'donacion') {
    const DONACION_MAX = 2000; // espejo de RECAUDO.cardMax (lib/donaciones.js)
    const DONACION_MIN = 1;    // espejo de RECAUDO.min: la base debe ser >= $1, no solo > 0.
    const base = Number(credito_monto);
    if (!Number.isFinite(base) || base < DONACION_MIN || base > amount
        || base > DONACION_MAX || amount > DONACION_MAX) {
      return new Response(JSON.stringify({ error: 'Monto de donación inválido' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
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

  // INTERIM (mientras pf-webhook no tenga verificacion S2S de PagueloFacil): el callback de
  // retorno de PF es forjable, asi que TOPAMOS la recarga de wallet con tarjeta para acotar
  // el abuso. Se remueve al habilitar el webhook server-to-server de PagueloFacil.
  if (tipo === 'recarga_tarjeta') {
    const MAX_TX = 50, MAX_DAY = 100;
    if (amount > MAX_TX) {
      return new Response(JSON.stringify({ error: `Recarga con tarjeta limitada a $${MAX_TX} por transacción (temporal).` }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recientes } = await supabase
      .from('pf_pending_payments')
      .select('amount')
      .eq('user_id', userId).eq('tipo', 'recarga_tarjeta').eq('procesado', true)
      .gte('created_at', since);
    const sumDia = (recientes ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
    if (sumDia + amount > MAX_DAY) {
      return new Response(JSON.stringify({ error: `Límite diario de recarga con tarjeta ($${MAX_DAY}) alcanzado (temporal).` }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  // Crear registro de pago pendiente para idempotencia
  const ordenId = `pf-${userId.slice(0, 8)}-${Date.now()}`;
  const { error: insErr } = await supabase.from('pf_pending_payments').insert({
    orden_id:          ordenId,
    user_id:           userId,
    amount,
    tipo,
    descripcion:       descripcion.substring(0, 150),
    credito_monto:     credito_monto ?? null,
    wc_enrollment_id:  tipo === 'wc_enrollment' ? wc_enrollment_id   : null,
    cancha_reserva_id: tipo === 'abono_cancha'  ? cancha_reserva_id  : null,
  });
  // Sin la fila pending NO hay idempotencia ni credito_monto (base del termómetro):
  // si el insert falla, NO generar el enlace de pago (el donante quedaría cobrado sin
  // registro, porque pf-webhook respondería orden_no_existe).
  if (insErr) {
    console.error('pf-create-link insert error:', insErr.message);
    return new Response(JSON.stringify({ error: 'No se pudo iniciar el pago' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

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
