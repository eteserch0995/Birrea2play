/**
 * club-notify — recordatorios del Carné de Socio ($5/mes)
 * Deploy: supabase functions deploy club-notify --no-verify-jwt
 * Cron diario `club-membresia-reminder` (14:00 UTC = 9am PA).
 * Targets: RPC club_membresia_reminder_targets() → vence_pronto (en 2 días),
 * vence_hoy (renovar antes de las 11:59pm) y vencida_ayer (perdió beneficios).
 * Auth: x-sync-secret == WC_SYNC_SECRET. Envío por send-notification (push +
 * email de respaldo).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SYNC_SECRET  = Deno.env.get('WC_SYNC_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

async function sendTo(userIds: string[], title: string, body: string) {
  if (!userIds.length) return { audience: 0 };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': SERVICE_KEY },
    body: JSON.stringify({ user_ids: userIds, title, body, url: 'https://birrea2play.com', force_email: true }),
  });
  const out = await r.json().catch(() => ({}));
  return { audience: userIds.length, status: r.status, result: out };
}

const fechaLegible = (f?: string | null) => {
  try {
    return f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-PA', { weekday: 'long', day: '2-digit', month: 'long' }) : '';
  } catch { return f ?? ''; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (!SYNC_SECRET || (req.headers.get('x-sync-secret') ?? '') !== SYNC_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { mode?: string; user_id?: string; empresa_id?: string } = {};
  try { body = await req.json(); } catch { /* cron manda vacio */ }

  // Canje empresarial aprobado -> avisar al colaborador
  if (body.mode === 'canje-aprobado' && body.user_id) {
    try {
      let nombreEmp = 'tu empresa';
      if (body.empresa_id) {
        const { data: emp } = await supabase.from('empresas').select('nombre').eq('id', body.empresa_id).maybeSingle();
        if (emp?.nombre) nombreEmp = emp.nombre;
      }
      const res = await sendTo(
        [body.user_id],
        '🎖 ¡Ya sos socio por tu empresa!',
        `Confirmamos que sos colaborador de ${nombreEmp} y tu Carnet de Socio quedó ACTIVO: 10% de descuento en los eventos (fútbol, volley y más), descuentos en comercios y 1 invitado gratis al mes. ¡A jugar!`,
      );
      return json({ ok: true, mode: 'canje-aprobado', ...res });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  try {
    const { data, error } = await supabase.rpc('club_membresia_reminder_targets');
    if (error) throw error;
    const rows = (data ?? []) as Array<{ user_id: string; tipo: string; vence_el: string }>;

    const grupos: Record<string, string[]> = { vence_pronto: [], vence_hoy: [], vencida_ayer: [] };
    const fechas: Record<string, string> = {};
    for (const r of rows) {
      if (r.tipo && grupos[r.tipo]) { grupos[r.tipo].push(r.user_id); fechas[r.tipo] = r.vence_el; }
    }

    const res: Record<string, unknown> = {};
    if (grupos.vence_pronto.length) {
      res.vence_pronto = await sendTo(
        grupos.vence_pronto,
        '🎖 Tu Carné de Socio vence en 2 días',
        `Renovalo por Yappy ($5.00) antes del ${fechaLegible(fechas.vence_pronto)} a las 11:59pm para no perder tu 10% de descuento, tus beneficios y tu invitado gratis del mes.`,
      );
    }
    if (grupos.vence_hoy.length) {
      res.vence_hoy = await sendTo(
        grupos.vence_hoy,
        '⏰ Tu Carné de Socio vence HOY',
        'Renovalo por Yappy ($5.00) antes de las 11:59pm o se pierden los beneficios. Entrá a la app → Carné de Socio → Renovar.',
      );
    }
    if (grupos.vencida_ayer.length) {
      res.vencida_ayer = await sendTo(
        grupos.vencida_ayer,
        'Tu Carné de Socio venció',
        'Perdiste los beneficios por ahora, pero podés renovarlo cuando quieras — el nuevo mes arranca el día que pagues. Te esperamos de vuelta 🎖',
      );
    }

    return json({ ok: true, targets: rows.length, res });
  } catch (e) {
    console.error('club-notify error', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
