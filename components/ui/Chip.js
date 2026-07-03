import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, TYPE, SPACING, RADIUS } from '../../constants/theme';
import PressableScale from './PressableScale';

// Chip seleccionable unificado (reemplaza filterRow / selectores sueltos).
// Altura táctil minima 44 via hitSlop aunque el chip visual sea mas chico.
export default function Chip({ label, active, onPress, color = COLORS.red, style }) {
  return (
    <PressableScale
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      style={[
        styles.chip,
        active
          ? { backgroundColor: color, borderColor: color }
          : { backgroundColor: 'transparent', borderColor: COLORS.line },
        style,
      ]}
    >
      <Text style={[styles.label, active ? styles.labelActive : styles.labelInactive]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: TYPE.small,
  },
  labelActive: { color: COLORS.white },
  labelInactive: { color: COLORS.gray2 },
});
