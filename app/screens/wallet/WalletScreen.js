import React, { useEffect, useRef, useState, useCallback } from 'react'; // useRef kept for fetchDataRef
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, Linking,
  KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';
import { iniciarPagoTarjeta } from '../../../lib/paguelofacil';
import RecargasModal from '../../../components/RecargasModal';
import { logError } from '../../../lib/logger';

const TIPO_LABEL = {
  recarga_yappy:   '📱 Compra de créditos Yappy',
  recarga_tarjeta: '💳 Compra de créditos Tarjeta',
  inscripcion:     '⚽ Inscripción',
  compra_tienda:   '🛒 Compra tienda',
  mvp_premio:      '🏆 Premio MVP',
  ajuste_admin:    '⚙️ Ajuste admin',
  plan_mensual:    '🎖️ Plan mensual',
};

export default function WalletScreen() {
  const { user, walletBalance, setWalletBalance } = useAuthStore();

  const [txs,        setTxs]       = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  // Modal de recarga
  const [recargarModal, setRecargarModal] = useState(false);
  const [metodo,        setMetodo]        = useState('yappy');
  const [monto,         setMonto]         = useState('');
  const [procesando,    setProcesando]    = useState(false);
  // Yappy — 'idle' → envía cobro → 'polling' → aprobado en app Yappy → acreditado
  const [yappyStep,     setYappyStep]     = useState('idle');
  const [yappyPhone,    setYappyPhone]    = useState('');
  const [yappyProgress, setYappyProgress] = useState({ attempts: 0, maxAttempts: 60 });
  const yappyCancelRef = useRef(null);
  // Pending recargas (admin review queue)
  const [pendingRecargas, setPendingRecargas] = useState([]);


  // Modal de recargas con bono
  const [recargasModal, setRecargasModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setFetchError(null);
    try {
      const [walletRes, pendingRes] = await Promise.all([
        supabase.from('wallets').select('id, balance').eq('user_id', user.id).single(),
        supabase.from('pending_recargas')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      if (walletRes.error) throw new Error(walletRes.error.message);

      if (walletRes.data) {
        setWalletBalance(walletRes.data.balance);
        const { data: txData, error: txErr } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletRes.data.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (txErr) throw new Error(txErr.message);
        setTxs(txData ?? []);
      }

      setPendingRecargas(pendingRes.data ?? []);
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, setWalletBalance]);

  useFocusEffect(useCallback(() => {
    fetchData();
  }, [fetchData]));

  const fetchDataRef = useRef(null);
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  // Cleanup absoluto del polling Yappy si la pantalla se desmonta mientras
  // hay un cobro en curso. Sin esto el interval seguía corriendo en segundo
  // plano disparando setState sobre un componente desmontado.
  useEffect(() => () => {
    if (yappyCancelRef.current) {
      try { yappyCancelRef.current(); } catch {}
      yappyCancelRef.current = null;
    }
  }, []);

  // Escuchar deep link de PágueloFácil
  useEffect(() => {
    function handleDeepLink(url) {
      if (!url?.includes('creditos')) return;
      try {
        const parsed = new URL(url.replace('birrea2play://', 'https://app/'));
        const status = parsed.searchParams.get('status');
        const amount = parsed.searchParams.get('amount');
        const donacion = parsed.searchParams.get('donacion');

        // Recaudo Solidario: el retorno de una donación con tarjeta cae aquí (web-only),
        // pero NO acredita wallet. Mostrar el agradecimiento correcto y NO el mensaje de créditos.
        if (donacion === '1') {
          if (status === 'success') {
            Alert.alert(
              '❤️ ¡Gracias por tu donación!',
              'Tu aporte por Venezuela quedó registrado. El 100% se usa en compra de insumos y publicamos la factura en el grupo de WhatsApp.'
            );
          } else if (status === 'failed') {
            const razon = parsed.searchParams.get('razon') ?? 'Pago rechazado';
            Alert.alert('Donación no completada', decodeURIComponent(razon));
          } else if (status === 'error') {
            Alert.alert('Donación no completada', 'Ocurrió un error procesando la donación. Si el cobro fue aplicado, contacta soporte.');
          }
          return;
        }

        if (status === 'success') {
          if (fetchDataRef.current) fetchDataRef.current();
          Alert.alert(
            '✅ Pago exitoso',
            amount ? `Se acreditaron $${parseFloat(amount).toFixed(2)} en créditos internos.` : 'Tus créditos internos fueron acreditados.'
          );
        } else if (status === 'failed') {
          const razon = parsed.searchParams.get('razon') ?? 'Pago rechazado';
          Alert.alert('Pago rechazado', decodeURIComponent(razon));
        } else if (status === 'error') {
          Alert.alert('Error', 'Ocurrió un error procesando el pago. Contacta soporte si el cobro fue aplicado.');
        }
      } catch { /* URL no parseable */ }
    }

    const handleUrl = ({ url }) => handleDeepLink(url);
    const sub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => { if (url) handleDeepLink(url); }).catch(() => {});
    return () => sub.remove();
  }, []);

  function abrirRecargarModal() {
    setMonto('');
    setYappyPhone('');
    setMetodo('yappy');
    setYappyStep('idle');
    setRecargarModal(true);
  }

  function cerrarModal() {
    if (yappyCancelRef.current) { yappyCancelRef.current(); yappyCancelRef.current = null; }
    setRecargarModal(false);
    setYappyStep('idle');
    setProcesando(false);
  }

  // ─── Recarga Yappy — cobro por teléfono ──────────────────────────────────────
  async function iniciarCobroYappy() {
    const amt   = parseFloat(monto);
    const phone = yappyPhone.replace(/\D/g, '');
    if (!amt || amt < 1)        { Alert.alert('Error', 'Monto mínimo $1.00'); return; }
    if (amt > 500)               { Alert.alert('Error', 'Monto máximo $500.00'); return; }
    if (phone.length < 7)        { Alert.alert('Error', 'Ingresa un número Yappy válido'); return; }
    if (procesando)              return;

    setProcesando(true);
    let orderId;
    try {
      const result = await iniciarBotonYappy({ phone, amount: amt });
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
    yappyCancelRef.current = cancel;

    promise
      .then(() => {
        yappyCancelRef.current = null;
        Alert.alert(
          '✅ Pago confirmado',
          `Se acreditaron $${amt.toFixed(2)} a tus créditos.`,
          [{ text: 'OK', onPress: () => { cerrarModal(); fetchData(); } }],
        );
      })
      .catch((e) => {
        yappyCancelRef.current = null;
        setYappyStep('idle');
        if (e.message !== 'cancelled') Alert.alert('Pago no completado', e.message);
      })
      .finally(() => setProcesando(false));
  }

  function cancelarYappy() {
    if (yappyCancelRef.current) { yappyCancelRef.current(); yappyCancelRef.current = null; }
    setYappyStep('idle');
    setProcesando(false);
  }

  // ─── Recarga Tarjeta (PágueloFácil) ─────────────────────────────────────────
  async function recargarTarjeta() {
    const amt = parseFloat(monto);
    if (!amt || amt < 1) { Alert.alert('Error', 'Monto mínimo $1.00'); return; }
    if (procesando) return; // guard doble tap
    setProcesando(true);
    try {
      await iniciarPagoTarjeta({
        userId:      user.id,
        amount:      amt,
        descripcion: `Recarga créditos Birrea2Play $${amt.toFixed(2)}`,
        tipo:        'recarga_tarjeta',
      });
      // Solo cerrar el modal cuando el browser se abrió exitosamente.
      // Si falla, el modal queda abierto para que el user pueda reintentar.
      setRecargarModal(false);
      setMonto('');
      Alert.alert(
        'Browser abierto',
        'Completa el pago en el browser. Tus créditos se actualizarán automáticamente al confirmar.'
      );
    } catch (e) {
      logError({ screen: 'WalletScreen', action: 'recargarTarjeta', userId: user?.id, technical: e, extra: { amount: amt } });
      Alert.alert(
        'No pudimos abrir el pago',
        e?.message || 'Intenta nuevamente. Si el problema continúa, verifica tu conexión.',
      );
    } finally {
      setProcesando(false);
    }
  }

  const handleRecargar = () => metodo === 'tarjeta' ? recargarTarjeta() : null;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />
        }
      >
        <Text style={styles.title}>CRÉDITOS</Text>

        {/* Hero card */}
        <LinearGradient
          colors={[COLORS.red, COLORS.asphalt, COLORS.blue]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <Text style={styles.heroLabel}>CRÉDITOS INTERNOS</Text>
          <Text style={styles.heroAmount}>${walletBalance.toFixed(2)}</Text>
          <Text style={styles.heroDisclosure}>
            No son dinero electrónico, no son transferibles y solo aplican a eventos y servicios de Birrea2Play.
          </Text>
          <View style={styles.heroBtns}>
            <TouchableOpacity style={styles.recargarBtn} onPress={abrirRecargarModal}>
              <Text style={styles.recargarText}>+ COMPRAR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.planesBtn} onPress={() => setRecargasModal(true)}>
              <Text style={styles.planesBtnText}>🎁 BONOS</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Recargas pendientes */}
        {pendingRecargas.filter(r => r.status === 'pending').length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Recargas en revisión</Text>
            {pendingRecargas.filter(r => r.status === 'pending').map((r) => (
              <View key={r.id} style={styles.pendingRow}>
                <Text style={styles.pendingLabel}>⏳ {r.tier_label ?? `$${Number(r.amount_paid).toFixed(2)}`}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  {r.amount_credito !== r.amount_paid
                    ? <Text style={styles.pendingCredito}>→ +${Number(r.amount_credito).toFixed(2)}</Text>
                    : <Text style={styles.pendingCredito}>+${Number(r.amount_credito).toFixed(2)}</Text>
                  }
                  <Text style={styles.pendingDate}>
                    {new Date(r.created_at).toLocaleString('es-PA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Historial */}
        <Text style={styles.sectionTitle}>Historial de movimientos</Text>
        {loading ? (
          <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} />
        ) : fetchError ? (
          <View style={{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
            <Text style={{ fontSize: 32 }}>⚠️</Text>
            <Text style={styles.empty}>Error al cargar los datos</Text>
            <Text style={[styles.empty, { fontSize: 12, paddingVertical: 0 }]}>{fetchError}</Text>
            <TouchableOpacity
              style={{ backgroundColor: COLORS.red, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm, borderRadius: RADIUS.md }}
              onPress={() => { setLoading(true); fetchData(); }}
            >
              <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white }}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : txs.length === 0 ? (
          <View style={{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm }}>
            <Text style={{ fontSize: 40 }}>💳</Text>
            <Text style={styles.empty}>No hay movimientos aún</Text>
            <Text style={[styles.empty, { fontSize: 12, paddingVertical: 0 }]}>Tus recargas y gastos aparecerán aquí</Text>
          </View>
        ) : (
          txs.map((tx) => (
            <View key={tx.id} style={styles.txRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txTipo}>{TIPO_LABEL[tx.tipo] ?? tx.tipo}</Text>
                <Text style={styles.txDesc} numberOfLines={2}>{tx.descripcion ?? ''}</Text>
                <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleDateString('es-PA')}</Text>
              </View>
              <Text style={[styles.txMonto, { color: tx.monto > 0 ? COLORS.green : COLORS.red2 ?? COLORS.red }]}>
                {tx.monto > 0 ? '+' : ''}${Math.abs(tx.monto).toFixed(2)}
              </Text>
            </View>
          ))
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* ── Modal de Recarga ── */}
      <Modal visible={recargarModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>COMPRAR CRÉDITOS</Text>

            {/* Selector de método */}
            <View style={styles.metodoBtns}>
              <TouchableOpacity
                style={[styles.metodoBtn, metodo === 'yappy' && styles.metodoBtnActivo]}
                onPress={() => setMetodo('yappy')}
                disabled={procesando}
              >
                <Text style={[styles.metodoBtnText, metodo === 'yappy' && styles.metodoBtnTextActivo]}>
                  📱 Yappy
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.metodoBtn, metodo === 'tarjeta' && styles.metodoBtnActivo]}
                onPress={() => setMetodo('tarjeta')}
                disabled={procesando}
              >
                <Text style={[styles.metodoBtnText, metodo === 'tarjeta' && styles.metodoBtnTextActivo]}>
                  💳 Tarjeta
                </Text>
              </TouchableOpacity>
            </View>

            {metodo === 'tarjeta' ? (
              <>
                <Text style={styles.metodoInfo}>
                  Se abrirá el browser con el checkout seguro de PágueloFácil. Los créditos solo sirven para eventos y servicios Birrea2Play.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Monto de créditos (ej. 10.00)"
                  placeholderTextColor={COLORS.gray}
                  keyboardType="decimal-pad"
                  value={monto}
                  onChangeText={setMonto}
                  editable={!procesando}
                />
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={cerrarModal} disabled={procesando}>
                    <Text style={styles.modalCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, { backgroundColor: COLORS.blue + 'CC' }]}
                    onPress={handleRecargar}
                    disabled={procesando}
                  >
                    {procesando
                      ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={styles.modalConfirmText}>Pagar con Tarjeta</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : yappyStep === 'idle' ? (
              <>
                <Text style={styles.metodoInfo}>
                  Ingresa tu número Yappy y el monto. Recibirás una notificación en tu app Yappy para aprobar la compra de créditos internos.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Número Yappy (ej. 61234567)"
                  placeholderTextColor={COLORS.gray}
                  keyboardType="phone-pad"
                  value={yappyPhone}
                  onChangeText={setYappyPhone}
                  maxLength={12}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Monto de créditos (ej. 10.00)"
                  placeholderTextColor={COLORS.gray}
                  keyboardType="decimal-pad"
                  value={monto}
                  onChangeText={setMonto}
                />
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={cerrarModal}>
                    <Text style={styles.modalCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalConfirm, {
                      opacity: (parseFloat(monto) >= 1 && yappyPhone.replace(/\D/g,'').length >= 7) ? 1 : 0.4,
                    }]}
                    onPress={iniciarCobroYappy}
                    disabled={procesando || !(parseFloat(monto) >= 1 && yappyPhone.replace(/\D/g,'').length >= 7)}
                  >
                    {procesando
                      ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={styles.modalConfirmText}>📱 Cobrar por Yappy</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={styles.openedCard}>
                  <ActivityIndicator color={COLORS.green ?? COLORS.white} style={{ marginBottom: 12 }} />
                  <Text style={styles.openedTitle}>Esperando aprobación...</Text>
                  <Text style={styles.openedAmount}>
                    ${isNaN(parseFloat(monto)) ? '0.00' : parseFloat(monto).toFixed(2)}
                  </Text>
                  <Text style={styles.openedSub}>
                    Abre tu app Yappy y acepta el cobro de Birrea2Play.{'\n'}
                    O entra a tu banca en línea y elegí la opción de Yappy.
                  </Text>
                  <Text style={styles.pollingDots}>
                    {yappyProgress.attempts}/{yappyProgress.maxAttempts} intentos
                  </Text>
                </View>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalCancel} onPress={cancelarYappy}>
                    <Text style={styles.modalCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de Recargas con Bono */}
      <RecargasModal
        visible={recargasModal}
        onClose={() => setRecargasModal(false)}
        onSuccess={() => { setRecargasModal(false); fetchData(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: COLORS.bg },
  title: { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },

  heroCard: {
    margin: SPACING.md,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  planBadge: {
    backgroundColor: COLORS.white + '22',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    marginBottom: SPACING.sm,
  },
  planBadgeText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white, letterSpacing: 1 },
  heroLabel:  { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon, letterSpacing: 2 },
  heroAmount: { fontFamily: FONTS.heading, fontSize: 60, color: COLORS.white, marginVertical: SPACING.sm, letterSpacing: 1 },
  heroDisclosure: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.white + 'AA',
    textAlign: 'center',
    marginBottom: SPACING.md,
    lineHeight: 15,
  },
  heroBtns:   { flexDirection: 'row', gap: SPACING.sm },
  recargarBtn: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  recargarText: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.asphalt, letterSpacing: 3 },
  planesBtn: {
    backgroundColor: COLORS.neon + '22',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.neon,
  },
  planesBtnText: { fontFamily: FONTS.heading, fontSize: 12, color: COLORS.neon, letterSpacing: 2 },

  planInfo: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.green + '15',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.green + '44',
  },
  planInfoText: { fontFamily: FONTS.body, color: COLORS.white + 'CC', fontSize: 13 },
  planInfoBold: { fontFamily: FONTS.bodyMedium, color: COLORS.green },
  planInfoSub:  { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 11, marginTop: 2 },

  sectionTitle: {
    fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white,
    letterSpacing: 1.5, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm,
  },
  txRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.line,
  },
  txTipo:  { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white },
  txDesc:  { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginTop: 2 },
  txDate:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  txMonto: { fontFamily: FONTS.heading, fontSize: 20, marginLeft: SPACING.sm },
  empty:   { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },

  modalOverlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: COLORS.card2,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl, gap: SPACING.md,
  },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },

  metodoBtns: { flexDirection: 'row', gap: SPACING.sm },
  metodoBtn: {
    flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card,
  },
  metodoBtnActivo:     { borderColor: COLORS.blue, backgroundColor: COLORS.blue + '22' },
  metodoBtnText:       { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
  metodoBtnTextActivo: { fontFamily: FONTS.bodyMedium, color: COLORS.white },

  metodoInfo: {
    fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center',
  },
  input: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.md, color: COLORS.white, fontFamily: FONTS.body,
    fontSize: 16, borderWidth: 1, borderColor: COLORS.navy,
  },
  modalBtns:        { flexDirection: 'row', gap: SPACING.sm },
  modalCancel: {
    flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card,
  },
  modalCancelText:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
  modalConfirm: {
    flex: 2, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    backgroundColor: COLORS.red,
  },
  modalConfirmText: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 1 },

  // Pending recargas
  pendingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1,
    borderColor: '#F0A50044',
  },
  pendingLabel:   { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  pendingCredito: { fontFamily: FONTS.heading, fontSize: 16, color: '#F0A500' },
  pendingDate:    { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },

  // Yappy opened confirmation card
  openedCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.xl,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.green + '44',
  },
  openedTitle:  { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.green, marginBottom: 4 },
  openedAmount: { fontFamily: FONTS.heading, fontSize: 44, color: COLORS.white, marginVertical: 4 },
  openedSub:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center', marginTop: 4 },
  pollingDots:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 8 },
});
