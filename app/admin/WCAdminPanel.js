import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useWcStore from '../../store/wcStore';

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingFlag, setSavingFlag] = useState(false);

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

  useEffect(() => { load(); }, [load]);

  const toggleFlag = async (flag, current) => {
    if (savingFlag) return;
    setSavingFlag(true);
    try {
      const args = {};
      args[`p_${flag}`] = !current;
      const { error } = await supabase.rpc('wc_admin_set_pool_visibility', args);
      if (error) throw error;
      await loadPool();
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
            <MatchRow key={m.id} match={m} onSaved={load} />
          ))}
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
  const [saving, setSaving] = useState(false);

  const homeName = match.team_home?.name_es || match.team_home?.code || match.home_placeholder || '—';
  const awayName = match.team_away?.name_es || match.team_away?.code || match.away_placeholder || '—';
  const finished = match.status === 'finished';

  const save = async () => {
    const h = parseInt(home, 10);
    const a = parseInt(away, 10);
    if (Number.isNaN(h) || Number.isNaN(a) || h < 0 || a < 0) {
      Alert.alert('Marcador inválido', 'Ingresá números >= 0 en ambos lados.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('wc_admin_override_match_result', {
        p_match_id: match.id,
        p_score_home: h,
        p_score_away: a,
      });
      if (error) throw error;
      await onSaved();
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo guardar el resultado');
    } finally {
      setSaving(false);
    }
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
      <TouchableOpacity
        style={[styles.saveBtn, saving && { opacity: 0.5 }]}
        onPress={save}
        disabled={saving}
      >
        <Text style={styles.saveBtnText}>
          {saving ? 'Guardando…' : finished ? 'Actualizar' : 'Guardar'}
        </Text>
      </TouchableOpacity>
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
