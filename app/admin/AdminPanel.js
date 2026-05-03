import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { createStackNavigator } from '@react-navigation/stack';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { sendLocalNotification } from '../../lib/notifications';
import useAuthStore from '../../store/authStore';
import {
  TEAM_COLORS, generateLigaFixture, generateGroupStageFixture,
  generateKnockoutBracket, calcTeams, generateRoundRobin,
} from '../../lib/eventHelpers';

const Stack = createStackNavigator();

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function AdminDashboard({ navigation }) {
  const [stats, setStats]   = useState({ users: 0, events: 0, requests: 0, walletTotal: 0, orders: 0, pendingRecargas: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [
          { count: users },
          { count: events },
          { count: requests },
          { data: wallets },
          { count: orders },
          { count: pendingRecargas },
        ] = await Promise.all([
          supabase.from('users').select('*', { count: 'exact', head: true }),
          supabase.from('events').select('*', { count: 'exact', head: true }).in('status', ['open', 'active']),
          supabase.from('gestor_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('wallets').select('balance'),
          supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
          supabase.from('pending_recargas').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        ]);
        const walletTotal = wallets?.reduce((s, w) => s + (w.balance ?? 0), 0) ?? 0;
        setStats({ users: users ?? 0, events: events ?? 0, requests: requests ?? 0, walletTotal, orders: orders ?? 0, pendingRecargas: pendingRecargas ?? 0 });
      } catch (e) {
        console.warn('AdminDashboard load error:', e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const sections = [
    { label: 'Solicitudes', icon: '📋', route: 'AdminRequests',  badge: stats.requests },
    { label: 'Recargas',    icon: '💳', route: 'AdminRecargas',  badge: stats.pendingRecargas },
    { label: 'Usuarios',    icon: '👥', route: 'AdminUsers' },
    { label: 'Wallets',     icon: '💰', route: 'AdminWallets' },
    { label: 'Inventario',  icon: '🛒', route: 'AdminInventory' },
    { label: 'Eventos',     icon: '📅', route: 'AdminEvents' },
    { label: 'Órdenes',     icon: '📦', route: 'AdminOrders',    badge: stats.orders },
  ];

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView>
        <Text style={styles.title}>PANEL ADMIN</Text>
        <View style={styles.statsGrid}>
          <StatCard label="Usuarios"        value={stats.users}                          icon="👥" />
          <StatCard label="Eventos activos" value={stats.events}                         icon="📅" />
          <StatCard label="Solicitudes"     value={stats.requests}                       icon="📋" color={stats.requests > 0 ? COLORS.gold : undefined} />
          <StatCard label="Wallet total"    value={`$${stats.walletTotal.toFixed(0)}`}   icon="💰" />
          <StatCard label="Órdenes pend."   value={stats.orders}                         icon="📦" color={stats.orders > 0 ? COLORS.gold : undefined} />
          <StatCard label="Recargas pend."  value={stats.pendingRecargas}                icon="💳" color={stats.pendingRecargas > 0 ? COLORS.gold : undefined} />
        </View>
        <Text style={styles.sectionTitle}>Acciones rápidas</Text>
        <View style={styles.menuGrid}>
          {sections.map((s) => (
            <TouchableOpacity key={s.route} style={styles.menuCard} onPress={() => navigation.navigate(s.route)}>
              <Text style={styles.menuIcon}>{s.icon}</Text>
              <Text style={styles.menuLabel}>{s.label}</Text>
              {s.badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{s.badge}</Text></View>}
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES DE GESTOR
// ═══════════════════════════════════════════════════════════════════
function AdminRequests({ navigation }) {
  const [requests,    setRequests]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [rejectModal, setRejectModal] = useState(null); // null | req object
  const [rejectReason,setRejectReason]= useState('');

  useEffect(() => { fetchRequests(); }, []);

  async function fetchRequests() {
    const { data } = await supabase.from('gestor_requests').select('*, user:users!user_id(nombre, correo)').eq('status', 'pending');
    setRequests(data ?? []);
    setLoading(false);
  }

  async function approve(req) {
    const { error: roleErr } = await supabase.from('users').update({ role: 'gestor' }).eq('id', req.user_id);
    if (roleErr) { Alert.alert('Error', roleErr.message); return; }
    const { error: reqErr } = await supabase.from('gestor_requests').update({ status: 'approved' }).eq('id', req.id);
    if (reqErr) { Alert.alert('Error', reqErr.message); return; }
    fetchRequests();
    Alert.alert('✅ Aprobado', `${req.user?.nombre} ahora es Gestor.`);
  }

  function openRejectModal(req) {
    setRejectReason('');
    setRejectModal(req);
  }

  async function confirmReject() {
    if (!rejectReason.trim()) {
      Alert.alert('Requerido', 'Escribe una razón de rechazo.');
      return;
    }
    const { error } = await supabase.from('gestor_requests')
      .update({ status: 'rejected', razon_rechazo: rejectReason.trim() })
      .eq('id', rejectModal.id);
    if (error) { Alert.alert('Error', error.message); return; }
    const rejectedName = rejectModal.user?.nombre;
    setRejectModal(null);
    setRejectReason('');
    fetchRequests();
    Alert.alert('Rechazado', `Solicitud de ${rejectedName} rechazada.`);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>SOLICITUDES</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {requests.length === 0 && <Text style={styles.empty}>No hay solicitudes pendientes</Text>}
        {requests.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.cardName}>{r.user?.nombre}</Text>
            <Text style={styles.cardSub}>{r.user?.correo}</Text>
            <Text style={styles.cardSub}>Actividades: {r.actividades_completadas}</Text>
            {r.motivacion && <Text style={[styles.cardSub, { marginTop: 4, fontStyle: 'italic' }]}>"{r.motivacion}"</Text>}
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.green + 'CC' }]} onPress={() => approve(r)}>
                <Text style={styles.btnText}>✓ Aprobar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.red + 'CC' }]} onPress={() => openRejectModal(r)}>
                <Text style={styles.btnText}>✗ Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Modal de rechazo — cross-platform (reemplaza Alert.prompt que es iOS-only) */}
      <Modal visible={!!rejectModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {/* Cabecera */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✗ Rechazar solicitud</Text>
            </View>

            {/* Info del solicitante */}
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Solicitante</Text>
              <Text style={styles.modalValue}>{rejectModal?.user?.nombre ?? '—'}</Text>
              <Text style={[styles.modalSubtitle, { marginTop: 2 }]}>{rejectModal?.user?.correo ?? ''}</Text>

              {/* Campo de razón */}
              <Text style={[styles.modalSubtitle, { marginTop: SPACING.md }]}>Razón de rechazo *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Describe el motivo del rechazo..."
                placeholderTextColor={COLORS.gray}
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                autoFocus
              />

              {/* Botones */}
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.navy, flex: 1 }]}
                  onPress={() => { setRejectModal(null); setRejectReason(''); }}
                >
                  <Text style={styles.modalBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.red, flex: 1, opacity: rejectReason.trim() ? 1 : 0.5 }]}
                  onPress={confirmReject}
                  disabled={!rejectReason.trim()}
                >
                  <Text style={styles.modalBtnText}>✗ Rechazar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// USUARIOS (solo admin puede cambiar roles)
// ═══════════════════════════════════════════════════════════════════
function AdminUsers({ navigation }) {
  const [users, setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('users').select('*, wallets(balance)').order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setUsers(data ?? []); setLoading(false); });
  }, []);

  async function changeRole(u, role) {
    Alert.alert(
      'Cambiar rol',
      `¿Cambiar el rol de "${u.nombre}" a ${role.toUpperCase()}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
          await supabase.from('users').update({ role }).eq('id', u.id);
          setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role } : x));
        }},
      ]
    );
  }

  const filtered = users.filter(u =>
    !search || u.nombre?.toLowerCase().includes(search.toLowerCase()) || u.correo?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>USUARIOS</Text>
      <TextInput
        style={[styles.input, { margin: SPACING.md, marginBottom: 0 }]}
        placeholder="Buscar por nombre o correo..."
        placeholderTextColor={COLORS.gray}
        value={search}
        onChangeText={setSearch}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {filtered.map((u) => (
          <View key={u.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{u.nombre}</Text>
                <Text style={styles.cardSub}>{u.correo}</Text>
                <Text style={styles.cardSub}>
                  {u.genero ?? '—'} · Wallet: ${u.wallets?.balance?.toFixed(2) ?? '0.00'}
                </Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: u.role === 'admin' ? COLORS.purple : u.role === 'gestor' ? COLORS.blue : COLORS.navy }]}>
                <Text style={styles.roleText}>{u.role?.toUpperCase()}</Text>
              </View>
            </View>
            {/* Solo admin puede cambiar roles */}
            <View style={styles.btnRow}>
              {['player', 'gestor', 'admin'].filter((r) => r !== u.role).map((r) => (
                <TouchableOpacity key={r} style={styles.btnSmall} onPress={() => changeRole(u, r)}>
                  <Text style={styles.btnSmallText}>→ {r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// WALLETS
// ═══════════════════════════════════════════════════════════════════
function AdminWallets({ navigation }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('wallets').select('*, users(nombre)').order('balance', { ascending: false })
      .then(({ data }) => { setWallets(data ?? []); setLoading(false); });
  }, []);

  async function adjust(wallet, amount, tipo = 'ajuste_admin') {
    const newBalance = Math.max(0, (wallet.balance ?? 0) + amount);
    await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
    await supabase.from('wallet_transactions').insert({ wallet_id: wallet.id, tipo, monto: amount, descripcion: `Ajuste admin: ${amount > 0 ? '+' : ''}${amount}` });
    setWallets((prev) => prev.map((w) => w.id === wallet.id ? { ...w, balance: newBalance } : w));
  }

  const total = wallets.reduce((s, w) => s + (w.balance ?? 0), 0);
  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>WALLETS</Text>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>TOTAL EN CIRCULACIÓN</Text>
        <Text style={styles.totalVal}>${total.toFixed(2)}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {wallets.map((w) => (
          <View key={w.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardName}>{w.users?.nombre}</Text>
              <Text style={styles.walletBalance}>${w.balance?.toFixed(2)}</Text>
            </View>
            <View style={styles.btnRow}>
              {[1, 5, -1, -5].map((amt) => (
                <TouchableOpacity key={amt} style={[styles.btnSmall, { backgroundColor: amt > 0 ? COLORS.green + '40' : COLORS.red + '40' }]} onPress={() => adjust(w, amt)}>
                  <Text style={styles.btnSmallText}>{amt > 0 ? '+' : ''}{amt}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.gold + '40' }]} onPress={() => adjust(w, 1, 'mvp_premio')}>
                <Text style={styles.btnSmallText}>🏆 MVP</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// INVENTARIO (con fotos y tallas)
// ═══════════════════════════════════════════════════════════════════
const TALLAS_DEFAULT = { XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0 };
const CATEGORIAS     = ['general', 'ropa', 'accesorios', 'equipamiento', 'otro'];

function AdminInventory({ navigation }) {
  const [products, setProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState({
    nombre: '', descripcion: '', precio: '', categoria: 'general',
    tiene_tallas: false, stock: '', tallas: { ...TALLAS_DEFAULT },
    imagen_url: '', imageUri: null,
  });

  useEffect(() => { loadProducts(); }, []);

  async function loadProducts() {
    const { data } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    setProducts(data ?? []);
  }

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updTalla = (t, v) => setForm((f) => ({ ...f, tallas: { ...f.tallas, [t]: parseInt(v) || 0 } }));

  const startNew = () => {
    setEditId(null);
    setForm({ nombre: '', descripcion: '', precio: '', categoria: 'general', tiene_tallas: false, stock: '', tallas: { ...TALLAS_DEFAULT }, imagen_url: '', imageUri: null });
    setShowForm(true);
  };

  const startEdit = (p) => {
    setEditId(p.id);
    setForm({
      nombre: p.nombre, descripcion: p.descripcion ?? '', precio: String(p.precio ?? ''),
      categoria: p.categoria ?? 'general', tiene_tallas: p.tiene_tallas ?? false,
      stock: String(p.stock ?? ''), tallas: p.tallas ?? { ...TALLAS_DEFAULT },
      imagen_url: p.imagen_url ?? '', imageUri: null,
    });
    setShowForm(true);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (!result.canceled) upd('imageUri', result.assets[0].uri);
  };

  async function uploadProductImage(uri, productId) {
    const ext  = uri.split('.').pop();
    const path = `${productId}.${ext}`;
    const resp = await fetch(uri);
    const blob = await resp.blob();
    const { error } = await supabase.storage.from('products').upload(path, blob, { upsert: true, contentType: `image/${ext}` });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(path);
    return publicUrl;
  }

  async function saveProduct() {
    if (!form.nombre || !form.precio) { Alert.alert('Error', 'Nombre y precio son requeridos.'); return; }
    setSaving(true);
    try {
      const payload = {
        nombre:       form.nombre,
        descripcion:  form.descripcion || null,
        precio:       parseFloat(form.precio) || 0,
        categoria:    form.categoria,
        tiene_tallas: form.tiene_tallas,
        stock:        form.tiene_tallas
          ? Object.values(form.tallas).reduce((s, v) => s + v, 0)   // stock total de tallas
          : parseInt(form.stock) || 0,
        tallas:       form.tiene_tallas ? form.tallas : null,
        activo:       true,
      };

      let productId = editId;
      if (editId) {
        await supabase.from('products').update(payload).eq('id', editId);
      } else {
        const { data, error } = await supabase.from('products').insert(payload).select().single();
        if (error) throw error;
        productId = data.id;
      }

      // Upload image if picked
      if (form.imageUri && productId) {
        const url = await uploadProductImage(form.imageUri, productId);
        await supabase.from('products').update({ imagen_url: url }).eq('id', productId);
      }

      Alert.alert('¡Guardado!', editId ? 'Producto actualizado.' : 'Producto creado.');
      setShowForm(false);
      loadProducts();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateStock(id, delta, talla = null) {
    const prod = products.find((p) => p.id === id);
    if (!prod) return;
    if (talla && prod.tiene_tallas) {
      const newTallas = { ...(prod.tallas ?? {}), [talla]: Math.max(0, (prod.tallas?.[talla] ?? 0) + delta) };
      const newStock  = Object.values(newTallas).reduce((s, v) => s + v, 0);
      await supabase.from('products').update({ tallas: newTallas, stock: newStock }).eq('id', id);
      setProducts((prev) => prev.map((p) => p.id === id ? { ...p, tallas: newTallas, stock: newStock } : p));
    } else {
      const newStock = Math.max(0, prod.stock + delta);
      await supabase.from('products').update({ stock: newStock }).eq('id', id);
      setProducts((prev) => prev.map((p) => p.id === id ? { ...p, stock: newStock } : p));
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md }}>
        <Text style={[styles.title, { padding: 0 }]}>INVENTARIO</Text>
        <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.red }]} onPress={startNew}>
          <Text style={[styles.btnSmallText, { color: COLORS.white }]}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      {/* Formulario */}
      {showForm && (
        <ScrollView style={{ maxHeight: '60%' }} contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}>
          <View style={[styles.card, { borderColor: COLORS.blue, borderWidth: 2 }]}>
            <Text style={[styles.cardName, { color: COLORS.gold }]}>{editId ? 'EDITAR PRODUCTO' : 'NUEVO PRODUCTO'}</Text>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput style={styles.input} placeholder="Nombre del producto" placeholderTextColor={COLORS.gray} value={form.nombre} onChangeText={(v) => upd('nombre', v)} />

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput style={[styles.input, { height: 60, textAlignVertical: 'top' }]} placeholder="Descripción opcional" placeholderTextColor={COLORS.gray} multiline value={form.descripcion} onChangeText={(v) => upd('descripcion', v)} />

            <Text style={styles.fieldLabel}>Precio ($) *</Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={COLORS.gray} keyboardType="decimal-pad" value={form.precio} onChangeText={(v) => upd('precio', v)} />

            <Text style={styles.fieldLabel}>Categoría</Text>
            <View style={styles.chipRow}>
              {CATEGORIAS.map((c) => (
                <TouchableOpacity key={c} style={[styles.chip, form.categoria === c && styles.chipActive]} onPress={() => upd('categoria', c)}>
                  <Text style={[styles.chipText, form.categoria === c && { color: COLORS.white }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Imagen */}
            <TouchableOpacity style={[styles.input, { alignItems: 'center', justifyContent: 'center' }]} onPress={pickImage}>
              {form.imageUri || form.imagen_url
                ? <Image source={{ uri: form.imageUri ?? form.imagen_url }} style={{ width: 80, height: 80, borderRadius: RADIUS.sm }} />
                : <Text style={{ color: COLORS.gray, fontFamily: FONTS.body }}>📷 Agregar foto</Text>
              }
            </TouchableOpacity>

            {/* Tallas */}
            <TouchableOpacity style={styles.checkRow} onPress={() => upd('tiene_tallas', !form.tiene_tallas)}>
              <View style={[styles.check, form.tiene_tallas && styles.checkActive]} />
              <Text style={styles.checkLabel}>Este producto tiene tallas (ropa)</Text>
            </TouchableOpacity>

            {form.tiene_tallas
              ? (
                <>
                  <Text style={styles.fieldLabel}>Stock por talla</Text>
                  {Object.entries(form.tallas).map(([t, qty]) => (
                    <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: 4 }}>
                      <Text style={[styles.cardSub, { width: 36, fontFamily: FONTS.bodyBold }]}>{t}</Text>
                      <TextInput
                        style={[styles.input, { flex: 1, padding: SPACING.sm, textAlign: 'center' }]}
                        keyboardType="number-pad" value={String(qty)}
                        onChangeText={(v) => updTalla(t, v)}
                      />
                    </View>
                  ))}
                </>
              )
              : (
                <>
                  <Text style={styles.fieldLabel}>Stock disponible</Text>
                  <TextInput style={styles.input} placeholder="0" placeholderTextColor={COLORS.gray} keyboardType="number-pad" value={form.stock} onChangeText={(v) => upd('stock', v)} />
                </>
              )
            }

            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.gray + '40' }]} onPress={() => setShowForm(false)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue }]} onPress={saveProduct} disabled={saving}>
                {saving ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>✓ Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      )}

      {/* Lista */}
      <ScrollView contentContainerStyle={styles.list}>
        {products.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {p.imagen_url && <Image source={{ uri: p.imagen_url }} style={{ width: 56, height: 56, borderRadius: RADIUS.sm }} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{p.nombre}</Text>
                <Text style={styles.cardSub}>{p.categoria} · ${p.precio?.toFixed(2)}</Text>
                {p.tiene_tallas
                  ? <Text style={styles.cardSub}>Tallas: {Object.entries(p.tallas ?? {}).map(([t, q]) => `${t}:${q}`).join(' · ')}</Text>
                  : <Text style={[styles.cardSub, { color: p.stock < 5 ? COLORS.red : COLORS.green }]}>Stock: {p.stock}</Text>
                }
              </View>
            </View>
            <View style={styles.btnRow}>
              {!p.tiene_tallas && (
                <>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.red + '40' }]} onPress={() => updateStock(p.id, -1)}><Text style={styles.btnSmallText}>−1</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]} onPress={() => updateStock(p.id, 1)}><Text style={styles.btnSmallText}>+1</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]} onPress={() => updateStock(p.id, 10)}><Text style={styles.btnSmallText}>+10</Text></TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.gold + '40' }]} onPress={() => startEdit(p)}>
                <Text style={styles.btnSmallText}>✏️ Editar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ÓRDENES DE COMPRA (admin marca como entregado)
// ═══════════════════════════════════════════════════════════════════
function AdminOrders({ navigation }) {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all'); // all | paid | delivered

  useEffect(() => { loadOrders(); }, []);

  async function loadOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, user:users!user_id(nombre, correo), order_items(*, products(nombre, imagen_url))')
      .order('created_at', { ascending: false });
    setOrders(data ?? []);
    setLoading(false);
  }

  async function markDelivered(orderId) {
    Alert.alert('Marcar entregado', '¿Confirmar entrega de esta orden?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: async () => {
        // Optimistic update so UI responds immediately
        setOrders((prev) => prev.map((o) =>
          o.id === orderId ? { ...o, status: 'delivered', delivered_at: new Date().toISOString() } : o
        ));
        // Write to DB — use .select() to detect silent RLS blocks (0 rows = no permission)
        const { data: updated, error } = await supabase
          .from('orders')
          .update({ status: 'delivered', delivered_at: new Date().toISOString() })
          .eq('id', orderId)
          .select('id, status');
        if (error || !updated?.length) {
          Alert.alert(
            'Error al guardar',
            error?.message ?? 'No se pudo actualizar el estado. Verifica permisos de administrador.'
          );
          loadOrders(); // revert to real DB state
          return;
        }
        // Re-fetch to confirm DB state is consistent
        loadOrders();
      }},
    ]);
  }

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const STATUS_COLOR = { paid: COLORS.gold, delivered: COLORS.green, processing: COLORS.blue, cancelled: COLORS.red };
  const STATUS_LABEL = { paid: 'PENDIENTE', delivered: 'ENTREGADO', processing: 'PROCESO', cancelled: 'CANCELADO' };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>ÓRDENES</Text>
      {/* Filtros */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm }}>
        {[['all','Todas'], ['paid','Pendientes'], ['delivered','Entregadas']].map(([val, label]) => (
          <TouchableOpacity key={val} style={[styles.btnSmall, filter === val && { backgroundColor: COLORS.blue }]} onPress={() => setFilter(val)}>
            <Text style={[styles.btnSmallText, filter === val && { color: COLORS.white }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {filtered.length === 0 && <Text style={styles.empty}>No hay órdenes</Text>}
        {filtered.map((o) => (
          <View key={o.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{o.user?.nombre}</Text>
                <Text style={styles.cardSub}>{o.user?.correo}</Text>
                <Text style={styles.cardSub}>{o.metodo_pago?.toUpperCase()} · Total: ${o.total?.toFixed(2)}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[o.status] ?? COLORS.gray) + '30' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLOR[o.status] ?? COLORS.gray }]}>
                  {STATUS_LABEL[o.status] ?? o.status?.toUpperCase()}
                </Text>
              </View>
            </View>
            {/* Items */}
            {o.order_items?.map((item, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', marginTop: 4 }}>
                {item.products?.imagen_url && (
                  <Image source={{ uri: item.products.imagen_url }} style={{ width: 32, height: 32, borderRadius: 4 }} />
                )}
                <Text style={styles.cardSub}>
                  {item.products?.nombre} {item.talla ? `(${item.talla})` : ''} × {item.cantidad ?? item.qty ?? 1}
                </Text>
              </View>
            ))}
            {o.status === 'paid' && (
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.green + 'CC', marginTop: SPACING.sm }]} onPress={() => markDelivered(o.id)}>
                <Text style={styles.btnText}>📦 Marcar entregado</Text>
              </TouchableOpacity>
            )}
            {o.status === 'delivered' && o.delivered_at && (
              <Text style={[styles.cardSub, { color: COLORS.green, marginTop: 4 }]}>
                ✓ Entregado: {new Date(o.delivered_at).toLocaleDateString()}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EVENTOS (admin ve todos)
// ═══════════════════════════════════════════════════════════════════
function AdminEvents({ navigation }) {
  const [events,   setEvents]   = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState({
    nombre: '', formato: 'Liga', deporte: 'Fútbol 7', fecha: '', hora: '',
    lugar: '', direccion: '', precio: '0', cupos_total: '',
    cupos_ilimitado: false, genero: 'Mixto', descripcion: '',
    jugadores_por_equipo: null, jornadas: '1',
    num_grupos: '2', equipos_por_grupo: '3',
    tiene_octavos: false, tiene_cuartos: false,
    tiene_semis: true, tiene_tercer_lugar: true, tiene_final: true,
    ida_y_vuelta: false,
  });
  const { user } = useAuthStore();

  useEffect(() => { fetchEvents(); }, []);

  function fetchEvents() {
    supabase.from('events').select('*').order('fecha', { ascending: false })
      .then(({ data }) => setEvents(data ?? []));
  }

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const STATUS_FLOW  = { draft: 'open', open: 'active', active: 'finished' };
  const STATUS_LABEL = { draft: 'BORRADOR', open: 'ABIERTO', active: 'ACTIVO', finished: 'FINALIZADO', cancelled: 'CANCELADO' };
  const STATUS_COLOR = { draft: COLORS.gray, open: COLORS.green, active: COLORS.magenta, finished: COLORS.gray, cancelled: COLORS.red };

  async function changeStatus(ev) {
    const next = STATUS_FLOW[ev.status];
    if (!next) { Alert.alert('Info', 'Este evento ya está finalizado o cancelado.'); return; }
    if (next === 'finished') {
      const newsTitle = `🏁 ${ev.nombre} — Evento Finalizado`;
      const newsBody  = `El evento "${ev.nombre}" ha concluido. Revisa los resultados y la tabla de posiciones.`;
      // Auto-noticia al finalizar
      await supabase.from('news').insert({
        titulo:   newsTitle,
        contenido: newsBody,
        tipo:     'resultados',
      }).catch(() => {});
      sendLocalNotification(newsTitle, newsBody);
      // Auto-ocultar tras 24h: guardar timestamp de finalización
      await supabase.from('events').update({ status: next, event_finished_at: new Date().toISOString() }).eq('id', ev.id);
      fetchEvents();
      return;
    }
    await supabase.from('events').update({ status: next }).eq('id', ev.id);
    fetchEvents();
  }

  // Calcula info de equipos
  const cuposNum = parseInt(form.cupos_total) || 0;
  const jpq      = form.jugadores_por_equipo;
  const teamCalc = jpq && cuposNum ? calcTeams(cuposNum, jpq) : null;

  async function saveEvent() {
    if (!form.nombre || !form.fecha || !form.hora || !form.lugar) {
      Alert.alert('Error', 'Nombre, fecha, hora y lugar son obligatorios.');
      return;
    }
    // BUG FIX: validate fecha is not in the past
    const eventDateTime = new Date(`${form.fecha}T${form.hora}`);
    if (isNaN(eventDateTime.getTime())) {
      Alert.alert('Error', 'Fecha u hora inválida. Usa el formato YYYY-MM-DD y HH:MM.'); return;
    }
    if (eventDateTime < new Date()) {
      Alert.alert('Fecha inválida', 'La fecha del evento no puede ser en el pasado.'); return;
    }
    // BUG FIX: validate cupos > 0 when not ilimitado
    if (!form.cupos_ilimitado) {
      const cuposVal = parseInt(form.cupos_total);
      if (!cuposVal || cuposVal <= 0) {
        Alert.alert('Cupos inválidos', 'Los cupos deben ser un número mayor a 0, o activa "Cupos ilimitados".'); return;
      }
    }
    // Cupos must be exact multiple of jugadores_por_equipo — HARD BLOCK
    if (teamCalc && !teamCalc.esExacto) {
      const numEq   = Math.floor(cuposNum / jpq);
      const opcionA = numEq > 0     ? `• ${numEq} equipos → ${numEq * jpq} cupos` : '';
      const opcionB = `• ${numEq + 1} equipos → ${(numEq + 1) * jpq} cupos`;
      Alert.alert(
        '⛔ Cupos inválidos',
        `Con ${jpq} jugadores por equipo, los cupos deben ser múltiplo de ${jpq}.\n\n${opcionA}\n${opcionB}\n\nAjusta los cupos antes de continuar.`
      );
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('events').insert({
        nombre:              form.nombre,
        formato:             form.formato,
        deporte:             form.deporte,
        fecha:               form.fecha,
        hora:                form.hora,
        lugar:               form.lugar,
        direccion:           form.direccion || null,
        precio:              parseFloat(form.precio) || 0,
        cupos_total:         form.cupos_ilimitado ? null : (parseInt(form.cupos_total) || null),
        cupos_ilimitado:     form.cupos_ilimitado,
        genero:              form.genero,
        descripcion:         form.descripcion || null,
        status:              'draft',
        created_by:          user?.id,
        jugadores_por_equipo:form.jugadores_por_equipo,
        jornadas:            form.formato === 'Liga' ? (parseInt(form.jornadas) || 1) : 1,
        num_grupos:          form.formato === 'Torneo' ? (parseInt(form.num_grupos) || 2) : null,
        equipos_por_grupo:   form.formato === 'Torneo' ? (parseInt(form.equipos_por_grupo) || 3) : null,
        tiene_octavos:       form.formato === 'Torneo' ? form.tiene_octavos : false,
        tiene_cuartos:       form.formato === 'Torneo' ? form.tiene_cuartos : false,
        tiene_semis:         form.formato === 'Torneo' ? form.tiene_semis : false,
        tiene_tercer_lugar:  form.formato === 'Torneo' ? form.tiene_tercer_lugar : false,
        tiene_final:         form.formato === 'Torneo' ? form.tiene_final : false,
        ida_y_vuelta:        form.ida_y_vuelta,
      });
      if (error) throw error;
      Alert.alert('¡Evento creado!', 'Aparece como borrador.');
      setShowForm(false);
      setForm({ nombre:'', formato:'Liga', deporte:'Fútbol 7', fecha:'', hora:'', lugar:'', direccion:'', precio:'0', cupos_total:'', cupos_ilimitado:false, genero:'Mixto', descripcion:'', jugadores_por_equipo:null, jornadas:'1', num_grupos:'2', equipos_por_grupo:'3', tiene_octavos:false, tiene_cuartos:false, tiene_semis:true, tiene_tercer_lugar:true, tiene_final:true, ida_y_vuelta:false });
      fetchEvents();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom: SPACING.md }}>
          <Text style={[styles.title, { padding: 0 }]}>EVENTOS</Text>
          <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.red, paddingHorizontal: SPACING.md }]} onPress={() => setShowForm((v) => !v)}>
            <Text style={[styles.btnSmallText, { color: COLORS.white }]}>{showForm ? '✕ Cancelar' : '+ Nuevo'}</Text>
          </TouchableOpacity>
        </View>

        {showForm && (
          <View style={[styles.card, { borderColor: COLORS.blue, borderWidth: 2, marginBottom: SPACING.md }]}>
            <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: SPACING.sm }]}>NUEVO EVENTO</Text>

            <Text style={styles.fieldLabel}>Nombre *</Text>
            <TextInput style={styles.input} placeholder="Nombre del evento" placeholderTextColor={COLORS.gray} value={form.nombre} onChangeText={(v) => upd('nombre', v)} />

            <Text style={styles.fieldLabel}>Deporte</Text>
            <View style={styles.chipRow}>
              {['Fútbol','Fútbol 7','Fútbol Sala','Volleyball','Beach Volleyball','Pádel','Tenis','Basketball','Baseball','Otro'].map((d) => (
                <TouchableOpacity key={d} style={[styles.chip, form.deporte === d && styles.chipActive]} onPress={() => upd('deporte', d)}>
                  <Text style={[styles.chipText, form.deporte === d && { color: COLORS.white }]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Formato</Text>
            <View style={styles.chipRow}>
              {['Liga','Torneo','Amistoso','Copa','Eliminación directa'].map((f) => (
                <TouchableOpacity key={f} style={[styles.chip, form.formato === f && styles.chipActive]} onPress={() => upd('formato', f)}>
                  <Text style={[styles.chipText, form.formato === f && { color: COLORS.white }]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Fecha * (YYYY-MM-DD)</Text>
            <TextInput style={styles.input} placeholder="2026-06-15" placeholderTextColor={COLORS.gray} value={form.fecha} onChangeText={(v) => upd('fecha', v)} />

            <Text style={styles.fieldLabel}>Hora * (HH:MM)</Text>
            <TextInput style={styles.input} placeholder="08:00" placeholderTextColor={COLORS.gray} value={form.hora} onChangeText={(v) => upd('hora', v)} />

            <Text style={styles.fieldLabel}>Lugar *</Text>
            <TextInput style={styles.input} placeholder="Cancha / Estadio" placeholderTextColor={COLORS.gray} value={form.lugar} onChangeText={(v) => upd('lugar', v)} />

            <Text style={styles.fieldLabel}>Dirección</Text>
            <TextInput style={styles.input} placeholder="Dirección exacta (opcional)" placeholderTextColor={COLORS.gray} value={form.direccion} onChangeText={(v) => upd('direccion', v)} />

            <Text style={styles.fieldLabel}>Precio ($)</Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={COLORS.gray} keyboardType="decimal-pad" value={form.precio} onChangeText={(v) => upd('precio', v)} />

            <Text style={styles.fieldLabel}>Género</Text>
            <View style={styles.chipRow}>
              {['Mixto','Masculino','Femenino','Libre'].map((g) => (
                <TouchableOpacity key={g} style={[styles.chip, form.genero === g && styles.chipActive]} onPress={() => upd('genero', g)}>
                  <Text style={[styles.chipText, form.genero === g && { color: COLORS.white }]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Jugadores por equipo */}
            <Text style={styles.fieldLabel}>Jugadores por equipo</Text>
            <View style={styles.chipRow}>
              {[null, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <TouchableOpacity key={String(n)} style={[styles.chip, form.jugadores_por_equipo === n && styles.chipActive]} onPress={() => upd('jugadores_por_equipo', n)}>
                  <Text style={[styles.chipText, form.jugadores_por_equipo === n && { color: COLORS.white }]}>{n === null ? 'Libre' : `${n}v${n}`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {teamCalc && (
              <View style={[styles.card, { backgroundColor: teamCalc.esExacto ? COLORS.green + '15' : COLORS.gold + '15', borderColor: teamCalc.esExacto ? COLORS.green : COLORS.gold }]}>
                <Text style={{ fontFamily: FONTS.bodyMedium, color: teamCalc.esExacto ? COLORS.green : COLORS.gold, fontSize: 13 }}>
                  {teamCalc.esExacto
                    ? `✓ ${teamCalc.numEquipos} equipos de ${jpq} jugadores`
                    : `⚠ ${teamCalc.numEquipos} equipos + ${teamCalc.sobrantes} sobrante(s). Recomendado: ${teamCalc.sugerido} cupos`
                  }
                </Text>
              </View>
            )}

            {/* Cupos */}
            <TouchableOpacity style={styles.checkRow} onPress={() => upd('cupos_ilimitado', !form.cupos_ilimitado)}>
              <View style={[styles.check, form.cupos_ilimitado && styles.checkActive]} />
              <Text style={styles.checkLabel}>Cupos ilimitados</Text>
            </TouchableOpacity>
            {!form.cupos_ilimitado && (
              <>
                <Text style={styles.fieldLabel}>Cupos totales</Text>
                <TextInput style={styles.input} placeholder="20" placeholderTextColor={COLORS.gray} keyboardType="number-pad" value={form.cupos_total} onChangeText={(v) => upd('cupos_total', v)} />
              </>
            )}

            {/* Liga: jornadas */}
            {(form.formato === 'Liga') && (
              <>
                <Text style={styles.fieldLabel}>Jornadas (vueltas completas)</Text>
                <View style={styles.chipRow}>
                  {['1','2','3'].map((j) => (
                    <TouchableOpacity key={j} style={[styles.chip, form.jornadas === j && styles.chipActive]} onPress={() => upd('jornadas', j)}>
                      <Text style={[styles.chipText, form.jornadas === j && { color: COLORS.white }]}>{j} vuelta{j > 1 ? 's' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.checkRow} onPress={() => upd('ida_y_vuelta', !form.ida_y_vuelta)}>
                  <View style={[styles.check, form.ida_y_vuelta && styles.checkActive]} />
                  <Text style={styles.checkLabel}>Ida y vuelta (invertir local/visitante)</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Torneo: grupos y llaves */}
            {(form.formato === 'Torneo' || form.formato === 'Copa') && (
              <>
                <Text style={styles.fieldLabel}>Número de grupos</Text>
                <View style={styles.chipRow}>
                  {['2','3','4','8'].map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, form.num_grupos === n && styles.chipActive]} onPress={() => upd('num_grupos', n)}>
                      <Text style={[styles.chipText, form.num_grupos === n && { color: COLORS.white }]}>{n} grupos</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Equipos por grupo</Text>
                <View style={styles.chipRow}>
                  {['2','3','4','5'].map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, form.equipos_por_grupo === n && styles.chipActive]} onPress={() => upd('equipos_por_grupo', n)}>
                      <Text style={[styles.chipText, form.equipos_por_grupo === n && { color: COLORS.white }]}>{n} equipos</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Fase eliminatoria</Text>
                {[
                  ['tiene_octavos',   'Octavos de final'],
                  ['tiene_cuartos',   'Cuartos de final'],
                  ['tiene_semis',     'Semifinales'],
                  ['tiene_tercer_lugar','3er y 4to lugar'],
                  ['tiene_final',     'Final'],
                  ['ida_y_vuelta',    'Ida y vuelta en eliminatoria'],
                ].map(([key, label]) => (
                  <TouchableOpacity key={key} style={styles.checkRow} onPress={() => upd(key, !form[key])}>
                    <View style={[styles.check, form[key] && styles.checkActive]} />
                    <Text style={styles.checkLabel}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <Text style={styles.fieldLabel}>Descripción</Text>
            <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} placeholder="Descripción del evento..." placeholderTextColor={COLORS.gray} multiline value={form.descripcion} onChangeText={(v) => upd('descripcion', v)} />

            <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue, marginTop: SPACING.sm }]} onPress={saveEvent} disabled={saving}>
              {saving ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>✓ Crear Evento</Text>}
            </TouchableOpacity>
          </View>
        )}

        {events.length === 0 && !showForm && <Text style={styles.empty}>No hay eventos.</Text>}
        {events.map((ev) => (
          <View key={ev.id} style={styles.card}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start', marginBottom: SPACING.sm }}>
              <View style={{ flex: 1, marginRight: SPACING.sm }}>
                <Text style={styles.cardName}>{ev.nombre}</Text>
                <Text style={styles.cardSub}>{ev.deporte} · {ev.formato} · {ev.lugar}</Text>
                <Text style={styles.cardSub}>{ev.fecha} · {ev.hora?.slice(0,5)} · ${ev.precio?.toFixed(2)}</Text>
                {ev.jugadores_por_equipo && <Text style={styles.cardSub}>{ev.jugadores_por_equipo}v{ev.jugadores_por_equipo}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[ev.status] ?? COLORS.gray) + '25' }]}>
                <Text style={[styles.statusText, { color: STATUS_COLOR[ev.status] ?? COLORS.gray }]}>
                  {STATUS_LABEL[ev.status] ?? ev.status?.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.btnRow}>
              {STATUS_FLOW[ev.status] && (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.blue + '40', borderColor: COLORS.blue }]} onPress={() => changeStatus(ev)}>
                  <Text style={[styles.actionBtnText, { color: COLORS.blue2 }]}>→ {STATUS_FLOW[ev.status]}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.gold + '25', borderColor: COLORS.gold }]}
                onPress={() => navigation.navigate('AdminManageEvent', { eventId: ev.id, eventNombre: ev.nombre, formato: ev.formato })}>
                <Text style={[styles.actionBtnText, { color: COLORS.gold }]}>⚙️ Gestionar</Text>
              </TouchableOpacity>
              {(ev.status === 'draft' || ev.status === 'cancelled') && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: COLORS.red + '25', borderColor: COLORS.red }]}
                  onPress={() =>
                    Alert.alert('Eliminar evento', `¿Eliminar "${ev.nombre}" permanentemente?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Eliminar', style: 'destructive', onPress: async () => {
                        const { error } = await supabase.from('events').delete().eq('id', ev.id);
                        if (error) { Alert.alert('Error', error.message); return; }
                        fetchEvents();
                      }},
                    ])
                  }
                >
                  <Text style={[styles.actionBtnText, { color: COLORS.red }]}>🗑 Eliminar</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GESTIÓN DE EVENTO (tabs: Equipos, Partidos, Resultados, MVP, Config)
// ═══════════════════════════════════════════════════════════════════
function AdminManageEvent({ route, navigation }) {
  const { eventId, eventNombre, formato } = route.params ?? {};
  const TABS     = ['Equipos', 'Partidos', 'Resultados', 'MVP', 'Config'];
  const [tab,        setTab]        = useState('Equipos');
  const [teams,      setTeams]      = useState([]);
  const [players,    setPlayers]    = useState([]);
  const [matches,    setMatches]    = useState([]);
  const [event,      setEvent]      = useState(null);
  const [scores,     setScores]     = useState({});
  const [savingMatch, setSavingMatch] = useState(null); // BUG FIX: double-submit guard for saveResult
  const [mvpResult,        setMvpResult]        = useState(null);   // single event MVP or null
  const [mvpVotesByPlayer, setMvpVotesByPlayer] = useState({});     // { userId: voteCount }
  const [mvpTotalVotes,    setMvpTotalVotes]    = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [mixedModal, setMixedModal] = useState(false);
  const [chicasPorEquipo, setChicasPorEquipo] = useState('1');
  const [editTeamModal,   setEditTeamModal]   = useState(null); // null | team obj
  const [editTeamForm,    setEditTeamForm]    = useState({ nombre: '', color: '' });
  const [assignExpanded,  setAssignExpanded]  = useState(null); // userId being assigned to a team

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: t }, { data: regs }, { data: m }, { data: ev }, { data: evMvpResult }, { data: evVotes }] = await Promise.all([
        supabase.from('teams').select('*, team_players(user_id, users(nombre, genero))').eq('event_id', eventId),
        supabase.from('event_registrations').select('user_id, users(nombre, genero)').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('matches').select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color)').eq('event_id', eventId).order('jornada'),
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('mvp_results').select('*, users(nombre)').eq('event_id', eventId).maybeSingle(),
        supabase.from('mvp_votes').select('voted_for_id').eq('event_id', eventId),
      ]);

      const byPlayer = (evVotes ?? []).reduce((acc, v) => {
        acc[v.voted_for_id] = (acc[v.voted_for_id] ?? 0) + 1;
        return acc;
      }, {});

      setTeams(t ?? []);
      setPlayers(regs ?? []);
      setMatches(m ?? []);
      setEvent(ev);
      setMvpResult(evMvpResult ?? null);
      setMvpVotesByPlayer(byPlayer);
      setMvpTotalVotes((evVotes ?? []).length);
    } catch (e) {
      console.warn('AdminManageEvent loadAll error:', e.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Crear equipos automáticos con colores ──
  async function createAutoTeams() {
    if (!event) return;
    // Guard: si ya hay equipos, confirmar antes de recrear
    if (teams.length > 0) {
      const ok = await new Promise(res =>
        Alert.alert('Equipos existentes', `Ya hay ${teams.length} equipo(s). ¿Eliminarlos y crear nuevos?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
          { text: 'Recrear', style: 'destructive', onPress: () => res(true) },
        ])
      );
      if (!ok) return;
      // Borrar jugadores asignados primero, luego equipos
      for (const t of teams) {
        await supabase.from('team_players').delete().eq('team_id', t.id);
      }
      await supabase.from('teams').delete().in('id', teams.map(t => t.id));
    }

    const jpq       = event.jugadores_por_equipo;
    const cupos     = event.cupos_total;
    const numTeams  = jpq && cupos ? Math.floor(cupos / jpq) : 2;
    const isTorneo  = event.formato === 'Torneo' || event.formato === 'Copa';
    const numGrupos = event.num_grupos ?? 2;

    const inserts = [];
    for (let i = 0; i < numTeams; i++) {
      const col   = TEAM_COLORS[i % TEAM_COLORS.length];
      const grupo = isTorneo
        ? String.fromCharCode(65 + Math.floor(i / Math.ceil(numTeams / numGrupos)))
        : 'A';
      inserts.push({ event_id: eventId, nombre: col.nombre, color: col.color, grupo });
    }
    const { error } = await supabase.from('teams').insert(inserts);
    if (error) { Alert.alert('Error', error.message); return; }
    loadAll();
    Alert.alert('✓ Equipos creados', `${numTeams} equipos con colores.${players.length < numTeams * (jpq ?? 1) ? `\n⚠️ Solo ${players.length} inscritos — faltan jugadores para completar todos los cupos.` : ''}`);
  }

  // ── Asignación aleatoria (con soporte mixto) ──
  async function autoAssign(chicasPEq = 0) {
    if (teams.length === 0) { Alert.alert('Error', 'Crea equipos primero.'); return; }
    // Limpiar asignaciones previas antes de redistribuir
    for (const t of teams) {
      await supabase.from('team_players').delete().eq('team_id', t.id);
    }
    const isMixto    = event?.genero === 'Mixto';
    const chicas     = players.filter(p => p.users?.genero === 'Femenino');
    const chicos     = players.filter(p => p.users?.genero !== 'Femenino');

    const assignments = [];
    if (isMixto && chicasPEq > 0) {
      // Slot-filling: garantiza exactamente chicasPEq mujeres por equipo
      const shuffledChicas = [...chicas].sort(() => Math.random() - 0.5);
      const shuffledChicos = [...chicos].sort(() => Math.random() - 0.5);
      let girlIdx = 0;
      // Primero: asignar N chicas por equipo en orden
      for (let t = 0; t < teams.length; t++) {
        for (let s = 0; s < chicasPEq && girlIdx < shuffledChicas.length; s++) {
          assignments.push({ team_id: teams[t].id, user_id: shuffledChicas[girlIdx++].user_id });
        }
      }
      // Chicas sobrantes (si hay más que slots disponibles) → round-robin
      while (girlIdx < shuffledChicas.length) {
        assignments.push({ team_id: teams[girlIdx % teams.length].id, user_id: shuffledChicas[girlIdx++].user_id });
      }
      // Luego: distribuir chicos en round-robin
      shuffledChicos.forEach((p, i) => {
        assignments.push({ team_id: teams[i % teams.length].id, user_id: p.user_id });
      });
    } else {
      const shuffled = [...players].sort(() => Math.random() - 0.5);
      shuffled.forEach((p, i) => {
        assignments.push({ team_id: teams[i % teams.length].id, user_id: p.user_id });
      });
    }

    for (const a of assignments) {
      await supabase.from('team_players').upsert(a, { onConflict: 'team_id,user_id' });
    }
    loadAll();
    Alert.alert('✓ Asignados', `${assignments.length} jugadores asignados aleatoriamente.`);
  }

  // ── Eliminar equipo ──
  function deleteTeam(team) {
    Alert.alert(
      'Eliminar equipo',
      `¿Eliminar "${team.nombre}" y quitar todos sus jugadores asignados?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: async () => {
          await supabase.from('team_players').delete().eq('team_id', team.id);
          await supabase.from('teams').delete().eq('id', team.id);
          loadAll();
        }},
      ]
    );
  }

  // ── Guardar edición de equipo (nombre / color) ──
  async function saveTeamEdit() {
    if (!editTeamModal || !editTeamForm.nombre.trim()) return;
    await supabase.from('teams').update({
      nombre: editTeamForm.nombre.trim(),
      color:  editTeamForm.color,
    }).eq('id', editTeamModal.id);
    setEditTeamModal(null);
    loadAll();
  }

  // ── Quitar un jugador específico de su equipo ──
  async function removePlayerFromTeam(teamId, userId) {
    await supabase.from('team_players').delete().eq('team_id', teamId).eq('user_id', userId);
    loadAll();
  }

  // ── Asignar un jugador sin equipo a un equipo específico ──
  async function assignPlayerToTeam(teamId, userId) {
    // WC fix M8: eliminar de cualquier otro equipo primero para evitar duplicados
    await supabase.from('team_players').delete().eq('user_id', userId);
    await supabase.from('team_players').insert({ team_id: teamId, user_id: userId });
    setAssignExpanded(null);
    loadAll();
  }

  // ── Generar fixture según formato ──
  async function generateFixture() {
    if (teams.length < 2) { Alert.alert('Error', 'Se necesitan al menos 2 equipos.'); return; }

    const { data: existing } = await supabase.from('matches').select('id, status').eq('event_id', eventId);
    if (existing?.length > 0) {
      const hasResults = existing.some(m => m.status === 'finished');
      const ok = await new Promise(res => Alert.alert(
        'Atención',
        hasResults
          ? `⚠️ Hay ${existing.filter(m => m.status === 'finished').length} partidos con resultados guardados. Regenerar los ELIMINARÁ permanentemente.\n\n¿Continuar?`
          : 'Ya hay partidos generados. ¿Borrarlos y regenerar?',
        [
          { text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
          { text: 'Regenerar', style: 'destructive', onPress: () => res(true) },
        ]
      ));
      if (!ok) return;
      // MVP is now per-event — delete by event_id (not match_id)
      await supabase.from('mvp_votes').delete().eq('event_id', eventId);
      await supabase.from('mvp_results').delete().eq('event_id', eventId);
      await supabase.from('matches').delete().eq('event_id', eventId);
    }

    let fixtures = [];
    const fmt    = event?.formato;
    const jornadas    = event?.jornadas ?? 1;
    const idaYVuelta  = event?.ida_y_vuelta ?? false;

    if (fmt === 'Liga' || fmt === 'Amistoso') {
      const gen = generateLigaFixture(teams, jornadas, idaYVuelta);
      fixtures  = gen.map(f => ({
        event_id:        eventId,
        jornada:         f.jornada,
        round:           f.round,
        fase:            'grupos',
        team_home_id:    f.home.id,
        team_away_id:    f.away.id,
        equipo_local:    f.home.nombre,
        equipo_visitante:f.away.nombre,
        status:          'pending',
        jugado:          false,
      }));
    } else if (fmt === 'Torneo' || fmt === 'Copa') {
      // Agrupar equipos por grupo
      const grupos = teams.reduce((acc, t) => {
        const g = t.grupo ?? 'A';
        acc[g]  = [...(acc[g] ?? []), t];
        return acc;
      }, {});
      const groupFixtures = generateGroupStageFixture(grupos);
      fixtures = groupFixtures.map((f, idx) => ({
        event_id:        eventId,
        jornada:         idx + 1,
        round:           f.round,
        fase:            'grupos',
        grupo:           f.grupo,
        team_home_id:    f.home.id,
        team_away_id:    f.away.id,
        equipo_local:    f.home.nombre,
        equipo_visitante:f.away.nombre,
        status:          'pending',
        jugado:          false,
      }));
      // Agregar llaves knockout como placeholders
      const knockouts = generateKnockoutBracket({
        numGroups:        event?.num_grupos,
        teamsPerGroup:    event?.equipos_por_grupo,
        tieneOctavos:     event?.tiene_octavos,
        tieneCuartos:     event?.tiene_cuartos,
        tieneSemis:       event?.tiene_semis,
        tieneTercerLugar: event?.tiene_tercer_lugar,
        tieneFinal:       event?.tiene_final,
        idaYVuelta:       idaYVuelta,
      });
      const lastJornada = fixtures.length;
      knockouts.forEach((k, i) => {
        fixtures.push({
          event_id:        eventId,
          jornada:         lastJornada + i + 1,
          round:           i + 1,
          fase:            k.fase,
          equipo_local:    k.equipo_local,
          equipo_visitante:k.equipo_visitante,
          status:          'pending',
          jugado:          false,
        });
      });
    } else {
      // Eliminación directa
      const gen = generateRoundRobin(teams);
      fixtures  = gen.map(f => ({
        event_id:        eventId,
        jornada:         f.round,
        round:           f.round,
        fase:            'eliminacion',
        team_home_id:    f.home.id,
        team_away_id:    f.away.id,
        equipo_local:    f.home.nombre,
        equipo_visitante:f.away.nombre,
        status:          'pending',
        jugado:          false,
      }));
    }

    const { error } = await supabase.from('matches').insert(fixtures);
    if (error) { Alert.alert('Error', error.message); return; }
    loadAll();
    Alert.alert('⚡ Fixture generado', `${fixtures.length} partidos creados.`);
  }

  // ── Guardar resultado ──
  async function saveResult(match) {
    // BUG FIX: double-submit guard — prevents double-tap and re-saving finished matches
    if (savingMatch === match.id) return;
    if (match.status === 'finished') {
      Alert.alert('Ya registrado', 'Este partido ya tiene resultado. No se puede registrar dos veces.'); return;
    }
    const { home, away } = scores[match.id] ?? {};
    if (home === undefined || home === '' || away === undefined || away === '') {
      Alert.alert('Error', 'Ingresa los goles de ambos equipos.'); return;
    }
    const gh = parseInt(home, 10);
    const ga = parseInt(away, 10);
    // NaN check — parseInt("abc") = NaN, pasa el check de undefined/""
    if (isNaN(gh) || isNaN(ga) || gh < 0 || ga < 0) {
      Alert.alert('Error', 'Ingresa un número válido (0 o más) para cada equipo.'); return;
    }
    setSavingMatch(match.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('matches').update({
        goles_home: gh, goles_away: ga,
        goles_local: gh, goles_visitante: ga,
        status: 'finished', jugado: true,
        finished_at: now,
      }).eq('id', match.id).neq('status', 'finished'); // extra guard: don't overwrite finished
      if (error) { Alert.alert('Error', error.message); return; }

      setScores((s) => { const n = { ...s }; delete n[match.id]; return n; });
      loadAll();
      // Nota: standings se calculan automáticamente via VIEW en Supabase
      Alert.alert('✓ Guardado', `${match.home?.nombre ?? match.equipo_local} ${gh} - ${ga} ${match.away?.nombre ?? match.equipo_visitante}`);
    } finally {
      setSavingMatch(null);
    }
  }

  // ── Abrir votación MVP del evento ──
  async function openMvpVoting() {
    const closesAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('events').update({ mvp_voting_open: true, mvp_closes_at: closesAt }).eq('id', eventId);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('✅ Votación abierta', 'Los jugadores pueden votar por el MVP del evento por 2 horas.');
    loadAll();
  }

  // ── Cerrar votación y declarar MVP del evento ──
  async function closeMvp() {
    if (!mvpTotalVotes) { Alert.alert('Sin votos', 'No hay votos registrados para este evento.'); return; }

    const tally     = mvpVotesByPlayer;
    const sorted    = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const maxVotos  = sorted[0][1];
    const empatados = sorted.filter(([, v]) => v === maxVotos);
    const [winnerId, winnerVotes] = empatados[Math.floor(Math.random() * empatados.length)];

    // Insert with event_id — unique index prevents double-award
    const { error: mvpErr } = await supabase.from('mvp_results').insert({
      event_id:      eventId,
      user_id:       winnerId,
      votos_totales: winnerVotes,
      premio_wallet: 1.00,
      premio_pagado: true,
    });
    if (mvpErr) {
      if (mvpErr.code === '23505') {
        Alert.alert('Ya declarado', 'El MVP de este evento ya fue registrado.');
      } else {
        Alert.alert('Error', mvpErr.message);
      }
      loadAll();
      return;
    }

    // Close voting on event
    const { error: closeErr } = await supabase.from('events').update({ mvp_voting_open: false }).eq('id', eventId);
    if (closeErr) console.warn('closeMvp: could not close voting flag:', closeErr.message);

    // Atomic wallet credit via RPC
    try {
      await supabase.rpc('credit_wallet', {
        p_user_id:     winnerId,
        p_monto:       1.00,
        p_tipo:        'mvp_premio',
        p_descripcion: 'Premio MVP del evento',
      });
    } catch (e) {
      console.warn('credit_wallet error (MVP insertado):', e.message);
    }

    const winner = (players ?? []).find((p) => p.user_id === winnerId);
    loadAll();
    Alert.alert('🏆 MVP Declarado', `${winner?.users?.nombre ?? 'Jugador'} — ${winnerVotes} votos. +$1.00 acreditado.`);
  }

  async function toggleStatus(field, value) {
    if (field === 'status') {
      // BUG FIX: prevent backward status transitions (e.g. finished → draft)
      const STATUS_ORDER = { draft: 0, open: 1, active: 2, finished: 3, cancelled: 4 };
      const currentOrder = STATUS_ORDER[event?.status] ?? -1;
      const nextOrder    = STATUS_ORDER[value] ?? -1;
      if (nextOrder < currentOrder && value !== 'draft') {
        // Allow draft ↔ open only, otherwise block backward movement
        Alert.alert('Transición inválida', `No se puede cambiar de "${event?.status}" a "${value}".`);
        return;
      }

      if (value === 'finished') {
        const newsTitle = `🏁 ${event?.nombre} — Evento Finalizado`;
        const newsBody  = `El evento "${event?.nombre}" ha concluido. Revisa los resultados y la tabla de posiciones.`;
        await supabase.from('news').insert({
          titulo:    newsTitle,
          contenido: newsBody,
          tipo:      'resultados',
        }).catch(() => {});
        sendLocalNotification(newsTitle, newsBody);
        const finishedAt = new Date().toISOString();
        await supabase.from('events').update({ status: value, event_finished_at: finishedAt }).eq('id', eventId);
        setEvent((e) => ({ ...e, status: value, event_finished_at: finishedAt }));
        return;
      }
      await supabase.from('events').update({ status: value }).eq('id', eventId);
      setEvent((e) => ({ ...e, status: value }));
      return;
    }
    await supabase.from('events').update({ [field]: value }).eq('id', eventId);
    setEvent((e) => ({ ...e, [field]: value }));
  }

  const pendingMatches  = matches.filter((m) => m.status !== 'finished');
  const finishedMatches = matches.filter((m) => m.status === 'finished');
  const byJornada       = matches.reduce((acc, m) => { const k = m.jornada ?? 1; acc[k] = [...(acc[k] ?? []), m]; return acc; }, {});

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection:'row', alignItems:'center', gap: SPACING.sm, padding: SPACING.md }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, flex: 1, letterSpacing: 1 }} numberOfLines={1}>{eventNombre}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: SPACING.md, marginBottom: SPACING.sm, maxHeight: 44 }}>
        <View style={{ flexDirection:'row', gap: 8 }}>
          {TABS.map((t) => (
            <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {loading
        ? <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.xl }} />
        : (
          <ScrollView contentContainerStyle={styles.list}>

            {/* ═══ EQUIPOS ═══ */}
            {tab === 'Equipos' && (() => {
              // Jugadores sin equipo (para asignación manual)
              const assignedIds = new Set(teams.flatMap(t => t.team_players?.map(tp => tp.user_id) ?? []));
              const unassigned  = players.filter(p => !assignedIds.has(p.user_id));
              return (
                <>
                  {/* Acciones globales */}
                  <View style={styles.btnRow}>
                    <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue }]} onPress={createAutoTeams}>
                      <Text style={styles.btnText}>🎨 Crear equipos</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.purple ?? COLORS.blue }]}
                      onPress={() => {
                        if (event?.genero === 'Mixto') setMixedModal(true);
                        else autoAssign(0);
                      }}>
                      <Text style={styles.btnText}>🎲 Asignar aleatoria</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Resumen */}
                  <View style={[styles.card, { flexDirection:'row', flexWrap:'wrap', gap: SPACING.sm }]}>
                    <Text style={styles.cardSub}>👥 {players.length} inscritos</Text>
                    <Text style={styles.cardSub}>🏟 {teams.length} equipos</Text>
                    {event?.jugadores_por_equipo && <Text style={styles.cardSub}>⚽ {event.jugadores_por_equipo}v{event.jugadores_por_equipo}</Text>}
                    {unassigned.length > 0 && <Text style={[styles.cardSub, { color: COLORS.gold }]}>⚠️ {unassigned.length} sin equipo</Text>}
                  </View>

                  {teams.length === 0 && <Text style={styles.empty}>Sin equipos. Usa "Crear equipos" primero.</Text>}

                  {/* Lista de equipos con edición */}
                  {teams.map((t) => (
                    <View key={t.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: t.color ?? COLORS.blue }]}>
                      {/* Cabecera del equipo */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: t.color ?? COLORS.blue }} />
                        <Text style={[styles.cardName, { flex: 1 }]}>{t.nombre}</Text>
                        {t.grupo && (
                          <View style={{ backgroundColor: COLORS.navy, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ color: COLORS.white, fontFamily: FONTS.bodyBold, fontSize: 11 }}>GRP {t.grupo}</Text>
                          </View>
                        )}
                        <Text style={styles.cardSub}>{t.team_players?.length ?? 0} jug.</Text>
                        {/* Botón editar */}
                        <TouchableOpacity
                          style={[styles.btnSmall, { backgroundColor: COLORS.blue + '40' }]}
                          onPress={() => { setEditTeamModal(t); setEditTeamForm({ nombre: t.nombre, color: t.color ?? '' }); }}
                        >
                          <Text style={styles.btnSmallText}>✏️</Text>
                        </TouchableOpacity>
                        {/* Botón eliminar */}
                        <TouchableOpacity
                          style={[styles.btnSmall, { backgroundColor: COLORS.red + '40' }]}
                          onPress={() => deleteTeam(t)}
                        >
                          <Text style={styles.btnSmallText}>🗑</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Jugadores del equipo con botón de quitar */}
                      {(t.team_players?.length ?? 0) === 0
                        ? <Text style={[styles.cardSub, { paddingLeft: 24, fontStyle:'italic' }]}>Sin jugadores asignados</Text>
                        : t.team_players?.map((tp) => (
                          <View key={tp.user_id} style={{ flexDirection:'row', alignItems:'center', paddingLeft: 24, paddingVertical: 2 }}>
                            <Text style={[styles.cardSub, { flex: 1, color: COLORS.gray2 }]}>
                              {tp.users?.nombre} {tp.users?.genero === 'Femenino' ? '♀' : ''}
                            </Text>
                            <TouchableOpacity
                              style={{ paddingHorizontal: 8, paddingVertical: 2 }}
                              onPress={() => removePlayerFromTeam(t.id, tp.user_id)}
                            >
                              <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyBold, fontSize: 14 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))
                      }
                    </View>
                  ))}

                  {/* Jugadores sin equipo — asignación individual */}
                  {unassigned.length > 0 && (
                    <View style={styles.card}>
                      <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: SPACING.sm }]}>
                        ⚠️ Jugadores sin equipo ({unassigned.length})
                      </Text>
                      {unassigned.map((p) => (
                        <View key={p.user_id}>
                          <View style={{ flexDirection:'row', alignItems:'center', paddingVertical: 4 }}>
                            <Text style={[styles.cardSub, { flex: 1 }]}>
                              {p.users?.nombre} {p.users?.genero === 'Femenino' ? '♀' : ''}
                            </Text>
                            <TouchableOpacity
                              style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]}
                              onPress={() => setAssignExpanded(assignExpanded === p.user_id ? null : p.user_id)}
                            >
                              <Text style={styles.btnSmallText}>{assignExpanded === p.user_id ? '▲' : '+ Equipo'}</Text>
                            </TouchableOpacity>
                          </View>
                          {/* Selector de equipo para asignar */}
                          {assignExpanded === p.user_id && teams.length > 0 && (
                            <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 6, paddingLeft: 8, paddingBottom: 4 }}>
                              {teams.map((t) => (
                                <TouchableOpacity
                                  key={t.id}
                                  style={{ flexDirection:'row', alignItems:'center', gap: 4, backgroundColor: t.color + '30', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.color ?? COLORS.navy }}
                                  onPress={() => assignPlayerToTeam(t.id, p.user_id)}
                                >
                                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? COLORS.blue }} />
                                  <Text style={{ fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white }}>{t.nombre}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </>
              );
            })()}

            {/* ═══ PARTIDOS ═══ */}
            {tab === 'Partidos' && (
              <>
                <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue, marginBottom: SPACING.md }]} onPress={generateFixture}>
                  <Text style={styles.btnText}>⚡ Generar fixture automático</Text>
                </TouchableOpacity>
                {Object.keys(byJornada).length === 0 && <Text style={styles.empty}>Sin partidos. Genera el fixture primero.</Text>}
                {Object.entries(byJornada).map(([jornada, jMatches]) => (
                  <View key={jornada}>
                    <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: 4 }]}>
                      {jMatches[0]?.fase === 'final' ? '🏆 FINAL'
                        : jMatches[0]?.fase === 'semis' ? '🥊 SEMIFINALES'
                        : jMatches[0]?.fase === 'cuartos' ? '⚔️ CUARTOS'
                        : jMatches[0]?.fase === 'octavos' ? '⚔️ OCTAVOS'
                        : jMatches[0]?.fase === 'tercer_lugar' ? '🥉 3ER LUGAR'
                        : `JORNADA ${jornada}${jMatches[0]?.grupo ? ` · GRP ${jMatches[0].grupo}` : ''}`
                      }
                    </Text>
                    {jMatches.map((m) => (
                      <View key={m.id} style={[styles.card, { marginBottom: SPACING.sm }]}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {m.home?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.home.color }} />}
                            <Text style={[styles.cardSub, { flex: 1 }]}>{m.home?.nombre ?? m.equipo_local}</Text>
                          </View>
                          <Text style={[styles.cardName, { color: m.status === 'finished' ? COLORS.gold : COLORS.gray, marginHorizontal: 8 }]}>
                            {m.status === 'finished' ? `${m.goles_home} - ${m.goles_away}` : 'vs'}
                          </Text>
                          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                            <Text style={[styles.cardSub, { textAlign:'right' }]}>{m.away?.nombre ?? m.equipo_visitante}</Text>
                            {m.away?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.away.color }} />}
                          </View>
                        </View>
                        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: m.status === 'finished' ? COLORS.green : COLORS.gray, textAlign:'center', marginTop: 4 }}>
                          {m.status === 'finished' ? '✓ Jugado' : 'Pendiente'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            )}

            {/* ═══ RESULTADOS ═══ */}
            {tab === 'Resultados' && (
              <>
                {pendingMatches.length === 0 && <Text style={styles.empty}>✓ Todos los partidos han sido registrados.</Text>}
                {pendingMatches.map((m) => (
                  <View key={m.id} style={styles.card}>
                    <Text style={[styles.cardSub, { marginBottom: SPACING.sm }]}>
                      {m.fase === 'final' ? '🏆 FINAL' : m.fase === 'semis' ? '🥊 SEMI' : `Jornada ${m.jornada}`}
                      {m.grupo ? ` · Grp ${m.grupo}` : ''}
                    </Text>
                    <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap: SPACING.sm }}>
                      <Text style={[styles.cardName, { flex: 1, textAlign:'center', fontSize: 13 }]}>{m.home?.nombre ?? m.equipo_local}</Text>
                      <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 24, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={scores[m.id]?.home ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], home: v } }))} />
                      <Text style={[styles.cardName, { color: COLORS.gray }]}>:</Text>
                      <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 24, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={scores[m.id]?.away ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], away: v } }))} />
                      <Text style={[styles.cardName, { flex: 1, textAlign:'center', fontSize: 13 }]}>{m.away?.nombre ?? m.equipo_visitante}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: COLORS.green + 'CC', marginTop: SPACING.sm, opacity: savingMatch === m.id ? 0.6 : 1 }]}
                      onPress={() => saveResult(m)}
                      disabled={savingMatch === m.id}
                    >
                      {savingMatch === m.id
                        ? <ActivityIndicator color={COLORS.white} size="small" />
                        : <Text style={styles.btnText}>✓ Guardar resultado</Text>
                      }
                    </TouchableOpacity>
                  </View>
                ))}
                {finishedMatches.length > 0 && (
                  <>
                    <Text style={[styles.cardSub, { marginTop: SPACING.md, marginBottom: 4, color: COLORS.green }]}>REGISTRADOS ({finishedMatches.length})</Text>
                    {finishedMatches.map((m) => (
                      <View key={m.id} style={[styles.card, { borderColor: COLORS.green + '40' }]}>
                        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                          <Text style={[styles.cardSub, { flex: 1 }]}>{m.home?.nombre ?? m.equipo_local}</Text>
                          <Text style={[styles.cardName, { color: COLORS.gold, marginHorizontal: 8 }]}>{m.goles_home} - {m.goles_away}</Text>
                          <Text style={[styles.cardSub, { flex: 1, textAlign:'right' }]}>{m.away?.nombre ?? m.equipo_visitante}</Text>
                        </View>
                        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.green, textAlign:'center', marginTop: 4 }}>✓ Jornada {m.jornada}</Text>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}

            {/* ═══ MVP ═══ */}
            {tab === 'MVP' && (() => {
              const votingOpen = event?.mvp_voting_open && !mvpResult;
              const closesAt   = event?.mvp_closes_at ? new Date(event.mvp_closes_at) : null;
              const expired    = closesAt && closesAt < new Date();
              const countdown  = closesAt && !expired
                ? Math.max(0, Math.ceil((closesAt - new Date()) / 60000))
                : 0;
              return (
                <View style={styles.card}>
                  <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>🏆 MVP DEL EVENTO</Text>

                  {mvpResult ? (
                    // Winner declared
                    <View style={{ backgroundColor: COLORS.gold + '20', borderRadius: RADIUS.sm, padding: SPACING.md }}>
                      <Text style={[styles.cardName, { color: COLORS.gold }]}>🥇 {mvpResult.users?.nombre}</Text>
                      <Text style={styles.cardSub}>{mvpResult.votos_totales} votos · +${mvpResult.premio_wallet} acreditado</Text>
                    </View>
                  ) : votingOpen ? (
                    // Voting in progress
                    <>
                      <Text style={[styles.cardSub, { color: COLORS.green }]}>✅ Votación abierta</Text>
                      <Text style={[styles.cardSub, { color: expired ? COLORS.red : COLORS.blue2 }]}>
                        {expired ? '⏰ Tiempo expirado — listo para cerrar' : `⏱ Cierra en ${countdown} min`}
                      </Text>
                      <Text style={[styles.cardSub, { color: COLORS.gold, marginTop: 4 }]}>
                        ⚡ {mvpTotalVotes} voto(s) recibidos
                      </Text>
                      {/* Top candidates */}
                      {Object.entries(mvpVotesByPlayer)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([uid, cnt]) => {
                          const p = players.find(pl => pl.user_id === uid);
                          return (
                            <View key={uid} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical: 2 }}>
                              <Text style={styles.cardSub}>{p?.users?.nombre ?? 'Jugador'}</Text>
                              <Text style={[styles.cardSub, { color: COLORS.gold }]}>{cnt} voto{cnt !== 1 ? 's' : ''}</Text>
                            </View>
                          );
                        })
                      }
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: COLORS.gold + 'CC', marginTop: SPACING.sm }]}
                        onPress={closeMvp}
                      >
                        <Text style={styles.btnText}>🏆 Cerrar y declarar MVP</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    // Voting not yet opened
                    <>
                      <Text style={styles.cardSub}>
                        {players.length} jugadores inscritos en el evento son candidatos.
                      </Text>
                      <TouchableOpacity
                        style={[styles.btn, { backgroundColor: COLORS.blue, marginTop: SPACING.sm }]}
                        onPress={openMvpVoting}
                        disabled={event?.status !== 'active' && event?.status !== 'finished'}
                      >
                        <Text style={styles.btnText}>⭐ Abrir votación MVP</Text>
                      </TouchableOpacity>
                      {event?.status !== 'active' && event?.status !== 'finished' && (
                        <Text style={[styles.cardSub, { color: COLORS.red, marginTop: 4 }]}>
                          El evento debe estar activo o finalizado para abrir la votación.
                        </Text>
                      )}
                    </>
                  )}
                </View>
              );
            })()}

            {/* ═══ CONFIG ═══ */}
            {tab === 'Config' && event && (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardName}>{event.nombre}</Text>
                  <Text style={styles.cardSub}>Estado: <Text style={{ color: COLORS.gold }}>{event.status?.toUpperCase()}</Text></Text>
                  <Text style={styles.cardSub}>{event.deporte} · {event.formato} · {event.genero}</Text>
                  <Text style={styles.cardSub}>{event.fecha} · {event.hora?.slice(0,5)} · {event.lugar}</Text>
                  {event.jugadores_por_equipo && <Text style={styles.cardSub}>{event.jugadores_por_equipo}v{event.jugadores_por_equipo}</Text>}
                </View>
                <View style={styles.card}>
                  <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>Cambiar estado</Text>
                  {[
                    { label:'📋 Borrador',            value:'draft',    color: COLORS.gray },
                    { label:'🟢 Abrir inscripciones', value:'open',     color: COLORS.green },
                    { label:'🔴 Iniciar evento',       value:'active',   color: COLORS.magenta },
                    { label:'✓ Finalizar',             value:'finished', color: COLORS.gray },
                  ].map((opt) => (
                    <TouchableOpacity key={opt.value} style={[styles.btn, { backgroundColor: event.status === opt.value ? opt.color : COLORS.navy, marginBottom: 4, opacity: event.status === opt.value ? 1 : 0.7 }]} onPress={() => toggleStatus('status', opt.value)}>
                      <Text style={styles.btnText}>{event.status === opt.value ? '● ' : ''}{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[styles.card, { flexDirection:'row', justifyContent:'space-between', alignItems:'center' }]}>
                  <Text style={styles.cardSub}>Cupos ilimitados</Text>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: event.cupos_ilimitado ? COLORS.green : COLORS.navy }]} onPress={() => toggleStatus('cupos_ilimitado', !event.cupos_ilimitado)}>
                    <Text style={styles.btnSmallText}>{event.cupos_ilimitado ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                </View>
                {/* Visibilidad para jugadores y gestores — auto-oculta 24h tras finalizar */}
                <View style={[styles.card, { flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderColor: event.visible !== false ? COLORS.green + '40' : COLORS.red + '40' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>👁 Visible para jugadores</Text>
                    <Text style={styles.cardSub}>
                      {event.visible !== false
                        ? 'Los jugadores pueden ver este evento'
                        : 'Oculto — los jugadores NO lo ven'}
                    </Text>
                    {event.status === 'finished' && event.event_finished_at && (
                      <Text style={[styles.cardSub, { color: COLORS.gold, marginTop: 2 }]}>
                        Auto-oculta: {new Date(new Date(event.event_finished_at).getTime() + 24*60*60*1000).toLocaleString('es-PA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[styles.btnSmall, { backgroundColor: event.visible !== false ? COLORS.green : COLORS.red }]}
                    onPress={() => toggleStatus('visible', event.visible !== false ? false : true)}
                  >
                    <Text style={styles.btnSmallText}>{event.visible !== false ? 'ON' : 'OFF'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <View style={{ height: SPACING.xxl }} />
          </ScrollView>
        )
      }

      {/* Modal asignación mixta */}
      <Modal visible={mixedModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'center', alignItems: 'center' }}>
          <View style={[styles.card, { width: '80%', borderColor: COLORS.magenta }]}>
            <Text style={[styles.cardName, { color: COLORS.magenta, marginBottom: SPACING.sm }]}>Evento Mixto</Text>
            <Text style={styles.cardSub}>¿Cuántas mujeres por equipo?</Text>
            <View style={styles.chipRow}>
              {['0','1','2','3'].map((n) => (
                <TouchableOpacity key={n} style={[styles.chip, chicasPorEquipo === n && styles.chipActive]} onPress={() => setChicasPorEquipo(n)}>
                  <Text style={[styles.chipText, chicasPorEquipo === n && { color: COLORS.white }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.btnRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.gray + '40' }]} onPress={() => setMixedModal(false)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue }]} onPress={() => { setMixedModal(false); autoAssign(parseInt(chicasPorEquipo)); }}>
                <Text style={styles.btnText}>✓ Asignar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal editar equipo (nombre + color) */}
      <Modal visible={!!editTeamModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <View style={[styles.modalHeader, { borderBottomColor: (editTeamForm.color || COLORS.blue) + '80', backgroundColor: (editTeamForm.color || COLORS.blue) + '20' }]}>
              <Text style={[styles.modalTitle, { color: editTeamForm.color || COLORS.blue }]}>✏️ Editar equipo</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Nombre del equipo</Text>
              <TextInput
                style={styles.modalInput}
                value={editTeamForm.nombre}
                onChangeText={(v) => setEditTeamForm(f => ({ ...f, nombre: v }))}
                placeholder="Nombre del equipo"
                placeholderTextColor={COLORS.gray}
                autoFocus
              />
              <Text style={[styles.modalSubtitle, { marginTop: SPACING.sm }]}>Color</Text>
              <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 8, marginTop: 6 }}>
                {TEAM_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c.color}
                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.color, borderWidth: editTeamForm.color === c.color ? 3 : 1, borderColor: editTeamForm.color === c.color ? COLORS.white : COLORS.navy }}
                    onPress={() => setEditTeamForm(f => ({ ...f, color: c.color }))}
                  />
                ))}
              </View>
              <View style={{ flexDirection:'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.navy, flex: 1 }]}
                  onPress={() => setEditTeamModal(null)}
                >
                  <Text style={styles.modalBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: editTeamForm.color || COLORS.blue, flex: 1 }]}
                  onPress={saveTeamEdit}
                  disabled={!editTeamForm.nombre.trim()}
                >
                  <Text style={styles.modalBtnText}>✓ Guardar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RECARGAS YAPPY (admin approval queue)
// ═══════════════════════════════════════════════════════════════════
function AdminRecargas() {
  const { user } = useAuthStore();
  const [recargas,     setRecargas]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [processing,   setProcessing]   = useState(null); // id being processed
  const [rejectModal,  setRejectModal]  = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { fetchRecargas(); }, []);

  async function fetchRecargas() {
    setLoading(true);
    const { data } = await supabase
      .from('pending_recargas')
      .select('*, user:users!user_id(nombre, correo)')
      .order('created_at', { ascending: true });
    setRecargas(data ?? []);
    setLoading(false);
  }

  async function callApprove(id, action, notas = null) {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) { Alert.alert('Error', 'Sesión expirada'); return; }

    const res = await fetch(`${FUNCTIONS_URL}/yappy-admin-approve`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        ANON_KEY,
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ id, action, notas }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Error HTTP ${res.status}`);
    return json;
  }

  async function approve(r) {
    setProcessing(r.id);
    try {
      await callApprove(r.id, 'approve');
      fetchRecargas();
      Alert.alert('✅ Aprobada', `Se acreditaron $${Number(r.amount_credito).toFixed(2)} a ${r.user?.nombre}.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function confirmReject() {
    if (!rejectReason.trim()) { Alert.alert('Requerido', 'Escribe una razón'); return; }
    const r = rejectModal;
    setRejectModal(null);
    setProcessing(r.id);
    try {
      await callApprove(r.id, 'reject', rejectReason.trim());
      setRejectReason('');
      fetchRecargas();
      Alert.alert('Rechazada', `Recarga de ${r.user?.nombre} rechazada.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  const STATUS_COLOR = { pending: COLORS.gold, approved: COLORS.green, rejected: COLORS.red };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>RECARGAS YAPPY</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {recargas.length === 0 && <Text style={styles.empty}>No hay recargas pendientes</Text>}
        {recargas.map((r) => (
          <View key={r.id} style={[styles.card, r.status === 'pending' && { borderColor: COLORS.gold + '44' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{r.user?.nombre ?? '—'}</Text>
                <Text style={styles.cardSub}>{r.user?.correo}</Text>
                {r.tier_label && <Text style={[styles.cardSub, { color: COLORS.white + 'AA' }]}>{r.tier_label}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.walletBalance, { fontSize: 20 }]}>${Number(r.amount_credito).toFixed(2)}</Text>
                {r.amount_credito !== r.amount_paid && (
                  <Text style={[styles.cardSub, { color: COLORS.gray }]}>pagó ${Number(r.amount_paid).toFixed(2)}</Text>
                )}
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[r.status] ?? COLORS.gray) + '33', marginTop: 4 }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLOR[r.status] ?? COLORS.gray }]}>
                    {r.status.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.cardSub}>
              {new Date(r.created_at).toLocaleString('es-PA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Text>
            {r.notas && <Text style={[styles.cardSub, { fontStyle: 'italic' }]}>{r.notas}</Text>}
            {r.status === 'pending' && (
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: COLORS.green + 'CC', opacity: processing === r.id ? 0.5 : 1 }]}
                  onPress={() => approve(r)}
                  disabled={!!processing}
                >
                  {processing === r.id
                    ? <ActivityIndicator color={COLORS.white} size="small" />
                    : <Text style={styles.btnText}>✓ Aprobar</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: COLORS.red + 'CC', opacity: processing === r.id ? 0.5 : 1 }]}
                  onPress={() => { setRejectReason(''); setRejectModal(r); }}
                  disabled={!!processing}
                >
                  <Text style={styles.btnText}>✗ Rechazar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={!!rejectModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✗ Rechazar recarga</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Usuario</Text>
              <Text style={styles.modalValue}>{rejectModal?.user?.nombre}</Text>
              <Text style={[styles.modalSubtitle, { marginTop: SPACING.sm }]}>Razón *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Motivo del rechazo..."
                placeholderTextColor={COLORS.gray}
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.navy, flex: 1 }]} onPress={() => setRejectModal(null)}>
                  <Text style={styles.modalBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.red, flex: 1, opacity: rejectReason.trim() ? 1 : 0.5 }]}
                  onPress={confirmReject}
                  disabled={!rejectReason.trim()}
                >
                  <Text style={styles.modalBtnText}>✗ Rechazar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STACK NAVIGATOR
// ═══════════════════════════════════════════════════════════════════
export default function AdminPanel() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminDashboard"   component={AdminDashboard} />
      <Stack.Screen name="AdminRequests"    component={AdminRequests} />
      <Stack.Screen name="AdminRecargas"    component={AdminRecargas} />
      <Stack.Screen name="AdminUsers"       component={AdminUsers} />
      <Stack.Screen name="AdminWallets"     component={AdminWallets} />
      <Stack.Screen name="AdminInventory"   component={AdminInventory} />
      <Stack.Screen name="AdminEvents"      component={AdminEvents} />
      <Stack.Screen name="AdminOrders"      component={AdminOrders} />
      <Stack.Screen name="AdminManageEvent" component={AdminManageEvent} />
    </Stack.Navigator>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function StatCard({ label, value, icon, color }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={[styles.statVal, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.bg },
  title:         { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },
  statsGrid:     { flexDirection:'row', flexWrap:'wrap', gap: SPACING.sm, padding: SPACING.md },
  statCard:      { width:'47%', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems:'center', borderWidth: 1, borderColor: COLORS.navy },
  statIcon:      { fontSize: 24, marginBottom: 4 },
  statVal:       { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white },
  statLabel:     { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  sectionTitle:  { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  menuGrid:      { flexDirection:'row', flexWrap:'wrap', gap: SPACING.sm, padding: SPACING.md },
  menuCard:      { width:'30%', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems:'center', borderWidth: 1, borderColor: COLORS.navy, position:'relative' },
  menuIcon:      { fontSize: 28, marginBottom: SPACING.sm },
  menuLabel:     { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white, textAlign: 'center' },
  badge:         { position:'absolute', top: 8, right: 8, backgroundColor: COLORS.red, borderRadius: 10, minWidth: 20, height: 20, alignItems:'center', justifyContent:'center' },
  badgeText:     { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white },
  list:          { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl },
  card:          { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.sm },
  cardName:      { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  cardSub:       { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  btnRow:        { flexDirection:'row', gap: SPACING.sm, flexWrap:'wrap' },
  btn:           { flex: 1, borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems:'center' },
  btnText:       { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  btnSmall:      { paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy },
  btnSmallText:  { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white },
  actionBtn:     { flex: 1, paddingVertical: 8, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, alignItems:'center' },
  actionBtnText: { fontFamily: FONTS.bodyMedium, fontSize: 13 },
  statusBadge:   { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.full },
  statusText:    { fontFamily: FONTS.bodyBold, fontSize: 11 },
  roleBadge:     { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: RADIUS.full },
  roleText:      { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.white },
  walletBalance: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gold },
  totalCard:     { backgroundColor: COLORS.card, margin: SPACING.md, borderRadius: RADIUS.md, padding: SPACING.md, alignItems:'center', borderWidth: 1, borderColor: COLORS.gold + '40' },
  totalLabel:    { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gray, letterSpacing: 1 },
  totalVal:      { fontFamily: FONTS.heading, fontSize: 36, color: COLORS.gold },
  tabBtn:        { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy },
  tabBtnActive:  { backgroundColor: COLORS.blue },
  tabBtnText:    { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray },
  tabBtnTextActive:{ color: COLORS.white },
  input:         { backgroundColor: COLORS.card, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.white, fontFamily: FONTS.body, fontSize: 14, borderWidth: 1, borderColor: COLORS.navy },
  fieldLabel:    { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 12, marginBottom: 2 },
  chipRow:       { flexDirection:'row', flexWrap:'wrap', gap: 8, marginBottom: SPACING.sm },
  chip:          { paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.navy },
  chipActive:    { backgroundColor: COLORS.blue, borderColor: COLORS.blue2 },
  chipText:      { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 },
  checkRow:      { flexDirection:'row', alignItems:'center', gap: SPACING.sm, paddingVertical: 4 },
  check:         { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: COLORS.gray },
  checkActive:   { backgroundColor: COLORS.blue, borderColor: COLORS.blue2 },
  checkLabel:    { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  empty:         { fontFamily: FONTS.body, color: COLORS.gray, textAlign:'center', padding: SPACING.lg },

  // ── Reject / generic modal ──────────────────────────────────────────────
  overlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: SPACING.lg },
  modalBox:      { backgroundColor: COLORS.card, borderRadius: RADIUS.md, width: '100%', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.red + '50', elevation: 10 },
  modalHeader:   { backgroundColor: COLORS.red + '20', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.red + '40' },
  modalTitle:    { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.red, letterSpacing: 1 },
  modalBody:     { padding: SPACING.md, gap: 4 },
  modalSubtitle: { fontFamily: FONTS.bodyMedium, fontSize: 11, color: COLORS.gray, letterSpacing: 0.5, textTransform: 'uppercase' },
  modalValue:    { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  modalInput:    { backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.white, fontFamily: FONTS.body, fontSize: 14, borderWidth: 1, borderColor: COLORS.red + '50', minHeight: 90, marginTop: 6 },
  modalBtn:      { borderRadius: RADIUS.sm, paddingVertical: SPACING.sm, alignItems: 'center' },
  modalBtnText:  { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white },
});
