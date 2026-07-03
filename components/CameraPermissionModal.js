import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * Pre-permission modal para solicitar acceso a la cámara.
 * isDenied=true cuando el sistema ya denegó el permiso → lleva a Configuración.
 */
export default function CameraPermissionModal({ visible, onAllow, onSkip, isDenied = false }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>📷</Text>

          <Text style={styles.title}>
            {isDenied ? 'CÁMARA\nBLOQUEADA' : 'VALIDÁ\nCUPONES'}
          </Text>

          <Text style={styles.body}>
            {isDenied
              ? 'Para escanear códigos QR, habilitá el permiso de cámara en Configuración del sistema.'
              : 'Escaneá el código QR del cliente para validar sus cupones de beneficios al instante.'}
          </Text>

          {!isDenied && (
            <View style={styles.benefits}>
              <Text style={styles.benefit}>🎟  Validar cupones de beneficios</Text>
              <Text style={styles.benefit}>✅  Confirmar canjes en segundos</Text>
              <Text style={styles.benefit}>⚡  Sin buscar manualmente al usuario</Text>
            </View>
          )}

          <TouchableOpacity style={styles.btnAllow} onPress={onAllow} activeOpacity={0.8}>
            <Text style={styles.btnAllowText}>
              {isDenied ? 'Ir a Configuración' : 'Permitir cámara'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnSkip} onPress={onSkip}>
            <Text style={styles.btnSkipText}>Ahora no</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000BB',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: SPACING.lg,
    paddingBottom: SPACING.xl * 2,
  },
  card: {
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    width: '100%',
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  icon:  { fontSize: 52 },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 3,
    textAlign: 'center',
    lineHeight: 32,
  },
  body: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 20,
  },
  benefits: { width: '100%', gap: SPACING.sm, marginTop: SPACING.xs },
  benefit:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  btnAllow: {
    width: '100%',
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  btnAllowText: { fontFamily: FONTS.bodySemiBold, color: COLORS.bg, fontSize: 16 },
  btnSkip:      { paddingVertical: SPACING.sm },
  btnSkipText:  { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },
});
