import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';

export default function WalletHero({ balance, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.label}>SALDO DISPONIBLE</Text>
      <Text style={styles.amount}>${(balance ?? 0).toFixed(2)}</Text>
      <Text style={styles.sub}>Toca para recargar o ver historial →</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: SPACING.md,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.blue,
    padding: SPACING.xl,
    ...SHADOWS.card,
  },
  label:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.white + 'AA', letterSpacing: 2 },
  amount: { fontFamily: FONTS.heading, fontSize: 48, color: COLORS.white, marginTop: 4 },
  sub:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white + '88', marginTop: SPACING.sm },
});
