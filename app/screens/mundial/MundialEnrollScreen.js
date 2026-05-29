import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';

export default function MundialEnrollScreen({ route, navigation }) {
  const mode = route?.params?.mode ?? 'survivor';
  const { user, refreshProfile } = useAuthStore();
  const { pool, loadPool } = useWcStore();
  const [enrollment, setEnrollment] = useState(null);
  const [teams, setTeams] = useState([]);
  const [bonus, setBonus] = useState({
    champion_team_id: null,
    runner_up_team_id: null,
    third_place_team_id: null,
    top_scorer_name: '',
    mvp_name: '',
    final_score_home: '',
    final_score_away: '',
  });
  const [showTeamPicker, setShowTeamPicker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const price = mode === 'survivor' ? pool?.survivor_price : pool?.polla_price;
  const walletBalance = user?.wallets?.balance ?? 0;
  const isPolla = mode === 'polla';
  const enrolled = enrollment?.payment_status === 'paid';

  useEffect(() => {
    (async () => {
      await loadPool();
      const { data: e } = await supabase
        .from('wc_enrollments')
        .select('*')
        .eq('user_id', user.id)
        .eq('mode', mode)
        .maybeSingle();
      setEnrollment(e);
      const { data: t } = await supabase
        .from('wc_teams')
        .select('id, code, name_es, group_letter')
        .order('group_letter')
        .order('name_es');
      setTeams(t ?? []);
      setLoading(false);
    })();
  }, [mode, user.id, loadPool]);

  const teamsById = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams]);

  const handleEnroll = async () => {
    if (processing) return;
    if (walletBalance < price) {
      Alert.alert('Saldo insuficiente', `Necesitás $${price} en tu wallet. Tenés $${walletBalance.toFixed(2)}.`);
      return;
    }

    // Validar bonus picks si es polla
    if (isPolla) {
      const { champion_team_id, runner_up_team_id, third_place_team_id, top_scorer_name, mvp_name, final_score_home, final_score_away } = bonus;
      if (!champion_team_id || !runner_up_team_id || !third_place_team_id) {
        Alert.alert('Faltan picks', 'Elegí campeón, subcampeón y 3er lugar.');
        return;
      }
      if (!top_scorer_name.trim() || !mvp_name.trim()) {
        Alert.alert('Faltan picks', 'Escribí el nombre del goleador y del MVP.');
        return;
      }
      const fh = parseInt(final_score_home, 10);
      const fa = parseInt(final_score_away, 10);
      if (Number.isNaN(fh) || Number.isNaN(fa) || fh < 0 || fa < 0 || fh > 20 || fa > 20) {
        Alert.alert('Marcador inválido', 'Predicción del marcador final: números 0-20.');
        return;
      }
      if (champion_team_id === runner_up_team_id || champion_team_id === third_place_team_id || runner_up_team_id === third_place_team_id) {
        Alert.alert('Picks repetidos', 'Campeón, subcampeón y 3er lugar deben ser equipos distintos.');
        return;
      }
    }

    setProcessing(true);
    try {
      // 1) Crear enrollment pending
      const { data: enrollId, error: e1 } = await supabase.rpc('wc_create_pending_enrollment', {
        p_user_id: user.id,
        p_mode: mode,
      });
      if (e1) throw e1;

      // 2) Si polla, guardar bonus picks
      if (isPolla) {
        const { error: e2 } = await supabase.rpc('wc_submit_bonus_picks', {
          p_user_id: user.id,
          p_champion_team_id:    bonus.champion_team_id,
          p_runner_up_team_id:   bonus.runner_up_team_id,
          p_third_place_team_id: bonus.third_place_team_id,
          p_top_scorer_name:     bonus.top_scorer_name.trim(),
          p_top_scorer_player_id: null,
          p_mvp_name:            bonus.mvp_name.trim(),
          p_mvp_player_id:       null,
          p_final_score_home:    parseInt(bonus.final_score_home, 10),
          p_final_score_away:    parseInt(bonus.final_score_away, 10),
        });
        if (e2) throw e2;
      }

      // 3) Pagar con wallet
      const { error: e3 } = await supabase.rpc('wc_pay_enrollment_wallet', {
        p_user_id: user.id,
        p_enrollment_id: enrollId,
      });
      if (e3) throw e3;

      Alert.alert('¡Inscripción confirmada!', `Estás dentro del ${isPolla ? 'Polla Ganadora' : 'Survivor 3 Vidas'}.`);
      await refreshProfile();
      navigation.replace(isPolla ? 'MundialPolla' : 'MundialSurvivor');
    } catch (err) {
      Alert.alert('Error', err.message || 'No se pudo procesar la inscripción.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color={COLORS.neon} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (enrolled) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.alreadyWrap}>
          <Text style={styles.alreadyTitle}>Ya estás inscrito</Text>
          <Text style={styles.alreadyText}>
            Inscripción confirmada para {isPolla ? 'Polla Ganadora' : 'Survivor 3 Vidas'}.
          </Text>
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => navigation.replace(isPolla ? 'MundialPolla' : 'MundialSurvivor')}
          >
            <Text style={styles.payBtnText}>IR AL JUEGO</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>← Volver</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backLink}>← Volver</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{isPolla ? 'POLLA GANADORA' : 'SURVIVOR 3 VIDAS'}</Text>
        <Text style={styles.priceBig}>${price}</Text>
        <Text style={styles.subtitle}>
          {isPolla
            ? 'Predice marcadores de los 104 partidos. 3-5-8 pts por acierto x multiplicador por fase.'
            : 'Pick 1 equipo por jornada-día. Cada equipo máximo 2 veces en grupos. Sobreviví la fase de grupos.'}
        </Text>

        <View style={styles.walletCard}>
          <Text style={styles.walletLabel}>Tu saldo wallet</Text>
          <Text style={styles.walletValue}>${walletBalance.toFixed(2)}</Text>
          {walletBalance < price && (
            <Text style={styles.walletWarn}>
              Necesitás ${(price - walletBalance).toFixed(2)} más. Recargá en Wallet.
            </Text>
          )}
        </View>

        {isPolla && (
          <View style={styles.bonusBlock}>
            <Text style={styles.bonusTitle}>Bonus picks pre-temporada (obligatorios)</Text>
            <Text style={styles.bonusDesc}>
              5 predicciones para el final del Mundial. Suman puntos extra si aciertan.
            </Text>

            <BonusTeamRow
              label="Campeón (50 pts)"
              teamId={bonus.champion_team_id}
              teamsById={teamsById}
              onPress={() => setShowTeamPicker('champion_team_id')}
            />
            <BonusTeamRow
              label="Subcampeón (30 pts)"
              teamId={bonus.runner_up_team_id}
              teamsById={teamsById}
              onPress={() => setShowTeamPicker('runner_up_team_id')}
            />
            <BonusTeamRow
              label="3er lugar (20 pts)"
              teamId={bonus.third_place_team_id}
              teamsById={teamsById}
              onPress={() => setShowTeamPicker('third_place_team_id')}
            />

            <View style={styles.bonusInputRow}>
              <Text style={styles.bonusInputLabel}>Goleador (Bota de Oro · 25 pts)</Text>
              <TextInput
                style={styles.bonusInput}
                value={bonus.top_scorer_name}
                onChangeText={(v) => setBonus({ ...bonus, top_scorer_name: v })}
                placeholder="Ej: Lionel Messi"
                placeholderTextColor={COLORS.gray}
              />
            </View>

            <View style={styles.bonusInputRow}>
              <Text style={styles.bonusInputLabel}>Mejor jugador (Balón de Oro · 15 pts)</Text>
              <TextInput
                style={styles.bonusInput}
                value={bonus.mvp_name}
                onChangeText={(v) => setBonus({ ...bonus, mvp_name: v })}
                placeholder="Ej: Kylian Mbappé"
                placeholderTextColor={COLORS.gray}
              />
            </View>

            <View style={styles.bonusInputRow}>
              <Text style={styles.bonusInputLabel}>Marcador exacto de la final (tiebreaker)</Text>
              <View style={styles.scoreInputRow}>
                <TextInput
                  style={styles.scoreInput}
                  value={bonus.final_score_home}
                  onChangeText={(v) => setBonus({ ...bonus, final_score_home: v.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.gray}
                  maxLength={2}
                />
                <Text style={styles.vs}>–</Text>
                <TextInput
                  style={styles.scoreInput}
                  value={bonus.final_score_away}
                  onChangeText={(v) => setBonus({ ...bonus, final_score_away: v.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.gray}
                  maxLength={2}
                />
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.payBtn, (processing || walletBalance < price) && { opacity: 0.5 }]}
          onPress={handleEnroll}
          disabled={processing || walletBalance < price}
        >
          <Text style={styles.payBtnText}>
            {processing ? 'PROCESANDO…' : `INSCRIBIRME · $${price}`}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Pago con wallet credit. Yappy directo próximamente.
        </Text>
      </ScrollView>

      <Modal
        visible={!!showTeamPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTeamPicker(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Elegí un equipo</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {teams.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.teamRow}
                  onPress={() => {
                    setBonus({ ...bonus, [showTeamPicker]: t.id });
                    setShowTeamPicker(null);
                  }}
                >
                  <Text style={styles.teamCode}>{t.code}</Text>
                  <Text style={styles.teamFlex} numberOfLines={1}>{t.name_es}</Text>
                  <Text style={styles.teamGroup}>{t.group_letter}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setShowTeamPicker(null)}
            >
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function BonusTeamRow({ label, teamId, teamsById, onPress }) {
  const t = teamId ? teamsById[teamId] : null;
  return (
    <TouchableOpacity style={styles.bonusTeamRow} onPress={onPress}>
      <Text style={styles.bonusTeamLabel}>{label}</Text>
      <View style={styles.bonusTeamValue}>
        {t ? (
          <>
            <Text style={styles.bonusTeamCode}>{t.code}</Text>
            <Text style={styles.bonusTeamName} numberOfLines={1}>{t.name_es}</Text>
          </>
        ) : (
          <Text style={styles.bonusTeamEmpty}>Tocá para elegir</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  back: { paddingVertical: 4, marginBottom: SPACING.sm },
  backLink: { color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 14 },
  title: {
    fontFamily: FONTS.heading, fontSize: 32, color: COLORS.white,
    letterSpacing: 1.5, marginTop: 8,
  },
  priceBig: {
    fontFamily: FONTS.heading, fontSize: 52, color: COLORS.neon,
    letterSpacing: 1, marginTop: 6,
  },
  subtitle: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    lineHeight: 20, marginTop: 4, marginBottom: SPACING.lg,
  },

  walletCard: {
    backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.lg,
  },
  walletLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  walletValue: {
    fontFamily: FONTS.heading, fontSize: 32, color: COLORS.white,
    letterSpacing: 1, marginTop: 4,
  },
  walletWarn: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.red2,
    marginTop: 6,
  },

  bonusBlock: {
    backgroundColor: COLORS.card, borderColor: COLORS.magenta + '44',
    borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  bonusTitle: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.magenta,
    letterSpacing: 1, marginBottom: 4,
  },
  bonusDesc: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2,
    marginBottom: SPACING.md, lineHeight: 17,
  },
  bonusTeamRow: {
    paddingVertical: SPACING.sm, borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  bonusTeamLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  bonusTeamValue: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  bonusTeamCode:  { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  bonusTeamName:  { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, flex: 1 },
  bonusTeamEmpty: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },

  bonusInputRow: { marginTop: SPACING.md },
  bonusInputLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  bonusInput: {
    backgroundColor: COLORS.bg, borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 10,
    color: COLORS.white, fontFamily: FONTS.body, fontSize: 14,
  },
  scoreInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12 },
  scoreInput: {
    width: 60, height: 50, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1,
    textAlign: 'center', color: COLORS.white,
    fontFamily: FONTS.heading, fontSize: 28,
    backgroundColor: COLORS.bg,
  },
  vs: { color: COLORS.gray, fontFamily: FONTS.heading, fontSize: 22 },

  payBtn: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.md,
    paddingVertical: 16, alignItems: 'center', marginTop: SPACING.md,
    ...SHADOWS.glow,
  },
  payBtnText: {
    color: COLORS.white, fontFamily: FONTS.heading,
    fontSize: 18, letterSpacing: 2,
  },
  footnote: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray,
    textAlign: 'center', marginTop: SPACING.md, fontStyle: 'italic',
  },

  alreadyWrap: { padding: SPACING.lg, marginTop: 40 },
  alreadyTitle: {
    fontFamily: FONTS.heading, fontSize: 26, color: COLORS.neon,
    letterSpacing: 1, marginBottom: 8,
  },
  alreadyText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    marginBottom: SPACING.lg, lineHeight: 20,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md,
    maxHeight: '85%',
  },
  modalTitle: {
    fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white,
    letterSpacing: 1, marginBottom: SPACING.md, textAlign: 'center',
  },
  teamRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.line,
  },
  teamCode:  { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, width: 50 },
  teamFlex:  { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  teamGroup: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2 },
  modalCancel: {
    marginTop: SPACING.md, padding: 12, alignItems: 'center',
  },
  modalCancelText: { color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 14 },
});
