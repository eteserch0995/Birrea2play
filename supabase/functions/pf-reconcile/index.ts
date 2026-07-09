/**
 * pf-reconcile — Edge Function (interna, verify_jwt=false, protegida por x-sync-secret)
 *
 * Reconcilia recargas con tarjeta (PagueloFácil) que quedaron sin acreditar porque el
 * navegador no volvió por el RETURN_URL. Consulta la API de PagueloFácil
 * (MerchantTransactions) por las transacciones APROBADAS y acredita las órdenes
 * pf_pending_payments atascadas que sí se cobraron. No depende del redirect ni de que
 * PF configure un webhook.
 *
 * Modos (?mode= o body.mode):
 *  - 'inspect' → devuelve la respuesta CRUDA de PF (para descubrir el formato). NO escribe.
 *  - 'dry'     → matchea pendientes vs PF y devuelve qué acreditaría. NO escribe.
 *  - 'run'     → acredita de verdad (idempotente). Default del cron.
 *
 * NOTA: arranca en modo inspect-only mientras confirmamos el formato de respuesta de PF.
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const PF_ACCESS_TOKEN = (Deno.env.get('PF_ACCESS_TOKEN') ?? '').trim();
const IS_PROD         = Deno.env.get('PF_ENV') === 'production';
// MerchantTransactions vive en admin.paguelofacil.com (prod) / sandbox (test),
// distinto del host de LinkDeamon (secure.paguelofacil.com).
const PF_MGMT_BASE    = IS_PROD ? 'https://admin.paguelofacil.com' : 'https://sandbox.paguelofacil.com';
const SYNC_SECRET     = Deno.env.get('SYNC_SECRET') ?? '9f3c1ade7b62408d5e1142aa0c7be93d6f08a214';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

function pad(n: number) { return String(n).padStart(2, '0'); }
// ISO local sin timezone: YYYY-MM-DDTHH:MM:SS
function fmt(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Auth interna
  const url    = new URL(req.url);
  const secret = req.headers.get('x-sync-secret') ?? url.searchParams.get('secret') ?? '';
  if (secret !== SYNC_SECRET) return json({ error: 'unauthorized' }, 401);

  if (!PF_ACCESS_TOKEN) return json({ error: 'PF_ACCESS_TOKEN no configurado' }, 500);

  let bodyMode = ''; let bodyDays = 0;
  if (req.method === 'POST') {
    try { const b = await req.json(); bodyMode = b.mode ?? ''; bodyDays = Number(b.days) || 0; } catch { /* */ }
  }
  const mode = (url.searchParams.get('mode') ?? bodyMode ?? 'inspect') || 'inspect';
  const days = Number(url.searchParams.get('days')) || bodyDays || 12;

  // Rango de fechas (últimos N días) en el formato dateTms$bt<inicio>::<fin>
  const now   = new Date();
  const from  = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const start = fmt(from);
  const end   = fmt(new Date(now.getTime() + 6 * 60 * 60 * 1000)); // margen +6h por TZ
  const conditional = `dateTms$bt${start}::${end}`;

  const qs = new URLSearchParams();
  qs.set('limit', '200');
  qs.set('sort', '-dateTms');
  qs.set('conditional', conditional);
  const pfUrl = `${PF_MGMT_BASE}/PFManagementServices/api/v1/MerchantTransactions/?${qs.toString()}`;

  let pfStatus = 0; let pfBodyText = ''; let pfJson: unknown = null;
  try {
    const r = await fetch(pfUrl, { method: 'GET', headers: { 'Authorization': PF_ACCESS_TOKEN, 'Accept': 'application/json' } });
    pfStatus = r.status;
    pfBodyText = await r.text();
    try { pfJson = JSON.parse(pfBodyText); } catch { /* no json */ }
  } catch (e) {
    return json({ error: 'fetch PF falló', detail: (e as Error).message, pfUrl: pfUrl.replace(PF_ACCESS_TOKEN, '') }, 502);
  }

  // Modo inspect: devolver la respuesta cruda (truncada) para descubrir el formato.
  if (mode === 'inspect') {
    return json({
      ok: true,
      mode,
      pfUrl,
      base: PF_MGMT_BASE,
      is_prod: IS_PROD,
      conditional,
      pfStatus,
      pfJsonType: Array.isArray(pfJson) ? 'array' : typeof pfJson,
      pfRawTruncated: pfBodyText.slice(0, 6000),
    });
  }

  // dry/run: pendiente de implementar el matcheo una vez confirmado el formato.
  return json({ ok: false, mode, note: 'matcheo/credito pendiente hasta confirmar el formato de la respuesta PF (correr mode=inspect primero)', pfStatus });
});
