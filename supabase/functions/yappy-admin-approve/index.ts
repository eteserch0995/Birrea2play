/**
 * yappy-admin-approve — Edge Function
 * Admin approves or rejects a pending_recargas record.
 * On approve: calls credit_wallet RPC to credit the user's wallet.
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

async function requireAdmin(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('auth_id', data.user.id)
    .maybeSingle();

  return profile?.role === 'admin' ? profile : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const admin = await requireAdmin(req);
  if (!admin) return jsonRes({ error: 'No autorizado — se requiere rol admin' }, 403);

  let payload: { id?: number; action?: string; notas?: string };
  try { payload = await req.json(); } catch { return jsonRes({ error: 'Body inválido' }, 400); }

  const { id, action, notas } = payload;
  if (!id)     return jsonRes({ error: 'id requerido' }, 400);
  if (!action) return jsonRes({ error: 'action requerido' }, 400);
  if (action !== 'approve' && action !== 'reject') {
    return jsonRes({ error: 'action debe ser "approve" o "reject"' }, 400);
  }

  const { data: recarga, error: fetchErr } = await supabaseAdmin
    .from('pending_recargas')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchErr) return jsonRes({ error: fetchErr.message }, 500);
  if (!recarga) return jsonRes({ error: 'Recarga no encontrada o ya procesada' }, 404);

  const now = new Date().toISOString();

  if (action === 'approve') {
    const desc = recarga.tier_label
      ? `Recarga Yappy: ${recarga.tier_label}`
      : `Recarga Yappy aprobada $${recarga.amount_paid}${recarga.amount_credito !== recarga.amount_paid ? ` → $${recarga.amount_credito}` : ''}`;

    const { error: rpcErr } = await supabaseAdmin.rpc('credit_wallet', {
      p_user_id:     recarga.user_id,
      p_monto:       recarga.amount_credito,
      p_tipo:        'recarga_yappy',
      p_descripcion: desc,
    });

    if (rpcErr) {
      console.error('[yappy-admin-approve] credit_wallet error:', rpcErr.message);
      return jsonRes({ error: 'Error acreditando wallet' }, 500);
    }

    await supabaseAdmin
      .from('pending_recargas')
      .update({ status: 'approved', approved_by: admin.id, notas: notas ?? null, updated_at: now })
      .eq('id', id);

    console.log(`[yappy-admin-approve] approved: id=${id}, user=${recarga.user_id}, credito=${recarga.amount_credito}`);
    return jsonRes({ ok: true, action: 'approved', amount_credito: recarga.amount_credito });

  } else {
    await supabaseAdmin
      .from('pending_recargas')
      .update({ status: 'rejected', approved_by: admin.id, notas: notas ?? null, updated_at: now })
      .eq('id', id);

    console.log(`[yappy-admin-approve] rejected: id=${id}, user=${recarga.user_id}`);
    return jsonRes({ ok: true, action: 'rejected' });
  }
});
