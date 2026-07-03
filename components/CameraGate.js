import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

export default function CameraGate({ checking, granted, webDenied, onRequest, children }) {
  // Nativo o ya concedido: mostrar contenido directo
  if (Platform.OS !== 'web' || granted) return children;

  // Verificando estado del permiso
  if (checking) {
    return (
      <View style={styles.gate}>
        <ActivityIndicator color={COLORS.green} size="large" />
      </View>
    );
  }

  // Bloqueado por el usuario
  if (webDenied) {
    return (
      <View style={styles.gate}>
        <Text style={styles.icon}>📷</Text>
        <Text style={styles.title}>CÁMARA{'\n'}BLOQUEADA</Text>
        <Text style={styles.body}>
          Para usar esta sección necesitás habilitar la cámara.{'\n\n'}
          Tocá el ícono 🔒 en la barra de dirección del navegador → Cámara → Permitir. Luego recargá la página.
        </Text>
      </View>
    );
  }

  // Estado "prompt": pedir permiso con botón (getUserMedia solo desde onPress)
  return (
    <View style={styles.gate}>
      <Text style={styles.icon}>📷</Text>
      <Text style={styles.title}>SE NECESITA{'\n'}LA CÁMARA</Text>
      <Text style={styles.body}>
        Esta sección requiere acceso a la cámara para validar cupones de beneficios.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={onRequest} activeOpacity={0.85}>
        <Text style={styles.btnText}>Permitir cámara</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  icon:  { fontSize: 64 },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 3,
    textAlign: 'center',
    lineHeight: 34,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 15,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 22,
  },
  btn: {
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl * 2,
    marginTop: SPACING.md,
  },
  btnText: {
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.bg,
    fontSize: 17,
  },
});
