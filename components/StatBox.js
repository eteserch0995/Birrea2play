import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';

export default function StatBox({ icon, value, label }) {
  return (
    <View style={styles.card}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    ...SHADOWS.card,
  },
  icon:  { fontSize: 22, marginBottom: 4 },
  value: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.white, letterSpacing: 1 },
  label: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray2, marginTop: 2, letterSpacing: 1, textTransform: 'uppercase' },
});
