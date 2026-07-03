import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, Image, RefreshControl, Linking,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { isModo26Active } from '../../../lib/modo26';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import { getRefundStatus, getEventStatusInfo, getTournamentWinner, freeLabel } from '../../../lib/eventHelpers';
import WinnerBanner from '../../../components/WinnerBanner';
import EventDetailSkeleton from '../../../components/EventDetailSkeleton';
import { shareEvent } from '../../../lib/shareEvent';
import { logWarn, logInfo, logError } from '../../../lib/logger';
import { remoteLog } from '../../../lib/remoteLogger';
import { notifyGestorOfNewRegistration } from '../../../lib/notifications';
import { cancelRegistration } from '../../../lib/cancelRegistration';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';
import PaymentModal from '../../../components/PaymentModal';
import CancelRegistrationModal from '../../../components/CancelRegistrationModal';
import GuestModal from '../../../components/GuestModal';
import CashPendingBanner from '../../../components/CashPendingBanner';
import PlayerAvatar from '../../../components/PlayerAvatar';
import TeamMark from '../../../components/TeamMark';
import TimerBadge from '../../../components/TimerBadge';
import { filterActiveEventGuests, getActiveRegistrationUserIds, isActiveEventGuest, computeEventCapacity, checkSpotAvailable } from '../../../lib/eventGuests';
import { getTeamNameWithColor } from '../../../lib/teamWearColor';
import ResponsiveContainer from '../../../components/ResponsiveContainer';

// Mapea errores técnicos de los flujos de pago Yappy a mensajes accionables
// para el usuario. Sin teléfonos/canales inventados — solo lo que ya existe
// en el resto de la pantalla (mensaje de error en efectivo referencia al
// gestor por su cuenta, no lo repetimos acá).
function friendlyPayError(e) {
  const msg = e?.message ?? '';
  if (/timeout/i.test(msg)) {
    return 'La confirmación tardó demasiado. Verificá en tu app de Yappy si el pago salió antes de reintentar.';
  }
  if (/network|fetch/i.test(msg)) {
    return 'Problema de conexión. Revisá tu red e intentá de nuevo.';
  }
  if (/cancel/i.test(msg)) {
    return 'Pago cancelado.';
  }
  return `No se pudo completar el pago. Intentá de nuevo${msg ? ` (${msg.slice(0, 120)})` : ''}.`;
}

export default function EventDetailScreen({ route, navigation }) {
  // Defensa: en deep links el param puede llegar bajo `id` (path legacy) o
  // `eventId` (path actual). Aceptar ambos para no romper links viejos.
  const params = route?.params ?? {};
  const eventId = params.eventId ?? params.id ?? null;
  const { user, walletBalance, setWalletBalance } = useAuthStore();

  const [event,        setEvent]        = useState(null);
  const [registrations,setRegistrations]= useState([]);
  const [participantRegs, setParticipantRegs] = useState([]);
  const [waitlistRegs,   setWaitlistRegs]    = useState([]);
  const [guests,       setGuests]       = useState([]);
  const [teams,        setTeams]        = useState([]);
  const [matches,      setMatches]      = useState([]);
  const [myReg,        setMyReg]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [refreshing,   setRefreshing]   = useState(false);
  // null | string. Si no es null y !event, mostramos mensaje específico (no encontrado /
  // timeout / red) en lugar del genérico "no se pudo cargar".
  const [fetchError,   setFetchError]   = useState(null);
  const loadingTimeoutRef               = useRef(null);

  const [payModal,    setPayModal]    = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [guestModal,  setGuestModal]  = useState(false);
  const [paying,      setPaying]      = useState(false);
  const [cancelling,  setCancelling]  = useState(false);
  const [yappyLoading,setYappyLoading]= useState(false);

  // Yappy Botón flow
  const yappyCancelRef                          = useRef(null);
  const [yappyStep,     setYappyStep]           = useState('idle'); // 'idle' | 'phone' | 'polling'
  const [yappyPhone,    setYappyPhone]          = useState('');
  const [yappyProgress, setYappyProgress]       = useState({ attempts: 0, maxAttempts: 60 });
  // Pago mixto
  const [mixtoWallet, setMixtoWallet] = useState(0);
  const [mixtoYappy,  setMixtoYappy]  = useState(0);

  const checkCapacity = async () => {
    if (event?.cupos_ilimitado) return true;
    // Traemos regs CON genero del user para validar cupos por género en Mixto.
    const [{ data: regs }, { data: guestRows }] = await Promise.all([
      supabase.from('event_registrations')
        .select('user_id, status, users:user_id(genero)')
        .eq('event_id', event.id)
        .in('status', ['confirmed', 'pending']),
      supabase.from('event_guests')
        .select('id, invited_by, status, genero')
        .eq('event_id', event.id)
        .in('status', ['confirmed', 'pending_payment']),
    ]);
    const activeGuests = filterActiveEventGuests(guestRows ?? [], regs ?? []);
    // Excluir la propia inscripción: si el usuario ya tiene un cupo (ej. promovido de
    // lista de espera) no debe bloquearse al confirmar/pagar su propio lugar.
    const regsExclSelf = (regs ?? []).filter(r => r.user_id !== user?.id);
    const capacity     = computeEventCapacity(event, regsExclSelf, activeGuests);
    const check        = checkSpotAvailable(capacity, user?.genero ?? null, event?.genero);
    if (!check.allowed) {
      Alert.alert('No podemos inscribirte', check.reason);
      return false;
    }
    return true;
  };

  // fetchEvent NO depende de user?.id en la closure: leemos user desde el store
  // por demanda. Sin esto, cuando el auth state hidrata en web (Supabase emite
  // SIGNED_IN segundos después del mount), el useCallback se re-crea, el
  // useEffect re-dispara, y podemos cancelar/duplicar la carga en pleno vuelo.
  const fetchEvent = useCallback(async () => {
    if (!eventId) {
      // Sin ID: nada que cargar. Renderiza el fallback "no disponible".
      setFetchError('Sin ID de evento — verifica el link.');
      setLoading(false);
      return;
    }
    setFetchError(null);
    const tFetchStart = Date.now();
    const currentUser = useAuthStore.getState().user;
    remoteLog({
      screen: 'EventDetail', action: 'fetch_start', level: 'info', eventId,
      data: { userId: currentUser?.id ?? null,
              url: typeof window !== 'undefined' ? window.location.href : null },
    });

    // Cleanup oportunista: marca como 'cancelled' los guests pending_payment
    // que excedieron su tiempo de gracia (15min Yappy, 24h efectivo).
    // Fire-and-forget — supabase.rpc devuelve un PostgrestBuilder thenable
    // (NO Promise), así que NO tiene .catch directamente. Envolver con
    // Promise.resolve() para que sí lo tenga. Bug que rompía el spinner infinito
    // porque el TypeError sincronía rechazaba la async function antes del try.
    Promise.resolve(supabase.rpc('expire_pending_guests')).catch(() => {});

    // TIMEOUT global de 12s: si alguna de las queries cuelga (token expirado,
    // network drop, lock interno), no dejamos el spinner infinito — caemos al
    // fallback con mensaje específico para que el user pueda reintentar.
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout: fetchEvent tardó más de 12s')), 12000)
    );

    try {
      const allQueries = Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        // Fetch confirmed AND pending registrations so cash-pending users see their status
        supabase.from('event_registrations')
          .select('*, users(id, nombre, foto_url, genero)')
          .eq('event_id', eventId)
          .in('status', ['confirmed', 'pending', 'waitlist']),
        // Only show confirmed/pending_payment guests (not cancelled)
        supabase.from('event_guests')
          .select('*')
          .eq('event_id', eventId)
          .in('status', ['confirmed', 'pending_payment']),
        // Equipos armados por el gestor + jugadores (usuarios E invitados)
        supabase.from('teams')
          .select(`
            id, nombre, color, logo_url, grupo, vidas_iniciales, vidas_actuales,
            team_players(
              id, user_id, guest_id,
              users:user_id(id, nombre, foto_url),
              event_guests:guest_id(id, nombre, status, invited_by)
            )
          `)
          .eq('event_id', eventId)
          .order('grupo', { ascending: true })
          .order('nombre', { ascending: true }),
      ]);
      const [{ data: ev, error: evErr }, { data: regs }, { data: gs }, { data: ts }] =
        await Promise.race([allQueries, timeoutPromise]);
      // Matches del evento (para ganador final / penales)
      const matchesPromise = supabase
        .from('matches')
        .select('id, fase, status, team_home_id, team_away_id, goles_home, goles_away, goles_pen_home, goles_pen_away, fue_a_penales, seed_home, seed_away')
        .eq('event_id', eventId);
      const matchesTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout: matches')), 8000)
      );
      const { data: ms } = await Promise.race([matchesPromise, matchesTimeout]).catch((e) => {
        logWarn({ screen: 'EventDetail', action: 'fetchMatches', eventId, technical: e });
        return { data: [] };
      });
      if (evErr) throw evErr;
      if (!ev) {
        // Query OK pero row no existe: link inválido / evento borrado.
        setFetchError('Evento no encontrado.');
        remoteLog({
          screen: 'EventDetail', action: 'fetch_end', level: 'warn', eventId,
          data: { hasEvent: false, reason: 'not_found',
                  tFetchEvent: Date.now() - tFetchStart },
        });
        return;
      }
      const activeGuests = filterActiveEventGuests(gs ?? [], regs ?? []);
      remoteLog({
        screen: 'EventDetail', action: 'fetch_end', level: 'info', eventId,
        data: {
          hasEvent: true,
          regsCount:   regs?.length ?? 0,
          guestsCount: gs?.length   ?? 0,
          teamsCount:  ts?.length   ?? 0,
          matchesCount: ms?.length  ?? 0,
          tFetchEvent: Date.now() - tFetchStart,
        },
      });
      setEvent(ev);
      setParticipantRegs(regs?.filter(r => r.status !== 'waitlist') ?? []);
      setWaitlistRegs(regs?.filter(r => r.status === 'waitlist') ?? []);
      // For the player list, only show confirmed registrations
      setRegistrations(regs?.filter((r) => r.status === 'confirmed') ?? []);
      setGuests(activeGuests);
      setTeams(ts ?? []);
      setMatches(ms ?? []);
      // myReg: find the current user's registration (any non-cancelled status)
      setMyReg(regs?.find((r) => r.user_id === currentUser?.id) ?? null);
    } catch (e) {
      // Mensaje específico por tipo de fallo. Leave event as null so fallback renders.
      const isTimeout = /timeout/i.test(e?.message ?? '');
      const isNetwork = /network|fetch/i.test(e?.message ?? '');
      setFetchError(
        isTimeout ? 'La carga tardó demasiado. Revisa tu conexión y reintenta.' :
        isNetwork ? 'Sin conexión. Revisa tu red y reintenta.' :
                    'No se pudo cargar el evento. Reintenta en un momento.'
      );
      logError({ screen: 'EventDetail', action: 'fetchEvent', eventId,
                 userId: useAuthStore.getState().user?.id, technical: e,
                 userMessage: 'fetchEvent failed' });
      remoteLog({
        screen: 'EventDetail', action: 'fetch_end', level: 'error', eventId,
        data: { hasEvent: false, isTimeout, isNetwork,
                tFetchEvent: Date.now() - tFetchStart },
        error: e instanceof Error ? e : null,
      });
    } finally {
      setLoading(false);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
  }, [eventId]);

  useEffect(() => {
    logInfo({ screen: 'EventDetail', action: 'mount', eventId });
    remoteLog({ screen: 'EventDetail', action: 'mount', eventId });
    fetchEvent();
    // Cinturón + tirantes: si fetchEvent (con sus timeouts internos de 12s/8s) por
    // algún motivo no llega a setLoading(false), forzamos salir del skeleton a los 15s.
    loadingTimeoutRef.current = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setFetchError('La carga tardó demasiado. Reintenta.');
          logError({ screen: 'EventDetail', action: 'skeleton_timeout', eventId,
                     technical: 'loading > 15s' });
          remoteLog({ screen: 'EventDetail', action: 'skeleton_timeout',
                      level: 'error', eventId });
        }
        return false;
      });
    }, 15000);
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      remoteLog({ screen: 'EventDetail', action: 'unmount', eventId });
    };
  }, [fetchEvent]);

  // Cleanup absoluto del polling Yappy al desmontar la pantalla.
  // Sin esto el interval seguía 5 min llamando setState sobre un componente
  // desmontado si el user navegaba durante el pago.
  useEffect(() => () => {
    if (yappyCancelRef.current) {
      try { yappyCancelRef.current(); } catch {}
      yappyCancelRef.current = null;
    }
  }, []);

  // Auto-refresh cada 90s mientras la pantalla está focused (antes 30s → demasiado tráfico).
  // PAUSAMOS el refresh mientras hay un modal de pago / cancelación / invitado o
  // un flow Yappy activo para no sobrescribir datos mientras el user opera.
  const refreshPaused = payModal || cancelModal || guestModal || yappyStep !== 'idle' || paying || cancelling || yappyLoading;
  useFocusEffect(
    useCallback(() => {
      if (refreshPaused) return undefined;
      const interval = setInterval(fetchEvent, 90000);
      return () => clearInterval(interval);
    }, [fetchEvent, refreshPaused])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchEvent();
    setRefreshing(false);
  }, [fetchEvent]);

  // ── Internal credits payment ───────────────────────────────────────────────
  const payWithWallet = async () => {
    const precio = event?.precio ?? 0;
    if (precio <= 0) {
      Alert.alert('Error', 'Este evento no tiene un precio válido.');
      return;
    }
    if (walletBalance < precio) {
      Alert.alert('Créditos insuficientes', 'Compra créditos internos antes de inscribirte.');
      return;
    }
    // Guard: avoid double-tap submitting twice
    if (paying) return;
    setPaying(true);
    try {
      if (!(await checkCapacity())) { setPayModal(false); setPaying(false); await fetchEvent(); return; }
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
          throw new Error('Créditos insuficientes — por favor compra créditos internos.');
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
        const { error: regErr } = await supabase.from('event_registrations').upsert({
          event_id:     event.id,
          user_id:      user.id,
          metodo_pago:  'wallet',
          monto_pagado: precio,
          status:       'confirmed',
        }, { onConflict: 'event_id,user_id' });
        if (regErr) {
          // El trigger de capacidad pudo rechazar (evento lleno): revertir el
          // débito para no dejar al usuario sin cupo Y sin saldo.
          try {
            await supabase.from('wallets').update({ balance: wallet.balance })
              .eq('id', wallet.id).eq('balance', newBalance);
            await supabase.from('wallet_transactions').insert({
              wallet_id:   wallet.id,
              tipo:        'inscripcion',
              monto:       precio,
              descripcion: `Reverso inscripción (sin cupo): ${event.nombre}`,
            });
          } catch {}
          throw new Error(regErr.message);
        }
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
      // Si el evento ya tiene equipos creados, avisar al gestor para que lo asigne.
      // Fire-and-forget; no bloquea el flujo de inscripción.
      notifyGestorOfNewRegistration(event.id, user?.nombre).catch(() => {});
      Alert.alert('¡Inscrito!', 'Te has inscrito exitosamente.', [{ text: 'OK', onPress: fetchEvent }]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPaying(false);
    }
  };

  // ── Yappy Botón flow ──────────────────────────────────────────────────────
  const cancelYappy = () => {
    if (yappyCancelRef.current) { yappyCancelRef.current(); yappyCancelRef.current = null; }
    setYappyStep('idle');
    setYappyLoading(false);
  };

  // Opens phone-input modal (closes PaymentModal first)
  const payWithYappy = () => {
    setPayModal(false);
    setYappyPhone('');
    setYappyStep('phone');
  };

  // Pago mixto: wallet cubre la parte mayor, Yappy el resto
  const payMixto = (walletMonto, yappyMonto) => {
    setPayModal(false);
    setMixtoWallet(walletMonto);
    setMixtoYappy(yappyMonto);
    setYappyPhone('');
    setYappyStep('phone_mixto');
  };

  const confirmarYappyMixto = async () => {
    const phone = yappyPhone.replace(/\D/g, '');
    if (phone.length < 7) { Alert.alert('Error', 'Ingresá un número Yappy válido'); return; }
    if (!(await checkCapacity())) { setYappyStep('idle'); await fetchEvent(); return; }
    setYappyLoading(true);
    let orderId;
    try {
      const result = await iniciarBotonYappy({
        phone, amount: mixtoYappy, tipo: 'mixto', event_id: event.id,
      });
      orderId = result.orderId;
    } catch (e) {
      setYappyLoading(false);
      setYappyStep('idle');
      Alert.alert('Error Yappy', friendlyPayError(e));
      return;
    }
    setYappyStep('polling_mixto');
    setYappyProgress({ attempts: 0, maxAttempts: 60 });
    const { promise, cancel } = pollBotonOrder({ orderId, onProgress: (p) => setYappyProgress(p) });
    yappyCancelRef.current = cancel;
    promise
      .then(async () => {
        yappyCancelRef.current = null;
        // Yappy cobró — ahora debitar wallet y confirmar inscripción
        const { error } = await Promise.resolve(
          supabase.rpc('inscribir_mixto', {
            p_event_id:     event.id,
            p_wallet_monto: mixtoWallet,
            p_yappy_monto:  mixtoYappy,
          })
        );
        setYappyStep('idle');
        setYappyLoading(false);
        if (error) {
          Alert.alert('Error al confirmar inscripción', error.message + '\n\nContactá al admin — tu pago Yappy fue procesado.');
          return;
        }
        const precio = (mixtoWallet + mixtoYappy).toFixed(2);
        Alert.alert('¡Inscrito!', `Pago mixto de $${precio} confirmado ($${mixtoWallet.toFixed(2)} créditos + $${mixtoYappy.toFixed(2)} Yappy). ¡Estás inscrito!`, [
          { text: 'OK', onPress: fetchEvent },
        ]);
      })
      .catch((e) => {
        yappyCancelRef.current = null;
        setYappyStep('idle');
        setYappyLoading(false);
        if (e.message !== 'cancelled') Alert.alert('Pago no completado', friendlyPayError(e));
      });
  };

  const confirmarYappyBoton = async () => {
    const phone  = yappyPhone.replace(/\D/g, '');
    const precio = event?.precio ?? 0;
    if (phone.length < 7) { Alert.alert('Error', 'Ingresa un número Yappy válido (mínimo 7 dígitos).'); return; }
    if (precio <= 0)       { Alert.alert('Error', 'Este evento no tiene un precio válido.'); return; }
    if (!(await checkCapacity())) { setYappyStep('idle'); await fetchEvent(); return; }

    setYappyLoading(true);

    // RESERVA del cupo mientras paga — la valida el trigger server-side con
    // lock por evento: dos pagos simultáneos ya no toman el mismo cupo, el
    // segundo recibe el error AQUÍ, antes de cobrar (bug 2026-06-04: dos
    // Yappy con 25 seg de diferencia dejaron 21/20). El IPN convierte la
    // reserva en 'confirmed' (upsert) y si el flujo muere sin pagar, el cron
    // la libera en ~20 min. created_at explícito renueva el TTL si la fila
    // ya existía (ej. cancelled). Los promovidos de waitlist YA tienen cupo
    // reservado: no pisar su fila.
    const isPromotedReg = myReg?.status === 'pending' && myReg?.metodo_pago === 'waitlist_promoted';
    if (!isPromotedReg) {
      const { error: resErr } = await supabase.from('event_registrations').upsert({
        event_id:     event.id,
        user_id:      user.id,
        metodo_pago:  'yappy_boton',
        monto_pagado: 0,
        status:       'pending',
        created_at:   new Date().toISOString(),
      }, { onConflict: 'event_id,user_id' });
      if (resErr) {
        setYappyLoading(false);
        setYappyStep('idle');
        const sinCupo = /lleno|cupos/i.test(resErr.message ?? '');
        Alert.alert(
          sinCupo ? 'Sin cupo' : 'Error',
          sinCupo ? 'El último cupo se ocupó hace un momento. No se realizó ningún cobro.' : resErr.message,
        );
        await fetchEvent();
        return;
      }
    }

    // Libera la reserva si el pago no se concreta (solo toca la fila-reserva:
    // pending + yappy_boton + monto 0). Cancelarla dispara la promoción de
    // la lista de espera. Si Yappy aprobara tardío, el IPN la revive.
    const releaseReserva = async () => {
      if (isPromotedReg) return;
      try {
        await supabase.from('event_registrations')
          .update({ status: 'cancelled' })
          .eq('event_id', event.id).eq('user_id', user.id)
          .eq('status', 'pending').eq('metodo_pago', 'yappy_boton').eq('monto_pagado', 0);
      } catch {}
    };

    let orderId;
    try {
      // tipo='evento' → IPN inscribirá directamente sin tocar wallet
      const result = await iniciarBotonYappy({ phone, amount: precio, tipo: 'evento', event_id: event.id });
      orderId = result.orderId;
    } catch (e) {
      await releaseReserva();
      Alert.alert('Error Yappy', friendlyPayError(e));
      setYappyLoading(false);
      return;
    }

    setYappyStep('polling');
    setYappyProgress({ attempts: 0, maxAttempts: 60 });

    const { promise, cancel } = pollBotonOrder({
      orderId,
      onProgress: (p) => setYappyProgress(p),
    });
    yappyCancelRef.current = cancel;

    promise
      .then(async () => {
        yappyCancelRef.current = null;
        setYappyStep('idle');
        // Failsafe: si el IPN confirmó yappy_orders pero falló al llamar inscribir_yappy_evento
        // (el polling detecta 'executed' pero el registro queda en 'pending'), lo llamamos
        // directamente desde el cliente. Es idempotente: si ya está confirmed, no hace nada.
        try {
          await supabase.rpc('inscribir_yappy_evento', {
            p_user_id:  user.id,
            p_event_id: event.id,
            p_monto:    precio,
            p_order_id: orderId,
          });
        } catch { /* si falla (ej. ya confirmado), ignorar */ }
        notifyGestorOfNewRegistration(event.id, user?.nombre).catch(() => {});
        Alert.alert('¡Inscrito!', `Pago de $${precio.toFixed(2)} con Yappy confirmado. ¡Estás inscrito!`, [
          { text: 'OK', onPress: fetchEvent },
        ]);
      })
      .catch(async (e) => {
        yappyCancelRef.current = null;
        setYappyStep('idle');
        // Pago no concretado (timeout/cancelado/rechazado): liberar el cupo.
        await releaseReserva();
        if (e.message !== 'cancelled') Alert.alert('Pago no completado', friendlyPayError(e));
      })
      .finally(() => setYappyLoading(false));
  };

  // ── Cash payment ─────────────────────────────────────────────────────────
  const payWithEfectivo = async () => {
    if (paying) return;
    setPaying(true);
    try {
      if (!(await checkCapacity())) { setPayModal(false); setPaying(false); await fetchEvent(); return; }
      // Guard: check if user already has a registration (any non-cancelled status)
      const { data: existingReg } = await supabase
        .from('event_registrations')
        .select('id, status, metodo_pago')
        .eq('event_id', event.id)
        .eq('user_id', user.id)
        .in('status', ['confirmed', 'pending'])
        .maybeSingle();
      // EXCEPCIÓN promovido de waitlist: su fila ya es 'pending'/waitlist_promoted
      // (ocupa el cupo reservado). DEBE poder elegir efectivo para reclamarlo —
      // sin esta excepción el guard lo rebotaba y perdía el cupo por TTL sin que
      // se creara ninguna solicitud para el gestor (el cupo es suyo, ya reservado).
      const isPromotedReg = existingReg?.status === 'pending' && existingReg?.metodo_pago === 'waitlist_promoted';
      if (existingReg && !isPromotedReg) {
        setPayModal(false);
        Alert.alert(
          existingReg.status === 'confirmed' ? 'Ya estás inscrito' : 'Ya tienes un pago pendiente',
          existingReg.status === 'confirmed'
            ? 'Ya tienes una inscripción confirmada en este evento.'
            : 'Ya tienes un pago en efectivo pendiente. Contacta al gestor para confirmarlo.',
        );
        await fetchEvent();
        return;
      }

      // Fetch gestor contact info (nombre + telefono)
      const { data: gestor } = await supabase
        .from('users')
        .select('nombre, telefono, correo')
        .eq('id', event.created_by)
        .maybeSingle();

      // Create a pending registration so the user sees their spot is reserved
      const { error: regErr } = await supabase.from('event_registrations').upsert({
        event_id:     event.id,
        user_id:      user.id,
        metodo_pago:  'efectivo',
        monto_pagado: event.precio ?? 0,
        status:       'pending',
      }, { onConflict: 'event_id,user_id' });
      if (regErr) throw new Error(regErr.message);

      // Also create the cash_payment_request for admin tracking
      const { error: cashErr } = await supabase.from('cash_payment_requests').insert({
        user_id:   user.id,
        event_id:  event.id,
        amount:    event.precio ?? 0,
      });
      // cash_payment_request failure is non-fatal — registration row already created
      if (cashErr) console.warn('cash_payment_requests insert failed:', cashErr.message);

      setPayModal(false);
      Alert.alert(
        'Pago en efectivo solicitado',
        `Tienes 4 horas para contactar al gestor y completar el pago de $${(event.precio ?? 0).toFixed(2)}.\n\n📞 Contactá al gestor: 6325-5309 o 6122-2854.\n\nTu cupo quedó reservado. Si el pago no se confirma en 4 horas, el cupo será liberado.`,
        [{ text: 'OK', onPress: fetchEvent }],
      );
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPaying(false);
    }
  };

  // ── Gender restriction ────────────────────────────────────────────────────
  const checkGenderAllowed = () => {
    const evGenero = event?.genero;
    if (!evGenero || evGenero === 'Mixto') return true;
    const userGenero = user?.genero;
    if (!userGenero) return true; // profile incomplete — allow, gestor/admin enforce
    return userGenero === evGenero;
  };

  // ── Inscripción gratuita (evento con precio 0 — sin pago) ──────────────────
  const registerFree = async () => {
    if (paying) return;
    setPaying(true);
    try {
      if (!(await checkCapacity())) { await fetchEvent(); return; }
      // Evitar doble inscripción
      const { data: existingReg } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', event.id)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .maybeSingle();
      if (existingReg) {
        Alert.alert('Ya estás inscrito', 'Ya tienes una inscripción confirmada en este evento.');
        await fetchEvent();
        return;
      }
      const { error: regErr } = await supabase.from('event_registrations').upsert({
        event_id:     event.id,
        user_id:      user.id,
        metodo_pago:  'gratis',
        monto_pagado: 0,
        status:       'confirmed',
      }, { onConflict: 'event_id,user_id' });
      if (regErr) throw new Error(regErr.message);
      // Avisar al gestor (fire-and-forget, no bloquea).
      notifyGestorOfNewRegistration(event.id, user?.nombre).catch(() => {});
      Alert.alert('¡Inscrito!', 'Te has inscrito exitosamente. ¡Nos vemos en la cancha!', [{ text: 'OK', onPress: fetchEvent }]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPaying(false);
    }
  };

  const openPayModal = () => {
    if (!checkGenderAllowed()) {
      const evGenero = event?.genero;
      Alert.alert(
        'Evento restringido',
        `Este es un evento ${evGenero}. Tu perfil indica que eres ${user?.genero}, por lo que no puedes inscribirte en este evento.`,
      );
      return;
    }
    // Evento gratis: no requiere pago → inscripción directa con confirmación.
    if ((event?.precio ?? 0) <= 0) {
      const freeTxt = freeLabel(event?.deporte);
      Alert.alert(
        freeTxt,
        `Este evento es sin costo. ¿Confirmás tu cupo para "${event.nombre}"?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: registerFree },
        ],
      );
      return;
    }
    setPayModal(true);
  };

  // ── Cancel registration ───────────────────────────────────────────────────
  const handleCancel = async (cancelGuests = false) => {
    if (!myReg?.id) {
      Alert.alert('Error', 'No se encontró tu inscripción. Recarga la pantalla.');
      return;
    }
    if (cancelling) return; // guard against double-tap
    setCancelling(true);
    try {
      const result = await cancelRegistration({
        registrationId: myReg.id,
        cancelGuests,
      });
      setCancelModal(false);

      // Idempotencia: si ya estaba cancelada (doble-tap / dos pestañas), no
      // mostrar un segundo aviso de reembolso — el RPC no devolvió de nuevo.
      if (result.alreadyCancelled) {
        Alert.alert('Ya cancelada', 'Esta inscripción ya estaba cancelada.', [{ text: 'OK', onPress: fetchEvent }]);
        return;
      }

      // If refunded, refresh wallet balance from DB (more reliable than local math)
      if (result.refunded) {
        const { data: wallet } = await supabase
          .from('wallets')
          .select('balance')
          .eq('user_id', user.id)
          .single();
        if (wallet) setWalletBalance(wallet.balance);
      }

      const guestNote = result.guestsCancelled > 0
        ? ` También se cancelaron ${result.guestsCancelled} invitado(s).`
        : result.guestsCancelFailed
          ? ' No se pudieron cancelar tus invitados automáticamente; el sistema los ocultará del evento y el gestor podrá limpiarlos.'
        : '';

      // Avisar al promovido de la lista de espera (si lo hubo) — fire-and-forget.
      notifyPromotedFromWaitlist(event).catch(() => {});

      if (result.refunded) {
        Alert.alert(
          'Inscripción cancelada',
          `Se devolvieron $${result.amount.toFixed(2)} (${result.pct === 1 ? '100%' : '50% por cancelar a menos de 48 h'}) a tus créditos internos.${guestNote}`,
          [{ text: 'OK', onPress: fetchEvent }],
        );
      } else if (result.penaltyApplied) {
        // Refresh profile so efectivo_bloqueado reflects immediately
        const { data: updatedUser } = await supabase.from('users').select('efectivo_bloqueado').eq('id', user.id).single();
        if (updatedUser) useAuthStore.setState((s) => ({ user: { ...s.user, ...updatedUser } }));
        Alert.alert(
          'Inscripción cancelada — Penalización aplicada',
          `Tu inscripción fue cancelada dentro de las 48 horas previas al evento.${guestNote}\n\n⚠️ Como penalización, el pago en efectivo quedará bloqueado para futuros eventos. Puedes usar créditos internos o Yappy.`,
          [{ text: 'Entendido', onPress: fetchEvent }],
        );
      } else {
        const noRefundReason = result.refundFailed
          ? ' No pudimos acreditar tu devolución automáticamente — escribí al administrador (6122-2854) para resolverla.'
          : ' No había pagos registrados para devolver.';
        Alert.alert(
          'Inscripción cancelada',
          `Tu inscripción fue cancelada.${noRefundReason}${guestNote}`,
          [{ text: 'OK', onPress: fetchEvent }],
        );
      }
    } catch (e) {
      Alert.alert('Error al cancelar', e.message);
    } finally {
      setCancelling(false);
    }
  };

  // Aviso (push + email) al jugador recién promovido de la lista de espera.
  // Tiene 4 horas para pagar antes de que el cupo pase al siguiente.
  const notifyPromotedFromWaitlist = async (ev) => {
    const { data: promoted } = await supabase
      .from('event_registrations')
      .select('user_id')
      .eq('event_id', ev.id)
      .eq('status', 'pending')
      .eq('metodo_pago', 'waitlist_promoted')
      .maybeSingle();
    if (!promoted?.user_id) return;
    await supabase.functions.invoke('send-notification', {
      body: {
        user_ids:    [promoted.user_id],
        force_email: true,
        title:       '🎉 ¡Se liberó tu cupo!',
        body:        `Se liberó un cupo en "${ev.nombre}" y es tuyo. Entrá a Birrea2Play y completá el pago dentro de las próximas 4 horas para confirmar tu lugar — pasado ese tiempo, el cupo pasa al siguiente de la lista.`,
        url:         'https://birrea2play.com',
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <EventDetailSkeleton />
    </SafeAreaView>
  );
  if (!event)  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontFamily: FONTS.body, color: COLORS.gray, fontSize: 15, textAlign: 'center', marginBottom: 20 }}>
        {fetchError ?? 'No se pudo cargar el evento.\nRevisa tu conexión e intenta de nuevo.'}
      </Text>
      <TouchableOpacity
        onPress={() => { setFetchError(null); setLoading(true); fetchEvent(); }}
        style={{ backgroundColor: COLORS.red, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginBottom: 12 }}
      >
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white, letterSpacing: 1 }}>Reintentar</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 4 }}>
        <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.blue2 }}>← Volver</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );

  const inscritos  = registrations.length + guests.length;
  // Regs 'pending' (efectivo/promovidos) reservan cupo pero no salen en la
  // lista de jugadores — mostrarlos aparte para que el conteo siempre cuadre.
  const pendientesPago = Math.max(0, (participantRegs?.length ?? 0) - registrations.length);
  const jugadoresInscritos = [
    ...registrations.filter(r => r.status === 'confirmed' && r.users?.nombre).map(r => ({ nombre: r.users.nombre, genero: r.users.genero })),
    ...guests.filter(g => g.status === 'confirmed' && g.nombre).map(g => ({ nombre: g.nombre, genero: g.genero ?? null })),
  ];
  // Capacity con desglose por género (si el evento Mixto lo tiene definido)
  const capacityInfo = computeEventCapacity(event, participantRegs ?? [], guests);
  // Mi bucket de género lleno (Mixto con desglose): aunque el otro género tenga
  // espacio, este usuario no puede inscribirse → ofrecerle lista de espera.
  const miGeneroLleno = capacityInfo.hasGenderQuota && (
    user?.genero === 'Masculino' ? capacityInfo.hombres.lleno
    : user?.genero === 'Femenino' ? capacityInfo.mujeres.lleno
    : false
  );
  // Ocupación REAL = confirmed + pending + invitados activos (total.lleno),
  // la misma cuenta que checkCapacity y el RPC join_event_waitlist. Antes se
  // usaba `inscritos` (sin pendings) y el botón "Inscribirse" aparecía en
  // eventos ya llenos, o viceversa.
  const cuposFull  = !event.cupos_ilimitado && (
    capacityInfo.total.lleno
    || (capacityInfo.hasGenderQuota
        && ((capacityInfo.hombres.lleno && capacityInfo.mujeres.lleno) || miGeneroLleno))
  );
  const { label: statusLabel, color: statusColor } = getEventStatusInfo(event.status);
  const refundInfo = myReg ? getRefundStatus(event.fecha, event.hora) : null;

  // Deadline for registration — 1 hour before event (only when hora is set)
  let regDeadline = null;
  let regDeadlinePassed = false;
  if (event.hora) {
    const [y, m, d] = event.fecha.split('-').map(Number);
    const [hh, mm] = event.hora.split(':').map(Number);
    regDeadline = new Date(y, m - 1, d, hh - 1, mm);
    regDeadlinePassed = new Date() >= regDeadline;
  }
  const canRegister = event.status === 'open' && !myReg && !cuposFull && !regDeadlinePassed;
  const isPromoted = !!myReg && myReg.status === 'pending' && myReg.metodo_pago === 'waitlist_promoted';
  const joinWaitlist = async () => {
    if (!user?.id) return;
    try {
      const { data: pos, error } = await supabase.rpc('join_event_waitlist', {
        p_user_id: user.id, p_event_id: event.id,
      });
      if (error) throw error;
      await fetchEvent();
      Alert.alert('En lista de espera', `Quedaste en la lista de espera${pos ? ` (puesto #${pos})` : ''}. Si se libera un cupo, vas a poder pagar tu lugar.`);
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo unir a la lista de espera');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
      <ResponsiveContainer>
        {/* Header */}
        <View style={styles.header} dataSet={{ t2Rise: '1' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{event.nombre}</Text>
          <TouchableOpacity
            onPress={() => shareEvent(event, { inscritos, jugadores: jugadoresInscritos })}
            style={{ paddingHorizontal: SPACING.sm, paddingVertical: 4 }}
            accessibilityLabel="Compartir evento"
          >
            <Text style={{ fontSize: 22 }}>📤</Text>
          </TouchableOpacity>
        </View>

        {/* Status + Timer */}
        <View style={styles.statusRow} dataSet={{ t2Rise: '2' }}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          {event.status === 'open' && !myReg && regDeadline && (
            <TimerBadge deadline={regDeadline} label="Inscripción cierra en" />
          )}
        </View>

        {/* CTA "VER EVENTO EN CURSO" — primer bloque interactivo cuando el evento ya arrancó */}
        {event.status === 'active' && (
          <TouchableOpacity
            style={styles.activeBtn}
            onPress={() => navigation.navigate('ActiveEvent', { eventId: event.id })}
            activeOpacity={0.85}
          >
            <View style={styles.activeBtnTitleRow}>
              {isModo26Active() && <View pointerEvents="none" dataSet={{ m26Blink: '' }} style={styles.m26LiveDot} />}
              <Text style={styles.activeBtnText}>⚡ VER EVENTO EN CURSO</Text>
            </View>
            <Text style={styles.activeBtnSub}>Resultados, MVP, tabla y jugadores en vivo</Text>
          </TouchableOpacity>
        )}

        {/* Foto de cancha — wrapper solo para anclar el holo (::after inset:0); sin estilos
            propios no cambia el layout, la Image adentro conserva su tamaño de siempre. */}
        {event.cancha_foto_url && (
          <View dataSet={{ t2Holo: 'auto', t2Tilt: '' }}>
            <Image
              source={{ uri: event.cancha_foto_url }}
              style={{ width: '100%', height: 180, resizeMode: 'cover' }}
            />
          </View>
        )}

        {/* Info card */}
        <View style={styles.card} dataSet={{ t2Glass: '', t2Rise: '3' }}>
          {event.deporte && <InfoRow icon="🏅" label={`${event.deporte} · ${event.formato}`} />}
          <InfoRow icon="📅" label={`${(() => { const [y,m,d] = event.fecha.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('es-PA', { weekday: 'long', day: 'numeric', month: 'long' }); })()} · ${event.hora?.slice(0, 5) ?? ''}`} />
          <InfoRow icon="📍" label={event.lugar} />
          {event.direccion ? <InfoRow icon="🏠" label={event.direccion} /> : null}
          <InfoRow icon="👤" label={event.genero} />
          {!event.cupos_ilimitado && (
            capacityInfo.hasGenderQuota
              ? <InfoRow icon="👥" label={`♂ ${capacityInfo.hombres.ocupados}/${capacityInfo.hombres.cupo}   ·   ♀ ${capacityInfo.mujeres.ocupados}/${capacityInfo.mujeres.cupo}`} />
              : <InfoRow icon="👥" label={`${capacityInfo.total.ocupados}/${event.cupos_total} jugadores`} />
          )}
          <InfoRow icon="💵" label={(event.precio ?? 0) > 0 ? `$${(event.precio).toFixed(2)} por jugador` : freeLabel(event.deporte)} />
          {event.descripcion ? <Text style={styles.desc}>{event.descripcion}</Text> : null}
          {event.maps_url && (
            <TouchableOpacity
              style={styles.mapsBtn}
              onPress={() => Linking.openURL(event.maps_url)}
            >
              <Text style={styles.mapsBtnText}>🗺 Ver en Google Maps</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Ganador del torneo (cuando hay final concluida) */}
        {(() => {
          const winner = getTournamentWinner(matches, teams);
          return winner ? <WinnerBanner winner={winner} /> : null;
        })()}

        {/* Aviso al jugador inscrito que aún no tiene equipo asignado.
            Aplica cuando: tiene reg confirmed/pending + el evento ya armó equipos +
            el user NO aparece en ningún team_players de los equipos cargados. */}
        {(() => {
          if (!myReg || !user?.id) return null;
          if (!['confirmed', 'pending'].includes(myReg.status)) return null;
          if (teams.length === 0) return null;
          const isAssigned = teams.some((t) =>
            (t.team_players ?? []).some((tp) => tp.user_id === user.id)
          );
          if (isAssigned) return null;
          return (
            <View style={styles.unassignedBanner}>
              <Text style={styles.unassignedTitle}>⏳ Esperando asignación de equipo</Text>
              <Text style={styles.unassignedText}>
                Estás inscrito. El gestor te asignará a un equipo antes del partido.
              </Text>
            </View>
          );
        })()}

        {/* Teams (cuando el gestor ya armó equipos) */}
        {teams.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>👕 Equipos · ¿qué color llevar?</Text>
            <View style={styles.teamsWrap}>
              {teams.map((t) => {
                const color = t.color || COLORS.blue;
                const activeUserIds = getActiveRegistrationUserIds(participantRegs);
                // Normalizar: jugador registrado (tp.users) o invitado (tp.event_guests)
                const players = (t.team_players ?? []).map((tp) => {
                  if (tp.users && activeUserIds.has(tp.users.id)) return { ...tp.users, isGuest: false };
                  if (tp.event_guests && isActiveEventGuest(tp.event_guests, participantRegs)) return { id: `guest:${tp.event_guests.id}`, nombre: tp.event_guests.nombre, foto_url: null, isGuest: true };
                  return null;
                }).filter(Boolean);
                const is2Vidas = event?.formato === '2 Vidas';
                const vidasTxt = is2Vidas
                  ? ((t.vidas_actuales ?? 0) > 0 ? '❤'.repeat(t.vidas_actuales) : '☠')
                  : null;
                return (
                  <View key={t.id} style={[styles.teamCard, { borderLeftColor: color, opacity: is2Vidas && (t.vidas_actuales ?? 0) === 0 ? 0.5 : 1 }]} dataSet={{ t2Glass: '' }}>
                    <View style={styles.teamHeader}>
                      <TeamMark team={t} size={26} square style={{ marginRight: 2 }} />
                      <Text style={styles.teamName}>{getTeamNameWithColor(t)}</Text>
                      {vidasTxt ? (
                        <Text style={[styles.teamGroup, { color: (t.vidas_actuales ?? 0) > 0 ? COLORS.red : COLORS.gray }]}>{vidasTxt}</Text>
                      ) : (t.grupo ? <Text style={styles.teamGroup}>Grupo {t.grupo}</Text> : null)}
                    </View>
                    {players.length === 0 ? (
                      <Text style={styles.teamEmpty}>Sin jugadores asignados</Text>
                    ) : (
                      <View style={styles.teamPlayersGrid}>
                        {players.map((p) => {
                          const isMe = !p.isGuest && p.id === user?.id;
                          const onPress = p.isGuest ? undefined : () => navigation.navigate('PlayerProfile', { userId: p.id });
                          return (
                            <TouchableOpacity
                              key={p.id}
                              style={styles.teamPlayerChip}
                              onPress={onPress}
                              activeOpacity={p.isGuest ? 1 : 0.75}
                              disabled={p.isGuest}
                            >
                              {p.isGuest ? (
                                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color }}>
                                  <Text style={{ fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white }}>
                                    {(p.nombre ?? '?').charAt(0).toUpperCase()}
                                  </Text>
                                </View>
                              ) : (
                                <PlayerAvatar user={p} size={36} borderColor={color} />
                              )}
                              <Text
                                style={[styles.teamPlayerName, isMe && { color: COLORS.gold, fontFamily: FONTS.bodyBold }]}
                                numberOfLines={1}
                              >
                                {isMe ? 'Tú' : p.nombre}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Players */}
        <Text style={styles.sectionTitle}>
          Jugadores inscritos ({inscritos}{pendientesPago > 0 ? ` · ${pendientesPago} pendiente${pendientesPago > 1 ? 's' : ''} de pago` : ''})
        </Text>
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

        {/* Lista de espera */}
        {waitlistRegs.length > 0 && (
          <View style={{ marginTop: SPACING.md, paddingHorizontal: SPACING.md }}>
            <Text style={styles.sectionTitle}>Lista de espera ({waitlistRegs.length})</Text>
            {waitlistRegs.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.line ?? '#1E2530' }}>
                <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2 ?? COLORS.gray, width: 22 }}>#{i + 1}</Text>
                <PlayerAvatar user={r.users} size={32} />
                <Text style={{ fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white, flex: 1 }}>{r.users?.nombre}</Text>
                {r.users?.genero && (
                  <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 ?? COLORS.gray }}>{r.users.genero === 'Masculino' ? '♂' : '♀'}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Payment / inscription */}
        {/* Si no hay usuario logueado: CTA Login con returnTo al evento */}
        {!user?.id && event.status === 'open' && (
          <View style={styles.paySection}>
            <Text style={styles.payTitle}>INSCRIPCIÓN — {(event.precio ?? 0) > 0 ? `$${(event.precio ?? 0).toFixed(2)}` : freeLabel(event.deporte)}</Text>
            <TouchableOpacity
              style={styles.btnPay}
              onPress={() => navigation.navigate('Login', { returnTo: 'EventDetail', returnParams: { eventId: event.id } })}
            >
              <Text style={styles.btnPayText}>🔒 Iniciar sesión para inscribirme →</Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center', marginTop: 8 }}>
              ¿No tenés cuenta? Crea una al iniciar sesión.
            </Text>
          </View>
        )}

        {user?.id && canRegister && (
          <View style={styles.paySection}>
            <Text style={styles.payTitle}>INSCRIPCIÓN — {(event.precio ?? 0) > 0 ? `$${(event.precio ?? 0).toFixed(2)}` : freeLabel(event.deporte)}</Text>
            <TouchableOpacity
              style={styles.btnPay}
              onPress={openPayModal}
              disabled={paying || cancelling || yappyLoading}
            >
              <Text style={styles.btnPayText}>Inscribirse →</Text>
            </TouchableOpacity>
          </View>
        )}

        {myReg && (
          <View style={[
            styles.registeredBox,
            myReg.status === 'pending' && { borderColor: COLORS.gold, backgroundColor: COLORS.gold + '15' },
          ]}>
            {myReg.status === 'pending' ? (
              isPromoted ? (
                <>
                  <Text style={[styles.registeredText, { color: COLORS.gold }]}>
                    🎉 ¡Se liberó tu cupo! Pagá para confirmar tu lugar.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPay}
                    onPress={openPayModal}
                    disabled={paying || cancelling || yappyLoading}
                  >
                    <Text style={styles.btnPayText}>Pagar e inscribirme →</Text>
                  </TouchableOpacity>
                </>
              ) : myReg.metodo_pago === 'efectivo' ? (
                <CashPendingBanner createdAt={myReg?.created_at} />
              ) : (
                <Text style={styles.registeredText}>
                  ⏳ Pago Yappy en proceso. Si no completaste el pago, el cupo se libera solo en ~20 min y podés reintentar.
                </Text>
              )
            ) : (
              <Text style={styles.registeredText}>✓ Estás inscrito en este evento</Text>
            )}
            {myReg.status === 'confirmed' && (
              <TouchableOpacity style={styles.btnGuest} onPress={() => setGuestModal(true)}>
                <Text style={styles.btnGuestText}>👥 Llevar Invitado</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btnCancelReg} onPress={() => setCancelModal(true)}>
              <Text style={styles.btnCancelRegText}>Cancelar inscripción</Text>
            </TouchableOpacity>
          </View>
        )}

        {!myReg && !canRegister && event.status === 'open' && (
          cuposFull ? (
            <View style={styles.paySection}>
              <Text style={styles.fullText}>Evento lleno — no hay cupos disponibles</Text>
              {user?.id && !event.cupos_ilimitado && (
                <TouchableOpacity
                  style={[styles.btnPay, { backgroundColor: COLORS.navy, marginTop: SPACING.sm }]}
                  onPress={joinWaitlist}
                >
                  <Text style={styles.btnPayText}>📋 Unirse a la lista de espera</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <Text style={styles.fullText}>Inscripciones cerradas</Text>
          )
        )}

        {/* Rifa Aniversario */}
        {user?.id && (
          <RaffleBanner eventId={eventId} navigation={navigation} />
        )}

        <View style={{ height: SPACING.xxl }} />
      </ResponsiveContainer>
      </ScrollView>

      {/* Modals */}
      <PaymentModal
        visible={payModal}
        onClose={() => setPayModal(false)}
        onPayWallet={payWithWallet}
        onPayYappy={payWithYappy}
        onPayEfectivo={payWithEfectivo}
        onPayMixto={payMixto}
        amount={event.precio ?? 0}
        walletBalance={walletBalance}
        loading={paying || yappyLoading}
        showEfectivo={!event.pago_solo_yappy || !!event.pago_efectivo_libre}
        showWallet={!event.pago_solo_yappy}
        efectivoLibre={!!event.pago_efectivo_libre}
        efectivoBloqueado={!!user?.efectivo_bloqueado}
      />

      <CancelRegistrationModal
        visible={cancelModal}
        onClose={() => setCancelModal(false)}
        onConfirm={handleCancel}
        loading={cancelling}
        canRefund={(event.precio ?? 0) > 0 && !!refundInfo?.canRefund}
        amount={(event.precio ?? 0) > 0 ? (myReg?.monto_pagado ?? 0) : 0}
        refundDeadline={refundInfo?.refundDeadline}
        metodoPago={myReg?.metodo_pago}
        guestCount={guests.filter((g) => g.invited_by === user?.id && g.status !== 'cancelled').length}
      />

      <GuestModal
        visible={guestModal}
        onClose={() => setGuestModal(false)}
        eventId={event.id}
        eventNombre={event.nombre}
        eventPrecio={event.precio ?? 0}
        userId={user.id}
        walletBalance={walletBalance}
        onSuccess={fetchEvent}
        eventCuposTotal={event.cupos_total}
        eventCuposIlimitado={event.cupos_ilimitado}
        eventGenero={event.genero}
        eventCuposHombres={event.cupos_hombres}
        eventCuposMujeres={event.cupos_mujeres}
      />

      {/* Yappy Botón — phone input + polling (same UI as WalletScreen) */}
      <Modal visible={yappyStep !== 'idle'} transparent animationType="slide" onRequestClose={cancelYappy}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={yappyStyles.modalOverlay}>
            <View style={yappyStyles.modal} dataSet={{ t2Glass: '' }}>
              <Text style={yappyStyles.modalTitle}>PAGAR CON YAPPY</Text>

              {(yappyStep === 'phone' || yappyStep === 'phone_mixto') && (
                <>
                  <Text style={yappyStyles.metodoInfo}>
                    {yappyStep === 'phone_mixto'
                      ? `Pago mixto — $${mixtoWallet.toFixed(2)} se debitarán de tus créditos y `
                      : 'Ingresa tu número Yappy. '}
                    Recibirás una notificación para aprobar el cobro de{' '}
                    <Text style={{ color: COLORS.green, fontFamily: FONTS.bodyMedium }}>
                      ${yappyStep === 'phone_mixto' ? mixtoYappy.toFixed(2) : (event?.precio ?? 0).toFixed(2)}
                    </Text>
                    {yappyStep === 'phone_mixto' ? ' por Yappy.' : '.'}
                  </Text>

                  <TextInput
                    style={yappyStyles.input}
                    placeholder="Número Yappy (ej. 61234567)"
                    placeholderTextColor={COLORS.gray}
                    keyboardType="phone-pad"
                    value={yappyPhone}
                    onChangeText={setYappyPhone}
                    maxLength={12}
                    autoFocus
                  />

                  <View style={yappyStyles.modalBtns}>
                    <TouchableOpacity style={yappyStyles.modalCancel} onPress={cancelYappy}>
                      <Text style={yappyStyles.modalCancelText}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[yappyStyles.modalConfirm, {
                        opacity: yappyPhone.replace(/\D/g, '').length >= 7 ? 1 : 0.4,
                      }]}
                      onPress={yappyStep === 'phone_mixto' ? confirmarYappyMixto : confirmarYappyBoton}
                      disabled={yappyLoading || yappyPhone.replace(/\D/g, '').length < 7}
                    >
                      {yappyLoading
                        ? <ActivityIndicator color={COLORS.white} />
                        : <Text style={yappyStyles.modalConfirmText}>📱 Cobrar por Yappy</Text>
                      }
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {(yappyStep === 'polling' || yappyStep === 'polling_mixto') && (
                <>
                  <View style={yappyStyles.openedCard}>
                    <ActivityIndicator color={COLORS.green} style={{ marginBottom: 12 }} />
                    <Text style={yappyStyles.openedTitle}>Esperando aprobación...</Text>
                    <Text style={yappyStyles.openedAmount}>
                      ${yappyStep === 'polling_mixto' ? mixtoYappy.toFixed(2) : (event?.precio ?? 0).toFixed(2)}
                    </Text>
                    <Text style={yappyStyles.openedSub}>
                      Abre tu app Yappy y acepta el cobro de Birrea2Play.{'\n'}
                      O entra a tu banca en línea y elegí la opción de Yappy.
                    </Text>
                    <Text style={yappyStyles.pollingDots}>
                      {yappyProgress.attempts}/{yappyProgress.maxAttempts} intentos
                    </Text>
                  </View>
                  <View style={yappyStyles.modalBtns}>
                    <TouchableOpacity style={yappyStyles.modalCancel} onPress={cancelYappy}>
                      <Text style={yappyStyles.modalCancelText}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  mapsBtn:      { marginTop: SPACING.sm, backgroundColor: COLORS.blue + '25', borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.blue },
  mapsBtnText:  { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.blue2 ?? COLORS.blue },
  sectionTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  // Teams (cuando el gestor ya armó equipos)
  teamsWrap:        { paddingHorizontal: SPACING.md, marginBottom: SPACING.md, gap: SPACING.sm },
  teamCard:         { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderLeftWidth: 6, borderWidth: 1, borderColor: COLORS.navy, marginBottom: SPACING.sm },
  teamHeader:       { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  teamSwatch:       { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: COLORS.navy },
  teamName:         { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, flex: 1 },
  teamGroup:        { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gold, letterSpacing: 1, textTransform: 'uppercase' },
  // Banner amarillo "esperando asignación de equipo"
  unassignedBanner: {
    marginHorizontal: SPACING.md,
    marginBottom:     SPACING.md,
    padding:          SPACING.md,
    backgroundColor:  (COLORS.gold ?? '#F0A500') + '18',
    borderLeftWidth:  4,
    borderLeftColor:  COLORS.gold ?? '#F0A500',
    borderRadius:     RADIUS.sm ?? 8,
  },
  unassignedTitle:  { fontFamily: FONTS.bodyBold, color: COLORS.gold ?? '#F0A500', fontSize: 13, letterSpacing: 0.5, marginBottom: 4 },
  unassignedText:   { fontFamily: FONTS.body, color: COLORS.white, fontSize: 12, lineHeight: 17 },
  teamPlayersRow:   { marginTop: SPACING.xs }, // legacy, conservado por si otra pantalla lo usa
  // Grid 2 columnas: cada chip ocupa ~48% del ancho del card; flexWrap envuelve a la siguiente fila
  // automáticamente. Sin scroll lateral. Avatar 36px + nombre completo al lado.
  teamPlayersGrid:  { marginTop: SPACING.sm, flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs ?? 4, rowGap: SPACING.xs ?? 4 },
  teamPlayerChip:   {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '48%',
    paddingVertical: 4,
    paddingRight: 4,
    minHeight: 44, // tappable target (HIG)
  },
  teamPlayerName:   { fontFamily: FONTS.body, fontSize: 13, color: COLORS.white, flex: 1 },
  teamEmpty:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, fontStyle: 'italic' },
  playersRow:   { paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  playerChip:   { alignItems: 'center', gap: 4, marginRight: SPACING.md },
  playerName:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  guestAvatar:  { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.navy, alignItems: 'center', justifyContent: 'center' },
  guestIcon:    { fontSize: 22 },
  activeBtn:    {
    backgroundColor: COLORS.magenta,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    shadowColor: COLORS.magenta,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: COLORS.magenta,
  },
  activeBtnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  m26LiveDot:   { width: 9, height: 9, borderRadius: 5, backgroundColor: COLORS.red },
  activeBtnText:{ fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2 },
  activeBtnSub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.white + 'CC', marginTop: 2 },
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

// Same styles as WalletScreen Yappy modal for visual consistency
const yappyStyles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: COLORS.card2 ?? COLORS.card,
    borderTopLeftRadius: RADIUS.xl ?? 20,
    borderTopRightRadius: RADIUS.xl ?? 20,
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  modalTitle:       { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  metodoInfo:       { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center' },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  modalBtns:        { flexDirection: 'row', gap: SPACING.sm },
  modalCancel: {
    flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card,
  },
  modalCancelText:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray },
  modalConfirm: {
    flex: 2, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    backgroundColor: COLORS.green,
  },
  modalConfirmText: { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.white, letterSpacing: 1 },
  openedCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.green + '44',
  },
  openedTitle:  { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.green, marginBottom: 4 },
  openedAmount: { fontFamily: FONTS.heading, fontSize: 44, color: COLORS.white, marginVertical: 4 },
  openedSub:    { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center', marginTop: 4 },
  pollingDots:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 8 },
});

// ─── RaffleBanner: cargado inline para no añadir pantalla extra si la rifa no existe ───
function RaffleBanner({ eventId, navigation }) {
  const [active, setActive] = React.useState(false);
  const [prize,  setPrize]  = React.useState('Camiseta Aniversario');
  const [winner, setWinner] = React.useState(null);
  const [closed, setClosed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!eventId) return;
    supabase.rpc('raffle_get_status', { p_event_id: eventId }).then(({ data }) => {
      if (data?.active) {
        setActive(true);
        setPrize(data.prize_name ?? 'Camiseta Aniversario');
        setWinner(data.winner_nom ?? null);
        setClosed(data.winner_confirmed ?? false);
      }
      setLoading(false);
    });
  }, [eventId]);

  if (loading || !active) return null;

  return (
    <TouchableOpacity
      style={raffleBannerStyles.card}
      onPress={() => navigation.navigate('Raffle', { eventId })}
      activeOpacity={0.85}
    >
      <View style={raffleBannerStyles.left}>
        <Text style={raffleBannerStyles.emoji}>🎟️</Text>
        <View>
          <Text style={raffleBannerStyles.label}>RIFA ANIVERSARIO</Text>
          <Text style={raffleBannerStyles.sub}>
            {closed && winner
              ? `🏆 Ganó: ${winner}`
              : winner
                ? `🎉 Girando… ${winner}`
                : `Premio: ${prize}`}
          </Text>
        </View>
      </View>
      <Text style={raffleBannerStyles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const raffleBannerStyles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md, marginBottom: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    padding: SPACING.md, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1, borderColor: COLORS.gold + '55',
  },
  left:  { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, flex: 1 },
  emoji: { fontSize: 28 },
  label: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gold, letterSpacing: 2 },
  sub:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginTop: 2 },
  arrow: { fontFamily: FONTS.bodyBold, fontSize: 22, color: COLORS.gray },
});
