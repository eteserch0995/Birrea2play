import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import TodayMatches from '../../../components/mundial/TodayMatches';
import Card from '../../../components/ui/Card';
import { shouldShowOnboarding } from './MundialOnboardingScreen';

const mundialLogo = require('../../../assets/mundial/mundial-logo.png');

export default function MundialHomeScreen({ navigation }) {
  const { user }                           = useAuthStore();
  const { pool, loadPool, loading }        = useWcStore();
  const [refreshing, setRefreshing]        = useState(false);
  const [pollaEnrollment, setPollaEnrollment] = useState(null);

  const role    = user?.role ?? 'player';
  const isAdmin = role === 'admin';

  useEffect(() => { if (!pool && !loading) loadPool(); }, [pool, loading, loadPool]);

  useEffect(() => {
    (async () => {
      if (await shouldShowOnboarding()) navigation.navigate('MundialOnboarding');
    })();
  }, [navigation]);

  // FLUJO-6: useFocusEffect en vez de useEffect -> revalida el estado de
  // inscripción a la polla también al recuperar foco (no solo en mount/pull-to-refresh),
  // por ej. después de pagar en MundialEnroll y volver atrás.
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      (async () => {
        const { data } = await supabase
          .from('wc_enrollments')
          .select('mode, payment_status')
          .eq('user_id', user.id)
          .eq('mode', 'polla')
          .maybeSingle();
        setPollaEnrollment(data ?? null);
      })();
    }, [user?.id, refreshing])
  );

  const onRefresh = async () => { setRefreshing(true); await loadPool(); setRefreshing(false); };

  const goToPolla = () => {
    if (pollaEnrollment?.payment_status === 'paid') {
      navigation.navigate('MundialPolla');
    } else {
      navigation.navigate('MundialEnroll', { mode: 'polla' });
    }
  };

  const isPaid = pollaEnrollment?.payment_status === 'paid';

  if (loading && !pool) {
    return (
      <MundialScreenFrame>
        <SafeAreaView style={s.safe} edges={['top']}>
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.neon} />
            <Text style={s.loadingText}>Cargando Mundial 2026...</Text>
          </View>
        </SafeAreaView>
      </MundialScreenFrame>
    );
  }

  return (
    <MundialScreenFrame>
      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} colors={[COLORS.neon]} />}
        >
          {/* Banner admin */}
          {isAdmin && pool && !pool.is_visible && (
            <Card variant="glass" style={s.adminBanner}>
              <Text style={s.adminBannerLabel}>MODO ADMIN</Text>
              <Text style={s.adminBannerText}>
                Este módulo está oculto a usuarios. Activá la visibilidad desde el panel de admin cuando quieras lanzar.
              </Text>
            </Card>
          )}

          {/* Header compacto */}
          <View dataSet={{ t2Rise: '1' }}>
            <Card variant="glass" style={s.headerCard}>
              <View style={s.headerRow}>
                <Image source={mundialLogo} style={s.logo} resizeMode="contain" />
                <View style={s.headerTextCol}>
                  <Text style={s.kicker}>BIRREA2PLAY</Text>
                  <Text style={s.title}>MUNDIAL 2026</Text>
                  <Text style={s.subtitle}>USA · México · Canadá · 48 equipos</Text>
                </View>
              </View>
            </Card>
          </View>

          {/* Partidos de hoy */}
          <View dataSet={{ t2Rise: '2' }} style={s.section}>
            {/* TodayMatches ya trae su propio título "PARTIDOS DE HOY" adentro —
                acá solo va el link a la vista completa, alineado a la derecha. */}
            <View style={s.sectionHeaderRow}>
              <View />
              <TouchableOpacity onPress={() => navigation.navigate('MundialStandings')} activeOpacity={0.7}>
                <Text style={s.sectionLink}>Ver todos →</Text>
              </TouchableOpacity>
            </View>
            <TodayMatches />
          </View>

          {/* Mi Polla — carta protagonista */}
          <View dataSet={{ t2Rise: '3' }} style={s.section}>
            <Card variant="holo" glow="hero" onPress={goToPolla} style={s.pollaCard}>
              <Text style={s.pollaIcon}>🏆</Text>
              <Text style={s.pollaTitle}>{isPaid ? 'MI POLLA MUNDIAL' : 'POLLA MUNDIAL'}</Text>
              <Text style={s.pollaText}>
                {isPaid
                  ? 'Estás jugando — mirá tus pronósticos y el ranking'
                  : 'Predice marcadores y ganá el pozo'}
              </Text>
              <Text style={s.pollaCta}>{isPaid ? 'Ver mis pronósticos →' : 'Inscribite ahora →'}</Text>
            </Card>
          </View>

          {/* Accesos secundarios */}
          <View dataSet={{ t2Rise: '4' }} style={s.tileRow}>
            <Card variant="glass" style={s.tile} onPress={() => navigation.navigate('MundialStandings')}>
              <Text style={s.tileIcon}>🌍</Text>
              <Text style={s.tileTitle}>GRUPOS Y{'\n'}BRACKET</Text>
            </Card>
            <Card variant="glass" style={s.tile} onPress={() => navigation.navigate('MundialSurvivor')}>
              <Text style={s.tileTitle}>SURVIVOR</Text>
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },

  loadingWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent', margin: SPACING.lg,
  },
  loadingText: { marginTop: SPACING.md, color: COLORS.gray2, fontFamily: FONTS.body, fontSize: 14 },

  adminBanner: {
    marginBottom: SPACING.md,
  },
  adminBannerLabel: { fontFamily: FONTS.heading, fontSize: 13, color: COLORS.gold, letterSpacing: 1.5, marginBottom: 4 },
  adminBannerText:  { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 18 },

  headerCard: {
    marginBottom: SPACING.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  logo: {
    width: 44, height: 44, borderRadius: RADIUS.md,
  },
  headerTextCol: { flex: 1 },
  kicker:   { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.magentaText ?? COLORS.magenta, letterSpacing: 3, marginBottom: 2 },
  title:    { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 1.5 },
  subtitle: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 2 },

  section: { marginBottom: SPACING.md },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SPACING.xs, paddingHorizontal: SPACING.xs,
  },
  sectionLabel: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.white, letterSpacing: 1.2 },
  sectionLink:  { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.neon },

  pollaCard: { alignItems: 'center', paddingVertical: SPACING.lg },
  pollaIcon: { fontSize: 34, marginBottom: SPACING.xs },
  pollaTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.gold, letterSpacing: 1.5, textAlign: 'center' },
  pollaText: {
    fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, textAlign: 'center',
    marginTop: SPACING.xs, lineHeight: 18, maxWidth: 280,
  },
  pollaCta: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.neon, marginTop: SPACING.md, letterSpacing: 0.5 },

  tileRow: { flexDirection: 'row', gap: SPACING.sm },
  tile: {
    flex: 1, alignItems: 'center', paddingVertical: SPACING.lg,
  },
  tileIcon:  { fontSize: 26, marginBottom: 6 },
  tileTitle: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.white, letterSpacing: 1.2, textAlign: 'center', lineHeight: 19 },
});
