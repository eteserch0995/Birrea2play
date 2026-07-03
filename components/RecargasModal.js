import React, { useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import useAuthStore from '../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../lib/yappy';
import { iniciarPagoTarjeta } from '../lib/paguelofacil';

const TIERS = [
  { amount: 18, credito: 20,  label: '$18 → $20',  bonus: '+$2',  color: COLORS.navy  },
  { amount: 20, credito: 24,  label: '$20 → $24',  bonus: '+$4',  color: COLORS.blue  },
  { amount: 25, credito: 30,  label: '$25 → $30',  bonus: '+$5',  color: COLORS.gold  },
];

export default function RecargasModal({ visible, onClose, onSuccess }) {
  const { user } = useAuthStore();
  const [step,         setStep]         = useState('tiers');  // 'tiers' | 'payment'
  const [tier,         setTier]         = useState(null);
  const [metodo,       setMetodo]       = useState('yappy');
  const [yappyPhone,   setYappyPhone]   = useState('');
  const [yappyStep,    setYappyStep]    = useState('idle');   // 'idle' | 'polling'
  const [yappyProgress,setYappyProgress]= useState({ attempts: 0, maxAttempts: 60 });
  const [procesando,   setProcesando]   = useState(false);
  const cancelRef = useRef(null);

  function reset() {
    setStep('tiers');
    setTier(null);
    setMetodo('yappy');
    setYappyPhone('');
    setYappyStep('idle');
    setYappyProgress({ attempts: 0, maxAttempts: 60 });
    setProcesando(false);
    cancelRef.current?.();
    cancelRef.current = null;
  }

  function handleClose() { reset(); onClose(); }

  async function pagarYappy() {
    const phone = yappyPhone.replace(/\D/g, '');
    if (phone.length < 7) { Alert.alert('Error', 'Ingresa un número Yappy válido'); return; }
    if (procesando) return;
    setProcesando(true);

    let orderId;
    try {
      const result = await iniciarBotonYappy({
        phone,
        amount:        tier.amount,
        credito_monto: tier.credito,
      });
      orderId = result.orderId;
    } catch (e) {
      Alert.alert('Error', e.message);
      setProcesando(false);
      return;
    }

    setYappyStep('polling');
    setYappyProgress({ attempts: 0, maxAttempts: 60 });

    const { promise, cancel } = pollBotonOrder({
      orderId,
      onProgress: (p) => setYappyProgress(p),
    });
    cancelRef.current = cancel;

    promise
      .then(() => {
        cancelRef.current = null;
        Alert.alert(
          '✅ Recarga exitosa',
          `Se acreditaron $${tier.credito.toFixed(2)} a tus créditos.`,
          [{ text: 'OK', onPress: () => { reset(); onClose(); onSuccess?.(); } }],
        );
      })
      .catch((e) => {
        cancelRef.current = null;
        setYappyStep('idle');
        if (e.message !== 'cancelled') Alert.alert('Pago no completado', e.message);
      })
      .finally(() => setProcesando(false));
  }

  async function pagarTarjeta() {
    if (procesando) return;
    setProcesando(true);
    try {
      await iniciarPagoTarjeta({
        userId:        user.id,
        amount:        tier.amount,
        credito_monto: tier.credito,
        descripcion:   `Recarga con bono ${tier.label} — Birrea2Play`,
        tipo:          'recarga_tarjeta',
      });
      reset();
      onClose();
      Alert.alert(
        'Browser abierto',
        `Completa el pago de $${tier.amount.toFixed(2)}. Tus créditos recibirán $${tier.credito.toFixed(2)} al confirmar.`,
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcesando(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet} dataSet={{ t2Glass: '' }}>
          <View style={styles.header}>
            <Text style={styles.title}>CRÉDITOS CON BONO</Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {/* ── Paso 1: elegir tier ───────────────────────────────── */}
            {step === 'tiers' && (
              <>
                <Text style={styles.subtitle}>Compra créditos internos para eventos y servicios Birrea2Play</Text>
                {TIERS.map((t) => (
                  <TouchableOpacity
                    key={t.amount}
                    style={styles.tierCard}
                    dataSet={{ t2Press: '' }}
                    onPress={() => { setTier(t); setStep('payment'); }}
                  >
                    <View style={[styles.tierBadge, { backgroundColor: t.color }]}>
                      <Text style={styles.tierBonusText}>{t.bonus}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tierAmounts}>
                        ${t.amount} {'→'} <Text style={styles.tierCredito}>${t.credito}</Text>
                      </Text>
                      <Text style={styles.tierSub}>Pagas ${t.amount} — recibes ${t.credito} en créditos internos</Text>
                    </View>
                    <Text style={styles.tierArrow}>›</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            {/* ── Paso 2: método de pago ───────────────────────────── */}
            {step === 'payment' && tier && (
              <>
                <Text style={styles.subtitle}>
                  Pagas <Text style={styles.tierCredito}>${tier.amount}</Text>
                  {' → '}recibes <Text style={styles.tierCredito}>${tier.credito}</Text>
                </Text>

                <View style={styles.metodoBtns}>
                  <TouchableOpacity
                    style={[styles.metodoBtn, metodo === 'yappy' && styles.metodoBtnActivo]}
                    dataSet={{ t2Press: '' }}
                    onPress={() => setMetodo('yappy')}
                    disabled={procesando}
                  >
                    <Text style={[styles.metodoBtnText, metodo === 'yappy' && styles.metodoBtnTextActivo]}>
                      📱 Yappy
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.metodoBtn, metodo === 'tarjeta' && styles.metodoBtnActivo]}
                    dataSet={{ t2Press: '' }}
                    onPress={() => setMetodo('tarjeta')}
                    disabled={procesando}
                  >
                    <Text style={[styles.metodoBtnText, metodo === 'tarjeta' && styles.metodoBtnTextActivo]}>
                      💳 Tarjeta
                    </Text>
                  </TouchableOpacity>
                </View>

                {metodo === 'yappy' && yappyStep === 'idle' && (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Número Yappy (ej. 61234567)"
                      placeholderTextColor={COLORS.gray}
                      keyboardType="phone-pad"
                      value={yappyPhone}
                      onChangeText={setYappyPhone}
                      maxLength={12}
                      editable={!procesando}
                    />
                    <TouchableOpacity
                      style={[styles.payBtn, yappyPhone.replace(/\D/g, '').length < 7 && styles.payBtnDisabled]}
                      onPress={pagarYappy}
                      disabled={procesando || yappyPhone.replace(/\D/g, '').length < 7}
                    >
                      {procesando
                        ? <ActivityIndicator color={COLORS.white} />
                        : <Text style={styles.payBtnText}>📱 COBRAR POR YAPPY</Text>
                      }
                    </TouchableOpacity>
                  </>
                )}

                {metodo === 'yappy' && yappyStep === 'polling' && (
                  <View style={styles.pollingCard}>
                    <ActivityIndicator color={COLORS.green} style={{ marginBottom: SPACING.sm }} />
                    <Text style={styles.pollingTitle}>Esperando aprobación...</Text>
                    <Text style={styles.pollingAmount}>${tier.credito.toFixed(2)}</Text>
                    <Text style={styles.pollingSub}>Abre tu app Yappy y acepta el cobro de Birrea2Play.{'\n'}O entra a tu banca en línea y elegí la opción de Yappy.</Text>
                    <Text style={styles.pollingDots}>
                      {yappyProgress.attempts}/{yappyProgress.maxAttempts} intentos
                    </Text>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => { cancelRef.current?.(); setYappyStep('idle'); setProcesando(false); }}
                    >
                      <Text style={styles.cancelBtnText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {metodo === 'tarjeta' && (
                  <>
                    <Text style={styles.tarjetaInfo}>
                      Se abrirá el browser con el checkout seguro de PágueloFácil.
                      Recibirás <Text style={styles.tierCredito}>${tier.credito.toFixed(2)}</Text> en créditos internos al confirmar.
                    </Text>
                    <TouchableOpacity style={styles.payBtn} onPress={pagarTarjeta} disabled={procesando}>
                      {procesando
                        ? <ActivityIndicator color={COLORS.white} />
                        : <Text style={styles.payBtnText}>💳 PAGAR CON TARJETA</Text>
                      }
                    </TouchableOpacity>
                  </>
                )}

                {!procesando && (
                  <TouchableOpacity style={styles.backBtn} onPress={() => setStep('tiers')}>
                    <Text style={styles.backBtnText}>← Cambiar monto</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <View style={{ height: SPACING.xl }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: COLORS.card2, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.xl, maxHeight: '90%' },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  title:    { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  closeBtn: { fontFamily: FONTS.body, fontSize: 20, color: COLORS.gray },
  subtitle: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, marginBottom: SPACING.md },

  tierCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.md,
  },
  tierBadge:      { width: 52, height: 52, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  tierBonusText:  { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 1 },
  tierAmounts:    { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  tierCredito:    { color: COLORS.green },
  tierSub:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  tierArrow:      { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gray },

  metodoBtns:          { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  metodoBtn:           { flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card },
  metodoBtnActivo:     { borderColor: COLORS.blue, backgroundColor: COLORS.blue + '22' },
  metodoBtnText:       { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
  metodoBtnTextActivo: { fontFamily: FONTS.bodyMedium, color: COLORS.white },

  input: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.white, fontFamily: FONTS.body,
    fontSize: 16, borderWidth: 1, borderColor: COLORS.navy, marginBottom: SPACING.sm,
  },
  payBtn:         { backgroundColor: COLORS.red, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  payBtnDisabled: { opacity: 0.4 },
  payBtnText:     { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 2 },

  pollingCard:   { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.xl, alignItems: 'center', borderWidth: 1, borderColor: COLORS.green + '55', gap: SPACING.sm },
  pollingTitle:  { fontFamily: FONTS.bodyMedium, fontSize: 16, color: COLORS.white },
  pollingAmount: { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.green },
  pollingSub:    { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, textAlign: 'center' },
  pollingDots:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  cancelBtn:     { marginTop: SPACING.sm, padding: SPACING.sm },
  cancelBtnText: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },

  tarjetaInfo: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, marginBottom: SPACING.md, textAlign: 'center' },
  backBtn:     { padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  backBtnText: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
});
