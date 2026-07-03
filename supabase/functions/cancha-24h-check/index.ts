// cancha-24h-check — verifica eventos con cancha vinculada que inician en ~24h.
// Si la birrea está llena: paga la cancha automáticamente desde el pool de inscripciones.
// Si no está llena: marca cancha_confirmacion_pendiente=true para que el gestor decida.
// Llamado por Supabase cron: "0 * * * *" (cada hora).
// Auth: CANCHA_CRON_SECRET en header x-cron-secret, o llamada interna service_role.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET         = Deno.env.get('CANCHA_CRON_SECRET') ?? '';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // Auth: aceptar service_role JWT o el cron secret
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronHeader = req.headers.get('x-cron-secret') ?? '';
  const isServiceRole = authHeader.includes(SUPABASE_SERVICE_KEY);
  const isCronCall    = CRON_SECRET && cronHeader === CRON_SECRET;

  if (!isServiceRole && !isCronCall) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Ventana: eventos que inician entre 23h y 25h a partir de ahora
  const now     = new Date();
  const from24h = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const to24h   = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();

  // Buscar eventos con cancha vinculada, no pagada, en el rango 24h
  // La fecha+hora del evento como timestamptz
  const { data: events, error: evErr } = await db
    .from('events')
    .select(`
      id, nombre, fecha, hora, status,
      cupos_total, cupos_ilimitado, cancha_pagada, cancha_confirmacion_pendiente,
      cancha_slot_id,
      cancha:cancha_id ( id, nombre, owner_id ),
      cancha_slot:cancha_slot_id ( id, precio_hora, hora_inicio )
    `)
    .in('status', ['open', 'active'])
    .not('cancha_slot_id', 'is', null)
    .eq('cancha_pagada', false);

  if (evErr) {
    console.error('Error al buscar eventos:', evErr.message);
    return json({ error: evErr.message }, 500);
  }

  // Filtrar por ventana de tiempo combinando fecha + hora
  const inWindow = (events ?? []).filter(ev => {
    const dt = new Date(`${ev.fecha}T${ev.hora}:00`);
    return dt >= new Date(from24h) && dt <= new Date(to24h);
  });

  if (inWindow.length === 0) {
    return json({ ok: true, checked: 0, msg: 'Sin eventos en ventana 24h' });
  }

  const results: Array<{ id: string; nombre: string; action: string; detail: string }> = [];

  for (const ev of inWindow) {
    // Contar inscripciones confirmadas
    const { count: confirmedCount } = await db
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id)
      .eq('status', 'confirmed');

    const cupos = ev.cupos_total ?? 0;
    const isFull = !ev.cupos_ilimitado && cupos > 0 && (confirmedCount ?? 0) >= cupos;

    if (isFull) {
      // Intentar pago automático
      const { data: payResult, error: payErr } = await db
        .rpc('cancha_auto_pay', { p_event_id: ev.id });

      if (payErr) {
        results.push({ id: ev.id, nombre: ev.nombre, action: 'pay_error', detail: payErr.message });
      } else if (payResult?.ok) {
        results.push({ id: ev.id, nombre: ev.nombre, action: 'auto_paid', detail: `$${payResult.monto_pagado}` });
      } else {
        // Pool insuficiente → marcar como pendiente para que gestor confirme
        await db
          .from('events')
          .update({ cancha_confirmacion_pendiente: true })
          .eq('id', ev.id);
        results.push({ id: ev.id, nombre: ev.nombre, action: 'pending_low_pool', detail: payResult?.msg ?? '' });
      }
    } else {
      // Birrea no llena → alertar al gestor (banner en el dashboard)
      if (!ev.cancha_confirmacion_pendiente) {
        await db
          .from('events')
          .update({ cancha_confirmacion_pendiente: true })
          .eq('id', ev.id);
      }
      results.push({
        id: ev.id,
        nombre: ev.nombre,
        action: 'pending_not_full',
        detail: `${confirmedCount ?? 0}/${cupos} cupos`,
      });
    }
  }

  console.log('cancha-24h-check completado:', JSON.stringify(results));
  return json({ ok: true, checked: inWindow.length, results });
});
