/**
 * EventListSkeleton — placeholder inmediato para EventsScreen mientras loading=true.
 * Silueta de 3 EventCard (imagen + 2 líneas de texto). Usa el mismo shimmer
 * animado (card2 <-> navy) que EventDetailSkeleton para igualar la calidad
 * percibida entre lista y detalle.
 */
import React from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS, SPACING, RADIUS } from '../constants/theme';
import { useShimmer } from './EventDetailSkeleton';

function ShimmerBox({ style }) {
  const bg = useShimmer();
  return <Animated.View style={[style, { backgroundColor: bg }]} />;
}

function CardBone() {
  return (
    <View style={styles.card}>
      <ShimmerBox style={styles.image} />
      <View style={styles.body}>
        <ShimmerBox style={styles.lineWide} />
        <ShimmerBox style={styles.lineNarrow} />
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
  },
  body: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  lineWide: {
    height: 20,
    borderRadius: 6,
    width: '65%',
  },
  lineNarrow: {
    height: 14,
    borderRadius: 6,
    width: '40%',
  },
});
