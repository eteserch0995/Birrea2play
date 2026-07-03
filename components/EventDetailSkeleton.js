/**
 * EventDetailSkeleton — placeholder inmediato para EventDetailScreen.
 * Se muestra mientras loading=true, eliminando el spinner puro.
 * Sin lógica, solo presentación con shimmer vía StyleSheet + tokens del theme
 * (respeta el skin activo: MODO26 hoy, TEMA2 mañana, sin flash de color).
 * Propietario: agente PERF — no editar desde otros agentes.
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../constants/theme';

// Shimmer compartido: anima entre card2 (mid) y navy (bright) del skin activo.
// Exportado para que EventListSkeleton use la misma animación/tokens.
export function useShimmer() {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return anim.interpolate({
    inputRange: [0, 1],
    // card2↔line: neutros en TODOS los skins. navy quedaba azul saturado
    // en MODO26 (#1E3AAD) y teñía el loading en prod (hallazgo del review).
    outputRange: [COLORS.card2, COLORS.line],
  });
}

function Bone({ style }) {
  const bg = useShimmer();
  return <Animated.View style={[styles.bone, { backgroundColor: bg }, style]} />;
}

// Avatar circular con shimmer
function AvatarBone({ size = 36 }) {
  return <Bone style={{ width: size, height: size, borderRadius: size / 2 }} />;
}

// Fila de un jugador placeholder
function PlayerRow() {
  return (
    <View style={styles.playerRow}>
      <AvatarBone size={38} />
      <View style={styles.playerInfo}>
        <Bone style={{ width: '55%', height: 13, borderRadius: 6 }} />
        <Bone style={{ width: '35%', height: 11, borderRadius: 5, marginTop: 5 }} />
      </View>
    </View>
  );
}

export default function EventDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header image placeholder */}
      <Bone style={styles.headerImage} />

      {/* Title block */}
      <View style={styles.section}>
        <Bone style={{ width: '70%', height: 22, borderRadius: 8, marginBottom: 10 }} />
        <Bone style={{ width: '45%', height: 16, borderRadius: 6, marginBottom: 6 }} />
        <Bone style={{ width: '55%', height: 16, borderRadius: 6, marginBottom: 6 }} />
        <Bone style={{ width: '40%', height: 16, borderRadius: 6 }} />
      </View>

      {/* Chips / tags row */}
      <View style={styles.chipsRow}>
        <Bone style={styles.chip} />
        <Bone style={[styles.chip, { width: 72 }]} />
        <Bone style={[styles.chip, { width: 56 }]} />
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Section header */}
      <View style={styles.section}>
        <Bone style={{ width: '40%', height: 14, borderRadius: 6, marginBottom: 14 }} />

        {/* 6 player rows */}
        <PlayerRow />
        <PlayerRow />
        <PlayerRow />
        <PlayerRow />
        <PlayerRow />
        <PlayerRow />
      </View>

      {/* CTA button placeholder */}
      <View style={styles.ctaWrapper}>
        <Bone style={styles.ctaButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  headerImage: {
    width: '100%',
    height: 200,
    borderRadius: 0,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  chipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  chip: {
    width: 88,
    height: 28,
    borderRadius: 14,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.line,
    marginHorizontal: 16,
    marginTop: 20,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  playerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  ctaWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 12,
    backgroundColor: COLORS.bg,
  },
  ctaButton: {
    height: 50,
    borderRadius: 14,
    width: '100%',
  },
  bone: {
    // base style — bg is animated
  },
});
