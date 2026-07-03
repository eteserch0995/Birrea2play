import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Animated, Modal, TextInput,
  KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';

const SPIN_DURATION_MS = 4000;

export default function RaffleScreen({ route, navigation }) {
  const { eventId } = route.params ?? {};
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [raffle,      setRaffle]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [quantity,    setQuantity]    = useState(1);
  const [yappyStep,   setYappyStep]   = useState('idle'); // idle | phone | polling
  const [yappyPhone,  setYappyPhone]  = useState('');
  const [yappyBusy,   setYappyBusy]   = useState(false);
  const [yappyProgress, setYappyProgress] = useState({ attempts: 0, maxAttempts: 60 });
  const yappyCancelRef = useRef(null);
  const [spinning,    setSpinning]    = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [setupModal,  setSetupModal]  = useState(false);
  const [setupPrize,  setSetupPrize]  = useState('Camiseta Aniversario');
  const [saving,      setSaving]      = useState(false);
  const [adminBusy,   setAdminBusy]   = useState(false);
  const [pendingTickets, setPendingTickets] = useState([]);

  const spinIntervalRef = useRef(null);
  const spinTimeoutRef  = useRef(null);
  const fadeAnim        = useRef(new Animated.Value(1)).current;
  const scaleAnim       = useRef(new Animated.Value(1)).current;

  // ── Carga inicial ──────────────────────────────────────────
  const loadRaffle = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('raffle_get_status', { p_event_id: eventId });
    setRaffle(data);
    if (isAdmin) loadPendingTickets();
    setLoading(false);
  }, [eventId, isAdmin]);

  const loadPendingTickets = useCallback(async () => {
    const { data } = await supabase
      .from('raffle_tickets')
      .select('*, users:user_id(nombre)')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    setPendingTickets(data ?? []);
  }, [eventId]);

  useEffect(() => { loadRaffle(); }, [loadRaffle]);

  // ── Realtime ───────────────────────────────────────────────
  useEffect(() => {
    if (!eventId) return;
    const channel = supabase
      .channel(`raffle-state-${eventId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'raffle_state',
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const updated = payload.new;
        setRaffle(prev => prev ? { ...prev, ...buildRaffleFromRaw(updated, prev) } : prev);
        if (updated.status === 'spinning') triggerSpinAnimation(prev => prev?.participants ?? []);
        if (updated.status === 'closed')   stopSpinAnimation();
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'raffle_tickets',
        filter: `event_id=eq.${eventId}`,
      }, () => { loadRaffle(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  function buildRaffleFromRaw(raw, prev) {
    return {
      status:           raw.status,
      current_winner_id: raw.current_winner_id,
      spin_count:       raw.spin_count,
      is_winner:        raw.current_winner_id === prev?.current_winner_id_me,
      winner_confirmed: raw.status === 'closed',
    };
  }

  // ── Animación del spin ─────────────────────────────────────
  function triggerSpinAnimation(participants) {
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    if (spinTimeoutRef.current)  clearTimeout(spinTimeoutRef.current);

    setSpinning(true);
    const names = (participants || []).map(p => p.nombre).filter(Boolean);
    if (names.length === 0) { setSpinning(false); return; }

    let idx = 0;
    let delay = 80;

    function cycle() {
      setDisplayName(names[idx % names.length]);
      idx++;
      delay = Math.min(delay + 18, 400);
      spinIntervalRef.current = setTimeout(cycle, delay);
    }
    cycle();

    spinTimeoutRef.current = setTimeout(() => {
      clearTimeout(spinIntervalRef.current);
      setSpinning(false);
      loadRaffle();
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.4, duration: 200, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1.0, duration: 200, useNativeDriver: true }),
      ]).start();
    }, SPIN_DURATION_MS);
  }

  function stopSpinAnimation() {
    clearTimeout(spinIntervalRef.current);
    clearTimeout(spinTimeoutRef.current);
    setSpinning(false);
    loadRaffle();
  }

  useEffect(() => () => {
    clearTimeout(spinIntervalRef.current);
    clearTimeout(spinTimeoutRef.current);
  }, []);

  // ── Compra de tickets con Yappy ────────────────────────────
  function cancelYappy() {
    yappyCancelRef.current?.();
    yappyCancelRef.current = null;
    setYappyStep('idle');
    setYappyBusy(false);
  }

  async function handleStartYappy() {
    const phone = yappyPhone.replace(/\D/g, '');
    if (phone.length < 7) { Alert.alert('Teléfono inválido', 'Ingresá tu número Yappy'); return; }
    setYappyBusy(true);
    setYappyStep('polling');
    try {
      const { orderId } = await iniciarBotonYappy({
        phone, amount: quantity, tipo: 'rifa', event_id: eventId,
      });
      const { promise, cancel } = pollBotonOrder({
        orderId,
        onProgress: (p) => setYappyProgress(p),
      });
      yappyCancelRef.current = cancel;
      await promise;
      // Pago confirmado — el IPN (server-side) confirma los tickets al recibir el pago real
      // (raffle_confirm_tickets_paid ya no es invocable desde el cliente). Refrescamos.
      setYappyStep('idle');
      setYappyBusy(false);
      Alert.alert('¡Listo!', `Pago de ${quantity} ticket${quantity > 1 ? 's' : ''} confirmado. ¡Buena suerte en la rifa! 🎟️`);
      loadRaffle();
      setTimeout(loadRaffle, 2000);
    } catch (e) {
      setYappyBusy(false);
      setYappyStep('idle');
      if (e?.message !== 'cancelled') Alert.alert('Error en el pago', e?.message ?? 'Intentá de nuevo');
    }
  }

  // ── Admin: setup ───────────────────────────────────────────
  async function handleSetup() {
    setSaving(true);
    const { error } = await Promise.resolve(
      supabase.rpc('raffle_setup', { p_event_id: eventId, p_prize_name: setupPrize })
    );
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setSetupModal(false);
    loadRaffle();
  }

  // ── Admin: girar ───────────────────────────────────────────
  async function handleSpin() {
    if (adminBusy) return;
    setAdminBusy(true);
    const participants = raffle?.participants ?? [];
    const { data, error } = await Promise.resolve(supabase.rpc('raffle_spin', { p_event_id: eventId }));
    setAdminBusy(false);
    if (error) { Alert.alert('Error al girar', error.message); return; }
    triggerSpinAnimation(participants);
    loadRaffle();
  }

  // ── Admin: confirmar presencia ─────────────────────────────
  async function handleConfirm() {
    setAdminBusy(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_confirm_winner', { p_event_id: eventId }));
    setAdminBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    loadRaffle();
  }

  // ── Admin: no presente ────────────────────────────────────
  async function handleSkip() {
    setAdminBusy(true);
    const { error } = await Promise.resolve(supabase.rpc('raffle_skip_winner', { p_event_id: eventId }));
    setAdminBusy(false);
    if (error) { Alert.alert('Error', error.message); return; }
    loadRaffle();
  }

  // ── Admin: confirmar ticket de usuario ────────────────────
  async function confirmTicket(ticketId) {
    const { error } = await Promise.resolve(supabase.rpc('raffle_admin_confirm_ticket', { p_ticket_id: ticketId }));
    if (error) { Alert.alert('Error', error.message); return; }
    loadPendingTickets();
    loadRaffle();
  }

  async function cancelTicket(ticketId) {
    const { error } = await Promise.resolve(supabase.rpc('raffle_admin_cancel_ticket', { p_ticket_id: ticketId }));
    if (error) { Alert.alert('Error', error.message); return; }
    loadPendingTickets();
    loadRaffle();
  }

  // ── Render ────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={styles.safe}>
      <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />
    </SafeAreaView>
  );

  if (!raffle?.active) return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
        <Text style={styles.backText}>← Volver</Text>
      </TouchableOpacity>
      <View style={styles.centerBox}>
        <Text style={styles.emptyIcon}>🎟️</Text>
        <Text style={styles.emptyText}>La rifa no está activa para este evento</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.btnPrimary} onPress={() => setSetupModal(true)}>
            <Text style={styles.btnPrimaryText}>⚙️ Configurar Rifa</Text>
          </TouchableOpacity>
        )}
      </View>
      {renderSetupModal()}
    </SafeAreaView>
  );

  const isWinner    = raffle.is_winner;
  const isConfirmed = raffle.winner_confirmed;
  const showWinner  = raffle.winner_nom && (raffle.status === 'spinning' || raffle.status === 'winner_pending' || raffle.status === 'closed');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top:8,bottom:8,left:8,right:8 }}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>RIFA ANIVERSARIO</Text>
        {isAdmin && (
          <TouchableOpacity onPress={() => setSetupModal(true)}>
            <Text style={styles.settingsIcon}>⚙️</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Premio */}
        <View style={styles.prizeCard}>
          <Image
            source={{ uri: 'https://rumreditrvxkcnlhawut.supabase.co/storage/v1/object/public/products/5c86e797-6d76-44cd-84f8-03fe80d130fa.jpeg' }}
            style={styles.prizeImage}
            resizeMode="cover"
          />
          <Text style={styles.prizeName}>{raffle.prize_name}</Text>
          <Text style={styles.prizeTagline}>$1 por ticket · más tickets = más chances</Text>
        </View>

        {/* Área de spin / ganador */}
        {spinning ? (
          <View style={styles.spinBox}>
            <Text style={styles.spinLabel}>GIRANDO...</Text>
            <Text style={styles.spinName}>{displayName || '...'}</Text>
          </View>
        ) : showWinner ? (
          <Animated.View style={[styles.winnerBox, isConfirmed && styles.winnerBoxConfirmed, { transform: [{ scale: scaleAnim }] }]}>
            {isConfirmed
              ? <Text style={styles.winnerConfirmedTitle}>🏆 ¡GANADOR!</Text>
              : <Text style={styles.winnerTitle}>🎉 ¡POSIBLE GANADOR!</Text>
            }
            <Text style={styles.winnerName}>{raffle.winner_nom}</Text>
            {isConfirmed && <Text style={styles.winnerPrize}>Se lleva la {raffle.prize_name}</Text>}
            {isWinner && !isConfirmed && (
              <Text style={styles.youWinHint}>¡ESO ERES VOS! Presentate para reclamar el premio.</Text>
            )}
            {isWinner && isConfirmed && (
              <Text style={styles.youWinHint}>¡Felicitaciones! El premio es tuyo. 🎽</Text>
            )}
          </Animated.View>
        ) : null}

        {/* Tus tickets */}
        {(
          <View style={styles.ticketsCard}>
            <View style={styles.ticketsRow}>
              <TicketStat label="Tus tickets" value={raffle.my_confirmed} color={COLORS.gold} />
            </View>

            {raffle.status === 'open' && (
              <TouchableOpacity style={styles.btnBuy} onPress={() => { setQuantity(1); setYappyPhone(''); setYappyStep('phone'); }}>
                <Text style={styles.btnBuyText}>🎟️ Comprar tickets — $1 c/u</Text>
              </TouchableOpacity>
            )}
          </View>
        )}


        {/* Panel admin */}
        {isAdmin && (
          <View style={styles.adminCard}>
            <Text style={styles.adminTitle}>CONTROL ADMIN</Text>

            {/* Giros: pending tickets */}
            {pendingTickets.length > 0 && (
              <View style={styles.pendingSection}>
                <Text style={styles.pendingTitle}>🕐 Tickets pendientes ({pendingTickets.length})</Text>
                {pendingTickets.map(t => (
                  <View key={t.id} style={styles.pendingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pendingUser}>{t.users?.nombre}</Text>
                      <Text style={styles.pendingQty}>{t.quantity} ticket{t.quantity > 1 ? 's' : ''} — ${t.amount_paid.toFixed(2)}</Text>
                    </View>
                    <TouchableOpacity style={styles.confirmBtn} onPress={() => confirmTicket(t.id)}>
                      <Text style={styles.confirmBtnText}>✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cancelBtn} onPress={() => cancelTicket(t.id)}>
                      <Text style={styles.cancelBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Girar */}
            {(raffle.status === 'open' || raffle.status === 'winner_pending') && (
              <TouchableOpacity
                style={[styles.btnSpin, adminBusy && { opacity: 0.5 }]}
                onPress={handleSpin}
                disabled={adminBusy}
              >
                {adminBusy
                  ? <ActivityIndicator color={COLORS.bg} />
                  : <Text style={styles.btnSpinText}>🎯 GIRAR LA RULETA</Text>
                }
              </TouchableOpacity>
            )}

            {/* Confirmación de presencia */}
            {raffle.status === 'spinning' && raffle.winner_nom && !spinning && (
              <View style={styles.presenceRow}>
                <Text style={styles.presenceLabel}>¿{raffle.winner_nom} está presente?</Text>
                <View style={styles.presenceBtns}>
                  <TouchableOpacity
                    style={[styles.btnPresent, adminBusy && { opacity: 0.5 }]}
                    onPress={handleConfirm}
                    disabled={adminBusy}
                  >
                    <Text style={styles.btnPresentText}>✓ Sí, está</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnAbsent, adminBusy && { opacity: 0.5 }]}
                    onPress={handleSkip}
                    disabled={adminBusy}
                  >
                    <Text style={styles.btnAbsentText}>✕ No está</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {raffle.status === 'closed' && (
              <Text style={styles.closedText}>✅ Rifa cerrada. Ganador confirmado.</Text>
            )}

            <Text style={styles.adminStats}>
              Giros: {raffle.spin_count}
            </Text>
          </View>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Flujo Yappy: selección de cantidad */}
      <Modal visible={yappyStep === 'phone'} transparent animationType="slide" onRequestClose={cancelYappy}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>🎟️ COMPRAR TICKETS</Text>
            <Text style={styles.modalSub}>Cada ticket = 1 oportunidad. $1 por ticket.</Text>

            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(q => Math.max(1, q - 1))}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(q => q + 1)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.totalText}>Total: ${quantity}.00</Text>

            <Text style={styles.formLabel}>Tu número de Yappy</Text>
            <TextInput
              style={styles.input}
              value={yappyPhone}
              onChangeText={setYappyPhone}
              keyboardType="phone-pad"
              placeholder="Ej: 6123-4567"
              placeholderTextColor={COLORS.gray}
              maxLength={12}
            />

            <TouchableOpacity
              style={[styles.btnPrimary, yappyBusy && { opacity: 0.5 }]}
              onPress={handleStartYappy}
              disabled={yappyBusy}
            >
              <Text style={styles.btnPrimaryText}>Cobrar ${quantity}.00 con Yappy</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={cancelYappy} style={{ marginTop: SPACING.md }}>
              <Text style={styles.cancelLink}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Flujo Yappy: esperando pago */}
      <Modal visible={yappyStep === 'polling'} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <ActivityIndicator color={COLORS.neon} size="large" />
            <Text style={[styles.modalTitle, { marginTop: SPACING.md }]}>ESPERANDO PAGO</Text>
            <Text style={styles.modalSub}>Aprobá el cobro de ${quantity}.00 en tu app de Yappy.</Text>
            <Text style={styles.yappyStep}>
              Intento {yappyProgress.attempts}/{yappyProgress.maxAttempts}
            </Text>
            <TouchableOpacity onPress={cancelYappy} style={{ marginTop: SPACING.md }}>
              <Text style={styles.cancelLink}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {renderSetupModal()}
    </SafeAreaView>
  );

  function renderSetupModal() {
    return (
      <Modal visible={setupModal} transparent animationType="slide" onRequestClose={() => setSetupModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>⚙️ CONFIGURAR RIFA</Text>
            <Text style={styles.formLabel}>Premio</Text>
            <TextInput
              style={styles.input}
              value={setupPrize}
              onChangeText={setSetupPrize}
              placeholder="Ej: Camiseta Aniversario"
              placeholderTextColor={COLORS.gray}
            />
            <TouchableOpacity
              style={[styles.btnPrimary, saving && { opacity: 0.5 }]}
              onPress={handleSetup}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnPrimaryText}>Guardar y activar</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSetupModal(false)} style={{ marginTop: SPACING.md }}>
              <Text style={styles.cancelLink}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  }
}

function TicketStat({ label, value, color }) {
  return (
    <View style={ts.box}>
      <Text style={[ts.value, { color }]}>{value}</Text>
      <Text style={ts.label}>{label}</Text>
    </View>
  );
}
const ts = StyleSheet.create({
  box:   { flex: 1, alignItems: 'center' },
  value: { fontFamily: 'BebasNeue_400Regular', fontSize: 32, color: COLORS.white },
  label: { fontFamily: 'Barlow_400Regular', fontSize: 11, color: COLORS.gray, marginTop: 2 },
});

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, borderBottomWidth: 1, borderColor: COLORS.line },
  backText:     { fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: COLORS.white },
  title:        { fontFamily: 'BebasNeue_400Regular', fontSize: 28, color: COLORS.white, letterSpacing: 3 },
  settingsIcon: { fontSize: 22 },
  backBtn:      { padding: SPACING.md },

  prizeCard: {
    margin: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: COLORS.red + '55',
  },
  prizeImage:   { width: '100%', height: 200, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  prizeName:    { fontFamily: 'BebasNeue_400Regular', fontSize: 28, color: COLORS.white, letterSpacing: 2, textAlign: 'center' },
  prizeTagline: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: COLORS.gray, marginTop: 4, textAlign: 'center' },

  spinBox: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.navy, borderRadius: RADIUS.md,
    padding: SPACING.xl, alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.blue2,
  },
  spinLabel: { fontFamily: 'Barlow_700Bold', fontSize: 12, color: COLORS.blue2, letterSpacing: 4, marginBottom: SPACING.sm },
  spinName:  { fontFamily: 'BebasNeue_400Regular', fontSize: 42, color: COLORS.white, letterSpacing: 2 },

  winnerBox: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card2, borderRadius: RADIUS.md,
    padding: SPACING.xl, alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.gold,
  },
  winnerBoxConfirmed: { backgroundColor: COLORS.gold + '22', borderColor: COLORS.gold },
  winnerTitle:          { fontFamily: 'BebasNeue_400Regular', fontSize: 20, color: COLORS.gold, letterSpacing: 2, marginBottom: SPACING.sm },
  winnerConfirmedTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 28, color: COLORS.gold, letterSpacing: 4, marginBottom: SPACING.sm },
  winnerName:  { fontFamily: 'BebasNeue_400Regular', fontSize: 44, color: COLORS.white, letterSpacing: 2, textAlign: 'center' },
  winnerPrize: { fontFamily: 'Barlow_600SemiBold', fontSize: 15, color: COLORS.gold, marginTop: SPACING.sm },
  youWinHint:  { fontFamily: 'Barlow_700Bold', fontSize: 14, color: COLORS.green, marginTop: SPACING.md, textAlign: 'center' },

  ticketsCard: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.line,
  },
  ticketsRow:  { flexDirection: 'row', justifyContent: 'space-around', marginBottom: SPACING.md },
  pendingHint: { fontFamily: 'Barlow_400Regular', fontSize: 12, color: COLORS.orange, textAlign: 'center', marginBottom: SPACING.md },
  btnBuy: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.sm,
    padding: SPACING.md, alignItems: 'center',
  },
  btnBuyText: { fontFamily: 'BebasNeue_400Regular', fontSize: 18, color: COLORS.white, letterSpacing: 2 },

  adminCard: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.purple + '55',
  },
  adminTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 16, color: COLORS.purple2, letterSpacing: 3, marginBottom: SPACING.md },

  pendingSection: { marginBottom: SPACING.md },
  pendingTitle:   { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: COLORS.gold, marginBottom: SPACING.sm },
  pendingRow:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6, borderBottomWidth: 1, borderColor: COLORS.line },
  pendingUser:    { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: COLORS.white },
  pendingQty:     { fontFamily: 'Barlow_400Regular', fontSize: 12, color: COLORS.gray },
  confirmBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 16, color: COLORS.bg },
  cancelBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.red + '33', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.red },
  cancelBtnText:  { fontFamily: 'Barlow_700Bold', fontSize: 14, color: COLORS.red },

  btnSpin: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.sm,
    padding: SPACING.md, alignItems: 'center', marginBottom: SPACING.md,
  },
  btnSpinText: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, color: COLORS.white, letterSpacing: 3 },

  presenceRow:   { marginBottom: SPACING.md },
  presenceLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 15, color: COLORS.white, textAlign: 'center', marginBottom: SPACING.sm },
  presenceBtns:  { flexDirection: 'row', gap: SPACING.sm },
  btnPresent:    { flex: 1, backgroundColor: COLORS.green, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: 'center' },
  btnPresentText:{ fontFamily: 'Barlow_700Bold', fontSize: 15, color: COLORS.bg },
  btnAbsent:     { flex: 1, backgroundColor: COLORS.red + '22', borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.red },
  btnAbsentText: { fontFamily: 'Barlow_700Bold', fontSize: 15, color: COLORS.red },

  ineligibleBox: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.bg2, borderRadius: RADIUS.md,
    padding: SPACING.md, alignItems: 'center', flexDirection: 'row', gap: SPACING.md,
    borderWidth: 1, borderColor: COLORS.line,
  },
  ineligibleIcon: { fontSize: 24 },
  ineligibleText: { fontFamily: 'Barlow_400Regular', fontSize: 13, color: COLORS.gray, flex: 1, lineHeight: 19 },
  closedText: { fontFamily: 'Barlow_600SemiBold', fontSize: 14, color: COLORS.green, textAlign: 'center', marginBottom: SPACING.sm },
  adminStats: { fontFamily: 'Barlow_400Regular', fontSize: 11, color: COLORS.gray, textAlign: 'center', marginTop: SPACING.sm },

  centerBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyIcon:  { fontSize: 56, marginBottom: SPACING.md },
  emptyText:  { fontFamily: 'Barlow_400Regular', fontSize: 15, color: COLORS.gray, textAlign: 'center', marginBottom: SPACING.xl },

  btnPrimary:     { backgroundColor: COLORS.red, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnPrimaryText: { fontFamily: 'BebasNeue_400Regular', fontSize: 18, color: COLORS.white, letterSpacing: 2 },

  modalOverlay: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: COLORS.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SPACING.xl, paddingBottom: SPACING.xxl },
  modalTitle:   { fontFamily: 'BebasNeue_400Regular', fontSize: 24, color: COLORS.white, letterSpacing: 3, marginBottom: SPACING.sm },
  modalSub:     { fontFamily: 'Barlow_400Regular', fontSize: 13, color: COLORS.gray, marginBottom: SPACING.lg },

  qtyRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xl, marginBottom: SPACING.md },
  qtyBtn:     { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.bg2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.line },
  qtyBtnText: { fontFamily: 'Barlow_700Bold', fontSize: 24, color: COLORS.white },
  qtyValue:   { fontFamily: 'BebasNeue_400Regular', fontSize: 48, color: COLORS.white, minWidth: 60, textAlign: 'center' },
  totalText:  { fontFamily: 'Barlow_700Bold', fontSize: 18, color: COLORS.gold, textAlign: 'center', marginBottom: SPACING.md },

  yappyBox:   { backgroundColor: COLORS.bg2, borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.line },
  yappyTitle: { fontFamily: 'Barlow_700Bold', fontSize: 13, color: COLORS.white, marginBottom: SPACING.sm },
  yappyStep:  { fontFamily: 'Barlow_400Regular', fontSize: 13, color: COLORS.gray2, lineHeight: 22 },
  yappyNum:   { fontFamily: 'Barlow_700Bold', color: COLORS.gold },

  formLabel: { fontFamily: 'Barlow_600SemiBold', fontSize: 13, color: COLORS.gray2, marginBottom: 6, marginTop: SPACING.sm },
  input:     { backgroundColor: COLORS.bg2, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.line, color: COLORS.white, fontFamily: 'Barlow_400Regular', fontSize: 15, padding: SPACING.md, marginBottom: SPACING.sm },
  cancelLink:{ fontFamily: 'Barlow_400Regular', fontSize: 14, color: COLORS.gray, textAlign: 'center' },
});
