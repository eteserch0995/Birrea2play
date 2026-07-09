/**
 * cancha-notify v3 — Edge Function (módulo reservas de canchas, flujo v4)
 * Deploy: supabase functions deploy cancha-notify --no-verify-jwt
 *
 * v3 (2026-07-05, pedido Sergio): además del push, manda SIEMPRE un correo
 * branded (plantilla Birrea2Play vía Resend, remitente birrea2play.com) al
 * gestor de cancha / gestor de birreas con botón de acción contextual
 * ("Revisar y aprobar", "Pagar el abono", etc.). El push va por
 * send-notification (force_email:false para no duplicar correos).
 *
 * Modos — los dispara el trigger `trg_cancha_reserva_notify`:
 *   'nueva-solicitud'        → DUEÑO cancha  · CTA "Revisar y aprobar"
 *   'reserva-aprobada-pagar' → GESTOR        · CTA "Pagar el abono"
 *   'reserva-aprobada'       → GESTOR        · CTA "Ver mi reserva"
 *   'abono-pagado'           → DUEÑO cancha  · CTA "Ver la agenda"
 *   'reserva-rechazada'      → GESTOR        · CTA "Buscar otro horario"
 *   'saldo-pagado'           → DUEÑO cancha  · CTA "Ver la agenda"
 *   'pago-vencido'           → GESTOR        · CTA "Reservar de nuevo"
 *   'solicitud-vencida'      → GESTOR        · CTA "Buscar otro horario"
 *
 * Auth: header `x-sync-secret` == WC_SYNC_SECRET (patrón wc-notify).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SYNC_SECRET    = Deno.env.get('WC_SYNC_SECRET') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const EMAIL_FROM     = Deno.env.get('EMAIL_FROM') ?? 'Birrea2Play <avisos@birrea2play.com>';

const URL_APP     = 'https://birrea2play.com';
const URL_RESERVA = 'https://birrea2play.com/cancha/reservar';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// ── push (send-notification, SIN email — el email va directo por Resend acá) ──
async function sendPush(userIds: string[], title: string, body: string, url: string) {
  if (!userIds.length) return { audience: 0 };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': SERVICE_KEY },
    body: JSON.stringify({ user_ids: userIds, title, body, url, force_email: false }),
  });
  const out = await r.json().catch(() => ({}));
  return { audience: userIds.length, status: r.status, result: out };
}

// ── email branded (misma plantilla de send-notification + detalles y CTA propio) ──
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderReservaEmail(opts: {
  title: string; body: string; ctaLabel: string; url: string;
  detalles: Array<[string, string]>;
}): string {
  const safeUrl = /^https?:\/\//i.test(opts.url) ? opts.url : URL_APP;
  const filas = opts.detalles
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:#6B7480;font-family:Arial,Helvetica,sans-serif;">${esc(k)}</td>
        <td style="padding:6px 0;font-size:13px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;text-align:right;font-weight:700;">${esc(v)}</td>
      </tr>`)
    .join('');
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
            ${esc(opts.title)}
          </div>
        </td></tr>
        <tr><td style="padding:10px 28px 0 28px;">
          <div style="font-size:15px;color:#C7CEDA;font-family:Arial,Helvetica,sans-serif;line-height:1.5;">
            ${esc(opts.body)}
          </div>
        </td></tr>
        ${filas ? `
        <tr><td style="padding:16px 28px 0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0D10;border:1px solid #1B2230;border-radius:12px;padding:6px 16px;">
            ${filas}
          </table>
        </td></tr>` : ''}
        <tr><td style="padding:18px 28px 26px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="padding:8px 0 4px 0;">
              <a href="${esc(safeUrl)}" style="display:inline-block;background:#001A4D;color:#B8FF00;text-decoration:none;
                font-weight:900;font-size:16px;padding:14px 30px;border-radius:10px;letter-spacing:0.3px;border:2px solid #B8FF00;mso-line-height-rule:exactly;">${esc(opts.ctaLabel)}</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <div style="max-width:480px;color:#6B7480;font-size:12px;font-family:Arial,Helvetica,sans-serif;padding:16px 28px;line-height:1.5;">
        Recibís este correo porque tenés una cuenta en Birrea2Play.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

async function sendEmail(to: string | null | undefined, subject: string, html: string) {
  if (!to) return { emailed: false, reason: 'sin_correo' };
  if (!RESEND_API_KEY) return { emailed: false, reason: 'sin_api_key' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('resend error', r.status, detail);
      return { emailed: false, reason: `resend_${r.status}`, detail: detail.slice(0, 200) };
    }
    return { emailed: true };
  } catch (e) {
    console.error('resend exception', (e as Error).message);
    return { emailed: false, reason: 'exception', detail: (e as Error).message };
  }
}

// ── helpers de formato ──
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : '');
const money = (n?: number | null) => `$${Number(n ?? 0).toFixed(2)}`;
const fechaLegible = (f?: string | null) => {
  try {
    return f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-PA', { weekday: 'long', day: '2-digit', month: 'long' }) : '';
  } catch { return f ?? ''; }
};
const horaLegible = (ts?: string | null) => {
  try {
    return ts ? new Date(ts).toLocaleString('es-PA', { timeZone: 'America/Panama', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  } catch { return ''; }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');

  if (!SYNC_SECRET || (req.headers.get('x-sync-secret') ?? '') !== SYNC_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { mode?: string; reserva_id?: string } = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const { mode, reserva_id } = body;
  if (!mode || !reserva_id) return json({ error: 'mode y reserva_id requeridos' }, 400);

  try {
    const { data: r, error } = await supabase
      .from('cancha_reservas')
      .select('id, codigo_reserva, fecha, hora_inicio, hora_fin, status, estado_pago, monto_total, deposito_requerido, deposito_pagado, saldo_pagado, motivo_rechazo, expira_en, gestor_id, cancha_id, canchas:cancha_id(nombre, owner_id), gestor:gestor_id(nombre, correo)')
      .eq('id', reserva_id)
      .maybeSingle();
    if (error) throw error;
    if (!r) return json({ ok: true, skipped: 'reserva no encontrada' });

    const cancha = (Array.isArray(r.canchas) ? r.canchas[0] : r.canchas) as { nombre?: string; owner_id?: string } | null;
    const gestor = (Array.isArray(r.gestor) ? r.gestor[0] : r.gestor) as { nombre?: string; correo?: string } | null;
    const nombreCancha = cancha?.nombre ?? 'La cancha';
    const cuando = `${fechaLegible(r.fecha)} · ${hhmm(r.hora_inicio)}–${hhmm(r.hora_fin)}`;
    const saldoRestante = Math.max(Number(r.monto_total ?? 0) - Number(r.deposito_pagado ?? 0) - Number(r.saldo_pagado ?? 0), 0);

    // correo del dueño de la cancha (el del gestor viene en el join)
    let ownerCorreo: string | null = null;
    if (cancha?.owner_id) {
      const { data: ow } = await supabase.from('users').select('correo').eq('id', cancha.owner_id).maybeSingle();
      ownerCorreo = ow?.correo ?? null;
    }

    const detallesBase: Array<[string, string]> = [
      ['Cancha', nombreCancha],
      ['Fecha', fechaLegible(r.fecha)],
      ['Hora', `${hhmm(r.hora_inicio)} – ${hhmm(r.hora_fin)}`],
      ['Total', money(r.monto_total)],
      ['Código', r.codigo_reserva ?? ''],
    ];

    // ── definición por modo: destino, textos, CTA ──
    let targetUserId: string | null = null;
    let targetCorreo: string | null = null;
    let title = ''; let cuerpo = ''; let ctaLabel = 'Abrir la app'; let url = URL_APP;
    const detalles = [...detallesBase];

    if (mode === 'nueva-solicitud') {
      targetUserId = cancha?.owner_id ?? null; targetCorreo = ownerCorreo;
      title  = '📅 Nueva solicitud de reserva';
      cuerpo = `${gestor?.nombre ?? 'Un gestor'} quiere reservar ${nombreCancha} — ${cuando}. ${Number(r.deposito_requerido ?? 0) > 0 ? `Al aprobarla se le pedirá el abono de ${money(r.deposito_requerido)}.` : 'Sin abono requerido.'} Entrá a tu panel para aprobarla o rechazarla.`;
      ctaLabel = 'Revisar y aprobar';
      detalles.splice(3, 0, ['Solicita', gestor?.nombre ?? '—']);
    } else if (mode === 'reserva-aprobada-pagar') {
      targetUserId = r.gestor_id; targetCorreo = gestor?.correo ?? null;
      title  = '✅ Reserva aprobada — pagá el abono';
      cuerpo = `${nombreCancha} aprobó tu reserva (${cuando}). Pagá el abono de ${money(r.deposito_requerido)}${r.expira_en ? ` antes del ${horaLegible(r.expira_en)}` : ''} para asegurar el horario. Si no se paga a tiempo, el horario se libera.`;
      ctaLabel = 'Pagar el abono';
      url = URL_RESERVA;
      detalles.push(['Abono a pagar', money(r.deposito_requerido)]);
      if (r.expira_en) detalles.push(['Pagar antes de', horaLegible(r.expira_en)]);
    } else if (mode === 'reserva-aprobada') {
      targetUserId = r.gestor_id; targetCorreo = gestor?.correo ?? null;
      title  = '✅ Reserva confirmada';
      cuerpo = `${nombreCancha} confirmó tu reserva — ${cuando}.${saldoRestante > 0 ? ` Saldo: ${money(saldoRestante)} — se paga por la app el día de la reserva.` : ''}`;
      ctaLabel = 'Ver mi reserva';
      url = URL_RESERVA;
    } else if (mode === 'abono-pagado') {
      targetUserId = cancha?.owner_id ?? null; targetCorreo = ownerCorreo;
      title  = '💰 Abono recibido — reserva confirmada';
      cuerpo = `${gestor?.nombre ?? 'El gestor'} pagó el abono de ${money(r.deposito_pagado)} por la reserva ${r.codigo_reserva} (${cuando}). Saldo restante: ${money(saldoRestante)}.`;
      ctaLabel = 'Ver la agenda';
      detalles.push(['Abono pagado', money(r.deposito_pagado)], ['Saldo restante', money(saldoRestante)]);
    } else if (mode === 'reserva-rechazada') {
      targetUserId = r.gestor_id; targetCorreo = gestor?.correo ?? null;
      title  = '❌ Reserva rechazada';
      cuerpo = `${nombreCancha} no pudo confirmar tu reserva (${cuando}).${r.motivo_rechazo ? ` Motivo: ${r.motivo_rechazo}.` : ''}${r.estado_pago === 'reembolsado' ? ` Te devolvimos ${money(Number(r.deposito_pagado ?? 0) + Number(r.saldo_pagado ?? 0))} a tus créditos.` : ''}`;
      ctaLabel = 'Buscar otro horario';
      url = URL_RESERVA;
    } else if (mode === 'saldo-pagado') {
      targetUserId = cancha?.owner_id ?? null; targetCorreo = ownerCorreo;
      title  = '💵 Saldo de reserva pagado';
      cuerpo = `${gestor?.nombre ?? 'El gestor'} completó el pago de la reserva ${r.codigo_reserva} (${cuando}). Total recibido: ${money(Number(r.deposito_pagado ?? 0) + Number(r.saldo_pagado ?? 0))}.`;
      ctaLabel = 'Ver la agenda';
    } else if (mode === 'pago-vencido') {
      targetUserId = r.gestor_id; targetCorreo = gestor?.correo ?? null;
      title  = '⌛ Venció el plazo del abono';
      cuerpo = `No se pagó el abono de la reserva ${r.codigo_reserva} (${nombreCancha}, ${cuando}) a tiempo y el horario quedó liberado. Podés solicitar de nuevo si sigue disponible.`;
      ctaLabel = 'Reservar de nuevo';
      url = URL_RESERVA;
    } else if (mode === 'solicitud-vencida') {
      targetUserId = r.gestor_id; targetCorreo = gestor?.correo ?? null;
      title  = 'Solicitud de reserva vencida';
      cuerpo = `${nombreCancha} no respondió tu solicitud (${cuando}) antes de la hora de la reserva, así que venció. Podés intentar con otro horario.`;
      ctaLabel = 'Buscar otro horario';
      url = URL_RESERVA;
    } else {
      return json({ error: `mode invalido: ${mode}` }, 400);
    }

    if (!targetUserId) return json({ ok: true, skipped: 'sin destinatario' });

    // push (sin email) + email branded SIEMPRE
    const [push, mail] = await Promise.all([
      sendPush([targetUserId], title, cuerpo, url),
      sendEmail(targetCorreo, `${title} · Birrea2Play`, renderReservaEmail({ title, body: cuerpo, ctaLabel, url, detalles })),
    ]);

    return json({ ok: true, mode, push, email: mail });
  } catch (e) {
    console.error('cancha-notify error', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
