// Compartir invitación al Mundial 2026 con código de referido.
// Excepción consciente a la regla "compartir solo manda birrea2play.com"
// (decisión 2026-05-20): el link de referido SÍ lleva ?ref=CODE para que el
// amigo entre con el descuento de $2 y se le atribuya al referidor el bono de $3.
import { Platform, Share, Alert } from 'react-native';

const BASE = 'https://birrea2play.com';

export function buildReferralMessage({ code, survivorPozo, pollaPozo }) {
  const lines = [];
  lines.push('🏆 ¡Jugá el MUNDIAL 2026 en Birrea2Play!');
  lines.push('');
  if (survivorPozo != null) lines.push(`🟢 SURVIVOR · Bolsa acumulada: $${Number(survivorPozo).toFixed(0)}`);
  if (pollaPozo != null)    lines.push(`🟣 POLLA GANADORA · Bolsa acumulada: $${Number(pollaPozo).toFixed(0)}`);
  if (survivorPozo != null || pollaPozo != null) lines.push('');
  lines.push(`🎟️ Registrate con mi código *${code}* y te ahorrás $2 en tu inscripción.`);
  lines.push('');
  lines.push(`👉 ${BASE}/mundial?ref=${encodeURIComponent(code)}`);
  return lines.join('\n');
}

export async function shareReferral({ code, survivorPozo, pollaPozo }) {
  const message = buildReferralMessage({ code, survivorPozo, pollaPozo });
  const url = `${BASE}/mundial?ref=${encodeURIComponent(code)}`;
  const title = 'Mundial 2026 — Birrea2Play';

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text: message, url });
      return { ok: true, method: 'web-share' };
    } catch (e) {
      if (e?.name === 'AbortError') return { ok: false, method: 'cancelled' };
    }
  }

  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(message);
      Alert.alert('Copiado al portapapeles', 'Pegá la invitación en WhatsApp o donde quieras.');
      return { ok: true, method: 'clipboard' };
    } catch {}
  }

  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message, url, title });
      return { ok: true, method: 'native-share' };
    } catch {}
  }

  Alert.alert('Invitación al Mundial', message);
  return { ok: false, method: 'alert' };
}
