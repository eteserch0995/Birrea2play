import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * CancelRegistrationModal
 * Props: visible, onClose, onConfirm(cancelGuests: boolean), loading, canRefund,
 *        amount, refundDeadline, metodoPago, guestCount, guestNames
 */
export default function CancelRegistrationModal({
  visible, onClose, onConfirm, loading = false,
  canRefund = false, amount = 0, refundDeadline,
  metodoPago = '', guestCount = 0,
}) {
  const isWallet  = metodoPago === 'wallet';
  const isPending = metodoPago === 'efectivo';
  const hasGuests = guestCount > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Cancelar Inscripción</Text>

          {/* Refund / no-refund info */}
          {isWallet && canRefund ? (
            <View style={styles.refundBox}>
              <Text style={styles.refundText}>
                ✓  Aplica reembolso de ${amount.toFixed(2)} a tus créditos
              </Text>
            </View>
          ) : isWallet && !canRefund ? (
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
          ) : isPending ? (
            <View style={styles.noRefundBox}>
              <Text style={styles.noRefundText}>
                Tu pago en efectivo estaba pendiente — no se hará cargo alguno.
              </Text>
            </View>
          ) : (
            <View style={styles.noRefundBox}>
              <Text style={styles.noRefundText}>
                Los pagos con Yappy o efectivo son gestionados por el administrador.{'\n'}
                No se realiza reembolso automático.
              </Text>
            </View>
          )}

          {/* Guest section */}
          {hasGuests ? (
            <>
              <View style={styles.guestInfoBox}>
                <Text style={styles.guestInfoText}>
                  👥  Tienes {guestCount} invitado(s) en este evento.{'\n'}¿Qué deseas cancelar?
                </Text>
              </View>

              <View style={styles.btnsVertical}>
                <TouchableOpacity
                  style={[styles.btnOption, { borderColor: COLORS.red + '60' }]}
                  onPress={() => onConfirm(false)}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={COLORS.white} />
                    : <>
                        <Text style={styles.btnOptionTitle}>Solo yo</Text>
                        <Text style={styles.btnOptionSub}>Mis invitados permanecen en el evento</Text>
                      </>
                  }
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnOption, { borderColor: COLORS.red }]}
                  onPress={() => onConfirm(true)}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color={COLORS.white} />
                    : <>
                        <Text style={styles.btnOptionTitle}>Yo y mis invitados</Text>
                        <Text style={styles.btnOptionSub}>Cancela tu inscripción y la de tus {guestCount} invitado(s)</Text>
                      </>
                  }
                </TouchableOpacity>
              </View>

              <Text style={styles.adminNote}>
                📌 Para cancelar un invitado específico después, escribe al administrador.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.confirm}>¿Deseas cancelar tu inscripción?</Text>
              <View style={styles.btns}>
                <TouchableOpacity style={styles.btnKeep} onPress={onClose} disabled={loading}>
                  <Text style={styles.btnKeepText}>Mantener</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnCancel} onPress={() => onConfirm(false)} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color={COLORS.white} />
                    : <Text style={styles.btnCancelText}>Sí, cancelar</Text>
                  }
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity style={styles.btnClose} onPress={onClose} disabled={loading}>
            <Text style={styles.btnCloseText}>Mantener inscripción</Text>
          </TouchableOpacity>
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
  guestInfoBox: { backgroundColor: COLORS.gold + '20', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold },
  guestInfoText:{ fontFamily: FONTS.bodyMedium, color: COLORS.gold, fontSize: 13, lineHeight: 20 },
  btnsVertical: { gap: SPACING.sm },
  btnOption: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    gap: 4,
  },
  btnOptionTitle:{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },
  btnOptionSub:  { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12 },
  adminNote:    { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
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
  btnClose: {
    alignItems: 'center',
    padding: SPACING.sm,
    marginTop: 4,
  },
  btnCloseText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },
});
