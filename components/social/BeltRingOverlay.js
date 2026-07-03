// Overlay del cinturon sobre un StoryCircle existente.
//
// Pinta el aro dorado (borde) + corona + pill de rol + badge de estado ENCIMA del circulo,
// sin reescribir StoriesBar. pointerEvents='none' para que el onPress del circulo siga llegando
// (abre el visor). Oro DEDICADO (#FFD700), distinto del neon del shell en los 3 temas.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../constants/theme';
import { BELT_GOLD, BELT_DISPUTE, BELT_VACANT } from '../../lib/social/mockBelts';

const RING = 70; // igual que StoriesBar

export default function BeltRingOverlay({ belt }) {
  const status = belt?.status ?? 'held';
  const vacante = status === 'vacante';
  const disputa = status === 'en_disputa';
  const ringColor = vacante ? BELT_VACANT : BELT_GOLD;

  return (
    <View pointerEvents="none" style={styles.root}>
      {/* Corona */}
      <Crown color={ringColor} fallen={vacante} />

      {/* Aro dorado encima del circulo */}
      <View style={[styles.ring, { borderColor: ringColor }, disputa && styles.ringDisputa]} />

      {/* Badge de estado: dias en disputa o VACANTE */}
      {disputa && (
        <View style={[styles.badge, { backgroundColor: BELT_DISPUTE }]}>
          <Text style={styles.badgeText}>EN DISPUTA {belt.daysLeft}d</Text>
        </View>
      )}
      {vacante && (
        <View style={[styles.badge, { backgroundColor: COLORS.card2, borderColor: BELT_VACANT, borderWidth: 1 }]}>
          <Text style={[styles.badgeText, { color: COLORS.gray2 }]}>VACANTE</Text>
        </View>
      )}

      {/* Pill del rol (CRACK / MURO / KILLER / EL 10) */}
      <View style={[styles.rolePill, { borderColor: ringColor, backgroundColor: vacante ? COLORS.card : '#000000AA' }]}>
        <Text style={[styles.roleText, { color: ringColor }]}>{belt?.short ?? 'CRACK'}</Text>
      </View>
    </View>
  );
}

// Corona simple con triangulos (sin SVG, sin emojis).
function Crown({ color, fallen }) {
  return (
    <View style={[styles.crown, fallen && styles.crownFallen]}>
      <View style={styles.crownPeaks}>
        <Triangle color={color} h={8} />
        <Triangle color={color} h={11} />
        <Triangle color={color} h={8} />
      </View>
      <View style={[styles.crownBase, { backgroundColor: color }]} />
    </View>
  );
}

function Triangle({ color, h }) {
  return (
    <View style={{
      width: 0, height: 0,
      borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: h,
      borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color,
    }} />
  );
}

const styles = StyleSheet.create({
  // Cubre solo la zona del aro (no el username de abajo). Centrado sobre el circulo.
  root: { position: 'absolute', top: 0, left: 0, right: 0, height: RING, alignItems: 'center', justifyContent: 'flex-start' },
  ring: { position: 'absolute', top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: 3.5, backgroundColor: 'transparent' },
  ringDisputa: { borderStyle: 'dashed' },
  crown: { position: 'absolute', top: -11, alignItems: 'center', zIndex: 2 },
  crownFallen: { transform: [{ rotate: '-18deg' }], opacity: 0.5 },
  crownPeaks: { flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  crownBase: { width: 20, height: 4, borderRadius: 1, marginTop: -1 },
  badge: { position: 'absolute', top: -4, right: 2, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontFamily: FONTS.bodyBold, fontSize: 8, color: '#000', letterSpacing: 0.3 },
  rolePill: { position: 'absolute', top: RING - 12, borderRadius: 7, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 1 },
  roleText: { fontFamily: FONTS.bodyBold, fontSize: 8.5, letterSpacing: 0.6 },
});
