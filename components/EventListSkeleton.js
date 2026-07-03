/**
 * EventListSkeleton — placeholder inmediato para EventsScreen mientras loading=true.
 * Silueta de 3 EventCard (imagen + 2 líneas de texto), sin lógica, sin
 * animaciones complejas (opacity estática, misma idea que EventDetailSkeleton
 * pero sin shimmer para mantenerlo simple en una lista).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../constants/theme';

function CardBone() {
  return (
    <View style={styles.card}>
      <View style={styles.image} />
      <View style={styles.body}>
        <View style={styles.lineWide} />
        <View style={styles.lineNarrow} />
      </View>
    </View>
  );
}

export default function EventListSkeleton() {
  return (
    <View style={styles.list}>
      <CardBone />
      <CardBone />
      <CardBone />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACING.md, gap: SPACING.sm },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  image: {
    width: '100%',
    height: 142,
    backgroundColor: COLORS.card2,
    opacity: 0.6,
  },
  body: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  lineWide: {
    height: 20,
    borderRadius: 6,
    width: '65%',
    backgroundColor: COLORS.card2,
    opacity: 0.6,
  },
  lineNarrow: {
    height: 14,
    borderRadius: 6,
    width: '40%',
    backgroundColor: COLORS.card2,
    opacity: 0.6,
  },
});
