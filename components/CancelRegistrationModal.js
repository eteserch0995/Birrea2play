import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import BottomSheetModal from './ui/BottomSheetModal';

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
  // Política de devoluciones (2026-06-04): cancelar siempre se puede.
  // ≥48h antes del evento → 100% a créditos | <48h → 50% a créditos.
  // Siempre en créditos internos, sin importar el método de pago original.
  const isPaid    = (metodoPago === 'wallet' || metodoPago === 'yappy_boton') && amount > 0;
  const isCash    = metodoPago === 'efectivo';
  const hasGuests = guestCount > 0;
  const refund100 = (amount ?? 0).toFixed(2);
  const refund50  = ((amount ?? 0) * 0.5).toFixed(2);

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Cancelar Inscripción"
      // Modal de reembolso: el overlay actual no cerraba al tocar, y por regla
      // los modales que disparan pagos/reembolsos siempre van con false.
      dismissOnBackdrop={false}
    >
      <View style={{ gap: SPACING.md }}>
        {/* Refund info — el usuario ve el costo ANTES de confirmar */}
        {canRefund ? (
          isPaid ? (
            <View style={styles.refundBox}>
              <Text style={styles.refundText}>
                ✓  Se devuelven ${refund100} (100%) a tus créditos internos.
              </Text>
            </View>
          ) : isCash ? (
            <View style={styles.refundBox}>
              <Text style={styles.refundText}>
                ✓  Si tu pago en efectivo ya fue recibido, se devuelven ${refund100} (100%) a tus créditos internos. Si aún no pagaste, no se hace cargo alguno.
              </Text>
            </View>
          ) : (
            <View style={styles.noRefundBox}>
              <Text style={styles.noRefundText}>No hay pagos registrados que devolver.</Text>
            </View>
          )
        ) : isPaid ? (
          <View style={styles.noRefundBox}>
            <Text style={styles.noRefundText}>
              ⚠️  Estás cancelando a menos de 48 horas del evento.{'\n'}
              Se devuelve el 50% (${refund50}) a tus créditos internos; el resto se retiene como cargo por cancelación tardía.
            </Text>
            {refundDeadline && (
              <Text style={styles.deadlineText}>
                Plazo para 100% venció: {new Date(refundDeadline).toLocaleString('es-PA')}
              </Text>
            )}
          </View>
        ) : isCash ? (
          <View style={styles.noRefundBox}>
            <Text style={styles.noRefundText}>
              ⚠️  Estás cancelando a menos de 48 horas del evento.{'\n'}
              Si tu pago en efectivo ya fue recibido, se devuelve el 50% (${refund50}) a tus créditos internos.{'\n'}
              Si aún no pagaste, el pago en efectivo quedará bloqueado para futuros eventos.
            </Text>
          </View>
        ) : (
          <View style={styles.noRefundBox}>
            <Text style={styles.noRefundText}>No hay pagos registrados que devolver.</Text>
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
                dataSet={{ t2Press: '' }}
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
                dataSet={{ t2Press: '' }}
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
              <TouchableOpacity style={styles.btnCancel} onPress={() => onConfirm(false)} disabled={loading} dataSet={{ t2Press: '' }}>
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
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
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
