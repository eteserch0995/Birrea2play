// lib/installGate.js — cerebro compartido del embudo de instalación PWA
// (nube coach-mark, handoff post-instalación, gate por acción, bono de $1).
// Consumido por los componentes nuevos del embudo (nube/handoff/gate) y por
// PWAGate.js / useInstallPrompt.js si necesitan la config remota.
//
// Kill switch remoto: public.app_settings key='install_gate'
//   value = { "enabled": bool, "bonus": bool, "cloud": bool }
// Ver migración espejo supabase/migrations/20260703000001_app_settings_install_gate.sql
// (aplicada en prod vía MCP el 2026-07-03).
//
// REGLA DE ORO: fail-open SIEMPRE. Si el fetch del flag falla (red caída,
// tabla vacía, RLS, lo que sea) → { enabled:false, bonus:false, cloud:false }.
// Nunca bloquear a un usuario real por un error de config.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { remoteLog } from './remoteLogger';

const SETTINGS_KEY  = 'install_gate';
const ESCAPE_SS_KEY = 'b2p_gate_escaped';
const CACHE_KEY     = 'b2p_install_gate_cache'; // AsyncStorage, respeta CACHE_TTL_MS
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min

const FAIL_OPEN_FLAGS = Object.freeze({ enabled: false, bonus: false, cloud: false, required: false });

// Cache en memoria de módulo — se comparte entre pantallas sin refetch por
// render (checks síncronos vía getInstallGateFlags()).
let _memCache  = null; // { flags, ts }
let _inflight  = null; // Promise en curso — evita fetches concurrentes duplicados

function isFresh(ts) {
  return typeof ts === 'number' && (Date.now() - ts) < CACHE_TTL_MS;
}

function normalizeFlags(value) {
  if (!value || typeof value !== 'object') return FAIL_OPEN_FLAGS;
  return {
    enabled:  value.enabled === true,
    bonus:    value.bonus === true,
    cloud:    value.cloud === true,
    // v2 (2026-07-05, pedido Sergio): muro DURO — instalar la app es obligatorio
    // en web móvil y, ya instalada, activar notificaciones. Kill switch remoto:
    // UPDATE app_settings SET value=jsonb_set(value,'{required}','false') WHERE key='install_gate'
    required: value.required === true,
  };
}

async function readCacheFromStorage() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isFresh(parsed?.ts)) return null;
    return normalizeFlags(parsed.flags);
  } catch (_) {
    return null; // storage corrupto/no disponible — no es fatal, se ignora
  }
}

async function writeCacheToStorage(flags) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ flags, ts: Date.now() }));
  } catch (_) {
    // best-effort — si falla persistir, el cache en memoria igual sirve para esta sesión
  }
}

// ── Detección de entorno (web-only, misma lógica que PWAGate/useInstallPrompt) ──

// true si la app corre instalada (standalone). Sin web asumimos "ya está
// resuelto" (app nativa no necesita el embudo) — mismo criterio que PWAGate.js.
export function isStandaloneNow() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator?.standalone === true
    );
  } catch { return false; }
}

// true si es navegador móvil (no standalone, no nativo) — candidato a nube/gate.
export function isMobileWeb() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /android|iphone|ipad|ipod/i.test(ua);
}

// true si el navegador es un in-app webview (FB/IG/Line/Twitter/TikTok/Google app).
// OJO: WhatsApp en Android abre el browser externo del sistema, NO es un webview
// embebido como estos — no se marca acá aposta.
export function isInAppWebview() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|Instagram|Line|Twitter|TikTok|GSA/i.test(navigator.userAgent || '');
}

/**
 * getInstallPlatform() → 'android' | 'ios-safari' | 'ios-otro' | 'webview' | 'desktop'
 * Decide qué guía de instalación mostrar (nube/handoff/gate).
 */
export function getInstallPlatform() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';

  if (isInAppWebview()) return 'webview';

  if (/iphone|ipad|ipod/i.test(ua)) {
    const isSafariProper = /safari/i.test(ua) && !/crios|fxios|opios|chromium|chrome/i.test(ua);
    return isSafariProper ? 'ios-safari' : 'ios-otro';
  }

  if (/android/i.test(ua)) return 'android';

  return 'desktop';
}

// ── Flags remotos (kill switch) ──────────────────────────────────────────────

/**
 * fetchInstallGateFlags({ force })
 * Lee el flag remoto install_gate con cache (memoria → AsyncStorage → red).
 * Fail-open: ante cualquier error devuelve { enabled:false, bonus:false, cloud:false }.
 */
export async function fetchInstallGateFlags({ force = false } = {}) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return FAIL_OPEN_FLAGS;

  if (!force && _memCache && isFresh(_memCache.ts)) return _memCache.flags;
  if (!force && _inflight) return _inflight;

  _inflight = (async () => {
    try {
      if (!force) {
        const cached = await readCacheFromStorage();
        if (cached) {
          _memCache = { flags: cached, ts: Date.now() };
          return cached;
        }
      }

      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();

      if (error || !data) throw error ?? new Error('install_gate: sin datos en app_settings');

      const flags = normalizeFlags(data.value);
      _memCache = { flags, ts: Date.now() };
      writeCacheToStorage(flags); // no await — best-effort, no bloquea el resultado
      return flags;
    } catch (_) {
      // Fail-open documentado: un error de red/DB nunca debe bloquear la app.
      // No se persiste a AsyncStorage para que la próxima carga de página
      // reintente contra la red en vez de arrastrar el apagado 10 min en disco.
      _memCache = { flags: FAIL_OPEN_FLAGS, ts: Date.now() };
      return FAIL_OPEN_FLAGS;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

// Lectura síncrona de la última config conocida (para checks en handlers de
// click que no pueden esperar un await, ej. CTA de inscripción). Antes del
// primer fetch exitoso devuelve fail-open.
export function getInstallGateFlags() {
  return _memCache?.flags ?? FAIL_OPEN_FLAGS;
}

// Precalienta la cache apenas se importa el módulo (primera pantalla que lo
// use dispara el fetch), así los checks síncronos posteriores ya tienen dato.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  fetchInstallGateFlags();
}

// ── Escape de sesión (soft escape del gate por acción) ───────────────────────
export function hasEscapedGate() {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(ESCAPE_SS_KEY) === '1'; } catch { return false; }
}
export function setGateEscaped() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(ESCAPE_SS_KEY, '1'); } catch {}
}

// ── Telemetría de embudo ──────────────────────────────────────────────────────

// Steps válidos del embudo (referencia — logFunnel no bloquea steps fuera de
// esta lista, pero mantenerla sincronizada ayuda a no tipear mal en componentes nuevos).
export const FUNNEL_STEPS = [
  'cloud_shown', 'cloud_install_click', 'cloud_ios_guide', 'installed',
  'handoff_shown', 'gate_shown', 'gate_escaped', 'standalone_open',
  'notif_granted', 'notif_denied', 'bonus_claimed',
];

/**
 * logFunnel(step, extra)
 * Telemetría del embudo de instalación vía remoteLogger. Nunca lanza.
 */
export function logFunnel(step, extra = null) {
  try {
    remoteLog({ screen: 'InstallFunnel', action: step, level: 'info', data: extra });
  } catch (_) {
    // silencioso — la telemetría nunca debe romper el flujo del usuario
  }
}

export default {
  isMobileWeb, isStandaloneNow, isInAppWebview, getInstallPlatform,
  fetchInstallGateFlags, getInstallGateFlags,
  hasEscapedGate, setGateEscaped, logFunnel, FUNNEL_STEPS,
};
