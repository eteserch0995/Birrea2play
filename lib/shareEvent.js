// Compartir un evento: texto con info del evento + link al dominio.
// El link es SIEMPRE https://birrea2play.com (sin /evento/:id ni /api/og/:id).
// Decisión 2026-05-20: el preview en WhatsApp queda como mensaje con info,
// el link lleva al home del dominio para evitar bugs de deep link en Android.
import { Platform, Share, Alert } from 'react-native';

const PUBLIC_URL = 'https://birrea2play.com';

function formatDateLong(fecha, hora) {
  if (!fecha) return '';
  try {
    const [y, m, d] = fecha.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const datePart = dt.toLocaleDateString('es-PA', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    const timePart = hora ? ` · ${hora.slice(0, 5)}` : '';
    return datePart + timePart;
  } catch {
    return `${fecha}${hora ? ` ${hora.slice(0, 5)}` : ''}`;
  }
}

function buildNumberedList(jugadores, totalCupos) {
  const lines = [];
  const total = totalCupos || Math.max(jugadores.length, 1);
  for (let i = 1; i <= total; i++) {
    const nombre = jugadores[i - 1];
    lines.push(nombre ? `${i}. ✓ ${nombre}` : `${i}.`);
  }
  return lines;
}

export function buildEventShareMessage(event, opts = {}) {
  if (!event) return PUBLIC_URL;
  const {
    inscritos = 0,
    cuposRestantes,
    jugadores = [],
  } = opts;

  const lines = [];
  lines.push(`⚽ ${event.nombre}`);
  if (event.deporte && event.formato) lines.push(`🏅 ${event.deporte} · ${event.formato}`);
  lines.push(`📅 ${formatDateLong(event.fecha, event.hora)}`);
  if (event.lugar) lines.push(`📍 ${event.lugar}${event.direccion ? ` (${event.direccion})` : ''}`);
  if ((event.precio ?? 0) > 0) lines.push(`💵 $${Number(event.precio).toFixed(2)} por jugador`);
  else lines.push(`💵 ${(event.deporte ?? '').trim().toLowerCase() === 'otro' ? 'Entrada Free' : 'FREE'}`);

  if (event.cupos_ilimitado) {
    lines.push(`👥 Cupos ilimitados (${inscritos} inscritos)`);
  } else if (event.cupos_total) {
    const restantes = cuposRestantes ?? Math.max(0, event.cupos_total - inscritos);
    lines.push(`👥 ${restantes}/${event.cupos_total} cupos disponibles`);
  }

  const isMixto = event.genero === 'Mixto';

  if (isMixto) {
    const hombres = jugadores.filter(j => j.genero === 'Masculino').map(j => j.nombre);
    const mujeres = jugadores.filter(j => j.genero === 'Femenino').map(j => j.nombre);
    const cupoH = event.cupos_hombres || hombres.length;
    const cupoM = event.cupos_mujeres || mujeres.length;
    lines.push('');
    lines.push(`🔵 Hombres (${hombres.length}/${cupoH}):`);
    lines.push(...buildNumberedList(hombres, cupoH));
    lines.push('');
    lines.push(`🟣 Mujeres (${mujeres.length}/${cupoM}):`);
    lines.push(...buildNumberedList(mujeres, cupoM));
  } else if (!event.cupos_ilimitado && event.cupos_total) {
    const nombres = jugadores.map(j => typeof j === 'string' ? j : j.nombre);
    lines.push('');
    lines.push(`📋 Inscritos (${nombres.length}/${event.cupos_total}):`);
    lines.push(...buildNumberedList(nombres, event.cupos_total));
  } else if (jugadores.length > 0) {
    const nombres = jugadores.map(j => typeof j === 'string' ? j : j.nombre);
    lines.push('');
    lines.push(`📋 Inscritos (${nombres.length}):`);
    lines.push(...buildNumberedList(nombres, nombres.length));
  }

  lines.push('');
  lines.push('⚠️ Para hacer válida tu inscripción debes completar el registro en la app.');

  if (event.descripcion) {
    lines.push('');
    lines.push(event.descripcion);
  }

  lines.push('');
  lines.push(`Inscribite aquí 👉 ${PUBLIC_URL}`);

  return lines.join('\n');
}

export async function shareEvent(event, opts = {}) {
  const message = buildEventShareMessage(event, opts);
  const url     = PUBLIC_URL;
  const title   = event?.nombre ? `${event.nombre} — Birrea2Play` : 'Birrea2Play';

  // Web: usar navigator.share si está disponible
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text: message, url });
      return { ok: true, method: 'web-share' };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, method: 'cancelled' };
      // fallthrough a clipboard
    }
  }

  // Web fallback: clipboard
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(message);
      Alert.alert('Copiado al portapapeles', 'Ya podés pegar la info del evento en cualquier lado.');
      return { ok: true, method: 'clipboard' };
    } catch {}
  }

  // Native: Share API de RN
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message, url, title });
      return { ok: true, method: 'native-share' };
    } catch {}
  }

  // Último fallback
  Alert.alert('Compartir evento', message);
  return { ok: false, method: 'alert' };
}
