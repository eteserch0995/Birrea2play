import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Alert, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { iniciarBotonYappy, pollBotonOrder } from '../lib/yappy';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import useAuthStore from '../store/authStore';
import { filterActiveEventGuests, computeEventCapacity, checkSpotAvailable } from '../lib/eventGuests';

/**
 * GuestModal — invite a guest to an event (with optional payment).
 * Props: visible, onClose, eventId, eventNombre, eventPrecio, userId, walletBalance, onSuccess
 */
export default function GuestModal({
  visible, onClose, eventId, eventNombre, eventPrecio = 0,
  userId, walletBalance = 0, onSuccess,
  eventCuposTotal = null, eventCuposIlimitado = false,
  eventGenero = null, eventCuposHombres = null, eventCuposMujeres = null,
}) {
  const { setWalletBalance } = useAuthStore();
  const [step,      setStep]      = useState('info');   // 'info' | 'payment' | 'yappy'
  const [nombre,    setNombre]    = useState('');
  const [genero,    setGenero]    = useState(null);     // 'Masculino' | 'Femenino'
  const [telefono,  setTelefono]  = useState('');
  const [yappyPhone, setYappyPhone] = useState('');
  const [loading,   setLoading]   = useState(false);
  const [yappyMsg,  setYappyMsg]  = useState('');
  const pollRef = useRef(null);

  const precio = Number(eventPrecio) || 0;
  const esPago = precio > 0;

  // Gate de efectivo (igual que PaymentModal): >=3 birrias o forzado por admin, y no bloqueado.
  const [efSt, setEfSt] = useState(null); // { allowed, eventos, min, bloqueado }
  useEffect(() => {
    if (!visible) { setEfSt(null); return; }   // reset al cerrar
    let cancelled = false;
    setEfSt(null);
    (async () => {
      const FALLBACK = { allowed: false, eventos: 0, min: 3, bloqueado: false, forzado: false };
      try {
        const { data, error } = await supabase.rpc('efectivo_status');
        if (cancelled) return;
        setEfSt(error || !data ? FALLBACK : data);
      } catch (_) { if (!cancelled) setEfSt(FALLBACK); }
    })();
    return () => { cancelled = true; };
  }, [visible]);
  const efAllowed = !!efSt && efSt.allowed === true;
  const efBloq = !!efSt && !!efSt.bloqueado;
  const efMin = efSt?.min ?? 3;
  const efEventos = efSt?.eventos ?? 0;

  // Cancelar polling Yappy si el modal se desmonta sin pasar por handleClose
  // (ej. el padre lo cierra con visible=false directamente).
  useEffect(() => () => {
    try { pollRef.current?.cancel(); } catch {}
    pollRef.current = null;
  }, []);

  async function checkCapacity() {
    if (eventCuposIlimitado || eventCuposTotal == null) return true;
    const [{ data: regs }, { data: guests }] = await Promise.all([
      supabase.from('event_registrations')
        .select('user_id, status, users:user_id(genero)')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending']),
      supabase.from('event_guests')
        .select('id, invited_by, status, genero')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending_payment']),
    ]);
    const activeGuests = filterActiveEventGuests(guests ?? [], regs ?? []);
    const eventLike = {
      cupos_total:   eventCuposTotal,
      genero:        eventGenero,
      cupos_hombres: eventCuposHombres,
      cupos_mujeres: eventCuposMujeres,
    };
    const capacity = computeEventCapacity(eventLike, regs ?? [], activeGuests);
    const check    = checkSpotAvailable(capacity, genero, eventGenero);
    if (!check.allowed) {
      Alert.alert('No podemos inscribir al invitado', check.reason);
      return false;
    }
    return true;
  }

  // Detecta si este user ya invitó a alguien con el mismo nombre en este evento
  // (no cancelado). Evita duplicados antes de tocar el UNIQUE constraint.
  async function checkAlreadyInvited() {
    if (!userId || !nombre.trim()) return false;
    const { data, error } = await supabase
      .from('event_guests')
      .select('id, status')
      .eq('event_id', eventId)
      .eq('invited_by', userId)
      .ilike('nombre', nombre.trim())
      .neq('status', 'cancelled')
      .limit(1);
    if (error) return false; // no bloquear por error de red
    if (data && data.length > 0) {
      Alert.alert(
        'Ya invitaste a esa persona',
        `Ya tienes un invitado con el nombre "${nombre.trim()}" en este evento. Si quieres invitar a otra persona con el mismo nombre, agrégale un apellido o un identificador distinto.`,
      );
      return true;
    }
    return false;
  }

  // Traduce el error 23505 (UNIQUE violation) a un mensaje humano.
  function isDuplicateError(err) {
    return err?.code === '23505' || /duplicate key|unique/i.test(err?.message ?? '');
  }

  function reset() {
    setStep('info');
    setNombre('');
    setGenero(null);
    setTelefono('');
    setYappyPhone('');
    setLoading(false);
    setYappyMsg('');
    pollRef.current?.cancel();
    pollRef.current = null;
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleNext() {
    if (!nombre.trim()) { Alert.alert('Error', 'El nombre del invitado es requerido'); return; }
    if (!genero) { Alert.alert('Error', 'El género del invitado es requerido'); return; }
    if (esPago) { setStep('payment'); } else { addGuestFree(); }
  }

  async function addGuestFree() {
    if (loading) return;
    setLoading(true);
    try {
      if (!(await checkCapacity())) { setLoading(false); return; }
      if (await checkAlreadyInvited()) { setLoading(false); return; }
      const { error } = await supabase.from('event_guests').insert({
        event_id:    eventId,
        nombre:      nombre.trim(),
        genero:      genero,
        telefono:    telefono.trim() || null,
        invited_by:  userId,
        metodo_pago: 'gratis',
        monto_pagado: 0,
        status:      'confirmed',
      });
      if (error) {
        if (isDuplicateError(error)) {
          Alert.alert('Ya invitaste a esa persona', `Ya tienes un invitado con el nombre "${nombre.trim()}" en este evento.`);
          setLoading(false);
          return;
        }
        throw error;
      }
      const added = nombre.trim();
      onSuccess?.();
      reset();
      Alert.alert(
        '¡Listo!',
        `${added} fue agregado como invitado.`,
        [
          { text: 'Cerrar', onPress: onClose },
          { text: 'Agregar otro', style: 'default' },
        ],
        { cancelable: false },
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function payWithWallet() {
    if (walletBalance < precio) {
      Alert.alert('Créditos insuficientes', `Tienes $${walletBalance.toFixed(2)} en créditos internos. Compra créditos antes de continuar.`);
      return;
    }
    if (loading) return;
    setLoading(true);
    try {
      // RPC atómico: valida cupo/género y debita la wallet + inserta el guest en
      // UNA sola transacción server-side. Si algo falla, NADA se debita (no se
      // pierde plata sin invitado). Reemplaza el flujo por pasos anterior.
      const { data: guestId, error } = await supabase.rpc('inscribir_guest_con_wallet', {
        p_user_id:  userId,
        p_event_id: eventId,
        p_nombre:   nombre.trim(),
        p_genero:   genero,
        p_telefono: telefono.trim() || null,
        p_monto:    precio,
      });
      if (error) {
        const msg = error.message || '';
        if (/duplicado/i.test(msg) || error.code === '23505') {
          Alert.alert('Ya invitaste a esa persona', `Ya tienes un invitado con el nombre "${nombre.trim()}" en este evento.`);
          setLoading(false);
          return;
        }
        if (/^cupo lleno/i.test(msg)) {
          Alert.alert('No podemos inscribir al invitado', msg.replace(/^cupo lleno:\s*/i, ''));
          setLoading(false);
          return;
        }
        if (/Saldo insuficiente/i.test(msg)) {
          Alert.alert('Créditos insuficientes', 'Tus créditos no alcanzan. Intenta nuevamente.');
          setLoading(false);
          return;
        }
        throw error;
      }

      // Refresh wallet balance in store immediately (don't wait for realtime)
      const { data: freshWallet } = await supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle();
      if (freshWallet) setWalletBalance(freshWallet.balance);

      const added = nombre.trim();
      onSuccess?.();
      reset();
      Alert.alert(
        'Listo',
        `${added} fue agregado. Se descontaron $${precio.toFixed(2)} de tus créditos.`,
        [
          { text: 'Cerrar', onPress: onClose },
          { text: 'Agregar otro', style: 'default' },
        ],
        { cancelable: false },
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function payWithEfectivo() {
    if (loading) return;
    setLoading(true);
    try {
      if (!(await checkCapacity())) { setLoading(false); return; }
      if (await checkAlreadyInvited()) { setLoading(false); return; }
      const { error: gErr } = await supabase.from('event_guests').insert({
        event_id:     eventId,
        nombre:       nombre.trim(),
        genero:       genero,
        telefono:     telefono.trim() || null,
        invited_by:   userId,
        metodo_pago:  'efectivo',
        monto_pagado: precio,
        status:       'pending_payment',
      });
      if (gErr) {
        if (isDuplicateError(gErr)) {
          Alert.alert('Ya invitaste a esa persona', `Ya tienes un invitado con el nombre "${nombre.trim()}" en este evento.`);
          setLoading(false);
          return;
        }
        throw gErr;
      }

      // Solicitud formal de pago en efectivo al gestor/admin: alimenta el badge
      // de "Efectivo pendiente" + lista de aprobaciones. Sin esto el admin no
      // se entera del invitado pendiente de cobrar.
      const { error: cashErr } = await supabase.from('cash_payment_requests').insert({
        user_id:  userId,
        event_id: eventId,
        amount:   precio,
        notas:    `Invitado: ${nombre.trim()}`,
      });
      if (cashErr) console.warn('cash_payment_requests insert (invitado) falló:', cashErr.message);

      const { data: event } = await supabase
        .from('events').select('created_by, users!created_by(nombre, telefono, correo)')
        .eq('id', eventId).maybeSingle();
      const gestor   = event?.users;
      const contacto = gestor?.telefono || gestor?.correo || '';

      const added = nombre.trim();
      onSuccess?.();
      reset();
      Alert.alert(
        '⏳ Invitado pendiente de pago',
        `${added} quedó como invitado pendiente. Se notificó al gestor para que apruebe el pago de $${precio.toFixed(2)}.${gestor ? `\n\n👤 ${gestor.nombre}${contacto ? `\n📱 ${contacto}` : ''}` : ''}`,
        [
          { text: 'Cerrar', onPress: onClose },
          { text: 'Agregar otro', style: 'default' },
        ],
        { cancelable: false },
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function startYappyPayment() {
    const phone = yappyPhone.replace(/\D/g, '');
    if (phone.length < 7) { Alert.alert('Error', 'Ingresa un número Yappy válido'); return; }
    if (loading) return;

    setLoading(true);
    setYappyMsg('Creando invitado y orden Yappy…');

    let guestId;
    try {
      if (!(await checkCapacity())) { setLoading(false); setYappyMsg(''); return; }
      if (await checkAlreadyInvited()) { setLoading(false); setYappyMsg(''); return; }
      // Insert guest as pending_payment first so we have the ID for yappy_orders
      const { data: guest, error: gErr } = await supabase
        .from('event_guests')
        .insert({
          event_id:     eventId,
          nombre:       nombre.trim(),
          genero:       genero,
          telefono:     telefono.trim() || null,
          invited_by:   userId,
          metodo_pago:  'yappy_boton',
          monto_pagado: precio,
          status:       'pending_payment',
        })
        .select('id')
        .single();
      if (gErr) {
        if (isDuplicateError(gErr)) {
          Alert.alert('Ya invitaste a esa persona', `Ya tienes un invitado con el nombre "${nombre.trim()}" en este evento.`);
          setLoading(false);
          setYappyMsg('');
          return;
        }
        throw gErr;
      }
      guestId = guest.id;

      // Create Yappy order pointing at this guest
      const { orderId } = await iniciarBotonYappy({
        phone,
        amount:   precio,
        tipo:     'invitado',
        guest_id: guestId,
      });

      setYappyMsg('Revisa tu app Yappy y aprueba el pago.\nO entra a tu banca en línea y elegí la opción de Yappy.');

      const { promise, cancel } = pollBotonOrder({
        orderId,
        onProgress: ({ attempts, maxAttempts }) => {
          const remaining = maxAttempts - attempts;
          setYappyMsg(`Esperando confirmación Yappy… (${remaining * 5}s restantes)`);
        },
      });
      pollRef.current = { cancel };

      await promise;

      setYappyMsg('');
      Alert.alert('Listo', `Pago con Yappy confirmado. ${nombre.trim()} fue agregado como invitado.`);
      reset();
      onSuccess?.();
      onClose();
    } catch (e) {
      // Always clean up the pending guest record when payment fails or is cancelled
      if (guestId) {
        supabase.from('event_guests').delete().eq('id', guestId).then(({ error: delErr }) => {
          if (delErr) console.warn('GuestModal: could not delete pending guest:', delErr.message);
        });
      }
      setYappyMsg('');
      // 'cancelled' means the user pressed the cancel button — no error alert needed
      if (e.message !== 'cancelled') {
        Alert.alert('Pago no completado', e.message);
      }
    } finally {
      pollRef.current = null;
      setLoading(false);
    }
  }

  function cancelYappyPayment() {
    pollRef.current?.cancel();
    // loading + yappyMsg will be cleared in the finally block of startYappyPayment
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: SPACING.md }}
          >

          {/* ── Step: info ───────────────────────────────────────────── */}
          {step === 'info' && (
            <>
              <Text style={styles.title}>Llevar Invitado</Text>
              {esPago && (
                <Text style={styles.precio}>Costo por invitado: ${precio.toFixed(2)}</Text>
              )}
              <TextInput
                style={styles.input}
                placeholder="Nombre del invitado *"
                placeholderTextColor={COLORS.gray}
                value={nombre}
                onChangeText={setNombre}
              />
              <Text style={[styles.note, { color: COLORS.gray2, marginBottom: 4 }]}>Género del invitado *</Text>
              <View style={styles.genderRow}>
                {['Masculino', 'Femenino'].map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.genderChip, genero === g && styles.genderChipActive]}
                    onPress={() => setGenero(g)}
                  >
                    <Text style={[styles.genderChipText, genero === g && { color: COLORS.white }]}>
                      {g === 'Masculino' ? '♂ Masculino' : '♀ Femenino'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Teléfono (opcional)"
                placeholderTextColor={COLORS.gray}
                value={telefono}
                onChangeText={setTelefono}
                keyboardType="phone-pad"
              />
              <Text style={styles.note}>
                El invitado no tendrá carta de jugador ni perfil en la app.
              </Text>
              <View style={styles.btns}>
                <TouchableOpacity style={styles.btnCancel} onPress={handleClose}>
                  <Text style={styles.btnCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnAdd} onPress={handleNext} disabled={loading}>
                  <Text style={styles.btnAddText}>{esPago ? 'Siguiente →' : 'Agregar'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Step: payment method ─────────────────────────────────── */}
          {step === 'payment' && (
            <>
              <Text style={styles.title}>Método de Pago</Text>
              <Text style={styles.precio}>Invitado: {nombre}</Text>
              <Text style={styles.precio}>Total: ${precio.toFixed(2)}</Text>

              {/* Wallet */}
              <TouchableOpacity
                style={[styles.payBtn, walletBalance >= precio && styles.payBtnActive]}
                onPress={payWithWallet}
                disabled={loading || walletBalance < precio}
              >
                <Text style={styles.payBtnIcon}>💰</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payBtnLabel}>Créditos</Text>
                  <Text style={styles.payBtnSub}>
                    Saldo: ${walletBalance.toFixed(2)}{walletBalance < precio ? ' — insuficiente' : ''}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Yappy Botón */}
              <TouchableOpacity
                style={[styles.payBtn, styles.payBtnActive]}
                onPress={() => setStep('yappy')}
                disabled={loading}
              >
                <Text style={styles.payBtnIcon}>📱</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payBtnLabel}>Yappy</Text>
                  <Text style={styles.payBtnSub}>Paga con tu número Yappy</Text>
                </View>
              </TouchableOpacity>

              {/* Efectivo (gated por 3 birrias / admin) */}
              {efSt === null ? (
                <View style={{ padding: SPACING.md, alignItems: 'center' }}>
                  <ActivityIndicator color={COLORS.gold} />
                </View>
              ) : efAllowed ? (
                <TouchableOpacity
                  style={[styles.payBtn, styles.payBtnActive]}
                  onPress={payWithEfectivo}
                  disabled={loading}
                >
                  <Text style={styles.payBtnIcon}>💵</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payBtnLabel}>Efectivo</Text>
                    <Text style={styles.payBtnSub}>Paga directo al gestor</Text>
                  </View>
                </TouchableOpacity>
              ) : efBloq ? (
                <View style={{ backgroundColor: COLORS.red + '22', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.red + '55' }}>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, textAlign: 'center' }}>🚫 Pago en efectivo no disponible</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: COLORS.gold + '14', borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold + '55' }}>
                  <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, textAlign: 'center', lineHeight: 18 }}>
                    🔒 Necesitás haber participado en al menos {efMin} birrias para pagar en efectivo ({efEventos}/{efMin})
                  </Text>
                </View>
              )}

              {loading && <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.sm }} />}

              <TouchableOpacity style={[styles.btnCancel, { marginTop: SPACING.sm }]} onPress={() => setStep('info')} disabled={loading}>
                <Text style={styles.btnCancelText}>← Volver</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Step: yappy phone ────────────────────────────────────── */}
          {step === 'yappy' && (
            <>
              <Text style={styles.title}>Pagar con Yappy</Text>
              <Text style={styles.precio}>Invitado: {nombre}</Text>
              <Text style={styles.precio}>Total: ${precio.toFixed(2)}</Text>

              <TextInput
                style={styles.input}
                placeholder="Número Yappy (ej. 6000-0000)"
                placeholderTextColor={COLORS.gray}
                value={yappyPhone}
                onChangeText={setYappyPhone}
                keyboardType="phone-pad"
                editable={!loading}
              />
              <Text style={styles.note}>
                Recibirás una notificación push en tu app Yappy para aprobar el pago.
              </Text>

              {yappyMsg ? (
                <View style={styles.yappyMsgBox}>
                  <ActivityIndicator color={COLORS.gold} size="small" />
                  <Text style={styles.yappyMsgText}>{yappyMsg}</Text>
                </View>
              ) : null}

              {!loading && (
                <TouchableOpacity style={styles.btnYappy} onPress={startYappyPayment}>
                  <Text style={styles.btnYappyText}>Enviar solicitud Yappy</Text>
                </TouchableOpacity>
              )}

              {loading && (
                <TouchableOpacity
                  style={[styles.btnCancel, { marginTop: SPACING.sm }]}
                  onPress={cancelYappyPayment}
                >
                  <Text style={styles.btnCancelText}>Cancelar pago</Text>
                </TouchableOpacity>
              )}

              {!loading && (
                <TouchableOpacity style={[styles.btnCancel, { marginTop: SPACING.sm }]} onPress={() => setStep('payment')}>
                  <Text style={styles.btnCancelText}>← Volver</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: COLORS.card2, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.xl },
  title:         { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  precio:        { fontFamily: FONTS.bodyMedium, fontSize: 15, color: COLORS.gold },
  note:          { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, fontStyle: 'italic' },
  input:         { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, color: COLORS.white, fontFamily: FONTS.body, fontSize: 15, borderWidth: 1, borderColor: COLORS.navy },
  genderRow:         { flexDirection: 'row', gap: SPACING.sm, marginBottom: 4 },
  genderChip:        { flex: 1, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy, alignItems: 'center' },
  genderChipActive:  { backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  genderChipText:    { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.gray },
  btns:          { flexDirection: 'row', gap: SPACING.sm },
  btnCancel:     { flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  btnCancelText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  btnAdd:        { flex: 1, backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center' },
  btnAddText:    { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 15 },
  payBtn:        { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, opacity: 0.5 },
  payBtnActive:  { opacity: 1, borderColor: COLORS.blue },
  payBtnIcon:    { fontSize: 26 },
  payBtnLabel:   { fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 15 },
  payBtnSub:     { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 },
  btnYappy:      { backgroundColor: COLORS.gold, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnYappyText:  { fontFamily: FONTS.bodySemiBold, color: COLORS.bg, fontSize: 16 },
  yappyMsgBox:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md },
  yappyMsgText:  { fontFamily: FONTS.body, color: COLORS.gold, fontSize: 13, flex: 1 },
});
