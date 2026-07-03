import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/theme';

const mundialLogo = require('../../assets/mundial/mundial-logo.png');

export default function MundialQuickCard({ onPress }) {
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={mundialLogo} style={s.logo} resizeMode="contain" />
      <View style={s.body}>
        <Text style={s.kicker}>BIRREA2PLAY</Text>
        <Text style={s.title}>MUNDIAL 2026</Text>
        <Text style={s.sub}>Partidos · Tablas · En vivo</Text>
      </View>
      <Text style={s.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.bg2 ?? '#0A0E14',
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.magenta ?? '#FF1E78',
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
    ...SHADOWS.glow,
  },
  logo: { width: 36, height: 36, borderRadius: 6 },
  body: { flex: 1 },
  kicker: {
    fontFamily: FONTS.bodyBold ?? FONTS.body,
    fontSize: 9,
    color: COLORS.magenta ?? '#FF1E78',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 22,
    color: COLORS.white,
    letterSpacing: 2,
    lineHeight: 26,
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray2 ?? COLORS.gray,
    marginTop: 1,
  },
  arrow: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.magenta ?? '#FF1E78',
    lineHeight: 32,
  },
});
