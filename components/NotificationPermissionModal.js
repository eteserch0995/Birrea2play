import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * Pre-permission prompt before triggering the system notification dialog.
 * Show this once; record the decision in AsyncStorage so it's not repeated.
 */
export default function NotificationPermissionModal({ visible, onAllow, onSkip }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>🔔</Text>
          <Text style={styles.title}>ACTIVA LAS{'\n'}NOTIFICACIONES</Text>
          <Text style={styles.body}>
            Entérate al instante de:
          </Text>
          <View style={styles.benefits}>
            <Text style={styles.benefit}>📅  Nuevos eventos y cambios de fecha</Text>
            <Text style={styles.benefit}>🏆  Cuando seas elegido MVP</Text>
            <Text style={styles.benefit}>💰  Movimientos en tus créditos</Text>
            <Text style={styles.benefit}>📢  Anuncios del gestor de tu evento</Text>
          </View>

          <TouchableOpacity style={styles.btnAllow} onPress={onAllow}>
            <Text style={styles.btnAllowText}>Activar notificaciones</Text>
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
    backgroundColor: '#00000099',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    width: '100%',
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  icon:     { fontSize: 48 },
  title:    { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 3, textAlign: 'center' },
  body:     { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, textAlign: 'center' },
  benefits: { width: '100%', gap: SPACING.sm },
  benefit:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  btnAllow: {
    width: '100%',
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  btnAllowText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 16 },
  btnSkip:      { padding: SPACING.sm },
  btnSkipText:  { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },
});
