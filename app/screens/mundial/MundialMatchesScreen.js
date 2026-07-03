// ============================================================
// MundialMatchesScreen — Juegos del Mundial 2026
// Muestra partidos pasados/hoy/próximos agrupados por día,
// marcadores, goles y acceso al stream en vivo.
// ============================================================
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';

const mundialLogo = require('../../../assets/mundial/mundial-logo.png');
const LIVE_URL    = 'https://futbol-libres.su/';
const PA_OFFSET   = 5 * 3600 * 1000; // UTC-5
const REFRESH_MS  = 45000;
const MESES       = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS        = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

function tsMs(ts) {
  if (!ts) return 0;
  let s = String(ts).replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  const ms = new Date(s).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
function paDate(ts) {
  return new Date(tsMs(ts) - PA_OFFSET);
}
function paTimeStr(ts) {
  const d = paDate(ts);
  let h = d.getUTCHours(), m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
}
function dayKey(ts) {
  const d = paDate(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
function dayLabel(key) {
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  const todayKey = dayKey(new Date(Date.now()).toISOString());
  if (key === todayKey) return 'HOY';
  return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m-1]}`;
}

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
function Flag({ code }) {
  const uri = flagUri(code);
  if (!uri) return null;
  return <Image source={{ uri }} style={s.flag} resizeMode="cover" accessibilityIgnoresInvertColors />;
}
function teamLabel(team, ph) { return team?.code || team?.name_es || team?.name || ph || '—'; }

// Extrae goles de api_raw.events (formato api-football v3).
function parseGoals(apiRaw) {
  if (!apiRaw) return [];
  const events = apiRaw?.events ?? apiRaw?.response?.[0]?.events ?? [];
  return events
    .filter(e => e?.type === 'Goal')
    .map(e => ({
      minute: e?.time?.elapsed ?? '?',
      player: e?.player?.name ?? '?',
      team:   e?.team?.name ?? '',
      detail: e?.detail ?? '',
    }));
}

export default function MundialMatchesScreen({ navigation }) {
  const [groups, setGroups]     = useState([]);   // [{day, matches:[]}]
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState({});   // { matchId: true }

  const load = useCallback(async () => {
    try {
      // Traer los próximos 14 días de hoy hacia adelante + últimos 3 días
      const from = new Date(Date.now() - 3 * 86400000).toISOString();
      const { data: rows, error } = await supabase
        .from('wc_matches')
        .select('id, scheduled_at, status, score_home, score_away, penalties_home, penalties_away, went_to_penalties, phase, group_letter, home_placeholder, away_placeholder, team_home_id, team_away_id')
        .gte('scheduled_at', from)
        .order('scheduled_at')
        .limit(80);
      if (error) throw error;

      const all = rows ?? [];
      const teamIds = [...new Set(all.flatMap(r => [r.team_home_id, r.team_away_id]).filter(Boolean))];
      const matchIds = all.map(r => r.id);

      const [teamsRes, resultsRes] = await Promise.all([
        teamIds.length
          ? supabase.from('wc_teams').select('id, code, name_es, name').in('id', teamIds)
          : Promise.resolve({ data: [] }),
        matchIds.length
          ? supabase.from('wc_results').select('match_id, api_score_home, api_score_away, api_raw').in('match_id', matchIds)
          : Promise.resolve({ data: [] }),
      ]);

      const teamMap = (teamsRes.data ?? []).reduce((a, t) => { a[t.id] = t; return a; }, {});
      const resMap  = (resultsRes.data ?? []).reduce((a, r) => { a[r.match_id] = r; return a; }, {});

      const hydrated = all.map(r => ({
        ...r,
        home:  teamMap[r.team_home_id] ?? null,
        away:  teamMap[r.team_away_id] ?? null,
        live:  resMap[r.id] ?? null,
        goals: parseGoals(resMap[r.id]?.api_raw),
      }));

      // Agrupar por día
      const dayMap = {};
      for (const m of hydrated) {
        const key = dayKey(m.scheduled_at);
        if (!dayMap[key]) dayMap[key] = [];
        dayMap[key].push(m);
      }
      const sorted = Object.keys(dayMap).sort().map(day => ({ day, matches: dayMap[day] }));
      setGroups(sorted);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const toggleGoals = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const todayKey = dayKey(new Date().toISOString());

  return (
    <MundialScreenFrame>
      <SafeAreaView style={s.safe} edges={['top']}>
        {/* Header */}
        <View style={s.header} dataSet={{ t2Rise: '1' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
            <Text style={s.backText}>‹</Text>
          </TouchableOpacity>
          <Image source={mundialLogo} style={s.headerLogo} resizeMode="contain" />
          <Text style={s.headerTitle}>JUEGOS</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={s.liveBtn}
            onPress={() => Linking.openURL(LIVE_URL)}
            activeOpacity={0.85}
          >
            <View style={s.liveDot} />
            <Text style={s.liveBtnText}>EN VIVO</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} colors={[COLORS.neon]} />}
        >
          {loading && groups.length === 0 ? (
            <ActivityIndicator color={COLORS.neon} style={{ marginTop: 48 }} />
          ) : groups.length === 0 ? (
            <Text style={s.empty}>Sin partidos disponibles</Text>
          ) : (
            groups.map(({ day, matches }, gi) => (
              <View key={day} dataSet={gi < 2 ? { t2Rise: String(gi + 2) } : undefined}>
                <View style={[s.dayHeader, day === todayKey && s.dayHeaderToday]}>
                  <Text style={[s.dayLabel, day === todayKey && s.dayLabelToday]}>{dayLabel(day)}</Text>
                </View>
                {matches.map((m, i) => (
                  <MatchCard
                    key={m.id}
                    m={m}
                    last={i === matches.length - 1}
                    goalsOpen={!!expanded[m.id]}
                    onToggleGoals={() => toggleGoals(m.id)}
                  />
                ))}
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

function MatchCard({ m, last, goalsOpen, onToggleGoals }) {
  const isLive     = m.status === 'live';
  const isFinished = m.status === 'finished';
  const isOff      = m.status === 'postponed' || m.status === 'cancelled';

  let sh = null, sa = null;
  if (isFinished) { sh = m.score_home; sa = m.score_away; }
  else if (isLive) { sh = m.live?.api_score_home ?? 0; sa = m.live?.api_score_away ?? 0; }
  const hasScore   = sh != null && sa != null;
  const showPens   = isFinished && m.went_to_penalties && m.penalties_home != null;
  const hasGoals   = m.goals?.length > 0;
  const phaseLabel = m.phase === 'group' ? `Grupo ${m.group_letter}` : phaseStr(m.phase);

  return (
    <View
      style={[s.card, !last && s.cardDivider, isLive && s.cardLive]}
      dataSet={isLive ? { t2Glass: '', t2Glow: 'mid' } : { t2Glass: '' }}
    >
      <View style={s.matchRow}>
        {/* Home */}
        <View style={[s.side, s.sideHome]}>
          <Text style={[s.teamCode, isFinished && sh < sa && s.teamLost]} numberOfLines={1}>
            {teamLabel(m.home, m.home_placeholder)}
          </Text>
          <Flag code={m.home?.code} />
        </View>

        {/* Center */}
        <View style={s.center}>
          <Text style={s.phaseLbl}>{phaseLabel}</Text>
          {hasScore ? (
            <Text style={[s.score, isLive && s.scoreLive]}>{sh} – {sa}</Text>
          ) : isOff ? (
            <Text style={s.vs}>—</Text>
          ) : (
            <Text style={s.time}>{paTimeStr(m.scheduled_at)}</Text>
          )}
          {showPens && <Text style={s.pens}>pen {m.penalties_home}–{m.penalties_away}</Text>}
          <StatusTag status={m.status} />
        </View>

        {/* Away */}
        <View style={[s.side, s.sideAway]}>
          <Flag code={m.away?.code} />
          <Text style={[s.teamCode, isFinished && sa < sh && s.teamLost]} numberOfLines={1}>
            {teamLabel(m.away, m.away_placeholder)}
          </Text>
        </View>
      </View>

      {/* Goles — solo si el partido terminó y hay datos */}
      {isFinished && hasGoals && (
        <TouchableOpacity style={s.goalsToggle} onPress={onToggleGoals} activeOpacity={0.7}>
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
  const isOG = (goal.detail ?? '').toLowerCase().includes('own');
  const isPen = (goal.detail ?? '').toLowerCase().includes('penalty');
  return (
    <View style={s.goalRow}>
      <Text style={s.goalMin}>{goal.minute}'</Text>
      <Text style={s.goalIcon}>{isOG ? '🥅' : isPen ? '⚽ pen' : '⚽'}</Text>
      <Text style={s.goalName} numberOfLines={1}>{goal.player}</Text>
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

function phaseStr(phase) {
  const map = { group:'Grupos', round_32:'Ronda de 32', round_16:'Octavos', quarter:'Cuartos', semi:'Semis', third_place:'3er Lugar', final:'Final' };
  return map[phase] ?? phase;
}

const s = StyleSheet.create({
  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line ?? '#2A323F',
  },
  back: { paddingRight: SPACING.xs },
  backText: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, lineHeight: 32 },
  headerLogo: { width: 28, height: 28, borderRadius: 5 },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  liveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: (COLORS.red2 ?? '#FF3B1F') + '22',
    borderColor: COLORS.red2 ?? '#FF3B1F', borderWidth: 1,
    borderRadius: RADIUS.full ?? 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.red2 ?? '#FF3B1F' },
  liveBtnText: { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 10, color: COLORS.red2 ?? '#FF3B1F', letterSpacing: 1.2 },

  dayHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    backgroundColor: COLORS.bg ?? '#07080B',
  },
  dayHeaderToday: { backgroundColor: (COLORS.neon ?? '#B8FF00') + '18' },
  dayLabel: {
    fontFamily: FONTS.heading, fontSize: 13, color: COLORS.gray2 ?? COLORS.gray,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  dayLabelToday: { color: COLORS.neon ?? '#B8FF00' },

  card: {
    backgroundColor: COLORS.bg2 ?? '#0A0E14',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  cardDivider: { borderBottomWidth: 1, borderBottomColor: (COLORS.line ?? '#2A323F') + '88' },
  cardLive: { backgroundColor: (COLORS.red2 ?? '#FF3B1F') + '0A' },

  matchRow: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sideHome: { justifyContent: 'flex-end' },
  sideAway: { justifyContent: 'flex-start' },
  teamCode: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.white, letterSpacing: 1.2 },
  teamLost: { color: COLORS.gray ?? '#7F8794' },
  flag: { width: 26, height: 18, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.line, backgroundColor: COLORS.card },

  center: { minWidth: 96, alignItems: 'center', paddingHorizontal: SPACING.sm },
  phaseLbl: { fontFamily: FONTS.body, fontSize: 9, color: COLORS.gray ?? '#7F8794', letterSpacing: 1, marginBottom: 2 },
  score: { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 1 },
  scoreLive: { color: COLORS.neon ?? '#B8FF00' },
  time: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray2 ?? COLORS.gray, letterSpacing: 1 },
  vs: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray, letterSpacing: 1 },
  pens: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray2, marginTop: 1 },
  tag: { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 9, letterSpacing: 1.2, marginTop: 3, textTransform: 'uppercase' },
  tagLive: { color: COLORS.red2 ?? '#FF3B1F' },
  tagFinal: { color: COLORS.gray2 ?? COLORS.gray },
  tagSched: { color: COLORS.neon ?? '#B8FF00' },
  tagOff: { color: COLORS.gold ?? '#FFD700' },

  goalsToggle: { paddingTop: SPACING.xs, paddingBottom: 2, alignItems: 'center' },
  goalsToggleText: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 ?? COLORS.gray, letterSpacing: 0.5 },

  goalRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 2, paddingLeft: SPACING.sm },
  goalMin:  { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 11, color: COLORS.neon ?? '#B8FF00', width: 30 },
  goalIcon: { fontSize: 12 },
  goalName: { flex: 1, fontFamily: FONTS.body, fontSize: 12, color: COLORS.white },
  goalTeam: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, maxWidth: 90 },

  empty: { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', marginTop: 48, fontSize: 14 },
});
