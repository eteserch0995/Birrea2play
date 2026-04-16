import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

export default function OrderConfirmationScreen({ route, navigation }) {
  const { orderId } = route.params ?? {};
  const [order,   setOrder]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    supabase
      .from('orders')
      .select('*, order_items(qty, precio_unitario, products(nombre)), users(nombre)')
      .eq('id', orderId)
      .single()
      .then(({ data, error }) => {
        if (error) console.warn('OrderConfirmation load error:', error.message);
        setOrder(data ?? null);
        setLoading(false);
      });
  }, [orderId]);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  if (!order)  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 }}>No se encontró la orden.</Text>
      <TouchableOpacity onPress={() => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })} style={{ marginTop: 16 }}>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.blue2 }}>Ir al inicio</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.inner}>
        {/* Success icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>✓</Text>
        </View>
        <Text style={styles.title}>¡PEDIDO CONFIRMADO!</Text>
        <Text style={styles.sub}>Tu orden ha sido procesada exitosamente</Text>

        {/* Order info */}
        <View style={styles.card}>
          <Text style={styles.orderId}>Orden #{order.id.slice(0, 8).toUpperCase()}</Text>
          <View style={styles.divider} />

          {order.order_items?.map((item, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.products?.nombre}</Text>
              <Text style={styles.itemQty}>×{item.qty}</Text>
              <Text style={styles.itemPrice}>${(item.precio_unitario * item.qty).toFixed(2)}</Text>
            </View>
          ))}

          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalVal}>${order.total?.toFixed(2)}</Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Método de pago</Text>
            <Text style={styles.metaVal}>{order.metodo_pago === 'wallet' ? '💰 Wallet' : '📱 Yappy'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Estado</Text>
            <Text style={[styles.metaVal, { color: COLORS.green }]}>{order.status?.toUpperCase()}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Fecha</Text>
            <Text style={styles.metaVal}>
              {new Date(order.created_at).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.homeBtn}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] })}
        >
          <Text style={styles.homeBtnText}>Ir al inicio</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: COLORS.bg },
  inner:     { padding: SPACING.xl, alignItems: 'center', gap: SPACING.md },
  iconWrap:  {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: COLORS.green + '20',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.green,
  },
  icon:      { fontFamily: FONTS.heading, fontSize: 40, color: COLORS.green },
  title:     { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 3, textAlign: 'center' },
  sub:       { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray, textAlign: 'center' },
  card:      { width: '100%', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.sm },
  orderId:   { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gray, letterSpacing: 2 },
  divider:   { height: 1, backgroundColor: COLORS.navy },
  itemRow:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  itemName:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, flex: 1 },
  itemQty:   { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray },
  itemPrice: { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.gold },
  totalRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel:{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 2 },
  totalVal:  { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.gold },
  metaRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray },
  metaVal:   { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  homeBtn:   { backgroundColor: COLORS.red, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xxl, paddingVertical: SPACING.md, marginTop: SPACING.md },
  homeBtnText:{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 3 },
});
