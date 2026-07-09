/**
 * chicas-birria-once — ONE-SHOT (borrar tras usar, patrón wc-announce-once)
 * Push + CORREO branded a TODAS las usuarias (genero Femenino, con cuenta)
 * invitándolas a la Birria Mixta 5vs5 del mié 9-jul. Pedido Sergio 2026-07-05.
 * Auth: x-sync-secret == WC_SYNC_SECRET.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SYNC_SECRET    = Deno.env.get('WC_SYNC_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM     = Deno.env.get('EMAIL_FROM') ?? 'Birrea2Play <avisos@birrea2play.com>';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const TITLE = '📌 Corrección: la Birria Mixta es el JUEVES 9';
const BODY  = 'Ojo: la Birria Mixta 5vs5 es el JUEVES 9 de julio (no miércoles). Misma hora y lugar: 8:30pm en Fredy Sport Center, $5.50 por jugadora. Hay cupos femeninos — animate y traé a tus amigas 💪';

function emailHtml(): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="margin:0;padding:0;background:#000000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#11151C;border-radius:16px;overflow:hidden;border:1px solid #1B2230;">
        <tr><td style="padding:24px 28px 8px 28px;">
          <div style="font-size:24px;font-weight:800;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">birrea<span style="color:#B8FF00;">2play</span></div>
        </td></tr>
        <tr><td style="padding:8px 28px 0 28px;">
          <div style="font-size:20px;font-weight:800;color:#ffffff;font-family:Arial,Helvetica,sans-serif;line-height:1.3;">${TITLE}</div>
        </td></tr>
        <tr><td style="padding:10px 28px 0 28px;">
          <div style="font-size:15px;color:#C7CEDA;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">${BODY}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0D10;border:1px solid #1B2230;border-radius:12px;padding:6px 16px;">
            <tr><td style="padding:6px 0;font-size:13px;color:#6B7480;font-family:Arial,Helvetica,sans-serif;">Fecha</td><td style="padding:6px 0;font-size:13px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;text-align:right;font-weight:700;">JUEVES 9 de julio · 8:30pm</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6B7480;font-family:Arial,Helvetica,sans-serif;">Lugar</td><td style="padding:6px 0;font-size:13px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;text-align:right;font-weight:700;">Fredy Sport Center</td></tr>
            <tr><td style="padding:6px 0;font-size:13px;color:#6B7480;font-family:Arial,Helvetica,sans-serif;">Precio</td><td style="padding:6px 0;font-size:13px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;text-align:right;font-weight:700;">$5.50 por jugadora</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px 26px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 0 4px 0;">
            <a href="https://birrea2play.com" style="display:inline-block;background:#001A4D;color:#B8FF00;text-decoration:none;font-weight:900;font-size:16px;padding:14px 30px;border-radius:10px;letter-spacing:0.3px;border:2px solid #B8FF00;mso-line-height-rule:exactly;">VER EL EVENTO</a>
          </td></tr></table>
        </td></tr>
      </table>
      <div style="max-width:480px;color:#6B7480;font-size:12px;font-family:Arial,Helvetica,sans-serif;padding:16px 28px;line-height:1.5;">Recibís este correo porque tenés una cuenta en Birrea2Play.</div>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (!SYNC_SECRET || (req.headers.get('x-sync-secret') ?? '') !== SYNC_SECRET) return json({ error: 'unauthorized' }, 401);

  const { data: chicas, error } = await supabase
    .from('users').select('id, correo')
    .eq('genero', 'Femenino').not('auth_id', 'is', null);
  if (error) return json({ error: error.message }, 500);

  const ids = (chicas ?? []).map((u) => u.id);
  const correos = (chicas ?? []).map((u) => u.correo).filter((c) => !!c && c.includes('@'));

  // Push (sin email de respaldo — el correo va aparte a TODAS)
  const pr = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': SERVICE_KEY },
    body: JSON.stringify({ user_ids: ids, title: TITLE, body: BODY, url: 'https://birrea2play.com', force_email: false }),
  });
  const push = await pr.json().catch(() => ({}));

  // Email a TODAS (Resend batch, máx 100 — acá son ~28)
  let emailSent = 0, emailFailed = 0;
  if (RESEND_API_KEY && correos.length) {
    const payload = correos.map((to) => ({ from: EMAIL_FROM, to: [to], subject: `${TITLE} · Birrea2Play`, html: emailHtml() }));
    const er = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (er.ok) emailSent = correos.length;
    else { emailFailed = correos.length; console.error('resend batch', er.status, await er.text().catch(() => '')); }
  }

  return json({ ok: true, audiencia: ids.length, push, email: { sent: emailSent, failed: emailFailed } });
});
