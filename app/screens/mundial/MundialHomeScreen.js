import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';

function formatCountdown(targetIso) {
  if (!targetIso) return null;
  const target = new Date(targetIso).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return { closed: true, text: 'Cerrado' };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  return { closed: false, text: `${days}d ${hours}h ${mins}m` };
}

export default function MundialHomeScreen() {
  const { user } = useAuthStore();
  const { pool, loadPool, loading } = useWcStore();
  const [countdown, setCountdown] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const role = user?.role ?? 'player';
  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!pool && !loading) loadPool();
  }, [pool, loading, loadPool]);

  useEffect(() => {
    if (!pool?.enrollment_deadline) return;
    const tick = () => setCountdown(formatCountdown(pool.enrollment_deadline));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [pool?.enrollment_deadline]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPool();
    setRefreshing(false);
  };

  if (loading && !pool) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.neon} />
          <Text style={styles.loadingText}>Cargando Mundial 2026…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.neon}
            colors={[COLORS.neon]}
          />
        }
      >
        {isAdmin && pool && !pool.is_visible && (
          <View style={styles.adminBanner}>
            <Text style={styles.adminBannerLabel}>MODO ADMIN</Text>
            <Text style={styles.adminBannerText}>
              Este módulo está oculto a usuarios. Activá la visibilidad desde el
              panel de admin cuando quieras lanzar.
            </Text>
          </View>
        )}

        <View style={styles.header}>
          <Text style={styles.kicker}>FIFA WORLD CUP</Text>
          <Text style={styles.title}>MUNDIAL 2026</Text>
          <Text style={styles.subtitle}>USA · México · Canadá · 48 equipos</Text>
        </View>

        <View style={styles.countdownCard}>
          <Text style={styles.countdownLabel}>
            {countdown?.closed ? 'Inscripciones' : 'Cierra en'}
          </Text>
          <Text style={[styles.countdownValue, countdown?.closed && styles.countdownClosed]}>
            {countdown?.text ?? '—'}
          </Text>
          <Text style={styles.countdownDate}>11 jun 2026, 10:00 AM Panamá</Text>
        </View>

        <View style={styles.modesContainer}>
          <View style={[styles.modeCard, styles.modeCardSurvivor]}>
            <Text style={[styles.modePill, styles.pillSurvivor]}>SURVIVOR</Text>
            <Text style={styles.modeTitle}>3 Vidas</Text>
            <Text style={styles.modePrice}>${pool?.survivor_price ?? '10'}</Text>
            <Text style={styles.modeDesc}>
              Pick 1 equipo por jornada-día. Si tu equipo pierde, perdés 1 vida. Cada
              equipo se puede usar máximo 2 veces. Sobreviví la fase de grupos.
            </Text>
            <View style={styles.modeFooter}>
              <Text style={styles.modeStatus}>Próximamente</Text>
            </View>
          </View>

          <View style={[styles.modeCard, styles.modeCardPolla]}>
            <Text style={[styles.modePill, styles.pillPolla]}>POLLA GANADORA</Text>
            <Text style={styles.modeTitle}>Predice marcadores</Text>
            <Text style={styles.modePrice}>${pool?.polla_price ?? '15'}</Text>
            <Text style={styles.modeDesc}>
              Acumula puntos por aciertos en los 104 partidos. Multiplicador por fase
              (x1 grupos → x4 final). 5 bonus pre-temporada obligatorios. Un único
              ganador.
            </Text>
            <View style={styles.modeFooter}>
              <Text style={styles.modeStatus}>Próximamente</Text>
            </View>
          </View>
        </View>

        <View style={styles.rulesCard}>
          <Text style={styles.rulesTitle}>Cómo funciona el pozo</Text>
          <Text style={styles.rulesText}>
            • Pagás $10 (Survivor) o $15 (Polla){'\n'}
            • Premio = 95% del total recaudado{'\n'}
            • Entrega manual por Yappy o transferencia bancaria{'\n'}
            • Resultados oficiales sincronizados desde api-football
          </Text>
        </View>

        <View style={styles.scoringCard}>
          <Text style={styles.rulesTitle}>Polla — sistema de puntos</Text>
          <View style={styles.scoreRow}>
            <Text style={styles.scorePts}>3 pts</Text>
            <Text style={styles.scoreDesc}>Acertás el ganador</Text>
          </View>
          <View style={styles.scoreRow}>
            <Text style={styles.scorePts}>5 pts</Text>
            <Text style={styles.scoreDesc}>Ganador + diferencia exacta de goles</Text>
          </View>
          <View style={styles.scoreRow}>
            <Text style={styles.scorePts}>8 pts</Text>
            <Text style={styles.scoreDesc}>Marcador exacto</Text>
          </View>
          <Text style={styles.scoreNote}>
            × multiplicador por fase. Bonus pre-temporada: campeón (50), sub (30),
            3° (20), goleador (25), MVP (15).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    marginTop: SPACING.md,
    color: COLORS.gray2,
    fontFamily: FONTS.body,
    fontSize: 14,
  },

  adminBanner: {
    backgroundColor: COLORS.gold + '18',
    borderColor: COLORS.gold + '66',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  adminBannerLabel: {
    fontFamily: FONTS.heading,
    fontSize: 13,
    color: COLORS.gold,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  adminBannerText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 18,
  },

  header: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  kicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.magenta,
    letterSpacing: 3,
    marginBottom: 4,
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 44,
    color: COLORS.white,
    letterSpacing: 2,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    marginTop: 4,
  },

  countdownCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
    ...SHADOWS.card,
  },
  countdownLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.gray,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  countdownValue: {
    fontFamily: FONTS.heading,
    fontSize: 38,
    color: COLORS.neon,
    letterSpacing: 1,
    marginTop: 8,
  },
  countdownClosed: { color: COLORS.red2 },
  countdownDate: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 6,
  },

  modesContainer: {
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  modeCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    ...SHADOWS.card,
  },
  modeCardSurvivor: { borderColor: COLORS.red + '55' },
  modeCardPolla:    { borderColor: COLORS.magenta + '55' },
  modePill: {
    alignSelf: 'flex-start',
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    letterSpacing: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  pillSurvivor: { backgroundColor: COLORS.red + '22', color: COLORS.red2 },
  pillPolla:    { backgroundColor: COLORS.magenta + '22', color: COLORS.magenta },
  modeTitle: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 1,
  },
  modePrice: {
    fontFamily: FONTS.heading,
    fontSize: 36,
    color: COLORS.neon,
    letterSpacing: 1,
    marginVertical: 4,
  },
  modeDesc: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    lineHeight: 20,
    marginTop: 6,
  },
  modeFooter: {
    marginTop: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modeStatus: {
    fontFamily: FONTS.bodyBold,
    fontSize: 12,
    color: COLORS.gold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  rulesCard: {
    backgroundColor: COLORS.card2,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  scoringCard: {
    backgroundColor: COLORS.card2,
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  rulesTitle: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  rulesText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 22,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  scorePts: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.neon,
    width: 60,
    letterSpacing: 1,
  },
  scoreDesc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    flex: 1,
  },
  scoreNote: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray,
    fontStyle: 'italic',
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
});
