// "Escudo" del equipo: círculo de color con la inicial del nombre.
// Reusable en bracket, sección de avanzantes y pantalla del ganador.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';

export default function TeamBadge({ team, size = 36, showName = true, style }) {
  if (!team) {
    return (
      <View style={[styles.row, style]}>
        <View style={[styles.shield, { width: size, height: size, backgroundColor: COLORS.navy, borderColor: COLORS.gray }]}>
          <Text style={[styles.initial, { fontSize: size * 0.45 }]}>?</Text>
        </View>
        {showName && <Text style={styles.name}>Por definir</Text>}
      </View>
    );
  }
  const displayName = team.nombre ?? team.name_es ?? team.name ?? team.code ?? '';
  const initial = (displayName || '?').trim().charAt(0).toUpperCase();
  const color = team.color || COLORS.blue;
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.shield, { width: size, height: size, backgroundColor: color, borderColor: color }]}>
        <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{initial}</Text>
      </View>
      {showName && <Text style={styles.name} numberOfLines={1}>{displayName || 'Equipo'}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shield: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  initial:{ fontFamily: FONTS.heading, color: COLORS.white, letterSpacing: 1 },
  name:   { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 13 },
});
