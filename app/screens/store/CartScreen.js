import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useCartStore from '../../../store/cartStore';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';
import GestorCodeInput from '../../../components/GestorCodeInput';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';

export default function CartScreen({ navigation }) {
  const { items, updateQty, clearCart, gestorId, gestorCode } = useCartStore();
  const { user, walletBalance, setWalletBalance } = useAuthStore();

  const [payingWallet,  setPayingWallet]  = useState(false);
  // Yappy modal state
  const [yappyModal,    setYappyModal]    = useState(false);
  const [phone,         setPhone]         = useState(user?.telefono ?? '');
  const [yappyStep,     setYappyStep]     = useState('input'); // 'input' | 'polling'
  const [pollProgress,  setPollProgress]  = useState({ attempts: 0, maxAttempts: 60 });
  const [startingYappy,  setStartingYappy]  = useState(false);
  const [successOrderId,  setSuccessOrderId]  = useState(null);
  const [confirmedTotal, setConfirmedTotal]  = useState(0);
  const pollRef = useRef(null);

  const cartTotal  = items.reduce((s, i) => s + i.precio * i.qty, 0);
  const sufficient = walletBalance >= cartTotal;

  useEffect(() => () => { pollRef.current?.cancel(); }, []);

  function openYappyModal() {
    setPhone(user?.telefono ?? '');
    setYappyStep('input');
    setPollProgress({ attempts: 0, maxAttempts: 60 });
    setYappyModal(true);
  }

  function cancelYappy() {
    pollRef.current?.cancel();
    pollRef.current = null;
    setYappyModal(false);
    setYappyStep('input');
    setStartingYappy(false);
  }

  async function verifyStock() {
    for (const item of items) {
      const { data: prod } = await supabase
        .from('products')
        .select('stock, stock_ilimitado, tallas, tiene_tallas')
        .eq('id', item.id)
        .single();
      if (!prod || prod.stock_ilimitado) continue;
      if (prod.tiene_tallas && item.talla) {
        const obj = typeof prod.tallas === 'string' ? JSON.parse(prod.tallas) : (prod.tallas ?? {});
        if ((obj[item.talla] ?? 0) < item.qty)
          throw new Error(`Stock insuficiente para "${item.nombre}" talla ${item.talla}`);
      } else if ((prod.stock ?? 0) < item.qty) {
        throw new Error(`Stock insuficiente para "${item.nombre}"`);
      }
    }
  }

  async function insertOrderRows(orderId) {
    await Promise.all([
      supabase.from('order_items').insert(
        items.map((i) => ({
          order_id:        orderId,
          product_id:      i.id,
          qty:             i.qty,
          precio_unitario: i.precio,
          talla:           i.talla ?? null,
        }))
      ),
      ...items.map((i) =>
        supabase.rpc('decrement_stock', { p_product_id: i.id, p_qty: i.qty, p_talla: i.talla ?? null })
      ),
    ]);
  }

  async function startYappyPayment() {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 7) {
      Alert.alert('Error', 'Ingresa un número de teléfono válido.');
      return;
    }
    setStartingYappy(true);
    try {
      await verifyStock();

      const { orderId } = await iniciarBotonYappy({
        phone:  cleanPhone,
        amount: cartTotal,
        tipo:   'compra_tienda',
      });

      setYappyStep('polling');
      setPollProgress({ attempts: 0, maxAttempts: 60 });

      const { promise, cancel } = pollBotonOrder({
        orderId,
        onProgress: (p) => setPollProgress(p),
      });
      pollRef.current = { cancel };

      await promise; // resolves when yappy_orders.status = 'executed'

      // Yappy confirmed — create the order now
      const orderPayload = {
        user_id:     user.id,
        metodo_pago: 'yappy',
        total:       cartTotal,
        status:      'paid',
      };
      if (gestorId) orderPayload.gestor_id = gestorId;
      const { data: order, error: orderErr } = await supabase
        .from('orders').insert(orderPayload).select().single();
      if (orderErr) throw orderErr;

      await insertOrderRows(order.id);
      setConfirmedTotal(cartTotal);
      clearCart();
      setSuccessOrderId(order.id);
      setYappyStep('success');
    } catch (e) {
      if (e.message !== 'cancelled') {
        Alert.alert('Error', e.message);
      }
      setYappyStep('input');
    } finally {
      setStartingYappy(false);
      pollRef.current = null;
    }
  }

  async function checkoutWallet() {
    if (payingWallet || !sufficient) return;
    setPayingWallet(true);
    try {
      await verifyStock();

      // ORDEN INVERTIDO (fix race): descontar wallet PRIMERO con optimistic
      // lock. Si falla, no creamos orden ni descontamos stock. Si funciona,
      // recién entonces creamos la orden y bajamos stock.
      const { data: wallet, error: wErr } = await supabase
        .from('wallets').select('id, balance').eq('user_id', user.id).single();
      if (wErr) throw wErr;
      if (wallet.balance < cartTotal) throw new Error('Créditos insuficientes — tus créditos cambiaron.');
      const newBalance = wallet.balance - cartTotal;
      const { error: updErr, count } = await supabase
        .from('wallets').update({ balance: newBalance })
        .eq('id', wallet.id).eq('balance', wallet.balance)
        .select('id', { count: 'exact', head: true });
      if (updErr) throw updErr;
      if (count === 0) throw new Error('Tus créditos cambiaron durante la operación. Intenta nuevamente.');

      // A partir de acá el dinero ya se debitó. Si los siguientes pasos fallan
      // necesitamos compensar reintegrando el saldo para no dejar al user sin
      // dinero ni orden.
      let order;
      try {
        const orderPayload = {
          user_id:     user.id,
          metodo_pago: 'wallet',
          total:       cartTotal,
          status:      'paid',
        };
        if (gestorId) orderPayload.gestor_id = gestorId;
        const orderRes = await supabase
          .from('orders').insert(orderPayload).select().single();
        if (orderRes.error) throw orderRes.error;
        order = orderRes.data;

        await insertOrderRows(order.id);
      } catch (postPayErr) {
        // Compensación: regresar el dinero al wallet. PostgrestBuilder no tiene
        // .catch, así que envolvemos en try/await para no tirar TypeError sincronía.
        try {
          await supabase.from('wallets').update({ balance: wallet.balance }).eq('id', wallet.id);
        } catch (_) {}
        throw new Error('No se pudo registrar el pedido. Tus créditos fueron restaurados. Intenta nuevamente.');
      }

      await supabase.from('wallet_transactions').insert({
        wallet_id:   wallet.id,
        tipo:        'compra_tienda',
        monto:       -cartTotal,
        descripcion: 'Compra en tienda',
      });
      setWalletBalance(newBalance);
      setConfirmedTotal(cartTotal);
      clearCart();
      setSuccessOrderId(order.id);
      setYappyStep('success');
      setYappyModal(true);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPayingWallet(false);
    }
  }

  // `paying` se usa para deshabilitar AMBOS botones de pago mientras una
  // operación está en curso (wallet o Yappy iniciando).
  const paying = payingWallet || startingYappy;

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.back}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>CARRITO</Text>
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>🛒</Text>
          <Text style={styles.emptyText}>Tu carrito está vacío</Text>
          <TouchableOpacity style={styles.shopBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.shopBtnText}>Ver tienda</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>CARRITO</Text>
        <Text style={styles.itemCount}>{items.length} {items.length === 1 ? 'item' : 'items'}</Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.cartKey}
        contentContainerStyle={styles.list}
        ListFooterComponent={() => (
          <View style={styles.gestorSection}>
            <Text style={styles.gestorLabel}>¿Tienes un código de gestor?</Text>
            <GestorCodeInput />
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.nombre}>{item.nombre}</Text>
              {item.talla && (
                <View style={styles.tallaBadge}>
                  <Text style={styles.tallaText}>Talla: {item.talla}</Text>
                </View>
              )}
              <Text style={styles.precio}>${item.precio.toFixed(2)} c/u</Text>
            </View>
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.cartKey, item.qty - 1)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qty}>{item.qty}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.cartKey, item.qty + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.subtotal}>${(item.precio * item.qty).toFixed(2)}</Text>
          </View>
        )}
      />

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalVal}>${cartTotal.toFixed(2)}</Text>
        </View>
        <View style={styles.walletRow}>
          <Text style={styles.walletLabel}>Tus créditos</Text>
          <Text style={[styles.walletVal, { color: sufficient ? COLORS.green : COLORS.red }]}>
            ${walletBalance.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.btnWallet, (!sufficient || paying) && styles.btnDisabled]}
          onPress={checkoutWallet}
          disabled={paying || !sufficient}
        >
          {payingWallet
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.btnText}>💰 Usar créditos internos</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnYappy, paying && styles.btnDisabled]}
          onPress={openYappyModal}
          disabled={paying}
        >
          <Text style={styles.btnText}>📱 Pagar con Yappy</Text>
        </TouchableOpacity>
      </View>

      {/* Yappy payment modal */}
      <Modal visible={yappyModal} transparent animationType="slide" onRequestClose={cancelYappy}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>

            {yappyStep === 'input' ? (
              <>
                <Text style={styles.modalTitle}>PAGAR CON YAPPY</Text>
                <Text style={styles.modalTotal}>Total: ${cartTotal.toFixed(2)}</Text>
                <Text style={styles.modalLabel}>Número de teléfono Yappy</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Ej: 6123-4567"
                  placeholderTextColor={COLORS.gray}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  maxLength={15}
                />
                <Text style={styles.modalHint}>
                  Recibirás una notificación en tu app Yappy para aprobar el pago.
                </Text>
                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.modalBtnCancel} onPress={cancelYappy}>
                    <Text style={styles.modalBtnCancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtnConfirm, startingYappy && { opacity: 0.6 }]}
                    onPress={startYappyPayment}
                    disabled={startingYappy}
                  >
                    {startingYappy
                      ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={styles.modalBtnConfirmText}>Enviar solicitud</Text>
                    }
                  </TouchableOpacity>
                </View>
              </>
            ) : yappyStep === 'polling' ? (
              <>
                <Text style={styles.modalTitle}>ESPERANDO PAGO</Text>
                <Text style={styles.modalTotal}>${cartTotal.toFixed(2)}</Text>
                <View style={styles.pollingBox}>
                  <ActivityIndicator color={COLORS.green} size="large" />
                  <Text style={styles.pollingText}>
                    Aprueba el pago en tu app Yappy
                  </Text>
                  <Text style={styles.pollingHint}>
                    Notificación enviada al {phone.replace(/\D/g, '').replace(/(\d{4})(\d{4})/, '$1-$2')}
                  </Text>
                  <Text style={styles.pollingCount}>
                    {pollProgress.attempts}/{pollProgress.maxAttempts} · esperando…
                  </Text>
                </View>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={cancelYappy}>
                  <Text style={styles.modalBtnCancelText}>Cancelar pago</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* success step */
              <>
                <Text style={[styles.modalTitle, { color: COLORS.green }]}>✓ PAGO CONFIRMADO</Text>
                <Text style={styles.modalTotal}>${confirmedTotal.toFixed(2)}</Text>
                <View style={styles.successBox}>
                  <Text style={styles.successIcon}>🎉</Text>
                  <Text style={styles.successMsg}>
                    Compra confirmada. La solicitud fue enviada al administrador.
                  </Text>
                  <View style={styles.contactBox}>
                    <Text style={styles.contactText}>¿Alguna duda?</Text>
                    <Text style={styles.contactPhone}>📞 6122-2854</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.modalBtnConfirm}
                  onPress={() => { setYappyModal(false); navigation.replace('OrderConfirmation', { orderId: successOrderId }); }}
                >
                  <Text style={styles.modalBtnConfirmText}>Ver mi pedido</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
  back:         { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  title:        { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 3, flex: 1 },
  itemCount:    { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13 },

  list:         { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl },
  row:          { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  info:         { flex: 1, gap: 4 },
  nombre:       { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white },
  tallaBadge:   { alignSelf: 'flex-start', backgroundColor: COLORS.navy, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: COLORS.blue },
  tallaText:    { fontFamily: FONTS.bodyMedium, fontSize: 11, color: COLORS.gray2 },
  precio:       { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  qtyRow:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  qtyBtn:       { width: 28, height: 28, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText:   { fontFamily: FONTS.bodyBold, fontSize: 18, color: COLORS.white },
  qty:          { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.white, minWidth: 24, textAlign: 'center' },
  subtotal:     { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gold, marginLeft: SPACING.sm },

  gestorSection:{ padding: SPACING.md, gap: SPACING.sm },
  gestorLabel:  { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray2 },

  footer:       { padding: SPACING.md, gap: SPACING.sm, borderTopWidth: 1, borderColor: COLORS.navy },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel:   { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2 },
  totalVal:     { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.gold },
  walletRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletLabel:  { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13 },
  walletVal:    { fontFamily: FONTS.bodyMedium, fontSize: 14 },
  btnWallet:    { backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnYappy:     { backgroundColor: '#1DB954CC', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnDisabled:  { opacity: 0.45 },
  btnText:      { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },

  emptyWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  emptyIcon:    { fontSize: 64 },
  emptyText:    { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 16 },
  shopBtn:      { backgroundColor: COLORS.red, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  shopBtnText:  { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 15 },

  // Yappy modal
  modalOverlay:       { flex: 1, backgroundColor: '#000000BB', justifyContent: 'flex-end' },
  modalBox:           { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy },
  modalTitle:         { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 3, textAlign: 'center' },
  modalTotal:         { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.gold, textAlign: 'center', marginBottom: SPACING.sm },
  modalLabel:         { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 13 },
  modalInput:         { backgroundColor: COLORS.bg2, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, color: COLORS.white, fontFamily: FONTS.body, fontSize: 18, borderWidth: 1, borderColor: COLORS.navy },
  modalHint:          { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, lineHeight: 18 },
  modalBtns:          { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  modalBtnCancel:     { flex: 1, backgroundColor: COLORS.navy, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  modalBtnCancelText: { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 14 },
  modalBtnConfirm:    { flex: 2, backgroundColor: '#1DB954', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  modalBtnConfirmText:{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },

  pollingBox:   { alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  pollingText:  { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 16, textAlign: 'center' },
  pollingHint:  { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, textAlign: 'center' },
  pollingCount: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 11 },

  successBox:    { alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
  successIcon:   { fontSize: 56 },
  successMsg:    { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  contactBox:    { backgroundColor: COLORS.navy, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, alignItems: 'center', gap: 4, width: '100%' },
  contactText:   { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  contactPhone:  { fontFamily: FONTS.heading, color: COLORS.gold, fontSize: 24, letterSpacing: 2 },
});
