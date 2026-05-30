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
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';

const TABS = ['Grupos', 'Bracket', 'Ranking', 'Bonus'];

/**
 * Resuelve un placeholder a teams elegibles, considerando los picks previos del user.
 * - "1° Grupo X" / "2° Grupo X" → todos los teams del grupo X
 * - "3° A/B/C/D/F" → todos los teams de esos grupos
 * - "Ganador Mxxx" → el team que el user pickeó en Mxxx (1 team). Si no pickeo → blocked.
 * - "Perdedor Mxxx" → los teams candidatos del Mxxx menos el winner pickeado.
 * Devuelve { teams: [], blocked: 'mensaje' | null }.
 */
function getTeamsForPlaceholder(placeholder, koMatches, allTeams, predictions, teamsById) {
  if (!placeholder) return { teams: [], blocked: null };

  let m = placeholder.match(/^[12]°\s*Grupo\s*([A-L])$/i);
  if (m) {
    const grp = m[1].toUpperCase();
    return { teams: allTeams.filter(t => t.group_letter === grp), blocked: null };
  }
  m = placeholder.match(/^3°\s+(.+)$/i);
  if (m) {
    const groups = new Set(m[1].split('/').map(s => s.trim().toUpperCase()).filter(Boolean));
    return { teams: allTeams.filter(t => groups.has(t.group_letter)), blocked: null };
  }
  m = placeholder.match(/^Ganador\s+M(\d+)$/i);
  if (m) {
    const prevMatchNum = parseInt(m[1], 10);
    const prev = koMatches.find(km => km.match_number === prevMatchNum);
    if (!prev) return { teams: [], blocked: `Falta datos del M${prevMatchNum}` };
    const pickId = predictions[prev.id]?.pred_winner_team_id;
    if (!pickId) return { teams: [], blocked: `Pickeá primero M${prevMatchNum}` };
    const t = teamsById[pickId];
    return { teams: t ? [t] : [], blocked: null };
  }
  m = placeholder.match(/^Perdedor\s+M(\d+)$/i);
  if (m) {
    const prevMatchNum = parseInt(m[1], 10);
    const prev = koMatches.find(km => km.match_number === prevMatchNum);
    if (!prev) return { teams: [], blocked: `Falta datos del M${prevMatchNum}` };
    const winnerId = predictions[prev.id]?.pred_winner_team_id;
    if (!winnerId) return { teams: [], blocked: `Pickeá primero M${prevMatchNum}` };
    const prevElig = getEligibleTeamsForMatch(prev, koMatches, allTeams, predictions, teamsById);
    if (prevElig.blocked) return { teams: [], blocked: prevElig.blocked };
    return { teams: prevElig.teams.filter(t => t.id !== winnerId), blocked: null };
  }
  return { teams: [], blocked: null };
}

function getEligibleTeamsForMatch(match, koMatches, allTeams, predictions, teamsById) {
  // Si los teams están resueltos en BD (post fase grupos real), solo esos 2
  if (match.team_home_id && match.team_away_id) {
    return {
      teams: allTeams.filter(t => t.id === match.team_home_id || t.id === match.team_away_id),
      blocked: null,
    };
  }
  const home = getTeamsForPlaceholder(match.home_placeholder, koMatches, allTeams, predictions, teamsById);
  const away = getTeamsForPlaceholder(match.away_placeholder, koMatches, allTeams, predictions, teamsById);
  if (home.blocked || away.blocked) {
    return { teams: [], blocked: home.blocked || away.blocked };
  }
  const map = new Map();
  [...home.teams, ...away.teams].forEach(t => map.set(t.id, t));
  return { teams: Array.from(map.values()), blocked: null };
}
const PHASE_LABEL = {
  group: 'Grupos', round_32: '16avos', round_16: 'Octavos',
  quarter: 'Cuartos', semi: 'Semis', third_place: '3°', final: 'Final',
};

export default function MundialPollaScreen({ navigation }) {
  const { user } = useAuthStore();
  const { pool, loadPool } = useWcStore();
  const [enrollment, setEnrollment] = useState(null);
  const [matches, setMatches] = useState([]);
  const [koMatches, setKoMatches] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [bonus, setBonus] = useState(null);
  const [teamsById, setTeamsById] = useState({});
  const [ranking, setRanking] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [tab, setTab] = useState('Grupos');
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedKoPhase, setExpandedKoPhase] = useState(null);
  const [koTeamPicker, setKoTeamPicker] = useState(null);
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

      // Matches de grupos (72) — para tab "Grupos"
      const { data: m } = await supabase
        .from('wc_matches')
        .select(`
          id, match_number, phase, group_letter, scheduled_at, prediction_deadline,
          status, multiplier, score_home, score_away, home_placeholder, away_placeholder,
          team_home:team_home_id ( code, name_es ),
          team_away:team_away_id ( code, name_es )
        `)
        .eq('phase', 'group')
        .order('match_number')
        .limit(80);
      setMatches(m ?? []);

      // Matches KO (32) — para tab "Bracket"
      const { data: ko } = await supabase
        .from('wc_matches')
        .select(`
          id, match_number, phase, scheduled_at, status, multiplier,
          home_placeholder, away_placeholder,
          team_home:team_home_id ( code, name_es ),
          team_away:team_away_id ( code, name_es )
        `)
        .neq('phase', 'group')
        .order('match_number')
        .limit(40);
      setKoMatches(ko ?? []);

      // Lista de todos los teams para el picker KO
      const { data: tAll } = await supabase
        .from('wc_teams')
        .select('id, code, name_es, group_letter')
        .order('group_letter').order('name_es');
      setAllTeams(tAll ?? []);

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
      <MundialScreenFrame>
        <SafeAreaView style={styles.safe}>
          <ActivityIndicator size="large" color={COLORS.neon} style={{ marginTop: 80 }} />
        </SafeAreaView>
      </MundialScreenFrame>
    );
  }

  if (!enrollment || enrollment.payment_status !== 'paid') {
    return (
      <MundialScreenFrame>
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
      </MundialScreenFrame>
    );
  }

  return (
    <MundialScreenFrame>
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

        {tab === 'Grupos' && (
          <View>
            <Text style={styles.helpText}>
              Predicí el marcador de los 72 partidos de fase de grupos. Tocá un grupo para abrirlo.
            </Text>
            {['A','B','C','D','E','F','G','H','I','J','K','L'].map((letter) => {
              const groupMatches = matches.filter(m => m.group_letter === letter);
              const filled = groupMatches.filter(m => predictions[m.id]).length;
              const isOpen = expandedGroup === letter;
              return (
                <View key={letter} style={styles.groupBlock}>
                  <TouchableOpacity
                    style={[styles.groupHeader, isOpen && styles.groupHeaderOpen]}
                    onPress={() => setExpandedGroup(isOpen ? null : letter)}
                  >
                    <Text style={styles.groupHeaderTitle}>GRUPO {letter}</Text>
                    <Text style={styles.groupHeaderMeta}>
                      {filled}/{groupMatches.length} · {isOpen ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                  {isOpen && groupMatches.map((m) => (
                    <PredictionRow
                      key={m.id}
                      match={m}
                      prediction={predictions[m.id]}
                      userId={user.id}
                      onSaved={load}
                    />
                  ))}
                </View>
              );
            })}
          </View>
        )}

        {tab === 'Bracket' && (
          <View>
            <Text style={styles.helpText}>
              Predicí quién avanza en cada partido de eliminatoria.
            </Text>
            {[
              { phase: 'round_32',    label: '16AVOS',   mult: 1.5 },
              { phase: 'round_16',    label: 'OCTAVOS',  mult: 2.0 },
              { phase: 'quarter',     label: 'CUARTOS',  mult: 2.5 },
              { phase: 'semi',        label: 'SEMIS',    mult: 3.0 },
              { phase: 'third_place', label: '3ER LUGAR',mult: 4.0 },
              { phase: 'final',       label: 'FINAL',    mult: 4.0 },
            ].map(({ phase, label, mult }) => {
              const phaseMatches = koMatches.filter(m => m.phase === phase);
              const filled = phaseMatches.filter(m => predictions[m.id]?.pred_winner_team_id).length;
              const isOpen = expandedKoPhase === phase;
              return (
                <View key={phase} style={styles.groupBlock}>
                  <TouchableOpacity
                    style={[styles.groupHeader, isOpen && styles.groupHeaderOpen]}
                    onPress={() => setExpandedKoPhase(isOpen ? null : phase)}
                  >
                    <Text style={styles.groupHeaderTitle}>{label}</Text>
                    <Text style={styles.groupHeaderMeta}>
                      {filled}/{phaseMatches.length} · x{mult} · {isOpen ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                  {isOpen && phaseMatches.map((m) => {
                    const elig = getEligibleTeamsForMatch(m, koMatches, allTeams, predictions, teamsById);
                    return (
                      <BracketRow
                        key={m.id}
                        match={m}
                        prediction={predictions[m.id]}
                        teamsById={teamsById}
                        blockedReason={elig.blocked}
                        userId={user.id}
                        onSaved={load}
                        onPickTeam={() => {
                          if (elig.blocked) {
                            Alert.alert('Pick bloqueado', elig.blocked);
                            return;
                          }
                          setKoTeamPicker({ matchId: m.id, eligibleTeams: elig.teams });
                        }}
                      />
                    );
                  })}
                </View>
              );
            })}
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

      {koTeamPicker && (
        <KoTeamPickerModal
          allTeams={koTeamPicker.eligibleTeams ?? allTeams}
          onCancel={() => setKoTeamPicker(null)}
          onPick={async (teamId) => {
            try {
              const { error } = await supabase.rpc('wc_submit_polla_prediction', {
                p_user_id: user.id,
                p_match_id: koTeamPicker.matchId,
                p_pred_score_home: null,
                p_pred_score_away: null,
                p_pred_winner_team_id: teamId,
              });
              if (error) throw error;
              setKoTeamPicker(null);
              await load();
            } catch (e) {
              Alert.alert('Error', e.message || 'No se pudo guardar el pick');
            }
          }}
        />
      )}
    </SafeAreaView>
    </MundialScreenFrame>
  );
}

function KoTeamPickerModal({ allTeams, onCancel, onPick }) {
  return (
    <TouchableOpacity
      style={styles.modalBackdrop}
      activeOpacity={1}
      onPress={onCancel}
    >
      <TouchableOpacity
        style={styles.modalContent}
        activeOpacity={1}
        onPress={() => {}}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Elegí tu pick</Text>
          <TouchableOpacity onPress={onCancel} style={styles.modalClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ maxHeight: 460 }}>
          {allTeams.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.modalTeamRow}
              onPress={() => onPick(t.id)}
            >
              <Text style={styles.modalTeamCode}>{t.code}</Text>
              <Text style={styles.modalTeamName} numberOfLines={1}>{t.name_es}</Text>
              <Text style={styles.modalTeamGroup}>{t.group_letter}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity onPress={onCancel} style={styles.modalCancel}>
          <Text style={styles.modalCancelText}>Cancelar</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function PredictionRow({ match, prediction, userId, onSaved }) {
  const [home, setHome] = useState(prediction?.pred_score_home != null ? String(prediction.pred_score_home) : '');
  const [away, setAway] = useState(prediction?.pred_score_away != null ? String(prediction.pred_score_away) : '');
  const [saving, setSaving] = useState(false);

  // Deadline unificado: todas las predicciones cierran al enrollment_deadline del pool
  // (11-jun-2026 11:00 PA). Después no se pueden tocar más, hasta que termine el Mundial.
  const ENROLLMENT_DEADLINE_MS = Date.UTC(2026, 5, 11, 16, 0, 0); // 11-jun 16:00 UTC = 11am PA
  const closed = Date.now() >= ENROLLMENT_DEADLINE_MS || match.status !== 'scheduled';
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

function BracketRow({ match, prediction, teamsById, blockedReason, userId, onSaved, onPickTeam }) {
  const picked = prediction?.pred_winner_team_id ? teamsById[prediction.pred_winner_team_id] : null;
  const finished = match.status === 'finished';
  const homeName = match.team_home?.name_es || match.home_placeholder || '—';
  const awayName = match.team_away?.name_es || match.away_placeholder || '—';

  const [scoreHome, setScoreHome] = useState(prediction?.pred_score_home != null ? String(prediction.pred_score_home) : '');
  const [scoreAway, setScoreAway] = useState(prediction?.pred_score_away != null ? String(prediction.pred_score_away) : '');
  const [savingScore, setSavingScore] = useState(false);

  const ENROLLMENT_DEADLINE_MS = Date.UTC(2026, 5, 11, 16, 0, 0);
  const closed = Date.now() >= ENROLLMENT_DEADLINE_MS;

  const saveScore = async () => {
    if (!picked) {
      Alert.alert('Falta pick', 'Primero elegí el equipo ganador.');
      return;
    }
    const h = scoreHome === '' ? null : parseInt(scoreHome, 10);
    const a = scoreAway === '' ? null : parseInt(scoreAway, 10);
    if ((h !== null && Number.isNaN(h)) || (a !== null && Number.isNaN(a))) {
      Alert.alert('Marcador inválido', 'Números enteros 0..20.');
      return;
    }
    if ((h === null) !== (a === null)) {
      Alert.alert('Marcador incompleto', 'Llená home y away, o dejá ambos vacíos.');
      return;
    }
    setSavingScore(true);
    try {
      const { error } = await supabase.rpc('wc_submit_polla_prediction', {
        p_user_id: userId,
        p_match_id: match.id,
        p_pred_score_home: h,
        p_pred_score_away: a,
        p_pred_winner_team_id: prediction.pred_winner_team_id,
      });
      if (error) throw error;
      await onSaved();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingScore(false);
    }
  };

  return (
    <View style={[
      styles.bracketRow,
      finished && styles.bracketRowFinished,
      prediction?.hit_level === 'winner' && { borderColor: COLORS.gold },
      prediction?.hit_level === 'winner_diff' && { borderColor: COLORS.neon },
      prediction?.hit_level === 'exact' && { borderColor: COLORS.green },
    ]}>
      <View style={styles.bracketHead}>
        <Text style={styles.predNum}>M{match.match_number}</Text>
        <Text style={styles.predDate}>
          {new Date(match.scheduled_at).toLocaleString('es-PA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      <Text style={styles.bracketCruceLabel}>{homeName}  vs  {awayName}</Text>

      {blockedReason ? (
        <View style={styles.bracketBlocked}>
          <Text style={styles.bracketBlockedText}>🔒 {blockedReason}</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity style={styles.bracketPickBtn} onPress={onPickTeam} disabled={closed}>
            <Text style={styles.bracketPickLabel}>MI PICK · GANADOR</Text>
            <Text style={styles.bracketPickValue}>
              {picked ? `${picked.code} · ${picked.name_es}` : 'Tocá para elegir →'}
            </Text>
          </TouchableOpacity>

          {picked && !closed && (
            <View style={styles.bracketScoreRow}>
              <Text style={styles.bracketScoreLabel}>Marcador exacto (opcional · bonus)</Text>
              <View style={styles.bracketScoreInputs}>
                <TextInput
                  style={styles.predInput}
                  value={scoreHome}
                  onChangeText={setScoreHome}
                  keyboardType="number-pad"
                  placeholder="–"
                  placeholderTextColor={COLORS.gray}
                  maxLength={2}
                />
                <Text style={styles.predDash}>–</Text>
                <TextInput
                  style={styles.predInput}
                  value={scoreAway}
                  onChangeText={setScoreAway}
                  keyboardType="number-pad"
                  placeholder="–"
                  placeholderTextColor={COLORS.gray}
                  maxLength={2}
                />
                <TouchableOpacity
                  style={[styles.predSaveBtn, savingScore && { opacity: 0.5 }]}
                  onPress={saveScore}
                  disabled={savingScore}
                >
                  <Text style={styles.predSaveBtnText}>{savingScore ? '…' : 'Guardar'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {finished && (
        <Text style={styles.actualScore}>
          Real: {match.score_home}–{match.score_away}
          {prediction?.points_earned > 0 ? ` · +${prediction.points_earned} pts ${prediction.hit_level === 'exact' ? '🎯' : prediction.hit_level === 'winner_diff' ? '✨' : '✓'}` : prediction ? ' · 0 pts ✗' : ''}
        </Text>
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
  safe: { flex: 1, backgroundColor: 'transparent' },
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
    flexDirection: 'row', backgroundColor: 'rgba(10, 14, 20, 0.93)',
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
    backgroundColor: 'rgba(10, 14, 20, 0.93)', borderColor: COLORS.magenta + '88',
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
    borderRadius: RADIUS.sm, backgroundColor: 'rgba(10, 14, 20, 0.90)',
    borderColor: COLORS.line, borderWidth: 1,
  },
  tabBtnActive: { backgroundColor: COLORS.magenta, borderColor: COLORS.magenta },
  tabText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2, letterSpacing: 1 },
  tabTextActive: { color: COLORS.white },

  helpText: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2,
    marginBottom: SPACING.sm, lineHeight: 17,
  },
  groupBlock: { marginBottom: SPACING.sm },
  groupHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md,
  },
  groupHeaderOpen: { borderColor: COLORS.magenta },
  groupHeaderTitle: {
    fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 1.5,
  },
  groupHeaderMeta: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },

  bracketRow: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.sm, marginTop: 6,
  },
  bracketRowFinished: { opacity: 0.85 },
  bracketHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  bracketCruceLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white,
    marginBottom: 8,
  },
  bracketPickBtn: {
    backgroundColor: 'rgba(0, 0, 0, 0.70)', borderColor: COLORS.magenta + '88', borderWidth: 1,
    borderRadius: RADIUS.sm, padding: SPACING.sm,
  },
  bracketPickLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.magenta,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  bracketPickValue: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, marginTop: 4,
  },
  bracketBlocked: {
    backgroundColor: COLORS.gold + '14', borderColor: COLORS.gold + '66',
    borderWidth: 1, borderRadius: RADIUS.sm, padding: SPACING.sm,
    alignItems: 'center', marginTop: 4,
  },
  bracketBlockedText: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gold,
    textAlign: 'center',
  },
  bracketScoreRow: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.line,
  },
  bracketScoreLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray2,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
  },
  bracketScoreInputs: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },

  modalBackdrop: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'rgba(10, 14, 20, 0.97)',
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  modalClose: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.bg, borderColor: COLORS.line, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  modalCloseText: {
    fontFamily: FONTS.bodyBold, fontSize: 18, color: COLORS.white,
    lineHeight: 20,
  },
  modalTitle: {
    fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white,
    letterSpacing: 1, flex: 1, textAlign: 'center', marginLeft: 36,
  },
  modalTeamRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  modalTeamCode: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  modalTeamName: { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  modalTeamGroup: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2 },
  modalCancel: { marginTop: SPACING.md, padding: 12, alignItems: 'center' },
  modalCancelText: { color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 14 },

  predCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.line, borderWidth: 1,
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
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
  },
  predInputClosed: { backgroundColor: 'rgba(10, 14, 20, 0.92)', color: COLORS.gray },
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
  rankRowMe: { backgroundColor: 'rgba(255, 26, 107, 0.18)' },
  rankPos:  { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray2, width: 40 },
  rankName: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  rankSubtext: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  rankPts:  { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.neon },

  emptyText: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, textAlign: 'center', marginTop: SPACING.lg },

  bonusViewCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.93)', borderColor: COLORS.magenta + '66',
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
