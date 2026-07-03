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
            <View style={s.adminBanner}>
              <Text style={s.adminBannerLabel}>MODO ADMIN</Text>
              <Text style={s.adminBannerText}>
                Este módulo está oculto a usuarios. Activá la visibilidad desde el panel de admin cuando quieras lanzar.
              </Text>
            </View>
          )}

          {/* Logo / branding */}
          <View style={s.headerCard}>
            <Image source={mundialLogo} style={s.logo} resizeMode="contain" />
            <Text style={s.kicker}>BIRREA2PLAY</Text>
            <Text style={s.title}>MUNDIAL 2026</Text>
            <Text style={s.subtitle}>USA · México · Canadá · 48 equipos</Text>
          </View>

          {/* Botones principales */}
          <View style={s.quickRow}>
            <TouchableOpacity style={[s.quickCard, s.quickCardPolla]} onPress={goToPolla} activeOpacity={0.85}>
              <Text style={s.quickIcon}>🏆</Text>
              <Text style={s.quickTitle}>POLLA{'\n'}MUNDIAL</Text>
              <Text style={s.quickSub}>
                {pollaEnrollment?.payment_status === 'paid'
                  ? '✓ Ya inscrito\nTocá para jugar'
                  : 'Predice marcadores\ny ganá el pozo'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={[s.quickCard, s.quickCardPartidos]} onPress={() => navigation.navigate('MundialStandings')} activeOpacity={0.85}>
              <Text style={s.quickIcon}>🌍</Text>
              <Text style={s.quickTitle}>PARTIDOS{'\n'}DEL MUNDIAL</Text>
              <Text style={s.quickSub}>Hoy · Próximos{'\n'}Grupos · En vivo</Text>
            </TouchableOpacity>
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
    backgroundColor: 'rgba(255,255,255,0.72)', margin: SPACING.lg, borderRadius: RADIUS.lg,
  },
  loadingText: { marginTop: SPACING.md, color: COLORS.bg, fontFamily: FONTS.body, fontSize: 14 },

  adminBanner: {
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderColor: 'rgba(10,14,20,0.18)', borderWidth: 1,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md,
  },
  adminBannerLabel: { fontFamily: FONTS.heading, fontSize: 13, color: COLORS.bg, letterSpacing: 1.5, marginBottom: 4 },
  adminBannerText:  { fontFamily: FONTS.body, fontSize: 13, color: COLORS.bg, lineHeight: 18 },

  headerCard: {
    alignItems: 'center',
    paddingVertical: SPACING.lg, paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1, borderColor: 'rgba(10,14,20,0.12)',
  },
  logo: {
    width: 132, height: 132, borderRadius: RADIUS.lg,
    marginBottom: SPACING.md, borderWidth: 2, borderColor: COLORS.white,
    backgroundColor: COLORS.white,
  },
  kicker:   { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.magentaText || COLORS.magenta, letterSpacing: 3, marginBottom: 4 },
  title:    { fontFamily: FONTS.heading, fontSize: 44, color: COLORS.bg, letterSpacing: 2 },
  subtitle: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.bg, marginTop: 4 },

  quickRow: { flexDirection: 'row', gap: SPACING.sm },
  quickCard: {
    flex: 1, borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg, paddingHorizontal: SPACING.sm,
    alignItems: 'center', borderWidth: 1.5,
  },
  quickCardPolla: {
    backgroundColor: (COLORS.magenta ?? '#C026D3') + '18',
    borderColor: COLORS.magenta ?? '#C026D3',
  },
  quickCardPartidos: {
    backgroundColor: (COLORS.blue2 ?? '#2563EB') + '18',
    borderColor: COLORS.blue2 ?? '#2563EB',
  },
  quickIcon:  { fontSize: 32, marginBottom: 6 },
  quickTitle: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 1.5, marginBottom: 6, textAlign: 'center', lineHeight: 20 },
  quickSub:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 ?? COLORS.gray, textAlign: 'center', lineHeight: 16 },
});
