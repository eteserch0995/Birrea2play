// Vercel Serverless Function: sirve un HTML con Open Graph metadata dinámico
// para que WhatsApp / Twitter / Facebook / Discord muestren preview con la
// info del evento al compartir el link.
//
// Para users normales: hace meta-refresh + JS redirect inmediato a /evento/:id
// (donde la SPA toma control via React Navigation linking config).
//
// Para crawlers/bots: leen las OG tags y muestran preview pretty.

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PUBLIC_URL = 'https://birrea2play.com';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateLong(fecha, hora) {
  if (!fecha) return '';
  try {
    const [y, m, d] = fecha.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const datePart = dt.toLocaleDateString('es-PA', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    return datePart + (hora ? ` · ${hora.slice(0, 5)}` : '');
  } catch {
    return `${fecha}${hora ? ` ${hora.slice(0,5)}` : ''}`;
  }
}

async function fetchEventInfo(id) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const evResp = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=id,nombre,deporte,formato,fecha,hora,lugar,direccion,descripcion,precio,cupos_total,cupos_ilimitado,cancha_foto_url,status,visible`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!evResp.ok) return null;
    const events = await evResp.json();
    const ev = events?.[0];
    if (!ev) return null;

    // Contar inscritos confirmados + invitados con cupo
    const [regsResp, guestsResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/event_registrations?event_id=eq.${id}&status=eq.confirmed&select=id`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'count=exact' },
      }),
      fetch(`${SUPABASE_URL}/rest/v1/event_guests?event_id=eq.${id}&status=in.(confirmed,pending_payment)&select=id`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Prefer: 'count=exact' },
      }),
    ]);
    const regsCountHeader   = regsResp.headers.get('content-range')   ?? '';
    const guestsCountHeader = guestsResp.headers.get('content-range') ?? '';
    const regsCount   = parseInt(regsCountHeader.split('/')?.[1] ?? '0', 10) || 0;
    const guestsCount = parseInt(guestsCountHeader.split('/')?.[1] ?? '0', 10) || 0;
    const inscritos = regsCount + guestsCount;

    return { ...ev, inscritos };
  } catch {
    return null;
  }
}

// Detecta si el user-agent es un crawler/scraper que pre-fetcha OG metadata.
// Lista basada en user-agents reales de bots de social media + buscadores.
function isCrawler(ua) {
  if (!ua) return false;
  const re = /(facebookexternalhit|facebot|whatsapp|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|googlebot|bingbot|applebot|yahoo!\s*slurp|baiduspider|yandexbot|duckduckbot|ia_archiver|embedly|quora\s*link\s*preview|pinterestbot|skype|vkshare|w3c_validator|whatsbot)/i;
  return re.test(ua);
}

function buildOgHtml(ev, redirectUrl) {
  const title = ev ? `${ev.nombre} — Birrea2Play` : 'Birrea2Play';

  const lines = [];
  if (ev) {
    lines.push(`${ev.deporte ?? 'Fútbol'} · ${ev.formato ?? ''}`.trim());
    lines.push(formatDateLong(ev.fecha, ev.hora));
    if (ev.lugar) lines.push(`📍 ${ev.lugar}`);
    if ((ev.precio ?? 0) > 0) lines.push(`💵 $${Number(ev.precio).toFixed(2)} por jugador`);
    else lines.push('💵 GRATIS');
    if (ev.cupos_ilimitado) {
      lines.push(`👥 Cupos ilimitados (${ev.inscritos} inscritos)`);
    } else if (ev.cupos_total) {
      const restantes = Math.max(0, ev.cupos_total - ev.inscritos);
      lines.push(`👥 ${restantes}/${ev.cupos_total} cupos disponibles`);
    }
  }
  const description = lines.filter(Boolean).join(' · ');
  const ogImage = ev?.cancha_foto_url || `${PUBLIC_URL}/icon.png`;

  return `<!DOCTYPE html>
<html lang="es" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>

  <!-- Open Graph -->
  <meta property="og:title"       content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image"       content="${escapeHtml(ogImage)}" />
  <meta property="og:url"         content="${escapeHtml(redirectUrl)}" />
  <meta property="og:type"        content="website" />
  <meta property="og:site_name"   content="Birrea2Play" />
  <meta property="og:locale"      content="es_PA" />

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image" />
  <meta name="twitter:title"       content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image"       content="${escapeHtml(ogImage)}" />

  <meta name="theme-color" content="#C8102E" />

  <!-- Redirect a la SPA para users normales -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(redirectUrl)}" />
  <script>window.location.replace(${JSON.stringify(redirectUrl)})</script>

  <style>
    body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #07101F; color: #fff; }
    .card { max-width: 480px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p  { margin: 6px 0; color: #B0BFCF; line-height: 1.4; }
    a  { display: inline-block; margin-top: 16px; background: #C8102E; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(ev?.nombre ?? 'Birrea2Play')}</h1>
    <p>${escapeHtml(description)}</p>
    ${ev?.descripcion ? `<p>${escapeHtml(ev.descripcion)}</p>` : ''}
    <a href="${escapeHtml(redirectUrl)}">Abrir en Birrea2Play →</a>
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const id = req.query?.id ?? '';
  const spaUrl = `${PUBLIC_URL}/evento/${encodeURIComponent(id)}`;

  // Si no hay ID válido, redirect a home
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    res.setHeader('Location', PUBLIC_URL);
    res.status(302).end();
    return;
  }

  const ua = req.headers['user-agent'] ?? '';
  const isBot = isCrawler(ua);

  // Browser real (no bot) → redirect HTTP directo a la SPA.
  // Más rápido y compatible con browsers embebidos de WhatsApp/IG/etc.
  if (!isBot) {
    res.setHeader('Location', spaUrl);
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.status(302).end();
    return;
  }

  // Crawler/scraper → HTML con OG metadata para que muestre preview
  const ev = await fetchEventInfo(id);
  const html = buildOgHtml(ev, spaUrl);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
