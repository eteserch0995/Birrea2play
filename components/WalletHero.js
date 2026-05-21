import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';

export default function WalletHero({ balance, onPress }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <LinearGradient
        colors={[COLORS.red, COLORS.asphalt, COLORS.blue]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <View style={styles.stripe} />
        <View style={styles.row}>
          <View>
            <Text style={styles.label}>CREDITOS INTERNOS</Text>
            <Text style={styles.amount}>${(balance ?? 0).toFixed(2)}</Text>
          </View>
          <View style={styles.mark}>
            <Text style={styles.markText}>B2P</Text>
          </View>
        </View>
        <Text style={styles.sub}>Para eventos y servicios Birrea2Play</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: SPACING.md,
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  gradient: {
    padding: SPACING.xl,
    minHeight: 158,
    justifyContent: 'space-between',
  },
  stripe: {
    position: 'absolute',
    right: -36,
    top: -20,
    width: 88,
    height: 220,
    backgroundColor: COLORS.white + '14',
    transform: [{ rotate: '18deg' }],
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  label:  { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white + 'CC', letterSpacing: 2 },
  amount: { fontFamily: FONTS.heading, fontSize: 52, color: COLORS.white, marginTop: 4 },
  sub:    { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white + 'AA', marginTop: SPACING.sm },
  mark: {
    borderWidth: 1,
    borderColor: COLORS.white + '66',
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#00000033',
  },
  markText: { fontFamily: FONTS.heading, color: COLORS.neon, fontSize: 16, letterSpacing: 1 },
});
