/**
 * pf-webhook — Edge Function (PÚBLICO — sin JWT)
 * IMPORTANTE: En Supabase Dashboard → esta función → desactivar "Enforce JWT Verification"
 *
 * DOS vías de confirmación (2026-07-07):
 *  - GET  → redirect del navegador de PágueloFácil (RETURN_URL). Responde 303 al deep link.
 *  - POST → notificación server-to-server (webhook) de PágueloFácil, independiente del
 *           navegador. Responde 200 JSON. (Se habilita pidiéndolo a soporte de PF.)
 * Ambas leen los mismos parámetros (Estado, TotalPagado, Oper, PARM_1) desde query o body.
 *
 * ANTI DOBLE-CRÉDITO: con dos vías activas, redirect y webhook podrían llegar casi juntos.
 * Se hace un CLAIM atómico de la fila (UPDATE procesado false→true) ANTES de acreditar;
 * solo quien gana el claim acredita. Si la acreditación falla, se revierte el claim.
 *
 * Ramas según pf_pending_payments.tipo:
 *  - 'wc_enrollment' → marca la inscripción Mundial como pagada (wc_pay_enrollment_card).
 *  - 'abono_cancha'  → confirmar_abono_cancha_tarjeta.
 *  - 'donacion'      → registrar_donacion (no toca wallet).
 *  - resto           → acredita wallet (credit_wallet).
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVCKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_SCHEME      = Deno.env.get('APP_DEEP_LINK') ?? 'birrea2play://creditos';

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

  const isPost = req.method === 'POST';

  // ── Recolectar parámetros: query (GET redirect) y/o body (POST webhook S2S) ──
  const url    = new URL(req.url);
  const params = new URLSearchParams(url.search);
  if (isPost) {
    try {
      const ct   = (req.headers.get('content-type') || '').toLowerCase();
      const body = await req.text();
      if (body) {
        if (ct.includes('application/json')) {
          const j = JSON.parse(body);
          for (const [k, v] of Object.entries(j)) if (v != null) params.set(k, String(v));
        } else {
          // form-urlencoded o querystring plano
          for (const [k, v] of new URLSearchParams(body).entries()) params.set(k, v);
        }
      }
    } catch (_) { /* body vacío/no parseable → seguimos con lo que haya en query */ }
  }
  const g = (...names: string[]): string => {
    for (const n of names) { const v = params.get(n); if (v != null && v !== '') return v; }
    return '';
  };

  // Respuesta según vía: navegador (GET) → redirect a la app; webhook (POST) → JSON 200.
  const respond = (p: Record<string, string>): Response =>
    isPost
      ? new Response(JSON.stringify({ ok: true, ...p }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
      : redirectToApp(p);

  try {
    const Estado = g('Estado', 'estado');
    const Total  = g('TotalPagado', 'Total', 'total') || '0';
    const Oper   = g('Oper', 'oper');
    const Razon  = g('Razon', 'razon') || 'Pago denegado';
    const Ref    = g('PARM_1', 'Referencia', 'reference');

    console.log('[pf-webhook] callback recibido:', { via: isPost ? 'POST/webhook' : 'GET/redirect', Estado, Total, Oper, Ref });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SVCKEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (Estado !== 'Aprobada') {
      return respond({ status: 'failed', razon: Razon });
    }

    if (!Ref) {
      console.error('[pf-webhook] referencia vacía en callback');
      return respond({ status: 'error', code: 'no_reference' });
    }

    const { data: pending, error: pendErr } = await supabase
      .from('pf_pending_payments')
      .select('*')
      .eq('orden_id', Ref)
      .maybeSingle();

    if (pendErr) {
      console.error('[pf-webhook] db error:', pendErr.message);
      return respond({ status: 'error', code: 'db_error' });
    }
    if (!pending) {
      console.error('[pf-webhook] orden no encontrada:', Ref);
      return respond({ status: 'error', code: 'orden_no_existe' });
    }

    const isWcEnrollment = pending.tipo === 'wc_enrollment' && !!pending.wc_enrollment_id;
    const isAbonoCancha  = pending.tipo === 'abono_cancha'  && !!pending.cancha_reserva_id;
    const isDonacion     = pending.tipo === 'donacion';
    const flags = {
      wc:       isWcEnrollment ? '1' : '0',
      cancha:   isAbonoCancha  ? '1' : '0',
      donacion: isDonacion     ? '1' : '0',
    };

    // Fast-path: ya procesado → éxito idempotente sin doble crédito
    if (pending.procesado) {
      return respond({ status: 'success', amount: String(pending.amount), duplicate: '1', ...flags });
    }

    // Validar monto (rechaza NaN y montos menores). Para tarjeta WC, pending.amount = precio + $1.50.
    const totalNum = Number(Total);
    if (!Number.isFinite(totalNum) || totalNum + 0.01 < Number(pending.amount)) {
      console.error(`[pf-webhook] monto no coincide: esperado ${pending.amount}, recibido ${Total}`);
      return respond({ status: 'error', code: 'amount_mismatch', ...flags });
    }

    // ── CLAIM atómico ANTES de acreditar: solo UNA vía (redirect o webhook) gana ──
    const { data: claimed, error: claimErr } = await supabase
      .from('pf_pending_payments')
      .update({ procesado: true, oper: Oper })
      .eq('orden_id', Ref)
      .eq('procesado', false)
      .select('id');
    if (claimErr) {
      console.error('[pf-webhook] claim error:', claimErr.message);
      return respond({ status: 'error', code: 'db_error', ...flags });
    }
    if (!claimed || claimed.length === 0) {
      // La otra vía ya lo reclamó/procesó → éxito idempotente, sin doble crédito
      return respond({ status: 'success', amount: String(pending.amount), duplicate: '1', ...flags });
    }

    // Reclamado por nosotros → ejecutar la acreditación
    let failCode: string | null = null;

    if (isAbonoCancha) {
      const { error } = await supabase.rpc('confirmar_abono_cancha_tarjeta', {
        p_reserva_id:  pending.cancha_reserva_id,
        p_gestor_id:   pending.user_id,
        p_monto_total: pending.amount,
        p_fee:         0.25,
        p_orden_id:    Ref,
      });
      if (error) { console.error('[pf-webhook] confirmar_abono_cancha_tarjeta error:', error.message); failCode = 'abono_cancha_failed'; }

    } else if (isWcEnrollment) {
      // Inscripción Mundial: marca pagada (la RPC valida precio del pozo). El +$1.50 es cargo de tarjeta, no entra al pozo.
      const { error } = await supabase.rpc('wc_pay_enrollment_card', {
        p_user_id:       pending.user_id,
        p_enrollment_id: pending.wc_enrollment_id,
        p_amount:        pending.amount,
        p_pf_order_id:   Ref,
      });
      if (error) { console.error('[pf-webhook] wc_pay_enrollment_card error:', error.message); failCode = 'wc_enroll_failed'; }

    } else if (isDonacion) {
      // Recaudo Solidario (Venezuela): registrar donación. NO acredita wallet. Idempotente por order_ref.
      // base = monto de la donación; pending.amount = total cobrado (base + comisión si la cubrió).
      const cobrado = Number(pending.amount);
      const rawBase = Number(pending.credito_monto ?? pending.amount);
      const base    = Number.isFinite(rawBase) && rawBase > 0 ? Math.min(rawBase, cobrado) : cobrado;
      const fee     = Math.max(0, cobrado - base);
      const { error } = await supabase.rpc('registrar_donacion', {
        p_user_id:       pending.user_id,
        p_monto:         base,
        p_metodo:        'tarjeta',
        p_order_ref:     `pf:${Ref}`,
        p_fee:           fee,
        p_monto_cobrado: cobrado,
      });
      if (error) { console.error('[pf-webhook] registrar_donacion error:', error.message); failCode = 'donacion_failed'; }

    } else {
      // Recarga de créditos: acredita wallet — credit_wallet(p_user_id, p_monto, p_tipo, p_descripcion)
      const { error } = await supabase.rpc('credit_wallet', {
        p_user_id:     pending.user_id,
        p_monto:       pending.amount,
        p_tipo:        'recarga_tarjeta',
        p_descripcion: `Recarga Tarjeta $${Number(pending.amount).toFixed(2)} — PF Oper ${Oper} — ref ${Ref}`,
      });
      if (error) { console.error('[pf-webhook] credit_wallet error:', error.message); failCode = 'credit_failed'; }
    }

    if (failCode) {
      // Revertir el claim para permitir reintento (por la otra vía o un reintento de PF).
      await supabase.from('pf_pending_payments')
        .update({ procesado: false })
        .eq('orden_id', Ref).eq('procesado', true);
      return respond({ status: 'error', code: failCode, ...flags });
    }

    return respond({ status: 'success', amount: String(pending.amount), ...flags });
  } catch (e) {
    console.error('[pf-webhook] error no capturado:', (e as Error).message);
    return respond({ status: 'error', code: 'exception' });
  }
});
