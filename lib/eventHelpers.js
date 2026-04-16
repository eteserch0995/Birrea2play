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

// ─── Round-robin base (una vuelta) ─────────────────────────────────────────
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

// ─── Calcular número de equipos a partir de cupos y jugadores ──────────────
export function calcTeams(cuposTotal, jugadoresPorEquipo) {
  if (!jugadoresPorEquipo || !cuposTotal) return null;
  const numEquipos   = Math.floor(cuposTotal / jugadoresPorEquipo);
  const sobrantes    = cuposTotal % jugadoresPorEquipo;
  const esExacto     = sobrantes === 0;
  const sugerido     = esExacto ? cuposTotal : numEquipos * jugadoresPorEquipo;
  return { numEquipos, sobrantes, esExacto, sugerido };
}

// ─── Auto-cierre de MVP si expiró el timer (lazy evaluation) ───────────────
export async function closeMvpIfExpired(match) {
  if (!match?.mvp_closes_at) return null;
  if (new Date(match.mvp_closes_at) > new Date()) return null;  // aún no expira

  // Verificar si ya hay un resultado
  const { data: existing } = await supabase
    .from('mvp_results')
    .select('id')
    .eq('match_id', match.id)
    .maybeSingle();
  if (existing) return null;  // ya cerrado

  // Contar votos
  const { data: votes } = await supabase
    .from('mvp_votes')
    .select('voted_for_id')
    .eq('match_id', match.id);

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

  // WC fix C5: UNIQUE constraint en match_id previene double-award en race condition
  const { error } = await supabase.from('mvp_results').insert({
    match_id:      match.id,
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

  // WC fix C6: wallet update atómico via RPC — previene lost-update race condition
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
    contenido:`El MVP del partido fue seleccionado automáticamente al cerrarse la votación con ${winnerVotes} voto(s).`,
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
