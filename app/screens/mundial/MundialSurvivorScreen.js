import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';

const TABS = ['Pick', 'Historial', 'Ranking'];

export default function MundialSurvivorScreen({ navigation }) {
  const { user } = useAuthStore();
  const [enrollment, setEnrollment] = useState(null);
  const [nextDay, setNextDay] = useState(null);
  const [matchesOfDay, setMatchesOfDay] = useState([]);
  const [teamsAvailable, setTeamsAvailable] = useState([]);
  const [teamUsage, setTeamUsage] = useState({});
  const [currentPick, setCurrentPick] = useState(null);
  const [history, setHistory] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [tab, setTab] = useState('Pick');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) Enrollment
      const { data: e } = await supabase
        .from('wc_enrollments')
        .select('*')
        .eq('user_id', user.id)
        .eq('mode', 'survivor')
        .maybeSingle();
      setEnrollment(e);

      if (!e || e.payment_status !== 'paid') {
        setLoading(false);
        return;
      }

      // 2) Próxima jornada-día con phase=group sin settled
      const nowIso = new Date().toISOString();
      const { data: days } = await supabase
        .from('wc_match_days')
        .select('*')
        .eq('phase', 'group')
        .eq('is_settled', false)
        .gte('pick_deadline', nowIso)
        .order('date')
        .limit(1);
      const day = days?.[0];
      setNextDay(day);

      if (day) {
        // 3) Matches del día
        const { data: m } = await supabase
          .from('wc_matches')
          .select(`
            id, match_number, scheduled_at, group_letter,
            team_home:team_home_id ( id, code, name_es, group_letter ),
            team_away:team_away_id ( id, code, name_es, group_letter )
          `)
          .eq('match_day_id', day.id)
          .order('scheduled_at');
        setMatchesOfDay(m ?? []);

        // 4) Equipos disponibles del día (únicos)
        const tSet = new Map();
        (m ?? []).forEach(mt => {
          if (mt.team_home) tSet.set(mt.team_home.id, mt.team_home);
          if (mt.team_away) tSet.set(mt.team_away.id, mt.team_away);
        });
        setTeamsAvailable(Array.from(tSet.values()));

        // 5) Pick actual del día
        const { data: pk } = await supabase
          .from('wc_picks')
          .select('*')
          .eq('enrollment_id', e.id)
          .eq('match_day_id', day.id)
          .maybeSingle();
        setCurrentPick(pk);
      }

      // 6) Conteo de usos por team (para el badge)
      const { data: picks } = await supabase
        .from('wc_picks')
        .select('team_id, match_day_id, result, life_lost')
        .eq('enrollment_id', e.id);
      const usage = {};
      (picks ?? []).forEach(p => {
        usage[p.team_id] = (usage[p.team_id] ?? 0) + 1;
      });
      setTeamUsage(usage);

      // 7) Historial: todos los picks resueltos
      const { data: hist } = await supabase
        .from('wc_picks')
        .select(`
          id, result, life_lost, resolved_at,
          team:team_id (code, name_es),
          day:match_day_id (date, phase)
        `)
        .eq('enrollment_id', e.id)
        .not('resolved_at', 'is', null)
        .order('resolved_at', { ascending: false });
      setHistory(hist ?? []);

      // 8) Ranking top 30
      const { data: rnk } = await supabase
        .from('wc_enrollments')
        .select('id, user_id, lives_remaining, eliminated_at, users(nombre, foto_url)')
        .eq('mode', 'survivor')
        .eq('payment_status', 'paid')
        .order('lives_remaining', { ascending: false })
        .limit(30);
      setRanking(rnk ?? []);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const submitPick = async (teamId) => {
    if (saving) return;
    if (!nextDay) return;
    const uses = teamUsage[teamId] ?? 0;
    const isChange = currentPick?.team_id === teamId;
    if (!isChange && uses >= 2) {
      Alert.alert('Equipo agotado', 'Ya usaste este equipo 2 veces (máximo).');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('wc_submit_survivor_pick', {
        p_user_id: user.id,
        p_match_day_id: nextDay.id,
        p_team_id: teamId,
      });
      if (error) throw error;
      await load();
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo guardar el pick.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color={COLORS.neon} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // No inscrito
  if (!enrollment || enrollment.payment_status !== 'paid') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.notEnrolled}>
          <Text style={styles.notEnrolledTitle}>No estás inscrito al Survivor</Text>
          <Text style={styles.notEnrolledText}>
            Inscribite para empezar a participar.
          </Text>
          <TouchableOpacity
            style={styles.enrollBtn}
            onPress={() => navigation.navigate('MundialEnroll', { mode: 'survivor' })}
          >
            <Text style={styles.enrollBtnText}>INSCRIBIRME · $10</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const lives = enrollment.lives_remaining;
  const eliminated = lives <= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} />}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backLink}>← Volver</Text>
        </TouchableOpacity>

        {/* Header con vidas */}
        <View style={styles.livesCard}>
          <Text style={styles.livesLabel}>VIDAS RESTANTES</Text>
          <View style={styles.livesRow}>
            {[0, 1, 2].map((i) => (
              <Text key={i} style={[styles.heart, i < lives && styles.heartActive]}>
                ♥
              </Text>
            ))}
          </View>
          {eliminated && (
            <Text style={styles.eliminatedText}>ELIMINADO</Text>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'Pick' && (
          <View>
            {!nextDay ? (
              <View style={styles.noDayCard}>
                <Text style={styles.noDayText}>
                  No hay próxima jornada disponible o todas las jornadas de grupos
                  ya cerraron.
                </Text>
              </View>
            ) : eliminated ? (
              <View style={styles.noDayCard}>
                <Text style={styles.noDayText}>
                  Ya no podés hacer picks. Llegaste hasta acá. El premio se
                  reparte al final entre los que sobrevivan más.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.dayInfo}>
                  <Text style={styles.dayDate}>
                    {new Date(nextDay.date).toLocaleDateString('es-PA', {
                      weekday: 'long', day: '2-digit', month: 'long',
                    }).toUpperCase()}
                  </Text>
                  <Text style={styles.deadline}>
                    Cierra: {new Date(nextDay.pick_deadline).toLocaleString('es-PA', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </Text>
                </View>

                {currentPick && (
                  <View style={styles.currentPickCard}>
                    <Text style={styles.currentPickLabel}>Tu pick actual</Text>
                    <Text style={styles.currentPickTeam}>
                      {teamsAvailable.find(t => t.id === currentPick.team_id)?.name_es ?? '—'}
                    </Text>
                  </View>
                )}

                <Text style={styles.sectionTitle}>Partidos del día</Text>
                {matchesOfDay.map((m) => (
                  <View key={m.id} style={styles.matchCard}>
                    <Text style={styles.matchPhase}>
                      Grupo {m.group_letter} · {new Date(m.scheduled_at).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <View style={styles.matchTeams}>
                      <TeamButton
                        team={m.team_home}
                        usage={teamUsage[m.team_home?.id] ?? 0}
                        selected={currentPick?.team_id === m.team_home?.id}
                        onPress={() => submitPick(m.team_home.id)}
                        disabled={saving}
                      />
                      <Text style={styles.vsLabel}>VS</Text>
                      <TeamButton
                        team={m.team_away}
                        usage={teamUsage[m.team_away?.id] ?? 0}
                        selected={currentPick?.team_id === m.team_away?.id}
                        onPress={() => submitPick(m.team_away.id)}
                        disabled={saving}
                      />
                    </View>
                  </View>
                ))}

                <Text style={styles.ruleNote}>
                  ⚠️ Cada equipo se puede usar máximo 2 veces. Si no hacés pick, perdés
                  una vida.
                </Text>
              </>
            )}
          </View>
        )}

        {tab === 'Historial' && (
          <View>
            <Text style={styles.sectionTitle}>Mis picks resueltos</Text>
            {history.length === 0 && (
              <Text style={styles.emptyText}>Todavía no hay picks resueltos.</Text>
            )}
            {history.map((h) => (
              <View key={h.id} style={[
                styles.historyRow,
                h.result === 'won' && { borderLeftColor: COLORS.green },
                h.result === 'draw' && { borderLeftColor: COLORS.gold },
                (h.result === 'lost' || h.result === 'no_pick') && { borderLeftColor: COLORS.red },
              ]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyTeam}>
                    {h.team?.name_es ?? '—'}
                  </Text>
                  <Text style={styles.historyDate}>
                    {new Date(h.day?.date).toLocaleDateString('es-PA')}
                  </Text>
                </View>
                <Text style={[
                  styles.historyResult,
                  h.result === 'won'  && { color: COLORS.green },
                  h.result === 'draw' && { color: COLORS.gold },
                  (h.result === 'lost' || h.result === 'no_pick') && { color: COLORS.red2 },
                ]}>
                  {h.result === 'won' ? 'GANÓ' :
                   h.result === 'draw' ? 'EMPATE' :
                   h.result === 'lost' ? 'PERDIÓ' :
                   h.result === 'no_pick' ? 'NO PICK' : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {tab === 'Ranking' && (
          <View>
            <Text style={styles.sectionTitle}>Top 30 sobrevivientes</Text>
            {ranking.map((r, i) => (
              <View key={r.id} style={styles.rankRow}>
                <Text style={styles.rankPos}>#{i + 1}</Text>
                <Text style={styles.rankName} numberOfLines={1}>
                  {r.users?.nombre ?? 'Anónimo'}{r.user_id === user.id && ' (vos)'}
                </Text>
                <View style={styles.rankLives}>
                  {[0, 1, 2].map((j) => (
                    <Text key={j} style={[styles.heartSmall, j < r.lives_remaining && styles.heartActive]}>♥</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TeamButton({ team, usage, selected, onPress, disabled }) {
  if (!team) return <View style={styles.teamBtn}><Text style={styles.teamBtnEmpty}>—</Text></View>;
  const capped = usage >= 2 && !selected;
  return (
    <TouchableOpacity
      style={[
        styles.teamBtn,
        selected && styles.teamBtnSelected,
        capped && styles.teamBtnCapped,
      ]}
      onPress={onPress}
      disabled={disabled || capped}
    >
      <Text style={[styles.teamBtnCode, selected && { color: COLORS.bg }]}>{team.code}</Text>
      <Text style={[styles.teamBtnName, selected && { color: COLORS.bg }]} numberOfLines={1}>
        {team.name_es}
      </Text>
      <Text style={[styles.teamBtnUsage, selected && { color: COLORS.bg }]}>
        Usado {usage}/2
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  back: { paddingVertical: 4, marginBottom: SPACING.sm },
  backLink: { color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 14 },

  notEnrolled: {
    padding: SPACING.lg, marginTop: 40, alignItems: 'center',
  },
  notEnrolledTitle: {
    fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white,
    letterSpacing: 1, textAlign: 'center',
  },
  notEnrolledText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', marginTop: 8, marginBottom: SPACING.lg,
  },
  enrollBtn: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.md,
    paddingVertical: 14, paddingHorizontal: 32, ...SHADOWS.glow,
  },
  enrollBtnText: {
    color: COLORS.white, fontFamily: FONTS.heading, fontSize: 16, letterSpacing: 2,
  },

  livesCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    borderColor: COLORS.line, borderWidth: 1,
    marginBottom: SPACING.lg, ...SHADOWS.card,
  },
  livesLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
  },
  livesRow: { flexDirection: 'row', gap: 12 },
  heart: { fontSize: 48, color: COLORS.line },
  heartActive: { color: COLORS.red2 },
  eliminatedText: {
    fontFamily: FONTS.heading, fontSize: 20, color: COLORS.red2,
    letterSpacing: 3, marginTop: 8,
  },

  tabRow: { flexDirection: 'row', marginBottom: SPACING.md, gap: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: RADIUS.sm, backgroundColor: COLORS.card2,
    borderColor: COLORS.line, borderWidth: 1,
  },
  tabBtnActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  tabText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2, letterSpacing: 1 },
  tabTextActive: { color: COLORS.white },

  noDayCard: {
    backgroundColor: COLORS.card2, borderRadius: RADIUS.md,
    padding: SPACING.lg, alignItems: 'center',
    borderColor: COLORS.line, borderWidth: 1,
  },
  noDayText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 20,
  },

  dayInfo: { alignItems: 'center', marginBottom: SPACING.md },
  dayDate: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white,
    letterSpacing: 1.5,
  },
  deadline: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gold, marginTop: 4,
  },

  currentPickCard: {
    backgroundColor: COLORS.neon + '14', borderColor: COLORS.neon + '88',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  currentPickLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  currentPickTeam: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white,
    letterSpacing: 1, marginTop: 4,
  },

  sectionTitle: {
    fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white,
    letterSpacing: 1, marginVertical: SPACING.sm,
  },
  matchCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.sm, marginBottom: SPACING.sm,
    borderColor: COLORS.line, borderWidth: 1,
  },
  matchPhase: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2,
    marginBottom: SPACING.sm,
  },
  matchTeams: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamBtn: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 8,
    backgroundColor: COLORS.card2, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1,
    alignItems: 'center',
  },
  teamBtnSelected: { backgroundColor: COLORS.neon, borderColor: COLORS.neon },
  teamBtnCapped: { opacity: 0.4 },
  teamBtnCode: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.neon, letterSpacing: 1,
  },
  teamBtnName: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white,
    textAlign: 'center', marginTop: 2,
  },
  teamBtnUsage: {
    fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: 2,
  },
  teamBtnEmpty: { color: COLORS.gray, fontSize: 12 },
  vsLabel: {
    fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray, letterSpacing: 1,
  },

  ruleNote: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gold,
    textAlign: 'center', marginTop: SPACING.md, lineHeight: 16,
  },

  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card2, borderRadius: RADIUS.sm,
    padding: SPACING.sm, marginBottom: 6,
    borderLeftWidth: 4, borderLeftColor: COLORS.line,
  },
  historyTeam: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  historyDate: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  historyResult: {
    fontFamily: FONTS.heading, fontSize: 13, color: COLORS.gray2,
    letterSpacing: 1,
  },

  rankRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  rankPos:  { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray2, width: 40 },
  rankName: { flex: 1, fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  rankLives: { flexDirection: 'row', gap: 4 },
  heartSmall: { fontSize: 14, color: COLORS.line },
  emptyText: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray,
    textAlign: 'center', marginTop: SPACING.lg,
  },
});
