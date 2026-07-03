import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useWcStore from '../../store/wcStore';
import { WCButton, WCBadge, WCCard, WC_ALPHA } from '../../components/mundial/WCComponents';
import { broadcastNotification } from '../../lib/notifications';
import { isModo26Active, setModo26 } from '../../lib/modo26';

const PHASE_LABEL = {
  group: 'Grupos',
  round_32: '16avos',
  round_16: 'Octavos',
  quarter: 'Cuartos',
  semi: 'Semis',
  third_place: '3er lugar',
  final: 'Final',
};

export default function WCAdminPanel({ navigation }) {
  const { pool, loadPool } = useWcStore();
  const [stats, setStats] = useState({
    survivor_paid: 0,
    survivor_alive: 0,
    polla_paid: 0,
    matches_finished: 0,
    matches_scheduled: 0,
  });
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingFlag, setSavingFlag] = useState(false);
  const [finalizingSurvivor, setFinalizingSurvivor] = useState(false);
  const [finalizingPolla, setFinalizingPolla] = useState(false);
  const [finalizingFree, setFinalizingFree] = useState(false);
  const [freeEntries, setFreeEntries] = useState([]);
  const [pollaInputs, setPollaInputs] = useState({
    champion_id: '', runner_up_id: '', third_place_id: '',
    top_scorer: '', mvp: '', final_home: '', final_away: '',
  });
  const [payouts, setPayouts] = useState([]);
  const [loadingPayouts, setLoadingPayouts] = useState(false);
  const [modo26On, setModo26On] = useState(isModo26Active());

  const loadPayouts = useCallback(async () => {
    setLoadingPayouts(true);
    try {
      const { data, error } = await supabase
        .from('wc_payouts')
        .select('id, pool_mode, amount, status, payment_ref, paid_at, notes, enrollment_id, user_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const userIds = [...new Set((data ?? []).map(p => p.user_id).filter(Boolean))];
      let userMap = {};
      if (userIds.length) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, nombre, correo')
          .in('id', userIds);
        (usersData ?? []).forEach(u => { userMap[u.id] = u; });
      }
      setPayouts((data ?? []).map(p => ({ ...p, user: userMap[p.user_id] ?? null })));
    } catch (e) {
      // No bloquea UI principal
    } finally {
      setLoadingPayouts(false);
    }
  }, []);

  const finalizeSurvivor = useCallback(async () => {
    Alert.alert(
      'Finalizar Survivor',
      '¿Confirmar? Esto calcula ganadores, asigna premios y crea los registros de pago. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            setFinalizingSurvivor(true);
            try {
              const { data, error } = await supabase.rpc('wc_admin_finalize_survivor');
              if (error) throw error;
              const winners = Array.isArray(data) ? data.length : '?';
              await loadPayouts();
              Alert.alert('Survivor finalizado', `${winners} ganador(es) calculado(s). Revisá el panel de Pagos.`);
            } catch (e) {
              Alert.alert('Error al finalizar Survivor', e.message || 'Error desconocido');
            } finally {
              setFinalizingSurvivor(false);
            }
          },
        },
      ],
    );
  }, [loadPayouts]);

  const finalizePolla = useCallback(async () => {
    const { champion_id, runner_up_id, third_place_id, top_scorer, mvp, final_home, final_away } = pollaInputs;
    if (!champion_id || !runner_up_id || !third_place_id || !top_scorer || !mvp ||
        final_home === '' || final_away === '') {
      Alert.alert('Datos incompletos', 'Completá todos los campos antes de finalizar la Polla.');
      return;
    }
    const fh = parseInt(final_home, 10);
    const fa = parseInt(final_away, 10);
    if (Number.isNaN(fh) || Number.isNaN(fa)) {
      Alert.alert('Marcador inválido', 'El marcador de la final debe ser numérico.');
      return;
    }
    Alert.alert(
      'Finalizar Polla',
      '¿Confirmar? Se rankea con los bonus picks, se reparte el pozo al top 3 (60/25/15) y se crean los pagos. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            setFinalizingPolla(true);
            try {
              const { data, error } = await supabase.rpc('wc_admin_finalize_polla', {
                p_actual_champion_team_id:  champion_id,
                p_actual_runner_up_team_id: runner_up_id,
                p_actual_third_place_team_id: third_place_id,
                p_actual_top_scorer_name:   top_scorer.trim(),
                p_actual_mvp_name:          mvp.trim(),
                p_actual_final_score_home:  fh,
                p_actual_final_score_away:  fa,
              });
              if (error) throw error;
              await loadPayouts();
              const rows = Array.isArray(data) ? data : [];
              const resumen = rows.length
                ? rows.map(r => `${r.rank_position}º $${Number(r.prize).toFixed(2)} (${r.prize_pct}%)`).join('  ·  ')
                : 'sin ganadores';
              Alert.alert('Polla finalizada', `${rows.length} ganador(es): ${resumen}. Revisá el panel de Pagos.`);
            } catch (e) {
              Alert.alert('Error al finalizar Polla', e.message || 'Error desconocido');
            } finally {
              setFinalizingPolla(false);
            }
          },
        },
      ],
    );
  }, [pollaInputs, loadPayouts]);

  const loadFreeEntries = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('wc_free_polla')
        .select('id, created_at, bonus_points, rank_position, prize_credits, users:user_id(nombre, correo)')
        .order('created_at', { ascending: true });
      setFreeEntries(data ?? []);
    } catch (_) { /* silent */ }
  }, []);

  const finalizeFreePolla = useCallback(async () => {
    const { champion_id, runner_up_id, third_place_id, top_scorer, mvp, final_home, final_away } = pollaInputs;
    if (!champion_id || !runner_up_id || !third_place_id || !top_scorer || !mvp ||
        final_home === '' || final_away === '') {
      Alert.alert('Datos incompletos', 'Completá los resultados reales (arriba, los mismos de la Polla) antes de finalizar la Polla Gratis.');
      return;
    }
    const fh = parseInt(final_home, 10), fa = parseInt(final_away, 10);
    if (Number.isNaN(fh) || Number.isNaN(fa)) { Alert.alert('Marcador inválido', 'El marcador debe ser numérico.'); return; }
    Alert.alert(
      'Finalizar Polla Gratis',
      '¿Confirmar? Se rankea por puntos y se acreditan 20/10/5 créditos al wallet del top 3. No se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar', style: 'destructive',
          onPress: async () => {
            setFinalizingFree(true);
            try {
              const { data, error } = await supabase.rpc('wc_free_polla_finalize', {
                p_actual_champion_team_id:  champion_id,
                p_actual_runner_up_team_id: runner_up_id,
                p_actual_third_place_team_id: third_place_id,
                p_actual_top_scorer_name:   top_scorer.trim(),
                p_actual_mvp_name:          mvp.trim(),
                p_actual_final_score_home:  fh,
                p_actual_final_score_away:  fa,
              });
              if (error) throw error;
              await loadFreeEntries();
              const rows = Array.isArray(data) ? data : [];
              const resumen = rows.length
                ? rows.map(r => `${r.out_rank}º ${r.out_nombre} (${Number(r.out_points)}pts → ${Number(r.out_prize)} créd.)`).join('  ·  ')
                : 'sin participantes';
              Alert.alert('Polla Gratis finalizada', resumen);
            } catch (e) {
              Alert.alert('Error', e.message || 'Error desconocido');
            } finally {
              setFinalizingFree(false);
            }
          },
        },
      ],
    );
  }, [pollaInputs, loadFreeEntries]);

  // Recarga silenciosa: solo refresca stats y matches sin desmontar UI.
  // Usar después de guardar un resultado de match.
  const silentReload = useCallback(async () => {
    try {
      const [{ count: matches_finished }, { data: matchesData }] = await Promise.all([
        supabase.from('wc_matches').select('*', { count: 'exact', head: true }).eq('status', 'finished'),
        supabase.from('wc_matches').select(`
          id, match_number, phase, group_letter, scheduled_at, status,
          score_home, score_away, home_placeholder, away_placeholder,
          team_home_id, team_away_id,
          team_home:team_home_id ( code, name_es ),
          team_away:team_away_id ( code, name_es )
        `).order('scheduled_at', { ascending: true }).limit(110),
      ]);
      setStats(s => ({ ...s, matches_finished: matches_finished ?? s.matches_finished }));
      setMatches(matchesData ?? []);
    } catch (_) { /* silent */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await loadPool();

    const [
      { count: survivor_paid },
      { count: polla_paid },
      { count: matches_finished },
      { count: matches_scheduled },
      { data: survivor_alive_rows },
      { data: matchesData },
    ] = await Promise.all([
      supabase.from('wc_enrollments').select('*', { count: 'exact', head: true }).eq('mode', 'survivor').eq('payment_status', 'paid'),
      supabase.from('wc_enrollments').select('*', { count: 'exact', head: true }).eq('mode', 'polla').eq('payment_status', 'paid'),
      supabase.from('wc_matches').select('*', { count: 'exact', head: true }).eq('status', 'finished'),
      supabase.from('wc_matches').select('*', { count: 'exact', head: true }).eq('status', 'scheduled'),
      supabase.from('wc_enrollments').select('id').eq('mode', 'survivor').eq('payment_status', 'paid').gt('lives_remaining', 0),
      supabase
        .from('wc_matches')
        .select(`
          id, match_number, phase, group_letter, scheduled_at, status,
          score_home, score_away, home_placeholder, away_placeholder,
          team_home_id, team_away_id,
          team_home:team_home_id ( code, name_es ),
          team_away:team_away_id ( code, name_es )
        `)
        .order('scheduled_at', { ascending: true })
        .limit(110),
    ]);

    setStats({
      survivor_paid: survivor_paid ?? 0,
      survivor_alive: survivor_alive_rows?.length ?? 0,
      polla_paid: polla_paid ?? 0,
      matches_finished: matches_finished ?? 0,
      matches_scheduled: matches_scheduled ?? 0,
    });
    setMatches(matchesData ?? []);
    setLoading(false);
  }, [loadPool]);

  useEffect(() => { load(); loadPayouts(); loadFreeEntries(); }, [load, loadPayouts, loadFreeEntries]);

  useEffect(() => {
    supabase.from('wc_teams').select('id, code, name_es, group_letter')
      .order('group_letter').order('name_es')
      .then(({ data }) => setTeams(data ?? []));
  }, []);

  const assignThird = useCallback(async (matchId, teamId) => {
    try {
      const { error } = await supabase.rpc('wc_admin_assign_third_place', {
        p_match_id: matchId, p_team_id: teamId, p_side: 'away',
      });
      if (error) throw error;
      await silentReload();
      Alert.alert('Listo', 'Tercero asignado al slot.');
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo asignar el tercero');
    }
  }, [silentReload]);

  const toggleFlag = async (flag, current) => {
    if (savingFlag) return;
    setSavingFlag(true);
    try {
      const args = {};
      args[`p_${flag}`] = !current;
      const { error } = await supabase.rpc('wc_admin_set_pool_visibility', args);
      if (error) throw error;
      await loadPool();
      // Al ACTIVAR la visibilidad (false→true) avisamos a todos por push, una sola vez.
      if (flag === 'is_visible' && !current) {
        const res = await broadcastNotification(
          '🏆 ¡Mundial 2026 disponible!',
          'Ya podés inscribirte al Survivor y la Polla. Jugá por el pozo.',
          { url: '/mundial' }
        );
        const a = res?.result?.audience ?? 0;
        if (res?.ok) {
          Alert.alert('📣 Aviso enviado', `Notificamos a ${a} ${a === 1 ? 'usuario' : 'usuarios'} con notificaciones activas.`);
        } else {
          Alert.alert('Visibilidad activada', `El módulo ya es visible, pero el aviso push no salió: ${res?.error ?? 'error'}. Podés reintentarlo apagando y volviendo a encender.`);
        }
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo actualizar el flag');
    } finally {
      setSavingFlag(false);
    }
  };

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

  const survivorPozo = (pool?.survivor_price ?? 10) * stats.survivor_paid * (1 - (pool?.fee_rate ?? 0.05));
  const pollaPozo = (pool?.polla_price ?? 15) * stats.polla_paid * (1 - (pool?.fee_rate ?? 0.05));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl * 2 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.neon}
          />
        }
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backText}>← Volver</Text>
          </TouchableOpacity>
          <Text style={styles.title}>MUNDIAL 2026</Text>
        </View>

        {/* Toggles */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Visibilidad y estado</Text>

          {/* Toggle admin-only para previsualizar/forzar el tema Modo 26 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SPACING.sm }}>
            <Text style={{ color: COLORS.white, fontFamily: FONTS.bodySemiBold, fontSize: 14 }}>Modo 26 (preview)</Text>
            <Switch value={modo26On} onValueChange={(v) => { setModo26On(v); setModo26(v); if (typeof window !== 'undefined' && window.location) window.location.reload(); }} />
          </View>

          <View style={styles.flagRow}>
            <View style={styles.flagInfo}>
              <Text style={styles.flagLabel}>Visible para todos</Text>
              <Text style={styles.flagDesc}>
                {pool?.is_visible
                  ? 'El módulo se ve en el tab principal de todos los usuarios.'
                  : 'Solo admins ven el módulo. Activar al lanzar.'}
              </Text>
            </View>
            <Switch
              value={!!pool?.is_visible}
              onValueChange={() => toggleFlag('is_visible', pool?.is_visible)}
              disabled={savingFlag}
              trackColor={{ true: COLORS.green, false: COLORS.line }}
              thumbColor={COLORS.white}
            />
          </View>

          <View style={styles.flagRow}>
            <View style={styles.flagInfo}>
              <Text style={styles.flagLabel}>Survivor abierto</Text>
              <Text style={styles.flagDesc}>Acepta inscripciones nuevas al modo Survivor.</Text>
            </View>
            <Switch
              value={!!pool?.survivor_open}
              onValueChange={() => toggleFlag('survivor_open', pool?.survivor_open)}
              disabled={savingFlag}
              trackColor={{ true: COLORS.green, false: COLORS.line }}
              thumbColor={COLORS.white}
            />
          </View>

          <View style={styles.flagRow}>
            <View style={styles.flagInfo}>
              <Text style={styles.flagLabel}>Polla abierta</Text>
              <Text style={styles.flagDesc}>Acepta inscripciones nuevas a la Polla Ganadora.</Text>
            </View>
            <Switch
              value={!!pool?.polla_open}
              onValueChange={() => toggleFlag('polla_open', pool?.polla_open)}
              disabled={savingFlag}
              trackColor={{ true: COLORS.green, false: COLORS.line }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsGrid}>
          <StatTile label="Inscritos Survivor" value={stats.survivor_paid} />
          <StatTile label="Vivos en Survivor" value={stats.survivor_alive} accent={COLORS.green} />
          <StatTile label="Inscritos Polla" value={stats.polla_paid} />
          <StatTile label="Partidos terminados" value={`${stats.matches_finished}/104`} />
          <StatTile label="Pozo Survivor" value={`$${survivorPozo.toFixed(0)}`} accent={COLORS.neon} />
          <StatTile label="Pozo Polla" value={`$${pollaPozo.toFixed(0)}`} accent={COLORS.neon} />
        </View>

        {/* Próximos / recientes matches con override */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Partidos · cargar resultado</Text>
          <Text style={styles.cardSubtitle}>
            Ingresá el marcador para cerrar un partido. Al guardar se ejecuta
            scoring de Polla y Survivor automáticamente.
          </Text>
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} onSaved={silentReload} />
          ))}
        </View>

        {teams.length > 0 && matches.some(m => (m.away_placeholder || '').startsWith('Mejor 3')) && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Asignar mejores terceros</Text>
          <Text style={styles.cardSubtitle}>
            Al cerrar la fase de grupos, asigná el 3° clasificado a cada slot de octavos según la tabla oficial del torneo de la combinación real. Sin esto, esos partidos no se pueden resolver.
          </Text>
          {matches.filter(m => (m.away_placeholder || '').startsWith('Mejor 3')).map(m => (
            <View key={m.id} style={styles.thirdRow}>
              <Text style={styles.thirdLabel}>M{m.match_number} · {m.away_placeholder}</Text>
              <TeamSelect teams={teams} value={m.team_away_id} onChange={(tid) => assignThird(m.id, tid)} placeholder="Asignar 3°" />
            </View>
          ))}
        </View>
        )}

        {/* Finalizar Survivor */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Finalizar Survivor</Text>
          <Text style={styles.cardSubtitle}>
            Solo disponible cuando todos los match_days de fase de grupos estén resueltos.
            Calcula ganadores, asigna premios y genera los registros de pago.
          </Text>
          <WCButton
            label={finalizingSurvivor ? 'Calculando…' : 'Finalizar Survivor'}
            variant="gold"
            size="md"
            onPress={finalizeSurvivor}
            loading={finalizingSurvivor}
            disabled={finalizingSurvivor}
          />
        </View>

        {/* Finalizar Polla */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Finalizar Polla</Text>
          <Text style={styles.cardSubtitle}>
            Ingresá los resultados reales del Mundial (se usan para resolver los bonus picks de cada jugador).
          </Text>
          <Text style={styles.flagLabel}>Equipos del podio</Text>
          <TeamSelect teams={teams} value={pollaInputs.champion_id} onChange={v => setPollaInputs(p => ({ ...p, champion_id: v }))} placeholder="Campeón" />
          <TeamSelect teams={teams} value={pollaInputs.runner_up_id} onChange={v => setPollaInputs(p => ({ ...p, runner_up_id: v }))} placeholder="Sub-campeón" />
          <TeamSelect teams={teams} value={pollaInputs.third_place_id} onChange={v => setPollaInputs(p => ({ ...p, third_place_id: v }))} placeholder="3er lugar" />
          <Text style={[styles.flagLabel, { marginTop: SPACING.sm }]}>Goleador y MVP (nombre exacto)</Text>
          <TextInput
            style={[styles.scoreInput, styles.textInputFull]}
            value={pollaInputs.top_scorer}
            onChangeText={v => setPollaInputs(p => ({ ...p, top_scorer: v }))}
            placeholder="Nombre goleador"
            placeholderTextColor={COLORS.gray}
          />
          <TextInput
            style={[styles.scoreInput, styles.textInputFull]}
            value={pollaInputs.mvp}
            onChangeText={v => setPollaInputs(p => ({ ...p, mvp: v }))}
            placeholder="Nombre MVP"
            placeholderTextColor={COLORS.gray}
          />
          <Text style={[styles.flagLabel, { marginTop: SPACING.sm }]}>Marcador de la Final</Text>
          <View style={styles.matchTeams}>
            <TextInput
              style={styles.scoreInput}
              value={pollaInputs.final_home}
              onChangeText={v => setPollaInputs(p => ({ ...p, final_home: v }))}
              keyboardType="number-pad"
              placeholder="-"
              placeholderTextColor={COLORS.gray}
              maxLength={2}
            />
            <Text style={styles.vs}>–</Text>
            <TextInput
              style={styles.scoreInput}
              value={pollaInputs.final_away}
              onChangeText={v => setPollaInputs(p => ({ ...p, final_away: v }))}
              keyboardType="number-pad"
              placeholder="-"
              placeholderTextColor={COLORS.gray}
              maxLength={2}
            />
          </View>
          <WCButton
            label={finalizingPolla ? 'Calculando…' : 'Finalizar Polla'}
            variant="primary"
            size="md"
            onPress={finalizePolla}
            loading={finalizingPolla}
            disabled={finalizingPolla}
            style={{ marginTop: SPACING.md }}
          />
        </View>

        {/* Polla Gratis — participantes + finalizar */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
            <Text style={styles.cardTitle}>Polla Gratis ({freeEntries.length})</Text>
            <TouchableOpacity onPress={loadFreeEntries} style={{ padding: 4 }}>
              <Text style={{ color: COLORS.neon, fontFamily: FONTS.bodyBold, fontSize: 12 }}>Actualizar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.cardSubtitle}>
            Revisá los participantes antes de premiar. Usa los MISMOS resultados de arriba. Premio: 20/10/5 créditos al top 3.
          </Text>
          {freeEntries.length === 0 ? (
            <Text style={[styles.cardSubtitle, { marginTop: SPACING.sm }]}>Sin participantes todavía.</Text>
          ) : (
            <View style={{ marginTop: SPACING.sm }}>
              {freeEntries.map((e, i) => (
                <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.line }}>
                  <Text style={{ width: 26, color: COLORS.gray, fontFamily: FONTS.bodyBold, fontSize: 12 }}>{e.rank_position ?? (i + 1)}</Text>
                  <Text style={{ flex: 1, color: COLORS.white, fontFamily: FONTS.body, fontSize: 13 }} numberOfLines={1}>
                    {e.users?.nombre ?? '—'} · {e.users?.correo ?? ''}
                  </Text>
                  <Text style={{ color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 12 }}>
                    {Number(e.bonus_points ?? 0)}pts{Number(e.prize_credits ?? 0) > 0 ? ` · ${Number(e.prize_credits)}créd` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <WCButton
            label={finalizingFree ? 'Calculando…' : 'Finalizar Polla Gratis'}
            variant="secondary"
            size="md"
            onPress={finalizeFreePolla}
            loading={finalizingFree}
            disabled={finalizingFree}
            style={{ marginTop: SPACING.md }}
          />
        </View>

        {/* Pagos a ganadores */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm }}>
            <Text style={styles.cardTitle}>Pagos a ganadores</Text>
            <TouchableOpacity onPress={loadPayouts} style={{ padding: 4 }}>
              <Text style={{ color: COLORS.neon, fontFamily: FONTS.bodyBold, fontSize: 12 }}>Actualizar</Text>
            </TouchableOpacity>
          </View>
          {loadingPayouts ? (
            <ActivityIndicator color={COLORS.neon} size="small" style={{ marginVertical: SPACING.md }} />
          ) : payouts.length === 0 ? (
            <Text style={styles.cardSubtitle}>Sin pagos pendientes. Finalizá Survivor o Polla para generarlos.</Text>
          ) : (
            payouts.map(p => (
              <PayoutRow key={p.id} payout={p} onPaid={loadPayouts} />
            ))
          )}
        </View>

        <View style={styles.notesCard}>
          <Text style={styles.notesTitle}>Notas del pool</Text>
          <Text style={styles.notesText}>{pool?.notes ?? '—'}</Text>
          <Text style={styles.notesMeta}>
            Deadline inscripciones: {new Date(pool?.enrollment_deadline ?? Date.now()).toLocaleString('es-PA')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ label, value, accent }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, accent && { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function MatchRow({ match, onSaved }) {
  const [home, setHome] = useState(match.score_home != null ? String(match.score_home) : '');
  const [away, setAway] = useState(match.score_away != null ? String(match.score_away) : '');
  const [penHome, setPenHome] = useState(match.penalties_home != null ? String(match.penalties_home) : '');
  const [penAway, setPenAway] = useState(match.penalties_away != null ? String(match.penalties_away) : '');
  const [saving, setSaving] = useState(false);

  const homeName = match.team_home?.name_es || match.team_home?.code || match.home_placeholder || '—';
  const awayName = match.team_away?.name_es || match.team_away?.code || match.away_placeholder || '—';
  const finished = match.status === 'finished';
  // En eliminatoria, un empate en los 90' se define por penales (sin esto el ganador queda null y da 0 pts a todos).
  const isKO = !!match.phase && match.phase !== 'group';
  const showPens = isKO && home !== '' && away !== '' && home === away;

  const save = async () => {
    const h = parseInt(home, 10);
    const a = parseInt(away, 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
      Alert.alert('Marcador inválido', 'Ingresá números >= 0 en ambos lados.');
      return;
    }
    let ph = null, pa = null;
    if (isKO && h === a) {
      ph = penHome === '' ? NaN : parseInt(penHome, 10);
      pa = penAway === '' ? NaN : parseInt(penAway, 10);
      if (Number.isNaN(ph) || Number.isNaN(pa) || ph < 0 || pa < 0 || ph === pa) {
        Alert.alert('Penales requeridos', 'Empate en eliminatoria: ingresá los penales (sin empate) para definir al ganador.');
        return;
      }
    }
    const scoreLabel = ph != null
      ? `${h}-${a} (pen ${ph}-${pa})`
      : `${h}-${a}`;
    const phaseLabel = PHASE_LABEL[match.phase] || match.phase || '';
    const groupLabel = match.group_letter ? ` · Grupo ${match.group_letter}` : '';
    const confirmMsg =
      `¿Confirmás ${homeName} ${scoreLabel} ${awayName}?\n\n` +
      `M${match.match_number ?? '—'} · ${phaseLabel}${groupLabel}\n\n` +
      `Esto recalcula puntos de la Polla y resuelve la jornada Survivor.`;
    Alert.alert(
      'Confirmar resultado',
      confirmMsg,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { error } = await supabase.rpc('wc_admin_override_match_result', {
                p_match_id: match.id,
                p_score_home: h,
                p_score_away: a,
                p_penalties_home: ph,
                p_penalties_away: pa,
              });
              if (error) throw error;
              await onSaved();
            } catch (e) {
              Alert.alert('Error', e.message || 'No se pudo guardar el resultado');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const date = new Date(match.scheduled_at);
  const dateLabel = date.toLocaleString('es-PA', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={[styles.matchRow, finished && styles.matchRowFinished]}>
      <View style={styles.matchHead}>
        <Text style={styles.matchNum}>M{match.match_number ?? '—'}</Text>
        <Text style={styles.matchPhase}>
          {PHASE_LABEL[match.phase]}{match.group_letter ? ` · ${match.group_letter}` : ''}
        </Text>
        <Text style={styles.matchDate}>{dateLabel}</Text>
      </View>
      <View style={styles.matchTeams}>
        <Text style={styles.teamName} numberOfLines={1}>{homeName}</Text>
        <TextInput
          style={styles.scoreInput}
          value={home}
          onChangeText={setHome}
          keyboardType="number-pad"
          placeholder="-"
          placeholderTextColor={COLORS.gray}
          maxLength={2}
        />
        <Text style={styles.vs}>vs</Text>
        <TextInput
          style={styles.scoreInput}
          value={away}
          onChangeText={setAway}
          keyboardType="number-pad"
          placeholder="-"
          placeholderTextColor={COLORS.gray}
          maxLength={2}
        />
        <Text style={styles.teamName} numberOfLines={1}>{awayName}</Text>
      </View>
      {showPens && (
        <View style={styles.penRow}>
          <Text style={styles.penLabel}>Penales</Text>
          <TextInput
            style={styles.scoreInput}
            value={penHome}
            onChangeText={setPenHome}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={COLORS.gray}
            maxLength={2}
          />
          <Text style={styles.vs}>-</Text>
          <TextInput
            style={styles.scoreInput}
            value={penAway}
            onChangeText={setPenAway}
            keyboardType="number-pad"
            placeholder="-"
            placeholderTextColor={COLORS.gray}
            maxLength={2}
          />
        </View>
      )}
      <WCButton
        label={finished ? 'Actualizar' : 'Guardar'}
        variant={finished ? 'gold' : 'primary'}
        size="md"
        onPress={save}
        loading={saving}
        disabled={saving}
        style={{ marginTop: 8 }}
      />
    </View>
  );
}

function TeamSelect({ teams, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = teams.find(t => t.id === value);
  const filtered = q
    ? teams.filter(t => `${t.name_es} ${t.code} ${t.group_letter}`.toLowerCase().includes(q.toLowerCase()))
    : teams;
  return (
    <>
      <TouchableOpacity style={styles.teamSelectBtn} onPress={() => setOpen(true)}>
        <Text style={[styles.teamSelectText, !selected && { color: COLORS.gray }]} numberOfLines={1}>
          {selected ? `${selected.name_es} (${selected.code})` : (placeholder || 'Elegí equipo')}
        </Text>
        <Text style={{ color: COLORS.gray2 }}>▾</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.tsOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.tsBox}>
            <TextInput
              style={[styles.scoreInput, styles.textInputFull]}
              value={q} onChangeText={setQ}
              placeholder="Buscar equipo…" placeholderTextColor={COLORS.gray} autoCapitalize="none"
            />
            <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
              {filtered.map(t => (
                <TouchableOpacity key={t.id} style={styles.tsRow} onPress={() => { onChange(t.id); setOpen(false); setQ(''); }}>
                  <Text style={styles.tsCode}>{t.code}</Text>
                  <Text style={styles.tsName} numberOfLines={1}>{t.name_es}</Text>
                  <Text style={styles.tsGrp}>{t.group_letter}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.tsCancel}>
              <Text style={styles.tsCancelText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function PayoutRow({ payout, onPaid }) {
  const [ref, setRef] = useState('');
  const [marking, setMarking] = useState(false);
  const isPaid = payout.status === 'paid';

  const markPaid = async () => {
    if (!ref.trim()) {
      Alert.alert('Referencia requerida', 'Ingresá una referencia de pago (número de transferencia, etc.).');
      return;
    }
    Alert.alert(
      'Marcar como pagado',
      `¿Confirmar pago de $${payout.amount} a ${payout.user?.nombre ?? 'Usuario'} con ref: ${ref}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setMarking(true);
            try {
              const { error } = await supabase.rpc('wc_admin_mark_payout_paid', {
                p_payout_id:   payout.id,
                p_payment_ref: ref.trim(),
              });
              if (error) throw error;
              await onPaid();
            } catch (e) {
              Alert.alert('Error', e.message || 'No se pudo marcar el pago');
            } finally {
              setMarking(false);
            }
          },
        },
      ],
    );
  };

  const badgeTone = isPaid ? 'success' : 'warning';
  const modeLabel = payout.pool_mode === 'survivor' ? 'SURVIVOR' : 'POLLA';

  return (
    <View style={styles.payoutRow}>
      <View style={styles.payoutHead}>
        <WCBadge label={modeLabel} tone={payout.pool_mode === 'survivor' ? 'neon' : 'magenta'} size="sm" />
        <WCBadge label={isPaid ? 'PAGADO' : 'PENDIENTE'} tone={badgeTone} size="sm" />
      </View>
      <Text style={styles.payoutUser}>{payout.user?.nombre ?? '—'}</Text>
      <Text style={styles.payoutEmail}>{payout.user?.correo ?? '—'}</Text>
      <Text style={styles.payoutAmount}>${Number(payout.amount).toFixed(2)}</Text>
      {payout.notes ? <Text style={styles.payoutNotes}>{payout.notes}</Text> : null}
      {isPaid ? (
        <Text style={styles.payoutPaidRef}>Ref: {payout.payment_ref ?? '—'} · {payout.paid_at ? new Date(payout.paid_at).toLocaleString('es-PA') : ''}</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <TextInput
            style={[styles.scoreInput, { flex: 1, height: 36 }]}
            value={ref}
            onChangeText={setRef}
            placeholder="Ref. transferencia"
            placeholderTextColor={COLORS.gray}
            autoCapitalize="none"
          />
          <WCButton
            label={marking ? '…' : 'Marcar pagado'}
            variant="secondary"
            size="sm"
            onPress={markPaid}
            loading={marking}
            disabled={marking}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  back: { padding: SPACING.sm },
  backText: { color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 14 },
  title: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2,
  },

  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md,
  },
  cardTitle: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white,
    letterSpacing: 1, marginBottom: SPACING.sm,
  },
  cardSubtitle: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2,
    marginBottom: SPACING.md, lineHeight: 17,
  },

  flagRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  flagInfo: { flex: 1, marginRight: SPACING.md },
  flagLabel: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white },
  flagDesc:  { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginTop: 2 },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: SPACING.sm, marginBottom: SPACING.md,
  },
  statTile: {
    width: '48%',
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.md, padding: SPACING.md,
    alignItems: 'center', borderColor: COLORS.line, borderWidth: 1,
  },
  statValue: {
    fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 1,
  },
  statLabel: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 2,
  },

  matchRow: {
    backgroundColor: COLORS.card2,
    borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.sm, marginBottom: SPACING.sm,
  },
  matchRowFinished: { borderColor: COLORS.green + '66' },
  matchHead: {
    flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6,
  },
  matchNum:   { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon },
  matchPhase: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  matchDate:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  matchTeams: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  teamName: {
    flex: 1, fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white,
  },
  scoreInput: {
    width: 40, height: 36, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1,
    textAlign: 'center', color: COLORS.white,
    fontFamily: FONTS.heading, fontSize: 18,
    backgroundColor: COLORS.bg,
  },
  vs: { color: COLORS.gray, fontFamily: FONTS.body, fontSize: 11 },
  penRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, justifyContent: 'flex-end' },
  penLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gold,
    letterSpacing: 1, textTransform: 'uppercase', marginRight: 4,
  },
  saveBtn: {
    marginTop: 8, backgroundColor: COLORS.red,
    paddingVertical: 8, borderRadius: RADIUS.sm,
    alignItems: 'center',
  },
  saveBtnText: {
    color: COLORS.white, fontFamily: FONTS.bodyBold, fontSize: 13, letterSpacing: 1,
  },

  notesCard: {
    backgroundColor: COLORS.card2,
    borderColor: COLORS.gold + '44', borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md,
  },

  textInputFull: {
    width: '100%', height: 38, marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm, textAlign: 'left', fontSize: 13,
  },

  payoutRow: {
    backgroundColor: COLORS.card2,
    borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  payoutHead: {
    flexDirection: 'row', gap: 8, marginBottom: 6,
  },
  payoutUser: {
    fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white,
  },
  payoutEmail: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 1,
  },
  payoutAmount: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.neon,
    marginTop: 4, letterSpacing: 1,
  },
  payoutNotes: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2,
  },
  payoutPaidRef: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.green,
    marginTop: 4,
  },

  teamSelectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', minHeight: 40, marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1, backgroundColor: COLORS.bg,
  },
  teamSelectText: { flex: 1, color: COLORS.white, fontFamily: FONTS.body, fontSize: 13 },
  tsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', padding: SPACING.lg },
  tsBox: { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, borderColor: COLORS.line, borderWidth: 1, padding: SPACING.md },
  tsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  tsCode: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.neon, width: 44 },
  tsName: { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  tsGrp: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },
  tsCancel: { marginTop: SPACING.sm, alignItems: 'center', paddingVertical: 10 },
  tsCancelText: { color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 13 },
  thirdRow: { marginBottom: SPACING.sm },
  thirdLabel: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2, marginBottom: 4 },
  notesTitle: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gold, letterSpacing: 1,
  },
  notesText: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 4, lineHeight: 18,
  },
  notesMeta: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 8,
  },
});
