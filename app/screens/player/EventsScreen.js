import React, { useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useEventStore from '../../../store/eventStore';
import { useAppRefresh } from '../../../hooks/useAppRefresh';
import EventCard from '../../../components/EventCard';

const FILTERS = ['Todos', 'Liga', 'Torneo', 'Amistoso', 'Abiertos'];

export default function EventsScreen({ navigation }) {
  const [filter, setFilter] = React.useState('Todos');
  const { events, loading, error, fetchEvents } = useEventStore();

  const fetch = useCallback(() => {
    const q = filter === 'Abiertos' ? 'open' : filter;
    fetchEvents(q);
  }, [filter, fetchEvents]);

  // Reload on every focus (tab switch or back-navigate) and on filter change
  useFocusEffect(
    useCallback(() => {
      fetch();
      return undefined;
    }, [fetch])
  );

  const { refreshing, onRefresh } = useAppRefresh(fetch);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>CALENDARIO DE CANCHA</Text>
        <Text style={styles.title}>EVENTOS</Text>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, filter === f && styles.chipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && events.length === 0
        ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.xl }} />
        : error
          ? (
            <View style={{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
              <Text style={styles.empty}>Error al cargar eventos</Text>
              <TouchableOpacity
                style={{ backgroundColor: COLORS.red, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, borderRadius: SPACING.sm }}
                onPress={fetch}
              >
                <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white }}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )
          : (
          <FlatList
            data={events}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
            renderItem={({ item }) => (
              <EventCard
                event={item}
                onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
              />
            )}
            ListEmptyComponent={<Text style={styles.empty}>No hay eventos disponibles</Text>}
          />
        )
      }
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: COLORS.bg },
  hero:            { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  kicker:          { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.neon, letterSpacing: 1.6 },
  title:           { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.white, letterSpacing: 4, marginTop: 2 },
  filterRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginVertical: SPACING.md },
  chip:            { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line },
  chipActive:      { backgroundColor: COLORS.red, borderColor: COLORS.red2 },
  chipText:        { fontFamily: FONTS.bodyBold, color: COLORS.gray2, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  chipTextActive:  { color: COLORS.white, fontFamily: FONTS.bodyBold },
  list:            { padding: SPACING.md, gap: SPACING.sm },
  empty:           { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
});
