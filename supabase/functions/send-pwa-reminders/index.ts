// send-pwa-reminders — envía correos cada 2 días a usuarios que no reclamaron su $1.
// Llamado por cron o manualmente por el admin desde el panel.
// Requiere: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY, ADMIN_BROADCAST_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY      = Deno.env.get('RESEND_API_KEY') ?? '';
const ADMIN_BROADCAST     = Deno.env.get('ADMIN_BROADCAST_SECRET') ?? '';
const EMAIL_FROM          = 'Birrea2Play <avisos@birrea2play.com>';
const SITE_URL            = 'https://birrea2play.com';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function buildEmail(nombre: string, mode: 'unclaimed' | 'claimed_without_push'): string {
  const greeting = nombre ? `Hola ${nombre}` : 'Hola';
  const claimedWithoutPush = mode === 'claimed_without_push';
  const icon = claimedWithoutPush ? '🔔' : '🎁';
  const title = claimedWithoutPush
    ? 'Activá las notificaciones de Birrea2Play'
    : '¡Tu $1 te está esperando!';
  const content = claimedWithoutPush
    ? `${greeting},<br><br>
       Ya reclamaste tu recompensa de instalación, pero actualmente no encontramos una suscripción de notificaciones activa en tu cuenta.<br><br>
       Las notificaciones son necesarias para avisarte sobre:<br>
       &nbsp;&nbsp;📅 <strong style="color:#ffffff;">Cambios y nuevos eventos</strong><br>
       &nbsp;&nbsp;🎉 <strong style="color:#ffffff;">Cupos liberados y lista de espera</strong><br>
       &nbsp;&nbsp;🏆 <strong style="color:#ffffff;">Resultados, MVP y anuncios</strong><br><br>
       Abrí Birrea2Play desde el ícono instalado en tu pantalla de inicio y tocá <strong style="color:#B8FF00;">Activar notificaciones</strong>.`
    : `${greeting},<br><br>
       Registraste una cuenta en Birrea2Play pero todavía no reclamaste tu <strong style="color:#B8FF00;">recompensa de $1</strong>.<br><br>
       Para obtenerla solo necesitás:<br>
       &nbsp;&nbsp;📲 <strong style="color:#ffffff;">Instalar la app</strong> en tu celular<br>
       &nbsp;&nbsp;🔔 <strong style="color:#ffffff;">Activar las notificaciones</strong><br>
       &nbsp;&nbsp;💰 <strong style="color:#ffffff;">Tocar el botón "Obtener recompensa"</strong>`;
  const footer = claimedWithoutPush
    ? 'Abrí la app instalada para completar la activación.'
    : 'Este $1 es solo para vos y no expira. Tardás menos de 1 minuto.';
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080B;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080B;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#11151C;border-radius:16px;overflow:hidden;border:1px solid #1B2230;">
        <tr><td style="padding:28px 28px 8px;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:2px;">
            birrea<span style="color:#B8FF00;">2play</span>
          </div>
        </td></tr>
        <tr><td style="padding:16px 28px 0;text-align:center;">
          <div style="font-size:48px;">${icon}</div>
          <div style="font-size:22px;font-weight:800;color:#FFD700;font-family:Arial,sans-serif;margin-top:8px;">
            ${title}
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px 0;">
          <div style="font-size:15px;color:#C7CEDA;font-family:Arial,sans-serif;line-height:1.6;">
            ${content}
          </div>
        </td></tr>
        <tr><td style="padding:24px 28px 28px;text-align:center;">
          <a href="${SITE_URL}" style="display:inline-block;background:#B8FF00;color:#07080B;text-decoration:none;font-weight:900;font-size:16px;padding:14px 32px;border-radius:10px;letter-spacing:1px;font-family:Arial,sans-serif;">
            IR A BIRREA2PLAY ▸
          </a>
          <div style="margin-top:16px;font-size:12px;color:#6B7480;font-family:Arial,sans-serif;">
            ${footer}
          </div>
        </td></tr>
      </table>
      <div style="max-width:480px;color:#6B7480;font-size:11px;font-family:Arial,sans-serif;padding:14px 28px;line-height:1.5;text-align:center;">
        Recibís este correo porque tenés una cuenta en Birrea2Play.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // ⛔ Correos DESACTIVADOS a pedido del dueño (2026-06-28): esta función ya NO
  //    envía ningún email a nadie. Se deja el resto del código por si se reactiva.
  return json({ ok: true, disabled: true, sent: 0, message: 'Envío de correos desactivado.' });

  // Auth: solo admin_secret o service_role
  let body: {
    admin_secret?: string;
    dry_run?: boolean;
    mode?: 'unclaimed' | 'claimed_without_push';
  } = {};
  try { body = await req.json(); } catch {}

  const bearer = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const isAdmin =
    (ADMIN_BROADCAST && body.admin_secret === ADMIN_BROADCAST) ||
    bearer === SUPABASE_SERVICE_KEY;

  if (!isAdmin) return json({ error: 'No autorizado' }, 401);
  if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY no configurada' }, 503);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const mode = body.mode === 'claimed_without_push' ? 'claimed_without_push' : 'unclaimed';
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  let usersQuery = supabase
    .from('users')
    .select('id, correo, nombre, pwa_reminder_sent_at, push_token, web_push_subs')
    .not('correo', 'is', null);

  if (mode === 'claimed_without_push') {
    usersQuery = usersQuery
      .not('pwa_bonus_granted_at', 'is', null);
  } else {
    usersQuery = usersQuery
      .is('pwa_bonus_granted_at', null)
      .or(`pwa_reminder_sent_at.is.null,pwa_reminder_sent_at.lt.${twoDaysAgo}`);
  }

  const { data: queriedUsers, error } = await usersQuery;

  if (error) return json({ error: error.message }, 500);
  const users = (queriedUsers ?? []).filter((u) => {
    if (mode !== 'claimed_without_push') return true;
    const hasExpo = typeof u.push_token === 'string' && u.push_token.trim() !== '';
    const hasWeb = Array.isArray(u.web_push_subs) && u.web_push_subs.length > 0;
    return !hasExpo && !hasWeb;
  });
  if (!users?.length) return json({ ok: true, sent: 0, message: 'No hay pendientes' });

  if (body.dry_run) {
    return json({
      ok: true,
      dry_run: true,
      mode,
      would_send: users.length,
      recipients: users.map((u) => ({ id: u.id, nombre: u.nombre, correo: u.correo })),
    });
  }

  // Enviar en lotes de 50 vía Resend batch
  const BATCH = 50;
  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < users.length; i += BATCH) {
    const slice = users.slice(i, i + BATCH);
    const payload = slice.map(u => ({
      from: EMAIL_FROM,
      to:   [u.correo],
      subject: mode === 'claimed_without_push'
        ? '🔔 Activá las notificaciones de Birrea2Play'
        : '🎁 Tu $1 de bienvenida te está esperando — Birrea2Play',
      html: buildEmail(u.nombre ?? '', mode),
    }));

    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (r.ok) {
        sent += slice.length;
        // Actualizar pwa_reminder_sent_at para no volver a enviar antes de 2 días
        const ids = slice.map(u => u.id);
        await supabase.from('users').update({ pwa_reminder_sent_at: now }).in('id', ids);
      } else {
        failed += slice.length;
        console.error('Resend batch error', r.status, await r.text().catch(() => ''));
      }
    } catch (e) {
      failed += slice.length;
      console.error('Resend batch exception', e instanceof Error ? e.message : e);
    }
  }

  return json({ ok: true, sent, failed, total: users.length });
});
