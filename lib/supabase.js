import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const isWeb = Platform.OS === 'web';

// En web: usar localStorage directo (más rápido que el wrapper async)
// y reemplazar el lock interno por un no-op para evitar que getSession()
// cuelgue indefinidamente cuando navigator.locks tiene un acquire trabado.
const webStorage = (typeof window !== 'undefined' && window.localStorage)
  ? {
      getItem:    (k) => window.localStorage.getItem(k),
      setItem:    (k, v) => window.localStorage.setItem(k, v),
      removeItem: (k) => window.localStorage.removeItem(k),
    }
  : undefined;

const noopLock = async (name, acquireTimeout, fn) => fn();

// Limpia tokens sb-* del localStorage cuando la sesión está corrupta o expirada
// y getSession() falla / cuelga. Sin esto, cada reload repite el mismo timeout.
export function clearCorruptedSession() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith('sb-'))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch (_) {}
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isWeb ? webStorage : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: isWeb,
    ...(isWeb ? { lock: noopLock } : {}),
  },
});
