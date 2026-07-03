// Feature flags locales para previews NO destructivos.
//
// isSocialPreviewEnabled controla la visibilidad del preview del muro social
// ("El Recap de la Birrea"). Es 100% local/gateado: en produccion el usuario
// normal nunca lo ve ni puede navegar a el.
//
// Revertir el preview por completo = devolver false aca (o borrar este archivo)
// y quitar el bloque condicional de AppNavigator + el launcher en AdminPanel.
// No usa env vars, ni DB, ni build flags de Vercel.

import { Platform } from 'react-native';

const SOCIAL_PREVIEW_LS_KEY = 'b2p_social_preview';
const BELT_PREVIEW_LS_KEY = 'b2p_belt_preview';

export function isSocialPreviewEnabled(user) {
  // 1) En desarrollo local siempre on (npm run web -> __DEV__ === true).
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;

  // 2) Admin lo alcanza tambien en prod, via el launcher del Panel Admin.
  if (user?.role === 'admin') return true;

  // 3) Escape hatch manual desde devtools en web:
  //    localStorage.setItem('b2p_social_preview', '1')
  //    Acceso a localStorage SOLO aca dentro, con guardas (incognito puede tirar).
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      return window.localStorage?.getItem(SOCIAL_PREVIEW_LS_KEY) === '1';
    } catch {
      return false;
    }
  }

  return false;
}

// Mismo patron/gate que isSocialPreviewEnabled, para el preview de El Cinturon del Barrio
// (capa de cinturones SOBRE las historias). Revertir = devolver false.
export function isBeltPreviewEnabled(user) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (user?.role === 'admin') return true;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      return window.localStorage?.getItem(BELT_PREVIEW_LS_KEY) === '1';
    } catch {
      return false;
    }
  }
  return false;
}
