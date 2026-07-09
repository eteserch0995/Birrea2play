// waitlist-notify — avisa (push + email) al jugador que fue PROMOVIDO de la
// lista de espera cuando se liberó un cupo. Se invoca server-side desde
// promote_waitlist vía net.http_post, así que cubre TODAS las rutas de
// cancelación (usuario, invitado, efectivo rechazado, admin, cron TTL) — no
// depende de que el que cancela tenga la app abierta.
//
// Guarded por x-sync-secret (WC_SYNC_SECRET). Reusa la función send-notification
// (push Expo/web + email) pasándole x-admin-key = service role.
const URL = Deno.env.get('SUPABASE_URL') ?? '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SECRET = Deno.env.get('WC_SYNC_SECRET') ?? '';

Deno.serve(async (req) => {
  if ((req.headers.get('x-sync-secret') ?? '') !== SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }
  let userId = '';
  let eventId = '';
  let free = false;
  let customTitle = '';
  let customBody = '';
  try {
    const b = await req.json();
    userId = b.user_id ?? '';
    eventId = b.event_id ?? '';
    free = b.free === true;
    customTitle = b.title ?? '';   // opcional: override del copy (recordatorios manuales)
    customBody = b.body ?? '';
  } catch { /* body inválido */ }
  if (!userId || !eventId) {
    return new Response(JSON.stringify({ error: 'user_id y event_id requeridos' }), { status: 400 });
  }

  // Nombre del evento para el copy.
  let nombre = 'un evento';
  try {
    const r = await fetch(`${URL}/rest/v1/events?id=eq.${eventId}&select=nombre`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]?.nombre) nombre = rows[0].nombre;
  } catch { /* usa fallback */ }

  const title = customTitle
    || (free ? '🎉 ¡Se confirmó tu cupo!' : '🎉 ¡Se liberó tu cupo!');
  const body = customBody
    || (free
      ? `Se liberó un lugar en "${nombre}" y quedaste CONFIRMADO automáticamente. ¡Nos vemos en la cancha!`
      : `Se liberó un cupo en "${nombre}" y es tuyo. Entrá a Birrea2Play y completá el pago (créditos, Yappy o mixto) dentro de los próximos 10 minutos para confirmarlo — pasado ese tiempo, el cupo pasa al siguiente de la lista.`);

  const resp = await fetch(`${URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': KEY, // send-notification acepta service key como admin
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      user_ids: [userId],
      force_email: true,
      title,
      body,
      url: 'https://birrea2play.com',
    }),
  });
  const detail = await resp.text().catch(() => '');
  return new Response(
    JSON.stringify({ ok: resp.ok, status: resp.status, free, detail: detail.slice(0, 200) }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
