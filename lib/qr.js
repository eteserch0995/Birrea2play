// Generacion de QR en JS puro (web + native via OTA, sin canvas ni deps de node).
// Usa qrcode-generator: createDataURL() devuelve un data-URI GIF sincrono.
import qrcode from 'qrcode-generator';

/**
 * Devuelve un data-URI (image/gif) con el QR del texto, o null si falla.
 * @param {string} text
 * @param {{ size?: number }} [opts]  size = lado objetivo en px (aprox)
 * @returns {string|null}
 */
export function qrToDataURL(text, opts = {}) {
  const size = opts.size ?? 240;
  try {
    const qr = qrcode(0, 'M'); // typeNumber 0 = auto, correccion media
    qr.addData(String(text ?? ''));
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.max(2, Math.round(size / (count + 2)));
    return qr.createDataURL(cell, cell);
  } catch (_) {
    return null;
  }
}
