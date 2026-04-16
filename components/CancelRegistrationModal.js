import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * CancelRegistrationModal
 * Props: visible, onClose, onConfirm, loading, canRefund, amount, refundDeadline
 */
export default function CancelRegistrationModal({
  visible, onClose, onConfirm, loading = false,
  canRefund = false, amount = 0, refundDeadline,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Cancelar Inscripción</Text>

          {canRefund ? (
            <View style={styles.refundBox}>
              <Text style={styles.refundText}>
                ✓  Aplica reembolso de ${amount.toFixed(2)} a tu wallet
              </Text>
            </View>
          ) : (
            <View style={styles.noRefundBox}>
              <Text style={styles.noRefundText}>
                ⚠️  El evento comienza en menos de 48 horas.{'\n'}No aplica reembolso.
              </Text>
              {refundDeadline && (
                <Text style={styles.deadlineText}>
                  Plazo venció: {new Date(refundDeadline).toLocaleString('es-PA')}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.confirm}>¿Deseas cancelar tu inscripción?</Text>

          <View style={styles.btns}>
            <TouchableOpacity style={styles.btnKeep} onPress={onClose}>
              <Text style={styles.btnKeepText}>Mantener</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnCancel} onPress={onConfirm} disabled={loading}>
              {loading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.btnCancelText}>Sí, cancelar</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000000BB', justifyContent: 'center', padding: SPACING.xl },
  sheet: {
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  title:        { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  refundBox:    { backgroundColor: COLORS.green + '20', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.green },
  refundText:   { fontFamily: FONTS.bodyMedium, color: COLORS.green, fontSize: 14 },
  noRefundBox:  { backgroundColor: COLORS.red + '20', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.red },
  noRefundText: { fontFamily: FONTS.body, color: COLORS.red, fontSize: 13, lineHeight: 20 },
  deadlineText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, marginTop: 4 },
  confirm:      { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14 },
  btns:         { flexDirection: 'row', gap: SPACING.sm },
  btnKeep: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  btnKeepText:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  btnCancel:     { flex: 1, backgroundColor: COLORS.red, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnCancelText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },
});
