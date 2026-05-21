import React from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * PaymentModal — bottom-sheet for event inscription payment.
 * Props: visible, onClose, onPayWallet, onPayYappy, onPayEfectivo,
 *        amount, walletBalance, loading, showEfectivo, efectivoBloqueado
 */
export default function PaymentModal({
  visible, onClose, onPayWallet, onPayYappy, onPayEfectivo,
  amount = 0, walletBalance = 0, loading = false, showEfectivo = true,
  efectivoBloqueado = false,
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
            <Text style={styles.label}>Tus créditos</Text>
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
                  <Text style={styles.btnText}>💰 Usar créditos internos</Text>
                  {!sufficient && <Text style={styles.btnSub}>Créditos insuficientes — compra créditos primero</Text>}
                </>
              )
            }
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnYappy]} onPress={onPayYappy} disabled={loading}>
            <Text style={styles.btnText}>📱 Pagar con Yappy</Text>
          </TouchableOpacity>

          {showEfectivo && onPayEfectivo && !efectivoBloqueado && (
            <TouchableOpacity style={[styles.btn, styles.btnEfectivo]} onPress={onPayEfectivo} disabled={loading}>
              <Text style={styles.btnText}>💵 Pagar en Efectivo</Text>
              <Text style={styles.btnSub}>Ventana de 4 horas — contacta al gestor</Text>
            </TouchableOpacity>
          )}
          {efectivoBloqueado && (
            <View style={styles.penaltyBox}>
              <Text style={styles.penaltyIcon}>🚫</Text>
              <Text style={styles.penaltyTitle}>Efectivo no disponible</Text>
              <Text style={styles.penaltySub}>Tienes una penalización por cancelación tardía. Usa Créditos o Yappy para inscribirte.</Text>
            </View>
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

  penaltyBox:   { backgroundColor: '#3D1A1A', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.red + '66' },
  penaltyIcon:  { fontSize: 22 },
  penaltyTitle: { fontFamily: FONTS.bodyBold, color: COLORS.red, fontSize: 14 },
  penaltySub:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
