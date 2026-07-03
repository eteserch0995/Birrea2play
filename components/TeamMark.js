// Marca visual de un equipo: muestra la BANDERA/escudo (team.logo_url) si
// existe; si no, cae al clásico punto/cuadro de color. Drop-in para reemplazar
// los <View> de color que se repiten en roster, partidos, standings y paneles.
// Así un evento "mundialista" (equipos = selecciones) muestra banderas sin
// romper los eventos normales (logo_url null → punto de color de siempre).
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';

export default function TeamMark({ team, size = 16, square = false, style }) {
  const radius = square ? Math.max(3, Math.round(size * 0.18)) : size / 2;
  const logo = team?.logo_url;
  if (logo) {
    return (
      <Image
        source={{ uri: logo }}
        style={[
          { width: size, height: size, borderRadius: radius, borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card },
          style,
        ]}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  const color = team?.color || COLORS.blue;
  return (
    <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: color, borderWidth: 1, borderColor: COLORS.navy }, style]} />
  );
}

export const teamMarkStyles = StyleSheet.create({});
