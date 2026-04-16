import React, { useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useCartStore from '../../../store/cartStore';
import useAuthStore from '../../../store/authStore';
import { supabase } from '../../../lib/supabase';
import GestorCodeInput from '../../../components/GestorCodeInput';

export default function CartScreen({ navigation }) {
  const { items, removeItem, updateQty, clearCart, gestorId, gestorCode, total } = useCartStore();
  const { user, walletBalance, setWalletBalance } = useAuthStore();
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState(null); // 'wallet' | 'yappy'

  const cartTotal  = items.reduce((s, i) => s + i.precio * i.qty, 0);
  const sufficient = walletBalance >= cartTotal;

  const checkout = async (payMethod) => {
    if (items.length === 0) return;
    if (payMethod === 'wallet' && !sufficient) {
      Alert.alert('Saldo insuficiente', 'Recarga tu wallet para continuar.');
      return;
    }
    setPaying(true);
    setMethod(payMethod);
    try {
      // Verify stock for each item
      for (const item of items) {
        const { data: prod } = await supabase.from('products').select('stock, stock_ilimitado, tallas, tiene_tallas').eq('id', item.id).single();
        if (prod.stock_ilimitado) continue;
        if (prod.tiene_tallas && item.talla) {
          const obj = typeof prod.tallas === 'string' ? JSON.parse(prod.tallas) : (prod.tallas ?? {});
          if ((obj[item.talla] ?? 0) < item.qty) {
            throw new Error(`Stock insuficiente para "${item.nombre}" talla ${item.talla}`);
          }
        } else if ((prod.stock ?? 0) < item.qty) {
          throw new Error(`Stock insuficiente para "${item.nombre}"`);
        }
      }

      // Create order
      const orderPayload = {
        user_id:     user.id,
        metodo_pago: payMethod,
        total:       cartTotal,
        status:      payMethod === 'yappy' ? 'pending' : 'paid',
      };
      if (gestorId) {
        orderPayload.gestor_id   = gestorId;
        orderPayload.gestor_code = gestorCode;
      }

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select()
        .single();
      if (orderErr) throw orderErr;

      // Insert order items & decrement stock
      await Promise.all([
        supabase.from('order_items').insert(
          items.map((i) => ({
            order_id:        order.id,
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

      // Deduct wallet if applicable
      if (payMethod === 'wallet') {
        const newBalance = walletBalance - cartTotal;
        const { data: wallet } = await supabase.from('wallets').select('id').eq('user_id', user.id).single();
        await supabase.from('wallets').update({ balance: newBalance }).eq('user_id', user.id);
        await supabase.from('wallet_transactions').insert({
          wallet_id:   wallet.id,
          tipo:        'compra_tienda',
          monto:       -cartTotal,
          descripcion: 'Compra en tienda',
        });
        setWalletBalance(newBalance);
      }

      clearCart();

      Alert.alert(
        '¡Compra realizada!',
        payMethod === 'wallet'
          ? 'Tu pedido fue procesado con tu wallet.'
          : 'Un gestor confirmará tu pago por Yappy.',
        [{ text: 'Ver pedido', onPress: () => navigation.replace('OrderConfirmation', { orderId: order.id }) }],
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPaying(false);
      setMethod(null);
    }
  };

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
        <Text style={styles.itemCount}>{items.length} items</Text>
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
          <Text style={styles.walletLabel}>Tu saldo</Text>
          <Text style={[styles.walletVal, { color: sufficient ? COLORS.green : COLORS.red }]}>
            ${walletBalance.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.btnWallet, !sufficient && styles.btnDisabled]}
          onPress={() => checkout('wallet')}
          disabled={paying || !sufficient}
        >
          {paying && method === 'wallet'
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.btnText}>💰 Pagar con Wallet</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.btnYappy}
          onPress={() => checkout('yappy')}
          disabled={paying}
        >
          {paying && method === 'yappy'
            ? <ActivityIndicator color={COLORS.white} />
            : <Text style={styles.btnText}>📱 Pagar con Yappy</Text>
          }
        </TouchableOpacity>
      </View>
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
  btnYappy:     { backgroundColor: COLORS.green + 'CC', borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnDisabled:  { opacity: 0.45 },
  btnText:      { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  emptyWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  emptyIcon:    { fontSize: 64 },
  emptyText:    { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 16 },
  shopBtn:      { backgroundColor: COLORS.red, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md },
  shopBtnText:  { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 15 },
});
