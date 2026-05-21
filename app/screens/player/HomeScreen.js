import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';
import WalletHero from '../../../components/WalletHero';
import StatBox from '../../../components/StatBox';
import PlayerAvatar from '../../../components/PlayerAvatar';
import EventCard from '../../../components/EventCard';
import { useAppRefresh } from '../../../hooks/useAppRefresh';

export default function HomeScreen({ navigation }) {
  const { user, walletBalance, subscribeToWallet } = useAuthStore();
  const [events,       setEvents]       = React.useState([]);
  const [loading,      setLoading]      = React.useState(true);
  const [error,        setError]        = React.useState(null);
  const [mvpCount,     setMvpCount]     = React.useState(0);
  const [totalEvents,  setTotalEvents]  = React.useState(0);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [{ data: rawEvents, error: evErr }, { count: mvps }, { count: evTotal }] = await Promise.all([
        supabase.from('events').select('*').in('status', ['open', 'active']).eq('visible', true).order('fecha').limit(3),
        user?.id
          ? supabase.from('mvp_results').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          : Promise.resolve({ count: 0 }),
        user?.id
          ? supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'confirmed')
          : Promise.resolve({ count: 0 }),
      ]);
      if (evErr) throw new Error(evErr.message);

      // Fetch CONFIRMED inscripciones e invitados para los eventos visibles
      const eventIds = (rawEvents ?? []).map((e) => e.id);
      const [regsByEvent, guestsByEvent] = await Promise.all([
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_registrations').select('event_id')
            .in('event_id', eventIds).eq('status', 'confirmed')
            .then(({ data }) => (data ?? []).reduce((acc, r) => { acc[r.event_id] = (acc[r.event_id] ?? 0) + 1; return acc; }, {})),
        eventIds.length === 0 ? Promise.resolve({}) :
          supabase.from('event_guests').select('event_id')
            .in('event_id', eventIds).in('status', ['confirmed','pending_payment'])
            .then(({ data }) => (data ?? []).reduce((acc, r) => { acc[r.event_id] = (acc[r.event_id] ?? 0) + 1; return acc; }, {})),
      ]);
      const events = (rawEvents ?? []).map((e) => ({
        ...e,
        event_registrations: [{ count: (regsByEvent[e.id] ?? 0) + (guestsByEvent[e.id] ?? 0) }],
      }));

      setEvents(events);
      setMvpCount(mvps ?? 0);
      setTotalEvents(evTotal ?? 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const unsub = subscribeToWallet();
    fetchData();
    // Realtime channel removido: era overkill (suscribía a TODOS los cambios de events
    // y disparaba fetches innecesarios). Ahora confiamos en pull-to-refresh + on focus.
    return () => { unsub(); };
  }, [fetchData]);

  const { refreshing, onRefresh } = useAppRefresh(fetchData);

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.topGlow} />
      <View pointerEvents="none" style={styles.pitchLine} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>BIRREA2PLAY CLUBHOUSE</Text>
            <Text style={styles.greeting}>¡Hola, {user?.nombre?.split(' ')[0]}!</Text>
            <Text style={styles.sub}>Tu próxima birrea está calentando</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <PlayerAvatar user={user} size={44} borderColor={COLORS.gold} />
          </TouchableOpacity>
        </View>

        {/* ── Banner: perfil incompleto ── */}
        {(() => {
          if (!user?.id) return null;
          const localPart = (user.correo ?? '').split('@')[0];
          const expectedFallback = localPart.charAt(0).toUpperCase() + localPart.slice(1);
          const nombreEsFallback = !!user.nombre && user.nombre === expectedFallback;
          const sinTelefono = !user.telefono || user.telefono.trim() === '';
          if (!nombreEsFallback && !sinTelefono) return null;
          return (
            <TouchableOpacity
              style={styles.profileBanner}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.85}
            >
              <Text style={styles.profileBannerIcon}>👤</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileBannerTitle}>Completá tu perfil</Text>
                <Text style={styles.profileBannerSub}>
                  {nombreEsFallback && sinTelefono
                    ? 'Falta tu nombre completo y teléfono.'
                    : nombreEsFallback
                      ? 'Tu nombre quedó como tu correo. Actualizalo.'
                      : 'Falta tu número de teléfono.'}
                </Text>
              </View>
              <Text style={styles.profileBannerArrow}>→</Text>
            </TouchableOpacity>
          );
        })()}

        {/* ── Wallet hero ── */}
        <WalletHero balance={walletBalance} onPress={() => navigation.navigate('Wallet')} />

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          <StatBox icon="⚽" value={user?.actividades_completadas ?? 0} label="Actividades" />
          <StatBox icon="📅" value={totalEvents} label="Eventos" />
          <StatBox icon="🏆" value={mvpCount} label="MVPs" />
        </View>

        {/* ── Próximos eventos ── */}
        <SectionHeader title="Próximos eventos" onPress={() => navigation.navigate('Eventos')} />
        {loading
          ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} />
          : error
            ? (
              <View style={styles.errorBox}>
                <Text style={{ fontSize: 28, marginBottom: SPACING.sm }}>⚠️</Text>
                <Text style={styles.empty}>No se pudieron cargar los eventos</Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => { setLoading(true); fetchData(); }}
                >
                  <Text style={styles.retryText}>Reintentar</Text>
                </TouchableOpacity>
              </View>
            )
            : events.length === 0
              ? (
                <View style={styles.emptyBox}>
                  <Text style={{ fontSize: 40, marginBottom: SPACING.sm }}>📅</Text>
                  <Text style={styles.empty}>No hay eventos disponibles</Text>
                </View>
              )
              : events.map((ev) => (
                  <View key={ev.id} style={styles.cardWrap}>
                    <EventCard
                      event={ev}
                      onPress={() => navigation.navigate('Eventos', { screen: 'EventDetail', params: { eventId: ev.id } })}
                    />
                  </View>
                ))
        }


        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, onPress }) {
  return (
    <View style={secStyles.row}>
      <Text style={secStyles.title}>{title}</Text>
      <TouchableOpacity onPress={onPress}>
        <Text style={secStyles.more}>Ver todo →</Text>
      </TouchableOpacity>
    </View>
  );
}

const secStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  more:  { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.neon, letterSpacing: 1, textTransform: 'uppercase' },
});

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: COLORS.bg },
  topGlow:  { position: 'absolute', top: -110, right: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: COLORS.red + '24' },
  pitchLine:{ position: 'absolute', top: 88, left: -60, right: -60, height: 1, backgroundColor: COLORS.neon + '18', transform: [{ rotate: '-10deg' }] },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, paddingTop: SPACING.sm },
  kicker:   { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.neon, letterSpacing: 1.6, marginBottom: 2 },
  greeting: { fontFamily: FONTS.heading, fontSize: 34, color: COLORS.white, letterSpacing: 1 },
  profileBanner: {
    marginHorizontal: SPACING.md, marginTop: SPACING.sm, marginBottom: SPACING.sm,
    backgroundColor: COLORS.gold + '20', borderWidth: 1, borderColor: COLORS.gold,
    borderRadius: RADIUS.md, padding: SPACING.md,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
  },
  profileBannerIcon:  { fontSize: 28 },
  profileBannerTitle: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.gold, letterSpacing: 0.5 },
  profileBannerSub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 2 },
  profileBannerArrow: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gold },
  sub:      { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  cardWrap: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  emptyBox: { alignItems: 'center', padding: SPACING.xl },
  errorBox: { alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm },
  retryBtn: { backgroundColor: COLORS.red, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, marginTop: SPACING.xs },
  retryText:{ fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 14 },
  mvpCard:  {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  mvpAvatarWrap:{ },
  mvpInfo:  { flex: 1 },
  mvpName:  { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  mvpSub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  empty:    { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
});
