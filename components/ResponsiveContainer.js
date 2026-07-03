import React from 'react';
import { View, StyleSheet } from 'react-native';

// Limita el ancho del contenido en web desktop (prod es 100% web): columna
// centrada de max 600px. En viewport <= 600px es transparente (100% de ancho).
// El fondo de la pantalla lo pinta el padre (SafeAreaView/View), que sigue
// full-bleed: aqui solo se constriñe la columna de contenido.
export default function ResponsiveContainer({ children, maxWidth = 600, style }) {
  return (
    <View style={styles.outer}>
      <View style={[styles.inner, { maxWidth }, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  inner: {
    flex: 1,
    width: '100%',
  },
});
