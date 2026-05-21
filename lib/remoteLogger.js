// remoteLogger.js — DIAGNOSE-MOBILE agent
// Envía logs críticos a Supabase `client_logs` para capturar bugs reales en Android Chrome.
// No edites EventDetailScreen ni App.js directamente — este módulo se inicializa en App.js
// y se llama desde EventDetailScreen con los 4 puntos de instrumentación documentados abajo.
//
// INICIALIZACIÓN (App.js, llamar UNA vez al arrancar):
//   import { initRemoteLogger } from './lib/remoteLogger';
//   initRemoteLogger();   // sin args — autodetecta supabase client internamente
//
// REGLA: nunca loggear passwords/tokens. Sanitización idéntica a lib/logger.js.

import { Platform } from 'react-native';
import { supabase } from './supabase';

// ─── Config ──────────────────────────────────────────────────────────────────

const BUFFER_MAX       = 50;   // registros en memoria
const FLUSH_INTERVAL   = 5000; // ms entre flushes automáticos
const FLUSH_THRESHOLD  = 10;   // flush inmediato al llegar a N logs
const SAMPLE_RATE_REST = 0.05; // 5% para pantallas genéricas
// errores y EventDetail siempre al 100%

// ─── Estado interno ───────────────────────────────────────────────────────────

let _initialized      = false;
let _flushTimer       = null;
let _buffer           = [];          // cola de registros pendientes de enviar
let _sessionId        = null;
let _userId           = null;        // se actualiza desde fuera con setRemoteLogUser()

// ─── Session ID anónimo ───────────────────────────────────────────────────────

function getSessionId() {
  if (_sessionId) return _sessionId;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      let sid = window.localStorage.getItem('client_session_id');
      if (!sid) {
        sid = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        window.localStorage.setItem('client_session_id', sid);
      }
      _sessionId = sid;
      return sid;
    }
  } catch (_) {}
  // Fallback sin localStorage (SSR / RN native)
  _sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return _sessionId;
}

// ─── API pública: actualizar userId cuando el user loguea/desloguea ───────────

export function setRemoteLogUser(uid) {
  _userId = uid ?? null;
}

// ─── Sanitización (igual que logger.js) ─────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'pwd', 'token', 'secret', 'apiKey', 'api_key',
  'authorization', 'cookie', 'session', 'access_token', 'refresh_token',
]);

function sanitizeValue(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '...' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeValue(v, depth + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : sanitizeValue(value[k], depth + 1);
  }
  return out;
}

// ─── Performance timing ───────────────────────────────────────────────────────

function getWebTiming() {
  if (typeof window === 'undefined' || !window.performance?.timing) return null;
  try {
    const t = window.performance.timing;
    const nav = t.navigationStart;
    return {
      domContentLoaded: t.domContentLoadedEventEnd - nav,
      loadEventEnd:     t.loadEventEnd - nav,
      // tFetchEvent se calcula y se pasa como data.tFetchEvent desde EventDetailScreen
    };
  } catch (_) { return null; }
}

// ─── Core: encolar un log ─────────────────────────────────────────────────────

/**
 * remoteLog({ screen, action, level, eventId, data, error })
 *
 * screen : string — nombre de la pantalla/componente (ej. 'EventDetail')
 * action : string — qué pasó (ej. 'mount', 'fetch_start', 'fetch_end', 'unmount', 'error')
 * level  : 'info' | 'warn' | 'error'  (default 'info')
 * eventId: uuid string | null
 * data   : objeto plano con contexto adicional (ej. { hasEvent: true, httpStatus: 200 })
 * error  : Error object | null
 */
export function remoteLog({ screen, action, level = 'info', eventId = null, data = null, error = null } = {}) {
  // Sample rate
  const isEventDetail = screen === 'EventDetail';
  const isError       = level === 'error' || level === 'warn';
  if (!isEventDetail && !isError && Math.random() > SAMPLE_RATE_REST) return;

  const timing = isEventDetail ? getWebTiming() : null;

  const record = {
    session_id:    getSessionId(),
    user_id:       _userId ?? null,
    screen:        screen ?? null,
    action:        action ?? null,
    level:         level,
    event_id:      eventId ?? null,
    data:          sanitizeValue({ ...( data ?? {}), ...(timing ? { _timing: timing } : {}) }),
    user_agent:    typeof navigator !== 'undefined' ? navigator.userAgent : null,
    url:           typeof window !== 'undefined' ? window.location.href : null,
    error_message: error?.message ?? null,
    error_stack:   error?.stack   ? error.stack.slice(0, 2000) : null,
  };

  // Mantener buffer acotado — descartar los más viejos si supera BUFFER_MAX
  if (_buffer.length >= BUFFER_MAX) {
    _buffer.shift();
  }
  _buffer.push(record);

  // Flush inmediato si alcanzamos el umbral de batch
  if (_buffer.length >= FLUSH_THRESHOLD) {
    _flushNow();
  }
}

// ─── Flush ────────────────────────────────────────────────────────────────────

async function _flushNow() {
  if (_buffer.length === 0) return;
  const batch = _buffer.splice(0, _buffer.length); // drain buffer
  try {
    const { error } = await supabase.from('client_logs').insert(batch);
    if (error) {
      // Re-encolar en caso de fallo transitorio (máx BUFFER_MAX para no crecer sin límite)
      const toRe = batch.slice(0, BUFFER_MAX - _buffer.length);
      _buffer.unshift(...toRe);
    }
  } catch (_) {
    // Red caída — silencioso, se intentará en el próximo ciclo
  }
}

// ─── Captura global de errores no capturados ─────────────────────────────────

function _installGlobalErrorHandlers() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  window.onerror = (message, source, lineno, colno, error) => {
    remoteLog({
      screen: 'GLOBAL',
      action: 'window_onerror',
      level:  'error',
      data:   { message: String(message), source, lineno, colno },
      error:  error ?? new Error(String(message)),
    });
    return false; // no suprimir el error
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const err    = reason instanceof Error ? reason : null;
    remoteLog({
      screen: 'GLOBAL',
      action: 'unhandledrejection',
      level:  'error',
      data:   { reason: err ? err.message : String(reason) },
      error:  err,
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Llamar UNA vez al arrancar la app (desde App.js, antes del primer render).
 * No recibe argumentos.
 *
 * Ejemplo en App.js:
 *   import { initRemoteLogger } from './lib/remoteLogger';
 *   initRemoteLogger();
 */
export function initRemoteLogger() {
  if (_initialized) return;
  _initialized = true;

  getSessionId(); // inicializa session_id en localStorage

  _installGlobalErrorHandlers();

  // Flush periódico
  _flushTimer = setInterval(_flushNow, FLUSH_INTERVAL);

  // Flush al cerrar/ocultar la tab (best-effort, sendBeacon no disponible en todos los casos)
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') _flushNow();
    });
    window.addEventListener('pagehide', () => _flushNow());
  }
}

export default { initRemoteLogger, remoteLog, setRemoteLogUser };
