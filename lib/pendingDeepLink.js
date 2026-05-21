// Persistencia del destino pendiente cuando el usuario llega a un link de
// evento sin estar logueado: guardamos el eventId antes de mandarlo al login,
// y al detectar SIGNED_IN lo navegamos a EventDetail con ese id.
//
// Por qué hace falta:
// - El NavigationContainer remonta al cambiar `isAuthenticated` (key prop).
// - El linking config se re-evalúa con `window.location.pathname` actual,
//   que en ese momento es `/login` o `/registro`, no `/evento/:id`.
// - Sin esto, el deep link se pierde después del login.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'b2p:pending_deep_link';
const TTL_MS = 30 * 60 * 1000; // 30 min: si tarda más, ya es ruido

export async function setPendingDeepLink(payload) {
  if (!payload || typeof payload !== 'object') return;
  try {
    const data = { ...payload, ts: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[pendingDeepLink] set failed', e?.message);
  }
}

export async function getPendingDeepLink() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.ts || Date.now() - data.ts > TTL_MS) {
      await AsyncStorage.removeItem(KEY).catch(() => {});
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function clearPendingDeepLink() {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
