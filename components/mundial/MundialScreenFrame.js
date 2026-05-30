// MundialScreenFrame — fondo seguro para todas las pantallas del módulo Mundial.
// Variante: COLORIDO CONTROLADO (validada por agentes 01, 02, 04 — pasa WCAG AA).
//
// Capas:
//   1. Image base con resizeMode=cover (no stretch — evita distorsión)
//   2. Overlay oscuro unificador rgba(10,14,20,0.72)
//   3. Blobs de color sutiles (magenta, azul, lima, halo dorado)
//   4. Viñetas top/bottom para proteger legibilidad cerca de bordes
//
// Fallback de base: #0A0E14 (negro profundo). Si la imagen no carga, texto
// blanco/neon sigue legible. Antes era #ECFFB9 (lima) → texto invisible.

import React from 'react';
import { Image, StyleSheet, View, Dimensions } from 'react-native';

const mundialBg = require('../../assets/mundial/mundial-bg.png');
const { width: SW, height: SH } = Dimensions.get('window');

export default function MundialScreenFrame({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <Image
        source={mundialBg}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.overlayBase} />
      <View style={styles.blobMagenta} />
      <View style={styles.blobBlue} />
      <View style={styles.blobLime} />
      <View style={styles.haloGold} />
      <View style={styles.vignetteTop} />
      <View style={styles.vignetteBottom} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0E14',
  },
  overlayBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 14, 20, 0.72)',
  },
  blobMagenta: {
    position: 'absolute',
    top: -70,
    right: -90,
    width: SW * 0.78,
    height: SW * 0.78,
    borderRadius: SW * 0.39,
    backgroundColor: 'rgba(255, 26, 107, 0.12)',
    transform: [{ scaleX: 1.4 }, { scaleY: 0.75 }],
  },
  blobBlue: {
    position: 'absolute',
    bottom: SH * 0.12,
    left: -70,
    width: SW * 0.7,
    height: SW * 0.7,
    borderRadius: SW * 0.35,
    backgroundColor: 'rgba(0, 51, 204, 0.14)',
    transform: [{ scaleX: 0.85 }, { scaleY: 1.25 }],
  },
  blobLime: {
    position: 'absolute',
    top: SH * 0.22,
    left: -SW * 0.08,
    width: SW * 1.16,
    height: 2,
    backgroundColor: 'rgba(184, 255, 0, 0.09)',
    transform: [{ rotate: '-7deg' }],
  },
  haloGold: {
    position: 'absolute',
    top: SH * 0.06,
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 215, 0, 0.07)',
  },
  vignetteTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SH * 0.16,
    backgroundColor: 'rgba(10, 14, 20, 0.42)',
  },
  vignetteBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SH * 0.18,
    backgroundColor: 'rgba(10, 14, 20, 0.48)',
  },
});
