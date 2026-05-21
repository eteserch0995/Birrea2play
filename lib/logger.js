// Logger mínimo unificado. Frontend-only.
// Centraliza el log de errores con metadata estructurada para depuración:
//   pantalla, acción, userId, eventId, mensaje técnico, mensaje mostrado, timestamp.
//
// Hoy: imprime a console (queda visible en Metro / Chrome DevTools) Y envía a
// Supabase client_logs via remoteLogger para diagnóstico Android Chrome en producción.
//
// REGLA: nunca incluir passwords, tokens, claves o datos sensibles.
// Los campos `extra` se filtran abajo.

// Import lazy para evitar ciclo de dependencia (remoteLogger importa supabase)
let _remoteLog = null;
function getRemoteLog() {
  if (!_remoteLog) {
    try {
      // eslint-disable-next-line import/no-cycle
      _remoteLog = require('./remoteLogger').remoteLog;
    } catch (_) {
      _remoteLog = () => {};
    }
  }
  return _remoteLog;
}

const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'pwd', 'token', 'secret', 'apiKey', 'api_key',
  'authorization', 'cookie', 'session', 'access_token', 'refresh_token',
]);

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > 500 ? value.slice(0, 500) + '...' : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
    } else {
      out[k] = sanitize(value[k], depth + 1);
    }
  }
  return out;
}

function emit(level, payload) {
  const record = {
    ts: new Date().toISOString(),
    level,
    ...payload,
  };
  const safe = sanitize(record);
  // Prefijo estable para que sea fácil filtrar en logs (`grep '[B2P]'`).
  // Usamos console[level] para mantener semántica de severidad.
  const fn = level === 'error' ? console.error
           : level === 'warn'  ? console.warn
           : console.log;
  try {
    fn('[B2P]', JSON.stringify(safe));
  } catch {
    // si serialización falla, log básico
    fn('[B2P]', level, safe?.screen, safe?.action, safe?.technical);
  }
}

export function logError({ screen, action, userId, eventId, technical, userMessage, extra }) {
  emit('error', {
    screen, action, userId, eventId,
    technical: typeof technical === 'object' ? technical?.message ?? String(technical) : technical,
    code: technical?.code,
    status: technical?.status,
    userMessage,
    extra,
  });
  // Enviar a Supabase: siempre al 100% para errores
  try {
    getRemoteLog()({
      screen,
      action,
      level: 'error',
      eventId: eventId ?? null,
      data: { userId, code: technical?.code, status: technical?.status, userMessage, extra },
      error: technical instanceof Error ? technical : null,
    });
  } catch (_) {}
}

export function logWarn({ screen, action, userId, eventId, technical, extra }) {
  emit('warn', {
    screen, action, userId, eventId,
    technical: typeof technical === 'object' ? technical?.message ?? String(technical) : technical,
    code: technical?.code,
    extra,
  });
  // Enviar a Supabase: siempre al 100% para warnings (incluye fetchEvent timeout)
  try {
    getRemoteLog()({
      screen,
      action,
      level: 'warn',
      eventId: eventId ?? null,
      data: { userId, code: technical?.code, extra },
      error: technical instanceof Error ? technical : null,
    });
  } catch (_) {}
}

export function logInfo({ screen, action, userId, eventId, extra }) {
  emit('info', { screen, action, userId, eventId, extra });
  // Enviar a Supabase solo si es pantalla EventDetail (100%) — resto aplica sample rate en remoteLogger
  try {
    getRemoteLog()({
      screen,
      action,
      level: 'info',
      eventId: eventId ?? null,
      data: { userId, extra },
    });
  } catch (_) {}
}

export default { logError, logWarn, logInfo };
