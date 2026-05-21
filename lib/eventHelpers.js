import { supabase } from './supabase';

// ─── Refund eligibility (48-hour rule) ─────────────────────────────────────
export function getRefundStatus(eventFecha, eventHora) {
  const now      = new Date();
  const eventDate = new Date(`${eventFecha}T${eventHora ?? '00:00:00'}`);
  const diffMs   = eventDate - now;
  const hours    = diffMs / (1000 * 60 * 60);
  return {
    canRefund:      hours >= 48,
    hoursLeft:      Math.max(0, hours),
    refundDeadline: new Date(eventDate.getTime() - 48 * 60 * 60 * 1000),
  };
}

// ─── Modo "2 Vidas" ────────────────────────────────────────────────────────
// Genera fixture round-robin entre todos los equipos. Cada partido es eliminatorio
// en sentido de que el perdedor pierde 1 vida (manejado en el update del match).
// Al final del round-robin, los 2 equipos con MÁS vidas restantes juegan la FINAL.
export function generate2VidasFixture(teams) {
  const base = generateRoundRobin(teams);
  let jornada = 1;
  const matches = base.map((f) => ({
    home:    f.home,
    away:    f.away,
    jornada: jornada++,
    fase:    'grupos',    // se reusa 'grupos' para la ronda regular
  }));
  return matches;
}

// Procesa el resultado de un partido en modo "2 Vidas": resta vida al perdedor.
// Si empate: el perdedor es quien pierde la tanda de penales (penales obligatorios).
// Retorna { loserTeamId, loserVidasNew } o null si no se pudo determinar.
export async function applyVidaLossFor2Vidas({ supabase, match }) {
  const gh = match.goles_home ?? 0;
  const ga = match.goles_away ?? 0;
  let loser = null;

  if (gh > ga)        loser = match.team_away_id;
  else if (ga > gh)   loser = match.team_home_id;
  else if (match.fue_a_penales) {
    // empate en tiempo regular, decidió penales
    const ph = match.goles_pen_home ?? 0;
    const pa = match.goles_pen_away ?? 0;
    if (ph > pa)      loser = match.team_away_id;
    else if (pa > ph) loser = match.team_home_id;
  }
  if (!loser) return null;

  const { data: team } = await supabase
    .from('teams')
    .select('id, vidas_actuales')
    .eq('id', loser)
    .single();
  if (!team) return null;

  const newVidas = Math.max(0, (team.vidas_actuales ?? 0) - 1);
  await supabase.from('teams').update({ vidas_actuales: newVidas }).eq('id', loser);
  return { loserTeamId: loser, loserVidasNew: newVidas };
}

// Round-robin base (una vuelta) ────────────────────────────────────────────
export function generateRoundRobin(teams) {
  const list = [...teams];
  if (list.length % 2 !== 0) list.push({ id: 'bye', nombre: 'Bye' });

  const rounds   = list.length - 1;
  const half     = list.length / 2;
  const fixtures = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = list[i];
      const away = list[list.length - 1 - i];
      if (home.id !== 'bye' && away.id !== 'bye') {
        fixtures.push({ home, away, round: r + 1 });
      }
    }
    const last = list.pop();
    list.splice(1, 0, last);
  }
  return fixtures;
}

// ─── Liga: N jornadas (repetición del round-robin) ──────────────────────────
// jornadas = número de veces que se enfrentan todos los equipos
// idaYVuelta = en la 2ª vuelta se invierten home/away
export function generateLigaFixture(teams, jornadas = 1, idaYVuelta = false) {
  const base   = generateRoundRobin(teams);        // 1 vuelta completa
  const all    = [];
  let matchNum = 0;

  for (let j = 0; j < jornadas; j++) {
    const isReturn = idaYVuelta && j % 2 === 1;    // vuelta de vuelta
    base.forEach((f) => {
      matchNum++;
      all.push({
        home:    isReturn ? f.away : f.home,
        away:    isReturn ? f.home : f.away,
        jornada: matchNum,
        round:   j + 1,                             // jornada-grupo (vuelta)
        fase:    'grupos',
      });
    });
  }
  return all;
}

// ─── Torneo: fase de grupos ─────────────────────────────────────────────────
// groups: { 'A': [team, team, team], 'B': [team, team, team] }
// Retorna array de match objects con campo 'grupo'
export function generateGroupStageFixture(groups) {
  const all = [];

  // Cada grupo tiene su propio contador de jornada (son paralelas entre grupos)
  Object.entries(groups).forEach(([grupo, teams]) => {
    let jornada = 1;                    // ← resetear por grupo, no global
    const base = generateRoundRobin(teams);
    base.forEach((f) => {
      all.push({ ...f, jornada: jornada++, fase: 'grupos', grupo });
    });
  });
  return all;
}

// ─── Torneo: llaves de eliminación directa ──────────────────────────────────
// opts: { numGroups, teamsPerGroup, tieneOctavos, tieneCuartos, tieneSemis,
//         tieneTercerLugar, tieneFinal, idaYVuelta }
// Retorna placeholders de partidos sin equipos asignados aún
export function generateKnockoutBracket(opts) {
  const {
    numGroups       = 2,
    teamsPerGroup   = 3,
    tieneOctavos    = false,
    tieneCuartos    = false,
    tieneSemis      = true,
    tieneTercerLugar= true,
    tieneFinal      = true,
    idaYVuelta      = false,
  } = opts;

  const matches = [];
  const legs    = idaYVuelta ? 2 : 1;

  const addPlaceholder = (fase, matchIndex) => {
    for (let leg = 0; leg < legs; leg++) {
      matches.push({
        fase,
        jornada:         matchIndex + (leg > 0 ? 100 : 0),  // separa ida/vuelta
        equipo_local:    `Clasificado ${fase} ${matchIndex}A`,
        equipo_visitante:`Clasificado ${fase} ${matchIndex}B`,
        home:            null,
        away:            null,
        status:          'pending',
        jugado:          false,
      });
    }
  };

  // Octavos: 8 partidos
  if (tieneOctavos) {
    for (let i = 1; i <= 8; i++) addPlaceholder('octavos', i);
  }
  // Cuartos: 4 partidos
  if (tieneCuartos) {
    for (let i = 1; i <= 4; i++) addPlaceholder('cuartos', i);
  }
  // Semis: 2 partidos
  if (tieneSemis) {
    addPlaceholder('semis', 1);
    addPlaceholder('semis', 2);
  }
  // 3er lugar
  if (tieneTercerLugar) addPlaceholder('tercer_lugar', 1);
  // Final
  if (tieneFinal) addPlaceholder('final', 1);

  return matches;
}

// ═══════════════════════════════════════════════════════════════════════════
// AVANCES DE FASE: standings, ganadores, populate de knockout, ganador final
// ═══════════════════════════════════════════════════════════════════════════

// Computa el ganador de un match (considerando penales). Retorna team_id o null.
export function getMatchWinner(match) {
  if (!match || match.status !== 'finished') return null;
  const gh = match.goles_home ?? 0;
  const ga = match.goles_away ?? 0;
  if (gh > ga) return match.team_home_id;
  if (ga > gh) return match.team_away_id;
  if (match.fue_a_penales) {
    const ph = match.goles_pen_home ?? 0;
    const pa = match.goles_pen_away ?? 0;
    if (ph > pa) return match.team_home_id;
    if (pa > ph) return match.team_away_id;
  }
  return null;
}

// Calcula la tabla de posiciones a partir de los matches de fase 'grupos'.
// Retorna [{ team_id, equipo, grupo, pj, pg, pe, pp, gf, gc, dg, pts }] ordenado
// por grupo y luego pts > dg > gf.
export function computeStandingsFromMatches(matches, teams) {
  const t = {};
  (teams ?? []).forEach((team) => {
    t[team.id] = {
      team_id: team.id, equipo: team.nombre, grupo: team.grupo ?? 'A',
      color: team.color, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dg: 0, pts: 0,
    };
  });
  (matches ?? [])
    .filter((m) => m.status === 'finished' && (m.fase ?? 'grupos') === 'grupos')
    .forEach((m) => {
      const gh = m.goles_home ?? 0;
      const ga = m.goles_away ?? 0;
      const h = t[m.team_home_id];
      const a = t[m.team_away_id];
      if (h) {
        h.pj++; h.gf += gh; h.gc += ga;
        if (gh > ga) { h.pg++; h.pts += 3; }
        else if (gh === ga) { h.pe++; h.pts += 1; }
        else h.pp++;
      }
      if (a) {
        a.pj++; a.gf += ga; a.gc += gh;
        if (ga > gh) { a.pg++; a.pts += 3; }
        else if (gh === ga) { a.pe++; a.pts += 1; }
        else a.pp++;
      }
    });
  return Object.values(t).map((s) => ({ ...s, dg: s.gf - s.gc }))
    .sort((a, b) => (
      (a.grupo ?? '').localeCompare(b.grupo ?? '')
      || b.pts - a.pts
      || b.dg - a.dg
      || b.gf - a.gf
    ));
}

// Verifica si la fase de grupos terminó (todos los matches con fase='grupos' finished).
export function isGroupStageComplete(matches) {
  const groupMatches = (matches ?? []).filter((m) => (m.fase ?? 'grupos') === 'grupos');
  if (groupMatches.length === 0) return false;
  return groupMatches.every((m) => m.status === 'finished');
}

// Detecta empates 100% iguales (mismo pts, dg, gf) entre 2+ equipos del mismo grupo
// que compiten por la última plaza de avance. Si hay, retorna los grupos+equipos
// para que el admin elija manualmente. avanzanPorGrupo = cuántos avanzan por grupo.
export function detectGroupTiesNeedingDecision(standings, avanzanPorGrupo = 2) {
  const byGroup = standings.reduce((acc, s) => { (acc[s.grupo] ??= []).push(s); return acc; }, {});
  const conflicts = [];
  Object.entries(byGroup).forEach(([grupo, list]) => {
    // El equipo en la posición N (cutoff) puede empatar con el N+1
    const cutoff = list[avanzanPorGrupo - 1];
    if (!cutoff) return;
    const tied = list.filter((s) =>
      s !== cutoff
      && s.pts === cutoff.pts
      && s.dg  === cutoff.dg
      && s.gf  === cutoff.gf
    );
    if (tied.length > 0) {
      // Incluye al cutoff y a todos los empatados con él
      conflicts.push({ grupo, tied: [cutoff, ...tied] });
    }
  });
  return conflicts;
}

// Devuelve los equipos clasificados a knockout: top N por grupo.
// `overrides` permite forzar el orden manual: { [grupo]: [team_id, team_id, ...] }
export function getQualifiedTeams(standings, avanzanPorGrupo = 2, overrides = {}) {
  const byGroup = standings.reduce((acc, s) => { (acc[s.grupo] ??= []).push(s); return acc; }, {});
  const result = {};
  Object.entries(byGroup).forEach(([grupo, list]) => {
    if (overrides[grupo]) {
      // Respetar orden manual del admin
      result[grupo] = overrides[grupo]
        .map((tid) => list.find((s) => s.team_id === tid))
        .filter(Boolean)
        .slice(0, avanzanPorGrupo);
    } else {
      result[grupo] = list.slice(0, avanzanPorGrupo);
    }
  });
  return result;
}

// Popula los matches placeholder de la siguiente fase con los ganadores reales.
// Estrategia de seeding clásico cruzado: 1ºA vs 2ºB, 1ºB vs 2ºA, etc.
// Solo soporta hasta semis+final por ahora (suficiente para 2-4 grupos).
export async function populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup }) {
  // Flatten ordenado para seeding cruzado
  const groups = Object.keys(qualifiedByGroup).sort();
  const seeded = [];
  // [1ºA, 1ºB, 2ºA, 2ºB] → cross-matchups
  const maxPerGroup = Math.max(...groups.map((g) => qualifiedByGroup[g].length));
  for (let pos = 0; pos < maxPerGroup; pos++) {
    for (const g of groups) {
      if (qualifiedByGroup[g][pos]) seeded.push({ pos, grupo: g, ...qualifiedByGroup[g][pos] });
    }
  }
  // seeded = [1ºA, 1ºB, 2ºA, 2ºB] (para 2 grupos × 2 avanzan)
  // Cross-matchups: 1ºA vs 2ºB, 1ºB vs 2ºA
  const numQualifiers = seeded.length;
  const matchups = [];
  if (numQualifiers === 4) {
    // Semis: 1A v 2B, 1B v 2A
    matchups.push({ home: seeded[0], away: seeded[3] });
    matchups.push({ home: seeded[1], away: seeded[2] });
  } else if (numQualifiers === 8) {
    // Cuartos
    matchups.push({ home: seeded[0], away: seeded[7] });
    matchups.push({ home: seeded[1], away: seeded[6] });
    matchups.push({ home: seeded[2], away: seeded[5] });
    matchups.push({ home: seeded[3], away: seeded[4] });
  } else if (numQualifiers === 16) {
    // Octavos
    for (let i = 0; i < 8; i++) {
      matchups.push({ home: seeded[i], away: seeded[15 - i] });
    }
  } else {
    return { error: `Configuración no soportada: ${numQualifiers} clasificados` };
  }

  // Determinar la fase de entrada según cantidad
  const entryPhase = numQualifiers === 16 ? 'octavos' : numQualifiers === 8 ? 'cuartos' : 'semis';

  // Obtener los placeholders existentes de esa fase (ordenados por jornada)
  const { data: placeholders } = await supabase
    .from('matches')
    .select('*')
    .eq('event_id', eventId)
    .eq('fase', entryPhase)
    .order('jornada', { ascending: true });

  if (!placeholders || placeholders.length < matchups.length) {
    return { error: `No hay placeholders suficientes en fase ${entryPhase} (${placeholders?.length ?? 0}/${matchups.length})` };
  }

  // Actualizar cada placeholder con team_home_id / team_away_id
  await Promise.all(matchups.map((mu, i) => {
    const ph = placeholders[i];
    return supabase.from('matches').update({
      team_home_id: mu.home.team_id,
      team_away_id: mu.away.team_id,
    }).eq('id', ph.id);
  }));

  return { ok: true, phase: entryPhase, count: matchups.length };
}

// Para una fase knockout terminada: popular la siguiente fase con los ganadores.
// Order de fases: octavos → cuartos → semis → final (3er lugar es paralelo a semis).
const KO_PHASE_ORDER = ['octavos', 'cuartos', 'semis', 'final'];
export async function populateNextKnockoutPhase({ supabase, eventId, matches }) {
  for (let i = 0; i < KO_PHASE_ORDER.length - 1; i++) {
    const cur  = KO_PHASE_ORDER[i];
    const next = KO_PHASE_ORDER[i + 1];
    const curMatches = matches.filter((m) => m.fase === cur).sort((a,b) => a.jornada - b.jornada);
    if (curMatches.length === 0) continue;
    if (!curMatches.every((m) => m.status === 'finished' && getMatchWinner(m))) continue;

    // Buscar placeholders de next phase sin equipos
    const nextPlaceholders = matches
      .filter((m) => m.fase === next && !m.team_home_id && !m.team_away_id)
      .sort((a,b) => a.jornada - b.jornada);

    if (nextPlaceholders.length === 0) continue;

    // Pairing clásico: ganador 1 vs ganador 2, ganador 3 vs ganador 4...
    const winners = curMatches.map(getMatchWinner);
    for (let j = 0; j < Math.floor(winners.length / 2); j++) {
      const ph = nextPlaceholders[j];
      if (!ph) break;
      const homeId = winners[j * 2];
      const awayId = winners[j * 2 + 1];
      if (!homeId || !awayId) continue;
      await supabase.from('matches').update({
        team_home_id: homeId, team_away_id: awayId,
      }).eq('id', ph.id);
    }

    // Si la fase actual es semis y existe placeholder de tercer_lugar,
    // poblarlo con los PERDEDORES de las semis. Antes nunca se llenaba.
    if (cur === 'semis') {
      const tercerPlaceholder = matches
        .find((m) => m.fase === 'tercer_lugar' && !m.team_home_id && !m.team_away_id);
      if (tercerPlaceholder) {
        const losers = curMatches.map((m) => {
          const winner = getMatchWinner(m);
          if (!winner) return null;
          return winner === m.team_home_id ? m.team_away_id : m.team_home_id;
        }).filter(Boolean);
        if (losers.length >= 2) {
          await supabase.from('matches').update({
            team_home_id: losers[0],
            team_away_id: losers[1],
          }).eq('id', tercerPlaceholder.id);
        }
      }
    }

    // Solo procesar UNA fase por llamada (la primera con todos finished)
    return { ok: true, populated: next };
  }
  return { ok: false };
}

// Modo "2 Vidas": al terminar TODOS los matches del round-robin,
// crear (si no existe) un match de FINAL entre los 2 equipos con más vidas.
export async function ensure2VidasFinalIfReady({ supabase, eventId, matches, teams }) {
  const rrMatches = matches.filter((m) => (m.fase ?? 'grupos') === 'grupos');
  if (rrMatches.length === 0) return null;
  if (!rrMatches.every((m) => m.status === 'finished')) return null;
  // ¿Ya existe match de final?
  if (matches.some((m) => m.fase === 'final')) return null;

  const sorted = [...(teams ?? [])].sort((a, b) => (b.vidas_actuales ?? 0) - (a.vidas_actuales ?? 0));
  const top2 = sorted.slice(0, 2);
  if (top2.length < 2) return null;

  const { data, error } = await supabase.from('matches').insert({
    event_id:     eventId,
    jornada:      999,
    team_home_id: top2[0].id,
    team_away_id: top2[1].id,
    fase:         'final',
    status:       'pending',
  }).select().single();
  if (error) return { error: error.message };
  return { final: data, finalists: top2 };
}

// Devuelve el ganador final del evento (o null si no hay).
export function getTournamentWinner(matches, teams) {
  const finalMatch = matches.find((m) => m.fase === 'final' && m.status === 'finished');
  if (!finalMatch) return null;
  const winnerId = getMatchWinner(finalMatch);
  if (!winnerId) return null;
  return (teams ?? []).find((t) => t.id === winnerId) ?? null;
}

// ─── Calcular número de equipos a partir de cupos y jugadores ──────────────
export function calcTeams(cuposTotal, jugadoresPorEquipo) {
  if (!jugadoresPorEquipo || !cuposTotal) return null;
  const numEquipos   = Math.floor(cuposTotal / jugadoresPorEquipo);
  const sobrantes    = cuposTotal % jugadoresPorEquipo;
  const esExacto     = sobrantes === 0;
  const sugerido     = esExacto ? cuposTotal : numEquipos * jugadoresPorEquipo;
  return { numEquipos, sobrantes, esExacto, sugerido };
}

// ─── Auto-cierre de MVP de evento si expiró el timer (lazy evaluation) ────────
// BUG FIX: function was using match_id queries but the MVP system is now per-event.
// Updated to accept an event object (with id and mvp_closes_at) instead of a match.
export async function closeMvpIfExpired(event) {
  if (!event?.mvp_closes_at) return null;
  if (new Date(event.mvp_closes_at) > new Date()) return null;  // aún no expira
  if (!event.mvp_voting_open) return null;  // votación ya cerrada manualmente

  // Verificar si ya hay un resultado para este evento
  const { data: existing } = await supabase
    .from('mvp_results')
    .select('id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (existing) return null;  // ya cerrado

  // Contar votos del evento
  const { data: votes } = await supabase
    .from('mvp_votes')
    .select('voted_for_id')
    .eq('event_id', event.id);

  if (!votes?.length) return null;  // sin votos — no declarar

  const tally  = votes.reduce((acc, v) => {
    acc[v.voted_for_id] = (acc[v.voted_for_id] ?? 0) + 1;
    return acc;
  }, {});
  const sorted   = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const maxVotos = sorted[0][1];
  const empatados = sorted.filter(([, v]) => v === maxVotos);

  // Empate → elegir aleatoriamente
  const [winnerId, winnerVotes] = empatados[Math.floor(Math.random() * empatados.length)];

  // UNIQUE constraint en event_id previene double-award en race condition
  const { error } = await supabase.from('mvp_results').insert({
    event_id:      event.id,
    user_id:       winnerId,
    votos_totales: winnerVotes,
    premio_wallet: 1.00,
    premio_pagado: true,
  });
  // 23505 = unique_violation → otra instancia ya lo insertó; no es error real
  if (error) {
    if (error.code !== '23505') console.warn('closeMvpIfExpired:', error.message);
    return null;
  }

  // Cerrar flag de votación en el evento
  try { await supabase.from('events').update({ mvp_voting_open: false }).eq('id', event.id); } catch {}

  // Wallet update atómico via RPC — previene lost-update race condition
  try {
    await supabase.rpc('credit_wallet', {
      p_user_id:     winnerId,
      p_monto:       1.00,
      p_tipo:        'mvp_premio',
      p_descripcion: 'Premio MVP (automático por tiempo)',
    });
  } catch (e) {
    console.warn('credit_wallet auto-close error:', e.message);
    // mvp_result ya guardado — no revertir
  }

  // Auto-noticia
  await supabase.from('news').insert({
    titulo:   '🏆 MVP Declarado automáticamente',
    contenido:`El MVP del evento fue seleccionado automáticamente al cerrarse la votación con ${winnerVotes} voto(s).`,
    tipo:     'mvp',
  }).catch(() => {});

  return winnerId;
}

// ─── Score formatter ────────────────────────────────────────────────────────
export function formatScore(golesLocal, golesVisitante) {
  if (golesLocal == null || golesVisitante == null) return '- : -';
  return `${golesLocal} : ${golesVisitante}`;
}

// ─── Event status metadata ──────────────────────────────────────────────────
export function getEventStatusInfo(status) {
  const map = {
    draft:     { label: 'Borrador',   color: '#7A8BA0', emoji: '📋' },
    open:      { label: 'Abierto',    color: '#1DB954', emoji: '🟢' },
    active:    { label: 'En curso',   color: '#C0186A', emoji: '🔴' },
    finished:  { label: 'Finalizado', color: '#7A8BA0', emoji: '✓'  },
    cancelled: { label: 'Cancelado',  color: '#C8102E', emoji: '✗'  },
  };
  return map[status] ?? map.draft;
}

// ─── Countdown en texto ─────────────────────────────────────────────────────
export function formatCountdown(closesAt) {
  if (!closesAt) return null;
  const diff = new Date(closesAt) - new Date();
  if (diff <= 0) return 'Cerrado';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m restantes`;
  return `${m} min restantes`;
}

// ─── Paleta de colores para equipos ────────────────────────────────────────
export const TEAM_COLORS = [
  { nombre: 'Rojo',     color: '#E63946' },
  { nombre: 'Azul',     color: '#457B9D' },
  { nombre: 'Verde',    color: '#2DC653' },
  { nombre: 'Negro',    color: '#2B2D42' },
  { nombre: 'Blanco',   color: '#E8E8E8' },
  { nombre: 'Rosa',     color: '#FF6B9D' },
  { nombre: 'Amarillo', color: '#FFBE0B' },
  { nombre: 'Naranja',  color: '#FB5607' },
  { nombre: 'Morado',   color: '#7B2D8B' },
  { nombre: 'Celeste',  color: '#48CAE4' },
];
