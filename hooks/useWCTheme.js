import useAuthStore from '../store/authStore';

// Ventana del Mundial 2026 (Panamá = UTC-5 sin DST).
// Visible para todos los users desde el 29-may-2026 00:00 PA (05:00 UTC).
// Termina al cerrar el 19-jul-2026 en Panamá; el 20-jul vuelve el tema normal.
const MUNDIAL_THEME_START_MS = Date.UTC(2026, 4, 29, 5, 0, 0);  // 2026-05-29 05:00 UTC
const MUNDIAL_THEME_END_MS   = Date.UTC(2026, 6, 20, 5, 0, 0);  // 2026-07-20 05:00 UTC

/**
 * Devuelve true si el tema "Mundial 2026" debe estar activo para este user.
 * - Admin: siempre lo ve, para corregir en vivo.
 * - Resto: solo dentro de la ventana del torneo.
 *
 * Para forzar lanzamiento anticipado o desactivar manualmente, cambiar las
 * constantes MUNDIAL_THEME_START_MS / MUNDIAL_THEME_END_MS arriba.
 */
export function useWCTheme() {
  const { user } = useAuthStore();
  if (user?.role === 'admin') return true;
  const now = Date.now();
  return now >= MUNDIAL_THEME_START_MS && now < MUNDIAL_THEME_END_MS;
}

// Versión no-hook para usar fuera de componentes (lib helpers, etc.)
export function isWCThemeActiveNow(userRole) {
  if (userRole === 'admin') return true;
  const now = Date.now();
  return now >= MUNDIAL_THEME_START_MS && now < MUNDIAL_THEME_END_MS;
}

export const WC_THEME_WINDOW = {
  startUtc: new Date(MUNDIAL_THEME_START_MS).toISOString(),
  endUtc:   new Date(MUNDIAL_THEME_END_MS).toISOString(),
  startLabel: '29-may-2026 00:00 PA',
  endLabel:   '19-jul-2026 23:59 PA',
};
