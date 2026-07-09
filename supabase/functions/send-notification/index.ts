import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY      = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY     = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT         = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@birrea2play.com';
const ADMIN_BROADCAST       = Deno.env.get('ADMIN_BROADCAST_SECRET') ?? '';
// Email (Resend). Si no están seteados, el paso de email se saltea silenciosamente.
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM            = Deno.env.get('EMAIL_FROM') ?? 'Birrea2Play <avisos@birrea2play.com>';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (e) {
    console.error('VAPID setup error:', e);
  }
}

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};



function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// Escape básico para no romper el HTML del email con caracteres del título/cuerpo.
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Plantilla fija branded para el correo de aviso. Toma el mismo título/cuerpo que el push.
function renderEmailHtml(title: string, body: string, url?: string): string {
  const safeUrl = url && /^https?:\/\//i.test(url) ? url : 'https://birrea2play.com';
  const cta = `
    <tr><td style="padding:8px 0 4px 0;">
      <a href="${esc(safeUrl)}" style="display:inline-block;background:#001A4D;color:#B8FF00;text-decoration:none;
        font-weight:900;font-size:16px;padding:14px 30px;border-radius:10px;letter-spacing:0.3px;border:2px solid #B8FF00;mso-line-height-rule:exactly;">Ver más</a>
    </td></tr>`;
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"></head>
<body style="margin:0;padding:0;background:#000000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;padding:28px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#11151C;border-radius:16px;overflow:hidden;border:1px solid #1B2230;">
        <tr><td style="padding:24px 28px 8px 28px;">
          <div style="font-size:24px;font-weight:800;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
            birrea<span style="color:#B8FF00;">2play</span>
          </div>
        </td></tr>
        <tr><td style="padding:8px 28px 0 28px;">
          <div style="font-size:20px;font-weight:800;color:#ffffff;font-family:Arial,Helvetica,sans-serif;line-height:1.3;">
            ${esc(title)}
          </div>
        </td></tr>
        <tr><td style="padding:10px 28px 0 28px;">
          <div style="font-size:15px;color:#C7CEDA;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
            ${esc(body)}
          </div>
        </td></tr>
        <tr><td style="padding:18px 28px 26px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0">${cta}</table>
        </td></tr>
      </table>
      <div style="max-width:480px;color:#6B7480;font-size:12px;font-family:Arial,Helvetica,sans-serif;padding:16px 28px;line-height:1.5;">
        Recibís este correo porque tenés una cuenta en Birrea2Play.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// Envía correos en lotes vía Resend (batch, máx 100 por request). Devuelve {sent, failed}.
async function sendEmailsViaResend(
  recipients: string[], subject: string, html: string,
): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (!RESEND_API_KEY || recipients.length === 0) return out;
  const BATCH = 100;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const slice = recipients.slice(i, i + BATCH);
    const payload = slice.map((to) => ({ from: EMAIL_FROM, to: [to], subject, html }));
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) out.sent += slice.length;
      else { out.failed += slice.length; console.error('resend batch error', r.status, await r.text().catch(() => '')); }
    } catch (e) {
      out.failed += slice.length;
      console.error('resend batch exception', e instanceof Error ? e.message : e);
    }
  }
  return out;
}

// Auth básica (modo user_ids): x-sync-secret interno, admin_secret, x-admin-key=service, o JWT válido.
async function isAuthorized(req: Request, body: { admin_secret?: string }): Promise<boolean> {
  // Disparador interno (crons / server-side) vía x-sync-secret — mismo secreto que usan los otros crons.
  const syncSecret = req.headers.get('x-sync-secret');
  if (syncSecret && syncSecret === (Deno.env.get('SYNC_SECRET') ?? '9f3c1ade7b62408d5e1142aa0c7be93d6f08a214')) return true;
  if (ADMIN_BROADCAST && body.admin_secret && body.admin_secret === ADMIN_BROADCAST) return true;
  const adminKey = req.headers.get('x-admin-key');
  if (adminKey && SUPABASE_SERVICE_KEY && adminKey === SUPABASE_SERVICE_KEY) return true;
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length);
  if (token === SUPABASE_SERVICE_KEY) return true;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    return !!user;
  } catch {
    return false;
  }
}

// Auth para BROADCAST (a todos): solo admin_secret, service, o caller con rol admin/gestor.
async function broadcastAllowed(req: Request, body: { admin_secret?: string }): Promise<boolean> {
  if (ADMIN_BROADCAST && body.admin_secret && body.admin_secret === ADMIN_BROADCAST) return true;
  const adminKey = req.headers.get('x-admin-key');
  if (adminKey && SUPABASE_SERVICE_KEY && adminKey === SUPABASE_SERVICE_KEY) return true;
  const auth = req.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length);
  if (token === SUPABASE_SERVICE_KEY) return true;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: auth } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return false;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: prof } = await admin.from('users').select('role').eq('auth_id', user.id).maybeSingle();
    return prof?.role === 'admin' || prof?.role === 'gestor';
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!SUPABASE_SERVICE_KEY) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurada' }, 503);

    let body: { user_ids?: string[]; title?: string; body?: string; url?: string; admin_secret?: string; broadcast?: boolean; force_email?: boolean };
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const { user_ids, title, body: msgBody, url, broadcast, force_email } = body;
    if (!title || !msgBody) return json({ error: 'title y body requeridos' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let users: Array<{ id: string; push_token: string | null; web_push_subs: any; correo: string | null }> = [];

    if (broadcast === true) {
      // Broadcast a TODOS. Solo admin/gestor/secret. Traemos a todos para poder
      // mandar email de respaldo a quienes el push NO alcance.
      const ok = await broadcastAllowed(req, body);
      if (!ok) return json({ error: 'No autorizado para broadcast' }, 401);
      const { data, error } = await supabase
        .from('users')
        .select('id, push_token, web_push_subs, correo');
      if (error) return json({ error: error.message }, 500);
      users = data ?? [];
    } else {
      const ok = await isAuthorized(req, body);
      if (!ok) return json({ error: 'No autorizado' }, 401);
      if (!Array.isArray(user_ids) || user_ids.length === 0) return json({ error: 'user_ids requerido' }, 400);
      const { data, error } = await supabase
        .from('users')
        .select('id, push_token, web_push_subs, correo')
        .in('id', user_ids);
      if (error) return json({ error: error.message }, 500);
      users = data ?? [];
    }

    const result = {
      audience: users.length,
      expo:  { sent: 0, failed: 0 },
      web:   { sent: 0, failed: 0, removed: 0 },
      email: { sent: 0, failed: 0 },
    };

    // user_ids que recibieron AL MENOS un push OK (expo o web). El email de
    // respaldo va solo a quienes NO estén acá → cubre a los realmente inalcanzables
    // por push (sin token, o con sub muerta que falla ahora).
    const reached = new Set<string>();

    // ── Expo push (móvil nativo) ────────────────────────────────────────────
    const expoTargets = users.filter(u => !!u.push_token);
    if (expoTargets.length) {
      const BATCH = 100;
      for (let i = 0; i < expoTargets.length; i += BATCH) {
        const slice = expoTargets.slice(i, i + BATCH);
        const batch = slice.map(u => ({
          to: u.push_token, title, body: msgBody, sound: 'default',
          ...(url ? { data: { url } } : {}),
        }));
        try {
          const r = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
          });
          if (r.ok) { result.expo.sent += slice.length; slice.forEach(u => reached.add(u.id)); }
          else result.expo.failed += slice.length;
        } catch {
          result.expo.failed += slice.length;
        }
      }
    }

    // ── Web push (VAPID) ────────────────────────────────────────────────────
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const payload = JSON.stringify({ title, body: msgBody, url });
      const stale: Array<{ user_id: string; endpoint: string }> = [];

      for (const u of users) {
        const subs = Array.isArray(u.web_push_subs) ? u.web_push_subs : [];
        for (const sub of subs) {
          try {
            await webpush.sendNotification(sub, payload);
            result.web.sent++;
            reached.add(u.id);
          } catch (e: any) {
            const status = e?.statusCode ?? 0;
            if (status === 404 || status === 410) {
              stale.push({ user_id: u.id, endpoint: sub.endpoint });
              result.web.removed++;
            } else {
              result.web.failed++;
              console.error('web push error', status, e?.body ?? e?.message);
            }
          }
        }
      }

      if (stale.length) {
        const byUser = stale.reduce<Record<string, string[]>>((acc, s) => {
          (acc[s.user_id] ??= []).push(s.endpoint);
          return acc;
        }, {});
        for (const [userId, endpoints] of Object.entries(byUser)) {
          const u = users.find(x => x.id === userId)!;
          const filtered = (u.web_push_subs ?? []).filter((s: any) => !endpoints.includes(s.endpoint));
          await supabase.from('users').update({ web_push_subs: filtered }).eq('id', userId);
        }
      }
    }

    // ── Email de respaldo (Resend) ──────────────────────────────────────────
    // Estaba con las funciones auxiliares (renderEmailHtml/sendEmailsViaResend)
    // ya construidas pero nunca invocadas, y force_email se recibia (arriba)
    // pero jamas se usaba — "Email desactivado" quedo pisando codigo real.
    // Hallazgo confirmado 2026-07-07: con la ventana de waitlist bajando a 10
    // minutos (waitlist-notify manda force_email:true a proposito) depender
    // solo de web push opt-in deja a la mayoria de una lista de espera sin
    // ningun aviso real y su cupo se pierde en silencio.
    // force_email=true -> se manda a TODOS los que tengan correo (refuerza la
    // entrega para avisos de alto riesgo / ventana corta); si no, es respaldo
    // normal: solo a quienes el push NO alcanzo. Si RESEND_API_KEY no esta
    // configurada, sendEmailsViaResend ya no-opea sola — mismo comportamiento
    // "silencioso si falta config" que documentaba el comentario original.
    const emailTargets = users.filter(u => !!u.correo && (force_email === true || !reached.has(u.id)));
    if (emailTargets.length) {
      const html = renderEmailHtml(title, msgBody, url);
      const { sent, failed } = await sendEmailsViaResend(emailTargets.map(u => u.correo!), title, html);
      result.email.sent = sent;
      result.email.failed = failed;
    }

    return json({ ok: true, result });
  } catch (e) {
    console.error('send-notification fatal:', e);
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500);
  }
});
