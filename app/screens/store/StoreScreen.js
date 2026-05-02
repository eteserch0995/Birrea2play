import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useCartStore from '../../../store/cartStore';

const TALLA_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function StoreScreen({ navigation }) {
  const [products,   setProducts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [tallaModal, setTallaModal] = useState(null);
  const [talla,      setTalla]      = useState(null);
  const { addItem } = useCartStore();
  const itemCount = useCartStore(s => s.itemCount());

  const fetchProducts = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('products')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); }
    setProducts(data ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Recarga cada vez que la pantalla gana foco (al navegar hacia ella)
  useFocusEffect(useCallback(() => { fetchProducts(); }, [fetchProducts]));

  const onRefresh = () => { setRefreshing(true); fetchProducts(); };

  function handleAdd(product) {
    if (product.tiene_tallas && product.tallas) {
      setTalla(null);
      setTallaModal(product);
    } else {
      addItem(product);
    }
  }

  function confirmTalla() {
    if (!talla) return;
    addItem({ ...tallaModal, talla });
    setTallaModal(null);
    setTalla(null);
  }

  // Parse tallas: { S: 10, M: 15, L: 0, ... } → available sizes
  function getAvailableSizes(product) {
    if (!product?.tallas) return [];
    const obj = typeof product.tallas === 'string' ? JSON.parse(product.tallas) : product.tallas;
    return TALLA_ORDER.filter((s) => (obj[s] ?? 0) > 0).map((s) => ({ size: s, stock: obj[s] }));
  }

  function getTotalStock(product) {
    if (product.tiene_tallas && product.tallas) {
      const obj = typeof product.tallas === 'string' ? JSON.parse(product.tallas) : product.tallas;
      return Object.values(obj).reduce((s, v) => s + (v ?? 0), 0);
    }
    return product.stock ?? 0;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>TIENDA</Text>
        <TouchableOpacity style={styles.cartBtn} onPress={() => navigation.navigate('Cart')}>
          <Text style={styles.cartIcon}>🛒</Text>
          {itemCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{itemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.xl }} />
      ) : error ? (
        <View style={{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.md }}>
          <Text style={{ fontSize: 32 }}>⚠️</Text>
          <Text style={styles.empty}>Error al cargar productos</Text>
          <Text style={[styles.empty, { fontSize: 11 }]}>{error}</Text>
          <TouchableOpacity style={[styles.addBtn, { paddingHorizontal: SPACING.xl }]} onPress={fetchProducts}>
            <Text style={styles.addBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(i) => i.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.colWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
          renderItem={({ item }) => {
            const totalStock = getTotalStock(item);
            const outOfStock = totalStock === 0 && !item.stock_ilimitado;
            return (
              <View style={styles.card}>
                {item.imagen_url
                  ? <Image source={{ uri: item.imagen_url }} style={styles.img} />
                  : <View style={styles.imgPlaceholder}><Text style={{ fontSize: 40 }}>👕</Text></View>
                }
                <View style={styles.cardBody}>
                  <Text style={styles.nombre} numberOfLines={2}>{item.nombre}</Text>
                  <Text style={styles.precio}>${item.precio.toFixed(2)}</Text>
                  {item.tiene_tallas
                    ? <Text style={styles.stock}>Tallas disponibles</Text>
                    : <Text style={styles.stock}>Stock: {item.stock_ilimitado ? '∞' : totalStock}</Text>
                  }
                  <TouchableOpacity
                    style={[styles.addBtn, outOfStock && styles.addBtnDisabled]}
                    onPress={() => handleAdd(item)}
                    disabled={outOfStock}
                  >
                    <Text style={styles.addBtnText}>
                      {outOfStock ? 'Sin stock' : item.tiene_tallas ? '👕 Elegir talla' : '+ Agregar'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: SPACING.xl }}>
              <Text style={{ fontSize: 40, marginBottom: SPACING.sm }}>🛒</Text>
              <Text style={styles.empty}>No hay productos disponibles</Text>
            </View>
          }
        />
      )}

      {/* Modal de selección de talla */}
      <Modal visible={!!tallaModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{tallaModal?.nombre}</Text>
            <Text style={styles.modalSub}>Selecciona tu talla</Text>

            <View style={styles.tallasGrid}>
              {getAvailableSizes(tallaModal).map(({ size, stock }) => (
                <TouchableOpacity
                  key={size}
                  style={[styles.tallaChip, talla === size && styles.tallaChipActive]}
                  onPress={() => setTalla(size)}
                >
                  <Text style={[styles.tallaText, talla === size && { color: COLORS.white }]}>{size}</Text>
                  <Text style={[styles.tallaStock, talla === size && { color: COLORS.white + 'AA' }]}>{stock}</Text>
                </TouchableOpacity>
              ))}
              {getAvailableSizes(tallaModal).length === 0 && (
                <Text style={styles.empty}>Sin stock disponible</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1, backgroundColor: COLORS.gray, margin: 0 }]}
                onPress={() => { setTallaModal(null); setTalla(null); }}
              >
                <Text style={styles.addBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1, margin: 0, opacity: talla ? 1 : 0.4 }]}
                onPress={confirmTalla}
                disabled={!talla}
              >
                <Text style={styles.addBtnText}>+ Agregar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: COLORS.bg },
  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md },
  title:           { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4 },
  cartBtn:         { position: 'relative', padding: 4 },
  cartIcon:        { fontSize: 28 },
  badge:           { position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.red, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  badgeText:       { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white },
  grid:            { padding: SPACING.md, paddingBottom: SPACING.xxl },
  colWrap:         { gap: SPACING.sm, marginBottom: SPACING.sm },
  card:            { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.navy },
  img:             { width: '100%', height: 140 },
  imgPlaceholder:  { width: '100%', height: 140, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  cardBody:        { padding: SPACING.sm, gap: 4 },
  nombre:          { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  precio:          { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gold },
  stock:           { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  addBtn:          { backgroundColor: COLORS.blue, marginTop: 4, borderRadius: RADIUS.sm, padding: 8, alignItems: 'center' },
  addBtnDisabled:  { backgroundColor: COLORS.gray },
  addBtnText:      { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white },
  empty:           { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
  // Modal
  overlay:         { flex: 1, backgroundColor: '#000000BB', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.lg ?? 16, borderTopRightRadius: RADIUS.lg ?? 16, padding: SPACING.lg, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy },
  modalTitle:      { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  modalSub:        { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13, marginBottom: SPACING.sm },
  tallasGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tallaChip:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.blue, alignItems: 'center', minWidth: 56 },
  tallaChipActive: { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  tallaText:       { fontFamily: FONTS.bodyBold, fontSize: 16, color: COLORS.white },
  tallaStock:      { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray },
});
