import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { uploadImage } from '../../../lib/uploadImage';
import useAuthStore from '../../../store/authStore';
import useClubStore from '../../../store/clubStore';
import {
  WCHeader,
  WCButton,
  WCCard,
  WCSectionTitle,
  WCEmptyState,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

const EMPTY_FORM = { nombre: '', descripcion: '', precio: '', imagen_url: '' };

export default function ClubGaleriaScreen({ route, navigation }) {
  const { user } = useAuthStore();
  const { myCompanies, loadMyCompanies } = useClubStore();

  const companyIdFromRoute = route?.params?.companyId ?? null;
  const [companyId, setCompanyId] = useState(companyIdFromRoute);

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = new, object = edit
  const [form, setForm] = useState(EMPTY_FORM);
  const [localImageAsset, setLocalImageAsset] = useState(null); // expo-image-picker asset

  // Delete confirm modal
  const [deleteTarget, setDeleteTarget] = useState(null);

  // ─── Bootstrap companyId from store if not in route ──────────
  useEffect(() => {
    if (companyId) return;
    if (!user?.id) return;
    (async () => {
      await loadMyCompanies(user.id);
    })();
  }, [user?.id]);

  useEffect(() => {
    if (companyId) return;
    const id = myCompanies?.[0]?.id ?? null;
    if (id) setCompanyId(id);
  }, [myCompanies]);

  // ─── Load products ────────────────────────────────────────────
  const fetchProducts = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('partner_products')
      .select('*')
      .eq('company_id', companyId)
      .order('orden');
    if (error) Alert.alert('Error', error.message);
    setProducts(data ?? []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (companyId) fetchProducts();
  }, [companyId, fetchProducts]);

  // ─── Open modal ───────────────────────────────────────────────
  function openNew() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setLocalImageAsset(null);
    setModalVisible(true);
  }

  function openEdit(product) {
    setEditTarget(product);
    setForm({
      nombre: product.nombre ?? '',
      descripcion: product.descripcion ?? '',
      precio: product.precio != null ? String(product.precio) : '',
      imagen_url: product.imagen_url ?? '',
    });
    setLocalImageAsset(null);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setLocalImageAsset(null);
  }

  // ─── Image picker ─────────────────────────────────────────────
  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (!res.canceled && res.assets?.length > 0) {
      setLocalImageAsset(res.assets[0]);
    }
  }

  // ─── Save (insert or update) ──────────────────────────────────
  async function handleSave() {
    if (!form.nombre.trim()) {
      Alert.alert('Campo requerido', 'El nombre del producto es obligatorio.');
      return;
    }
    const precioNum = parseFloat(form.precio);
    if (form.precio.trim() !== '' && isNaN(precioNum)) {
      Alert.alert('Precio inválido', 'Ingresá un número válido para el precio.');
      return;
    }

    setProcessing(true);
    try {
      let imagenUrl = form.imagen_url;

      if (localImageAsset) {
        const uniqueMillis = Date.now();
        imagenUrl = await uploadImage(
          'partner-logos',
          companyId + '/prod_' + uniqueMillis,
          localImageAsset,
        );
      }

      const payload = {
        company_id: companyId,
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        precio: form.precio.trim() !== '' ? precioNum : null,
        imagen_url: imagenUrl || null,
      };

      if (editTarget) {
        const { error } = await supabase
          .from('partner_products')
          .update(payload)
          .eq('id', editTarget.id);
        if (error) { Alert.alert('Error', error.message); return; }
      } else {
        const { error } = await supabase
          .from('partner_products')
          .insert(payload);
        if (error) { Alert.alert('Error', error.message); return; }
      }

      closeModal();
      await fetchProducts();
    } catch (e) {
      Alert.alert('Error al subir imagen', e.message ?? 'Intentá de nuevo.');
    } finally {
      setProcessing(false);
    }
  }

  // ─── Delete ───────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setProcessing(true);
    const { error } = await supabase
      .from('partner_products')
      .delete()
      .eq('id', deleteTarget.id);
    setDeleteTarget(null);
    setProcessing(false);
    if (error) { Alert.alert('Error', error.message); return; }
    await fetchProducts();
  }

  // ─── Render ───────────────────────────────────────────────────
  const previewImageUri = localImageAsset
    ? localImageAsset.uri
    : form.imagen_url || null;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <WCHeader
            title="Mi galeria"
            kicker="COMERCIO ALIADO"
            onBack={() => navigation.goBack()}
            right={
              <TouchableOpacity onPress={openNew} style={styles.addHeaderBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.addHeaderBtnText}>＋</Text>
              </TouchableOpacity>
            }
          />

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={COLORS.gold} />
            </View>
          ) : products.length === 0 ? (
            <WCEmptyState
              icon="📷"
              title="Sin productos aún"
              message="Agregá tu primer producto para mostrarlo a los socios."
              action={
                <WCButton
                  label="Agregar producto"
                  variant="gold"
                  size="md"
                  onPress={openNew}
                />
              }
            />
          ) : (
            <>
              <WCSectionTitle accent="gold" sub={`${products.length} producto${products.length !== 1 ? 's' : ''}`}>
                Galería de productos
              </WCSectionTitle>

              {products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  onEdit={() => openEdit(product)}
                  onDelete={() => setDeleteTarget(product)}
                />
              ))}

              <WCButton
                label="Agregar producto"
                variant="gold"
                size="md"
                onPress={openNew}
                style={{ marginTop: SPACING.md }}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* ─── Add / Edit Modal ─────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {editTarget ? 'Editar producto' : 'Agregar producto'}
            </Text>

            {/* Image preview + picker */}
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
              {previewImageUri ? (
                <Image source={{ uri: previewImageUri }} style={styles.imagePreview} resizeMode="cover" />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.imagePlaceholderIcon}>📷</Text>
                  <Text style={styles.imagePlaceholderText}>Tocar para elegir imagen</Text>
                </View>
              )}
              {previewImageUri && (
                <View style={styles.imageChangePill}>
                  <Text style={styles.imageChangePillText}>Cambiar</Text>
                </View>
              )}
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput
              style={styles.input}
              value={form.nombre}
              onChangeText={(v) => setForm((f) => ({ ...f, nombre: v }))}
              placeholder="Nombre del producto"
              placeholderTextColor={COLORS.gray}
              maxLength={100}
            />

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={form.descripcion}
              onChangeText={(v) => setForm((f) => ({ ...f, descripcion: v }))}
              placeholder="Descripción breve"
              placeholderTextColor={COLORS.gray}
              multiline
              numberOfLines={3}
              maxLength={300}
            />

            <Text style={styles.fieldLabel}>Precio (USD)</Text>
            <TextInput
              style={styles.input}
              value={form.precio}
              onChangeText={(v) => setForm((f) => ({ ...f, precio: v }))}
              placeholder="0.00"
              placeholderTextColor={COLORS.gray}
              keyboardType="decimal-pad"
              maxLength={10}
            />

            <View style={styles.modalActions}>
              <WCButton
                label="Cancelar"
                variant="ghost"
                size="md"
                onPress={closeModal}
                disabled={processing}
                style={{ flex: 1 }}
              />
              <WCButton
                label={editTarget ? 'Guardar' : 'Agregar'}
                variant="gold"
                size="md"
                onPress={handleSave}
                loading={processing}
                disabled={processing}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Delete Confirm Modal ─────────────────────────────── */}
      <Modal
        visible={!!deleteTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { gap: SPACING.md }]}>
            <Text style={styles.modalTitle}>Eliminar producto</Text>
            <Text style={styles.deleteBody}>
              ¿Seguro que querés eliminar{' '}
              <Text style={{ color: COLORS.white, fontFamily: FONTS.bodyBold }}>
                {deleteTarget?.nombre}
              </Text>
              ? Esta acción no se puede deshacer.
            </Text>
            <View style={styles.modalActions}>
              <WCButton
                label="Cancelar"
                variant="ghost"
                size="md"
                onPress={() => setDeleteTarget(null)}
                disabled={processing}
                style={{ flex: 1 }}
              />
              <WCButton
                label="Eliminar"
                variant="danger"
                size="md"
                onPress={handleDelete}
                loading={processing}
                disabled={processing}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ProductRow({ product, onEdit, onDelete }) {
  const precio = product.precio != null ? '$' + Number(product.precio).toFixed(2) : null;
  return (
    <WCCard accent="gold" style={styles.productCard}>
      <View style={styles.productRow}>
        {product.imagen_url ? (
          <Image source={{ uri: product.imagen_url }} style={styles.productThumb} resizeMode="cover" />
        ) : (
          <View style={[styles.productThumb, styles.productThumbPlaceholder]}>
            <Text style={styles.productThumbIcon}>📦</Text>
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={styles.productNombre} numberOfLines={2}>{product.nombre}</Text>
          {!!product.descripcion && (
            <Text style={styles.productDesc} numberOfLines={2}>{product.descripcion}</Text>
          )}
          {precio && <Text style={styles.productPrecio}>{precio}</Text>}
        </View>
        <View style={styles.productActions}>
          <TouchableOpacity onPress={onEdit} style={styles.actionBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.actionBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={[styles.actionBtn, { marginTop: SPACING.xs }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.actionBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    </WCCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING.xxl },

  // Header add button
  addHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.gold + '22',
    borderWidth: 1,
    borderColor: COLORS.gold + '88',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addHeaderBtnText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 20,
    color: COLORS.gold,
    lineHeight: 22,
  },

  // Product card
  productCard: { marginBottom: SPACING.sm },
  productRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  productThumb: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
  },
  productThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  productThumbIcon: { fontSize: 28 },
  productInfo: { flex: 1, gap: SPACING.xs },
  productNombre: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
    lineHeight: 20,
  },
  productDesc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 17,
  },
  productPrecio: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.gold,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  productActions: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2 },
  actionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    backgroundColor: WC_ALPHA.cardDarkMid,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  actionBtnText: { fontSize: 16 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: WC_ALPHA.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  modalSheet: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    width: '100%',
    maxWidth: 480,
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
    ...SHADOWS.card,
  },
  modalTitle: {
    fontFamily: FONTS.heading,
    fontSize: 22,
    color: COLORS.white,
    letterSpacing: 1.5,
    marginBottom: SPACING.md,
  },

  // Image picker
  imagePicker: {
    width: '100%',
    height: 160,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
    backgroundColor: COLORS.bg,
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  imagePlaceholderIcon: { fontSize: 36 },
  imagePlaceholderText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
  },
  imageChangePill: {
    position: 'absolute',
    bottom: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  imageChangePillText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.white,
    letterSpacing: 1,
  },

  // Fields
  fieldLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.gray2,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontFamily: FONTS.body,
    fontSize: 15,
    color: COLORS.white,
    marginBottom: SPACING.md,
  },
  inputMultiline: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: SPACING.sm + 2,
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },

  // Delete modal
  deleteBody: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    lineHeight: 20,
  },
});
