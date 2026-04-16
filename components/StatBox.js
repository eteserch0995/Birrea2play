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
    ...SHADOWS.card,
  },
  icon:  { fontSize: 24, marginBottom: 4 },
  value: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white },
  label: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
});
