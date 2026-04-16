import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SPORTS } from '../lib/sportTerms';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * SportChips — multi or single sport selector.
 *
 * Props:
 *   selected  : string[] (multi) or string (single)
 *   onToggle  : (label: string) => void
 *   single    : bool   — if true, behaves as radio buttons
 */
export default function SportChips({ selected = [], onToggle, single = false }) {
  return (
    <View style={styles.wrap}>
      {SPORTS.map((sport) => {
        const active = single
          ? selected === sport.label
          : Array.isArray(selected) && selected.includes(sport.label);
        return (
          <TouchableOpacity
            key={sport.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onToggle(sport.label)}
          >
            <Text style={styles.icon}>{sport.icon}</Text>
            <Text style={[styles.label, active && styles.labelActive]}>{sport.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.navy,
    backgroundColor: COLORS.card,
  },
  chipActive:  { backgroundColor: COLORS.blue, borderColor: COLORS.blue2 },
  icon:        { fontSize: 14 },
  label:       { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  labelActive: { color: COLORS.white, fontFamily: FONTS.bodyMedium },
});
