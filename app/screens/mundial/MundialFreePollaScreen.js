import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WhatsAppSupport from '../../../components/mundial/WhatsAppSupport';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCButton } from '../../../components/mundial/WCComponents';

// Polla Gratis: solo predicciones finales (campeón, sub, 3°, goleador, MVP, marcador).
// Sin pago, 50 cupos, 1 por usuario. Premio en créditos al wallet (20/10/5 top 3).
export default function MundialFreePollaScreen({ navigation }) {
  const { user, refreshProfile } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [teams, setTeams] = useState([]);
  const [board, setBoard] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(null);
  const [picks, setPicks] = useState({
    champion_team_id: null,
    runner_up_team_id: null,
    third_place_team_id: null,
    top_scorer_name: '',
    mvp_name: '',
    final_score_home: '',
    final_score_away: '',
  });

  const teamsById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);

  async function load() {
    const [{ data: st }, { data: t }, { data: lb }] = await Promise.all([
      supabase.rpc('wc_free_polla_status'),
      supabase.from('wc_teams').select('id, code, name_es, group_letter').order('group_letter').order('name_es'),
      supabase.rpc('wc_free_polla_leaderboard'),
    ]);
    setStatus(st ?? null);
    setTeams(t ?? []);
    setBoard(lb ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user?.id]);

  async function submit() {
    if (submitting) return;
    const { champion_team_id, runner_up_team_id, third_place_team_id, top_scorer_name, mvp_name, final_score_home, final_score_away } = picks;
    if (!champion_team_id || !runner_up_team_id || !third_place_team_id) {
      Alert.alert('Faltan picks', 'Elegí campeón, subcampeón y 3er lugar.'); return;
    }
    if (champion_team_id === runner_up_team_id || champion_team_id === third_place_team_id || runner_up_team_id === third_place_team_id) {
      Alert.alert('Picks repetidos', 'Campeón, subcampeón y 3er lugar deben ser equipos distintos.'); return;
    }
    if (!top_scorer_name.trim() || !mvp_name.trim()) {
      Alert.alert('Faltan picks', 'Escribí el goleador y el MVP.'); return;
    }
    const fh = parseInt(final_score_home, 10), fa = parseInt(final_score_away, 10);
    if (Number.isNaN(fh) || Number.isNaN(fa) || fh < 0 || fa < 0 || fh > 20 || fa > 20) {
      Alert.alert('Marcador inválido', 'Predicción del marcador final: números 0-20.'); return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('wc_free_polla_join', {
        p_champion_team_id: champion_team_id,
        p_runner_up_team_id: runner_up_team_id,
        p_third_place_team_id: third_place_team_id,
        p_top_scorer_name: top_scorer_name.trim(),
        p_mvp_name: mvp_name.trim(),
        p_final_score_home: fh,
        p_final_score_away: fa,
      });
      if (error) throw error;
      await refreshProfile();
      await load();
      Alert.alert('¡Estás dentro!', `Tomaste el cupo ${data?.slot}/${data?.slots_total} de la Polla Gratis. Mucha suerte 🍀`);
    } catch (e) {
      Alert.alert('No se pudo participar', e.message || 'Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <MundialScreenFrame>
        <SafeAreaView style={styles.safe}>
          <ActivityIndicator size="large" color={COLORS.neon} style={{ marginTop: 80 }} />
        </SafeAreaView>
      </MundialScreenFrame>
    );
  }

  const slotsUsed = status?.slots_used ?? 0;
  const slotsTotal = status?.slots_total ?? 50;
  const full = slotsUsed >= slotsTotal;
  const closed = status?.closed || !status?.open;
  const entered = status?.entered;
  const mine = status?.my_entry;

  return (
    <MundialScreenFrame>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backLink}>← Volver</Text>
          </TouchableOpacity>

          <WhatsAppSupport label="¿Dudas? Consultá por WhatsApp" style={{ marginBottom: 12 }} />

          <View style={styles.header}>
            <Text style={styles.kicker}>SOLO POR DIVERSIÓN</Text>
            <Text style={styles.title}>POLLA GRATIS</Text>
            <Text style={styles.subtitle}>
              Sin pago, sin partidos: solo tus predicciones finales. Premio a los 3 mejores:
              <Text style={styles.bold}> 20, 10 y 5 créditos</Text> para tus birreas.
              {' '}En caso de empate, el premio se reparte en partes iguales.
            </Text>
            <View style={styles.slotsPill}>
              <Text style={styles.slotsText}>Cupos: {slotsUsed}/{slotsTotal}</Text>
            </View>
          </View>

          {entered ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>✓ Ya estás participando</Text>
              <Text style={styles.cardText}>
                Tus predicciones quedaron registradas. El ranking se calcula al terminar el Mundial.
              </Text>
              {mine?.rank_position ? (
                <Text style={styles.myRank}>Tu posición: #{mine.rank_position} · {Number(mine.bonus_points ?? 0)} pts
                  {Number(mine.prize_credits ?? 0) > 0 ? ` · ganaste ${Number(mine.prize_credits)} créditos 🎉` : ''}
                </Text>
              ) : null}
            </View>
          ) : closed ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Inscripción cerrada</Text>
              <Text style={styles.cardText}>La Polla Gratis ya no acepta más participantes.</Text>
            </View>
          ) : full ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Cupos agotados</Text>
              <Text style={styles.cardText}>Se llenaron los {slotsTotal} cupos. ¡La próxima será!</Text>
            </View>
          ) : (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Tus predicciones del Mundial</Text>
              <TeamRow label="Campeón (50 pts)" teamId={picks.champion_team_id} teamsById={teamsById} onPress={() => setShowTeamPicker('champion_team_id')} />
              <TeamRow label="Subcampeón (30 pts)" teamId={picks.runner_up_team_id} teamsById={teamsById} onPress={() => setShowTeamPicker('runner_up_team_id')} />
              <TeamRow label="3er lugar (20 pts)" teamId={picks.third_place_team_id} teamsById={teamsById} onPress={() => setShowTeamPicker('third_place_team_id')} />

              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Goleador (Bota de Oro · 25 pts)</Text>
                <TextInput style={styles.input} value={picks.top_scorer_name}
                  onChangeText={(v) => setPicks({ ...picks, top_scorer_name: v })}
                  placeholder="Ej: Lionel Messi" placeholderTextColor={COLORS.gray} />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Mejor jugador (Balón de Oro · 15 pts)</Text>
                <TextInput style={styles.input} value={picks.mvp_name}
                  onChangeText={(v) => setPicks({ ...picks, mvp_name: v })}
                  placeholder="Ej: Kylian Mbappé" placeholderTextColor={COLORS.gray} />
              </View>
              <View style={styles.inputRow}>
                <Text style={styles.inputLabel}>Marcador exacto de la final (desempate)</Text>
                <View style={styles.scoreRow}>
                  <TextInput style={styles.scoreInput} value={picks.final_score_home}
                    onChangeText={(v) => setPicks({ ...picks, final_score_home: v.replace(/[^0-9]/g, '') })}
                    keyboardType="number-pad" placeholder="0" placeholderTextColor={COLORS.gray} maxLength={2} />
                  <Text style={styles.vs}>–</Text>
                  <TextInput style={styles.scoreInput} value={picks.final_score_away}
                    onChangeText={(v) => setPicks({ ...picks, final_score_away: v.replace(/[^0-9]/g, '') })}
                    keyboardType="number-pad" placeholder="0" placeholderTextColor={COLORS.gray} maxLength={2} />
                </View>
              </View>

              <WCButton
                label={submitting ? 'ENVIANDO…' : 'PARTICIPAR GRATIS'}
                variant="secondary" size="lg" onPress={submit}
                disabled={submitting} loading={submitting}
                style={{ marginTop: SPACING.md }}
              />
              <Text style={styles.note}>Una sola participación por persona. No se puede modificar después de enviar.</Text>
            </View>
          )}

          {/* Leaderboard */}
          {board.length > 0 && (
            <View style={styles.boardCard}>
              <Text style={styles.boardTitle}>🏆 Tabla ({board.length})</Text>
              {board.slice(0, 30).map((row, i) => (
                <View key={i} style={[styles.boardRow, row.is_me && styles.boardRowMe]}>
                  <Text style={styles.boardPos}>{row.rank_position ?? (i + 1)}</Text>
                  <Text style={[styles.boardName, row.is_me && styles.boardNameMe]} numberOfLines={1}>
                    {row.nombre}{row.is_me ? ' (vos)' : ''}
                  </Text>
                  <Text style={styles.boardPts}>{Number(row.bonus_points ?? 0)} pts</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        <Modal visible={!!showTeamPicker} animationType="slide" transparent onRequestClose={() => setShowTeamPicker(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Elegí un equipo</Text>
              <ScrollView style={{ maxHeight: 460 }}>
                {teams.map((t) => (
                  <TouchableOpacity key={t.id} style={styles.teamPick}
                    onPress={() => { setPicks({ ...picks, [showTeamPicker]: t.id }); setShowTeamPicker(null); }}>
                    <Text style={styles.teamCode}>{t.code}</Text>
                    <Text style={styles.teamFlex} numberOfLines={1}>{t.name_es}</Text>
                    <Text style={styles.teamGroup}>{t.group_letter}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowTeamPicker(null)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

function TeamRow({ label, teamId, teamsById, onPress }) {
  const t = teamId ? teamsById[teamId] : null;
  return (
    <TouchableOpacity style={styles.teamRow} onPress={onPress}>
      <Text style={styles.teamRowLabel}>{label}</Text>
      <View style={styles.teamRowValue}>
        {t ? (
          <>
            <Text style={styles.teamRowCode}>{t.code}</Text>
            <Text style={styles.teamRowName} numberOfLines={1}>{t.name_es}</Text>
          </>
        ) : (
          <Text style={styles.teamRowEmpty}>Tocá para elegir</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  back: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.18)', borderWidth: 1, borderRadius: RADIUS.full,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: SPACING.sm,
  },
  backLink: { color: COLORS.bg, fontFamily: FONTS.bodyBold, fontSize: 14 },

  header: {
    backgroundColor: 'rgba(255,255,255,0.92)', borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.lg,
  },
  kicker: { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.magentaText || COLORS.magenta, letterSpacing: 3 },
  title: { fontFamily: FONTS.heading, fontSize: 36, color: COLORS.bg, letterSpacing: 1.5, marginTop: 2 },
  subtitle: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.bg, lineHeight: 20, marginTop: 6 },
  bold: { fontFamily: FONTS.bodyBold, color: COLORS.bg },
  slotsPill: {
    alignSelf: 'flex-start', backgroundColor: COLORS.bg, borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 6, marginTop: SPACING.md,
  },
  slotsText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, letterSpacing: 1 },

  card: {
    backgroundColor: 'rgba(10,14,20,0.92)', borderColor: COLORS.neon + '66', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.lg,
  },
  cardTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1, marginBottom: 6 },
  cardText: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, lineHeight: 20 },
  myRank: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.gold, marginTop: SPACING.md },

  formCard: {
    backgroundColor: 'rgba(10,14,20,0.93)', borderColor: COLORS.magenta + '66', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.lg,
  },
  formTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.magentaText || COLORS.magenta, letterSpacing: 1, marginBottom: SPACING.sm },
  teamRow: { paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  teamRowLabel: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2, textTransform: 'uppercase', letterSpacing: 1 },
  teamRowValue: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  teamRowCode: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  teamRowName: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, flex: 1 },
  teamRowEmpty: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2 },

  inputRow: { marginTop: SPACING.md },
  inputLabel: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.72)', borderColor: COLORS.line, borderWidth: 1, borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm, paddingVertical: 10, color: COLORS.white, fontFamily: FONTS.body, fontSize: 14,
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreInput: {
    width: 60, height: 50, borderRadius: RADIUS.sm, borderColor: COLORS.line, borderWidth: 1,
    textAlign: 'center', color: COLORS.white, fontFamily: FONTS.heading, fontSize: 28, backgroundColor: 'rgba(0,0,0,0.72)',
  },
  vs: { color: COLORS.gray, fontFamily: FONTS.heading, fontSize: 22 },
  note: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: SPACING.sm, textAlign: 'center', lineHeight: 16 },

  boardCard: {
    backgroundColor: 'rgba(10,14,20,0.92)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md,
  },
  boardTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, marginBottom: SPACING.sm },
  boardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  boardRowMe: { backgroundColor: COLORS.neon + '14', borderRadius: RADIUS.sm },
  boardPos: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, width: 34, textAlign: 'center' },
  boardName: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, flex: 1 },
  boardNameMe: { fontFamily: FONTS.bodyBold, color: COLORS.neon },
  boardPts: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: 'rgba(10,14,20,0.97)', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md, maxHeight: '85%',
  },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1, marginBottom: SPACING.md, textAlign: 'center' },
  teamPick: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  teamCode: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  teamFlex: { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  teamGroup: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2 },
  modalCancel: { marginTop: SPACING.md, padding: 12, alignItems: 'center' },
  modalCancelText: { color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 14 },
});
