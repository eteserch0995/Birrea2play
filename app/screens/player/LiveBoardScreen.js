// LiveBoardScreen — "Pantalla en Vivo" proyectable del evento en curso.
//
// Réplica del tablero TV del Mundialito (marcador gigante + rail de tabla y
// próximos partidos + animación de gol) adaptada a la estructura de datos de
// Birrea2Play (events / teams / matches con goles_home/away, fase, jornada).
//
// Pensada para proyectar en pantalla grande o usar el teléfono como marcador:
//  • Poll cada 10s (la app no usa realtime; mismo patrón que MatchTimer).
//  • Botón flotante ⛶: fullscreen (Fullscreen API) + intento de lock landscape.
//  • Si el navegador no permite lock (iOS), se fuerza landscape rotando el
//    lienzo 90° — el mismo truco de kiosko del tablero Nestlé.
//  • WakeLock best-effort para que la pantalla no se duerma proyectando.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  ActivityIndicator, Animated, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { getTournamentWinner, computeStandingsFromMatches } from '../../../lib/eventHelpers';
import { getScoringTerms } from '../../../lib/sportTerms';
import { logWarn } from '../../../lib/logger';
import TeamBadge from '../../../components/TeamBadge';
import MatchTimer from '../../../components/MatchTimer';

const isWeb = Platform.OS === 'web' && typeof document !== 'undefined';

const FASE_LABEL = {
  grupos: 'FASE DE GRUPOS', octavos: 'OCTAVOS', cuartos: 'CUARTOS',
  semis: 'SEMIFINAL', tercer_lugar: '3ER LUGAR', final: 'FINAL',
};

// Equipo mostrable: embed de teams o fallback de texto libre (eventos viejos).
const dispHome = (m) => m.home ?? (m.equipo_local ? { nombre: m.equipo_local } : null);
const dispAway = (m) => m.away ?? (m.equipo_visitante ? { nombre: m.equipo_visitante } : null);

// ── Punto rojo pulsante "EN VIVO" ─────────────────────────────────────────────
function LiveDot({ size = 10 }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return (
    <Animated.View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: COLORS.red, opacity: anim,
    }} />
  );
}

export default function LiveBoardScreen({ route, navigation }) {
  const params = route?.params ?? {};
  const eventId = params.eventId ?? params.id ?? null;
  const focused = useIsFocused();
  const { width: winW, height: winH } = useWindowDimensions();

  const [event, setEvent]     = useState(null);
  const [teams, setTeams]     = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [manualIdx, setManualIdx] = useState(null); // null = partido "en juego" automático
  const [proj, setProj]       = useState(false);    // modo proyección (fullscreen/rotado)
  const [gol, setGol]         = useState(null);     // { nombre, color } al detectar gol

  const prevScores = useRef(null);
  const golAnim    = useRef(new Animated.Value(0)).current;
  const bumpAnim   = useRef(new Animated.Value(1)).current;

  // ── Carga + poll 10s (solo con la pantalla enfocada) ───────────────────────
  const load = useCallback(async () => {
    if (!eventId) { setLoading(false); return; }
    try {
      const [{ data: ev, error: evErr }, { data: t }, { data: m }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('teams').select('*').eq('event_id', eventId),
        supabase.from('matches')
          .select('*, home:team_home_id(nombre,color,logo_url), away:team_away_id(nombre,color,logo_url)')
          .eq('event_id', eventId)
          .order('jornada'),
      ]);
      if (evErr) throw evErr;
      setEvent(ev);
      setTeams(t ?? []);
      setMatches(m ?? []);
    } catch (e) {
      logWarn({ screen: 'LiveBoardScreen', action: 'load', eventId, technical: e });
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (!focused) return undefined;
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [focused, load]);

  // Realtime: los cambios de marcador llegan por websocket AL INSTANTE (mismo
  // patrón que RaffleScreen; requiere matches en la publication supabase_realtime).
  // El poll de 10s queda de respaldo por si el socket se cae y para partidos nuevos.
  useEffect(() => {
    if (!eventId || !focused) return undefined;
    const channel = supabase
      .channel(`liveboard-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'matches',
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const row = payload?.new;
        if (!row?.id) return;
        // Merge sobre el estado actual — el row crudo no trae los embeds home/away.
        setMatches((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId, focused]);

  // ── Detección de gol: cualquier marcador que sube dispara el overlay ────────
  useEffect(() => {
    if (!matches.length) return;
    const map = {};
    matches.forEach((m) => { map[m.id] = { h: m.goles_home ?? 0, a: m.goles_away ?? 0 }; });
    if (prevScores.current) {
      for (const m of matches) {
        const p = prevScores.current[m.id];
        if (!p) continue;
        const h = m.goles_home ?? 0;
        const a = m.goles_away ?? 0;
        const scorer = h > p.h ? dispHome(m) : a > p.a ? dispAway(m) : null;
        if (scorer) {
          setGol({ nombre: scorer.nombre ?? '', color: scorer.color ?? COLORS.gold });
          golAnim.setValue(0);
          Animated.sequence([
            Animated.spring(golAnim, { toValue: 1, friction: 5, useNativeDriver: true }),
            Animated.delay(2600),
            Animated.timing(golAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]).start(() => setGol(null));
          break; // un overlay a la vez
        }
      }
    }
    prevScores.current = map;
  }, [matches, golAnim]);

  // ── Partido destacado ───────────────────────────────────────────────────────
  const playable = matches.filter((m) => dispHome(m) && dispAway(m));
  const autoIdx = (() => {
    const i = playable.findIndex((m) => m.status !== 'finished');
    if (i >= 0) return i;
    return playable.length ? playable.length - 1 : -1; // todo terminado → último
  })();
  const idx = manualIdx == null
    ? autoIdx
    : Math.min(Math.max(manualIdx, 0), playable.length - 1);
  const featured = idx >= 0 ? playable[idx] : null;

  const cycle = (dir) => {
    if (!playable.length) return;
    const base = manualIdx == null ? autoIdx : manualIdx;
    setManualIdx((base + dir + playable.length) % playable.length);
  };

  // Rebote del marcador del partido destacado al cambiar (estilo .bump del TV).
  const featScoreKey = featured ? `${featured.id}:${featured.goles_home}:${featured.goles_away}` : '';
  useEffect(() => {
    if (!featScoreKey) return;
    bumpAnim.setValue(1.28);
    Animated.spring(bumpAnim, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [featScoreKey, bumpAnim]);

  // ── Proyección: fullscreen + lock landscape + rotación CSS de respaldo ─────
  async function enterProjection() {
    setProj(true);
    if (!isWeb) return;
    try { await document.documentElement.requestFullscreen(); } catch {}
    try { await window.screen?.orientation?.lock?.('landscape'); } catch {}
  }
  function exitProjection() {
    setProj(false);
    if (!isWeb) return;
    try { window.screen?.orientation?.unlock?.(); } catch {}
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch {} }
  }
  useEffect(() => {
    if (!isWeb) return undefined;
    const onChange = () => { if (!document.fullscreenElement) setProj(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // WakeLock: que la pantalla no se apague mientras se proyecta (best-effort).
  useEffect(() => {
    if (!isWeb || !focused) return undefined;
    let lock = null;
    let alive = true;
    const request = async () => {
      try { lock = await navigator.wakeLock?.request?.('screen'); } catch {}
    };
    const onVis = () => { if (alive && document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      try { lock?.release?.(); } catch {}
    };
  }, [focused]);

  const isPortrait = winH > winW;
  const rotated = isWeb && proj && isPortrait; // lock falló (iOS) → rotamos el lienzo
  const canvasW = rotated ? winH : winW;
  const canvasH = rotated ? winW : winH;
  const isNarrow = canvasW < 640;

  // Escalas proporcionales al ancho del lienzo (proyector, tablet o teléfono).
  const scoreSize = Math.min(canvasW * 0.16, 150);
  const nameSize  = Math.min(Math.max(canvasW * 0.032, 15), 30);
  const badgeSize = Math.min(canvasW * 0.13, 104);

  // ── Estados base ────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <ActivityIndicator color={COLORS.red} size="large" />
      <Text style={styles.loadingText}>Cargando pantalla en vivo...</Text>
    </SafeAreaView>
  );
  if (!event) return (
    <SafeAreaView style={[styles.safe, styles.center, { padding: SPACING.lg }]}>
      <Text style={styles.loadingText}>No se pudo cargar el evento.</Text>
      <TouchableOpacity onPress={() => { setLoading(true); load(); }} style={styles.retryBtn}>
        <Text style={styles.retryText}>Reintentar</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.backLink}>← Volver</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const winner = getTournamentWinner(matches, teams);
  const is2Vidas = event.formato === '2 Vidas';
  const hasTable = ['Liga', 'Torneo'].includes(event.formato);
  const scoring  = getScoringTerms(event.deporte ?? 'Fútbol'); // volley grita ¡PUNTO!, fútbol ¡GOOOL!

  // Tabla: EXACTAMENTE el mismo helper que usa "Ver evento en curso" (puntos
  // por deporte + desempate pts→DG→GF) para que ambas pantallas coincidan.
  const tableRows = hasTable
    ? computeStandingsFromMatches(matches, teams, event.deporte ?? 'Fútbol')
        .map((r) => ({ ...r, team: teams.find((t) => t.id === r.team_id) }))
    : [];

  const upcoming = playable.filter((m) => m.status !== 'finished' && m.id !== featured?.id).slice(0, 4);
  const recent   = playable.filter((m) => m.status === 'finished').slice(-4).reverse();
  const vidas    = is2Vidas
    ? [...teams].sort((a, b) => (b.vidas_actuales ?? 0) - (a.vidas_actuales ?? 0))
    : [];

  const home = featured ? dispHome(featured) : null;
  const away = featured ? dispAway(featured) : null;
  const accent = home?.color ?? COLORS.gold;
  const isDone = featured?.status === 'finished';
  const isAutoLive = featured && manualIdx == null && !isDone && !winner;

  const content = (
    <View style={styles.canvas}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (proj ? exitProjection() : navigation.goBack())} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{event.nombre}</Text>
        <View style={styles.liveChip}>
          <LiveDot />
          <Text style={styles.liveChipText}>EN VIVO</Text>
        </View>
      </View>

      {/* Marcador destacado */}
      <View style={[styles.board, { borderTopColor: accent }]}>
        {winner ? (
          <View style={styles.center}>
            <Text style={[styles.champLabel, { fontSize: Math.min(canvasW * 0.05, 34) }]}>🏆 CAMPEÓN</Text>
            <TeamBadge team={winner} size={badgeSize * 1.15} showName={false} />
            <Text style={[styles.champName, { fontSize: Math.min(canvasW * 0.09, 72) }]} numberOfLines={1}>
              {winner.nombre}
            </Text>
          </View>
        ) : !featured ? (
          <View style={styles.center}>
            <Text style={styles.emptyText}>No hay partidos generados aún</Text>
          </View>
        ) : (
          <>
            <View style={styles.faseRow}>
              <View style={[styles.faseChip, { backgroundColor: isDone ? COLORS.green + '22' : COLORS.red + '22' }]}>
                {!isDone && <LiveDot size={8} />}
                <Text style={[styles.faseChipText, { color: isDone ? COLORS.green : COLORS.red2 ?? COLORS.red }]}>
                  {isDone ? 'FINAL DEL PARTIDO' : isAutoLive ? 'EN JUEGO' : 'PROGRAMADO'}
                </Text>
              </View>
              <Text style={styles.faseLabel}>
                {(FASE_LABEL[featured.fase] ?? 'GRUPOS')}{featured.fase === 'grupos' ? ` · J${featured.jornada ?? 1}` : ''}
              </Text>
            </View>

            <View style={styles.scoreRow}>
              <View style={styles.teamCol}>
                <TeamBadge team={home} size={badgeSize} showName={false} />
                <Text style={[styles.teamName, { fontSize: nameSize }]} numberOfLines={2}>{home?.nombre ?? 'Por definir'}</Text>
              </View>
              <Animated.View style={[styles.scoreWrap, { transform: [{ scale: bumpAnim }] }]}>
                <Text style={[styles.scoreText, { fontSize: scoreSize, lineHeight: scoreSize * 1.05 }]}>
                  {featured.goles_home ?? 0}
                  <Text style={{ color: accent }}> : </Text>
                  {featured.goles_away ?? 0}
                </Text>
                {featured.fue_a_penales && (
                  <Text style={styles.penText}>
                    PEN {featured.goles_pen_home ?? 0} – {featured.goles_pen_away ?? 0}
                  </Text>
                )}
              </Animated.View>
              <View style={styles.teamCol}>
                <TeamBadge team={away} size={badgeSize} showName={false} />
                <Text style={[styles.teamName, { fontSize: nameSize }]} numberOfLines={2}>{away?.nombre ?? 'Por definir'}</Text>
              </View>
            </View>

            <MatchTimer eventId={eventId} mode="view" style={styles.timer} />

            {/* Navegación entre partidos */}
            <View style={styles.navRow}>
              <TouchableOpacity onPress={() => cycle(-1)} style={styles.navBtn}>
                <Text style={styles.navBtnText}>‹</Text>
              </TouchableOpacity>
              {manualIdx != null && (
                <TouchableOpacity onPress={() => setManualIdx(null)} style={styles.autoPill}>
                  <Text style={styles.autoPillText}>● VOLVER AL VIVO</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => cycle(1)} style={styles.navBtn}>
                <Text style={styles.navBtnText}>›</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Rail inferior: próximos + tabla / vidas / resultados */}
      <View style={[styles.rail, isNarrow && { flexDirection: 'column' }]}>
        <View style={styles.railBox}>
          <Text style={styles.railTitle}>SIGUE ▸</Text>
          {upcoming.length === 0
            ? <Text style={styles.railEmpty}>No hay más partidos pendientes</Text>
            : upcoming.map((m) => (
              <View key={m.id} style={styles.railRow}>
                <TeamBadge team={dispHome(m)} size={20} showName={false} />
                <Text style={styles.railTeam} numberOfLines={1}>{dispHome(m)?.nombre}</Text>
                <Text style={styles.railVs}>vs</Text>
                <Text style={[styles.railTeam, { textAlign: 'right' }]} numberOfLines={1}>{dispAway(m)?.nombre}</Text>
                <TeamBadge team={dispAway(m)} size={20} showName={false} />
              </View>
            ))}
        </View>

        <View style={styles.railBox}>
          {is2Vidas ? (
            <>
              <Text style={styles.railTitle}>❤ VIDAS</Text>
              {vidas.slice(0, 6).map((t) => (
                <View key={t.id} style={styles.railRow}>
                  <TeamBadge team={t} size={20} showName={false} />
                  <Text style={styles.railTeam} numberOfLines={1}>{t.nombre}</Text>
                  <Text style={[styles.railPts, { color: (t.vidas_actuales ?? 0) > 0 ? COLORS.red : COLORS.gray }]}>
                    {'❤'.repeat(t.vidas_actuales ?? 0) || '☠'}
                  </Text>
                </View>
              ))}
            </>
          ) : hasTable && tableRows.length ? (
            <>
              <Text style={styles.railTitle}>TABLA</Text>
              {tableRows.slice(0, 6).map((r, i) => (
                <View key={r.team_id} style={styles.railRow}>
                  <Text style={[styles.railPos, i < 2 && { color: COLORS.gold }]}>{i + 1}</Text>
                  <TeamBadge team={r.team} size={20} showName={false} />
                  <Text style={styles.railTeam} numberOfLines={1}>{r.equipo}</Text>
                  <Text style={styles.railStat}>{r.pj}PJ</Text>
                  <Text style={styles.railPts}>{r.pts}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.railTitle}>RESULTADOS</Text>
              {recent.length === 0
                ? <Text style={styles.railEmpty}>Aún no hay resultados</Text>
                : recent.map((m) => (
                  <View key={m.id} style={styles.railRow}>
                    <Text style={styles.railTeam} numberOfLines={1}>{dispHome(m)?.nombre}</Text>
                    <Text style={styles.railScore}>{m.goles_home ?? 0} - {m.goles_away ?? 0}</Text>
                    <Text style={[styles.railTeam, { textAlign: 'right' }]} numberOfLines={1}>{dispAway(m)?.nombre}</Text>
                  </View>
                ))}
            </>
          )}
        </View>
      </View>

      {/* Overlay de GOL */}
      {gol && (
        <Animated.View pointerEvents="none" style={[styles.golOverlay, {
          opacity: golAnim,
          transform: [{ scale: golAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }]}>
          <Text style={[styles.golText, { fontSize: Math.min(canvasW * 0.18, 130) }]}>{scoring.grito}</Text>
          <Text style={[styles.golTeam, { color: gol.color, fontSize: Math.min(canvasW * 0.07, 52) }]} numberOfLines={1}>
            {gol.nombre}
          </Text>
        </Animated.View>
      )}

      {/* Botón flotante proyección (solo web) */}
      {isWeb && (
        <TouchableOpacity
          onPress={() => (proj ? exitProjection() : enterProjection())}
          style={[styles.fsBtn, proj && styles.fsBtnOn]}
          activeOpacity={0.8}
        >
          <Text style={styles.fsBtnText}>
            {proj ? '✕ SALIR' : isPortrait ? '⛶ GIRAR PANTALLA' : '⛶ PANTALLA COMPLETA'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (rotated) {
    // Lienzo winH×winW centrado y rotado 90° → ocupa el viewport completo.
    return (
      <View style={[styles.safe, { overflow: 'hidden' }]}>
        <View style={{
          position: 'absolute',
          left: (winW - winH) / 2,
          top: (winH - winW) / 2,
          width: winH,
          height: winW,
          transform: [{ rotate: '90deg' }],
        }}>
          {content}
        </View>
      </View>
    );
  }
  return <SafeAreaView style={styles.safe}>{content}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.asphalt },
  center:      { alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, flex: 1 },
  loadingText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13, textAlign: 'center' },
  retryBtn:    { backgroundColor: COLORS.red, paddingHorizontal: 24, paddingVertical: 12, borderRadius: RADIUS.sm },
  retryText:   { fontFamily: FONTS.bodyMedium, color: COLORS.white, letterSpacing: 1 },
  backLink:    { fontFamily: FONTS.bodyMedium, color: COLORS.blue2, marginTop: 4 },

  canvas:      { flex: 1, padding: SPACING.sm, gap: SPACING.sm },
  header:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.xs },
  closeBtn:    { padding: 6 },
  closeText:   { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gray2 },
  headerTitle: { flex: 1, fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  liveChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.red + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
  liveChipText:{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.red2 ?? COLORS.red, letterSpacing: 2 },

  board:       { flex: 1.7, backgroundColor: COLORS.card, borderRadius: RADIUS.xl, borderWidth: 1, borderColor: COLORS.navy, borderTopWidth: 5, alignItems: 'center', justifyContent: 'center', padding: SPACING.md, gap: SPACING.sm },
  faseRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  faseChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
  faseChipText:{ fontFamily: FONTS.bodyBold, fontSize: 11, letterSpacing: 2 },
  faseLabel:   { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.gold, letterSpacing: 3 },
  scoreRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, width: '100%' },
  teamCol:     { flex: 1, alignItems: 'center', gap: SPACING.sm },
  teamName:    { fontFamily: FONTS.heading, color: COLORS.white, letterSpacing: 1, textAlign: 'center' },
  scoreWrap:   { alignItems: 'center', minWidth: 120 },
  scoreText:   { fontFamily: FONTS.heading, color: COLORS.white, textAlign: 'center', textShadowColor: '#00000088', textShadowOffset: { width: 0, height: 5 }, textShadowRadius: 16 },
  penText:     { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.gold, letterSpacing: 2, marginTop: 2 },
  timer:       { backgroundColor: 'transparent', borderWidth: 0, paddingVertical: 0 },
  navRow:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  navBtn:      { paddingHorizontal: 18, paddingVertical: 2, borderRadius: RADIUS.full, backgroundColor: COLORS.navy },
  navBtnText:  { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, lineHeight: 30 },
  autoPill:    { backgroundColor: COLORS.red + '22', paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.full },
  autoPillText:{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.red2 ?? COLORS.red, letterSpacing: 1 },
  emptyText:   { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },

  champLabel:  { fontFamily: FONTS.heading, color: COLORS.gold, letterSpacing: 4, marginBottom: SPACING.sm },
  champName:   { fontFamily: FONTS.heading, color: COLORS.white, letterSpacing: 2, marginTop: SPACING.sm },

  rail:        { flex: 1, flexDirection: 'row', gap: SPACING.sm },
  railBox:     { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.navy, padding: SPACING.md, gap: 6 },
  railTitle:   { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gold, letterSpacing: 3, marginBottom: 2 },
  railRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  railTeam:    { flex: 1, fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.white },
  railVs:      { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  railScore:   { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, minWidth: 44, textAlign: 'center' },
  railStat:    { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  railPts:     { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, minWidth: 26, textAlign: 'right' },
  railPos:     { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray2, width: 16 },
  railEmpty:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },

  golOverlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000D0', alignItems: 'center', justifyContent: 'center', zIndex: 40 },
  golText:     { fontFamily: FONTS.heading, color: COLORS.gold, letterSpacing: 4 },
  golTeam:     { fontFamily: FONTS.heading, letterSpacing: 2, marginTop: 4 },

  fsBtn:       { position: 'absolute', bottom: 18, right: 18, paddingVertical: 12, paddingHorizontal: 18, borderRadius: RADIUS.full, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center', zIndex: 50, minHeight: 44 },
  fsBtnOn:     { backgroundColor: '#000000AA', borderWidth: 1, borderColor: '#FFFFFF33' },
  fsBtnText:   { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, letterSpacing: 1 },
});
