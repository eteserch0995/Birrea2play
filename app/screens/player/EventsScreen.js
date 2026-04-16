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
  const { events, loading, fetchEvents } = useEventStore();

  const fetch = useCallback(() => {
    const q = filter === 'Abiertos' ? 'open' : filter;
    return fetchEvents(q);
  }, [filter, fetchEvents]);

  // Reload on every focus (tab switch or back-navigate) and on filter change
  useFocusEffect(fetch);

  const { refreshing, onRefresh } = useAppRefresh(fetch);

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>EVENTOS</Text>

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
  title:           { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },
  filterRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  chip:            { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  chipActive:      { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText:        { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  chipTextActive:  { color: COLORS.white, fontFamily: FONTS.bodyMedium },
  list:            { padding: SPACING.md, gap: SPACING.sm },
  empty:           { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
});
