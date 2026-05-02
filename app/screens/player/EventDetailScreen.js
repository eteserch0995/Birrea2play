import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Image, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { getRefundStatus, getEventStatusInfo } from '../../../lib/eventHelpers';
import { cancelRegistration } from '../../../lib/cancelRegistration';
import { getYappyAlias, buildYappyDeepLink, YAPPY_FALLBACK_URL } from '../../../lib/yappy';
import PaymentModal from '../../../components/PaymentModal';
import CancelRegistrationModal from '../../../components/CancelRegistrationModal';
import GuestModal from '../../../components/GuestModal';
import PlayerAvatar from '../../../components/PlayerAvatar';
import TimerBadge from '../../../components/TimerBadge';

export default function EventDetailScreen({ route, navigation }) {
  const { eventId } = route.params;
  const { user, walletBalance, setWalletBalance } = useAuthStore();

  const [event,        setEvent]        = useState(null);
  const [registrations,setRegistrations]= useState([]);
  const [guests,       setGuests]       = useState([]);
  const [myReg,        setMyReg]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);

  const [payModal,    setPayModal]    = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [guestModal,  setGuestModal]  = useState(false);
  const [paying,      setPaying]      = useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const [yappyLoading,setYappyLoading]= useState(false);

  const fetchEvent = useCallback(async () => {
    try {
      const [{ data: ev, error: evErr }, { data: regs }, { data: gs }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('event_registrations')
          .select('*, users(id, nombre, foto_url)')
          .eq('event_id', eventId)
          .eq('status', 'confirmed'),
        supabase.from('event_guests').select('*').eq('event_id', eventId),
      ]);
      if (evErr) throw evErr;
      setEvent(ev);
      setRegistrations(regs ?? []);
      setGuests(gs ?? []);
      setMyReg(regs?.find((r) => r.user_id === user?.id) ?? null);
    } catch (e) {
      // Leave event as null so the "no se pudo cargar" fallback renders
      console.warn('fetchEvent error:', e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId, user?.id]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEvent();
    setRefreshing(false);
  }, [fetchEvent]);

  // ── Wallet payment ────────────────────────────────────────────────────────
  const payWithWallet = async () => {
    const precio = event?.precio ?? 0;
    if (precio <= 0) {
      Alert.alert('Error', 'Este evento no tiene un precio válido.');
      return;
    }
    if (walletBalance < precio) {
      Alert.alert('Saldo insuficiente', 'Recarga tu wallet antes de inscribirte.');
      return;
    }
    // Guard: avoid double-tap submitting twice
    if (paying) return;
    setPaying(true);
    try {
      // Check for existing registration first to prevent double-inscription
      const { data: existingReg } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', event.id)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (existingReg) {
        Alert.alert('Ya estás inscrito', 'Ya tienes una inscripción confirmada en este evento.');
        setPayModal(false);
        await fetchEvent();
        return;
      }

      // Use atomic RPC to debit wallet + record transaction + create registration
      const { error } = await supabase.rpc('inscribir_con_wallet', {
        p_user_id:   user.id,
        p_event_id:  event.id,
        p_monto:     precio,
        p_descripcion: `Inscripción: ${event.nombre}`,
      });

      // Fallback if RPC doesn't exist: do it manually with a fresh balance check
      if (error && error.code === 'PGRST202') {
        // RPC not found — use manual multi-step approach
        const { data: wallet, error: wErr } = await supabase
          .from('wallets')
          .select('id, balance')
          .eq('user_id', user.id)
          .single();
        if (wErr) throw wErr;
        if (wallet.balance < precio) {
          throw new Error('Saldo insuficiente — por favor recarga tu wallet.');
        }
        const newBalance = wallet.balance - precio;
        const { error: updErr } = await supabase
          .from('wallets')
          .update({ balance: newBalance })
          .eq('user_id', user.id)
          .eq('balance', wallet.balance); // optimistic lock
        if (updErr) throw new Error('El saldo cambió durante la operación. Intenta nuevamente.');

        await supabase.from('wallet_transactions').insert({
          wallet_id:   wallet.id,
          tipo:        'inscripcion',
          monto:       -precio,
          descripcion: `Inscripción: ${event.nombre}`,
        });
        await supabase.from('event_registrations').insert({
          event_id:     event.id,
          user_id:      user.id,
          metodo_pago:  'wallet',
          monto_pagado: precio,
          status:       'confirmed',
        });
        setWalletBalance(newBalance);
      } else if (error) {
        throw error;
      } else {
        // RPC succeeded — refresh balance from DB
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .single();
        if (wallet) setWalletBalance(wallet.balance);
      }

      setPayModal(false);
      Alert.alert('¡Inscrito!', 'Te has inscrito exitosamente.', [{ text: 'OK', onPress: fetchEvent }]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPaying(false);
    }
  };

  // ── Yappy payment ─────────────────────────────────────────────────────────
  const payWithYappy = async () => {
    setYappyLoading(true);
    try {
      const alias     = await getYappyAlias();
      const reference = `event-${event.id.slice(0, 8)}-${Date.now()}`;
      const link      = buildYappyDeepLink({ alias, amount: event.precio ?? 0, reference });
      const canOpen = await Linking.canOpenURL(link);
      if (canOpen) {
        await Linking.openURL(link);
      } else {
        await Linking.openURL(YAPPY_FALLBACK_URL);
      }
    } catch (e) {
      Alert.alert('Error Yappy', e.message);
    } finally {
      setYappyLoading(false);
      setPayModal(false);
    }
  };

  // ── Cancel registration ───────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!myReg?.id) {
      Alert.alert('Error', 'No se encontró tu inscripción. Recarga la pantalla.');
      return;
    }
    if (cancelling) return; // guard against double-tap
    setCancelling(true);
    try {
      const result = await cancelRegistration({
        userId:         user.id,
        eventId:        event.id,
        eventFecha:     event.fecha,
        eventHora:      event.hora,
        monto:          myReg?.monto_pagado ?? 0,
        registrationId: myReg.id,
      });
      setCancelModal(false);
      if (result.refunded) {
        setWalletBalance(walletBalance + result.amount);
        Alert.alert('Cancelado', `Inscripción cancelada. Se reembolsaron $${result.amount.toFixed(2)} a tu wallet.`);
      } else {
        Alert.alert('Cancelado', 'Inscripción cancelada. No aplica reembolso (menos de 48 h).');
      }
      fetchEvent();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setCancelling(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  if (!event)  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15 }}>No se pudo cargar el evento.</Text>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.blue2 }}>← Volver</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const inscritos  = registrations.length;
  const cuposFull  = !event.cupos_ilimitado && inscritos >= event.cupos_total;
  const { label: statusLabel, color: statusColor } = getEventStatusInfo(event.status);
  const refundInfo = myReg ? getRefundStatus(event.fecha, event.hora) : null;

  // Deadline for registration — 1 hour before event
  const regDeadline = new Date(`${event.fecha}T${event.hora ?? '00:00:00'}`);
  regDeadline.setHours(regDeadline.getHours() - 1);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{event.nombre}</Text>
        </View>

        {/* Status + Timer */}
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {event.status === 'open' && !myReg && (
            <TimerBadge deadline={regDeadline} label="Inscripción cierra en" />
          )}
        </View>

        {/* Info card */}
        <View style={styles.card}>
          {event.deporte && <InfoRow icon="🏅" label={`${event.deporte} · ${event.formato}`} />}
          <InfoRow icon="📅" label={`${new Date(event.fecha).toLocaleDateString('es-PA', { weekday: 'long', day: 'numeric', month: 'long' })} · ${event.hora?.slice(0, 5) ?? ''}`} />
          <InfoRow icon="📍" label={event.lugar} />
          <InfoRow icon="👤" label={event.genero} />
          {!event.cupos_ilimitado && <InfoRow icon="👥" label={`${inscritos}/${event.cupos_total} jugadores`} />}
          {event.descripcion && <Text style={styles.desc}>{event.descripcion}</Text>}
        </View>

        {/* Players */}
        <Text style={styles.sectionTitle}>Jugadores inscritos ({inscritos + guests.length})</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.playersRow}>
          {registrations.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.playerChip}
              onPress={() => navigation.navigate('PlayerProfile', { userId: r.users?.id })}
              activeOpacity={0.75}
            >
              <PlayerAvatar user={r.users} size={48} borderColor={COLORS.blue} />
              <Text style={styles.playerName}>{r.users?.nombre?.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
          {guests.map((g) => (
            <View key={g.id} style={styles.playerChip}>
              <View style={styles.guestAvatar}><Text style={styles.guestIcon}>👤</Text></View>
              <Text style={styles.playerName}>{g.nombre?.split(' ')[0]}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Active event CTA */}
        {event.status === 'active' && (
          <TouchableOpacity
            style={styles.activeBtn}
            onPress={() => navigation.navigate('ActiveEvent', { eventId: event.id })}
          >
            <Text style={styles.activeBtnText}>⚡ VER EVENTO EN CURSO</Text>
          </TouchableOpacity>
        )}

        {/* Payment / inscription */}
        {event.status === 'open' && !myReg && !cuposFull && (
          <View style={styles.paySection}>
            <Text style={styles.payTitle}>INSCRIPCIÓN — ${(event.precio ?? 0).toFixed(2)}</Text>
            <TouchableOpacity style={styles.btnPay} onPress={() => setPayModal(true)}>
              <Text style={styles.btnPayText}>Inscribirse →</Text>
            </TouchableOpacity>
          </View>
        )}

        {myReg && (
          <View style={styles.registeredBox}>
            <Text style={styles.registeredText}>✓ Estás inscrito en este evento</Text>
            <TouchableOpacity style={styles.btnCancelReg} onPress={() => setCancelModal(true)}>
              <Text style={styles.btnCancelRegText}>Cancelar inscripción</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGuest} onPress={() => setGuestModal(true)}>
              <Text style={styles.btnGuestText}>+ Agregar invitado</Text>
            </TouchableOpacity>
          </View>
        )}

        {cuposFull && !myReg && (
          <Text style={styles.fullText}>Evento lleno — no hay cupos disponibles</Text>
        )}

        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Modals */}
      <PaymentModal
        visible={payModal}
        onClose={() => setPayModal(false)}
        onPayWallet={payWithWallet}
        onPayYappy={payWithYappy}
        amount={event.precio ?? 0}
        walletBalance={walletBalance}
        loading={paying || yappyLoading}
      />

      <CancelRegistrationModal
        visible={cancelModal}
        onClose={() => setCancelModal(false)}
        onConfirm={handleCancel}
        loading={cancelling}
        canRefund={refundInfo?.canRefund}
        amount={myReg?.monto_pagado ?? 0}
        refundDeadline={refundInfo?.refundDeadline}
      />

      <GuestModal
        visible={guestModal}
        onClose={() => setGuestModal(false)}
        eventId={event.id}
        onSuccess={fetchEvent}
      />
    </SafeAreaView>
  );
}

function InfoRow({ icon, label }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.icon}>{icon}</Text>
      <Text style={infoStyles.label}>{label}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  icon:  { fontSize: 16 },
  label: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, flex: 1 },
});

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: COLORS.bg },
  header:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
  back:         { padding: 4 },
  backText:     { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  headerTitle:  { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, flex: 1, letterSpacing: 1 },
  statusRow:    { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, flexWrap: 'wrap', marginBottom: SPACING.sm },
  statusBadge:  { paddingHorizontal: SPACING.md, paddingVertical: 4, borderRadius: RADIUS.full, borderWidth: 1 },
  statusText:   { fontFamily: FONTS.bodyMedium, fontSize: 12 },
  card:         { backgroundColor: COLORS.card, margin: SPACING.md, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy },
  desc:         { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray, marginTop: SPACING.sm, lineHeight: 20 },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  playersRow:   { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  playerChip:   { alignItems: 'center', gap: 4, marginRight: SPACING.md },
  playerName:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  guestAvatar:  { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  guestIcon:    { fontSize: 22 },
  activeBtn:    { backgroundColor: COLORS.magenta, margin: SPACING.md, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  activeBtnText:{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 2 },
  paySection:   { margin: SPACING.md },
  payTitle:     { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 2, marginBottom: SPACING.sm },
  btnPay:       { backgroundColor: COLORS.red, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnPayText:   { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2 },
  registeredBox:{ margin: SPACING.md, backgroundColor: COLORS.green + '15', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.green, gap: SPACING.sm },
  registeredText:{ fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.green },
  btnCancelReg: { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.red + '60' },
  btnCancelRegText: { fontFamily: FONTS.body, color: COLORS.red, fontSize: 14 },
  btnGuest:     { backgroundColor: COLORS.blue + '30', borderRadius: RADIUS.md, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.blue2 },
  btnGuestText: { fontFamily: FONTS.bodyMedium, color: COLORS.blue2, fontSize: 14 },
  fullText:     { fontFamily: FONTS.body, color: COLORS.red, textAlign: 'center', margin: SPACING.md },
});
