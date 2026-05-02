import React, { useEffect, useRef, useState, useCallback } from 'react'; // useRef kept for fetchDataRef
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { iniciarPagoWebYappy } from '../../../lib/yappy';
import { iniciarPagoTarjeta } from '../../../lib/paguelofacil';
import PlanesModal from '../../../components/PlanesModal';

const TIPO_LABEL = {
  recarga_yappy:   '📱 Recarga Yappy',
  recarga_tarjeta: '💳 Recarga Tarjeta',
  inscripcion:     '⚽ Inscripción',
  compra_tienda:   '🛒 Compra tienda',
  mvp_premio:      '🏆 Premio MVP',
  ajuste_admin:    '⚙️ Ajuste admin',
  plan_mensual:    '🎖️ Plan mensual',
};

}

export default function WalletScreen() {
  const { user, walletBalance, setWalletBalance } = useAuthStore();

  const [txs,        setTxs]       = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [planActivo, setPlanActivo] = useState(null);

  // Modal de recarga
  const [recargarModal, setRecargarModal] = useState(false);
  const [metodo,        setMetodo]        = useState('yappy');
  const [monto,         setMonto]         = useState('');
  const [procesando,    setProcesando]    = useState(false);


  // Modal de planes
  const [planesModal, setPlanesModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const [walletRes, planRes] = await Promise.all([
      supabase.from('wallets').select('id, balance').eq('user_id', user.id).single(),
      supabase.rpc('get_user_active_plan', { p_user_id: user.id }),
    ]);

    if (walletRes.data) {
      setWalletBalance(walletRes.data.balance);
      const { data: txData } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_id', walletRes.data.id)
        .order('created_at', { ascending: false })
        .limit(50);
      setTxs(txData ?? []);
    }

    setPlanActivo(planRes.data?.[0] ?? null);
    setLoading(false);
  }, [user?.id, setWalletBalance]);

  useFocusEffect(useCallback(() => {
    fetchData();
  }, [fetchData]));

  const fetchDataRef = useRef(null);
  useEffect(() => { fetchDataRef.current = fetchData; }, [fetchData]);

  // Escuchar deep link de PágueloFácil
  useEffect(() => {
    function handleDeepLink(url) {
      if (!url?.includes('wallet')) return;
      try {
        const parsed = new URL(url.replace('birrea2play://', 'https://app/'));
        const status = parsed.searchParams.get('status');
        const amount = parsed.searchParams.get('amount');

        if (status === 'success') {
          if (fetchDataRef.current) fetchDataRef.current();
          Alert.alert(
            '✅ Pago exitoso',
            amount ? `Se acreditaron $${parseFloat(amount).toFixed(2)} a tu wallet.` : 'Tu wallet fue recargado.'
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
    setMetodo('yappy');
    setRecargarModal(true);
  }

  function cerrarModal() {
    setRecargarModal(false);
  }

  // ─── Recarga Yappy — flujo web redirect ─────────────────────────────────────
  async function recargarYappyBoton() {
    if (!user?.id) { Alert.alert('Error', 'Debes iniciar sesión para recargar.'); return; }
    const amt = parseFloat(monto);
    if (!amt || amt < 1) { Alert.alert('Error', 'Monto mínimo $1.00'); return; }
    if (amt > 500)       { Alert.alert('Error', 'Monto máximo por recarga: $500.00'); return; }
    if (procesando) return;

    setProcesando(true);
    try {
      const url = await iniciarPagoWebYappy(amt);
      setRecargarModal(false);
      setMonto('');
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Error Yappy', e.message);
    } finally {
      setProcesando(false);
    }
  }

  // ─── Recarga Tarjeta (PágueloFácil) ─────────────────────────────────────────
  async function recargarTarjeta() {
    const amt = parseFloat(monto);
    if (!amt || amt < 1) { Alert.alert('Error', 'Monto mínimo $1.00'); return; }

    setProcesando(true);
    try {
      await iniciarPagoTarjeta({
        userId:      user.id,
        amount:      amt,
        descripcion: `Recarga wallet Birrea2Play $${amt.toFixed(2)}`,
        tipo:        'recarga_tarjeta',
      });
      setRecargarModal(false);
      setMonto('');
      Alert.alert(
        'Browser abierto',
        'Completa el pago en el browser. Tu wallet se actualizará automáticamente al confirmar.'
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcesando(false);
    }
  }

  const handleRecargar = () => metodo === 'yappy' ? recargarYappyBoton() : recargarTarjeta();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>WALLET</Text>

        {/* Hero card */}
        <View style={styles.heroCard}>
          {planActivo && (
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>
                🎖️ {planActivo.nombre} — {planActivo.descuento_pct}% desc.
              </Text>
            </View>
          )}
          <Text style={styles.heroLabel}>SALDO DISPONIBLE</Text>
          <Text style={styles.heroAmount}>${walletBalance.toFixed(2)}</Text>
          <View style={styles.heroBtns}>
            <TouchableOpacity style={styles.recargarBtn} onPress={abrirRecargarModal}>
              <Text style={styles.recargarText}>+ RECARGAR</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.planesBtn} onPress={() => setPlanesModal(true)}>
              <Text style={styles.planesBtnText}>🎖️ PLANES</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Plan info */}
        {planActivo && (
          <View style={styles.planInfo}>
            <Text style={styles.planInfoText}>
              Tienes <Text style={styles.planInfoBold}>{planActivo.descuento_pct}% de descuento</Text> en inscripciones a eventos.
            </Text>
            <Text style={styles.planInfoSub}>
              Vence: {new Date(planActivo.fecha_fin).toLocaleDateString('es-PA')}
            </Text>
          </View>
        )}

        {/* Historial */}
        <Text style={styles.sectionTitle}>Historial de movimientos</Text>
        {loading ? (
          <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} />
        ) : txs.length === 0 ? (
          <Text style={styles.empty}>No hay movimientos aún</Text>
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
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>RECARGAR WALLET</Text>

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

            <Text style={styles.metodoInfo}>
              {metodo === 'yappy'
                ? 'Se abrirá el browser con la página de pago de Yappy. Completa el pago y regresa al app.'
                : 'Se abrirá el browser con el checkout seguro de PágueloFácil. Acepta Visa, Mastercard y Clave.'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Monto a recargar (ej. 10.00)"
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
                style={[styles.modalConfirm, metodo === 'tarjeta' && { backgroundColor: COLORS.blue + 'CC' }]}
                onPress={handleRecargar}
                disabled={procesando}
              >
                {procesando
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.modalConfirmText}>
                      {metodo === 'yappy' ? 'Continuar con Yappy' : 'Pagar con Tarjeta'}
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de Planes */}
      <PlanesModal
        visible={planesModal}
        onClose={() => setPlanesModal(false)}
        onPlanActivado={() => { setPlanesModal(false); fetchData(); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: COLORS.bg },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },

  heroCard: {
    margin: SPACING.md,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.blue,
    padding: SPACING.xl,
    alignItems: 'center',
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
  heroLabel:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.white + 'AA', letterSpacing: 2 },
  heroAmount: { fontFamily: FONTS.heading, fontSize: 56, color: COLORS.white, marginVertical: SPACING.sm },
  heroBtns:   { flexDirection: 'row', gap: SPACING.sm },
  recargarBtn: {
    backgroundColor: COLORS.white + '20',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  recargarText: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 3 },
  planesBtn: {
    backgroundColor: COLORS.gold ? COLORS.gold + '33' : '#F0A50033',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.gold ?? '#F0A500',
  },
  planesBtnText: { fontFamily: FONTS.heading, fontSize: 12, color: COLORS.gold ?? '#F0A500', letterSpacing: 2 },

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
    fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white,
    letterSpacing: 1, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm,
  },
  txRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy,
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

  // WebView Yappy modal
  webViewSafe: { flex: 1, backgroundColor: '#111827' },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  webViewCancelBtn:  { padding: SPACING.sm, minWidth: 80 },
  webViewCancelText: { fontFamily: FONTS.body, fontSize: 15, color: '#9ca3af' },
  webViewTitle: {
    fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white,
    letterSpacing: 2, textAlign: 'center',
  },
  webView: { flex: 1, backgroundColor: '#111827' },
});
