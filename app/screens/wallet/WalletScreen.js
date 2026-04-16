import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { startYappyPayment } from '../../../lib/yappy';

const TIPO_LABEL = {
  recarga_yappy: '📱 Recarga Yappy',
  recarga_tarjeta: '💳 Recarga Tarjeta',
  inscripcion: '⚽ Inscripción',
  compra_tienda: '🛒 Compra tienda',
  mvp_premio: '🏆 Premio MVP',
  ajuste_admin: '⚙️ Ajuste admin',
};

export default function WalletScreen() {
  const { user, walletBalance, setWalletBalance } = useAuthStore();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recargarModal, setRecargarModal] = useState(false);
  const [monto,         setMonto]         = useState('');
  const [yappyLoading,  setYappyLoading]  = useState(false);
  const [yappyStatus,   setYappyStatus]   = useState('');

  useEffect(() => { fetchTxs(); }, []);

  async function fetchTxs() {
    const { data: wallet } = await supabase.from('wallets').select('id, balance').eq('user_id', user.id).single();
    if (wallet) {
      setWalletBalance(wallet.balance);
      const { data: txData } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('wallet_id', wallet.id)
        .order('created_at', { ascending: false })
        .limit(50);
      setTxs(txData ?? []);
    }
    setLoading(false);
  }

  async function recargarYappy() {
    const amt = parseFloat(monto);
    if (!amt || amt < 1) { Alert.alert('Error', 'Monto mínimo $1.00'); return; }

    setYappyLoading(true);
    setYappyStatus('Conectando con Yappy...');
    try {
      const reference = `wallet-${user.id.slice(0, 8)}-${Date.now()}`;

      await startYappyPayment({
        amount:    amt,
        reference,
        onInstructions: ({ alias }) => {
          setYappyStatus(
            `📱 Abre tu app Yappy y envía $${amt.toFixed(2)} a:\n\n` +
            `👤 Alias: ${alias}\n` +
            `📝 Referencia: ${reference}\n\n` +
            `Esperando confirmación...`
          );
        },
      });

      // Pago detectado en el historial — acreditar wallet
      setYappyStatus('✅ Pago detectado. Acreditando saldo...');
      const { error } = await supabase.rpc('credit_wallet', {
        p_user_id:     user.id,
        p_monto:       amt,
        p_tipo:        'recarga_yappy',
        p_descripcion: `Recarga Yappy $${amt.toFixed(2)} — ref ${reference}`,
      });
      if (error) throw new Error(error.message);

      setRecargarModal(false);
      setMonto('');
      setYappyStatus('');
      fetchTxs();
      Alert.alert('✅ Recarga exitosa', `Se acreditaron $${amt.toFixed(2)} a tu wallet.`);
    } catch (e) {
      setYappyStatus('');
      Alert.alert('Error Yappy', e.message);
    } finally {
      setYappyLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>WALLET</Text>

        {/* Balance hero */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>SALDO DISPONIBLE</Text>
          <Text style={styles.heroAmount}>${walletBalance.toFixed(2)}</Text>
          <TouchableOpacity style={styles.recargarBtn} onPress={() => setRecargarModal(true)}>
            <Text style={styles.recargarText}>+ RECARGAR</Text>
          </TouchableOpacity>
        </View>

        {/* Transactions */}
        <Text style={styles.sectionTitle}>Historial de movimientos</Text>
        {loading ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.md }} /> : (
          txs.length === 0
            ? <Text style={styles.empty}>No hay movimientos aún</Text>
            : txs.map((tx) => (
              <View key={tx.id} style={styles.txRow}>
                <View>
                  <Text style={styles.txTipo}>{TIPO_LABEL[tx.tipo] ?? tx.tipo}</Text>
                  <Text style={styles.txDesc}>{tx.descripcion ?? ''}</Text>
                  <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleDateString('es-PA')}</Text>
                </View>
                <Text style={[styles.txMonto, { color: tx.monto > 0 ? COLORS.green : COLORS.red2 }]}>
                  {tx.monto > 0 ? '+' : ''}${tx.monto.toFixed(2)}
                </Text>
              </View>
            ))
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Recarga Modal */}
      <Modal visible={recargarModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>RECARGAR WALLET</Text>
            <TouchableOpacity
              style={[styles.optionBtn, { opacity: 0.45 }]}
              onPress={() => Alert.alert('Próximamente', 'El pago con tarjeta estará disponible pronto.')}
            >
              <Text style={styles.optionLabel}>💳 Tarjeta de crédito/débito</Text>
              <Text style={styles.optionSub}>Próximamente</Text>
            </TouchableOpacity>
            <Text style={styles.orText}>— o —</Text>
            <Text style={styles.yappyLabel}>📱 Recargar con Yappy</Text>
            <TextInput
              style={styles.input}
              placeholder="Monto a recargar (ej. 10.00)"
              placeholderTextColor={COLORS.gray}
              keyboardType="decimal-pad"
              value={monto}
              onChangeText={setMonto}
            />
            {!!yappyStatus && (
              <Text style={styles.yappyStatus}>{yappyStatus}</Text>
            )}
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setRecargarModal(false); setYappyStatus(''); }} disabled={yappyLoading}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={recargarYappy} disabled={yappyLoading}>
                {yappyLoading
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.modalConfirmText}>Pagar con Yappy</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  title: { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },
  heroCard: {
    margin: SPACING.md,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.blue,
    padding: SPACING.xl,
    alignItems: 'center',
    ...SHADOWS.card,
  },
  heroLabel: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.white + 'AA', letterSpacing: 2 },
  heroAmount: { fontFamily: FONTS.heading, fontSize: 56, color: COLORS.white, marginVertical: SPACING.sm },
  recargarBtn: { backgroundColor: COLORS.white + '20', borderRadius: RADIUS.full, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.sm },
  recargarText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 3 },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  txRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.card, marginHorizontal: SPACING.md, marginBottom: SPACING.sm,
    borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy,
  },
  txTipo: { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white },
  txDesc: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginTop: 2 },
  txDate: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  txMonto: { fontFamily: FONTS.heading, fontSize: 20 },
  empty: { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
  modalOverlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modal: { backgroundColor: COLORS.card2, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.xl, gap: SPACING.md },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  optionBtn: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  optionLabel: { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 15 },
  optionSub: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, marginTop: 2 },
  orText: { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center' },
  yappyLabel: { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 15 },
  input: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, color: COLORS.white, fontFamily: FONTS.body, fontSize: 16, borderWidth: 1, borderColor: COLORS.navy },
  modalBtns: { flexDirection: 'row', gap: SPACING.sm },
  modalCancel: { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  modalCancelText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  modalConfirm: { flex: 1, backgroundColor: COLORS.green + 'CC', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  modalConfirmText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },
  yappyStatus: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gold, textAlign: 'center', marginTop: SPACING.xs },
});
