/**
 * pf-webhook — Edge Function (PÚBLICO — sin JWT)
 * IMPORTANTE: En Supabase Dashboard → esta función → desactivar "Enforce JWT Verification"
 * PágueloFácil redirige aquí como GET sin Authorization header.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_SCHEME      = Deno.env.get('APP_DEEP_LINK') ?? 'birrea2play://wallet';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function redirectToApp(params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: { ...CORS, Location: `${APP_SCHEME}?${qs}` },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const url = new URL(req.url);
    const q   = url.searchParams;

    // PF puede usar distintos nombres según modo de integración
    const Estado = q.get('Estado') ?? q.get('estado') ?? '';
    const Total  = q.get('TotalPagado') ?? q.get('Total') ?? q.get('total') ?? '0';
    const Oper   = q.get('Oper') ?? q.get('oper') ?? '';
    const Razon  = q.get('Razon') ?? q.get('razon') ?? 'Pago denegado';
    const Ref    = q.get('PARM_1') ?? q.get('Referencia') ?? q.get('reference') ?? '';

    console.log('[pf-webhook] callback recibido:', { Estado, Total, Oper, Ref, raw: url.search });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SVCKEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (Estado !== 'Aprobada') {
      return redirectToApp({ status: 'failed', razon: Razon });
    }

    if (!Ref) {
      console.error('[pf-webhook] referencia vacía en callback');
      return redirectToApp({ status: 'error', code: 'no_reference' });
    }

    const { data: pending, error: pendErr } = await supabase
      .from('pf_pending_payments')
      .select('*')
      .eq('orden_id', Ref)
      .maybeSingle();

    if (pendErr) {
      console.error('[pf-webhook] db error:', pendErr.message);
      return redirectToApp({ status: 'error', code: 'db_error' });
    }
    if (!pending) {
      console.error('[pf-webhook] orden no encontrada:', Ref);
      return redirectToApp({ status: 'error', code: 'orden_no_existe' });
    }

    // Idempotencia: ya fue procesado → éxito sin doble crédito
    if (pending.procesado) {
      return redirectToApp({ status: 'success', amount: String(pending.amount), duplicate: '1' });
    }

    // Validar monto (rechaza NaN y montos menores)
    const totalNum = Number(Total);
    if (!Number.isFinite(totalNum) || totalNum + 0.01 < Number(pending.amount)) {
      console.error(`[pf-webhook] monto no coincide: esperado ${pending.amount}, recibido ${Total}`);
      return redirectToApp({ status: 'error', code: 'amount_mismatch' });
    }

    // Acreditar wallet — RPC firma: credit_wallet(p_user_id, p_monto, p_tipo, p_descripcion)
    const { error: rpcErr } = await supabase.rpc('credit_wallet', {
      p_user_id:     pending.user_id,
      p_monto:       pending.amount,
      p_tipo:        'recarga_tarjeta',
      p_descripcion: `Recarga Tarjeta $${Number(pending.amount).toFixed(2)} — PF Oper ${Oper} — ref ${Ref}`,
    });

    if (rpcErr) {
      console.error('[pf-webhook] credit_wallet error:', rpcErr.message);
      return redirectToApp({ status: 'error', code: 'credit_failed' });
    }

    // Marcar como procesado (race-safe: solo actualiza si aún está en false)
    await supabase
      .from('pf_pending_payments')
      .update({ procesado: true, oper: Oper })
      .eq('orden_id', Ref)
      .eq('procesado', false);

    return redirectToApp({ status: 'success', amount: String(pending.amount) });
  } catch (e) {
    console.error('[pf-webhook] error no capturado:', (e as Error).message);
    return redirectToApp({ status: 'error', code: 'exception' });
  }
});
