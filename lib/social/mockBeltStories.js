// Historias deporte-aware para el preview de El Cinturon del Barrio.
//
// Reusa EXACTO el shape del shell de historias (getMockStories) y solo AGREGA campos opt-in:
//  - a los circulos campeones: belt:{...} + isChampion:true (la PRESENCIA de belt dispara el overlay
//    de aro dorado + corona; la ausencia => circulo normal byte-identico al shell).
//  - items con kind:'belt_card' + fight:{...} (el afiche de cambio de mando auto-generado).
//
// Garantiza identidad para el cinturon VACANTE y que SIEMPRE lleve un afiche (el visor nunca queda vacio).
// 100% offline; no toca Supabase, wallet ni el Home.

import { COLORS } from '../../constants/theme';
import { getMockStories } from './mockStories';
import { getMockBelts, deriveBeltStatus, BELT_ROLES, BELT_GOLD } from './mockBelts';

function buildFight(belt, status) {
  const role = BELT_ROLES[belt.role] ?? { short: 'CRACK' };
  const base = {
    beltRoleLabel: belt.roleLabel,
    roleShort: role.short,
    canchaNombre: belt.scope.canchaNombre,
    deporte: belt.scope.deporte,
    universal: belt.universal,
    eventNombre: belt.lastEvent?.nombre ?? '',
    fecha: belt.lastEvent?.fecha ?? '',
    mvpVotes: belt.lastFight?.mvpVotes ?? 0,
    rosterValidated: true,
    pozoCreditos: 0, // bolsa DIFERIDA
    defenses: belt.defenses ?? 0,
    cta: { retar: true, compartir: true },
  };
  if (!belt.holder || status === 'vacante') {
    return { ...base, type: 'vacancy', newHolder: null, prevHolder: null };
  }
  const lf = belt.lastFight ?? {};
  return {
    ...base,
    type: lf.type ?? 'change',
    newHolder: { username: belt.holder.username, initial: belt.holder.initial, tone: belt.holder.tone },
    prevHolder: lf.prevHolder ?? null,
  };
}

function buildChampionCircle(belt, simNow) {
  const { status, daysLeft } = deriveBeltStatus(belt, simNow);
  const role = BELT_ROLES[belt.role] ?? { short: 'CRACK' };
  const beltMeta = {
    role: belt.role, roleLabel: belt.roleLabel, short: role.short,
    canchaNombre: belt.scope.canchaNombre, deporte: belt.scope.deporte,
    primaryDeporte: belt.scope.primaryDeporte, defenses: belt.defenses ?? 0,
    daysLeft, status,
  };
  const beltCard = { kind: 'belt_card', tone: BELT_GOLD, timeAgo: 'hace 1 h', expiresIn: '23 h', caption: '', fight: buildFight(belt, status) };

  // VACANTE: identidad propia + afiche garantizado (el visor nunca queda vacio).
  if (!belt.holder || status === 'vacante') {
    return {
      id: `champ_${belt.beltId}`,
      username: belt.roleLabel,
      initial: '?', tone: COLORS.card2,
      seen: false, isChampion: true,
      belt: { ...beltMeta, status: 'vacante' },
      items: [beltCard],
    };
  }

  // Campeon con foto opcional + afiche al final (terminal: no auto-avanza, se cierra con X).
  const photo = {
    kind: 'photo', tone: belt.holder.tone, timeAgo: 'hace 1 h', expiresIn: '23 h',
    caption: status === 'en_disputa' ? 'Cuidado que vienen por el fajon' : 'El fajon se queda en el barrio',
  };
  return {
    id: `champ_${belt.beltId}`,
    username: belt.holder.username,
    initial: belt.holder.initial, tone: belt.holder.tone,
    seen: false, isChampion: true,
    belt: beltMeta,
    items: [photo, beltCard],
  };
}

// Orden por escasez/relevancia: El Crack del deporte primario primero, luego cracks, luego role-belts,
// vacantes al final; dentro de cada tier, mas defensas primero.
function rankChampion(c) {
  const b = c.belt;
  let tier;
  if (b.status === 'vacante') tier = 3;
  else if (b.role === 'crack' && b.deporte === b.primaryDeporte) tier = 0;
  else if (b.role === 'crack') tier = 1;
  else tier = 2;
  return tier * 100 - (b.defenses ?? 0);
}

export function getMockBeltStories(simNow) {
  const base = getMockStories();
  const champions = getMockBelts()
    .map((b) => buildChampionCircle(b, simNow))
    .sort((a, b) => rankChampion(a) - rankChampion(b));

  // 'Tu historia' queda en index 0; campeones pineados primero; historias normales detras.
  return [base[0], ...champions, ...base.slice(1)];
}
