// MundialScreenFrame — fondo seguro para todas las pantallas del módulo Mundial.
// Variante: ESTADIO NOCTURNO + HOLO (tema2, default de toda la app desde 2026-07-01).
//
// Capas:
//   1. Root #05070B (negro profundo del Estadio Nocturno)
//   2. Aurora animada (t2Aurora, CSS del tema global) — reemplaza los blobs estáticos
//   3. haloGold sutil como única firma visual propia del módulo Mundial
//
// Se elimina la Image de fondo (mundial-bg.png) y el overlay/viñetas: el tema2
// ya resuelve profundidad y legibilidad vía la aurora + vidrio de las cards hijas.
import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function MundialScreenFrame({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" dataSet={{ t2Aurora: '' }} />
      <View style={styles.haloGold} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070B',
  },
  haloGold: {
    position: 'absolute',
    top: '6%',
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
  },
});
