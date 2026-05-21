// Banner del campeón del torneo. Se muestra cuando hay ganador de la final.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, RADIUS, SPACING } from '../constants/theme';
import TeamBadge from './TeamBadge';

export default function WinnerBanner({ winner }) {
  if (!winner) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.label}>🏆 CAMPEÓN</Text>
      <View style={{ alignItems: 'center', marginTop: SPACING.sm }}>
        <TeamBadge team={winner} size={72} showName={false} />
        <Text style={styles.name}>{winner.nombre}</Text>
      </View>
      <Text style={styles.sub}>¡Felicidades al equipo ganador!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:   {
    margin: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card, alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.gold,
  },
  label: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, letterSpacing: 4 },
  name:  { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 2, marginTop: SPACING.sm },
  sub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: SPACING.xs, textAlign: 'center' },
});
