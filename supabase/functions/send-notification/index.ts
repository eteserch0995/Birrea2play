import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY      = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY     = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT         = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@birrea2play.com';
const ADMIN_BROADCAST       = Deno.env.get('ADMIN_BROADCAST_SECRET') ?? '';

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

// Auth básica (modo user_ids): admin_secret, x-admin-key=service, o JWT válido.
async function isAuthorized(req: Request, body: { admin_secret?: string }): Promise<boolean> {
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

    let body: { user_ids?: string[]; title?: string; body?: string; url?: string; admin_secret?: string; broadcast?: boolean };
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const { user_ids, title, body: msgBody, url, broadcast } = body;
    if (!title || !msgBody) return json({ error: 'title y body requeridos' }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let users: Array<{ id: string; push_token: string | null; web_push_subs: any }> = [];

    if (broadcast === true) {
      // Broadcast a TODOS los registrados con algún token. Solo admin/gestor/secret.
      const ok = await broadcastAllowed(req, body);
      if (!ok) return json({ error: 'No autorizado para broadcast' }, 401);
      const { data, error } = await supabase
        .from('users')
        .select('id, push_token, web_push_subs')
        .or('push_token.not.is.null,web_push_subs.not.is.null');
      if (error) return json({ error: error.message }, 500);
      users = data ?? [];
    } else {
      const ok = await isAuthorized(req, body);
      if (!ok) return json({ error: 'No autorizado' }, 401);
      if (!Array.isArray(user_ids) || user_ids.length === 0) return json({ error: 'user_ids requerido' }, 400);
      const { data, error } = await supabase
        .from('users')
        .select('id, push_token, web_push_subs')
        .in('id', user_ids);
      if (error) return json({ error: error.message }, 500);
      users = data ?? [];
    }

    const result = { audience: users.length, expo: { sent: 0, failed: 0 }, web: { sent: 0, failed: 0, removed: 0 } };

    const expoTokens = users.map(u => u.push_token).filter(Boolean) as string[];
    if (expoTokens.length) {
      const BATCH = 100;
      for (let i = 0; i < expoTokens.length; i += BATCH) {
        const batch = expoTokens.slice(i, i + BATCH).map(t => ({
          to: t, title, body: msgBody, sound: 'default',
          ...(url ? { data: { url } } : {}),
        }));
        try {
          const r = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
          });
          if (r.ok) result.expo.sent += batch.length;
          else result.expo.failed += batch.length;
        } catch {
          result.expo.failed += batch.length;
        }
      }
    }

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const payload = JSON.stringify({ title, body: msgBody, url });
      const stale: Array<{ user_id: string; endpoint: string }> = [];

      for (const u of users) {
        const subs = Array.isArray(u.web_push_subs) ? u.web_push_subs : [];
        for (const sub of subs) {
          try {
            await webpush.sendNotification(sub, payload);
            result.web.sent++;
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

    return json({ ok: true, result });
  } catch (e) {
    console.error('send-notification fatal:', e);
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500);
  }
});
