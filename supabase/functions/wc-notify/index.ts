/**
 * wc-notify — Edge Function (Mundial 2026 + eventos)
 * Deploy: supabase functions deploy wc-notify --no-verify-jwt
 *
 * Dos modos (body.mode):
 *   'daily-reminder' (default) — recordatorio diario a inscritos de la POLLA
 *      que les FALTA jugar (targets via RPC wc_reminder_targets). Survivor ya
 *      finalizo (lo gano Byron), por eso no se le envia recordatorio. Lo dispara el
 *      cron `wc-daily-reminder` a las 14:00 UTC (9:00 AM Panama).
 *   'new-event' (body.event_id) — al publicarse un evento (visible+open), avisa
 *      a los ULTIMOS 50 usuarios reales (con auth_id). Lo dispara el trigger
 *      `trg_notify_new_event` en la tabla events.
 *
 * Auth: header `x-sync-secret` == WC_SYNC_SECRET (mismo secreto que wc-sync-results;
 * el cron y el trigger lo embeben). NO usa JWT de usuario.
 *
 * El envio real (push expo + web push + email de respaldo) se delega al edge fn
 * `send-notification`, llamado server-to-server con x-admin-key = service key.
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

// Delega el envio a send-notification (push + email de respaldo).
async function sendTo(userIds: string[], title: string, body: string, url: string) {
  if (!userIds.length) return { audience: 0, skipped: 'sin destinatarios' };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': SERVICE_KEY },
    body: JSON.stringify({ user_ids: userIds, title, body, url, force_email: true }),
  });
  const out = await r.json().catch(() => ({}));
  return { audience: userIds.length, status: r.status, result: out };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  if (!SYNC_SECRET || (req.headers.get('x-sync-secret') ?? '') !== SYNC_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { mode?: string; event_id?: string; title?: string; body?: string; url?: string } = {};
  try { body = await req.json(); } catch { /* body vacio = default */ }
  const mode = body.mode ?? 'daily-reminder';

  try {
    // ── Recordatorio diario ────────────────────────────────────────────
    if (mode === 'daily-reminder') {
      const { data, error } = await supabase.rpc('wc_reminder_targets');
      if (error) throw error;
      const ids: string[] = Array.isArray(data) ? data : [];
      const res = await sendTo(
        ids,
        'Polla Mundial — te faltan picks',
        'No olvides cargar tus predicciones de la Polla de hoy. Cada partido cierra 15 min antes de empezar.',
        'https://birrea2play.com',
      );
      return json({ ok: true, mode, ...res });
    }

    // ── Aviso de evento nuevo publicado ────────────────────────────────
    if (mode === 'new-event') {
      const eventId = body.event_id;
      if (!eventId) return json({ error: 'event_id requerido' }, 400);

      const { data: ev } = await supabase
        .from('events')
        .select('id, nombre, fecha, lugar, status, visible')
        .eq('id', eventId)
        .maybeSingle();
      if (!ev || ev.visible !== true || ev.status !== 'open') {
        return json({ ok: true, mode, skipped: 'evento no publicado/visible' });
      }

      // Ultimos 50 usuarios REALES (con login). Excluye los sin auth_id.
      const { data: us } = await supabase
        .from('users')
        .select('id')
        .not('auth_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);
      const ids = (us ?? []).map((u: { id: string }) => u.id);

      let fecha = '';
      try {
        if (ev.fecha) {
          fecha = new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es-PA', { day: '2-digit', month: 'long' });
        }
      } catch { /* sin fecha legible */ }

      const res = await sendTo(
        ids,
        'Nuevo evento disponible',
        `${ev.nombre}${fecha ? ' — ' + fecha : ''}${ev.lugar ? ' · ' + ev.lugar : ''}. Inscribite antes de que se llene.`,
        'https://birrea2play.com',
      );
      return json({ ok: true, mode, event: ev.nombre, ...res });
    }

    // ── Aviso general (broadcast a TODOS, solo push; email desactivado) ──
    if (mode === 'custom') {
      const title = body.title;
      const msg   = body.body;
      const url   = body.url ?? 'https://birrea2play.com';
      if (!title || !msg) return json({ error: 'title y body requeridos' }, 400);
      const r = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': SERVICE_KEY },
        body: JSON.stringify({ broadcast: true, title, body: msg, url, force_email: false }),
      });
      const out = await r.json().catch(() => ({}));
      return json({ ok: true, mode, status: r.status, result: out });
    }

    return json({ error: `mode invalido: ${mode}` }, 400);
  } catch (e) {
    console.error('wc-notify error', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
