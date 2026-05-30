import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCTabBar, WCButton, WCBadge, WCEmptyState, WC_ALPHA } from '../../../components/mundial/WCComponents';

const TABS = ['Pick', 'Jornadas', 'Equipos', 'Comunidad', 'Ranking'];

export default function MundialSurvivorScreen({ navigation }) {
  const { user } = useAuthStore();
  const { pool, loadPool } = useWcStore();
  const [enrollment, setEnrollment] = useState(null);
  const [nextDay, setNextDay] = useState(null);
  const [matchesOfDay, setMatchesOfDay] = useState([]);
  const [teamsAvailable, setTeamsAvailable] = useState([]);
  const [teamUsage, setTeamUsage] = useState({});
  const [currentPick, setCurrentPick] = useState(null);
  const [history, setHistory] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [communityPicks, setCommunityPicks] = useState([]);
  const [livesDistribution, setLivesDistribution] = useState({ alive3: 0, alive2: 0, alive1: 0, dead: 0, total: 0 });
  // Stats agregadas REALES (todos los survivor pagados) vía RPC wc_pool_stats.
  // Antes el cliente solo veía su propia inscripción por RLS → pozo y distribución subcontados.
  const [poolStats, setPoolStats] = useState(null); // fila { paid_count, pozo, alive3, alive2, alive1, dead } del modo 'survivor'
  const [allDays, setAllDays] = useState([]);
  const [picksByDay, setPicksByDay] = useState({});
  const [matchesByDay, setMatchesByDay] = useState({});
  const [allTeams, setAllTeams] = useState([]);
  const [expandedDay, setExpandedDay] = useState(null);
  const [tab, setTab] = useState('Pick');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickToast, setPickToast] = useState(false);

  // Recarga silenciosa: refresca picks + usage + enrollment sin desmontar la UI.
  // Usar después de guardar un pick (no la primera carga).
  const silentReload = useCallback(async () => {
    try {
      const { data: e } = await supabase
        .from('wc_enrollments')
        .select('*')
        .eq('user_id', user.id)
        .eq('mode', 'survivor')
        .maybeSingle();
      if (e) setEnrollment(e);
      if (!e || e.payment_status !== 'paid') return;

      const { data: picks } = await supabase
        .from('wc_picks')
        .select('team_id, match_day_id, result, life_lost')
        .eq('enrollment_id', e.id);
      const usage = {};
      (picks ?? []).forEach(p => {
        if (p.result !== 'no_pick') usage[p.team_id] = (usage[p.team_id] ?? 0) + 1;
      });
      setTeamUsage(usage);

      const { data: allPicks } = await supabase
        .from('wc_picks')
        .select(`id, match_day_id, result, life_lost, resolved_at, team:team_id (id, code, name_es)`)
        .eq('enrollment_id', e.id);
      const pMap = {};
      (allPicks ?? []).forEach(p => { pMap[p.match_day_id] = p; });
      setPicksByDay(pMap);

      if (nextDay) {
        const { data: pk } = await supabase
          .from('wc_picks')
          .select('*')
          .eq('enrollment_id', e.id)
          .eq('match_day_id', nextDay.id)
          .maybeSingle();
        setCurrentPick(pk);
      }
    } catch (_) { /* silent */ }
  }, [user.id, nextDay]);

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

      // 9) Distribución de vidas REAL (todos los survivor paid) vía RPC agregado.
      // El query directo a wc_enrollments solo devolvía la fila del propio user por RLS,
      // por eso el pozo y la distribución salían subcontados. Ahora usamos wc_pool_stats.
      let survRow = null;
      try {
        const { data: stats } = await supabase.rpc('wc_pool_stats');
        survRow = (stats ?? []).find(s => s.mode === 'survivor') ?? null;
      } catch (_) { survRow = null; }
      setPoolStats(survRow);
      const alive3 = survRow?.alive3 ?? 0;
      const alive2 = survRow?.alive2 ?? 0;
      const alive1 = survRow?.alive1 ?? 0;
      const dead = survRow?.dead ?? 0;
      setLivesDistribution({
        alive3, alive2, alive1, dead,
        total: survRow?.paid_count ?? (alive3 + alive2 + alive1 + dead),
      });

      // 10) Picks de la comunidad para el día actual (conteo agregado por team)
      if (day) {
        const { data: dayPicks } = await supabase
          .from('wc_picks')
          .select('team_id, team:team_id (code, name_es)')
          .eq('match_day_id', day.id);
        const counts = {};
        (dayPicks ?? []).forEach(p => {
          const key = p.team_id;
          if (!counts[key]) counts[key] = { team: p.team, count: 0 };
          counts[key].count++;
        });
        const arr = Object.values(counts).sort((a, b) => b.count - a.count);
        setCommunityPicks(arr);
      } else {
        setCommunityPicks([]);
      }

      // 11) TODAS las jornadas de grupos (para tab "Jornadas")
      const { data: allDaysData } = await supabase
        .from('wc_match_days')
        .select('*')
        .eq('phase', 'group')
        .order('date');
      setAllDays(allDaysData ?? []);

      // 12) Matches de TODAS las jornadas (agrupados por match_day_id)
      const { data: allM } = await supabase
        .from('wc_matches')
        .select(`
          id, match_number, scheduled_at, group_letter, match_day_id,
          status, score_home, score_away,
          team_home:team_home_id ( id, code, name_es ),
          team_away:team_away_id ( id, code, name_es )
        `)
        .eq('phase', 'group')
        .order('scheduled_at');
      const mMap = {};
      (allM ?? []).forEach(mt => {
        if (!mMap[mt.match_day_id]) mMap[mt.match_day_id] = [];
        mMap[mt.match_day_id].push(mt);
      });
      setMatchesByDay(mMap);

      // 13) Picks del user agrupados por match_day_id (con resultado)
      const { data: allPicks } = await supabase
        .from('wc_picks')
        .select(`
          id, match_day_id, result, life_lost, resolved_at,
          team:team_id (id, code, name_es)
        `)
        .eq('enrollment_id', e.id);
      const pMap = {};
      (allPicks ?? []).forEach(p => { pMap[p.match_day_id] = p; });
      setPicksByDay(pMap);

      // 14) Lista de 48 teams (para vista "Mis equipos")
      const { data: tAll } = await supabase
        .from('wc_teams')
        .select('id, code, name_es, group_letter')
        .order('group_letter').order('name_es');
      setAllTeams(tAll ?? []);

      // 15) Pool global
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

  const showPickToast = () => {
    setPickToast(true);
    setTimeout(() => setPickToast(false), 2000);
  };

  const submitPickFor = async (dayId, teamId) => {
    if (saving || !dayId) return;
    const uses = teamUsage[teamId] ?? 0;
    const existingPick = picksByDay[dayId];
    const isChange = existingPick?.team?.id === teamId;
    if (!isChange && uses >= 1) {
      Alert.alert('Equipo ya usado', 'Solo podés usar cada equipo 1 vez en toda la fase de grupos.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('wc_submit_survivor_pick', {
        p_user_id: user.id,
        p_match_day_id: dayId,
        p_team_id: teamId,
      });
      if (error) throw error;
      await silentReload();
      showPickToast();
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo guardar el pick.');
    } finally {
      setSaving(false);
    }
  };

  const submitPick = async (teamId) => {
    if (saving) return;
    if (!nextDay) return;
    const uses = teamUsage[teamId] ?? 0;
    const isChange = currentPick?.team_id === teamId;
    if (!isChange && uses >= 1) {
      Alert.alert('Equipo ya usado', 'Solo podés usar cada equipo 1 vez en toda la fase de grupos.');
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
      await silentReload();
      showPickToast();
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo guardar el pick.');
    } finally {
      setSaving(false);
    }
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

  // No inscrito
  if (!enrollment || enrollment.payment_status !== 'paid') {
    return (
      <MundialScreenFrame>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.notEnrolled}>
            <Text style={styles.notEnrolledTitle}>No estás inscrito al Survivor</Text>
            <Text style={styles.notEnrolledText}>
              Inscribite para empezar a participar.
            </Text>
            <WCButton
              label="INSCRIBIRME · $10"
              variant="danger"
              size="lg"
              onPress={() => navigation.navigate('MundialEnroll', { mode: 'survivor' })}
              style={{ marginTop: SPACING.md, paddingHorizontal: 40 }}
            />
          </View>
        </SafeAreaView>
      </MundialScreenFrame>
    );
  }

  const lives = enrollment.lives_remaining;
  const eliminated = lives <= 0;

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

        {/* Pozo en vivo — pozo, total y vivos vienen del RPC agregado (real, no subcontado) */}
        {(() => {
          // pozo real del RPC; fallback al estimado por conteo si el RPC no devolvió fila.
          const pozo = poolStats?.pozo != null
            ? Number(poolStats.pozo)
            : (livesDistribution.total * (pool?.survivor_price ?? 10) * (1 - (pool?.fee_rate ?? 0.085)));
          const alive = livesDistribution.alive3 + livesDistribution.alive2 + livesDistribution.alive1;
          return (
            <View style={styles.pozoCard}>
              <View style={styles.pozoLeft}>
                <Text style={styles.pozoLabel}>POZO ACUMULADO</Text>
                <Text style={styles.pozoValue}>
                  ${(pozo || 0).toFixed(0)}
                </Text>
              </View>
              <View style={styles.pozoRight}>
                <Text style={styles.pozoLabel}>VIVOS</Text>
                <Text style={styles.pozoSurvivors}>{alive}</Text>
              </View>
            </View>
          );
        })()}

        {/* Header con vidas propias */}
        <View style={styles.livesCard}>
          <Text style={styles.livesLabel}>TUS VIDAS</Text>
          <View style={styles.livesRow}>
            {[0, 1, 2].map((i) => (
              <Text key={i} style={[styles.heart, i < lives && styles.heartActive]}>
                {i < lives ? '♥' : '♡'}
              </Text>
            ))}
          </View>
          {eliminated && (
            <Text style={styles.eliminatedText}>ELIMINADO</Text>
          )}
          {(() => {
            if (history.length === 0) return null;
            let streak = 0;
            for (const h of history) {
              if (h.result === 'won') streak++;
              else break;
            }
            if (streak === 0) return null;
            return (
              <View style={styles.streakChip}>
                <Text style={styles.streakChipText}>🔥 Racha: {streak}</Text>
              </View>
            );
          })()}
        </View>

        {/* Tabs scrolleables horizontalmente — soporta los 5 tabs sin truncar */}
        <WCTabBar tabs={TABS} active={tab} onChange={setTab} accent="red" />

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
                  ⚠️ Cada equipo se puede usar 1 sola vez en grupos. Si no hacés pick, perdés
                  una vida.
                </Text>
              </>
            )}
          </View>
        )}

        {tab === 'Comunidad' && (
          <View>
            <Text style={styles.sectionTitle}>Distribución de vidas</Text>
            <View style={styles.distRow}>
              <DistTile lives={3} count={livesDistribution.alive3} total={livesDistribution.total} color={COLORS.green} />
              <DistTile lives={2} count={livesDistribution.alive2} total={livesDistribution.total} color={COLORS.gold} />
              <DistTile lives={1} count={livesDistribution.alive1} total={livesDistribution.total} color={COLORS.orange} />
              <DistTile lives={0} count={livesDistribution.dead}   total={livesDistribution.total} color={COLORS.red2} />
            </View>

            <Text style={styles.sectionTitle}>
              Picks de la comunidad {nextDay && `· ${new Date(nextDay.date).toLocaleDateString('es-PA', { day:'2-digit', month:'short' })}`}
            </Text>
            <Text style={styles.communityHint}>
              Cuántos users eligieron cada equipo en esta jornada. El más popular tiene más
              riesgo si pierde (más users caen juntos).
            </Text>
            {communityPicks.length === 0 ? (
              <Text style={styles.emptyText}>
                Aún nadie hizo pick para esta jornada.
              </Text>
            ) : (
              communityPicks.map((p) => {
                const totalPicked = communityPicks.reduce((s, x) => s + x.count, 0);
                const pct = totalPicked > 0 ? Math.round((p.count / totalPicked) * 100) : 0;
                return (
                  <View key={p.team?.code} style={styles.communityRow}>
                    <Text style={styles.communityCode}>{p.team?.code}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.communityName}>{p.team?.name_es}</Text>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                    <View style={styles.communityStats}>
                      <Text style={styles.communityPct}>{pct}%</Text>
                    </View>
                  </View>
                );
              })
            )}

            <View style={styles.insightCard}>
              <Text style={styles.insightTitle}>💡 Insight</Text>
              <Text style={styles.insightText}>
                {(() => {
                  const totalPicked = communityPicks.reduce((s, x) => s + x.count, 0);
                  if (livesDistribution.total === 0) return 'Aún no hay datos. Cuando se inscriban verás aquí las tendencias.';
                  if (totalPicked === 0) return 'Los participantes vivos aún no hicieron pick. Si no pickean antes del deadline, pierden vida.';
                  const top = communityPicks[0];
                  return `El ${Math.round(top.count / totalPicked * 100)}% eligió ${top.team?.name_es}. Si pierde, es el equipo de mayor riesgo de la jornada.`;
                })()}
              </Text>
            </View>
          </View>
        )}

        {tab === 'Jornadas' && (
          <View>
            <Text style={styles.communityHint}>
              Solo podés pickear la jornada actual (la más próxima sin terminar).
              Las futuras se habilitan cuando termina la anterior.
            </Text>
            {(() => {
              // Identificar la "jornada actual": primera no-settled con deadline > now
              const now = Date.now();
              const currentDayId = allDays.find(d =>
                !d.is_settled && new Date(d.pick_deadline).getTime() > now
              )?.id;

              return allDays.map((d) => {
                const kickoffMs = new Date(d.first_kickoff_at).getTime();
                const deadlineMs = new Date(d.pick_deadline).getTime();
                let status;
                if (d.is_settled || kickoffMs <= now) status = 'closed';
                else if (d.id === currentDayId) status = 'current';
                else status = 'future_locked';

                const pick = picksByDay[d.id];
                const dayMatches = matchesByDay[d.id] ?? [];
                const isOpen = expandedDay === d.id;

                return (
                  <View key={d.id} style={styles.groupBlock}>
                    <TouchableOpacity
                      style={[
                        styles.dayHeader,
                        status === 'current' && styles.dayHeaderOpen,
                        status === 'closed' && styles.dayHeaderClosed,
                      ]}
                      onPress={() => setExpandedDay(isOpen ? null : d.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dayHeaderDate}>
                          {new Date(d.date).toLocaleDateString('es-PA', {
                            weekday: 'short', day: '2-digit', month: 'short',
                          }).toUpperCase()}
                        </Text>
                        <Text style={styles.dayHeaderMeta}>
                          {dayMatches.length} partidos ·{' '}
                          {status === 'current' ? '🟢 Tu turno' :
                           status === 'closed' ? '🔒 Cerrada' :
                           '🔒 Próximamente'}
                          {pick && ` · Tu pick: ${pick.team?.name_es}`}
                        </Text>
                      </View>
                      <Text style={styles.dayHeaderArrow}>{isOpen ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                  {isOpen && (
                    <View style={styles.daySection}>
                      {pick && (
                        <View style={[
                          styles.currentPickCard,
                          pick.result === 'won' && { borderColor: COLORS.green },
                          pick.result === 'lost' && { borderColor: COLORS.red2 },
                          pick.result === 'draw' && { borderColor: COLORS.orange },
                        ]}>
                          <Text style={styles.currentPickLabel}>Tu pick</Text>
                          <Text style={styles.currentPickTeam}>{pick.team?.name_es ?? '—'}</Text>
                          {pick.resolved_at && (
                            <Text style={[
                              styles.historyResult,
                              pick.result === 'won' && { color: COLORS.green },
                              pick.result === 'draw' && { color: COLORS.orange },
                              pick.result === 'lost' && { color: COLORS.red2A11y ?? COLORS.red2 },
                              pick.result === 'no_pick' && { color: COLORS.red2A11y ?? COLORS.red2 },
                            ]}>
                              {pick.result === 'won' ? '✓ GANÓ' : pick.result === 'draw' ? '~ EMPATE −1♥' : pick.result === 'lost' ? '✗ DERROTA −1♥' : pick.result === 'no_pick' ? '✗ NO PICK −1♥' : '—'}
                            </Text>
                          )}
                        </View>
                      )}
                      {dayMatches.map((mt) => (
                        <View key={mt.id} style={styles.matchCard}>
                          <Text style={styles.matchPhase}>
                            Grupo {mt.group_letter} · {new Date(mt.scheduled_at).toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}
                            {mt.status === 'finished' && ` · ${mt.score_home}–${mt.score_away}`}
                          </Text>
                          <View style={styles.matchTeams}>
                            <TeamButton
                              team={mt.team_home}
                              usage={teamUsage[mt.team_home?.id] ?? 0}
                              selected={pick?.team?.id === mt.team_home?.id}
                              onPress={() => {
                                if (status === 'current') submitPickFor(d.id, mt.team_home.id);
                              }}
                              disabled={status !== 'current' || saving || eliminated}
                            />
                            <Text style={styles.vsLabel}>VS</Text>
                            <TeamButton
                              team={mt.team_away}
                              usage={teamUsage[mt.team_away?.id] ?? 0}
                              selected={pick?.team?.id === mt.team_away?.id}
                              onPress={() => {
                                if (status === 'current') submitPickFor(d.id, mt.team_away.id);
                              }}
                              disabled={status !== 'current' || saving || eliminated}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            });
            })()}

          </View>
        )}

        {tab === 'Equipos' && (
          <View>
            <Text style={styles.communityHint}>
              Cada equipo se puede usar 1 sola vez en toda la fase de grupos.
              Cuando lo usás, se marca como usado y no podés volver a elegirlo.
            </Text>
            {allTeams.map((t) => {
              const uses = teamUsage[t.id] ?? 0;
              const used = uses >= 1;
              return (
                <View key={t.id} style={styles.usageRow}>
                  <Text style={styles.usageCode}>{t.code}</Text>
                  <Text style={styles.usageName} numberOfLines={1}>{t.name_es}</Text>
                  <Text style={styles.usageGroup}>{t.group_letter}</Text>
                  <Text style={[styles.usageHeart, used ? styles.usageHeartOff : styles.usageHeartOn]}>
                    {used ? '✗' : '♥'}
                  </Text>
                </View>
              );
            })}
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
                    <Text key={j} style={[styles.heartSmall, j < r.lives_remaining && styles.heartActive]}>
                      {j < r.lives_remaining ? '♥' : '♡'}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      {pickToast && (
        <View style={styles.pickToast} pointerEvents="none">
          <Text style={styles.pickToastText}>✓ Pick guardado</Text>
        </View>
      )}
    </SafeAreaView>
    </MundialScreenFrame>
  );
}

function DistTile({ lives, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <View style={[styles.distTile, { borderColor: color + '66' }]}>
      <Text style={[styles.distLives, { color }]}>
        {lives === 0 ? '✗' : '♥'.repeat(lives)}
      </Text>
      <Text style={styles.distPct}>{pct}%</Text>
    </View>
  );
}

function TeamButton({ team, usage, selected, onPress, disabled }) {
  if (!team) return <View style={styles.teamBtn}><Text style={styles.teamBtnEmpty}>—</Text></View>;
  const capped = usage >= 1 && !selected;
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
        {usage >= 1 ? '✗ Usado' : '♥ Disponible'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  back: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.18)',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: SPACING.sm,
  },
  backLink: { color: COLORS.bg, fontFamily: FONTS.bodyBold, fontSize: 14 },

  notEnrolled: {
    padding: SPACING.lg, marginTop: 40, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
  },
  notEnrolledTitle: {
    fontFamily: FONTS.heading, fontSize: 24, color: COLORS.bg,
    letterSpacing: 1, textAlign: 'center',
  },
  notEnrolledText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.bg,
    textAlign: 'center', marginTop: 8, marginBottom: SPACING.lg,
  },
  enrollBtn: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.md,
    paddingVertical: 14, paddingHorizontal: 32, ...SHADOWS.glow,
  },
  enrollBtnText: {
    color: COLORS.white, fontFamily: FONTS.heading, fontSize: 16, letterSpacing: 2,
  },

  pozoCard: {
    flexDirection: 'row', backgroundColor: 'rgba(10, 14, 20, 0.93)',
    borderColor: COLORS.neon + '66', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.md, ...SHADOWS.glow,
  },
  pozoLeft: {
    flex: 1, alignItems: 'flex-start',
    borderRightWidth: 1, borderRightColor: COLORS.line,
    paddingRight: SPACING.md,
  },
  pozoRight: { flex: 1, alignItems: 'center', paddingLeft: SPACING.md },
  pozoLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray2,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  pozoValue: {
    fontFamily: FONTS.heading, fontSize: 36, color: COLORS.neon,
    letterSpacing: 1, marginTop: 4,
  },
  pozoSurvivors: {
    fontFamily: FONTS.heading, fontSize: 36, color: COLORS.green,
    letterSpacing: 1, marginTop: 4,
  },
  pozoMeta: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 4 },

  distRow: { flexDirection: 'row', gap: 6, marginBottom: SPACING.md },
  distTile: {
    flex: 1, paddingVertical: SPACING.sm,
    backgroundColor: 'rgba(10, 14, 20, 0.90)', borderWidth: 1,
    borderRadius: RADIUS.sm, alignItems: 'center',
  },
  distLives: {
    fontFamily: FONTS.heading, fontSize: 16, letterSpacing: 0,
  },
  distCount: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, marginTop: 2,
  },
  distPct: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 2 },

  communityHint: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.bg,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(10,14,20,0.14)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.sm, lineHeight: 17,
    overflow: 'hidden',
  },
  communityRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: 6,
  },
  communityCode: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  communityName: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  barTrack: { height: 6, backgroundColor: COLORS.line, borderRadius: 3, marginTop: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.red2, borderRadius: 3 },
  communityStats: { alignItems: 'flex-end', minWidth: 64 },
  communityPct: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white },
  communityCount: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },

  insightCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.gold + '99',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md,
    marginTop: SPACING.md,
  },
  insightTitle: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gold,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4,
  },
  insightText: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 18,
  },

  livesCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.93)', borderRadius: RADIUS.lg,
    padding: SPACING.lg, alignItems: 'center',
    borderColor: COLORS.line, borderWidth: 1,
    marginBottom: SPACING.lg, ...SHADOWS.card,
  },
  livesLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8,
  },
  livesRow: { flexDirection: 'row', gap: 12 },
  heart: { fontSize: 48, color: COLORS.gray },
  heartActive: { color: COLORS.red2 },
  eliminatedText: {
    fontFamily: FONTS.heading, fontSize: 20, color: COLORS.red2,
    letterSpacing: 3, marginTop: 8,
  },

  tabRow: { flexDirection: 'row', marginBottom: SPACING.md, gap: 8 },
  tabBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: RADIUS.sm, backgroundColor: 'rgba(10, 14, 20, 0.90)',
    borderColor: COLORS.line, borderWidth: 1,
  },
  tabBtnActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  tabText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2, letterSpacing: 1 },
  tabTextActive: { color: COLORS.white },

  noDayCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderRadius: RADIUS.md,
    padding: SPACING.lg, alignItems: 'center',
    borderColor: COLORS.line, borderWidth: 1,
  },
  noDayText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 20,
  },

  dayInfo: {
    alignItems: 'center', marginBottom: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  dayDate: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.bg,
    letterSpacing: 1.5,
  },
  deadline: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.bg, marginTop: 4,
  },

  currentPickCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.neon + '88',
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
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(10,14,20,0.92)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
    overflow: 'hidden',
  },
  matchCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderRadius: RADIUS.md,
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
    backgroundColor: 'rgba(0, 0, 0, 0.62)', borderRadius: RADIUS.sm,
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
    fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray2, marginTop: 2,
  },
  teamBtnEmpty: { color: COLORS.gray, fontSize: 12 },
  vsLabel: {
    fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray, letterSpacing: 1,
  },

  ruleNote: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.bg,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(10,14,20,0.14)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    textAlign: 'center', marginTop: SPACING.md, lineHeight: 16,
    overflow: 'hidden',
  },

  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.90)', borderRadius: RADIUS.sm,
    padding: SPACING.sm, marginBottom: 6,
    borderLeftWidth: 4, borderLeftColor: COLORS.line,
  },
  historyTeam: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  historyDate: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 2 },
  historyResult: {
    fontFamily: FONTS.heading, fontSize: 13, color: COLORS.gray2,
    letterSpacing: 1,
  },

  groupBlock: { marginBottom: SPACING.sm },
  dayHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.card2, borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md,
  },
  dayHeaderOpen:   { borderColor: COLORS.red2 },
  dayHeaderClosed: { opacity: 0.6 },
  dayHeaderDate: {
    fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 1,
  },
  dayHeaderMeta: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 2 },
  dayHeaderArrow: { color: COLORS.gray2, fontSize: 16, marginLeft: 8 },
  daySection: { marginTop: 6 },

  usageRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  usageCode: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.neon, width: 50 },
  usageName: { flex: 1, fontFamily: FONTS.body, fontSize: 13, color: COLORS.white },
  usageGroup: { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2, width: 24 },
  usageHearts: { flexDirection: 'row', gap: 4, width: 50, justifyContent: 'flex-end' },
  usageHeart: { fontSize: 16 },
  usageHeartOn: { color: COLORS.red2 },
  usageHeartOff: { color: COLORS.lineVisible ?? '#556070' },

  rankRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  rankPos:  { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray2, width: 40 },
  rankName: { flex: 1, fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white },
  rankLives: { flexDirection: 'row', gap: 4 },
  heartSmall: { fontSize: 14, color: COLORS.gray },
  emptyText: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.bg,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(10,14,20,0.14)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    textAlign: 'center', marginTop: SPACING.lg,
    overflow: 'hidden',
  },
  pickToast: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    ...SHADOWS.card,
  },
  pickToastText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.bg,
    letterSpacing: 1,
  },
  streakChip: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.orange + '22',
    borderColor: COLORS.orange + '88',
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 4,
    alignSelf: 'center',
  },
  streakChipText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.orange,
    letterSpacing: 0.5,
  },
});
