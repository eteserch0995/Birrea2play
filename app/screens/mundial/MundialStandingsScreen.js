// ============================================================
// MundialStandingsScreen — "PARTIDOS DEL MUNDIAL"
// Pestañas: HOY (live) · PRÓXIMOS (calendario) · GRUPOS (tabla)
// + Banner VER EN VIVO siempre visible
// ============================================================
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl, Linking, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';

const mundialLogo = require('../../../assets/mundial/mundial-logo.png');
const LIVE_URL   = 'https://futbol-libres.su/';
const PA_OFFSET  = 5 * 3600 * 1000;
const REFRESH_MS = 45000;
const MESES      = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS       = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const GROUPS     = ['A','B','C','D','E','F','G','H','I','J','K','L'];
const TABS       = [{ key:'hoy', label:'HOY' }, { key:'proximos', label:'PRÓXIMOS' }, { key:'grupos', label:'GRUPOS' }];

// ── Helpers tiempo ────────────────────────────────────────────
function tsMs(ts) {
  if (!ts) return 0;
  let s = String(ts).replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
function paDate(ts)    { return new Date(tsMs(ts) - PA_OFFSET); }
function paTimeStr(ts) {
  const d = paDate(ts);
  let h = d.getUTCHours(), m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}
function paDayKey(ts) {
  const d = paDate(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function todayKey() { return paDayKey(new Date().toISOString()); }
function dayLabel(key) {
  const tk = todayKey();
  if (key === tk) return 'HOY';
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m-1]}`;
}
// Convierte clave de día PA a rango UTC ISO para query
function dayToUtcRange(key) {
  const [y,m,d] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m-1, d, 5, 0, 0)).toISOString();   // 05:00 UTC = 00:00 PA
  const end   = new Date(Date.UTC(y, m-1, d+1, 5, 0, 0)).toISOString();
  return { start, end };
}

// ── Banderas ──────────────────────────────────────────────────
const FLAG_CC = {
  CZE:'cz',KOR:'kr',MEX:'mx',ZAF:'za',BIH:'ba',CAN:'ca',QAT:'qa',SUI:'ch',
  BRA:'br',SCO:'gb-sct',HAI:'ht',MAR:'ma',AUS:'au',USA:'us',PAR:'py',TUR:'tr',
  GER:'de',CIV:'ci',CUW:'cw',ECU:'ec',JPN:'jp',NED:'nl',SWE:'se',TUN:'tn',
  BEL:'be',EGY:'eg',IRN:'ir',NZL:'nz',KSA:'sa',CPV:'cv',ESP:'es',URU:'uy',
  FRA:'fr',IRQ:'iq',NOR:'no',SEN:'sn',DZA:'dz',ARG:'ar',AUT:'at',JOR:'jo',
  COL:'co',POR:'pt',COD:'cd',UZB:'uz',CRO:'hr',GHA:'gh',ENG:'gb-eng',PAN:'pa',
};
function flagUri(code) {
  const cc = FLAG_CC[(code||'').toUpperCase()];
  return cc ? `https://flagcdn.com/w40/${cc}.png` : null;
}
function Flag({ code, size = 26 }) {
  const uri = flagUri(code);
  if (!uri) return null;
  return <Image source={{ uri }} style={[s.flag, { width: size, height: size * 0.67 }]} resizeMode="cover" accessibilityIgnoresInvertColors />;
}
function teamLabel(team, ph) { return team?.code || team?.name_es || team?.name || ph || '—'; }

// ── Goles ─────────────────────────────────────────────────────
function parseGoals(apiRaw) {
  if (!apiRaw) return [];
  const events = apiRaw?.events ?? apiRaw?.response?.[0]?.events ?? [];
  return events.filter(e => e?.type === 'Goal').map(e => ({
    minute: e?.time?.elapsed ?? '?',
    player: e?.player?.name ?? '?',
    team:   e?.team?.name ?? '',
    detail: e?.detail ?? '',
  }));
}

// ── Stats tabla ───────────────────────────────────────────────
function wins(row) {
  const pts = row.points ?? 0, mp = row.matches_played ?? 0;
  if (mp === 0) return 0;
  for (let pg = Math.floor(pts / 3); pg >= 0; pg--) {
    const pe = pts - 3 * pg;
    if (pe >= 0 && pg + pe <= mp) return pg;
  }
  return 0;
}
function draws(row) { return Math.max(0, (row.points ?? 0) - 3 * wins(row)); }
function phaseStr(phase) {
  const m = { group:'Grupos', round_32:'Ronda 32', round_16:'Octavos', quarter:'Cuartos', semi:'Semis', third_place:'3er Lugar', final:'Final' };
  return m[phase] ?? phase;
}

// ─────────────────────────────────────────────────────────────
export default function MundialStandingsScreen({ navigation }) {
  const [activeTab, setActiveTab]       = useState('hoy');
  const [todayMatches, setTodayMatches] = useState([]);
  const [nextGroups, setNextGroups]     = useState([]);   // [{day, matches}]
  const [standings, setStandings]       = useState({});
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [activeGroup, setActiveGroup]   = useState('A');
  const [expandedGoals, setExpandedGoals] = useState({});

  const load = useCallback(async () => {
    try {
      const tk = todayKey();
      const { start: todayStart, end: todayEnd } = dayToUtcRange(tk);

      // 3 queries en paralelo
      const [todayRes, nextRes, standRes] = await Promise.all([
        // Hoy
        supabase.from('wc_matches')
          .select('id, scheduled_at, status, score_home, score_away, penalties_home, penalties_away, went_to_penalties, phase, group_letter, home_placeholder, away_placeholder, team_home_id, team_away_id')
          .gte('scheduled_at', todayStart).lt('scheduled_at', todayEnd)
          .order('scheduled_at'),
        // Próximos (desde mañana, 14 días)
        supabase.from('wc_matches')
          .select('id, scheduled_at, status, phase, group_letter, home_placeholder, away_placeholder, team_home_id, team_away_id')
          .gte('scheduled_at', todayEnd)
          .lte('scheduled_at', new Date(new Date(todayEnd).getTime() + 14 * 86400000).toISOString())
          .order('scheduled_at')
          .limit(60),
        // Grupos
        supabase.from('wc_group_standings')
          .select('group_letter, team_id, team_code, team_name, points, goals_for, goals_against, goal_diff, matches_played, position')
          .order('group_letter').order('position'),
      ]);

      // Hidratar HOY
      const todayRows = todayRes.data ?? [];
      const teamIdsTd = [...new Set(todayRows.flatMap(r => [r.team_home_id, r.team_away_id]).filter(Boolean))];
      const matchIdsTd = todayRows.map(r => r.id);

      const [teamsTd, livesTd] = await Promise.all([
        teamIdsTd.length ? supabase.from('wc_teams').select('id, code, name_es, name').in('id', teamIdsTd) : Promise.resolve({ data: [] }),
        matchIdsTd.length ? supabase.from('wc_results').select('match_id, api_score_home, api_score_away, api_raw').in('match_id', matchIdsTd) : Promise.resolve({ data: [] }),
      ]);
      const tmTd = (teamsTd.data ?? []).reduce((a, t) => { a[t.id] = t; return a; }, {});
      const liveTd = (livesTd.data ?? []).reduce((a, r) => { a[r.match_id] = r; return a; }, {});
      setTodayMatches(todayRows.map(r => ({
        ...r,
        home: tmTd[r.team_home_id] ?? null, away: tmTd[r.team_away_id] ?? null,
        live: liveTd[r.id] ?? null, goals: parseGoals(liveTd[r.id]?.api_raw),
      })));

      // Hidratar PRÓXIMOS
      const nextRows = nextRes.data ?? [];
      const teamIdsNx = [...new Set(nextRows.flatMap(r => [r.team_home_id, r.team_away_id]).filter(Boolean))];
      const teamsNx = teamIdsNx.length
        ? await supabase.from('wc_teams').select('id, code, name_es, name').in('id', teamIdsNx)
        : { data: [] };
      const tmNx = (teamsNx.data ?? []).reduce((a, t) => { a[t.id] = t; return a; }, {});
      const hydratedNext = nextRows.map(r => ({
        ...r,
        home: tmNx[r.team_home_id] ?? null, away: tmNx[r.team_away_id] ?? null,
      }));
      const dayMap = {};
      for (const m of hydratedNext) {
        const key = paDayKey(m.scheduled_at);
        if (!dayMap[key]) dayMap[key] = [];
        dayMap[key].push(m);
      }
      setNextGroups(Object.keys(dayMap).sort().map(day => ({ day, matches: dayMap[day] })));

      // Standings
      const sm = {};
      for (const row of (standRes.data ?? [])) {
        if (!sm[row.group_letter]) sm[row.group_letter] = [];
        sm[row.group_letter].push(row);
      }
      setStandings(sm);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const toggleGoals = id => setExpandedGoals(e => ({ ...e, [id]: !e[id] }));

  const groupsWithData = GROUPS.filter(g => (standings[g] ?? []).length > 0);
  const tabGroups      = groupsWithData.length > 0 ? groupsWithData : GROUPS;
  const activeRows     = standings[activeGroup] ?? [];
  const anyLive        = todayMatches.some(m => m.status === 'live');

  return (
    <MundialScreenFrame>
      <SafeAreaView style={s.safe} edges={['top']}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Image source={mundialLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>PARTIDOS DEL MUNDIAL</Text>
        </View>

        {/* Banner VER EN VIVO — siempre visible */}
        <LiveBanner />

        {/* Pestañas */}
        <View style={s.tabsRow}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tab, activeTab === t.key && s.tabActive]}
              onPress={() => setActiveTab(t.key)}
              activeOpacity={0.75}
            >
              <Text style={[s.tabText, activeTab === t.key && s.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} colors={[COLORS.neon]} />}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.neon} style={{ marginTop: 48 }} />
          ) : (
            <>
              {/* ── HOY ── */}
              {activeTab === 'hoy' && (
                <View>
                  <View style={s.sectionHeader}>
                    <Text style={s.sectionTitle}>PARTIDOS DE HOY</Text>
                    {anyLive && (
                      <View style={s.liveChip}>
                        <View style={s.liveDotSmall} />
                        <Text style={s.liveChipText}>EN VIVO</Text>
                      </View>
                    )}
                  </View>
                  {todayMatches.length === 0
                    ? <Text style={s.empty}>Sin partidos programados para hoy</Text>
                    : todayMatches.map(m => (
                        <MatchCard
                          key={m.id} m={m}
                          goalsOpen={!!expandedGoals[m.id]}
                          onToggle={() => toggleGoals(m.id)}
                        />
                      ))
                  }
                </View>
              )}

              {/* ── PRÓXIMOS ── */}
              {activeTab === 'proximos' && (
                <View>
                  {nextGroups.length === 0
                    ? <Text style={s.empty}>No hay partidos próximos cargados</Text>
                    : nextGroups.map(({ day, matches }) => (
                        <View key={day}>
                          <View style={s.dayHeader}>
                            <Text style={s.dayLabel}>{dayLabel(day)}</Text>
                          </View>
                          {matches.map(m => <MatchCard key={m.id} m={m} goalsOpen={false} onToggle={() => {}} />)}
                        </View>
                      ))
                  }
                </View>
              )}

              {/* ── GRUPOS ── */}
              {activeTab === 'grupos' && (
                <View>
                  {/* Tabs de grupo */}
                  <View style={s.groupTabsRow}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.groupTabsContent}>
                      {tabGroups.map(g => (
                        <TouchableOpacity
                          key={g}
                          style={[s.groupTab, activeGroup === g && s.groupTabActive]}
                          onPress={() => setActiveGroup(g)}
                          activeOpacity={0.75}
                        >
                          <Text style={[s.groupTabText, activeGroup === g && s.groupTabTextActive]}>GRP {g}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Tabla */}
                  <View style={s.table}>
                    <View style={[s.tableRow, s.tableHead]}>
                      <Text style={[s.col, s.colPos]}>#</Text>
                      <Text style={[s.col, s.colTeam]}>EQUIPO</Text>
                      <Text style={[s.col, s.colNum]}>PJ</Text>
                      <Text style={[s.col, s.colNum]}>PG</Text>
                      <Text style={[s.col, s.colNum]}>PE</Text>
                      <Text style={[s.col, s.colNum]}>PP</Text>
                      <Text style={[s.col, s.colNum]}>GF</Text>
                      <Text style={[s.col, s.colNum]}>GC</Text>
                      <Text style={[s.col, s.colNum]}>DG</Text>
                      <Text style={[s.col, s.colPts]}>PTS</Text>
                    </View>
                    {activeRows.length === 0
                      ? <Text style={s.empty}>Sin resultados en Grupo {activeGroup} aún</Text>
                      : activeRows.map((row, i) => {
                          const pg = wins(row), pe = draws(row);
                          const pp = Math.max(0, (row.matches_played ?? 0) - pg - pe);
                          const q  = row.position <= 2;
                          return (
                            <View key={row.team_id} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt, q && s.tableRowQ]}>
                              <Text style={[s.col, s.colPos, q && s.posQ]}>{row.position}</Text>
                              <View style={[s.col, s.colTeam, { flexDirection:'row', alignItems:'center', gap:5 }]}>
                                <Flag code={row.team_code} size={18} />
                                <Text style={s.teamName} numberOfLines={1}>{row.team_name || row.team_code}</Text>
                              </View>
                              <Text style={[s.col, s.colNum]}>{row.matches_played ?? 0}</Text>
                              <Text style={[s.col, s.colNum]}>{pg}</Text>
                              <Text style={[s.col, s.colNum]}>{pe}</Text>
                              <Text style={[s.col, s.colNum]}>{pp}</Text>
                              <Text style={[s.col, s.colNum]}>{row.goals_for ?? 0}</Text>
                              <Text style={[s.col, s.colNum]}>{row.goals_against ?? 0}</Text>
                              <Text style={[s.col, s.colNum]}>{row.goal_diff ?? 0}</Text>
                              <Text style={[s.col, s.colPts, s.pts]}>{row.points ?? 0}</Text>
                            </View>
                          );
                        })
                    }
                    <Text style={s.legend}>🟢 Clasifican a la siguiente ronda</Text>
                  </View>
                </View>
              )}
            </>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

// ── Banner VER EN VIVO ────────────────────────────────────────
function LiveBanner() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  return (
    <TouchableOpacity style={s.liveBanner} onPress={() => Linking.openURL(LIVE_URL)} activeOpacity={0.82}>
      <Animated.View style={[s.liveBannerPulse, { transform: [{ scale: pulse }] }]}>
        <View style={s.liveBannerDot} />
      </Animated.View>
      <View style={s.liveBannerText}>
        <Text style={s.liveBannerTitle}>VER PARTIDO EN VIVO</Text>
        <Text style={s.liveBannerSub}>Toca aquí · transmisión gratuita</Text>
      </View>
      <Text style={s.liveBannerArrow}>▶</Text>
    </TouchableOpacity>
  );
}

// ── Tarjeta de partido ────────────────────────────────────────
function MatchCard({ m, goalsOpen, onToggle }) {
  const isLive     = m.status === 'live';
  const isFinished = m.status === 'finished';
  const isOff      = m.status === 'postponed' || m.status === 'cancelled';

  let sh = null, sa = null;
  if (isFinished) { sh = m.score_home; sa = m.score_away; }
  else if (isLive) { sh = m.live?.api_score_home ?? 0; sa = m.live?.api_score_away ?? 0; }
  const hasScore = sh != null && sa != null;
  const showPens = isFinished && m.went_to_penalties && m.penalties_home != null;
  const hasGoals = (m.goals?.length ?? 0) > 0;
  const phaseLabel = m.phase === 'group' ? `Grupo ${m.group_letter}` : phaseStr(m.phase);

  return (
    <View style={[s.card, isLive && s.cardLive]}>
      <View style={s.matchRow}>
        <View style={[s.side, s.sideHome]}>
          <Text style={[s.teamCode, isFinished && sh < sa && s.teamLost]} numberOfLines={1}>
            {teamLabel(m.home, m.home_placeholder)}
          </Text>
          <Flag code={m.home?.code} />
        </View>

        <View style={s.center}>
          <Text style={s.phaseLbl}>{phaseLabel}</Text>
          {hasScore
            ? <Text style={[s.score, isLive && s.scoreLive]}>{sh} – {sa}</Text>
            : isOff
              ? <Text style={s.vs}>—</Text>
              : <Text style={s.time}>{paTimeStr(m.scheduled_at)}</Text>
          }
          {showPens && <Text style={s.pens}>pen {m.penalties_home}–{m.penalties_away}</Text>}
          <StatusTag status={m.status} />
        </View>

        <View style={[s.side, s.sideAway]}>
          <Flag code={m.away?.code} />
          <Text style={[s.teamCode, isFinished && sa < sh && s.teamLost]} numberOfLines={1}>
            {teamLabel(m.away, m.away_placeholder)}
          </Text>
        </View>
      </View>

      {(isLive || isFinished) && hasGoals && (
        <TouchableOpacity style={s.goalsToggle} onPress={onToggle} activeOpacity={0.7}>
          <Text style={s.goalsToggleText}>
            {goalsOpen ? '▲ Ocultar goles' : `⚽ Ver goles (${m.goals.length})`}
          </Text>
        </TouchableOpacity>
      )}
      {goalsOpen && m.goals.map((g, i) => <GoalRow key={i} goal={g} />)}
    </View>
  );
}

function GoalRow({ goal }) {
  const isOG  = (goal.detail ?? '').toLowerCase().includes('own');
  const isPen = (goal.detail ?? '').toLowerCase().includes('penalty');
  return (
    <View style={s.goalRow}>
      <Text style={s.goalMin}>{goal.minute}'</Text>
      <Text style={s.goalIcon}>{isOG ? '🥅' : '⚽'}</Text>
      <Text style={s.goalName} numberOfLines={1}>{goal.player}{isPen ? ' (pen)' : ''}{isOG ? ' (pp)' : ''}</Text>
      <Text style={s.goalTeam} numberOfLines={1}>{goal.team}</Text>
    </View>
  );
}

function StatusTag({ status }) {
  if (status === 'live')      return <Text style={[s.tag, s.tagLive]}>EN VIVO</Text>;
  if (status === 'finished')  return <Text style={[s.tag, s.tagFinal]}>FINAL</Text>;
  if (status === 'postponed') return <Text style={[s.tag, s.tagOff]}>APLAZADO</Text>;
  if (status === 'cancelled') return <Text style={[s.tag, s.tagOff]}>CANCELADO</Text>;
  return <Text style={[s.tag, s.tagSched]}>PENDIENTE</Text>;
}

const RED  = COLORS.red2   ?? '#FF3B1F';
const NEON = COLORS.neon   ?? '#B8FF00';
const LINE = COLORS.line   ?? '#2A323F';
const GRAY = COLORS.gray   ?? '#7F8794';
const GRAY2= COLORS.gray2  ?? '#7F8794';
const BG2  = COLORS.bg2    ?? '#0A0E14';
const CARD = COLORS.card   ?? '#11151C';

const s = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    gap: SPACING.sm, borderBottomWidth: 1, borderBottomColor: LINE,
  },
  back:        { paddingRight: SPACING.xs },
  backText:    { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, lineHeight: 32 },
  headerLogo:  { width: 28, height: 28, borderRadius: 5 },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1.5, flex: 1 },

  // Banner VER EN VIVO
  liveBanner: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SPACING.md, marginTop: SPACING.md, marginBottom: SPACING.xs,
    backgroundColor: RED + '18',
    borderWidth: 1.5, borderColor: RED,
    borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 13,
    gap: SPACING.sm,
    shadowColor: RED, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  liveBannerPulse: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: RED + '35', justifyContent: 'center', alignItems: 'center',
  },
  liveBannerDot:   { width: 10, height: 10, borderRadius: 5, backgroundColor: RED },
  liveBannerText:  { flex: 1 },
  liveBannerTitle: { fontFamily: FONTS.heading, fontSize: 18, color: RED, letterSpacing: 2 },
  liveBannerSub:   { fontFamily: FONTS.body, fontSize: 11, color: RED + 'AA', marginTop: 2 },
  liveBannerArrow: { fontFamily: FONTS.heading, fontSize: 22, color: RED },

  // Pestañas principales HOY / PRÓXIMOS / GRUPOS
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: LINE,
    marginTop: SPACING.sm,
  },
  tab: {
    flex: 1, alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabActive:      { borderBottomColor: NEON },
  tabText:        { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 12, color: GRAY2, letterSpacing: 1.2 },
  tabTextActive:  { color: NEON },

  // Sección HOY
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 2 },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: RED + '22', borderColor: RED, borderWidth: 1,
    borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2,
  },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: RED },
  liveChipText: { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 9, color: RED, letterSpacing: 1 },

  // Tarjeta de partido
  card: {
    backgroundColor: BG2, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: LINE + '88',
  },
  cardLive: { backgroundColor: RED + '0A' },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  side:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sideHome: { justifyContent: 'flex-end' },
  sideAway: { justifyContent: 'flex-start' },
  teamCode: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.white, letterSpacing: 1 },
  teamLost: { color: GRAY },
  flag: { borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: LINE },
  center: { minWidth: 92, alignItems: 'center', paddingHorizontal: SPACING.sm },
  phaseLbl: { fontFamily: FONTS.body, fontSize: 9, color: GRAY, letterSpacing: 1, marginBottom: 2 },
  score:     { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 1 },
  scoreLive: { color: NEON },
  time:      { fontFamily: FONTS.heading, fontSize: 18, color: GRAY2, letterSpacing: 1 },
  vs:        { fontFamily: FONTS.heading, fontSize: 18, color: GRAY, letterSpacing: 1 },
  pens:      { fontFamily: FONTS.body, fontSize: 10, color: GRAY2, marginTop: 1 },
  tag: { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 9, letterSpacing: 1.2, marginTop: 3 },
  tagLive:  { color: RED },
  tagFinal: { color: GRAY2 },
  tagSched: { color: NEON },
  tagOff:   { color: COLORS.gold ?? '#FFD700' },
  goalsToggle: { paddingTop: SPACING.xs, alignItems: 'center' },
  goalsToggleText: { fontFamily: FONTS.body, fontSize: 11, color: GRAY2 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2, paddingLeft: SPACING.sm },
  goalMin:  { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 11, color: NEON, width: 30 },
  goalIcon: { fontSize: 12 },
  goalName: { flex: 1, fontFamily: FONTS.body, fontSize: 12, color: COLORS.white },
  goalTeam: { fontFamily: FONTS.body, fontSize: 11, color: GRAY2, maxWidth: 90 },

  // Próximos — encabezado de día
  dayHeader: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2,
    backgroundColor: COLORS.bg ?? '#07080B',
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  dayLabel: {
    fontFamily: FONTS.heading, fontSize: 13, color: GRAY2, letterSpacing: 2,
  },

  // Tabs de grupo (pestaña GRUPOS)
  groupTabsRow: {
    height: 38, borderBottomWidth: 1, borderBottomColor: LINE,
    marginTop: SPACING.sm,
  },
  groupTabsContent: { alignItems: 'center', paddingHorizontal: SPACING.sm, gap: 4 },
  groupTab: {
    height: 28, paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm, justifyContent: 'center', alignItems: 'center',
  },
  groupTabActive:     { backgroundColor: NEON },
  groupTabText:       { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 11, color: GRAY2, letterSpacing: 1 },
  groupTabTextActive: { color: COLORS.bg ?? '#07080B' },

  // Tabla
  table: { marginHorizontal: SPACING.md, marginTop: SPACING.sm },
  tableRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  tableHead:   { marginBottom: 2 },
  tableRowAlt: { backgroundColor: CARD + '60' },
  tableRowQ:   { borderLeftWidth: 3, borderLeftColor: NEON, paddingLeft: 3 },
  col:     { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white, textAlign: 'center' },
  colPos:  { width: 18, textAlign: 'center', fontFamily: FONTS.bodyBold ?? FONTS.body, color: GRAY2 },
  posQ:    { color: NEON },
  colTeam: { flex: 1, textAlign: 'left', paddingHorizontal: 3 },
  colNum:  { width: 24, textAlign: 'center', color: GRAY2 },
  colPts:  { width: 28, textAlign: 'center' },
  pts:     { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white },
  teamName: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white, flex: 1 },
  legend: { fontFamily: FONTS.body, fontSize: 10, color: GRAY, textAlign: 'center', marginTop: SPACING.md, marginBottom: SPACING.sm },

  empty: { fontFamily: FONTS.body, color: GRAY, textAlign: 'center', marginTop: 40, fontSize: 13, marginHorizontal: SPACING.md },
});
