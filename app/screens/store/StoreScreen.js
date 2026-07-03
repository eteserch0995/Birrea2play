import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator, Modal, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useCartStore from '../../../store/cartStore';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TALLA_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const CATEGORIA_LABELS = {
  ropa:         '👕 Ropa',
  accesorios:   '⌚ Accesorios',
  equipamiento: '⚽ Equipamiento',
  general:      '📦 General',
  otro:         '🏷️ Otro',
};

export default function StoreScreen({ navigation }) {
  const [products,   setProducts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [tallaModal, setTallaModal] = useState(null);
  const [talla,      setTalla]      = useState(null);
  const [lightbox,   setLightbox]   = useState(null);
  const { addItem } = useCartStore();
  const itemCount = useCartStore(s => s.itemCount());

  const fetchProducts = useCallback(async () => {
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('products')
        .select('*')
        .eq('activo', true)
        .order('created_at', { ascending: false });
      if (err) throw new Error(err.message);
      setProducts(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
      {/* Header */}
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
        <View style={styles.centerBox}>
          <Text style={{ fontSize: 32 }}>⚠️</Text>
          <Text style={styles.empty}>Error al cargar productos</Text>
          <Text style={[styles.empty, { fontSize: 11, paddingVertical: 0 }]}>{error}</Text>
          <TouchableOpacity style={[styles.addBtn, { marginTop: SPACING.sm }]} onPress={fetchProducts}>
            <Text style={styles.addBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
          renderItem={({ item, index }) => <ProductCard item={item} index={index} onAdd={handleAdd} onZoom={setLightbox} getAvailableSizes={getAvailableSizes} getTotalStock={getTotalStock} />}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <Text style={{ fontSize: 48, marginBottom: SPACING.sm }}>🛒</Text>
              <Text style={styles.empty}>No hay productos disponibles</Text>
            </View>
          }
        />
      )}

      {/* Full-screen lightbox */}
      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <View style={styles.lightboxOverlay}>
          <TouchableOpacity style={styles.lightboxClose} onPress={() => setLightbox(null)}>
            <Text style={styles.lightboxCloseText}>✕</Text>
          </TouchableOpacity>
          {lightbox && (
            <Image source={{ uri: lightbox }} style={styles.lightboxImg} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* Size-selection bottom sheet */}
      <Modal visible={!!tallaModal} transparent animationType="slide" onRequestClose={() => { setTallaModal(null); setTalla(null); }}>
        <View style={styles.overlay}>
          <View style={styles.modalBox} dataSet={{ t2Glass: '' }}>
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
                  <Text style={[styles.tallaStock, talla === size && { color: COLORS.white + 'AA' }]}>{stock} disp.</Text>
                </TouchableOpacity>
              ))}
              {getAvailableSizes(tallaModal).length === 0 && (
                <Text style={styles.empty}>Sin stock disponible</Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1, backgroundColor: COLORS.gray }]}
                onPress={() => { setTallaModal(null); setTalla(null); }}
              >
                <Text style={styles.addBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addBtn, { flex: 1, opacity: talla ? 1 : 0.4 }]}
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

function ProductCard({ item, index, onAdd, onZoom, getAvailableSizes, getTotalStock }) {
  const totalStock = getTotalStock(item);
  const outOfStock = totalStock === 0 && !item.stock_ilimitado;
  const availSizes = getAvailableSizes(item);
  const catLabel   = CATEGORIA_LABELS[item.categoria] ?? (item.categoria ?? 'General');
  const riseStep   = typeof index === 'number' ? String((index % 5) + 1) : undefined;

  return (
    <View style={styles.card} dataSet={{ t2Glass: '', t2Press: '', ...(riseStep ? { t2Rise: riseStep } : {}) }}>
      {/* Large image — tap to zoom */}
      <TouchableOpacity
        activeOpacity={item.imagen_url ? 0.9 : 1}
        onPress={() => item.imagen_url && onZoom(item.imagen_url)}
      >
        {item.imagen_url ? (
          <Image source={{ uri: item.imagen_url }} style={styles.img} resizeMode="cover" />
        ) : (
          <View style={styles.imgPlaceholder}>
            <Text style={{ fontSize: 72 }}>👕</Text>
          </View>
        )}
        {item.imagen_url && (
          <View style={styles.zoomHint}>
            <Text style={styles.zoomHintText}>🔍 Toca para ampliar</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Product details */}
      <View style={styles.body}>
        {/* Name + price row */}
        <View style={styles.rowBetween}>
          <Text style={styles.nombre} numberOfLines={2}>{item.nombre}</Text>
          <Text style={styles.precio}>${item.precio.toFixed(2)}</Text>
        </View>

        {/* Category badge */}
        <View style={styles.catBadgeWrap}>
          <Text style={styles.catBadge}>{catLabel}</Text>
        </View>

        {/* Description */}
        {!!item.descripcion && (
          <Text style={styles.desc}>{item.descripcion}</Text>
        )}

        <View style={styles.divider} />

        {/* Stock / sizes */}
        {item.tiene_tallas ? (
          <View>
            <Text style={styles.stockLabel}>Tallas disponibles</Text>
            {availSizes.length > 0 ? (
              <View style={styles.tallasRow}>
                {availSizes.map(({ size, stock }) => (
                  <View key={size} style={styles.tallaTag}>
                    <Text style={styles.tallaTagSize}>{size}</Text>
                    <Text style={styles.tallaTagStock}>{stock}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.stockLabel, { color: COLORS.red }]}>Sin stock</Text>
            )}
          </View>
        ) : (
          <Text style={[styles.stockLabel, outOfStock && { color: COLORS.red }]}>
            {item.stock_ilimitado
              ? '✓ Disponible'
              : outOfStock
                ? 'Sin stock'
                : `Stock disponible: ${totalStock} uds.`}
          </Text>
        )}

        {/* CTA button */}
        <TouchableOpacity
          style={[styles.addBtn, outOfStock && styles.addBtnDisabled]}
          onPress={() => onAdd(item)}
          disabled={outOfStock}
        >
          <Text style={styles.addBtnText}>
            {outOfStock ? 'Sin stock' : item.tiene_tallas ? '👕 Elegir talla y agregar' : '+ Agregar al carrito'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: COLORS.bg },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  title:    { fontFamily: FONTS.heading, fontSize: 38, color: COLORS.white, letterSpacing: 4 },
  cartBtn:  { position: 'relative', padding: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line },
  cartIcon: { fontSize: 28 },
  badge:    { position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.neon, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  badgeText:{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.asphalt },

  list:     { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl },
  centerBox:{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm },
  empty:    { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.md },

  // Product card
  card:          { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.line },
  img:           { width: '100%', height: Math.round(SCREEN_W * 0.72) },
  imgPlaceholder:{ width: '100%', height: Math.round(SCREEN_W * 0.72), backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  zoomHint:      { position: 'absolute', bottom: SPACING.sm, right: SPACING.sm, backgroundColor: '#00000077', borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  zoomHintText:  { fontFamily: FONTS.body, color: COLORS.white, fontSize: 11 },

  body:          { padding: SPACING.md, gap: SPACING.sm },
  rowBetween:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACING.sm },
  nombre:        { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 1, flex: 1 },
  precio:        { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.neon, letterSpacing: 1 },

  catBadgeWrap:  { flexDirection: 'row' },
  catBadge:      { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon, backgroundColor: COLORS.neon + '12', paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.sm, letterSpacing: 1, textTransform: 'uppercase' },

  desc:          { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, lineHeight: 20 },
  divider:       { height: 1, backgroundColor: COLORS.line, marginVertical: SPACING.xs },

  stockLabel:    { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray2, marginBottom: 6 },
  tallasRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tallaTag:      { backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 6, alignItems: 'center', minWidth: 48, borderWidth: 1, borderColor: COLORS.blue },
  tallaTagSize:  { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white },
  tallaTagStock: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray },

  addBtn:        { backgroundColor: COLORS.red, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.xs },
  addBtnDisabled:{ backgroundColor: COLORS.gray },
  addBtnText:    { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, letterSpacing: 1, textTransform: 'uppercase' },

  // Lightbox
  lightboxOverlay:   { flex: 1, backgroundColor: '#000000EE', justifyContent: 'center', alignItems: 'center' },
  lightboxClose:     { position: 'absolute', top: 48, right: SPACING.md, zIndex: 10, backgroundColor: '#FFFFFF22', borderRadius: RADIUS.full, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lightboxCloseText: { fontFamily: FONTS.bodyBold, fontSize: 18, color: COLORS.white },
  lightboxImg:       { width: SCREEN_W, height: SCREEN_H * 0.82 },

  // Size-selection modal
  overlay:         { flex: 1, backgroundColor: '#000000BB', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: COLORS.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy },
  modalTitle:      { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  modalSub:        { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 13, marginBottom: SPACING.sm },
  tallasGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tallaChip:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.blue, alignItems: 'center', minWidth: 60 },
  tallaChipActive: { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  tallaText:       { fontFamily: FONTS.bodyBold, fontSize: 16, color: COLORS.white },
  tallaStock:      { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray },
});
