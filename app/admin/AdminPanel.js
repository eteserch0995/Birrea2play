import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Image, Modal,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { createStackNavigator } from '@react-navigation/stack';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import Constants from 'expo-constants';

const APP_VERSION = Constants.expoConfig?.version ?? Constants.manifest?.version ?? '1.1.3';
const BUILD_NUMBER = Constants.nativeBuildVersion ?? '14';
import { supabase } from '../../lib/supabase';
import { getScoringTerms } from '../../lib/sportTerms';
import { sendLocalNotification, broadcastNotification } from '../../lib/notifications';
import useAuthStore from '../../store/authStore';
import { DateField, TimeField } from '../../components/DateTimeField';
import { uploadImage } from '../../lib/uploadImage';
import { filterActiveEventGuests } from '../../lib/eventGuests';
import {
  TEAM_COLORS, WC_SELECCIONES, flagUrl, generateLigaFixture, generateGroupStageFixture,
  generateKnockoutBracket, calcTeams, generateRoundRobin,
  isGroupStageComplete, computeStandingsFromMatches, detectGroupTiesNeedingDecision,
  getQualifiedTeams, populateKnockoutFromGroups, populateNextKnockoutPhase, freeLabel,
} from '../../lib/eventHelpers';
import TeamMark from '../../components/TeamMark';
import CanchaCostoPicker from '../../components/CanchaCostoPicker';
import GananciaCard      from '../../components/GananciaCard';
import MatchTimer        from '../../components/MatchTimer';
import WCAdminPanel          from './WCAdminPanel';
import ClubAdminPanel        from './ClubAdminPanel';
import AdminQRScannerScreen  from './AdminQRScannerScreen';
import { useCameraPermission } from '../../hooks/useCameraPermission';
import CameraPermissionModal   from '../../components/CameraPermissionModal';
import CameraGate              from '../../components/CameraGate';
import SocialPreviewLauncher   from '../../components/social/SocialPreviewLauncher';

const Stack = createStackNavigator();

const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function AdminDashboard({ navigation }) {
  const [stats, setStats]   = useState({ users: 0, events: 0, requests: 0, walletTotal: 0, orders: 0, pendingRecargas: 0, cashPending: 0 });
  const [loading, setLoading] = useState(true);
  const [pwaGate, setPwaGate]         = useState(true);
  const [pwaStats, setPwaStats]       = useState({ installed: 0, withPush: 0 });
  const [togglingGate, setTogglingGate] = useState(false);

  const toggleGate = async (val) => {
    setTogglingGate(true);
    try {
      await supabase.rpc('set_pwa_gate_active', { p_active: val });
      setPwaGate(val);
    } catch (e) { Alert.alert('Error', e.message); }
    finally { setTogglingGate(false); }
  };

  useEffect(() => {
    async function load() {
      try {
        // Expirar pendientes vencidas antes de contar (fire-and-forget)
        Promise.resolve(supabase.rpc('expire_pending_cash_requests')).catch(() => {});
        Promise.resolve(supabase.rpc('expire_pending_guests')).catch(() => {});

        const nowIso = new Date().toISOString();
        const [
          { count: users },
          { count: events },
          { count: requests },
          { data: wallets },
          { count: orders },
          { count: pendingRecargas },
          { count: cashPending },
          { count: genderPending },
          { data: appConfig },
          { count: installed },
          { count: withPush },
        ] = await Promise.all([
          supabase.from('users').select('*', { count: 'exact', head: true }),
          supabase.from('events').select('*', { count: 'exact', head: true }).in('status', ['open', 'active']),
          supabase.from('gestor_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('wallets').select('balance'),
          supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
          supabase.from('pending_recargas').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('cash_payment_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending').gt('expires_at', nowIso),
          supabase.from('gender_change_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('app_config').select('pwa_gate_active').eq('id', 1).maybeSingle(),
          supabase.from('users').select('*', { count: 'exact', head: true }).not('pwa_bonus_granted_at', 'is', null),
          supabase.from('users').select('*', { count: 'exact', head: true }).not('web_push_subs', 'eq', '[]'),
        ]);
        const walletTotal = wallets?.reduce((s, w) => s + (w.balance ?? 0), 0) ?? 0;
        setStats({ users: users ?? 0, events: events ?? 0, requests: requests ?? 0, walletTotal, orders: orders ?? 0, pendingRecargas: pendingRecargas ?? 0, cashPending: cashPending ?? 0, genderPending: genderPending ?? 0 });
        setPwaGate(appConfig?.pwa_gate_active ?? true);
        setPwaStats({ installed: installed ?? 0, withPush: withPush ?? 0 });
      } catch (e) {
        console.warn('AdminDashboard load error:', e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const sections = [
    { label: 'Escanear QR', icon: '📷', route: 'AdminQRScanner', highlight: true },
    { label: 'Solicitudes', icon: '📋', route: 'AdminRequests',      badge: stats.requests },
    { label: 'Cambio género', icon: '⚧', route: 'AdminGenderRequests', badge: stats.genderPending },
    { label: 'Recargas',    icon: '💳', route: 'AdminRecargas',      badge: stats.pendingRecargas },
    { label: 'Efectivo',    icon: '💵', route: 'AdminCashApprovals', badge: stats.cashPending },
    { label: 'Cobro efectivo', icon: '🧾', route: 'AdminCashCobro' },
    { label: 'Usuarios',    icon: '👥', route: 'AdminUsers' },
    { label: 'Créditos',    icon: '💰', route: 'AdminWallets' },
    { label: 'Inventario',  icon: '🛒', route: 'AdminInventory' },
    { label: 'Eventos',     icon: '📅', route: 'AdminEvents' },
    { label: 'Rotaciones',  icon: '⏱', route: 'Rotaciones' },
    { label: 'Órdenes',     icon: '📦', route: 'AdminOrders',        badge: stats.orders },
    { label: 'Noticias',    icon: '📢', route: 'AdminNews' },
    { label: 'Mundial 2026',icon: '🏆', route: 'AdminMundial' },
    { label: 'Club Birreoso',icon: '🎁', route: 'AdminClub' },
    { label: 'Rifa',         icon: '🎟️', route: 'AdminRaffle' },
    { label: 'Canchas',      icon: '🏟', route: 'AdminCanchas' },
  ];

  const authUser = useAuthStore((s) => s.user);
  const isSuperAdmin = authUser?.is_super_admin || authUser?.correo === 'sbosso0995@gmail.com';

  const {
    granted: cameraGranted,
    webChecking: cameraChecking,
    webDenied: cameraDenied,
    grantWebCamera,
    showModal: showCameraModal,
    isDenied: cameraIsDenied,
    requestWithModal,
    handleModalAllow,
    handleModalSkip,
  } = useCameraPermission();

  useEffect(() => { requestWithModal(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
          <Text style={[styles.title, { flex: 1 }]}>PANEL ADMIN</Text>
          {isSuperAdmin && (
            <View style={{ backgroundColor: COLORS.gold + '22', borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 10, letterSpacing: 0.5 }}>SUPER ADMIN</Text>
            </View>
          )}
        </View>
        <View style={styles.statsGrid}>
          <StatCard label="Usuarios"        value={stats.users}                          icon="👥" />
          <StatCard label="Eventos activos" value={stats.events}                         icon="📅" />
          <StatCard label="Solicitudes"     value={stats.requests}                       icon="📋" color={stats.requests > 0 ? COLORS.gold : undefined} />
          <StatCard label="Créditos total"  value={`$${stats.walletTotal.toFixed(0)}`}   icon="💰" />
          <StatCard label="Órdenes pend."   value={stats.orders}                         icon="📦" color={stats.orders > 0 ? COLORS.gold : undefined} />
          <StatCard label="Recargas pend."  value={stats.pendingRecargas}                icon="💳" color={stats.pendingRecargas > 0 ? COLORS.gold : undefined} />
          <StatCard label="Efectivo pend."  value={stats.cashPending}                    icon="💵" color={stats.cashPending > 0 ? COLORS.gold : undefined} />
        </View>
        {/* ── Gate PWA ── */}
        <View style={styles.gateCard}>
          <View style={styles.gateHeader}>
            <Text style={styles.gateTitle}>📲 Gate de instalación</Text>
            <Switch
              value={pwaGate}
              onValueChange={toggleGate}
              disabled={togglingGate}
              trackColor={{ false: COLORS.line, true: COLORS.neon }}
              thumbColor={COLORS.white}
            />
          </View>
          <Text style={styles.gateDesc}>
            {pwaGate
              ? 'ACTIVO — solo se accede desde la app instalada'
              : 'DESACTIVADO — cualquiera puede entrar desde el browser'}
          </Text>
          <View style={styles.gateStats}>
            <View style={styles.gateStat}>
              <Text style={styles.gateStatNum}>{pwaStats.installed}</Text>
              <Text style={styles.gateStatLabel}>instalaron{'\n'}y reclamaron</Text>
            </View>
            <View style={styles.gateStatDivider} />
            <View style={styles.gateStat}>
              <Text style={styles.gateStatNum}>{pwaStats.withPush}</Text>
              <Text style={styles.gateStatLabel}>con push{'\n'}activo</Text>
            </View>
          </View>
        </View>

        <SocialPreviewLauncher />

        <Text style={styles.sectionTitle}>Acciones rápidas</Text>
        <View style={styles.menuGrid}>
          {sections.map((s) => (
            <TouchableOpacity
              key={s.route}
              style={[styles.menuCard, s.highlight && { borderColor: COLORS.green, borderWidth: 1, backgroundColor: COLORS.green + '14' }]}
              onPress={() => navigation.navigate(s.route)}
            >
              <Text style={styles.menuIcon}>{s.icon}</Text>
              <Text style={[styles.menuLabel, s.highlight && { color: COLORS.green }]}>{s.label}</Text>
              {s.badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{s.badge}</Text></View>}
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: SPACING.sm }} />
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center', paddingBottom: SPACING.md }}>
          v{APP_VERSION} (build {BUILD_NUMBER})
        </Text>
      </ScrollView>

      <CameraPermissionModal
        visible={showCameraModal}
        isDenied={cameraIsDenied}
        onAllow={handleModalAllow}
        onSkip={handleModalSkip}
      />
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES DE GESTOR
// ═══════════════════════════════════════════════════════════════════
function AdminRequests({ navigation }) {
  const [requests,    setRequests]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [processing,  setProcessing]  = useState(null); // req.id mientras procesa
  const [rejectModal, setRejectModal] = useState(null); // null | req object
  const [rejectReason,setRejectReason]= useState('');

  useEffect(() => { fetchRequests(); }, []);

  async function fetchRequests() {
    const { data } = await supabase.from('gestor_requests').select('*, user:users!user_id(nombre, correo)').eq('status', 'pending');
    setRequests(data ?? []);
    setLoading(false);
  }

  async function approve(req) {
    if (processing) return; // guard anti doble-tap
    setProcessing(req.id);
    try {
      const { error: roleErr } = await supabase.from('users').update({ role: 'gestor' }).eq('id', req.user_id);
      if (roleErr) throw roleErr;
      const { error: reqErr } = await supabase.from('gestor_requests').update({ status: 'approved' }).eq('id', req.id);
      if (reqErr) throw reqErr;
      Alert.alert('✅ Aprobado', `${req.user?.nombre} ahora es Gestor.`);
      fetchRequests();
    } catch (e) {
      Alert.alert('Error al aprobar', e?.message ?? 'Intenta nuevamente.');
    } finally {
      setProcessing(null);
    }
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {requests.length === 0 && <Text style={styles.empty}>No hay solicitudes pendientes</Text>}
        {requests.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.cardName}>{r.user?.nombre}</Text>
            <Text style={styles.cardSub}>{r.user?.correo}</Text>
            <Text style={styles.cardSub}>Actividades: {r.actividades_completadas}</Text>
            {r.motivacion && <Text style={[styles.cardSub, { marginTop: 4, fontStyle: 'italic' }]}>"{r.motivacion}"</Text>}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.green + 'CC' }, processing === r.id && { opacity: 0.5 }]}
                onPress={() => approve(r)}
                disabled={!!processing}
              >
                {processing === r.id
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.btnText}>✓ Aprobar</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.red + 'CC' }, processing && { opacity: 0.5 }]}
                onPress={() => openRejectModal(r)}
                disabled={!!processing}
              >
                <Text style={styles.btnText}>✗ Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Modal de rechazo — cross-platform (reemplaza Alert.prompt que es iOS-only) */}
      <Modal visible={!!rejectModal} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// USUARIOS (solo admin puede cambiar roles)
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES DE CAMBIO DE GÉNERO (aprobación manual del admin)
// ═══════════════════════════════════════════════════════════════════
function AdminGenderRequests({ navigation }) {
  const [reqs,      setReqs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [processing,setProcessing]= useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => { fetchReqs(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', fetchReqs);
    return unsub;
  }, [navigation]);

  async function fetchReqs() {
    setLoading(true);
    const { data } = await supabase
      .from('gender_change_requests')
      .select('*, user:users!user_id(id, nombre, correo, genero, foto_url)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    setReqs(data ?? []);
    setLoading(false);
  }

  async function approve(r) {
    setProcessing(r.id);
    try {
      const { error } = await supabase.rpc('approve_gender_change', { p_request_id: r.id });
      if (error) throw error;
      fetchReqs();
      Alert.alert('✅ Aprobado', `${r.user?.nombre}: género cambiado a ${r.new_genero}.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function confirmReject() {
    if (!rejectReason.trim()) { Alert.alert('Requerido', 'Escribe una razón.'); return; }
    const r = rejectModal;
    setProcessing(r.id);
    try {
      const { error } = await supabase
        .from('gender_change_requests')
        .update({ status: 'rejected', razon_rechazo: rejectReason.trim(), resolved_at: new Date().toISOString() })
        .eq('id', r.id);
      if (error) throw error;
      setRejectModal(null);
      setRejectReason('');
      fetchReqs();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>CAMBIO DE GÉNERO</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {reqs.length === 0 && <Text style={styles.empty}>Sin solicitudes pendientes</Text>}
        {reqs.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.cardName}>{r.user?.nombre}</Text>
            <Text style={styles.cardSub}>{r.user?.correo}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Text style={[styles.cardSub, { color: COLORS.gray2 }]}>{r.current_genero ?? '—'}</Text>
              <Text style={{ color: COLORS.gold, fontFamily: FONTS.bodyBold, fontSize: 16 }}>→</Text>
              <Text style={[styles.cardSub, { color: COLORS.green }]}>{r.new_genero}</Text>
            </View>
            {!!r.motivo && (
              <Text style={[styles.cardSub, { marginTop: 4, fontStyle: 'italic' }]}>"{r.motivo}"</Text>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.green + 'CC' }]}
                onPress={() => approve(r)}
                disabled={!!processing}
              >
                {processing === r.id
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.btnText}>✓ Aprobar</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.red + 'CC' }]}
                onPress={() => { setRejectReason(''); setRejectModal(r); }}
                disabled={!!processing}
              >
                <Text style={styles.btnText}>✗ Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!rejectModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: SPACING.md }}>
          <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.lg }}>
            <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, marginBottom: SPACING.sm }}>RECHAZAR SOLICITUD</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline numberOfLines={3}
              placeholder="Razón del rechazo..."
              placeholderTextColor={COLORS.gray}
              style={{ backgroundColor: COLORS.bg, color: COLORS.white, padding: SPACING.sm, borderRadius: RADIUS.sm, fontFamily: FONTS.body, fontSize: 13, borderWidth: 1, borderColor: COLORS.navy, minHeight: 70, textAlignVertical: 'top', marginBottom: SPACING.md }}
            />
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.navy }]} onPress={() => setRejectModal(null)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.red }]} onPress={confirmReject}>
                <Text style={styles.btnText}>Confirmar rechazo</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AdminUsers({ navigation }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('todos'); // 'todos' | 'bots'
  const [deleting, setDeleting] = useState(null);

  const BOT_PATTERNS = [/^test/i, /^bot/i, /^demo/i, /^prueba/i, /^\d+@/, /example\.com$/i, /\.test$/i];
  const isLikelyBot = (u) =>
    !u.correo ||
    BOT_PATTERNS.some(p => p.test(u.correo ?? '')) ||
    BOT_PATTERNS.some(p => p.test(u.nombre ?? ''));

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase
      .from('users')
      .select('id, nombre, telefono, correo, role, genero, created_at, efectivo_bloqueado, efectivo_forzado, wallets(balance)')
      .order('created_at', { ascending: false })
      .limit(300);
    setUsers(data ?? []);
    setLoading(false);
  }

  async function changeRole(u, role) {
    Alert.alert('Cambiar rol', `¿Cambiar el rol de "${u.nombre}" a ${role.toUpperCase()}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Confirmar', onPress: async () => {
        const { error } = await supabase.from('users').update({ role }).eq('id', u.id);
        if (error) { Alert.alert('Error', error.message); return; }
        setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, role } : x));
      }},
    ]);
  }

  async function toggleEfectivoBloqueado(u) {
    const newVal = !u.efectivo_bloqueado;
    Alert.alert(
      newVal ? 'Bloquear efectivo' : 'Habilitar efectivo',
      `¿${newVal ? 'Bloquear' : 'Habilitar'} pago en efectivo para "${u.nombre}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', style: newVal ? 'destructive' : 'default', onPress: async () => {
          const { error } = await supabase.rpc('admin_set_efectivo_bloqueado', { p_user_id: u.id, p_bloqueado: newVal });
          if (error) { Alert.alert('Error', error.message); return; }
          setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, efectivo_bloqueado: newVal } : x));
        }},
      ]
    );
  }

  async function toggleEfectivoForzado(u) {
    const newVal = !u.efectivo_forzado;
    Alert.alert(
      newVal ? 'Forzar efectivo' : 'Quitar forzado',
      newVal
        ? `¿Habilitar el pago en efectivo a "${u.nombre}" aunque no tenga 3 birrias?`
        : `¿Quitar el forzado a "${u.nombre}"? Volverá a regir la regla de 3 birrias.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
          const { error } = await supabase.rpc('admin_set_efectivo_forzado', { p_user_id: u.id, p_forzado: newVal });
          if (error) { Alert.alert('Error', error.message); return; }
          setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, efectivo_forzado: newVal } : x));
        }},
      ]
    );
  }

  async function deleteUser(u) {
    Alert.alert(
      '🗑 Eliminar usuario',
      `¿Eliminar PERMANENTEMENTE a "${u.nombre ?? u.correo}"?\n\nSe borrarán su perfil, créditos, inscripciones y cuenta de acceso. Esta acción NO se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: async () => {
          setDeleting(u.id);
          try {
            const { data: sess } = await supabase.auth.getSession();
            const token = sess?.session?.access_token;
            if (!token) { Alert.alert('Error', 'Sesión expirada'); return; }
            const res = await fetch(`${FUNCTIONS_URL}/admin-delete-user`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ user_id: u.id }),
            });
            const json = await res.json();
            if (!res.ok) { Alert.alert('Error', json.error ?? 'Error desconocido'); return; }
            setUsers((prev) => prev.filter((x) => x.id !== u.id));
          } catch (e) {
            Alert.alert('Error', e.message);
          } finally {
            setDeleting(null);
          }
        }},
      ]
    );
  }

  const base     = filter === 'bots' ? users.filter(isLikelyBot) : users;
  const filtered = base.filter(u =>
    !search ||
    u.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    u.correo?.toLowerCase().includes(search.toLowerCase()) ||
    u.telefono?.toLowerCase().includes(search.toLowerCase())
  );
  const botCount = users.filter(isLikelyBot).length;

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection:'row', alignItems:'center', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { flex:1, marginBottom:0, marginLeft: SPACING.sm }]}>USUARIOS ({users.length})</Text>
      </View>

      {/* Filtro tabs */}
      <View style={{ flexDirection:'row', gap: 8, paddingHorizontal: SPACING.md, marginTop: SPACING.sm }}>
        {[['todos', 'Todos'], ['bots', `⚠️ Posibles bots (${botCount})`]].map(([val, label]) => (
          <TouchableOpacity
            key={val}
            style={[styles.tabBtn, filter === val && styles.tabBtnActive, { flex: 1 }]}
            onPress={() => setFilter(val)}
          >
            <Text style={[styles.tabBtnText, filter === val && styles.tabBtnTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={[styles.input, { margin: SPACING.md, marginBottom: 0 }]}
        placeholder="Buscar por nombre o correo..."
        placeholderTextColor={COLORS.gray}
        value={search}
        onChangeText={setSearch}
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {filtered.length === 0 && <Text style={styles.empty}>{filter === 'bots' ? '✓ Sin posibles bots detectados.' : 'Sin usuarios.'}</Text>}
        {filtered.map((u) => (
          <View key={u.id} style={[styles.card, isLikelyBot(u) && { borderColor: COLORS.gold + '60' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{u.nombre ?? '—'} {isLikelyBot(u) ? '⚠️' : ''}</Text>
                <Text style={styles.cardSub}>📧 {u.correo ?? '(sin correo)'}</Text>
                <Text style={styles.cardSub}>📱 {u.telefono ?? '(sin teléfono)'}</Text>
                <Text style={styles.cardSub}>
                  {u.genero ?? '—'} · Créditos: ${u.wallets?.balance?.toFixed(2) ?? '0.00'}
                </Text>
                <Text style={[styles.cardSub, { fontSize: 10, color: COLORS.gray }]}>
                  Registrado: {u.created_at ? new Date(u.created_at).toLocaleDateString('es-PA') : '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={[styles.roleBadge, { backgroundColor: u.role === 'admin' ? COLORS.purple : u.role === 'gestor' ? COLORS.blue : COLORS.navy }]}>
                  <Text style={styles.roleText}>{u.role?.toUpperCase()}</Text>
                </View>
                {u.efectivo_bloqueado && (
                  <View style={{ backgroundColor: COLORS.red + '33', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: COLORS.red }}>🚫 Bloqueado</Text>
                  </View>
                )}
                {u.efectivo_forzado && !u.efectivo_bloqueado && (
                  <View style={{ backgroundColor: COLORS.gold + '33', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: COLORS.gold }}>⚡ Efectivo forzado</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={[styles.btnRow, { marginTop: SPACING.sm, flexWrap:'wrap' }]}>
              {['player', 'gestor', 'cancha_admin', 'admin'].filter((r) => r !== u.role).map((r) => (
                <TouchableOpacity key={r} style={styles.btnSmall} onPress={() => changeRole(u, r)}>
                  <Text style={styles.btnSmallText}>→ {r}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: u.efectivo_bloqueado ? COLORS.green + '33' : COLORS.red + '33', borderColor: u.efectivo_bloqueado ? COLORS.green : COLORS.red }]}
                onPress={() => toggleEfectivoBloqueado(u)}
              >
                <Text style={[styles.btnSmallText, { color: u.efectivo_bloqueado ? COLORS.green : COLORS.red }]}>
                  {u.efectivo_bloqueado ? '✓ Hab.' : '🚫 Bloq.'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: u.efectivo_forzado ? COLORS.gray + '33' : COLORS.gold + '33', borderColor: u.efectivo_forzado ? COLORS.gray : COLORS.gold }]}
                onPress={() => toggleEfectivoForzado(u)}
              >
                <Text style={[styles.btnSmallText, { color: u.efectivo_forzado ? COLORS.gray2 : COLORS.gold }]}>
                  {u.efectivo_forzado ? '✕ Quitar forz.' : '⚡ Forzar ef.'}
                </Text>
              </TouchableOpacity>
              {u.role !== 'admin' && (
                <TouchableOpacity
                  style={[styles.btnSmall, { backgroundColor: COLORS.red + '33', borderColor: COLORS.red, opacity: deleting === u.id ? 0.5 : 1 }]}
                  onPress={() => deleteUser(u)}
                  disabled={deleting === u.id}
                >
                  {deleting === u.id
                    ? <ActivityIndicator size="small" color={COLORS.red} />
                    : <Text style={[styles.btnSmallText, { color: COLORS.red }]}>🗑 Eliminar</Text>
                  }
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
// WALLETS
// ═══════════════════════════════════════════════════════════════════
function AdminWallets({ navigation }) {
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  // `adjusting` = wallet.id en curso. Bloquea cualquier otro botón de ese
  // mismo wallet hasta terminar — evita race conditions financieras al
  // tocar +/- rápido o doble-tap.
  const [adjusting, setAdjusting] = useState(null);

  useEffect(() => {
    supabase.from('wallets').select('*, users(nombre)').order('balance', { ascending: false })
      .then(({ data }) => { setWallets(data ?? []); setLoading(false); });
  }, []);

  async function adjust(wallet, amount, tipo = 'ajuste_admin') {
    if (adjusting) return; // guard global anti doble-tap
    setAdjusting(wallet.id);
    try {
      // Optimistic-lock update: solo pasa si el balance NO cambió desde el read.
      const newBalance = Math.max(0, (wallet.balance ?? 0) + amount);
      const { error: walletErr, count } = await supabase
        .from('wallets').update({ balance: newBalance })
        .eq('id', wallet.id).eq('balance', wallet.balance)
        .select('id', { count: 'exact', head: true });
      if (walletErr) throw walletErr;
      if (count === 0) throw new Error('El saldo cambió mientras procesabas. Recarga la lista.');

      const { error: txErr } = await supabase
        .from('wallet_transactions').insert({
          wallet_id:   wallet.id,
          tipo,
          monto:       amount,
          descripcion: `Ajuste admin: ${amount > 0 ? '+' : ''}${amount}`,
        });
      if (txErr) {
        // Compensación: regresar el balance. PostgrestBuilder no tiene .catch,
        // así que envolvemos en try/await para no tirar TypeError sincronía.
        try {
          await supabase.from('wallets').update({ balance: wallet.balance }).eq('id', wallet.id);
        } catch (_) {}
        throw txErr;
      }
      setWallets((prev) => prev.map((w) => w.id === wallet.id ? { ...w, balance: newBalance } : w));
    } catch (e) {
      Alert.alert('Error en ajuste', e?.message ?? 'Intenta nuevamente.');
    } finally {
      setAdjusting(null);
    }
  }

  const total = wallets.reduce((s, w) => s + (w.balance ?? 0), 0);
  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>CRÉDITOS</Text>
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>TOTAL DE CRÉDITOS INTERNOS</Text>
        <Text style={styles.totalVal}>${total.toFixed(2)}</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {wallets.map((w) => (
          <View key={w.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.cardName}>{w.users?.nombre}</Text>
              <Text style={styles.walletBalance}>${w.balance?.toFixed(2)}</Text>
            </View>
            <View style={styles.btnRow}>
              {[1, 5, -1, -5].map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={[styles.btnSmall, { backgroundColor: amt > 0 ? COLORS.green + '40' : COLORS.red + '40' }, adjusting && { opacity: 0.5 }]}
                  onPress={() => adjust(w, amt)}
                  disabled={!!adjusting}
                >
                  <Text style={styles.btnSmallText}>{amt > 0 ? '+' : ''}{amt}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: COLORS.gold + '40' }, adjusting && { opacity: 0.5 }]}
                onPress={() => adjust(w, 1, 'mvp_premio')}
                disabled={!!adjusting}
              >
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
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled) return;
    const asset = result.assets[0];
    upd('imageUri', Platform.OS === 'web' ? asset : asset.uri);
  };

  async function uploadProductImage(source, productId) {
    const uri = typeof source === 'string' ? source : source?.uri ?? '';
    const ext = (uri.split('.').pop() ?? '').toLowerCase().replace(/\?.*$/, '');
    const safeExt = ['jpg','jpeg','png','webp','heic'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
    const path = `${productId}_${Date.now()}.${safeExt}`;
    return uploadImage('products', path, source);
  }

  async function toggleActivo(product) {
    const next = !product.activo;
    const { data, error } = await supabase.from('products').update({ activo: next }).eq('id', product.id).select('id');
    if (error || !data?.length) {
      Alert.alert('Error', error?.message ?? 'No se pudo actualizar el producto.');
      return;
    }
    setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, activo: next } : p));
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.md }}>
        <Text style={[styles.title, { padding: 0 }]}>INVENTARIO</Text>
        <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.red }]} onPress={startNew}>
          <Text style={[styles.btnSmallText, { color: COLORS.white }]}>+ Nuevo</Text>
        </TouchableOpacity>
      </View>

      {/* Formulario */}
      {showForm && (
        <ScrollView style={{ maxHeight: '60%' }} contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }} keyboardShouldPersistTaps="handled">
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
                ? <Image source={{ uri: (typeof form.imageUri === 'object' && form.imageUri?.uri) ? form.imageUri.uri : (form.imageUri ?? form.imagen_url) }} style={{ width: 80, height: 80, borderRadius: RADIUS.sm }} />
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {products.map((p) => (
          <View key={p.id} style={[styles.card, !p.activo && { opacity: 0.5 }]}>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {p.imagen_url
                ? <Image source={{ uri: p.imagen_url }} style={{ width: 56, height: 56, borderRadius: RADIUS.sm }} />
                : <View style={{ width: 56, height: 56, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>👕</Text></View>
              }
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.cardName}>{p.nombre}</Text>
                  <Text style={{ fontSize: 10, color: p.activo ? COLORS.green : COLORS.red, fontFamily: FONTS.bodyMedium }}>
                    {p.activo ? '● Visible' : '● Oculto'}
                  </Text>
                </View>
                <Text style={styles.cardSub}>{p.categoria} · ${p.precio?.toFixed(2)}</Text>
                {p.tiene_tallas
                  ? <Text style={styles.cardSub}>Tallas: {Object.entries(p.tallas ?? {}).map(([t, q]) => `${t}:${q}`).join(' · ')}</Text>
                  : <Text style={[styles.cardSub, { color: p.stock < 5 ? COLORS.red : COLORS.green }]}>Stock: {p.stock}</Text>
                }
              </View>
            </View>
            <View style={styles.btnRow}>
              {!p.tiene_tallas && p.activo && (
                <>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.red + '40' }]} onPress={() => updateStock(p.id, -1)}><Text style={styles.btnSmallText}>−1</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]} onPress={() => updateStock(p.id, 1)}><Text style={styles.btnSmallText}>+1</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]} onPress={() => updateStock(p.id, 10)}><Text style={styles.btnSmallText}>+10</Text></TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={[styles.btnSmall, { backgroundColor: COLORS.gold + '40' }]} onPress={() => startEdit(p)}>
                <Text style={styles.btnSmallText}>✏️ Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: p.activo ? COLORS.red + '30' : COLORS.green + '30' }]}
                onPress={() => toggleActivo(p)}
              >
                <Text style={styles.btnSmallText}>{p.activo ? '🚫 Ocultar' : '✓ Publicar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
      </KeyboardAvoidingView>
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
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
    lugar: '', direccion: '', maps_url: '', precio: '0', cupos_total: '',
    cupos_hombres: '', cupos_mujeres: '',
    cupos_ilimitado: false, genero: 'Mixto', descripcion: '',
    jugadores_por_equipo: null, jornadas: '1',
    cancha_costo: null, cancha_tarifa_id: null, duracion_horas: null,
    num_grupos: '2', equipos_por_grupo: '3',
    tiene_octavos: false, tiene_cuartos: false,
    tiene_semis: true, tiene_tercer_lugar: true, tiene_final: true,
    ida_y_vuelta: false,
    vidas_por_equipo: 3,
  });
  const user = useAuthStore((s) => s.user);

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
      // Finalizar el evento PRIMERO (lo importante). La noticia/notif son secundarias.
      const { error: finErr } = await supabase
        .from('events')
        .update({ status: next, event_finished_at: new Date().toISOString() })
        .eq('id', ev.id)
        .select('id');
      if (finErr) { Alert.alert('Error al finalizar', finErr.message); return; }
      // Auto-noticia + notif (best-effort, NO usar .catch sobre el builder).
      try {
        await supabase.from('news').insert({ titulo: newsTitle, contenido: newsBody, tipo: 'resultados' });
      } catch (_) {}
      try { sendLocalNotification(newsTitle, newsBody); } catch (_) {}
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
      // Mixto con desglose H/M: ambos deben estar y sumar cupos_total
      if (form.genero === 'Mixto' && (form.cupos_hombres !== '' || form.cupos_mujeres !== '')) {
        const ch = parseInt(form.cupos_hombres);
        const cm = parseInt(form.cupos_mujeres);
        if (isNaN(ch) || isNaN(cm) || ch < 0 || cm < 0) {
          Alert.alert('Cupos por género inválidos', 'Ingresá un número válido (0 o más) en cupos hombres y mujeres.'); return;
        }
        if (ch + cm !== cuposVal) {
          Alert.alert('La suma no coincide', `Hombres (${ch}) + Mujeres (${cm}) = ${ch + cm}, pero los cupos totales son ${cuposVal}. Ajustá la división.`); return;
        }
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
        maps_url:            form.maps_url.trim() || null,
        precio:              parseFloat(form.precio) || 0,
        cupos_total:         form.cupos_ilimitado ? null : (parseInt(form.cupos_total) || null),
        cupos_hombres:       (form.genero === 'Mixto' && !form.cupos_ilimitado && form.cupos_hombres !== '') ? (parseInt(form.cupos_hombres) || 0) : null,
        cupos_mujeres:       (form.genero === 'Mixto' && !form.cupos_ilimitado && form.cupos_mujeres !== '') ? (parseInt(form.cupos_mujeres) || 0) : null,
        cupos_ilimitado:     form.cupos_ilimitado,
        cancha_costo:        form.cancha_costo != null ? Number(form.cancha_costo) : null,
        cancha_tarifa_id:    form.cancha_tarifa_id ?? null,
        duracion_horas:      form.duracion_horas ?? null,
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
        vidas_por_equipo:    form.formato === '2 Vidas' ? (form.vidas_por_equipo ?? 3) : null,
      });
      if (error) throw error;
      Alert.alert('¡Evento creado!', 'Aparece como borrador.');
      setShowForm(false);
      setForm({ nombre:'', formato:'Liga', deporte:'Fútbol 7', fecha:'', hora:'', lugar:'', direccion:'', maps_url:'', precio:'0', cupos_total:'', cupos_hombres:'', cupos_mujeres:'', cupos_ilimitado:false, genero:'Mixto', descripcion:'', jugadores_por_equipo:null, jornadas:'1', cancha_costo:null, cancha_tarifa_id:null, duracion_horas:null, num_grupos:'2', equipos_por_grupo:'3', tiene_octavos:false, tiene_cuartos:false, tiene_semis:true, tiene_tercer_lugar:true, tiene_final:true, ida_y_vuelta:false, vidas_por_equipo: 3 });
      fetchEvents();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
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
              {['Liga','Torneo','Amistoso','Copa','Eliminación directa','2 Vidas'].map((f) => (
                <TouchableOpacity key={f} style={[styles.chip, form.formato === f && styles.chipActive]} onPress={() => upd('formato', f)}>
                  <Text style={[styles.chipText, form.formato === f && { color: COLORS.white }]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {form.formato === '2 Vidas' && (
              <View style={{ backgroundColor: COLORS.card, padding: SPACING.md, borderRadius: RADIUS.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.gold + '40' }}>
                <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 12, marginBottom: 4 }}>⚡ MODO 2 VIDAS</Text>
                <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12, marginBottom: SPACING.sm }}>
                  4 o 6 equipos (pares). Cada equipo arranca con vidas. Pierde partido = pierde 1 vida. Empate = penales (perdedor pierde vida). Los 2 con más vidas al final juegan la GRAN FINAL.
                </Text>
                <Text style={styles.fieldLabel}>Vidas por equipo</Text>
                <View style={styles.chipRow}>
                  {[2, 3].map((v) => (
                    <TouchableOpacity key={v} style={[styles.chip, (form.vidas_por_equipo ?? 3) === v && styles.chipActive]} onPress={() => upd('vidas_por_equipo', v)}>
                      <Text style={[styles.chipText, (form.vidas_por_equipo ?? 3) === v && { color: COLORS.white }]}>{v} vidas</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <Text style={styles.fieldLabel}>Fecha *</Text>
            <DateField style={styles.input} value={form.fecha} onChange={(v) => upd('fecha', v)} />

            <Text style={styles.fieldLabel}>Hora *</Text>
            <TimeField style={styles.input} value={form.hora} onChange={(v) => upd('hora', v)} />

            <Text style={styles.fieldLabel}>Lugar *</Text>
            <TextInput style={styles.input} placeholder="Cancha / Estadio" placeholderTextColor={COLORS.gray} value={form.lugar} onChangeText={(v) => upd('lugar', v)} />

            <Text style={styles.fieldLabel}>Dirección</Text>
            <TextInput style={styles.input} placeholder="Dirección exacta (opcional)" placeholderTextColor={COLORS.gray} value={form.direccion} onChangeText={(v) => upd('direccion', v)} />

            <Text style={styles.fieldLabel}>Link Google Maps (opcional)</Text>
            <TextInput style={styles.input} placeholder="https://maps.google.com/..." placeholderTextColor={COLORS.gray} value={form.maps_url} onChangeText={(v) => upd('maps_url', v)} autoCapitalize="none" autoCorrect={false} />

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

                {/* Desglose por género: solo Mixto. La suma debe igualar cupos_total. */}
                {form.genero === 'Mixto' && (
                  <View style={{ backgroundColor: COLORS.card, padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy }}>
                    <Text style={[styles.fieldLabel, { marginTop: 0, marginBottom: SPACING.sm }]}>Cupos por género (Mixto)</Text>
                    <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { marginTop: 0 }]}>♂ Hombres</Text>
                        <TextInput style={styles.input} placeholder="12" placeholderTextColor={COLORS.gray} keyboardType="number-pad" value={form.cupos_hombres} onChangeText={(v) => upd('cupos_hombres', v)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { marginTop: 0 }]}>♀ Mujeres</Text>
                        <TextInput style={styles.input} placeholder="8" placeholderTextColor={COLORS.gray} keyboardType="number-pad" value={form.cupos_mujeres} onChangeText={(v) => upd('cupos_mujeres', v)} />
                      </View>
                    </View>
                    {(form.cupos_hombres !== '' || form.cupos_mujeres !== '') && form.cupos_total !== '' && (() => {
                      const ch = parseInt(form.cupos_hombres) || 0;
                      const cm = parseInt(form.cupos_mujeres) || 0;
                      const ct = parseInt(form.cupos_total) || 0;
                      const ok = ch + cm === ct;
                      return (
                        <Text style={[styles.cardSub, { marginTop: SPACING.sm, color: ok ? COLORS.green : COLORS.red }]}>
                          {ok ? `✓ Suma OK: ${ch} + ${cm} = ${ct}` : `⚠ Suma ${ch + cm}, esperaba ${ct}`}
                        </Text>
                      );
                    })()}
                    <Text style={[styles.cardSub, { marginTop: 4, color: COLORS.gray }]}>
                      Opcional. Si lo dejás vacío, los cupos se asignan por orden de inscripción sin distinción de género.
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* Costo de la cancha — base de la ganancia del gestor */}
            <CanchaCostoPicker
              deporte={form.deporte}
              jugadoresPorEquipo={form.jugadores_por_equipo}
              costoValue={form.cancha_costo}
              tarifaIdValue={form.cancha_tarifa_id}
              duracionValue={form.duracion_horas}
              onChange={({ cancha_costo, cancha_tarifa_id, duracion_horas }) => {
                upd('cancha_costo', cancha_costo);
                upd('cancha_tarifa_id', cancha_tarifa_id);
                upd('duracion_horas', duracion_horas);
              }}
            />

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
                  {['1','2','3','4','8'].map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, form.num_grupos === n && styles.chipActive]} onPress={() => upd('num_grupos', n)}>
                      <Text style={[styles.chipText, form.num_grupos === n && { color: COLORS.white }]}>{n === '1' ? 'Grupo único' : `${n} grupos`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {form.num_grupos === '1' && (
                  <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 11, marginBottom: SPACING.sm }}>
                    ℹ Grupo único: todos los equipos juegan entre sí, después avanzan TODOS a knockout.
                  </Text>
                )}
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
                <Text style={styles.cardSub}>{ev.fecha} · {ev.hora?.slice(0,5)} · {(ev.precio ?? 0) > 0 ? `$${ev.precio.toFixed(2)}` : freeLabel(ev.deporte)}</Text>
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
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.blue + '25', borderColor: COLORS.blue }]}
                onPress={() => navigation.navigate('EditEvent', { eventId: ev.id })}>
                <Text style={[styles.actionBtnText, { color: COLORS.blue2 }]}>✏️ Editar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.gold + '25', borderColor: COLORS.gold }]}
                onPress={() => navigation.navigate('AdminManageEvent', { eventId: ev.id, eventNombre: ev.nombre, formato: ev.formato })}>
                <Text style={[styles.actionBtnText, { color: COLORS.gold }]}>⚙️ Gestionar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: COLORS.red + '25', borderColor: COLORS.red }]}
                  onPress={() =>
                    Alert.alert('Eliminar evento', `¿Eliminar "${ev.nombre}" permanentemente? Esta acción no se puede deshacer.`, [
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
            </View>
          </View>
        ))}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GESTIÓN DE EVENTO (tabs: Equipos, Partidos, Resultados, MVP, Config)
// ═══════════════════════════════════════════════════════════════════
function AdminManageEvent({ route, navigation }) {
  const { eventId, eventNombre, formato } = route.params ?? {};
  const user = useAuthStore((s) => s.user); // auditoría: quién carga cada resultado
  const TABS     = ['Equipos', 'Partidos', 'Resultados', 'Ganancia', 'MVP', 'Config'];
  const [tab,        setTab]        = useState('Equipos');
  const [teams,      setTeams]      = useState([]);
  const [players,    setPlayers]    = useState([]);
  const [matches,    setMatches]    = useState([]);
  const [event,      setEvent]      = useState(null);
  const [scores,     setScores]     = useState({});
  const [savingMatch, setSavingMatch] = useState(null); // BUG FIX: double-submit guard for saveResult
  const [liveSavingMatch, setLiveSavingMatch] = useState(null); // guard del marcador en vivo
  const scoring = getScoringTerms(event?.deporte ?? 'Fútbol'); // gol/punto/carrera según deporte
  const [mvpResult,        setMvpResult]        = useState(null);   // single event MVP or null
  const [mvpVotesByPlayer, setMvpVotesByPlayer] = useState({});     // { userId: voteCount }
  const [mvpTotalVotes,    setMvpTotalVotes]    = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [mixedModal, setMixedModal] = useState(false);
  const [chicasPorEquipo, setChicasPorEquipo] = useState('1');
  const [editTeamModal,   setEditTeamModal]   = useState(null); // null | team obj
  const [editTeamForm,    setEditTeamForm]    = useState({ nombre: '', color: '', logo_url: null });
  const [assignExpanded,  setAssignExpanded]  = useState(null); // _key being assigned to a team
  const [playerMap,       setPlayerMap]       = useState(new Map()); // _key → { nombre, genero, isGuest, guestId? }
  const [addGuestModal,   setAddGuestModal]   = useState(false);
  const [addGuestName,    setAddGuestName]    = useState('');
  const [addGuestGenero,  setAddGuestGenero]  = useState(null);
  // Quitar inscrito (con cuenta) del evento, con motivo + reemplazo
  const [removeListModal, setRemoveListModal] = useState(false);
  const [removeInscritos, setRemoveInscritos] = useState([]);
  const [removeTarget,    setRemoveTarget]    = useState(null); // {reg_id,user_id,nombre,monto,metodo}
  const [removeMotivo,    setRemoveMotivo]    = useState('');
  const [removeBusy,      setRemoveBusy]      = useState(false);
  const [rivalName,       setRivalName]       = useState('');
  // Gate de confidencialidad para la pestaña Ganancia (PIN). Se re-bloquea al salir de la pestaña.
  const [gananciaUnlocked, setGananciaUnlocked] = useState(false);
  const [gananciaPinInput, setGananciaPinInput] = useState('');
  const GANANCIA_PIN = '2426';

  useEffect(() => {
    loadAll();
    if (tab !== 'Ganancia') { setGananciaUnlocked(false); setGananciaPinInput(''); }
  }, [tab]);

  function tryUnlockGanancia() {
    if (gananciaPinInput.trim() === GANANCIA_PIN) {
      setGananciaUnlocked(true);
      setGananciaPinInput('');
    } else {
      Alert.alert('PIN incorrecto', 'El PIN de confidencialidad no es correcto.');
      setGananciaPinInput('');
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [{ data: t }, { data: regs }, { data: guests }, { data: m }, { data: ev }, { data: evMvpResult }, { data: evVotes }] = await Promise.all([
        supabase.from('teams').select('*, team_players(id, user_id, guest_id)').eq('event_id', eventId),
        supabase.from('event_registrations').select('user_id, users(nombre, genero)').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('event_guests').select('id, nombre, genero, status, invited_by').eq('event_id', eventId).in('status', ['confirmed', 'pending_payment']),
        supabase.from('matches').select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color), cargador:resultado_por(nombre)').eq('event_id', eventId).order('jornada'),
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('mvp_results').select('*, users(nombre)').eq('event_id', eventId).maybeSingle(),
        supabase.from('mvp_votes').select('voted_for_id').eq('event_id', eventId),
      ]);

      const byPlayer = (evVotes ?? []).reduce((acc, v) => {
        acc[v.voted_for_id] = (acc[v.voted_for_id] ?? 0) + 1;
        return acc;
      }, {});

      // Build playerMap: _key → { nombre, genero, isGuest, guestId? }
      const map = new Map();
      (regs ?? []).forEach(r => {
        if (r.user_id) map.set(r.user_id, { nombre: r.users?.nombre ?? '—', genero: r.users?.genero ?? '', isGuest: false });
      });
      const activeGuests = filterActiveEventGuests(guests ?? [], regs ?? []);
      activeGuests.forEach(g => {
        if (g.id) map.set('g_' + g.id, { nombre: g.nombre ?? '—', genero: g.genero ?? '', isGuest: true, guestId: g.id });
      });

      // Unified players list — each item has _key and _isGuest
      const regPlayers   = (regs   ?? []).map(r => ({ ...r, _key: r.user_id,       _isGuest: false }));
      const guestPlayers = activeGuests.map(g => ({ user_id: null, guest_id: g.id, _key: 'g_' + g.id, _isGuest: true }));

      setTeams(t ?? []);
      setPlayers([...regPlayers, ...guestPlayers]);
      setPlayerMap(map);
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

  async function addGuest() {
    const nombre = addGuestName.trim();
    if (!nombre) { Alert.alert('Error', 'El nombre es requerido'); return; }
    if (!addGuestGenero) { Alert.alert('Error', 'El género es requerido'); return; }
    const { data, error } = await supabase
      .from('event_guests')
      .insert({ event_id: eventId, nombre, genero: addGuestGenero, status: 'confirmed', metodo_pago: 'gratis' })
      .select('id');
    if (error) { Alert.alert('Error', error.message); return; }
    if (!data || data.length === 0) {
      Alert.alert('Sin cambios', 'No se pudo agregar el invitado (RLS/permisos). Recarga e intenta.');
      return;
    }
    setAddGuestModal(false);
    setAddGuestName('');
    setAddGuestGenero(null);
    loadAll();
  }

  // ── Quitar inscrito (con cuenta) del evento: motivo + reembolso 100% + aviso ──
  async function openRemoveList() {
    setRemoveListModal(true);
    setRemoveInscritos([]);
    const { data } = await supabase
      .from('event_registrations')
      .select('id, user_id, monto_pagado, metodo_pago, status, users:user_id(nombre)')
      .eq('event_id', eventId)
      .in('status', ['confirmed', 'pending'])
      .order('created_at', { ascending: true });
    setRemoveInscritos(data ?? []);
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    if (!removeMotivo.trim()) { Alert.alert('Motivo requerido', 'Escribe el motivo de la remoción.'); return; }
    if (removeBusy) return;
    setRemoveBusy(true);
    try {
      const { data, error } = await supabase.rpc('admin_remove_registration', {
        p_registration_id: removeTarget.reg_id,
        p_motivo:          removeMotivo.trim(),
      });
      if (error) throw error;
      // Aviso al jugador (push + email) con el motivo — fire-and-forget.
      if (removeTarget.user_id) {
        const refundLine = data?.refunded ? ` Se te devolvieron $${Number(data.amount).toFixed(2)} a tus créditos internos.` : '';
        supabase.functions.invoke('send-notification', {
          body: {
            user_ids:    [removeTarget.user_id],
            force_email: true,
            title:       '⚠️ Fuiste removido de un evento',
            body:        `El administrador te removió del evento "${eventNombre}". Motivo: ${removeMotivo.trim()}.${refundLine}`,
            url:         'https://birrea2play.com',
          },
        }).catch(() => {});
      }
      const refundTxt = data?.refunded ? ` Se devolvieron $${Number(data.amount).toFixed(2)} a sus créditos.` : '';
      const nombre = removeTarget.nombre ?? 'El jugador';
      setRemoveTarget(null);
      setRemoveMotivo('');
      setRemoveListModal(false);
      loadAll();
      Alert.alert(
        'Jugador removido',
        `${nombre} fue removido del evento.${refundTxt} Se le avisó el motivo.\n\n¿Agregar un reemplazo ahora?`,
        [
          { text: 'Después', style: 'cancel' },
          { text: '➕ Agregar reemplazo', onPress: () => setAddGuestModal(true) },
        ],
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setRemoveBusy(false);
    }
  }

  async function deleteGuest(guestId, guestNombre) {
    Alert.alert(
      'Eliminar jugador',
      `¿Eliminar a "${guestNombre}" del evento? También se quitará de su equipo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: async () => {
          // Marcamos como cancelled (preserva historial; el cliente cuenta solo
          // status in ('confirmed','pending_payment') así que liberar el cupo).
          // `.select()` fuerza que data traiga las filas afectadas — sin esto, un
          // RLS o constraint que bloquee silenciosamente devuelve error=null y
          // el cliente pensaría que funcionó (bug detectado 2026-05-21).
          const { data, error } = await supabase
            .from('event_guests')
            .update({ status: 'cancelled' })
            .eq('id', guestId)
            .select('id');
          if (error) { Alert.alert('Error', error.message); return; }
          if (!data || data.length === 0) {
            Alert.alert(
              'Sin cambios',
              'No se eliminó el invitado. Puede haber un problema de permisos — recarga la pantalla e intenta de nuevo.'
            );
            return;
          }
          // Limpiar también del team_players si estaba asignado a un equipo.
          await supabase.from('team_players').delete().eq('guest_id', guestId);
          loadAll();
        }},
      ]
    );
  }

  // Amistoso vs rival EXTERNO: 2 equipos (todos los inscritos al local; el rival
  // queda sin jugadores, solo para el marcador) + 1 partido. Salta la regla de
  // cupos múltiplo de jugadores_por_equipo, que aplica a birreas internas.
  async function crearAmistosoExterno() {
    const rival = rivalName.trim();
    if (!rival) { Alert.alert('Rival', 'Escribe el nombre del equipo rival.'); return; }
    if (teams.length > 0) {
      const ok = await new Promise(res =>
        Alert.alert('Equipos existentes', `Ya hay ${teams.length} equipo(s). ¿Reemplazarlos por el amistoso vs ${rival}? (borra también los partidos)`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
          { text: 'Reemplazar', style: 'destructive', onPress: () => res(true) },
        ])
      );
      if (!ok) return;
      // Orden importa: matches referencia a teams (FK) → borrar primero
      await supabase.from('matches').delete().eq('event_id', eventId);
      for (const t of teams) {
        await supabase.from('team_players').delete().eq('team_id', t.id);
      }
      await supabase.from('teams').delete().in('id', teams.map(t => t.id));
    }
    const { data: newTeams, error: tErr } = await supabase.from('teams').insert([
      { event_id: eventId, nombre: 'Panamá Birreas', color: TEAM_COLORS[0].color, grupo: 'A' },
      { event_id: eventId, nombre: rival, color: TEAM_COLORS[1].color, grupo: 'A' },
    ]).select('id, nombre');
    if (tErr || (newTeams ?? []).length !== 2) {
      Alert.alert('Error', tErr?.message ?? 'No se pudieron crear los equipos.'); return;
    }
    const away = newTeams.find(t => t.nombre === rival) ?? newTeams[1];
    const home = newTeams.find(t => t.id !== away.id) ?? newTeams[0];
    const tpInserts = [];
    playerMap.forEach((info, key) => {
      tpInserts.push(info.isGuest ? { team_id: home.id, guest_id: info.guestId } : { team_id: home.id, user_id: key });
    });
    if (tpInserts.length > 0) {
      const { error: tpErr } = await supabase.from('team_players').insert(tpInserts);
      if (tpErr) Alert.alert('Aviso', `Equipos creados pero falló asignar jugadores: ${tpErr.message}`);
    }
    const { error: mErr } = await supabase.from('matches').insert({
      event_id: eventId, jornada: 1, team_home_id: home.id, team_away_id: away.id,
      fase: 'grupos', grupo: null, equipo_local: null, equipo_visitante: null,
      seed_home: null, seed_away: null, status: 'pending',
    });
    if (mErr) { Alert.alert('Error al crear el partido', mErr.message); return; }
    setRivalName('');
    loadAll();
    Alert.alert('¡Listo!', `Amistoso creado: Panamá Birreas vs ${rival}.\n${tpInserts.length} jugadores en tu equipo. Marca goles en Resultados y proyecta la Pantalla en Vivo.`);
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

  // ── Asignación aleatoria (distribución equitativa, soporte mixto + invitados) ──
  async function autoAssign(chicasPEq = 0) {
    if (teams.length === 0) { Alert.alert('Error', 'Crea equipos primero.'); return; }
    for (const t of teams) {
      await supabase.from('team_players').delete().eq('team_id', t.id);
    }

    // Helper: always pick the team with fewest assigned players → perfectly even distribution
    const teamCount = new Array(teams.length).fill(0);
    const nextTeamIdx = () => {
      let min = 0;
      for (let i = 1; i < teamCount.length; i++) if (teamCount[i] < teamCount[min]) min = i;
      teamCount[min]++;
      return min;
    };

    const isMixto = event?.genero === 'Mixto';

    const isFemenino = (p) => p._isGuest
      ? playerMap.get(p._key)?.genero === 'Femenino'
      : playerMap.get(p.user_id)?.genero === 'Femenino';

    const toInsert = (p) => p._isGuest
      ? { team_id: null, guest_id: p.guest_id }
      : { team_id: null, user_id: p.user_id };

    const chicas  = players.filter(isFemenino);
    const hombres = players.filter(p => !isFemenino(p));

    const assignments = [];

    if (isMixto && chicasPEq > 0) {
      // First: assign exactly chicasPEq chicas per team (includes female guests)
      const shuffledChicas = [...chicas].sort(() => Math.random() - 0.5);
      let girlIdx = 0;
      for (let t = 0; t < teams.length; t++) {
        for (let s = 0; s < chicasPEq && girlIdx < shuffledChicas.length; s++) {
          const p = shuffledChicas[girlIdx++];
          const ins = toInsert(p);
          ins.team_id = teams[t].id;
          assignments.push(ins);
          teamCount[t]++;
        }
      }
      // Remaining: extra chicas + hombres → fill smallest team
      const rest = [...shuffledChicas.slice(girlIdx), ...hombres].sort(() => Math.random() - 0.5);
      for (const p of rest) {
        const idx = nextTeamIdx();
        const ins = toInsert(p);
        ins.team_id = teams[idx].id;
        assignments.push(ins);
      }
    } else {
      // Non-mixto: shuffle ALL players together, fill smallest team
      const all = [...players].sort(() => Math.random() - 0.5);
      for (const p of all) {
        const idx = nextTeamIdx();
        const ins = toInsert(p);
        ins.team_id = teams[idx].id;
        assignments.push(ins);
      }
    }

    for (const a of assignments) {
      await supabase.from('team_players').insert(a);
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
      nombre:   editTeamForm.nombre.trim(),
      color:    editTeamForm.color,
      logo_url: editTeamForm.logo_url ?? null,
    }).eq('id', editTeamModal.id);
    setEditTeamModal(null);
    loadAll();
  }

  // ── Quitar un jugador específico de su equipo ──
  async function removePlayerFromTeam(teamId, userId, guestId) {
    if (guestId) {
      await supabase.from('team_players').delete().eq('team_id', teamId).eq('guest_id', guestId);
    } else {
      await supabase.from('team_players').delete().eq('team_id', teamId).eq('user_id', userId);
    }
    loadAll();
  }

  // ── Asignar un jugador sin equipo a un equipo específico ──
  async function assignPlayerToTeam(teamId, playerKey) {
    const info = playerMap.get(playerKey);
    if (!info) return;
    if (info.isGuest) {
      await supabase.from('team_players').delete().eq('guest_id', info.guestId);
      await supabase.from('team_players').insert({ team_id: teamId, guest_id: info.guestId });
    } else {
      await supabase.from('team_players').delete().eq('user_id', playerKey);
      await supabase.from('team_players').insert({ team_id: teamId, user_id: playerKey });
    }
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
          seed_home:       k.seed_home ?? null,
          seed_away:       k.seed_away ?? null,
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

  // ── Guardar / editar resultado ──
  // Marcador EN VIVO: suma/resta goles SIN cerrar el partido. La "Pantalla en
  // Vivo" (poll 10s) lo proyecta gol a gol; "Guardar resultado" cierra igual
  // que siempre (status finished + cascada KO/standings).
  async function bumpLiveGoal(match, side, delta) {
    if (liveSavingMatch) return;
    if (event?.status === 'finished') {
      Alert.alert('Evento finalizado', 'No se pueden editar resultados de un evento finalizado.'); return;
    }
    const col = side === 'home' ? 'goles_home' : 'goles_away';
    const legacyCol = side === 'home' ? 'goles_local' : 'goles_visitante';
    const next = Math.max(0, (match[col] ?? 0) + delta);
    setLiveSavingMatch(match.id);
    try {
      const { data, error } = await supabase.from('matches')
        .update({ [col]: next, [legacyCol]: next, resultado_por: user?.id ?? null })
        .eq('id', match.id)
        .select('id');
      if (error || !data?.length) {
        Alert.alert('Error', error?.message ?? 'No se pudo actualizar el marcador en vivo.');
        return;
      }
      setMatches((prev) => prev.map((x) => x.id === match.id ? { ...x, [col]: next, [legacyCol]: next } : x));
      // Pre-cargar los inputs del resultado final con el marcador en vivo.
      const other = side === 'home' ? 'away' : 'home';
      const otherCol = side === 'home' ? 'goles_away' : 'goles_home';
      setScores((s) => {
        const cur = s[match.id] ?? {};
        const otherVal = (cur[other] === undefined || cur[other] === '')
          ? String(match[otherCol] ?? 0) : cur[other];
        return { ...s, [match.id]: { ...cur, [side]: String(next), [other]: otherVal } };
      });
    } finally {
      setLiveSavingMatch(null);
    }
  }

  async function saveResult(match) {
    if (savingMatch === match.id) return;
    // Solo bloquear edición si el EVENTO está finalizado
    if (event?.status === 'finished') {
      Alert.alert('Evento finalizado', 'No se pueden editar resultados de un evento finalizado.'); return;
    }
    const { home, away } = scores[match.id] ?? {};
    if (home === undefined || home === '' || away === undefined || away === '') {
      Alert.alert('Error', 'Ingresa los goles de ambos equipos.'); return;
    }
    const gh = parseInt(home, 10);
    const ga = parseInt(away, 10);
    if (isNaN(gh) || isNaN(ga) || gh < 0 || ga < 0) {
      Alert.alert('Error', 'Ingresa un número válido (0 o más) para cada equipo.'); return;
    }

    const phase      = match.fase ?? 'grupos';
    const isKnockout = ['octavos','cuartos','semis','tercer_lugar','final'].includes(phase);

    // Guard: no permitir guardar resultados sobre placeholders KO sin teams asignados —
    // dejaría el evento sin trazabilidad de ganador (caso del evento 21-may).
    if (isKnockout && (!match.team_home_id || !match.team_away_id)) {
      Alert.alert(
        'Falta poblar la fase',
        'Este partido aún no tiene equipos asignados. Cargá primero los resultados de la fase anterior; el sistema avanza a los ganadores automáticamente.',
      ); return;
    }

    // Empate en KO requiere penales
    const isTie         = gh === ga;
    const needsPenalties = isTie && isKnockout;
    let penH = null, penA = null, fuePenales = false;
    if (needsPenalties) {
      const { penHome, penAway } = scores[match.id] ?? {};
      const ph = parseInt(penHome, 10);
      const pa = parseInt(penAway, 10);
      if (isNaN(ph) || isNaN(pa) || ph < 0 || pa < 0) {
        Alert.alert('Penales requeridos', 'Empate en knockout. Ingresá el marcador de penales.'); return;
      }
      if (ph === pa) {
        Alert.alert('Penales empatados', 'No puede empatar en penales — debe haber un ganador.'); return;
      }
      penH = ph; penA = pa; fuePenales = true;
    }

    setSavingMatch(match.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('matches').update({
        goles_home:     gh,
        goles_away:     ga,
        goles_local:    gh,
        goles_visitante:ga,
        goles_pen_home: penH,
        goles_pen_away: penA,
        fue_a_penales:  fuePenales,
        status:         'finished',
        jugado:         true,
        finished_at:    now,
        resultado_por:  user?.id ?? null,
      }).eq('id', match.id);
      if (error) { Alert.alert('Error', error.message); return; }

      const updatedMatch = {
        ...match,
        status: 'finished',
        goles_home: gh, goles_away: ga,
        goles_pen_home: penH, goles_pen_away: penA, fue_a_penales: fuePenales,
      };
      const allMatchesUpdated = matches.map((m) => m.id === match.id ? updatedMatch : m);

      // Auto-propagar siguiente fase KO (winners → next + losers de semis → 3er lugar)
      if (isKnockout && phase !== 'final') {
        await populateNextKnockoutPhase({ supabase, eventId, matches: allMatchesUpdated });
      }

      // Auto-poblar la 1ª ronda KO cuando se cierra la fase de grupos
      if (event?.formato === 'Torneo' && phase === 'grupos' && isGroupStageComplete(allMatchesUpdated)) {
        const koAlreadyPopulated = allMatchesUpdated.some((m) =>
          ['octavos','cuartos','semis'].includes(m.fase) && (m.team_home_id || m.team_away_id)
        );
        if (!koAlreadyPopulated) {
          const standings = computeStandingsFromMatches(allMatchesUpdated, teams, event?.deporte ?? 'Fútbol');
          const numGrupos = parseInt(event?.num_grupos ?? '2', 10) || 2;
          const avanzan = numGrupos === 1 ? teams.length : 2;
          const conflicts = detectGroupTiesNeedingDecision(standings, avanzan);
          if (conflicts.length === 0) {
            const qualified = getQualifiedTeams(standings, avanzan);
            await populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup: qualified });
          } else {
            Alert.alert(
              'Empate exacto entre equipos',
              'Hay empate exacto en pts/dg/gf en la plaza de corte. Resolvé el orden desde el panel de Gestor → Resultados.',
            );
          }
        }
      }

      const penTxt = fuePenales ? ` (pen ${penH}-${penA})` : '';
      setScores((s) => { const n = { ...s }; delete n[match.id]; return n; });
      loadAll();
      Alert.alert('✓ Guardado', `${match.home?.nombre ?? match.equipo_local} ${gh} - ${ga} ${match.away?.nombre ?? match.equipo_visitante}${penTxt}`);
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

    // RPC atómico: inserta mvp_results + acredita +$1 + idempotente. Reemplaza
    // el patrón anterior (insert + credit_wallet) que fallaba por caller validation.
    const { data: declareData, error: declareErr } = await supabase.rpc('declare_mvp', {
      p_event_id:      eventId,
      p_user_id:       winnerId,
      p_votos_totales: winnerVotes,
    });
    if (declareErr) {
      Alert.alert('Error al declarar MVP', declareErr.message);
      loadAll();
      return;
    }

    // Cerrar votación
    const { error: closeErr } = await supabase.from('events').update({ mvp_voting_open: false }).eq('id', eventId);
    if (closeErr) console.warn('closeMvp: could not close voting flag:', closeErr.message);

    const winnerInfo = playerMap.get(winnerId);
    const winnerNombre = winnerInfo?.nombre ?? 'Jugador';
    loadAll();
    if (declareData?.already_paid) {
      Alert.alert('🏆 MVP ya pagado', `${winnerNombre} — ${winnerVotes} votos. El premio ya había sido acreditado.`);
    } else {
      Alert.alert('🏆 MVP Declarado', `${winnerNombre} — ${winnerVotes} votos. +$1.00 acreditado.`);
    }
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
        // Auto-noticia best-effort (NO usar .catch sobre el builder).
        try {
          await supabase.from('news').insert({
            titulo:    newsTitle,
            contenido: newsBody,
            tipo:      'resultados',
          });
        } catch (_) {}
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
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>

            {/* ═══ EQUIPOS ═══ */}
            {tab === 'Equipos' && (() => {
              // Jugadores sin equipo (para asignación manual)
              const assignedKeys = new Set(
                teams.flatMap(t => t.team_players?.map(tp => tp.guest_id ? 'g_' + tp.guest_id : tp.user_id) ?? [])
                  .filter((key) => playerMap.has(key))
              );
              const unassigned = players.filter(p => !assignedKeys.has(p._key));
              const activeTeamPlayers = (team) => (team.team_players ?? []).filter((tp) => {
                const key = tp.guest_id ? 'g_' + tp.guest_id : tp.user_id;
                return playerMap.has(key);
              });
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

                  {/* Amistoso vs equipo externo (no participa en la app) */}
                  <View style={{ marginBottom: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.orange, padding: SPACING.sm, gap: SPACING.sm }}>
                    <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.orange, letterSpacing: 1 }}>⚔️ AMISTOSO VS RIVAL EXTERNO</Text>
                    <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                      <TextInput
                        style={{ flex: 1, minHeight: 40, backgroundColor: COLORS.card2, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.navy, color: COLORS.white, paddingHorizontal: SPACING.sm, fontFamily: FONTS.body, fontSize: 13 }}
                        placeholder="Nombre del rival (ej. Prom 13)"
                        placeholderTextColor={COLORS.gray}
                        value={rivalName}
                        onChangeText={setRivalName}
                      />
                      <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.orange, flex: 0, paddingHorizontal: SPACING.md }]} onPress={crearAmistosoExterno}>
                        <Text style={styles.btnText}>Crear</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray }}>Crea tu equipo con todos los inscritos + el rival (solo marcador) + el partido único.</Text>
                  </View>
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.green, marginBottom: SPACING.sm }]} onPress={() => setAddGuestModal(true)}>
                    <Text style={styles.btnText}>➕ Agregar jugador</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.red, marginBottom: SPACING.sm }]} onPress={openRemoveList}>
                    <Text style={styles.btnText}>🚫 Quitar / reemplazar inscrito</Text>
                  </TouchableOpacity>

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
                        <TeamMark team={t} size={18} />
                        <Text style={[styles.cardName, { flex: 1 }]}>{t.nombre}</Text>
                        {t.grupo && (
                          <View style={{ backgroundColor: COLORS.navy, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ color: COLORS.white, fontFamily: FONTS.bodyBold, fontSize: 11 }}>GRP {t.grupo}</Text>
                          </View>
                        )}
                        <Text style={styles.cardSub}>{activeTeamPlayers(t).length} jug.</Text>
                        {/* Botón editar */}
                        <TouchableOpacity
                          style={[styles.btnSmall, { backgroundColor: COLORS.blue + '40' }]}
                          onPress={() => { setEditTeamModal(t); setEditTeamForm({ nombre: t.nombre, color: t.color ?? '', logo_url: t.logo_url ?? null }); }}
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
                      {activeTeamPlayers(t).length === 0
                        ? <Text style={[styles.cardSub, { paddingLeft: 24, fontStyle:'italic' }]}>Sin jugadores asignados</Text>
                        : activeTeamPlayers(t).map((tp) => {
                          const mapKey = tp.guest_id ? 'g_' + tp.guest_id : tp.user_id;
                          const info   = playerMap.get(mapKey) ?? { nombre: '—', genero: '', isGuest: !!tp.guest_id };
                          return (
                            <View key={mapKey} style={{ flexDirection:'row', alignItems:'center', paddingLeft: 24, paddingVertical: 2 }}>
                              <Text style={[styles.cardSub, { flex: 1, color: COLORS.gray2 }]}>
                                {info.isGuest ? '👤 ' : ''}{info.nombre}{info.genero === 'Femenino' ? ' ♀' : ''}
                              </Text>
                              <TouchableOpacity
                                style={{ paddingHorizontal: 8, paddingVertical: 2 }}
                                onPress={() => removePlayerFromTeam(t.id, tp.user_id, tp.guest_id)}
                              >
                                <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyBold, fontSize: 14 }}>✕</Text>
                              </TouchableOpacity>
                              {info.isGuest && (
                                <TouchableOpacity
                                  style={{ paddingHorizontal: 6, paddingVertical: 2 }}
                                  onPress={() => deleteGuest(info.guestId, info.nombre)}
                                >
                                  <Text style={{ color: COLORS.red, fontSize: 12 }}>🗑</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })
                      }
                    </View>
                  ))}

                  {/* Jugadores sin equipo — asignación individual */}
                  {unassigned.length > 0 && (
                    <View style={styles.card}>
                      <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: SPACING.sm }]}>
                        ⚠️ Jugadores sin equipo ({unassigned.length})
                      </Text>
                      {unassigned.map((p) => {
                        const info = playerMap.get(p._key) ?? { nombre: '—', genero: '', isGuest: p._isGuest };
                        return (
                          <View key={p._key}>
                            <View style={{ flexDirection:'row', alignItems:'center', paddingVertical: 4 }}>
                              <Text style={[styles.cardSub, { flex: 1 }]}>
                                {info.isGuest ? '👤 ' : ''}{info.nombre}{info.genero === 'Femenino' ? ' ♀' : ''}
                              </Text>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]}
                                onPress={() => setAssignExpanded(assignExpanded === p._key ? null : p._key)}
                              >
                                <Text style={styles.btnSmallText}>{assignExpanded === p._key ? '▲' : '+ Equipo'}</Text>
                              </TouchableOpacity>
                              {info.isGuest && (
                                <TouchableOpacity
                                  style={[styles.btnSmall, { backgroundColor: COLORS.red + '30', marginLeft: 4 }]}
                                  onPress={() => deleteGuest(info.guestId, info.nombre)}
                                >
                                  <Text style={styles.btnSmallText}>🗑</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            {/* Selector de equipo para asignar */}
                            {assignExpanded === p._key && teams.length > 0 && (
                              <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 6, paddingLeft: 8, paddingBottom: 4 }}>
                                {teams.map((t) => (
                                  <TouchableOpacity
                                    key={t.id}
                                    style={{ flexDirection:'row', alignItems:'center', gap: 4, backgroundColor: t.color + '30', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.color ?? COLORS.navy }}
                                    onPress={() => assignPlayerToTeam(t.id, p._key)}
                                  >
                                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? COLORS.blue }} />
                                    <Text style={{ fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white }}>{t.nombre}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            )}
                          </View>
                        );
                      })}
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
            {tab === 'Resultados' && (() => {
              const eventLocked = event?.status === 'finished';
              const renderMatchCard = (m, isEditable) => {
                const sc = scores[m.id] ?? {};
                const hG = parseInt(sc.home, 10);
                const aG = parseInt(sc.away, 10);
                const tieEntered = !isNaN(hG) && !isNaN(aG) && hG === aG;
                const phaseLbl   = m.fase ?? 'grupos';
                const isKO       = ['octavos','cuartos','semis','tercer_lugar','final'].includes(phaseLbl);
                const showPen    = isEditable && tieEntered && isKO;
                const koMissingTeams = isKO && (!m.team_home_id || !m.team_away_id);
                return (
                <View key={m.id} style={[styles.card, !isEditable && { borderColor: COLORS.green + '40' }]}>
                  <Text style={[styles.cardSub, { marginBottom: SPACING.sm }]}>
                    {m.fase === 'final' ? '🏆 FINAL' : m.fase === 'semis' ? '🥊 SEMI' : m.fase === 'tercer_lugar' ? '🥉 3er LUGAR' : `Jornada ${m.jornada}`}
                    {m.grupo ? ` · Grp ${m.grupo}` : ''}
                    {m.status === 'finished' && m.cargador?.nombre ? ` · cargó ${m.cargador.nombre}` : ''}
                    {!isEditable && <Text style={{ color: COLORS.green }}> ✓</Text>}
                  </Text>
                  <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap: SPACING.sm }}>
                    <Text style={[styles.cardName, { flex: 1, textAlign:'center', fontSize: 13 }]}>{m.home?.nombre ?? m.equipo_local}</Text>
                    {isEditable
                      ? <>
                          <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 24, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder={m.status === 'finished' ? String(m.goles_home) : '0'} placeholderTextColor={COLORS.gray} value={sc.home ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], home: v } }))} />
                          <Text style={[styles.cardName, { color: COLORS.gray }]}>:</Text>
                          <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 24, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder={m.status === 'finished' ? String(m.goles_away) : '0'} placeholderTextColor={COLORS.gray} value={sc.away ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], away: v } }))} />
                        </>
                      : <Text style={[styles.cardName, { color: COLORS.gold, marginHorizontal: 8 }]}>
                          {m.goles_home} - {m.goles_away}{m.fue_a_penales ? `  (pen ${m.goles_pen_home}-${m.goles_pen_away})` : ''}
                        </Text>
                    }
                    <Text style={[styles.cardName, { flex: 1, textAlign:'center', fontSize: 13 }]}>{m.away?.nombre ?? m.equipo_visitante}</Text>
                  </View>
                  {showPen && (
                    <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap: SPACING.sm, marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.navy }}>
                      <Text style={[styles.cardSub, { flex: 1, color: COLORS.gold }]}>🎯 Penales</Text>
                      <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 20, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.penHome ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], penHome: v } }))} />
                      <Text style={[styles.cardName, { color: COLORS.gray }]}>:</Text>
                      <TextInput style={[styles.input, { width: 52, textAlign:'center', fontFamily: FONTS.heading, fontSize: 20, padding: 4 }]} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.penAway ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], penAway: v } }))} />
                      <Text style={[styles.cardSub, { flex: 1, textAlign:'right', color: COLORS.gold }]}>muerte súbita</Text>
                    </View>
                  )}
                  {isEditable && koMissingTeams && (
                    <Text style={[styles.cardSub, { color: COLORS.gold, marginTop: SPACING.sm, textAlign:'center' }]}>
                      ⏳ Esperando ganadores de la fase anterior
                    </Text>
                  )}
                  {/* Marcador EN VIVO — alimenta la Pantalla en Vivo sin cerrar el partido */}
                  {isEditable && m.status !== 'finished' && !koMissingTeams && (
                    <>
                      <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'center', gap: SPACING.sm, marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.navy }}>
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, alignItems:'center', justifyContent:'center', borderWidth: 1, borderColor: COLORS.line, opacity: liveSavingMatch === m.id ? 0.5 : 1 }}
                          onPress={() => bumpLiveGoal(m, 'home', -1)} disabled={liveSavingMatch === m.id}
                        >
                          <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray2, lineHeight: 20 }}>−</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.green, borderRadius: RADIUS.sm, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, alignItems:'center', justifyContent:'center', opacity: liveSavingMatch === m.id ? 0.5 : 1 }}
                          onPress={() => bumpLiveGoal(m, 'home', +1)} disabled={liveSavingMatch === m.id}
                        >
                          <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.bg }}>{scoring.icon} +1</Text>
                        </TouchableOpacity>
                        <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.gold, minWidth: 64, textAlign:'center' }}>
                          {m.goles_home ?? 0} : {m.goles_away ?? 0}
                        </Text>
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.green, borderRadius: RADIUS.sm, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, alignItems:'center', justifyContent:'center', opacity: liveSavingMatch === m.id ? 0.5 : 1 }}
                          onPress={() => bumpLiveGoal(m, 'away', +1)} disabled={liveSavingMatch === m.id}
                        >
                          <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.bg }}>+1 {scoring.icon}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, paddingVertical: 10, paddingHorizontal: 12, minHeight: 44, alignItems:'center', justifyContent:'center', borderWidth: 1, borderColor: COLORS.line, opacity: liveSavingMatch === m.id ? 0.5 : 1 }}
                          onPress={() => bumpLiveGoal(m, 'away', -1)} disabled={liveSavingMatch === m.id}
                        >
                          <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gray2, lineHeight: 20 }}>−</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, textAlign:'center', marginTop: 4 }}>
                        {`🔴 EN VIVO · el ${scoring.unidad} sale al instante en la Pantalla en Vivo · cerrás con "Guardar resultado"`}
                      </Text>
                    </>
                  )}
                  {isEditable && (
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: m.status === 'finished' ? COLORS.blue + 'CC' : COLORS.green + 'CC', marginTop: SPACING.sm, opacity: (savingMatch === m.id || koMissingTeams) ? 0.5 : 1 }]}
                      onPress={() => saveResult(m)}
                      disabled={savingMatch === m.id || koMissingTeams}
                    >
                      {savingMatch === m.id
                        ? <ActivityIndicator color={COLORS.white} size="small" />
                        : <Text style={styles.btnText}>{m.status === 'finished' ? '✏️ Editar resultado' : '✓ Guardar resultado'}</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>
                );
              };
              return (
                <>
                  <MatchTimer eventId={eventId} mode="control" />
                  {eventLocked && <Text style={[styles.cardSub, { color: COLORS.gold, marginBottom: SPACING.sm, textAlign:'center' }]}>🔒 Evento finalizado — resultados bloqueados</Text>}
                  {matches.length === 0 && <Text style={styles.empty}>Sin partidos. Genera el fixture primero.</Text>}
                  {pendingMatches.map(m => renderMatchCard(m, !eventLocked))}
                  {finishedMatches.length > 0 && (
                    <>
                      {pendingMatches.length > 0 && <Text style={[styles.cardSub, { marginTop: SPACING.md, marginBottom: 4, color: COLORS.green }]}>REGISTRADOS ({finishedMatches.length})</Text>}
                      {finishedMatches.map(m => renderMatchCard(m, !eventLocked))}
                    </>
                  )}
                </>
              );
            })()}

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
                      <Text style={[styles.cardName, { color: COLORS.gold }]}>🥇 {playerMap.get(mvpResult.user_id)?.nombre ?? mvpResult.users?.nombre ?? 'Jugador'}</Text>
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
                          const info = playerMap.get(uid);
                          return (
                            <View key={uid} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical: 2 }}>
                              <Text style={styles.cardSub}>{info?.nombre ?? 'Jugador'}</Text>
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

            {/* ═══ GANANCIA (protegida con PIN de confidencialidad) ═══ */}
            {tab === 'Ganancia' && event && (
              !gananciaUnlocked ? (
                <View style={styles.card}>
                  <Text style={styles.cardName}>🔒 Ganancias confidenciales</Text>
                  <Text style={[styles.cardSub, { marginBottom: SPACING.sm }]}>
                    Ingresá el PIN de confidencialidad para ver las ganancias de este evento.
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="PIN"
                    placeholderTextColor={COLORS.gray}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={8}
                    value={gananciaPinInput}
                    onChangeText={setGananciaPinInput}
                    onSubmitEditing={tryUnlockGanancia}
                  />
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.green, marginTop: SPACING.sm }]} onPress={tryUnlockGanancia}>
                    <Text style={styles.btnText}>Ver ganancias</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.card}>
                    <Text style={styles.cardName}>{event.nombre}</Text>
                    <Text style={styles.cardSub}>{event.deporte} · {event.formato} · {event.genero}</Text>
                    <Text style={styles.cardSub}>
                      Cancha: {event.cancha_costo != null
                        ? <Text style={{ color: COLORS.gold }}>${Number(event.cancha_costo).toFixed(2)}</Text>
                        : <Text style={{ color: COLORS.red }}>sin definir</Text>}
                    </Text>
                    {event.cancha_costo == null && (
                      <Text style={[styles.cardSub, { color: COLORS.red, marginTop: 4 }]}>
                        ⚠ Definí el costo de la cancha desde "Editar evento" (Config) para que el cálculo sea real.
                      </Text>
                    )}
                  </View>
                  <GananciaCard
                    event={event}
                    inscritosConfirmados={players.length}
                    gestorEnEvento={players.some((p) => p._key === event.created_by)}
                  />
                </>
              )
            )}

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

      {/* Modal: lista de inscritos para quitar */}
      <Modal visible={removeListModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <View style={[styles.modalHeader, { borderBottomColor: COLORS.red + '80', backgroundColor: COLORS.red + '20' }]}>
              <Text style={[styles.modalTitle, { color: COLORS.red }]}>🚫 Quitar inscrito</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Elegí a quién quitar. Se le devuelve el 100% a sus créditos y se le avisa el motivo. El cupo queda libre para tu reemplazo.</Text>
              <ScrollView style={{ maxHeight: 320, marginTop: SPACING.sm }}>
                {removeInscritos.length === 0 && <Text style={styles.empty}>No hay inscritos con cuenta para quitar.</Text>}
                {removeInscritos.map((r) => (
                  <View key={r.id} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }]}>
                    <Text style={[styles.cardName, { flex: 1 }]} numberOfLines={1}>{r.users?.nombre ?? 'Jugador'}</Text>
                    <Text style={styles.cardSub}>
                      {r.status === 'pending' ? '⏳ ' : ''}{r.metodo_pago ?? ''}{r.monto_pagado ? ` · $${Number(r.monto_pagado).toFixed(2)}` : ''}
                    </Text>
                    <TouchableOpacity
                      style={[styles.btnSmall, { backgroundColor: COLORS.red + '40' }]}
                      onPress={() => { setRemoveTarget({ reg_id: r.id, user_id: r.user_id, nombre: r.users?.nombre, monto: r.monto_pagado, metodo: r.metodo_pago }); setRemoveMotivo(''); }}
                    >
                      <Text style={[styles.btnSmallText, { color: COLORS.red }]}>Quitar</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.navy, marginTop: SPACING.sm }]} onPress={() => setRemoveListModal(false)}>
                <Text style={styles.modalBtnText}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: motivo de la remoción */}
      <Modal visible={!!removeTarget} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={[styles.modalHeader, { borderBottomColor: COLORS.red + '80', backgroundColor: COLORS.red + '20' }]}>
              <Text style={[styles.modalTitle, { color: COLORS.red }]} numberOfLines={1}>Quitar a {removeTarget?.nombre ?? 'jugador'}</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Motivo (se le envía al jugador por aviso y correo)</Text>
              <TextInput
                style={[styles.modalInput, { height: 76, textAlignVertical: 'top' }]}
                value={removeMotivo}
                onChangeText={setRemoveMotivo}
                placeholder="Ej: no completó el pago / cupo reasignado / conducta"
                placeholderTextColor={COLORS.gray}
                multiline
                autoFocus
              />
              <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 6 }}>
                {removeTarget?.monto ? `Se devolverá $${Number(removeTarget.monto).toFixed(2)} a sus créditos (si el pago fue recibido).` : 'Sin pago registrado que devolver.'}
              </Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.navy, flex: 1 }]} onPress={() => setRemoveTarget(null)} disabled={removeBusy}>
                  <Text style={styles.modalBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.red, flex: 1, opacity: removeMotivo.trim() && !removeBusy ? 1 : 0.4 }]}
                  onPress={confirmRemove}
                  disabled={removeBusy || !removeMotivo.trim()}
                >
                  <Text style={styles.modalBtnText}>{removeBusy ? '...' : 'Quitar del evento'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal agregar jugador invitado */}
      <Modal visible={addGuestModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <View style={[styles.modalHeader, { borderBottomColor: COLORS.green + '80', backgroundColor: COLORS.green + '20' }]}>
              <Text style={[styles.modalTitle, { color: COLORS.green }]}>➕ Agregar jugador</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalSubtitle}>Nombre del jugador</Text>
              <TextInput
                style={styles.modalInput}
                value={addGuestName}
                onChangeText={setAddGuestName}
                placeholder="Ej: Carlos Ruiz"
                placeholderTextColor={COLORS.gray}
                autoFocus
              />
              <Text style={[styles.modalSubtitle, { marginTop: SPACING.sm }]}>Género</Text>
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 4, marginBottom: SPACING.sm }}>
                {['Masculino', 'Femenino'].map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, { flex: 1, justifyContent: 'center' }, addGuestGenero === g && styles.chipActive]}
                    onPress={() => setAddGuestGenero(g)}
                  >
                    <Text style={[styles.chipText, addGuestGenero === g && { color: COLORS.white }]}>
                      {g === 'Masculino' ? '♂ Masc.' : '♀ Fem.'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection:'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.navy, flex: 1 }]}
                  onPress={() => { setAddGuestModal(false); setAddGuestName(''); setAddGuestGenero(null); }}
                >
                  <Text style={styles.modalBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: COLORS.green, flex: 1, opacity: addGuestName.trim() && addGuestGenero ? 1 : 0.4 }]}
                  onPress={addGuest}
                  disabled={!addGuestName.trim() || !addGuestGenero}
                >
                  <Text style={styles.modalBtnText}>✓ Agregar</Text>
                </TouchableOpacity>
              </View>
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
                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.color, borderWidth: (editTeamForm.color === c.color && !editTeamForm.logo_url) ? 3 : 1, borderColor: (editTeamForm.color === c.color && !editTeamForm.logo_url) ? COLORS.white : COLORS.navy }}
                    onPress={() => setEditTeamForm(f => ({ ...f, color: c.color, logo_url: null }))}
                  />
                ))}
              </View>

              {/* 🌍 Selección (Mundial) — opcional: setea país + color de peto + bandera */}
              <Text style={[styles.modalSubtitle, { marginTop: SPACING.sm }]}>🌍 Selección (Mundial) — opcional</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {WC_SELECCIONES.map((s) => {
                    const url = flagUrl(s.code);
                    const active = editTeamForm.logo_url === url;
                    return (
                      <TouchableOpacity
                        key={s.code}
                        style={{ alignItems: 'center', width: 50 }}
                        onPress={() => setEditTeamForm(f => ({ ...f, nombre: s.nombre, color: s.color, logo_url: url }))}
                      >
                        <Image
                          source={{ uri: url }}
                          style={{ width: 36, height: 36, borderRadius: 18, borderWidth: active ? 3 : 1, borderColor: active ? COLORS.white : COLORS.navy, backgroundColor: COLORS.card }}
                          resizeMode="cover"
                        />
                        <Text numberOfLines={1} style={{ fontFamily: FONTS.body, fontSize: 9, color: active ? COLORS.white : COLORS.gray2, marginTop: 2, width: 50, textAlign: 'center' }}>{s.nombre}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
              {editTeamForm.logo_url ? (
                <TouchableOpacity onPress={() => setEditTeamForm(f => ({ ...f, logo_url: null }))} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.blue2 }}>✕ Quitar bandera (usar solo color)</Text>
                </TouchableOpacity>
              ) : null}
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
// NOTICIAS Y ANUNCIOS
// ═══════════════════════════════════════════════════════════════════
function AdminNews({ navigation }) {
  const [news,       setNews]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [sending,    setSending]    = useState(false);
  const [form,       setForm]       = useState({ titulo: '', contenido: '', tipo: 'noticia' });
  const TIPOS = ['noticia', 'resultados', 'oferta', 'aviso'];

  useEffect(() => { fetchNews(); }, []);

  async function fetchNews() {
    setLoading(true);
    const { data } = await supabase.from('news').select('*').order('created_at', { ascending: false }).limit(50);
    setNews(data ?? []);
    setLoading(false);
  }

  async function publishNews() {
    if (!form.titulo.trim() || !form.contenido.trim()) {
      Alert.alert('Error', 'Título y contenido son obligatorios.'); return;
    }
    setSending(true);
    try {
      // Save to news table
      const { error } = await supabase.from('news').insert({
        titulo:    form.titulo.trim(),
        contenido: form.contenido.trim(),
        tipo:      form.tipo,
      });
      if (error) { Alert.alert('Error al guardar', error.message); return; }

      // Enviar push a todos los usuarios
      broadcastNotification(
        `📢 ${form.titulo.trim()}`,
        form.contenido.trim().slice(0, 120),
        { url: 'https://birrea2play.com' },
      ).then(res => {
        const a = res?.result?.audience ?? 0;
        Alert.alert('✅ Publicado', `Noticia guardada. Push enviado a ${a} dispositivos.`);
      }).catch(() => {
        Alert.alert('✅ Publicado', 'Noticia guardada (push no pudo enviarse).');
      });
      fetchNews();
      setForm({ titulo: '', contenido: '', tipo: 'noticia' });
    } finally {
      setSending(false);
    }
  }

  async function deleteNews(id) {
    Alert.alert('Eliminar', '¿Eliminar esta noticia?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        await supabase.from('news').delete().eq('id', id);
        setNews(prev => prev.filter(n => n.id !== id));
      }},
    ]);
  }

  const TIPO_COLOR = { noticia: COLORS.blue, resultados: COLORS.green, oferta: COLORS.gold, aviso: COLORS.red };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection:'row', alignItems:'center', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { flex:1, marginBottom:0, marginLeft: SPACING.sm }]}>📢 NOTICIAS</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">

        {/* Formulario nueva noticia */}
        <View style={[styles.card, { borderColor: COLORS.blue + '60' }]}>
          <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>Nueva noticia / anuncio</Text>
          <Text style={styles.cardSub}>Título</Text>
          <TextInput
            style={[styles.input, { marginBottom: SPACING.sm }]}
            placeholder="Ej: ¡Torneo de verano inscripciones abiertas!"
            placeholderTextColor={COLORS.gray}
            value={form.titulo}
            onChangeText={v => setForm(f => ({ ...f, titulo: v }))}
            maxLength={100}
          />
          <Text style={styles.cardSub}>Contenido</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical:'top', marginBottom: SPACING.sm }]}
            placeholder="Descripción o detalle del anuncio..."
            placeholderTextColor={COLORS.gray}
            value={form.contenido}
            onChangeText={v => setForm(f => ({ ...f, contenido: v }))}
            multiline
            maxLength={500}
          />
          <Text style={styles.cardSub}>Tipo</Text>
          <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 6, marginBottom: SPACING.md }}>
            {TIPOS.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, form.tipo === t && { backgroundColor: TIPO_COLOR[t] ?? COLORS.blue, borderColor: TIPO_COLOR[t] ?? COLORS.blue }]}
                onPress={() => setForm(f => ({ ...f, tipo: t }))}
              >
                <Text style={[styles.chipText, form.tipo === t && { color: COLORS.white }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: COLORS.blue, opacity: sending ? 0.6 : 1 }]}
            onPress={publishNews}
            disabled={sending}
          >
            {sending
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text style={styles.btnText}>📢 Publicar y enviar push</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Lista de noticias publicadas */}
        <Text style={[styles.cardSub, { color: COLORS.gold, marginBottom: 4 }]}>PUBLICADAS ({news.length})</Text>
        {news.length === 0 && <Text style={styles.empty}>No hay noticias publicadas aún.</Text>}
        {news.map(n => (
          <View key={n.id} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: TIPO_COLOR[n.tipo] ?? COLORS.blue }]}>
            <View style={{ flexDirection:'row', alignItems:'flex-start', gap: SPACING.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{n.titulo}</Text>
                <Text style={[styles.cardSub, { marginTop: 2 }]}>{n.contenido}</Text>
                <Text style={[styles.cardSub, { fontSize: 10, color: COLORS.gray, marginTop: 4 }]}>
                  {n.tipo?.toUpperCase()} · {new Date(n.created_at).toLocaleDateString('es-PA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: COLORS.red + '30', borderColor: COLORS.red }]}
                onPress={() => deleteNews(n.id)}
              >
                <Text style={[styles.btnSmallText, { color: COLORS.red }]}>🗑</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RECARGAS YAPPY (admin approval queue)
// ═══════════════════════════════════════════════════════════════════
function AdminRecargas() {
  const user = useAuthStore((s) => s.user);
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
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
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PAGOS EN EFECTIVO — ADMIN
// ═══════════════════════════════════════════════════════════════════
function AdminCashApprovals({ navigation }) {
  const [requests,   setRequests]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState(null);

  useEffect(() => { fetchRequests(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', fetchRequests);
    return unsub;
  }, [navigation]);

  async function fetchRequests() {
    setLoading(true);
    // Marcar como 'expired' las que pasaron el plazo antes de listar.
    Promise.resolve(supabase.rpc('expire_pending_cash_requests')).catch(() => {});

    const { data } = await supabase
      .from('cash_payment_requests')
      .select('*, user:users!user_id(nombre, correo), event:events!event_id(nombre, precio, created_by, gestor:users!created_by(nombre))')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });
    setRequests(data ?? []);
    setLoading(false);
  }

  async function approve(r) {
    setProcessing(r.id);
    try {
      const { error } = await supabase.rpc('admin_approve_cash_request', { p_request_id: r.id });
      if (error) throw error;
      fetchRequests();
      Alert.alert('✅ Aprobado', `${r.user?.nombre} ha sido inscrito.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function reject(r) {
    // Confirmación explícita antes de rechazar.
    Alert.alert(
      'Rechazar pago en efectivo',
      `¿Confirmas rechazar la solicitud de ${r.user?.nombre ?? 'este usuario'}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, rechazar',
          style: 'destructive',
          onPress: async () => {
            if (processing) return;
            setProcessing(r.id);
            try {
              // RPC atómico: rechaza + cancela la inscripción 'pending' (libera
              // el cupo + promueve waitlist). Antes la inscripción quedaba zombie.
              const { error } = await supabase.rpc('admin_reject_cash_request', { p_request_id: r.id });
              if (error) throw error;
              Alert.alert('Rechazado', `Solicitud de ${r.user?.nombre ?? 'usuario'} rechazada. El cupo quedó liberado.`);
              fetchRequests();
            } catch (e) {
              Alert.alert('Error al rechazar', e?.message ?? 'Intenta nuevamente.');
            } finally {
              setProcessing(null);
            }
          },
        },
      ],
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>PAGOS EN EFECTIVO</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        {requests.length === 0 && <Text style={styles.empty}>Sin solicitudes pendientes</Text>}
        {requests.map((r) => {
          const expired   = new Date(r.expires_at) < new Date();
          const hoursLeft = Math.max(0, Math.ceil((new Date(r.expires_at) - new Date()) / 3600000));
          return (
            <View key={r.id} style={[styles.card, expired && { borderColor: COLORS.red + '44', opacity: 0.7 }]}>
              <Text style={styles.cardName}>{r.user?.nombre}</Text>
              <Text style={styles.cardSub}>{r.event?.nombre}</Text>
              <Text style={styles.cardSub}>Gestor: {r.event?.gestor?.nombre ?? '—'}</Text>
              <Text style={styles.cardSub}>{r.user?.correo}</Text>
              <Text style={[styles.cardSub, { color: expired ? COLORS.red : COLORS.gold }]}>
                {expired ? '⚠️ Expirado' : `⏳ ${hoursLeft}h restantes`}
              </Text>
              <Text style={styles.cardSub}>Monto: ${Number(r.amount).toFixed(2)}</Text>
              {!expired && (
                <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: COLORS.green ?? '#22c55e', flex: 1 }]}
                    onPress={() => approve(r)}
                    disabled={processing === r.id}
                  >
                    <Text style={styles.btnText}>{processing === r.id ? '...' : '✅ Aprobar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: COLORS.red, flex: 1 }]}
                    onPress={() => reject(r)}
                    disabled={processing === r.id}
                  >
                    <Text style={styles.btnText}>❌ Rechazar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// COBRO EFECTIVO — histórico de aprobados + gestión de cobro
// ═══════════════════════════════════════════════════════════════════
function AdminCashCobro({ navigation }) {
  const [list,       setList]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [processing, setProcessing] = useState(null);

  useEffect(() => { fetchCobro(); }, []);
  useEffect(() => navigation.addListener('focus', fetchCobro), [navigation]);

  async function fetchCobro() {
    setLoading(true);
    const { data } = await supabase
      .from('cash_payment_requests')
      .select('*, user:users!user_id(nombre, correo, telefono), event:events!event_id(nombre, gestor:users!created_by(nombre))')
      .eq('status', 'approved')
      .order('cobrado', { ascending: true })
      .order('created_at', { ascending: false });
    setList(data ?? []);
    setLoading(false);
  }

  async function toggleCobrado(r) {
    setProcessing(r.id);
    const newVal = !r.cobrado;
    const { error } = await supabase.rpc('admin_marcar_cash_cobrado', { p_id: r.id, p_cobrado: newVal });
    setProcessing(null);
    if (error) { Alert.alert('Error', error.message); return; }
    setList((prev) => prev.map((x) => x.id === r.id ? { ...x, cobrado: newVal, cobrado_at: newVal ? new Date().toISOString() : null } : x));
  }

  const pend = list.filter((r) => !r.cobrado);
  const totalPend = pend.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingTop: SPACING.sm }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { flex: 1, marginBottom: 0, marginLeft: SPACING.sm }]}>🧾 COBRO EFECTIVO</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
        <View style={[styles.card, { borderColor: COLORS.gold + '60' }]}>
          <Text style={styles.cardName}>Pendiente de cobro</Text>
          <Text style={[styles.cardSub, { color: COLORS.gold }]}>{pend.length} solicitud(es) · ${totalPend.toFixed(2)}</Text>
        </View>
        {list.length === 0 && <Text style={styles.empty}>Sin aprobaciones de efectivo todavía.</Text>}
        {list.map((r) => (
          <View key={r.id} style={[styles.card, r.cobrado && { opacity: 0.6, borderLeftWidth: 3, borderLeftColor: COLORS.green }]}>
            <Text style={styles.cardName}>{r.user?.nombre ?? '—'}</Text>
            <Text style={styles.cardSub}>{r.event?.nombre ?? '—'}</Text>
            <Text style={styles.cardSub}>Gestor: {r.event?.gestor?.nombre ?? '—'}</Text>
            <Text style={styles.cardSub}>📞 {r.user?.telefono ?? r.user?.correo ?? '—'}</Text>
            <Text style={styles.cardSub}>Monto: ${Number(r.amount ?? 0).toFixed(2)} · Aprobado {r.created_at ? new Date(r.created_at).toLocaleDateString('es-PA') : '—'}</Text>
            {r.cobrado && r.cobrado_at && (
              <Text style={[styles.cardSub, { color: COLORS.green }]}>✓ Cobrado {new Date(r.cobrado_at).toLocaleDateString('es-PA')}</Text>
            )}
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: r.cobrado ? COLORS.navy : COLORS.green, marginTop: SPACING.sm, opacity: processing === r.id ? 0.6 : 1 }]}
              onPress={() => toggleCobrado(r)}
              disabled={processing === r.id}
            >
              <Text style={styles.btnText}>{r.cobrado ? '↩ Marcar como pendiente' : '💵 Marcar como cobrado'}</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CANCHAS DEL SISTEMA
// ═══════════════════════════════════════════════════════════════════
function AdminCanchas({ navigation }) {
  const [canchas, setCanchas]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editModal, setEditModal] = useState(null); // null | cancha obj

  async function fetchCanchas() {
    setLoading(true);
    const { data, error } = await supabase
      .from('canchas')
      .select('*, owner:owner_id ( id, nombre, correo, telefono )')
      .order('nombre', { ascending: true });
    if (error) Alert.alert('Error', error.message);
    else setCanchas(data ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchCanchas(); }, []);

  async function toggleActiva(cancha) {
    const { error } = await supabase
      .from('canchas')
      .update({ activa: !cancha.activa })
      .eq('id', cancha.id);
    if (error) Alert.alert('Error', error.message);
    else fetchCanchas();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { flex: 1, padding: 0 }]}>CANCHAS DEL SISTEMA</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={COLORS.red} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
          <Text style={styles.sectionTitle}>
            {canchas.length} cancha{canchas.length !== 1 ? 's' : ''} registrada{canchas.length !== 1 ? 's' : ''}
          </Text>
          <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12, marginBottom: SPACING.md }}>
            Para agregar Fredy Sport Center y Futbol Total Villa Lucre: primero registrar a sus admins como cancha_admin en Usuarios, luego ejecutar el seed SQL comentado en la migracion 20260622000001.
          </Text>

          {canchas.map((c) => (
            <View key={c.id} style={[styles.card, { marginBottom: SPACING.sm }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 15, flex: 1 }}>{c.nombre}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ backgroundColor: c.activa ? COLORS.green + '22' : COLORS.gray + '22', borderRadius: RADIUS.sm, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: c.activa ? COLORS.green : COLORS.gray }}>
                    <Text style={{ fontFamily: FONTS.bodyBold, color: c.activa ? COLORS.green : COLORS.gray, fontSize: 10 }}>
                      {c.activa ? 'ACTIVA' : 'INACTIVA'}
                    </Text>
                  </View>
                </View>
              </View>

              {!!c.direccion && (
                <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12, marginTop: 2 }}>{c.direccion}</Text>
              )}
              {c.precio_hora != null && (
                <Text style={{ fontFamily: FONTS.body, color: COLORS.gold, fontSize: 13, marginTop: 4 }}>
                  ${Number(c.precio_hora).toFixed(2)} / hora
                </Text>
              )}

              <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 12, marginTop: SPACING.sm }}>
                Admin: {c.owner?.nombre ?? '—'} · {c.owner?.correo ?? ''}
              </Text>
              {!!c.owner?.telefono && (
                <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 }}>Tel: {c.owner.telefono}</Text>
              )}

              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderColor: COLORS.line }}
                  onPress={() => setEditModal(c)}
                >
                  <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 12 }}>Editar datos</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: c.activa ? COLORS.red + '22' : COLORS.green + '22', borderRadius: RADIUS.sm, paddingVertical: 7, alignItems: 'center', borderWidth: 1, borderColor: c.activa ? COLORS.red : COLORS.green }}
                  onPress={() => toggleActiva(c)}
                >
                  <Text style={{ fontFamily: FONTS.bodySemiBold, color: c.activa ? COLORS.red : COLORS.green, fontSize: 12 }}>
                    {c.activa ? 'Desactivar' : 'Activar'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {canchas.length === 0 && (
            <Text style={styles.empty}>No hay canchas registradas aun.</Text>
          )}
        </ScrollView>
      )}

      {editModal && (
        <AdminCanchaEditModal
          cancha={editModal}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); fetchCanchas(); }}
        />
      )}
    </SafeAreaView>
  );
}

function AdminCanchaEditModal({ cancha, onClose, onSaved }) {
  const [nombre,    setNombre]    = useState(cancha.nombre ?? '');
  const [direccion, setDireccion] = useState(cancha.direccion ?? '');
  const [telefono,  setTelefono]  = useState(cancha.telefono ?? '');
  const [precio,    setPrecio]    = useState(cancha.precio_hora?.toString() ?? '');
  const [saving,    setSaving]    = useState(false);

  async function handleSave() {
    if (!nombre.trim()) { Alert.alert('Error', 'Nombre obligatorio'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('canchas')
      .update({
        nombre:    nombre.trim(),
        direccion: direccion.trim() || null,
        telefono:  telefono.trim() || null,
        precio_hora: precio ? Number(precio) : null,
      })
      .eq('id', cancha.id);
    setSaving(false);
    if (error) Alert.alert('Error', error.message);
    else onSaved();
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: SPACING.md }}>
        <View style={{ backgroundColor: COLORS.bg2, borderRadius: RADIUS.lg, padding: SPACING.lg }}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, marginBottom: SPACING.md, letterSpacing: 1 }}>
            Editar cancha
          </Text>

          {[
            { label: 'Nombre *', value: nombre, set: setNombre },
            { label: 'Dirección', value: direccion, set: setDireccion },
            { label: 'Teléfono', value: telefono, set: setTelefono, keyboard: 'phone-pad' },
            { label: 'Precio / hora ($)', value: precio, set: setPrecio, keyboard: 'decimal-pad' },
          ].map(({ label, value, set, keyboard }) => (
            <View key={label}>
              <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 12, marginTop: SPACING.sm, marginBottom: 4 }}>{label}</Text>
              <TextInput
                value={value}
                onChangeText={set}
                style={{ backgroundColor: COLORS.card, color: COLORS.white, padding: 10, borderRadius: RADIUS.sm, fontFamily: FONTS.body, fontSize: 14, borderWidth: 1, borderColor: COLORS.line }}
                keyboardType={keyboard ?? 'default'}
                placeholderTextColor={COLORS.gray}
              />
            </View>
          ))}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm, marginTop: SPACING.md }}>
            <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: COLORS.card, borderRadius: RADIUS.sm }} onPress={onClose} disabled={saving}>
              <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 13 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: COLORS.red, borderRadius: RADIUS.sm }} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ fontFamily: FONTS.bodyBold, color: '#fff', fontSize: 13 }}>Guardar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// STACK NAVIGATOR
// ═══════════════════════════════════════════════════════════════════
export default function AdminPanel() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AdminDashboard"      component={AdminDashboard} />
      <Stack.Screen name="AdminRequests"       component={AdminRequests} />
      <Stack.Screen name="AdminGenderRequests" component={AdminGenderRequests} />
      <Stack.Screen name="AdminRecargas"       component={AdminRecargas} />
      <Stack.Screen name="AdminCashApprovals"  component={AdminCashApprovals} />
      <Stack.Screen name="AdminCashCobro"       component={AdminCashCobro} />
      <Stack.Screen name="AdminUsers"          component={AdminUsers} />
      <Stack.Screen name="AdminWallets"        component={AdminWallets} />
      <Stack.Screen name="AdminInventory"      component={AdminInventory} />
      <Stack.Screen name="AdminEvents"         component={AdminEvents} />
      <Stack.Screen name="AdminOrders"         component={AdminOrders} />
      <Stack.Screen name="AdminManageEvent"    component={AdminManageEvent} />
      <Stack.Screen name="AdminNews"           component={AdminNews} />
      <Stack.Screen name="AdminMundial"        component={WCAdminPanel} />
      <Stack.Screen name="AdminClub"           component={ClubAdminPanel} />
      <Stack.Screen name="AdminRaffle"         component={AdminRaffle} />
      <Stack.Screen name="AdminCanchas"        component={AdminCanchas} />
      <Stack.Screen name="AdminQRScanner"      component={AdminQRScannerScreen} />
    </Stack.Navigator>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN RIFA
// ═══════════════════════════════════════════════════════════════════
function AdminRaffle({ navigation }) {
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null); // event objeto

  useEffect(() => {
    supabase.from('events').select('id, nombre, fecha, status')
      .neq('status', 'cancelled')
      .order('fecha', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) console.warn('AdminRaffle load events error:', error.message);
        setEvents(data ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  if (selected) {
    return <AdminRaffleDetail event={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>RIFA — SELECCIONAR EVENTO</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {events.length === 0 && <Text style={styles.empty}>No hay eventos recientes</Text>}
        {events.map(ev => (
          <TouchableOpacity key={ev.id} style={styles.card} onPress={() => setSelected(ev)}>
            <Text style={styles.cardName}>{ev.nombre}</Text>
            <Text style={styles.cardSub}>{ev.fecha ? new Date(ev.fecha).toLocaleString('es-PA', { dateStyle:'medium', timeStyle:'short' }) : ev.status}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function AdminRaffleDetail({ event, onBack }) {
  const [state,    setState]    = useState(null);
  const [tickets,  setTickets]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [setup,    setSetup]    = useState(false);
  const [prize,    setPrize]    = useState('Camiseta Aniversario');
  const [yappy,    setYappy]    = useState('');
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    const [{ data: st }, { data: tk }] = await Promise.all([
      supabase.rpc('raffle_get_status', { p_event_id: event.id }),
      supabase.from('raffle_tickets')
        .select('*, users:user_id(nombre)')
        .eq('event_id', event.id)
        .order('created_at', { ascending: false }),
    ]);
    setState(st);
    setTickets(tk ?? []);
    setLoading(false);
    if (st?.active) { setPrize(st.prize_name); setYappy(st.yappy_number ?? ''); }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  async function saveSetup() {
    if (!yappy.trim()) { Alert.alert('Falta', 'Número Yappy requerido'); return; }
    setSaving(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_setup', { p_event_id: event.id, p_prize_name: prize, p_yappy_number: yappy.trim() }));
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setSetup(false);
    load();
  }

  async function spin() {
    setBusy(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_spin', { p_event_id: event.id }));
    setBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function confirmWinner() {
    setBusy(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_confirm_winner', { p_event_id: event.id }));
    setBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function skipWinner() {
    setBusy(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_skip_winner', { p_event_id: event.id }));
    setBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    load();
  }

  async function doConfirmTicket(id) {
    await Promise.resolve(supabase.rpc('raffle_admin_confirm_ticket', { p_ticket_id: id }));
    load();
  }

  async function doCancelTicket(id) {
    await Promise.resolve(supabase.rpc('raffle_admin_cancel_ticket', { p_ticket_id: id }));
    load();
  }

  const pending   = tickets.filter(t => t.status === 'pending');
  const confirmed = tickets.filter(t => t.status === 'confirmed');

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity onPress={onBack} style={{ padding: SPACING.md }}>
        <Text style={[styles.cardSub, { color: COLORS.red }]}>← Volver</Text>
      </TouchableOpacity>
      <Text style={styles.title}>🎟️ RIFA</Text>
      <Text style={[styles.cardSub, { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm }]}>{event.nombre}</Text>

      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>

        {/* Estado y setup */}
        <View style={styles.card}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
            <Text style={styles.cardName}>
              {state?.active ? `Estado: ${state.status}` : 'Rifa no configurada'}
            </Text>
            <TouchableOpacity onPress={() => setSetup(s => !s)}>
              <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyMedium }}>⚙️ Setup</Text>
            </TouchableOpacity>
          </View>
          {state?.active && (
            <>
              <Text style={styles.cardSub}>Premio: {state.prize_name}</Text>
              <Text style={styles.cardSub}>Yappy: {state.yappy_number}</Text>
              <Text style={styles.cardSub}>Pozo: {state.total_pool} tickets (${state.total_pool}.00) · Giros: {state.spin_count}</Text>
            </>
          )}
          {setup && (
            <View style={{ marginTop: SPACING.md }}>
              <TextInput
                style={adminInputStyle} value={prize} onChangeText={setPrize}
                placeholder="Premio" placeholderTextColor={COLORS.gray}
              />
              <TextInput
                style={adminInputStyle} value={yappy} onChangeText={setYappy}
                placeholder="Número Yappy" keyboardType="phone-pad"
                placeholderTextColor={COLORS.gray}
              />
              <TouchableOpacity
                style={[styles.approveBtn, { marginTop: 8 }]}
                onPress={saveSetup} disabled={saving}
              >
                <Text style={styles.approveBtnText}>{saving ? 'Guardando...' : 'Guardar y abrir rifa'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Control de giro */}
        {state?.active && state.status !== 'closed' && (
          <View style={styles.card}>
            <Text style={styles.cardName}>Control de giro</Text>
            {state.winner_nom && (
              <Text style={[styles.cardSub, { color: COLORS.gold, fontSize: 16, marginBottom: SPACING.sm }]}>
                🏆 Último resultado: {state.winner_nom}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.approveBtn, busy && { opacity: 0.5 }]}
              onPress={spin} disabled={busy}
            >
              <Text style={styles.approveBtnText}>🎯 GIRAR</Text>
            </TouchableOpacity>
            {state.status === 'spinning' && state.winner_nom && (
              <View style={{ marginTop: SPACING.md, flexDirection: 'row', gap: SPACING.sm }}>
                <TouchableOpacity
                  style={[styles.approveBtn, { flex:1, backgroundColor: COLORS.green }]}
                  onPress={confirmWinner} disabled={busy}
                >
                  <Text style={styles.approveBtnText}>✓ Presente</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.rejectBtn, { flex:1 }]}
                  onPress={skipWinner} disabled={busy}
                >
                  <Text style={styles.rejectBtnText}>✕ No está</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        {state?.active && state.status === 'closed' && (
          <View style={[styles.card, { borderColor: COLORS.gold }]}>
            <Text style={[styles.cardName, { color: COLORS.gold }]}>🏆 RIFA CERRADA</Text>
            <Text style={styles.cardSub}>Ganador: {state.winner_nom}</Text>
          </View>
        )}

        {/* Tickets pendientes */}
        {pending.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardName}>Tickets pendientes ({pending.length})</Text>
            {pending.map(t => (
              <View key={t.id} style={{ flexDirection:'row', alignItems:'center', paddingVertical:6, borderBottomWidth:1, borderColor:COLORS.line, gap: SPACING.sm }}>
                <View style={{ flex:1 }}>
                  <Text style={styles.cardSub}>{t.users?.nombre} — {t.quantity} tkt${t.quantity > 1 ? 's' : ''} (${t.amount_paid.toFixed(2)})</Text>
                </View>
                <TouchableOpacity style={styles.approveBtn} onPress={() => doConfirmTicket(t.id)}>
                  <Text style={styles.approveBtnText}>✓</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => doCancelTicket(t.id)}>
                  <Text style={styles.rejectBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Tickets confirmados */}
        {confirmed.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardName}>Tickets confirmados ({confirmed.reduce((s, t) => s + t.quantity, 0)} en total)</Text>
            {confirmed.map(t => (
              <Text key={t.id} style={styles.cardSub}>
                {t.users?.nombre} — {t.quantity} ticket{t.quantity > 1 ? 's' : ''}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Modal setup inline via variable setup (ya manejado arriba) */}
    </SafeAreaView>
  );
}

const adminInputStyle = {
  backgroundColor: COLORS.bg2, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.line,
  color: COLORS.white, fontFamily: FONTS.body, fontSize: 15, padding: SPACING.md, marginBottom: 8,
};

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
  gateCard:        { marginHorizontal: SPACING.md, marginBottom: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.neon + '44', padding: SPACING.md, gap: 10 },
  gateHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gateTitle:       { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 1 },
  gateDesc:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 ?? COLORS.gray, lineHeight: 17 },
  gateStats:       { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.line ?? '#2A323F', paddingTop: 10, marginTop: 4 },
  gateStat:        { flex: 1, alignItems: 'center' },
  gateStatNum:     { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.neon },
  gateStatLabel:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 ?? COLORS.gray, textAlign: 'center', lineHeight: 16, marginTop: 2 },
  gateStatDivider: { width: 1, backgroundColor: COLORS.line ?? '#2A323F', marginHorizontal: 8 },
  cameraBanner: {
    backgroundColor: COLORS.green + '18', borderWidth: 1, borderColor: COLORS.green,
    borderRadius: 10, padding: SPACING.md, marginHorizontal: SPACING.md, marginBottom: SPACING.md,
  },
  cameraBannerText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },
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
