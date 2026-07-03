import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

export default function OrderConfirmationScreen({ route, navigation }) {
  const { orderId } = route.params ?? {};
  const [order,   setOrder]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!orderId) { setLoading(false); return; }
    supabase
      .from('orders')
      .select('*, order_items(qty, precio_unitario, products(nombre)), users(nombre)')
      .eq('id', orderId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setLoadError(error.message);
        } else {
          setOrder(data ?? null);
        }
        setLoading(false);
      })
      .catch((e) => {
        setLoadError(e.message);
        setLoading(false);
      });
  }, [orderId]);

  const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.red} size="large" />
        <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13, marginTop: SPACING.md }}>
          Cargando pedido…
        </Text>
      </SafeAreaView>
    );
  }

  if (loadError || !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl }}>
        <Text style={{ fontSize: 48, marginBottom: SPACING.md }}>⚠️</Text>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 16, textAlign: 'center', marginBottom: SPACING.sm }}>
          No se encontró la orden
        </Text>
        {loadError && (
          <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, textAlign: 'center', marginBottom: SPACING.lg }}>
            {loadError}
          </Text>
        )}
        <TouchableOpacity
          style={{ backgroundColor: COLORS.red, borderRadius: RADIUS.md, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md }}
          onPress={goHome}
        >
          <Text style={{ fontFamily: FONTS.heading, color: COLORS.white, fontSize: 16, letterSpacing: 2 }}>Ir al inicio</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goHome} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>MI PEDIDO</Text>
      </View>
      <ScrollView contentContainerStyle={styles.inner}>
        {/* Success icon */}
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>✓</Text>
        </View>
        <Text style={styles.title}>¡PEDIDO CONFIRMADO!</Text>
        <Text style={styles.sub}>Tu orden ha sido procesada exitosamente</Text>

        {/* Order info */}
        <View style={styles.card} dataSet={{ t2Glass: '', t2Glow: 'subtle' }}>
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
            <Text style={styles.metaVal}>{order.metodo_pago === 'wallet' ? '💰 Créditos' : '📱 Yappy'}</Text>
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
  safe:        { flex: 1, backgroundColor: COLORS.bg },
  header:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
  back:        { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, minWidth: 44, minHeight: 44, textAlignVertical: 'center' },
  headerTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3, flex: 1 },
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
