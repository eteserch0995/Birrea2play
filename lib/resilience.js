import { Platform } from 'react-native';

// Wraps a promise with a timeout. If it doesn't resolve within `ms`,
// rejects with an Error (or resolves with `fallback` if provided).
export function withTimeout(promise, ms, fallback) {
  const timeout = new Promise((resolve, reject) =>
    setTimeout(() => {
      if (fallback !== undefined) resolve(fallback);
      else reject(new Error(`[resilience] timeout after ${ms}ms`));
    }, ms)
  );
  return Promise.race([promise, timeout]);
}

// Wraps a promise so it never throws. Returns [data, null] or [null, error].
export async function safeAwait(promise) {
  try {
    const data = await promise;
    return [data, null];
  } catch (e) {
    return [null, e];
  }
}

// Returns true if the device/browser believes it has network connectivity.
export function isOnline() {
  if (Platform.OS !== 'web') return true;
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

// Registers window online/offline listeners. Returns cleanup function.
export function onConnectivityChange(callback) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return () => {};
  const onOnline  = () => callback(true);
  const onOffline = () => callback(false);
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online',  onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
