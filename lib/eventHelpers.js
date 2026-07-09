import { supabase } from './supabase';
import { getStandingsRules } from './sportTerms';

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

// ─── Etiqueta de evento gratis (precio 0) ──────────────────────────────────
// "Entrada Free" para eventos NO deportivos (deporte 'Otro', p.ej. watch parties);
// "FREE" para eventos deportivos. Solo se usa cuando el precio es 0.
export function freeLabel(deporte) {
  return (deporte ?? '').trim().toLowerCase() === 'otro' ? 'Entrada Free' : 'FREE';
}

// ─── Fee de plataforma (F3 2026-07-05, decisión Sergio) ─────────────────────
// El fee ($0.50 default, events.app_fee_per_player) se ADICIONA a la tarifa
// del gestor: el jugador paga precio + fee. El gestor NO paga fee en su
// propio evento. Eventos gratis (precio 0) no llevan fee.
// El cobro real lo hace el server (inscribir_con_wallet debita precio+fee;
// yappy-boton exige el total) — estas funciones son la fuente de la UI.
export function appFeeDe(event, userId = null) {
  const precio = Number(event?.precio ?? 0);
  if (precio <= 0) return 0;
  if (userId != null && event?.created_by === userId) return 0;
  return Number(event?.app_fee_per_player ?? 0);
}

// Socio del Club ($5/mes): 10% de descuento sobre la tarifa (el fee no se descuenta).
// (Era 20%; ajustado al 10% el 2026-07-05 por decisión Sergio.)
// El server aplica lo mismo en precio_para() — esto es solo la UI.
export function precioBaseDe(event, esSocio = false) {
  const precio = Number(event?.precio ?? 0);
  if (precio <= 0) return 0;
  return esSocio ? Number((precio * 0.9).toFixed(2)) : precio;
}

// Fee INCLUIDO en el precio (2026-07-05, decisión Sergio — reemplaza el modelo
// "fee encima"): el jugador paga exactamente el precio del evento; el $0.50 se
// retiene de la ganancia del gestor (server-side). precioConFee queda como el
// precio a pagar (con descuento de socio si aplica) — el nombre se mantiene
// para no tocar los 12 call sites.
export function precioConFee(event, userId = null, esSocio = false) {
  return precioBaseDe(event, esSocio);
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
  const GROUP_LETTERS = ['A','B','C','D','E','F','G','H'];

  // Fase de ENTRADA (la que se puebla desde la fase de grupos) y nº de
  // clasificados que entran: octavos=16, cuartos=8, semis=4.
  const entryPhase      = tieneOctavos ? 'octavos' : tieneCuartos ? 'cuartos' : 'semis';
  const entryQualifiers = entryPhase === 'octavos' ? 16 : entryPhase === 'cuartos' ? 8 : 4;

  // Reproduce EXACTAMENTE el seeding de populateKnockoutFromGroups para que los
  // rótulos del bracket coincidan con el emparejamiento real:
  //   1 grupo  → seeded [1°A,2°A,3°A,4°A,…] → 1°vs último, 2°vs penúltimo (1v4, 2v3)
  //   N grupos → intercalado por posición [1°A,1°B,2°A,2°B,…] → cruzado (1°A vs 2°B)
  function entrySeedPairs() {
    const perGroup = Math.max(1, Math.ceil(entryQualifiers / numGroups));
    const groups   = GROUP_LETTERS.slice(0, Math.max(1, numGroups));
    const seeded   = [];
    for (let pos = 0; pos < perGroup && seeded.length < entryQualifiers; pos++) {
      for (const g of groups) {
        if (seeded.length < entryQualifiers) seeded.push({ pos, grupo: g });
      }
    }
    const n = seeded.length;
    const pairs = [];
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const a = seeded[i], b = seeded[n - 1 - i];
      pairs.push({
        homeSeed:  `${a.pos + 1}°${a.grupo}`,        awaySeed:  `${b.pos + 1}°${b.grupo}`,
        homeLabel: `${a.pos + 1}° Grupo ${a.grupo}`, awayLabel: `${b.pos + 1}° Grupo ${b.grupo}`,
      });
    }
    return pairs;
  }

  const PHASE_NAME = { octavos: 'Octavos', cuartos: 'Cuartos', semis: 'Semifinal' };
  const seedPairs  = entrySeedPairs();

  // matchIndex es 1-based. La fase de entrada usa seeds (1°A/4°A…); las fases
  // posteriores usan "Ganador <fase previa> N"; el 3er lugar, los perdedores de semis.
  const addPlaceholder = (fase, matchIndex, prevPhase) => {
    let homeLabel, awayLabel, homeSeed = null, awaySeed = null;
    if (fase === entryPhase) {
      const p   = seedPairs[matchIndex - 1];
      homeLabel = p?.homeLabel ?? `Clasificado ${matchIndex}A`;
      awayLabel = p?.awayLabel ?? `Clasificado ${matchIndex}B`;
      homeSeed  = p?.homeSeed ?? null;
      awaySeed  = p?.awaySeed ?? null;
    } else if (fase === 'tercer_lugar') {
      homeLabel = 'Perdedor Semifinal 1';
      awayLabel = 'Perdedor Semifinal 2';
    } else {
      const pn  = PHASE_NAME[prevPhase] ?? 'Ganador';
      homeLabel = `Ganador ${pn} ${matchIndex * 2 - 1}`;
      awayLabel = `Ganador ${pn} ${matchIndex * 2}`;
    }
    for (let leg = 0; leg < legs; leg++) {
      matches.push({
        fase,
        jornada:          matchIndex + (leg > 0 ? 100 : 0),  // separa ida/vuelta
        equipo_local:     homeLabel,
        equipo_visitante: awayLabel,
        seed_home:        homeSeed,
        seed_away:        awaySeed,
        home:             null,
        away:             null,
        status:           'pending',
        jugado:           false,
      });
    }
  };

  let prev = null;
  // Octavos: 8 partidos
  if (tieneOctavos) { for (let i = 1; i <= 8; i++) addPlaceholder('octavos', i, prev); prev = 'octavos'; }
  // Cuartos: 4 partidos
  if (tieneCuartos) { for (let i = 1; i <= 4; i++) addPlaceholder('cuartos', i, prev); prev = 'cuartos'; }
  // Semis: 2 partidos
  if (tieneSemis)   { addPlaceholder('semis', 1, prev); addPlaceholder('semis', 2, prev); prev = 'semis'; }
  // 3er lugar (perdedores de semis)
  if (tieneTercerLugar) addPlaceholder('tercer_lugar', 1, prev);
  // Final (ganadores de la fase previa)
  if (tieneFinal)   addPlaceholder('final', 1, prev);

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
export function computeStandingsFromMatches(matches, teams, deporte) {
  // Puntos por deporte: fútbol 3/1/0; volley/basket/raquetas V=2 D=1 (FIVB/FIBA).
  // Sin `deporte` se asume fútbol (compatibilidad con callers existentes).
  const rules = getStandingsRules(deporte ?? 'Fútbol');
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
        if (gh > ga) { h.pg++; h.pts += rules.win; }
        else if (gh === ga) { h.pe++; h.pts += rules.draw; }
        else { h.pp++; h.pts += rules.loss; }
      }
      if (a) {
        a.pj++; a.gf += ga; a.gc += gh;
        if (ga > gh) { a.pg++; a.pts += rules.win; }
        else if (gh === ga) { a.pe++; a.pts += rules.draw; }
        else { a.pp++; a.pts += rules.loss; }
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

// Construye el label del seed de un equipo en el bracket: "1°A", "2°B", etc.
// pos es 0-based (0 = primer lugar del grupo), grupo es 'A', 'B', ...
function seedLabel(s) {
  return `${(s.pos ?? 0) + 1}°${s.grupo ?? 'A'}`;
}

// Popula los matches placeholder de la siguiente fase con los ganadores reales.
// Estrategia de seeding clásico cruzado:
//   - Múltiples grupos: 1°A vs 2°B (cruzado entre grupos diferentes)
//   - Un solo grupo:    1°A vs 4°A (cruzado por posición: 1°vsN, 2°vs(N-1), ...)
// Soporta numQualifiers ∈ {4, 8, 16} → semis / cuartos / octavos.
//
// Adicional: escribe seed_home/seed_away ("1°A", "2°B") y actualiza equipo_local/
// equipo_visitante con "1°A · Panamá" para que cualquier UI tenga fallback legible.
export async function populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup }) {
  // Flatten ordenado para seeding cruzado entre grupos.
  // Para 1 grupo, el flatten queda en orden de posición: [1°A, 2°A, 3°A, 4°A].
  // Para 2 grupos, intercala por posición: [1°A, 1°B, 2°A, 2°B].
  const groups = Object.keys(qualifiedByGroup).sort();
  const seeded = [];
  const maxPerGroup = Math.max(...groups.map((g) => qualifiedByGroup[g].length));
  for (let pos = 0; pos < maxPerGroup; pos++) {
    for (const g of groups) {
      if (qualifiedByGroup[g][pos]) seeded.push({ pos, grupo: g, ...qualifiedByGroup[g][pos] });
    }
  }
  // Para 2 grupos × 2: seeded[0]=1°A, seeded[1]=1°B, seeded[2]=2°A, seeded[3]=2°B
  // Cross-matchups: seeded[0] vs seeded[3] (1°A vs 2°B), seeded[1] vs seeded[2] (1°B vs 2°A)
  // Para 1 grupo × 4:  seeded[0]=1°A, seeded[1]=2°A, seeded[2]=3°A, seeded[3]=4°A
  // Mismos índices: seeded[0] vs seeded[3] (1°A vs 4°A), seeded[1] vs seeded[2] (2°A vs 3°A)
  // → la misma regla cubre ambos casos sin condicional especial.
  const numQualifiers = seeded.length;
  const matchups = [];
  if (numQualifiers === 4) {
    matchups.push({ home: seeded[0], away: seeded[3] });
    matchups.push({ home: seeded[1], away: seeded[2] });
  } else if (numQualifiers === 8) {
    matchups.push({ home: seeded[0], away: seeded[7] });
    matchups.push({ home: seeded[1], away: seeded[6] });
    matchups.push({ home: seeded[2], away: seeded[5] });
    matchups.push({ home: seeded[3], away: seeded[4] });
  } else if (numQualifiers === 16) {
    for (let i = 0; i < 8; i++) {
      matchups.push({ home: seeded[i], away: seeded[15 - i] });
    }
  } else {
    return { error: `Configuración no soportada: ${numQualifiers} clasificados` };
  }

  // Fase de entrada según cantidad
  const entryPhase = numQualifiers === 16 ? 'octavos' : numQualifiers === 8 ? 'cuartos' : 'semis';

  const { data: placeholders } = await supabase
    .from('matches')
    .select('*')
    .eq('event_id', eventId)
    .eq('fase', entryPhase)
    .order('jornada', { ascending: true });

  if (!placeholders || placeholders.length < matchups.length) {
    return { error: `No hay placeholders suficientes en fase ${entryPhase} (${placeholders?.length ?? 0}/${matchups.length})` };
  }

  // Actualizar cada placeholder: team ids + seeds + texto humano del equipo
  await Promise.all(matchups.map((mu, i) => {
    const ph = placeholders[i];
    const sHome = seedLabel(mu.home);
    const sAway = seedLabel(mu.away);
    return supabase.from('matches').update({
      team_home_id:     mu.home.team_id,
      team_away_id:     mu.away.team_id,
      seed_home:        sHome,
      seed_away:        sAway,
      equipo_local:     `${sHome} · ${mu.home.equipo ?? ''}`.trim(),
      equipo_visitante: `${sAway} · ${mu.away.equipo ?? ''}`.trim(),
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
    // Adicional: propagamos el seed (1°A, 2°B, …) y el texto humano del equipo
    // ganador para que el bracket muestre la trazabilidad del origen.
    const winnersWithSeed = curMatches.map((m) => {
      const winnerId = getMatchWinner(m);
      if (!winnerId) return null;
      const winnerIsHome = winnerId === m.team_home_id;
      return {
        id:   winnerId,
        seed: winnerIsHome ? m.seed_home : m.seed_away,
        text: winnerIsHome ? m.equipo_local : m.equipo_visitante,
      };
    });
    for (let j = 0; j < Math.floor(winnersWithSeed.length / 2); j++) {
      const ph = nextPlaceholders[j];
      if (!ph) break;
      const homeW = winnersWithSeed[j * 2];
      const awayW = winnersWithSeed[j * 2 + 1];
      if (!homeW?.id || !awayW?.id) continue;
      await supabase.from('matches').update({
        team_home_id:     homeW.id,
        team_away_id:     awayW.id,
        seed_home:        homeW.seed ?? null,
        seed_away:        awayW.seed ?? null,
        equipo_local:     homeW.text ?? null,
        equipo_visitante: awayW.text ?? null,
      }).eq('id', ph.id);
    }

    // Si la fase actual es semis y existe placeholder de tercer_lugar,
    // poblarlo con los PERDEDORES de las semis (preservando sus seeds).
    if (cur === 'semis') {
      const tercerPlaceholder = matches
        .find((m) => m.fase === 'tercer_lugar' && !m.team_home_id && !m.team_away_id);
      if (tercerPlaceholder) {
        const losers = curMatches.map((m) => {
          const winner = getMatchWinner(m);
          if (!winner) return null;
          const loserIsHome = winner !== m.team_home_id;
          return {
            id:   loserIsHome ? m.team_home_id : m.team_away_id,
            seed: loserIsHome ? m.seed_home : m.seed_away,
            text: loserIsHome ? m.equipo_local : m.equipo_visitante,
          };
        }).filter((x) => x?.id);
        if (losers.length >= 2) {
          await supabase.from('matches').update({
            team_home_id:     losers[0].id,
            team_away_id:     losers[1].id,
            seed_home:        losers[0].seed ?? null,
            seed_away:        losers[1].seed ?? null,
            equipo_local:     losers[0].text ?? null,
            equipo_visitante: losers[1].text ?? null,
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

  // El premio MVP ($1) lo acredita el trigger trg_award_mvp_prize al insertar mvp_results
  // (server-side, idempotente). credit_wallet ya NO es invocable desde el cliente.

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

// ─── Selecciones (modo Mundial) ─────────────────────────────────────────────
// Catálogo reutilizable para asignar a un equipo una selección con su bandera.
// `color` = color de peto representativo (lo que el jugador debe vestir).
// `code`  = código flagcdn (ISO alpha-2, o gb-eng/gb-sct para Reino Unido).
// La bandera se sirve desde flagcdn.com (PNG gratis, sin API key; soporta
// gb-eng que el emoji 🏴 no renderiza en Android).
export const flagUrl = (code) => `https://flagcdn.com/w160/${code}.png`;

export const WC_SELECCIONES = [
  { code: 'ar',     nombre: 'Argentina',      color: '#75AADB' },
  { code: 'br',     nombre: 'Brasil',         color: '#FFDF00' },
  { code: 'gb-eng', nombre: 'Inglaterra',     color: '#F2F2F2' },
  { code: 'fr',     nombre: 'Francia',        color: '#1E2A78' },
  { code: 'es',     nombre: 'España',         color: '#C60B1E' },
  { code: 'de',     nombre: 'Alemania',       color: '#1A1A1A' },
  { code: 'pt',     nombre: 'Portugal',       color: '#C8102E' },
  { code: 'nl',     nombre: 'Países Bajos',   color: '#FF6C00' },
  { code: 'be',     nombre: 'Bélgica',        color: '#E30613' },
  { code: 'hr',     nombre: 'Croacia',        color: '#E63946' },
  { code: 'uy',     nombre: 'Uruguay',        color: '#5CBFEB' },
  { code: 'mx',     nombre: 'México',         color: '#006847' },
  { code: 'co',     nombre: 'Colombia',       color: '#FCD116' },
  { code: 'pa',     nombre: 'Panamá',         color: '#D21034' },
  { code: 'us',     nombre: 'Estados Unidos', color: '#1A237E' },
  { code: 'ca',     nombre: 'Canadá',         color: '#FF0000' },
  { code: 'jp',     nombre: 'Japón',          color: '#0B1F8F' },
  { code: 'kr',     nombre: 'Corea del Sur',  color: '#E30613' },
  { code: 'ma',     nombre: 'Marruecos',      color: '#C1272D' },
  { code: 'sn',     nombre: 'Senegal',        color: '#2DC653' },
  { code: 'ch',     nombre: 'Suiza',          color: '#FF0000' },
  { code: 'ec',     nombre: 'Ecuador',        color: '#FFD100' },
  { code: 'pl',     nombre: 'Polonia',        color: '#DC143C' },
  { code: 'gb-sct', nombre: 'Escocia',        color: '#2B2D42' },
];
