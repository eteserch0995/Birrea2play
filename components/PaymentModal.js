import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { supabase } from '../lib/supabase';

/**
 * PaymentModal — bottom-sheet for event inscription payment.
 * Props: visible, onClose, onPayWallet, onPayYappy, onPayEfectivo,
 *        amount, walletBalance, loading, showEfectivo, efectivoBloqueado,
 *        showWallet (default true; false = evento solo-Yappy: oculta créditos y mixto),
 *        efectivoLibre (default false; true = evento sin mínimo de birrias para
 *        efectivo — el trigger server-side tiene la misma excepción por-evento)
 */
export default function PaymentModal({
  visible, onClose, onPayWallet, onPayYappy, onPayEfectivo, onPayMixto,
  amount = 0, walletBalance = 0, loading = false, showEfectivo = true,
  efectivoBloqueado = false, showWallet = true, efectivoLibre = false,
}) {
  const sufficient = walletBalance >= amount;
  // Mixto: wallet cubre más del 50% pero no alcanza para todo
  const mixtoWallet = Math.min(walletBalance, amount - 0.01);
  const mixtoYappy  = amount - mixtoWallet;
  const canMixto    = !sufficient && walletBalance > amount / 2 && walletBalance > 0;

  // Pago en efectivo: requiere >=3 birrias jugadas y no estar bloqueado por admin.
  // Lo consulta el propio modal (RPC efectivo_status) cuando se abre.
  const [efSt, setEfSt] = useState(null); // { allowed, eventos, min, bloqueado }
  useEffect(() => {
    if (!visible) { setEfSt(null); return; }   // reset al cerrar -> re-consulta fresco al reabrir
    if (!showEfectivo) return;
    let cancelled = false;
    setEfSt(null);
    (async () => {
      const FALLBACK = { allowed: false, eventos: 0, min: 3, bloqueado: false, forzado: false };
      try {
        const { data, error } = await supabase.rpc('efectivo_status');
        if (cancelled) return;
        setEfSt(error || !data ? FALLBACK : data); // ante error: default seguro (oculta efectivo), no spinner infinito
      } catch (_) {
        if (!cancelled) setEfSt(FALLBACK);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, showEfectivo]);

  const efMin = efSt?.min ?? 3;
  const efEventos = efSt?.eventos ?? 0;
  const efBloq = efSt ? !!efSt.bloqueado : !!efectivoBloqueado;
  // efectivoLibre: el evento exime del mínimo de birrias, pero el bloqueo
  // por-usuario (castigo) sigue mandando.
  const efAllowed = !!efSt && !efBloq && (efSt.allowed === true || efectivoLibre);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet} dataSet={{ t2Glass: '' }}>
          <Text style={styles.title}>INSCRIPCIÓN</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Monto a pagar</Text>
            <Text style={styles.val}>${amount.toFixed(2)}</Text>
          </View>
          {showWallet && (
            <View style={styles.row}>
              <Text style={styles.label}>Tus créditos</Text>
              <Text style={[styles.val, { color: sufficient ? COLORS.green : COLORS.red }]}>
                ${walletBalance.toFixed(2)}
              </Text>
            </View>
          )}

          <View style={styles.divider} />

          {showWallet && (
            <TouchableOpacity
              style={[styles.btn, styles.btnWallet, !sufficient && styles.btnDisabled]}
              onPress={onPayWallet}
              disabled={loading || !sufficient}
              dataSet={{ t2Press: '' }}
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
          )}

          <TouchableOpacity style={[styles.btn, styles.btnYappy]} onPress={onPayYappy} disabled={loading} dataSet={{ t2Press: '' }}>
            <Text style={styles.btnText}>📱 Pagar con Yappy</Text>
          </TouchableOpacity>

          {showWallet && canMixto && onPayMixto && (
            <TouchableOpacity
              style={[styles.btn, styles.btnMixto]}
              onPress={() => onPayMixto(mixtoWallet, mixtoYappy)}
              disabled={loading}
              dataSet={{ t2Press: '' }}
            >
              <Text style={styles.btnText}>💰+📱 Pago mixto</Text>
              <Text style={styles.btnSub}>
                ${mixtoWallet.toFixed(2)} créditos + ${mixtoYappy.toFixed(2)} Yappy
              </Text>
            </TouchableOpacity>
          )}

          {showEfectivo && onPayEfectivo && (
            efSt === null ? (
              <View style={styles.efInfoBox}>
                <ActivityIndicator color={COLORS.gold} />
                <Text style={styles.efInfoSub}>Verificando pago en efectivo…</Text>
              </View>
            ) : efAllowed ? (
              <TouchableOpacity style={[styles.btn, styles.btnEfectivo]} onPress={onPayEfectivo} disabled={loading} dataSet={{ t2Press: '' }}>
                <Text style={styles.btnText}>💵 Pagar en Efectivo</Text>
                <Text style={styles.btnSub}>Ventana de 4 horas — contacta al gestor</Text>
              </TouchableOpacity>
            ) : efBloq ? (
              <View style={styles.penaltyBox}>
                <Text style={styles.penaltyIcon}>🚫</Text>
                <Text style={styles.penaltyTitle}>Pago en efectivo no disponible</Text>
              </View>
            ) : (
              <View style={styles.lockBox}>
                <Text style={styles.lockIcon}>🔒</Text>
                <Text style={styles.lockTitle}>Pago en efectivo bloqueado</Text>
                <Text style={styles.lockSub}>
                  Necesitás haber participado en al menos {efMin} birrias para desbloquear el pago en efectivo. ({efEventos}/{efMin})
                </Text>
              </View>
            )
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
  btnMixto:    { backgroundColor: '#1A4A6B' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.white },
  btnSub:  { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white + 'AA', marginTop: 2 },
  cancelBtn:  { alignItems: 'center', padding: SPACING.sm, marginTop: SPACING.sm },
  cancelText: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 },

  penaltyBox:   { backgroundColor: '#3D1A1A', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.red + '66' },
  penaltyIcon:  { fontSize: 22 },
  penaltyTitle: { fontFamily: FONTS.bodyBold, color: COLORS.red, fontSize: 14 },
  penaltySub:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12, textAlign: 'center', lineHeight: 17 },

  efInfoBox: { alignItems: 'center', padding: SPACING.md, gap: 6 },
  efInfoSub: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 },
  lockBox:   { backgroundColor: COLORS.gold + '14', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.gold + '55' },
  lockIcon:  { fontSize: 22 },
  lockTitle: { fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 14 },
  lockSub:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12, textAlign: 'center', lineHeight: 17 },
});
