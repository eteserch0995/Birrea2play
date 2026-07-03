/**
 * pf-webhook — Edge Function (PÚBLICO — sin JWT)
 * IMPORTANTE: En Supabase Dashboard → esta función → desactivar "Enforce JWT Verification"
 * PágueloFácil redirige aquí como GET sin Authorization header.
 *
 * Ramas según pf_pending_payments.tipo:
 *  - 'wc_enrollment' → marca la inscripción Mundial como pagada (wc_pay_enrollment_card).
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

  try {
    const url = new URL(req.url);
    const q   = url.searchParams;

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

    const isWcEnrollment   = pending.tipo === 'wc_enrollment' && !!pending.wc_enrollment_id;
    const isAbonoCancha    = pending.tipo === 'abono_cancha'  && !!pending.cancha_reserva_id;
    const isDonacion       = pending.tipo === 'donacion';

    // Idempotencia: ya fue procesado → éxito sin doble crédito
    if (pending.procesado) {
      return redirectToApp({ status: 'success', amount: String(pending.amount), duplicate: '1', wc: isWcEnrollment ? '1' : '0', cancha: isAbonoCancha ? '1' : '0', donacion: isDonacion ? '1' : '0' });
    }

    // Validar monto (rechaza NaN y montos menores). Para tarjeta WC, pending.amount = precio + $1.50.
    const totalNum = Number(Total);
    if (!Number.isFinite(totalNum) || totalNum + 0.01 < Number(pending.amount)) {
      console.error(`[pf-webhook] monto no coincide: esperado ${pending.amount}, recibido ${Total}`);
      // isDonacion ya se conoce aquí (post-lookup): propagamos el flag para que WalletScreen
      // muestre la copia de donación. Additive: para recarga/wc/cancha es '0' (= sin flag).
      return redirectToApp({ status: 'error', code: 'amount_mismatch', donacion: isDonacion ? '1' : '0' });
    }

    if (isAbonoCancha) {
      const { error: rpcErr } = await supabase.rpc('confirmar_abono_cancha_tarjeta', {
        p_reserva_id:  pending.cancha_reserva_id,
        p_gestor_id:   pending.user_id,
        p_monto_total: pending.amount,
        p_fee:         0.25,
        p_orden_id:    Ref,
      });
      if (rpcErr) {
        console.error('[pf-webhook] confirmar_abono_cancha_tarjeta error:', rpcErr.message);
        return redirectToApp({ status: 'error', code: 'abono_cancha_failed' });
      }

    } else if (isWcEnrollment) {
      // Inscripción Mundial: marca pagada (la RPC valida precio del pozo). El +$1.50 es cargo de tarjeta, no entra al pozo.
      const { error: rpcErr } = await supabase.rpc('wc_pay_enrollment_card', {
        p_user_id:       pending.user_id,
        p_enrollment_id: pending.wc_enrollment_id,
        p_amount:        pending.amount,
        p_pf_order_id:   Ref,
      });
      if (rpcErr) {
        console.error('[pf-webhook] wc_pay_enrollment_card error:', rpcErr.message);
        return redirectToApp({ status: 'error', code: 'wc_enroll_failed' });
      }
    } else if (isDonacion) {
      // Recaudo Solidario (Venezuela): registrar donación. NO acredita wallet. Idempotente por order_ref.
      // base = monto de la donación; pending.amount = total cobrado (base + comisión si la cubrió).
      // Defensa en profundidad: la base nunca puede exceder lo realmente cobrado.
      // pf-create-link ya valida 0 < credito_monto <= amount; aquí clampeamos por si acaso
      // para que el termómetro jamás cuente más de lo que PágueloFácil cobró.
      const cobrado = Number(pending.amount);
      const rawBase = Number(pending.credito_monto ?? pending.amount);
      const base    = Number.isFinite(rawBase) && rawBase > 0 ? Math.min(rawBase, cobrado) : cobrado;
      const fee     = Math.max(0, cobrado - base);
      const { error: rpcErr } = await supabase.rpc('registrar_donacion', {
        p_user_id:       pending.user_id,
        p_monto:         base,
        p_metodo:        'tarjeta',
        p_order_ref:     `pf:${Ref}`,
        p_fee:           fee,
        p_monto_cobrado: cobrado,
      });
      if (rpcErr) {
        console.error('[pf-webhook] registrar_donacion error:', rpcErr.message);
        // donacion='1' para que WalletScreen muestre la copia de donación, no la de recarga.
        return redirectToApp({ status: 'error', code: 'donacion_failed', donacion: '1' });
      }
    } else {
      // Recarga de créditos: acredita wallet — credit_wallet(p_user_id, p_monto, p_tipo, p_descripcion)
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
    }

    // Marcar como procesado (race-safe: solo actualiza si aún está en false)
    await supabase
      .from('pf_pending_payments')
      .update({ procesado: true, oper: Oper })
      .eq('orden_id', Ref)
      .eq('procesado', false);

    return redirectToApp({ status: 'success', amount: String(pending.amount), wc: isWcEnrollment ? '1' : '0', cancha: isAbonoCancha ? '1' : '0', donacion: isDonacion ? '1' : '0' });
  } catch (e) {
    console.error('[pf-webhook] error no capturado:', (e as Error).message);
    return redirectToApp({ status: 'error', code: 'exception' });
  }
});
