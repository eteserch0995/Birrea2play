import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCButton, WCBadge } from '../../../components/mundial/WCComponents';

// Version del doc de Terminos del Mundial. DEBE coincidir con MundialTermsScreen
// y docs/terminos-mundial.html. Bump aqui al actualizar el texto legal.
const MUNDIAL_TYC_VERSION = '2026-05-30';

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
  const [paymentMethod, setPaymentMethod] = useState('wallet');
  const [yappyPhone, setYappyPhone] = useState('');
  const [yappyStep, setYappyStep] = useState('idle'); // idle | waiting | confirmed
  const yappyPollRef = useRef(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

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

    // Gate legal: debe aceptar los Terminos del Mundial ANTES de ir a pago.
    if (!acceptedTerms) {
      Alert.alert('Aceptá los Términos', 'Para inscribirte debés leer y aceptar los Términos y Condiciones del Mundial.');
      return;
    }

    // Validar método de pago
    if (paymentMethod === 'wallet' && walletBalance < price) {
      Alert.alert('Saldo insuficiente', `Necesitás $${price} en tu wallet. Tenés $${walletBalance.toFixed(2)}. Probá con Yappy o recargá tu wallet primero.`);
      return;
    }
    if (paymentMethod === 'yappy') {
      const cleanPhone = String(yappyPhone).replace(/\D/g, '');
      if (cleanPhone.length < 7 || cleanPhone.length > 12) {
        Alert.alert('Número Yappy inválido', 'Ingresá tu número de teléfono Yappy (ej: 6XXX-XXXX).');
        return;
      }
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

      // 1.b) Registrar consentimiento legal (defendible) ligado a este enrollment, ANTES del pago
      const { error: eConsent } = await supabase.rpc('wc_record_consent', {
        p_user_id: user.id,
        p_doc: 'mundial_tyc',
        p_version: MUNDIAL_TYC_VERSION,
        p_mode: mode,
        p_enrollment_id: enrollId,
        p_user_agent: `${Platform.OS} ${Platform.Version ?? ''}`.trim(),
        p_source: 'mundial_enroll',
      });
      if (eConsent) throw eConsent;

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

      // 3) Pagar — wallet directo, o Yappy con polling
      if (paymentMethod === 'wallet') {
        const { error: e3 } = await supabase.rpc('wc_pay_enrollment_wallet', {
          p_user_id: user.id,
          p_enrollment_id: enrollId,
        });
        if (e3) throw e3;
      } else {
        // Yappy: iniciar orden, mostrar "Esperando confirmación", poll hasta executed
        setYappyStep('waiting');
        const cleanPhone = String(yappyPhone).replace(/\D/g, '');
        const { orderId } = await iniciarBotonYappy({
          phone: cleanPhone,
          amount: price,
          tipo: 'wc_enrollment',
          wc_enrollment_id: enrollId,
        });
        // El enrollment_id se persiste en yappy_orders al CREAR la orden (server-side, en yappy-boton).
        // El UPDATE posterior del cliente estaba bloqueado por RLS (yappy_orders no tiene policy UPDATE) — removido.

        // Poll hasta executed o timeout
        const poll = pollBotonOrder({ orderId });
        yappyPollRef.current = poll;
        await poll.promise;
        yappyPollRef.current = null;
      }

      setYappyStep('confirmed');
      Alert.alert('¡Inscripción confirmada!', `Estás dentro del ${isPolla ? 'Polla Ganadora' : 'Survivor 3 Vidas'}.`);
      await refreshProfile();
      navigation.replace(isPolla ? 'MundialPolla' : 'MundialSurvivor');
    } catch (err) {
      if (err.message === 'cancelled') {
        Alert.alert('Pago cancelado', 'Cancelaste el cobro Yappy.');
      } else {
        Alert.alert('Error', err.message || 'No se pudo procesar la inscripción.');
      }
      setYappyStep('idle');
    } finally {
      setProcessing(false);
    }
  };

  const cancelYappy = () => {
    if (yappyPollRef.current) {
      yappyPollRef.current.cancel();
      yappyPollRef.current = null;
    }
    setYappyStep('idle');
    setProcessing(false);
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

  if (enrolled) {
    return (
      <MundialScreenFrame>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.alreadyWrap}>
            <Text style={styles.alreadyTitle}>Ya estás inscrito</Text>
            <Text style={styles.alreadyText}>
              Inscripción confirmada para {isPolla ? 'Polla Ganadora' : 'Survivor 3 Vidas'}.
            </Text>
            <WCButton
              label="IR AL JUEGO"
              variant="primary"
              size="lg"
              onPress={() => navigation.replace(isPolla ? 'MundialPolla' : 'MundialSurvivor')}
              style={{ marginTop: SPACING.md }}
            />
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.backLink}>Volver</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </MundialScreenFrame>
    );
  }

  return (
    <MundialScreenFrame>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backLink}>← Volver</Text>
        </TouchableOpacity>

        {enrollment?.payment_status === 'pending' && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingBannerText}>
              ⏳ Tenés una inscripción pendiente de pago — completala abajo
            </Text>
          </View>
        )}

        <View style={styles.enrollHeader}>
          <Text style={styles.title}>{isPolla ? 'POLLA GANADORA' : 'SURVIVOR 3 VIDAS'}</Text>
          <Text style={styles.priceBig}>${price}</Text>
          <Text style={styles.subtitle}>
            {isPolla
              ? 'Predice marcadores de los 104 partidos. 3-5-8 pts por acierto x multiplicador por fase.'
              : 'Pick 1 equipo por jornada-día. Cada equipo 1 sola vez en grupos. Sobreviví la fase de grupos.'}
          </Text>
        </View>

        {/* Selector de método de pago */}
        <View style={styles.payMethodBlock}>
          <Text style={styles.payMethodTitle}>Método de pago</Text>
          <View style={styles.payMethodRow}>
            <TouchableOpacity
              style={[styles.payMethodBtn, paymentMethod === 'wallet' && styles.payMethodBtnActive]}
              onPress={() => setPaymentMethod('wallet')}
              disabled={processing}
            >
              <Text style={styles.payMethodIcon}>💳</Text>
              <Text style={[styles.payMethodLabel, paymentMethod === 'wallet' && styles.payMethodLabelActive]}>
                Wallet
              </Text>
              <Text style={styles.payMethodSub}>${walletBalance.toFixed(2)}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.payMethodBtn, paymentMethod === 'yappy' && styles.payMethodBtnActive]}
              onPress={() => setPaymentMethod('yappy')}
              disabled={processing}
            >
              <Text style={styles.payMethodIcon}>📱</Text>
              <Text style={[styles.payMethodLabel, paymentMethod === 'yappy' && styles.payMethodLabelActive]}>
                Yappy
              </Text>
              <Text style={styles.payMethodSub}>Request</Text>
            </TouchableOpacity>
          </View>

          {paymentMethod === 'wallet' && walletBalance < price && (
            <Text style={styles.walletWarn}>
              Saldo insuficiente. Necesitás ${(price - walletBalance).toFixed(2)} más, o pagá con Yappy.
            </Text>
          )}

          {paymentMethod === 'yappy' && (
            <View style={styles.yappyInputBlock}>
              <Text style={styles.yappyInputLabel}>Tu número Yappy</Text>
              <TextInput
                style={styles.yappyInput}
                value={yappyPhone}
                onChangeText={(v) => setYappyPhone(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="6XXX-XXXX"
                placeholderTextColor={COLORS.gray}
                maxLength={12}
                editable={!processing}
              />
              <Text style={styles.yappyHint}>
                Vas a recibir una notificación en tu app Yappy para aprobar el cobro de ${price}.
              </Text>
            </View>
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

        {/* Aceptación de Términos del Mundial — gate legal previo a inscribirse */}
        <View style={styles.consentBlock}>
          <TouchableOpacity
            style={styles.consentRow}
            onPress={() => setAcceptedTerms(v => !v)}
            activeOpacity={0.8}
            disabled={processing}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTerms }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
              {acceptedTerms && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.consentText}>
              He leído y acepto los{' '}
              <Text
                style={styles.consentLink}
                onPress={() => navigation.navigate('MundialTerms', { mode })}
              >
                Términos y Condiciones del Mundial
              </Text>
              .
            </Text>
          </TouchableOpacity>
        </View>

        <WCButton
          label={processing
            ? (yappyStep === 'waiting' ? 'ESPERANDO YAPPY…' : 'PROCESANDO…')
            : `INSCRIBIRME · $${price}${paymentMethod === 'yappy' ? ' (YAPPY)' : ' (WALLET)'}`}
          onPress={handleEnroll}
          variant="primary"
          size="lg"
          disabled={processing || !acceptedTerms || (paymentMethod === 'wallet' && walletBalance < price)}
          loading={processing && yappyStep !== 'waiting'}
          style={{ marginTop: SPACING.md }}
        />

        {yappyStep === 'waiting' && (
          <TouchableOpacity style={styles.cancelYappyBtn} onPress={cancelYappy}>
            <Text style={styles.cancelYappyText}>Cancelar pago Yappy</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.footnote}>
          {paymentMethod === 'yappy'
            ? 'Yappy V2 — vas a recibir notificación push para aprobar el cobro. Espera hasta 5 min.'
            : 'Pago con tu saldo wallet de Birrea2Play.'}
        </Text>
      </ScrollView>

      {/* Modal de espera Yappy */}
      <Modal visible={yappyStep === 'waiting'} transparent animationType="fade">
        <View style={styles.waitingBackdrop}>
          <View style={styles.waitingCard}>
            <ActivityIndicator size="large" color={COLORS.neon} />
            <Text style={styles.waitingTitle}>Esperando confirmación</Text>
            <Text style={styles.waitingText}>
              Abrí tu app Yappy y aprobá el cobro de ${price}.{'\n\n'}
              O entrá a tu banca en línea y elegí la opción de Yappy.
            </Text>
            <Text style={styles.waitingPhone}>Yappy: {yappyPhone}</Text>
            <TouchableOpacity onPress={cancelYappy} style={styles.waitingCancelBtn}>
              <Text style={styles.waitingCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    </MundialScreenFrame>
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
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  consentBlock: {
    marginTop: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  checkbox: {
    width: 24, height: 24, borderRadius: RADIUS.sm,
    borderWidth: 2, borderColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent', marginTop: 1,
  },
  checkboxChecked: { backgroundColor: COLORS.magentaA11y || COLORS.magenta, borderColor: COLORS.magentaA11y || COLORS.magenta },
  checkboxMark: { color: COLORS.white, fontFamily: FONTS.bodyBold, fontSize: 14, lineHeight: 16 },
  consentText: { flex: 1, fontFamily: FONTS.body, fontSize: 13, color: COLORS.bg, lineHeight: 19 },
  consentLink: { fontFamily: FONTS.bodyBold, color: COLORS.magentaA11y || COLORS.magenta, textDecorationLine: 'underline' },
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
  pendingBanner: {
    backgroundColor: COLORS.gold + '22',
    borderColor: COLORS.gold + '99',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  pendingBannerText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.gold,
    lineHeight: 18,
  },
  enrollHeader: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: FONTS.heading, fontSize: 32, color: COLORS.bg,
    letterSpacing: 1.5,
  },
  priceBig: {
    fontFamily: FONTS.heading, fontSize: 52, color: COLORS.magentaText || COLORS.magenta,
    letterSpacing: 1, marginTop: 6,
  },
  subtitle: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.bg,
    lineHeight: 20, marginTop: 4,
  },

  walletCard: {
    backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.lg,
  },
  walletLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2,
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

  payMethodBlock: {
    marginBottom: SPACING.lg,
  },
  payMethodTitle: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: SPACING.sm,
  },
  payMethodRow: { flexDirection: 'row', gap: SPACING.sm },
  payMethodBtn: {
    flex: 1, paddingVertical: SPACING.md, alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 20, 0.92)', borderColor: COLORS.line,
    borderWidth: 1, borderRadius: RADIUS.md,
  },
  payMethodBtnActive: {
    borderColor: COLORS.neon, backgroundColor: COLORS.neon + '14',
  },
  payMethodIcon: { fontSize: 28 },
  payMethodLabel: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray2,
    letterSpacing: 1, marginTop: 4,
  },
  payMethodLabelActive: { color: COLORS.white },
  payMethodSub: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, marginTop: 2,
  },
  yappyInputBlock: { marginTop: SPACING.md },
  yappyInputLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2,
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
  },
  yappyInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 12,
    color: COLORS.white, fontFamily: FONTS.heading, fontSize: 22,
    letterSpacing: 2, textAlign: 'center',
  },
  yappyHint: {
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2,
    marginTop: 4, lineHeight: 16,
  },
  cancelYappyBtn: { marginTop: SPACING.sm, padding: 8, alignItems: 'center' },
  cancelYappyText: { color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 13 },

  waitingBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: SPACING.lg,
  },
  waitingCard: {
    backgroundColor: 'rgba(10, 14, 20, 0.96)', borderColor: COLORS.neon + '66', borderWidth: 1,
    borderRadius: RADIUS.lg, padding: SPACING.lg, alignItems: 'center',
    maxWidth: 380,
  },
  waitingTitle: {
    fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white,
    letterSpacing: 1, marginTop: SPACING.md,
  },
  waitingText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 20, marginTop: SPACING.sm,
  },
  waitingPhone: {
    fontFamily: FONTS.bodyBold, fontSize: 16, color: COLORS.neon,
    letterSpacing: 1, marginTop: SPACING.md,
  },
  waitingCancelBtn: { marginTop: SPACING.lg, padding: SPACING.sm },
  waitingCancelText: { color: COLORS.gray2, fontFamily: FONTS.bodyBold, fontSize: 14 },

  bonusBlock: {
    backgroundColor: 'rgba(10, 14, 20, 0.93)', borderColor: COLORS.magenta + '66',
    borderWidth: 1, borderRadius: RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  bonusTitle: {
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.magentaText || COLORS.magenta,
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
  bonusTeamEmpty: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2 },

  bonusInputRow: { marginTop: SPACING.md },
  bonusInputLabel: {
    fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  bonusInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)', borderColor: COLORS.line, borderWidth: 1,
    borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 10,
    color: COLORS.white, fontFamily: FONTS.body, fontSize: 14,
  },
  scoreInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12 },
  scoreInput: {
    width: 60, height: 50, borderRadius: RADIUS.sm,
    borderColor: COLORS.line, borderWidth: 1,
    textAlign: 'center', color: COLORS.white,
    fontFamily: FONTS.heading, fontSize: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
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
    fontFamily: FONTS.body, fontSize: 11, color: COLORS.bg,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(10,14,20,0.14)',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    textAlign: 'center', marginTop: SPACING.md, fontStyle: 'italic',
    overflow: 'hidden',
  },

  alreadyWrap: {
    padding: SPACING.lg, marginTop: 40,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'rgba(10,14,20,0.16)',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
  },
  alreadyTitle: {
    fontFamily: FONTS.heading, fontSize: 26, color: COLORS.bg,
    letterSpacing: 1, marginBottom: 8,
  },
  alreadyText: {
    fontFamily: FONTS.body, fontSize: 14, color: COLORS.bg,
    marginBottom: SPACING.lg, lineHeight: 20,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'rgba(10, 14, 20, 0.97)',
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
