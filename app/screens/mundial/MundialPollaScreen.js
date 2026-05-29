import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';

const TABS = ['Predicciones', 'Ranking', 'Bonus'];
const PHASE_LABEL = {
  group: 'Grupos', round_32: '16avos', round_16: 'Octavos',
  quarter: 'Cuartos', semi: 'Semis', third_place: '3°', final: 'Final',
};

export default function MundialPollaScreen({ navigation }) {
  const { user } = useAuthStore();
  const { pool, loadPool } = useWcStore();
  const [enrollment, setEnrollment] = useState(null);
  const [matches, setMatches] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [bonus, setBonus] = useState(null);
  const [teamsById, setTeamsById] = useState({});
  const [ranking, setRanking] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [tab, setTab] = useState('Predicciones');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: e } = await supabase
        .from('wc_enrollments')
        .select('*')
        .eq('user_id', user.id)
        .eq('mode', 'polla')
        .maybeSingle();
      setEnrollment(e);

      if (!e || e.payment_status !== 'paid') {
        setLoading(false);
        return;
      }

      // Próximos 40 matches (acepta predicciones)
      const nowIso = new Date().toISOString();
      const { data: m } = await supabase
        .from('wc_matches')
        .select(`
          id, match_number, phase, group_letter, scheduled_at, prediction_deadline,
          status, multiplier, score_home, score_away, home_placeholder, away_placeholder,
          team_home:team_home_id ( code, name_es ),
          team_away:team_away_id ( code, name_es )
        `)
        .order('scheduled_at')
        .limit(60);
      setMatches(m ?? []);

      // Mis predicciones
      const { data: preds } = await supabase
        .from('wc_predictions')
        .select('*')
        .eq('enrollment_id', e.id);
      const predMap = {};
      (preds ?? []).forEach(p => { predMap[p.match_id] = p; });
      setPredictions(predMap);

      // Mis bonus picks
      const { data: bp } = await supabase
        .from('wc_bonus_picks')
        .select('*')
        .eq('enrollment_id', e.id)
        .maybeSingle();
      setBonus(bp);

      // Teams para mostrar bonus picks
      const { data: t } = await supabase.from('wc_teams').select('id, code, name_es');
      setTeamsById(Object.fromEntries((t ?? []).map(x => [x.id, x])));

      // Ranking top 50
      const { data: rnk } = await supabase
        .from('wc_enrollments')
        .select('id, user_id, total_points, bonus_points, match_points, users(nombre, foto_url)')
        .eq('mode', 'polla')
        .eq('payment_status', 'paid')
        .order('total_points', { ascending: false })
        .limit(50);
      setRanking(rnk ?? []);
      const myIdx = (rnk ?? []).findIndex(r => r.user_id === user.id);
      setMyRank(myIdx >= 0 ? myIdx + 1 : null);

      // Total inscritos (para pozo)
      const { count: totalCount } = await supabase
        .from('wc_enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('mode', 'polla')
        .eq('payment_status', 'paid');
      setTotalEnrolled(totalCount ?? 0);

      await loadPool();
    } finally {
      setLoading(false);
    }
  }, [user.id, loadPool]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color={COLORS.neon} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!enrollment || enrollment.payment_status !== 'paid') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.notEnrolled}>
          <Text style={styles.notEnrolledTitle}>No estás inscrito a la Polla</Text>
          <Text style={styles.notEnrolledText}>
            Inscribite y predice los 104 partidos del Mundial.
          </Text>
          <TouchableOpacity
            style={styles.enrollBtn}
            onPress={() => navigation.navigate('MundialEnroll', { mode: 'polla' })}
          >
            <Text style={styles.enrollBtnText}>INSCRIBIRME · $15</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} />}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backLink}>← Volver</Text>
        </TouchableOpacity>

        {/* Pozo + puntos */}
        <View style={styles.pozoCard}>
          <View style={styles.pozoLeft}>
            <Text style={styles.pozoLabel}>POZO ACUMULADO</Text>
            <Text style={styles.pozoValue}>
              ${((totalEnrolled * (pool?.polla_price ?? 15) * (1 - (pool?.fee_rate ?? 0.05))) || 0).toFixed(0)}
            </Text>
            <Text style={styles.pozoMeta}>
              {totalEnrolled} inscritos × ${pool?.polla_price ?? 15}
            </Text>
          </View>
          <View style={styles.pozoRight}>
            <Text style={styles.pozoLabel}>POSICIÓN</Text>
            <Text style={styles.pozoRank}>{myRank ? `#${myRank}` : '—'}</Text>
            <Text style={styles.pozoMeta}>de {totalEnrolled}</Text>
          </View>
        </View>

        <View style={styles.pointsCard}>
          <Text style={styles.pointsLabel}>TUS PUNTOS</Text>
          <Text style={styles.pointsValue}>{enrollment.total_points}</Text>
          <View style={styles.pointsBreak}>
            <Text style={styles.pointsBreakItem}>
              {enrollment.match_points} pts · partidos
            </Text>
            <Text style={styles.pointsBreakItem}>
              {enrollment.bonus_points} pts · bonus
            </Text>
          </View>
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

        {tab === 'Predicciones' && (
          <View>
            {matches.map((m) => (
              <PredictionRow
                key={m.id}
                match={m}
                prediction={predictions[m.id]}
                userId={user.id}
                onSaved={load}
              />
            ))}
          </View>
        )}

        {tab === 'Ranking' && (
          <View>
            <Text style={styles.sectionTitle}>Top 50 de la Polla</Text>
            {ranking.map((r, i) => (
              <View key={r.id} style={[styles.rankRow, r.user_id === user.id && styles.rankRowMe]}>
                <Text style={styles.rankPos}>#{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rankName} numberOfLines={1}>
                    {r.users?.nombre ?? 'Anónimo'}{r.user_id === user.id && ' (vos)'}
                  </Text>
                  <Text style={styles.rankSubtext}>
                    {r.match_points} pts · {r.bonus_points} bonus
                  </Text>
                </View>
                <Text style={styles.rankPts}>{r.total_points}</Text>
              </View>
            ))}
            {ranking.length === 0 && (
              <Text style={styles.emptyText}>Aún no hay puntos calculados.</Text>
            )}
          </View>
        )}

        {tab === 'Bonus' && (
          <View>
            <Text style={styles.sectionTitle}>Tus bonus pre-temporada</Text>
            {!bonus ? (
              <Text style={styles.emptyText}>No tenés bonus picks cargados. Contactá al admin.</Text>
            ) : (
              <View style={styles.bonusViewCard}>
                <BonusViewRow label="🏆 Campeón (50)" value={teamsById[bonus.champion_team_id]?.name_es} correct={bonus.champion_correct} />
                <BonusViewRow label="🥈 Subcampeón (30)" value={teamsById[bonus.runner_up_team_id]?.name_es} correct={bonus.runner_up_correct} />
                <BonusViewRow label="🥉 3er lugar (20)" value={teamsById[bonus.third_place_team_id]?.name_es} correct={bonus.third_place_correct} />
                <BonusViewRow label="⚽ Goleador (25)" value={bonus.top_scorer_name} correct={bonus.top_scorer_correct} />
                <BonusViewRow label="🌟 MVP (15)" value={bonus.mvp_name} correct={bonus.mvp_correct} />
                <View style={styles.bonusFinalRow}>
                  <Text style={styles.bonusViewLabel}>Marcador de la final (tiebreaker)</Text>
                  <Text style={styles.bonusFinalScore}>
                    {bonus.final_score_home} – {bonus.final_score_away}
                  </Text>
                </View>
                <Text style={styles.bonusTotalPoints}>
                  Puntos bonus ganados: {bonus.points_earned}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PredictionRow({ match, prediction, userId, onSaved }) {
  const [home, setHome] = useState(prediction?.pred_score_home != null ? String(prediction.pred_score_home) : '');
  const [away, setAway] = useState(prediction?.pred_score_away != null ? String(prediction.pred_score_away) : '');
  const [saving, setSaving] = useState(false);

  const deadlineMs = new Date(match.prediction_deadline).getTime();
  const closed = deadlineMs <= Date.now() || match.status !== 'scheduled';
  const finished = match.status === 'finished';
  const homeName = match.team_home?.name_es || match.home_placeholder || '—';
  const awayName = match.team_away?.name_es || match.away_placeholder || '—';

  const save = async () => {
    const h = parseInt(home, 10);
    const a = parseInt(away, 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
      Alert.alert('Marcador inválido', 'Números >= 0.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('wc_submit_polla_prediction', {
        p_user_id: userId,
        p_match_id: match.id,
        p_pred_score_home: h,
        p_pred_score_away: a,
      });
      if (error) throw error;
      await onSaved();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[
      styles.predCard,
      finished && styles.predCardFinished,
      prediction?.hit_level === 'exact' && { borderColor: COLORS.green },
      prediction?.hit_level === 'winner_diff' && { borderColor: COLORS.neon },
      prediction?.hit_level === 'winner' && { borderColor: COLORS.gold },
    ]}>
      <View style={styles.predHead}>
        <Text style={styles.predNum}>M{match.match_number}</Text>
        <Text style={styles.predPhase}>
          {PHASE_LABEL[match.phase]}{match.group_letter ? ` ${match.group_letter}` : ''} · x{match.multiplier}
        </Text>
        <Text style={styles.predDate}>
          {new Date(match.scheduled_at).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      <View style={styles.predTeams}>
        <Text style={styles.predTeamName} numberOfLines={1}>{homeName}</Text>
        <View style={styles.predScoreBlock}>
          <TextInput
            style={[styles.predInput, closed && styles.predInputClosed]}
            value={home}
            onChangeText={setHome}
            editable={!closed}
            keyboardType="number-pad"
            placeholder="–"
            placeholderTextColor={COLORS.gray}
            maxLength={2}
          />
          <Text style={styles.predDash}>–</Text>
          <TextInput
            style={[styles.predInput, closed && styles.predInputClosed]}
            value={away}
            onChangeText={setAway}
            editable={!closed}
            keyboardType="number-pad"
            placeholder="–"
            placeholderTextColor={COLORS.gray}
            maxLength={2}
          />
        </View>
        <Text style={styles.predTeamName} numberOfLines={1}>{awayName}</Text>
      </View>

      {finished && (
        <Text style={styles.actualScore}>
          Real: {match.score_home} – {match.score_away}
          {prediction?.hit_level && ` · ${prediction.points_earned} pts (${HIT_LABEL[prediction.hit_level]})`}
        </Text>
      )}

      {!closed && (
        <TouchableOpacity
          style={[styles.predSaveBtn, saving && { opacity: 0.5 }]}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.predSaveBtnText}>
            {saving ? '…' : prediction ? 'Actualizar' : 'Guardar'}
          </Text>
        </TouchableOpacity>
      )}
      {closed && !finished && (
        <Text style={styles.closedText}>Predicciones cerradas — esperando resultado</Text>
      )}
    </View>
  );
}

const HIT_LABEL = {
  exact: '🎯 Marcador exacto',
  winner_diff: '✨ Ganador + diferencia',
  winner: '✓ Ganador',
  miss: '✗ Falló',
};

function BonusViewRow({ label, value, correct }) {
  return (
    <View style={styles.bonusViewRow}>
      <Text style={styles.bonusViewLabel}>{label}</Text>
      <View style={styles.bonusViewVal}>
        <Text style={styles.bonusViewText}>{value ?? '—'}</Text>
        {correct === true && <Text style={styles.bonusOk}>✓</Text>}
        {correct === false && <Text style={styles.bonusFail}>✗</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  back: { paddingVertical: 4, marginBottom: SPACING.sm },
  backLink: { color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 14 },

  notEnrolled: { padding: SPACING.lg, marginTop: 40, alignItems: 'center' },
  notEnrolledTitle: {
    fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white,
    letterSpacing: 1, textAlign: 'center',
  },
  notEnrolledText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', marginTop: 8, marginBottom: SPACING.lg,
  },
  enrollBtn: {
    backgroundColor: COLORS.magenta, borderRadius: RADIUS.md,
    paddingVertical: 14, paddingHorizontal: 32, ...SHADOWS.glow,
  },
  enrollBtnText: {
    color: COLORS.white, fontFamily: FONTS.heading, fontSize: 16, letterSpacing: 2,
  },

  pozoCard: {
    flexDirection: 'row', backgroundColor: COLORS.card,
    borderColor: COLORS.neon + '66', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.sm, ...SHADOWS.card,
  },
  pozoLeft: {
    flex: 1, alignItems: 'flex-start',
    borderRightWidth: 1, borderRightColor: COLORS.line,
    paddingRight: SPACING.md,
  },
  pozoRight: { flex: 1, alignItems: 'center', paddingLeft: SPACING.md },
  pozoLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  pozoValue: {
    fontFamily: FONTS.heading, fontSize: 32, color: COLORS.neon,
    letterSpacing: 1, marginTop: 4,
  },
  pozoRank: {
    fontFamily: FONTS.heading, fontSize: 32, color: COLORS.magenta,
    letterSpacing: 1, marginTop: 4,
  },
  pozoMeta: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 4 },

  pointsCard: {
    backgroundColor: COLORS.card, borderColor: COLORS.magenta + '88',
    borderWidth: 1, borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    marginBottom: SPACING.lg, ...SHADOWS.card,
  },
  pointsLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.magenta,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  pointsValue: {
    fontFamily: FONTS.heading, fontSize: 48, color: COLORS.white,
    letterSpacing: 1, marginVertical: 4,
  },
  pointsBreak: { flexDirection: 'row', gap: 12, marginTop: 4 },
  pointsBreakItem: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },

  tabRow: { flexDirection: 'row', marginBottom: SPACING.md, gap: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: RADIUS.sm, backgroundColor: COLORS.card2,
    borderColor: COLORS.line, borderWidth: 1,
  },
  tabBtnActive: { backgroundColor: COLORS.magenta, borderColor: COLORS.magenta },
  tabText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2, letterSpacing: 1 },
  tabTextActive: { color: COLORS.white },

  predCard: {
    backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  predCardFinished: { opacity: 0.85 },
  predHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  predNum:   { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon },
  predPhase: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  predDate:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  predTeams: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  predTeamName: { flex: 1, fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  predScoreBlock: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  predInput: {
    width: 38, height: 36, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1,
    textAlign: 'center', color: COLORS.white,
    fontFamily: FONTS.heading, fontSize: 18,
    backgroundColor: COLORS.bg,
  },
  predInputClosed: { backgroundColor: COLORS.card2, color: COLORS.gray },
  predDash: { color: COLORS.gray, fontFamily: FONTS.heading, fontSize: 18 },
  predSaveBtn: {
    marginTop: 8, backgroundColor: COLORS.magenta,
    paddingVertical: 8, borderRadius: RADIUS.sm, alignItems: 'center',
  },
  predSaveBtnText: { color: COLORS.white, fontFamily: FONTS.bodyBold, fontSize: 12, letterSpacing: 1 },
  closedText: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gold,
    textAlign: 'center', marginTop: 8, fontStyle: 'italic',
  },
  actualScore: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.neon,
    textAlign: 'center', marginTop: 6,
  },

  sectionTitle: {
    fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white,
    letterSpacing: 1, marginBottom: SPACING.sm,
  },
  rankRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  rankRowMe: { backgroundColor: COLORS.magenta + '12' },
  rankPos:  { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray2, width: 40 },
  rankName: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  rankSubtext: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  rankPts:  { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.neon },

  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, textAlign: 'center', marginTop: SPACING.lg },

  bonusViewCard: {
    backgroundColor: COLORS.card, borderColor: COLORS.magenta + '44',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md,
  },
  bonusViewRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  bonusViewLabel: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2, flex: 1 },
  bonusViewVal: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bonusViewText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  bonusOk:   { fontSize: 18, color: COLORS.green },
  bonusFail: { fontSize: 18, color: COLORS.red2 },
  bonusFinalRow: {
    paddingTop: 12, marginTop: 8,
    borderTopWidth: 1, borderTopColor: COLORS.line, alignItems: 'center',
  },
  bonusFinalScore: {
    fontFamily: FONTS.heading, fontSize: 28, color: COLORS.neon, marginTop: 4,
  },
  bonusTotalPoints: {
    fontFamily: FONTS.heading, fontSize: 16, color: COLORS.magenta,
    letterSpacing: 1, textAlign: 'center', marginTop: SPACING.md,
  },
});
