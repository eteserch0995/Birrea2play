import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * PaymentModal — bottom-sheet for event inscription payment.
 * Props: visible, onClose, onPayWallet, onPayYappy, onPayEfectivo,
 *        amount, walletBalance, loading, showEfectivo
 */
export default function PaymentModal({
  visible, onClose, onPayWallet, onPayYappy, onPayEfectivo,
  amount = 0, walletBalance = 0, loading = false, showEfectivo = true,
}) {
  const sufficient = walletBalance >= amount;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>INSCRIPCIÓN</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Monto a pagar</Text>
            <Text style={styles.val}>${amount.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Tu saldo wallet</Text>
            <Text style={[styles.val, { color: sufficient ? COLORS.green : COLORS.red }]}>
              ${walletBalance.toFixed(2)}
            </Text>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity
            style={[styles.btn, styles.btnWallet, !sufficient && styles.btnDisabled]}
            onPress={onPayWallet}
            disabled={loading || !sufficient}
          >
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : (
                <>
                  <Text style={styles.btnText}>💰 Pagar con Wallet</Text>
                  {!sufficient && <Text style={styles.btnSub}>Saldo insuficiente — recarga primero</Text>}
                </>
              )
            }
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnYappy]} onPress={onPayYappy} disabled={loading}>
            <Text style={styles.btnText}>📱 Pagar con Yappy</Text>
          </TouchableOpacity>

          {showEfectivo && onPayEfectivo && (
            <TouchableOpacity style={[styles.btn, styles.btnEfectivo]} onPress={onPayEfectivo} disabled={loading}>
              <Text style={styles.btnText}>💵 Pagar en Efectivo</Text>
              <Text style={styles.btnSub}>Ventana de 4 horas — contacta al gestor</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card2,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    gap: SPACING.sm,
  },
  title:   { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 3, marginBottom: SPACING.sm },
  row:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14 },
  val:     { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 16 },
  divider: { height: 1, backgroundColor: COLORS.navy, marginVertical: SPACING.sm },
  btn:         { borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnWallet:   { backgroundColor: COLORS.blue },
  btnYappy:    { backgroundColor: COLORS.green + 'CC' },
  btnEfectivo: { backgroundColor: '#7C5C1E' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.white },
  btnSub:  { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white + 'AA', marginTop: 2 },
  cancelBtn:  { alignItems: 'center', padding: SPACING.sm, marginTop: SPACING.sm },
  cancelText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 },
});
