// EL CINTURON DEL BARRIO — registro de cinturones (mock) + logica pura, 100% offline.
//
// Modelo resuelto (multi-deporte):
//  - Clave compuesta (canchaId, deporte, rol). "Un cinturon por cancha" = anclaje geografico;
//    misma cancha + distinto deporte = cinturon distinto.
//  - El Crack es UNIVERSAL (se monta sobre el MVP que ya existe por evento -> sirve a cualquier deporte).
//    Muro/Killer/10 son gramatica de futbol y solo se instancian donde el deporte trae config.
//  - Anti-campeo: 2 semanas (14d) sin defender -> vacante / en disputa.
//  - Bolsa de creditos DIFERIDA: pozoCreditos siempre 0 aca (cosmetico).
//
// Nada de esto toca Supabase, wallet ni el Home. Funciones puras + data sembrada con offsets a Date.now().

import { COLORS } from '../../constants/theme';

// Oro DEDICADO del cinturon: fijo, independiente del tema, para que NUNCA se confunda con el
// neon/lima del shell (en el tema base gold === neon === #D6FF2F).
export const BELT_GOLD = '#FFD700';
export const BELT_GOLD_LIGHT = '#FFE766';
export const BELT_DISPUTE = '#FF7A18'; // naranja: cinturon en disputa
export const BELT_VACANT = COLORS.line; // gris: vacante

export const DEFENSE_WINDOW_DAYS = 14;
const DAY_MS = 86400000;

export const BELT_ROLES = {
  crack:  { label: 'El Crack',  short: 'CRACK',  universal: true,  driver: 'mvp' },
  muro:   { label: 'El Muro',   short: 'MURO',   universal: false, driver: 'gk_clean_sheets' },
  killer: { label: 'El Killer', short: 'KILLER', universal: false, driver: 'top_scorer' },
  diez:   { label: 'El 10',     short: 'EL 10',  universal: false, driver: 'assists_or_vote' },
};

// Solo la familia futbol trae role-belts. El resto de deportes = solo El Crack (universal).
// Las keys se normalizan (sin acentos, minuscula) para tolerar variantes de event.deporte.
const SPORT_ROLE_CONFIG = {
  'futbol':      ['muro', 'killer', 'diez'],
  'futbol 7':    ['muro', 'killer', 'diez'],
  'futbol sala': ['muro', 'killer', 'diez'],
};

// Normaliza el texto libre de event.deporte (acentos, mayusculas, espacios) para el match exacto.
// NOTA backend: event.deporte es texto libre; aplicar este mismo normalizador antes de resolver roles.
export function normalizeDeporte(deporte) {
  return (deporte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (combining marks)
    .toLowerCase().trim();
}

export function rolesForSport(deporte) {
  const key = normalizeDeporte(deporte);
  return ['crack', ...(SPORT_ROLE_CONFIG[key] ?? [])];
}

// Estado del cinturon derivado del reloj anti-campeo (puro, sin timers).
export function deriveBeltStatus(belt, simNow) {
  const now = simNow ?? Date.now();
  // Guarda: belt ausente o sin holder => vacante (no se asume reloj).
  if (!belt || !belt.holder) return { status: 'vacante', daysLeft: 0 };
  // Guarda anti-NaN: si lastDefendedAt es null/corrupto/no parseable, el campeon no tiene
  // reloj valido -> se trata como vacante con daysLeft:0 (evita 'EN DISPUTA NaNd' en el badge).
  const t = new Date(belt.lastDefendedAt).getTime();
  if (!Number.isFinite(t)) return { status: 'vacante', daysLeft: 0 };
  const defendBy = t + DEFENSE_WINDOW_DAYS * DAY_MS;
  const daysLeft = Math.ceil((defendBy - now) / DAY_MS);
  const status = daysLeft > 3 ? 'held' : daysLeft > 0 ? 'en_disputa' : 'vacante';
  return { status, daysLeft: Math.max(0, daysLeft) };
}

// Transferencia del Crack al aterrizar un resultado. Puro. Incluido por completitud del modelo.
// MUST-FIX: guarda explicita si el evento no tuvo MVP (evento sin votacion) -> no-op, no corrompe.
export function applyMvpResult(belt, eventResult) {
  // Guarda simetrica a la del mvp: sin belt no hay nada que transferir (evita leer belt.holder de undefined).
  if (!belt) {
    return { belt, storyItem: null };
  }
  if (!eventResult?.mvp) {
    // Evento sin MVP (ej. votacion no abierta): no se transfiere ni se penaliza el reloj.
    return { belt, storyItem: null };
  }
  const mvp = eventResult.mvp;
  // La identidad SOLO es comparable si AMBOS lados traen userId real. Sin userId,
  // 'undefined === undefined' daria true y acreditaria una defensa a un impostor: exigir ids definidos.
  const holderId = belt.holder?.userId;
  const sameAsHolder = holderId != null && mvp?.userId != null && mvp.userId === holderId;
  const championPlayed =
    !belt.holder ||
    (holderId != null && (eventResult.roster ?? []).some((p) => p?.userId != null && p.userId === holderId));
  // Si el campeon no jugo (o no es identificable), no se le quita a un ausente.
  if (belt.holder && !championPlayed) return { belt, storyItem: null };

  if (!belt.holder) {
    return { belt: { ...belt, holder: mvp, reignSince: eventResult.at, lastDefendedAt: eventResult.at, defenses: 0 }, storyItem: { type: 'coronation' } };
  }
  if (sameAsHolder) {
    return { belt: { ...belt, lastDefendedAt: eventResult.at, defenses: (belt.defenses ?? 0) + 1 }, storyItem: { type: 'defense' } };
  }
  return { belt: { ...belt, holder: mvp, reignSince: eventResult.at, lastDefendedAt: eventResult.at, defenses: 0 }, storyItem: { type: 'change', prevHolder: belt.holder } };
}

// Offsets relativos para sembrar los 3 estados sin esperar reloj real.
function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

// Registro sembrado. Incluye: La Bombonera con los 4 roles de Futbol 7 (held / en_disputa / vacante)
// Y un Basketball Crack en la MISMA cancha (prueba "una cancha, 2 deportes" + fallback solo-crack).
export function getMockBelts() {
  return [
    {
      beltId: 'belt_bombonera_futbol7_crack',
      scope: { canchaId: 'cancha_bombonera', canchaNombre: 'La Bombonera', deporte: 'Fútbol 7', primaryDeporte: 'Fútbol 7' },
      role: 'crack', roleLabel: 'El Crack', universal: true,
      holder: { userId: 'u3', username: 'emyc17', initial: 'E', tone: COLORS.orange },
      reignSince: daysAgo(9), lastDefendedAt: daysAgo(3), defenses: 2,
      lastEvent: { nombre: 'Birrea Domingo AM', fecha: '19 jun' },
      lastFight: { type: 'change', prevHolder: { username: 'kevin_o9', initial: 'K', tone: COLORS.blue }, mvpVotes: 14 },
    },
    {
      beltId: 'belt_bombonera_futbol7_killer',
      scope: { canchaId: 'cancha_bombonera', canchaNombre: 'La Bombonera', deporte: 'Fútbol 7', primaryDeporte: 'Fútbol 7' },
      role: 'killer', roleLabel: 'El Killer', universal: false,
      holder: { userId: 'u9', username: 'saul_rk', initial: 'S', tone: COLORS.red },
      reignSince: daysAgo(12), lastDefendedAt: daysAgo(12), defenses: 1,
      lastEvent: { nombre: 'Birrea Jueves', fecha: '12 jun' },
      lastFight: { type: 'change', prevHolder: { username: 'diego_a', initial: 'D', tone: COLORS.purple }, mvpVotes: 9 },
    },
    {
      beltId: 'belt_bombonera_futbol7_muro',
      scope: { canchaId: 'cancha_bombonera', canchaNombre: 'La Bombonera', deporte: 'Fútbol 7', primaryDeporte: 'Fútbol 7' },
      role: 'muro', roleLabel: 'El Muro', universal: false,
      holder: null, // VACANTE
      reignSince: null, lastDefendedAt: daysAgo(20), defenses: 0,
      lastEvent: { nombre: 'Birrea Martes', fecha: '6 jun' },
      lastFight: { type: 'vacancy', prevHolder: null, mvpVotes: 0 },
    },
    {
      beltId: 'belt_bombonera_futbol7_diez',
      scope: { canchaId: 'cancha_bombonera', canchaNombre: 'La Bombonera', deporte: 'Fútbol 7', primaryDeporte: 'Fútbol 7' },
      role: 'diez', roleLabel: 'El 10', universal: false,
      holder: { userId: 'u1', username: 'maicol_10', initial: 'M', tone: COLORS.green },
      reignSince: daysAgo(40), lastDefendedAt: daysAgo(5), defenses: 4,
      lastEvent: { nombre: 'Birrea Domingo AM', fecha: '19 jun' },
      lastFight: { type: 'defense', prevHolder: null, mvpVotes: 11 },
    },
    {
      // MISMA cancha, OTRO deporte: prueba "una cancha 2 deportes" + fallback solo-crack.
      beltId: 'belt_bombonera_basket_crack',
      scope: { canchaId: 'cancha_bombonera', canchaNombre: 'La Bombonera', deporte: 'Basketball', primaryDeporte: 'Fútbol 7' },
      role: 'crack', roleLabel: 'El Crack', universal: true,
      holder: { userId: 'u7', username: 'tito_bb', initial: 'T', tone: COLORS.blue },
      reignSince: daysAgo(4), lastDefendedAt: daysAgo(4), defenses: 1,
      lastEvent: { nombre: 'Basket Viernes', fecha: '20 jun' },
      lastFight: { type: 'coronation', prevHolder: null, mvpVotes: 8 },
    },
  ];
}
