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
  const [events, setEvents]   = React.useState([]);
  const [mvps,   setMvps]     = React.useState([]);
  const [loading,setLoading]  = React.useState(true);

  const fetchData = useCallback(async () => {
    const [{ data: evs }, { data: mvpData }] = await Promise.all([
      supabase
        .from('events')
        .select('*, event_registrations(count)')
        .in('status', ['open', 'active'])
        .eq('visible', true)
        .order('fecha')
        .limit(3),
      supabase
        .from('mvp_results')
        .select('*, users(nombre, foto_url), matches(event_id, events(nombre))')
        .order('created_at', { ascending: false })
        .limit(3),
    ]);
    setEvents(evs ?? []);
    setMvps(mvpData ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const unsub = subscribeToWallet();
    fetchData();

    const ch = supabase
      .channel('home-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mvp_results' }, fetchData)
      .subscribe();

    return () => {
      unsub();
      supabase.removeChannel(ch);
    };
  }, [fetchData]);

  const { refreshing, onRefresh } = useAppRefresh(fetchData);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>¡Hola, {user?.nombre?.split(' ')[0]}!</Text>
            <Text style={styles.sub}>Bienvenido de vuelta</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            <PlayerAvatar user={user} size={44} borderColor={COLORS.gold} />
          </TouchableOpacity>
        </View>

        {/* ── Wallet hero ── */}
        <WalletHero balance={walletBalance} onPress={() => navigation.navigate('Wallet')} />

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          <StatBox icon="⚽" value={user?.actividades_completadas ?? 0} label="Actividades" />
          <StatBox icon="🏆" value={user?.total_mvps ?? 0} label="MVPs" />
          <StatBox icon="📅" value={events.length} label="Eventos" />
        </View>

        {/* ── Próximos eventos ── */}
        <SectionHeader title="Próximos eventos" onPress={() => navigation.navigate('Eventos')} />
        {loading
          ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} />
          : events.length === 0
            ? <Text style={styles.empty}>No hay eventos disponibles</Text>
            : events.map((ev) => (
                <View key={ev.id} style={styles.cardWrap}>
                  <EventCard
                    event={ev}
                    onPress={() => navigation.navigate('Eventos', { screen: 'EventDetail', params: { eventId: ev.id } })}
                  />
                </View>
              ))
        }

        {/* ── MVPs recientes ── */}
        {mvps.length > 0 && (
          <>
            <SectionHeader title="MVPs recientes" onPress={() => navigation.navigate('Noticias')} />
            {mvps.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.mvpCard}
                onPress={() => navigation.navigate('PlayerProfile', { userId: m.users?.id })}
                activeOpacity={0.8}
              >
                <View style={styles.mvpAvatarWrap}>
                  <PlayerAvatar user={m.users} size={44} borderColor={COLORS.gold} />
                </View>
                <View style={styles.mvpInfo}>
                  <Text style={styles.mvpName}>{m.users?.nombre}</Text>
                  <Text style={styles.mvpSub}>
                    {m.matches?.events?.nombre ?? 'Evento'} · {m.votos_totales} votos · +${m.premio_wallet}
                  </Text>
                </View>
                <Text style={{ fontSize: 22 }}>🏆</Text>
              </TouchableOpacity>
            ))}
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

const secStyles = StyleSheet.create({
  row:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.xl, marginBottom: SPACING.sm, paddingHorizontal: SPACING.md },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  more:  { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gold },
});

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: COLORS.bg },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md, paddingTop: SPACING.sm },
  greeting: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white },
  sub:      { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md },
  cardWrap: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
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
