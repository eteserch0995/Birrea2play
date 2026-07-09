import React, { useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl, TextInput, Alert,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useEventStore from '../../../store/eventStore';
import { useAppRefresh } from '../../../hooks/useAppRefresh';
import EventCard from '../../../components/EventCard';
import EventListSkeleton from '../../../components/EventListSkeleton';
import EmptyState from '../../../components/EmptyState';
import ResponsiveContainer from '../../../components/ResponsiveContainer';
import { isTema2Active } from '../../../lib/tema2';

const FILTERS = ['Todos', 'Liga', 'Torneo', 'Amistoso', 'Abiertos'];

export default function EventsScreen({ navigation }) {
  const [filter, setFilter] = React.useState('Todos');
  const [showCode, setShowCode]       = React.useState(false); // F4: birreas privadas
  const [codeInput, setCodeInput]     = React.useState('');
  const [codeLoading, setCodeLoading] = React.useState(false);
  const { events, loading, error, fetchEvents } = useEventStore();

  // Reload on every focus (tab switch or back-navigate). El filtro ahora se
  // aplica client-side sobre `events`, así que el focus no depende de él.
  useFocusEffect(
    useCallback(() => {
      fetchEvents();
      return undefined;
    }, [fetchEvents])
  );

  const { refreshing, onRefresh } = useAppRefresh(
    useCallback(() => fetchEvents({ force: true }), [fetchEvents])
  );

  const retry = useCallback(() => fetchEvents({ force: true }), [fetchEvents]);

  const filteredEvents = React.useMemo(() => {
    if (filter === 'Todos') return events;
    if (filter === 'Abiertos') return events.filter((e) => e.status === 'open');
    return events.filter((e) => e.formato === filter);
  }, [events, filter]);

  const renderItem = useCallback(({ item, index }) => {
    const card = (
      <EventCard
        event={item}
        onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
      />
    );
    // Entrada escalonada solo con tema2 activo; sin gate, el árbol DOM queda igual (sin wrapper).
    if (!isTema2Active()) return card;
    const rise = String((index % 5) + 1);
    return <View dataSet={{ t2Rise: rise }}>{card}</View>;
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>CALENDARIO DE CANCHA</Text>
        <Text style={styles.title}>EVENTOS</Text>
      </View>

      <ResponsiveContainer>
        {/* Filter chips */}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, filter === f && styles.chipActive]}
              onPress={() => setFilter(f)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
          {/* F4: entrada a birreas privadas por código */}
          <TouchableOpacity
            style={[styles.chip, { borderColor: COLORS.gold }]}
            onPress={() => setShowCode((v) => !v)}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={[styles.chipText, { color: COLORS.gold }]}>🔑 Tengo un código</Text>
          </TouchableOpacity>
        </View>

        {showCode && (
          <View style={styles.codeRow}>
            <TextInput
              style={styles.codeInput}
              placeholder="EV-XXXXXX"
              placeholderTextColor={COLORS.gray}
              autoCapitalize="characters"
              value={codeInput}
              onChangeText={setCodeInput}
            />
            <TouchableOpacity
              style={[styles.chip, styles.chipActive, { borderColor: COLORS.gold, backgroundColor: COLORS.gold }]}
              disabled={codeLoading}
              onPress={async () => {
                const code = codeInput.trim();
                if (!code) return;
                setCodeLoading(true);
                try {
                  const { data, error: cErr } = await supabase.rpc('get_event_by_code', { p_code: code });
                  if (cErr) throw cErr;
                  const ev = Array.isArray(data) ? data[0] : data;
                  if (!ev?.id) {
                    Alert.alert('Código inválido', 'No encontramos una birrea activa con ese código.');
                  } else {
                    setShowCode(false); setCodeInput('');
                    navigation.navigate('EventDetail', { eventId: ev.id });
                  }
                } catch (e) {
                  Alert.alert('Error', e.message ?? 'No se pudo buscar el código.');
                } finally {
                  setCodeLoading(false);
                }
              }}
            >
              <Text style={[styles.chipText, { color: COLORS.bg, fontFamily: FONTS.bodyBold }]}>{codeLoading ? '...' : 'ENTRAR'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading && events.length === 0
          ? <EventListSkeleton />
          : error
            ? (
              <EmptyState
                icon="⚠️"
                title="Error al cargar eventos"
                actionLabel="Reintentar"
                onAction={retry}
              />
            )
            : (
            <FlatList
              data={filteredEvents}
              keyExtractor={(i) => i.id}
              contentContainerStyle={styles.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
              renderItem={renderItem}
              ListEmptyComponent={
                <EmptyState
                  icon="📅"
                  title="No hay eventos disponibles"
                  subtitle="Pronto se publican nuevas birreas"
                />
              }
            />
          )
        }
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: COLORS.bg },
  hero:            { paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  kicker:          { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.neon, letterSpacing: 1.6 },
  title:           { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.white, letterSpacing: 4, marginTop: 2 },
  filterRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginVertical: SPACING.md },
  codeRow:         { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginBottom: SPACING.md, alignItems: 'center' },
  codeInput:       { flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 9, color: COLORS.white, fontFamily: FONTS.bodySemiBold, letterSpacing: 1 },
  chip:            { paddingHorizontal: SPACING.md, paddingVertical: 10, minHeight: 40, justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line },
  chipActive:      { backgroundColor: COLORS.red, borderColor: COLORS.red2 },
  chipText:        { fontFamily: FONTS.bodyBold, color: COLORS.gray2, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  chipTextActive:  { color: COLORS.white, fontFamily: FONTS.bodyBold },
  list:            { padding: SPACING.md, gap: SPACING.sm },
});
