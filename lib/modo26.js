// Modo 26 — tema temporal Mundial 2026 (re-skin visual reversible).
// Activacion: el flag localStorage "b2p_modo26" (on/off) tiene prioridad;
// si no hay flag, se activa por ventana de fecha (11-jun -> 19-jul 2026, hora Panama).
// Apagar al final del torneo: poner el flag en "off" o dejar pasar la ventana.

export const MODO26_FLAG_KEY = 'b2p_modo26';
export const MODO26_START_MS = Date.UTC(2026, 5, 11, 5, 0, 0); // 2026-06-11 00:00 PA
export const MODO26_END_MS = Date.UTC(2026, 6, 20, 5, 0, 0);   // 2026-07-20 00:00 PA (cubre hasta 19-jul)

export function getModo26Override() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const v = localStorage.getItem(MODO26_FLAG_KEY);
      if (v === 'on' || v === 'off') return v;
    }
  } catch (e) {}
  return null;
}

export function isModo26Active() {
  const ov = getModo26Override();
  if (ov === 'on') return true;
  if (ov === 'off') return false;
  const now = Date.now();
  return now >= MODO26_START_MS && now < MODO26_END_MS;
}

export function setModo26(on) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(MODO26_FLAG_KEY, on ? 'on' : 'off');
    }
  } catch (e) {}
}

export function clearModo26() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.removeItem(MODO26_FLAG_KEY);
    }
  } catch (e) {}
}

export function applyModo26DomAttribute() {
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      if (isModo26Active()) document.documentElement.setAttribute('data-modo26', 'on');
      else document.documentElement.removeAttribute('data-modo26');
    }
  } catch (e) {}
}
