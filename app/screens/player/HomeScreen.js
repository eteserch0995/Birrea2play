import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import useWcStore from '../../../store/wcStore';
import { supabase } from '../../../lib/supabase';
import PlayerAvatar from '../../../components/PlayerAvatar';
import EventCard from '../../../components/EventCard';
import { useAppRefresh } from '../../../hooks/useAppRefresh';

const mundialLogo = require('../../../assets/mundial/mundial-logo.png');

export default function HomeScreen({ navigation }) {
  const { user, walletBalance, subscribeToWallet } = useAuthStore();
  const { pool: wcPool, loadPool: loadWcPool, isVisibleTo } = useWcStore();
  const mundialOn = isVisibleTo(user?.role ?? 'player');
  const [events,       setEvents]       = React.useState([]);
  const [loading,      setLoading]      = React.useState(true);
  const [error,        setError]        = React.useState(null);
  const [mvpCount,     setMvpCount]     = React.useState(0);
  const [totalEvents,  setTotalEvents]  = React.useState(0);
  const [myMvps,       setMyMvps]       = React.useState([]); // [{ id, event_id, votos_totales, evento, fecha }]

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [{ data: rawEvents, error: evErr }, { count: mvps }, { count: evTotal }, { data: myMvpRows }] = await Promise.all([
        supabase.from('events').select('*').in('status', ['open', 'active']).eq('visible', true).order('fecha').limit(3),
        user?.id
          ? supabase.from('mvp_results').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
          : Promise.resolve({ count: 0 }),
        user?.id
          ? supabase.from('event_registrations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'confirmed')
          : Promise.resolve({ count: 0 }),
        user?.id
          ? supabase.from('mvp_results')
              .select('id, event_id, votos_totales, premio_wallet, created_at, event:events!event_id(nombre, fecha, deporte)')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] }),
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
      setMyMvps(myMvpRows ?? []);
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

  useEffect(() => { loadWcPool(); }, [loadWcPool]);

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

        {/* ── Banner Mundial ── */}
        {mundialOn && (
          <TouchableOpacity
            style={styles.mundialBanner}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Mundial')}
          >
            <Image source={mundialLogo} style={styles.mundialBannerLogo} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={styles.mundialBannerKicker}>MUNDIAL 2026 · USA · MÉXICO · CANADÁ</Text>
              <Text style={styles.mundialBannerTitle}>JUGÁ EL MUNDIAL</Text>
              <Text style={styles.mundialBannerSub}>Survivor 3 Vidas · Polla Ganadora — competí por el pozo</Text>
            </View>
            <Text style={styles.mundialBannerArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* ── Próximos eventos: PRIMER bloque visible para foco en agenda ── */}
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

        {/* ── Barra compacta: Wallet + Stats en una sola fila scrollable ── */}
        <View style={styles.statsBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsBar}>
            <MiniStat icon="💰" value={`$${Number(walletBalance ?? 0).toFixed(2)}`} label="Saldo" onPress={() => navigation.navigate('Wallet')} highlight />
            <MiniStat icon="⚽" value={user?.actividades_completadas ?? 0} label="Actividades" />
            <MiniStat icon="📅" value={totalEvents} label="Eventos" />
            <MiniStat icon="🏆" value={mvpCount} label="MVPs" />
          </ScrollView>
        </View>

        {/* ── Mis MVPs: carrusel con los últimos premios ganados ── */}
        {myMvps.length > 0 && (
          <>
            <SectionHeader title="Mis MVPs" onPress={() => navigation.navigate('Profile')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mvpStrip}>
              {myMvps.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.mvpChip}
                  onPress={() => navigation.navigate('Eventos', { screen: 'EventDetail', params: { eventId: m.event_id } })}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mvpChipTrophy}>🏆</Text>
                  <Text style={styles.mvpChipEvento} numberOfLines={1}>{m.event?.nombre ?? 'Evento'}</Text>
                  <Text style={styles.mvpChipMeta}>
                    {m.votos_totales ?? 0} voto{m.votos_totales === 1 ? '' : 's'}
                    {m.premio_wallet ? ` · +$${Number(m.premio_wallet).toFixed(0)}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

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

// Chip compacto para la barra horizontal de stats. El saldo va con `highlight`
// para que se vea como CTA tocable (sin robar el foco visual a los eventos).
function MiniStat({ icon, value, label, onPress, highlight }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      style={[styles.miniStat, highlight && styles.miniStatHighlight]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={styles.miniStatIcon}>{icon}</Text>
      <View>
        <Text style={[styles.miniStatValue, highlight && { color: COLORS.neon }]}>{value}</Text>
        <Text style={styles.miniStatLabel}>{label}</Text>
      </View>
    </Wrapper>
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
  statsBarWrap: { marginTop: SPACING.md },
  statsBar: { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingVertical: 2 },
  miniStat: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    borderWidth: 1, borderColor: COLORS.navy,
    minHeight: 52,
  },
  miniStatHighlight: { borderColor: COLORS.neon + '66', backgroundColor: COLORS.neon + '10' },
  miniStatIcon:  { fontSize: 20 },
  miniStatValue: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1 },
  miniStatLabel: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: -2 },
  mvpStrip:      { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingVertical: 2 },
  mvpChip: {
    minWidth: 160, maxWidth: 200,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.gold + '60',
    gap: 2,
  },
  mvpChipTrophy:{ fontSize: 22 },
  mvpChipEvento:{ fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.white },
  mvpChipMeta:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gold },
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

  // ── Mundial Banner ──
  mundialBanner: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.bg2 ?? '#0A0E14',
    borderWidth: 1.5,
    borderColor: COLORS.magenta,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    ...SHADOWS.glow,
  },
  mundialBannerLogo: {
    width: 50,
    height: 50,
  },
  mundialBannerKicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.neon,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  mundialBannerTitle: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 1.5,
    lineHeight: 30,
  },
  mundialBannerSub: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2 ?? COLORS.gray,
    marginTop: 3,
  },
  mundialBannerArrow: {
    fontFamily: FONTS.heading,
    fontSize: 26,
    color: COLORS.magentaText ?? COLORS.magenta,
  },
});
