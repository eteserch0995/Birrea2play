// "Escudo" del equipo: bandera/escudo (logo_url) si existe; si no, círculo de
// color con la inicial del nombre. Reusable en bracket, avanzantes y ganador.
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';
import { getTeamNameWithColor } from '../lib/teamWearColor';

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
  const logo  = team.logo_url;
  return (
    <View style={[styles.row, style]}>
      {logo ? (
        <Image
          source={{ uri: logo }}
          style={[styles.shield, { width: size, height: size, borderColor: COLORS.navy, backgroundColor: COLORS.card }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.shield, { width: size, height: size, backgroundColor: color, borderColor: color }]}>
          <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{initial}</Text>
        </View>
      )}
      {showName && <Text style={styles.name} numberOfLines={1}>{getTeamNameWithColor(team)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shield: { borderRadius: 999, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  initial:{ fontFamily: FONTS.heading, color: COLORS.white, letterSpacing: 1 },
  name:   { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 13 },
});
