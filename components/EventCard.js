import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { getEventStatusInfo } from '../lib/eventHelpers';

export default function EventCard({ event, onPress }) {
  const inscritos = event.event_registrations?.[0]?.count ?? 0;
  const pct = event.cupos_total ? inscritos / event.cupos_total : 0;
  const { label, color } = getEventStatusInfo(event.status);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.top}>
        <View style={[styles.badge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.badgeText, { color }]}>{label}</Text>
        </View>
        <Text style={styles.price}>${(event.precio ?? 0).toFixed(2)}</Text>
      </View>

      <Text style={styles.nombre}>{event.nombre}</Text>

      {event.deporte ? (
        <Text style={styles.deporte}>{event.deporte} · {event.formato}</Text>
      ) : (
        <Text style={styles.deporte}>{event.formato}</Text>
      )}

      <Text style={styles.meta}>{event.lugar}</Text>
      <Text style={styles.meta}>
        {new Date(event.fecha).toLocaleDateString('es-PA', { weekday: 'short', day: 'numeric', month: 'short' })}
        {event.hora ? ` · ${event.hora.slice(0, 5)}` : ''}
      </Text>

      {!event.cupos_ilimitado && event.cupos_total > 0 && (
        <View style={styles.cuposRow}>
          <View style={styles.progressBg}>
            <View style={[
              styles.progressFill,
              { width: `${Math.min(pct * 100, 100)}%`, backgroundColor: pct > 0.9 ? COLORS.red : COLORS.green },
            ]} />
          </View>
          <Text style={styles.cuposText}>{inscritos}/{event.cupos_total}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  top:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge:       { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
  badgeText:   { fontFamily: FONTS.bodyMedium, fontSize: 11 },
  price:       { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gold },
  nombre:      { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.white, marginBottom: 4 },
  deporte:     { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.blue2, marginBottom: 2 },
  meta:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginBottom: 2 },
  cuposRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 8 },
  progressBg:  { flex: 1, height: 4, backgroundColor: COLORS.navy, borderRadius: 2, overflow: 'hidden' },
  progressFill:{ height: '100%', borderRadius: 2 },
  cuposText:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
});
