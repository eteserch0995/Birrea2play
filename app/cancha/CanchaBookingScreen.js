import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert,
  Linking, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS, TYPE, withAlpha } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useAuthStore from '../../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../lib/yappy';
import { iniciarPagoTarjeta } from '../../lib/paguelofacil';
import { Card, Chip, Field, BottomSheetModal, ScreenHeader, PressableScale } from '../../components/ui';
import ResponsiveContainer from '../../components/ResponsiveContainer';
import { useAppRefresh } from '../../hooks/useAppRefresh';

// ── constantes ───────────────────────────────────────────────────────────────
const YAPPY_FEE        = 0.25;
const PRIVILEGED_ROLES = ['gestor', 'cancha_admin', 'admin'];
const WHATSAPP_GESTOR  = '50761222854';

// ── utils ──────────────────────────────────────────────────────────────────
function todayIso() { return new Date().toISOString().split('T')[0]; }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function formatDateChip(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return { dia: d.getDate(), mes: mes[d.getMonth()], dow: dow[d.getDay()] };
}

function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const mes = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${dow[d.getDay()]} ${d.getDate()} ${mes[d.getMonth()]}`;
}

function fmt12(hora) {
  if (!hora) return '';
  const [h, m] = hora.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

function money(n) { return `$${Number(n ?? 0).toFixed(2)}`; }

function tarifaLabelFor(t) {
  if (!t) return '';
  return `${t.deporte ?? 'Cancha'}${t.formato_jpe ? ` ${t.formato_jpe}v${t.formato_jpe}` : ''}`.trim();
}

function duracionLabel(min) {
  if (min === 60) return '1 hora';
  if (min === 90) return '1 h 30';
  if (min === 120) return '2 horas';
  return `${min} min`;
}

// Ported verbatim (plumbing WhatsApp) — CanchaBookingScreen.js viejo, líneas 48-53.
function openWhatsApp(telefono, mensaje) {
  const digits = (telefono ?? '').replace(/\D/g, '');
  const num = digits.startsWith('507') ? digits : '507' + digits;
  const url = `https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`;
  Linking.openURL(url).catch(() => Alert.alert('WhatsApp', 'No se pudo abrir WhatsApp.'));
}

// Misma fórmula que usa crear_cancha_reserva en el servidor (estimado local para
// mostrar en el resumen antes de solicitar — el monto real lo calcula el RPC).
function computeAbono(cancha, monto) {
  if (!cancha || !monto) return 0;
  const tipo = cancha.abono_tipo ?? (cancha.requiere_deposito ? 'porcentaje' : 'ninguno');
  switch (tipo) {
    case 'ninguno': return 0;
    case 'fijo':    return Number(cancha.abono_monto_fijo ?? 0);
    case 'total':   return monto;
    case 'porcentaje':
    default:        return Number((monto * ((cancha.porcentaje_deposito ?? 50) / 100)).toFixed(2));
  }
}

function abonoBadgeLabel(cancha) {
  const tipo = cancha.abono_tipo ?? (cancha.requiere_deposito ? 'porcentaje' : 'ninguno');
  if (tipo === 'ninguno') return 'Sin abono';
  if (tipo === 'fijo')    return `Abono ${money(cancha.abono_monto_fijo)}`;
  if (tipo === 'total')   return 'Pago total';
  return `Abono ${cancha.porcentaje_deposito ?? 50}%`;
}

// Mapa de errores de crear_cancha_reserva (EXCEPTION del RPC) a mensajes legibles.
const RESERVA_ERRORS = {
  CANCHA_INACTIVA:                     'Esta cancha ya no está disponible.',
  FECHA_PASADA:                        'Esa fecha ya pasó — elegí otra.',
  DIA_NO_OPERATIVO:                    'La cancha no opera ese día.',
  FUERA_HORARIO_APERTURA:              'Ese horario es antes de que abra la cancha.',
  FUERA_HORARIO_CIERRE:                'Ese horario es después de que cierra la cancha.',
  INICIO_INVALIDO:                     'Ese horario de inicio no es válido para esta cancha.',
  DURACION_MINIMA_1_HORA:              'La reserva mínima es de 1 hora.',
  DURACION_DEBE_SER_HORAS_COMPLETAS:   'Elegí una duración válida.',
  DURACION_INVALIDA_SLOT_FIJO:         'Esa duración no está disponible para esta cancha.',
  DURACION_MENOR_AL_MINIMO:            'La duración elegida es menor al mínimo permitido.',
  DURACION_MAYOR_AL_MAXIMO:            'La duración elegida supera el máximo permitido.',
  SLOT_NO_DISPONIBLE:                  'Ese horario ya fue tomado — elegí otro.',
  tarifa_no_encontrada:                'Esa tarifa ya no está disponible.',
  forbidden:                           'Tu cuenta no tiene permiso para reservar canchas.',
};
function mapReservaError(message) {
  if (!message) return 'No se pudo completar la solicitud.';
  const key = Object.keys(RESERVA_ERRORS).find((k) => message.includes(k));
  return key ? RESERVA_ERRORS[key] : message;
}

function mapWalletError(code, amount, balance) {
  if (code === 'insufficient_balance') {
    return `Saldo insuficiente. Necesitás ${money(amount)} y tenés ${money(balance)}.`;
  }
  if (code === 'reserva_expirada')  return 'El tiempo para pagar expiró — volvé a solicitar la reserva.';
  if (code === 'reserva_no_aprobada') return 'La cancha todavía no aprobó esta reserva.';
  return code ? `Error: ${code}` : 'No se pudo procesar el pago.';
}

// Canchas activas + sus tarifas activas (ordenadas por precio) — usado tanto por
// el gate solo-lectura como por el Paso 1 del stepper del gestor.
async function fetchCanchasConTarifas() {
  const { data, error } = await supabase
    .from('canchas')
    .select(`
      id, nombre, direccion, telefono, foto_url,
      abono_tipo, abono_monto_fijo, porcentaje_deposito, requiere_deposito,
      duracion_max_minutos, permite_media_hora_extra,
      cancha_tarifas ( id, deporte, formato_jpe, descripcion, precio_hora, activo )
    `)
    .eq('activa', true)
    .order('nombre', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    ...c,
    tarifas: (c.cancha_tarifas ?? [])
      .filter((t) => t.activo)
      .sort((a, b) => Number(a.precio_hora) - Number(b.precio_hora)),
  }));
}

// Fuente única de disponibilidad — reemplaza el cálculo manual de slots del
// archivo viejo (cancha_horarios + cancha_reservas + bloqueos a mano).
async function fetchSlots(canchaId, fecha, duracionMin) {
  const { data, error } = await supabase.rpc('get_disponibilidad_slots', {
    p_cancha_id: canchaId, p_fecha: fecha, p_duracion_min: duracionMin,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Countdown en vivo (hold de abono / expiración) — tick cada 1s mientras haya target.
function useCountdown(targetIso) {
  const [msLeft, setMsLeft] = useState(() => (targetIso ? new Date(targetIso).getTime() - Date.now() : null));
  useEffect(() => {
    if (!targetIso) { setMsLeft(null); return undefined; }
    setMsLeft(new Date(targetIso).getTime() - Date.now());
    const id = setInterval(() => setMsLeft(new Date(targetIso).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (msLeft == null) return { label: '', expired: false, msLeft: null };
  const clamped = Math.max(0, msLeft);
  const mm = Math.floor(clamped / 60000);
  const ss = Math.floor((clamped % 60000) / 1000);
  return { label: `${mm}:${ss.toString().padStart(2, '0')}`, expired: msLeft <= 0, msLeft: clamped };
}

// ── piezas de UI compartidas ────────────────────────────────────────────────
function Btn({ label, onPress, disabled, loading, color = COLORS.red, textColor = COLORS.white, style, outline }) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        btnStyles.base,
        outline ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color } : { backgroundColor: color },
        (disabled || loading) && { opacity: 0.5 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={outline ? color : textColor} />
        : <Text style={[btnStyles.text, { color: outline ? color : textColor }]}>{label}</Text>}
    </PressableScale>
  );
}

function Row({ label, value, big, highlight }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={[styles.subText, big && { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: TYPE.body }]}>
        {label}
      </Text>
      <Text
        style={[
          styles.subText,
          { color: COLORS.white, fontFamily: FONTS.bodySemiBold, textAlign: 'right', marginLeft: SPACING.sm, flexShrink: 1 },
          big && { fontFamily: FONTS.heading, fontSize: TYPE.h2, color: COLORS.neon },
          highlight && { color: COLORS.gold },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function DateChip({ date, active, onPress }) {
  const { dia, mes, dow } = formatDateChip(date);
  return (
    <PressableScale onPress={onPress} style={[styles.dateChip, active && styles.dateChipActive]}>
      <Text style={[styles.dateMes, active && { color: COLORS.neon }]}>{mes}</Text>
      <Text style={[styles.dateDia, active && { color: COLORS.neon }]}>{dia}</Text>
      <Text style={[styles.dateDow, active && { color: COLORS.neon }]}>{dow}</Text>
    </PressableScale>
  );
}

function CodigoChip({ codigo, small }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(codigo ?? '');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch { /* no-op — sin soporte de clipboard */ }
  }
  return (
    <PressableScale onPress={copy} style={small ? styles.codigoChipSmall : styles.codigoChipBig}>
      <Text style={small ? styles.codigoTextSmall : styles.codigoTextBig}>{codigo ?? '—'}</Text>
      <Text style={styles.codigoHint}>{copied ? '¡Copiado!' : 'Tocá para copiar'}</Text>
    </PressableScale>
  );
}

function CanchaPlaceholder() {
  return (
    <LinearGradient colors={['#0B2416', '#07130C']} style={styles.canchaImg}>
      <Text style={{ fontSize: 30, textAlign: 'center' }}>🏟</Text>
    </LinearGradient>
  );
}

function CanchaCardBody({ cancha, active }) {
  const min = cancha.tarifas?.[0]?.precio_hora;
  return (
    <View>
      {cancha.foto_url
        ? <Image source={{ uri: cancha.foto_url }} style={styles.canchaImg} resizeMode="cover" />
        : <CanchaPlaceholder />}
      <View style={{ marginTop: SPACING.sm, flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: SPACING.sm }}>
          <Text style={[styles.canchaNombre, active && { color: COLORS.neon }]} numberOfLines={1}>{cancha.nombre}</Text>
          {!!cancha.direccion && <Text style={styles.subText} numberOfLines={1}>{cancha.direccion}</Text>}
          {min != null && <Text style={styles.canchaDesde}>Desde {money(min)}/h</Text>}
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{abonoBadgeLabel(cancha)}</Text>
        </View>
      </View>
    </View>
  );
}

function StepLabel({ n, label }) {
  return (
    <View style={styles.stepLabelRow}>
      <View style={styles.stepDot}><Text style={styles.stepDotText}>{n}</Text></View>
      <Text style={styles.stepLabelText}>{label}</Text>
    </View>
  );
}

function Timeline({ steps }) {
  return (
    <View>
      {steps.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row' }}>
          <View style={{ alignItems: 'center', width: 24 }}>
            <Text style={{ fontSize: 14, color: s.done ? COLORS.neon : COLORS.gray }}>{s.done ? '●' : '○'}</Text>
            {i < steps.length - 1 && (
              <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: s.done ? COLORS.neon : COLORS.line, marginVertical: 2 }} />
            )}
          </View>
          <Text style={{ fontFamily: FONTS.body, fontSize: TYPE.body, color: s.done ? COLORS.white : COLORS.gray, marginLeft: SPACING.sm, marginBottom: SPACING.sm }}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── pantalla principal — GATE de rol ────────────────────────────────────────
export default function CanchaBookingScreen({ navigation }) {
  const { user, walletBalance } = useAuthStore();
  const role = user?.role ?? 'player';

  if (!PRIVILEGED_ROLES.includes(role)) {
    return <ReadOnlyCanchasScreen navigation={navigation} />;
  }
  return <GestorCanchaScreen navigation={navigation} user={user} walletBalance={walletBalance} />;
}

// ── Vista solo-lectura (roles sin permiso de reservar) ──────────────────────
function ReadOnlyCanchasScreen({ navigation }) {
  const [canchas, setCanchas]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [expandedId, setExpandedId]     = useState(null);
  const [previewSlots, setPreviewSlots] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setCanchas(await fetchCanchasConTarifas());
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudieron cargar las canchas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { refreshing, onRefresh } = useAppRefresh(load);

  async function toggleExpand(cancha) {
    if (expandedId === cancha.id) { setExpandedId(null); return; }
    setExpandedId(cancha.id);
    setPreviewSlots([]);
    setPreviewLoading(true);
    try {
      setPreviewSlots(await fetchSlots(cancha.id, todayIso(), 60));
    } catch {
      setPreviewSlots([]);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
        <ResponsiveContainer>
          <ScreenHeader title="Canchas" subtitle="Disponibilidad de nuestras canchas aliadas" back onBack={() => navigation.goBack()} />

          <Card variant="glass" glow="subtle" style={[styles.section, { borderColor: withAlpha(COLORS.gold, '66') }]}>
            <Text style={styles.gateTitle}>¿Sos administrador de un equipo?</Text>
            <Text style={styles.gateBody}>Para reservar canchas necesitás ser gestor — escribinos.</Text>
            <Btn
              label="Escribinos por WhatsApp"
              color="#25D366"
              onPress={() => openWhatsApp(WHATSAPP_GESTOR, 'Hola, quiero ser gestor en Birrea2Play para poder reservar canchas.')}
              style={{ marginTop: SPACING.sm }}
            />
          </Card>

          <Text style={styles.stepperTitle}>CANCHAS DISPONIBLES</Text>

          {loading ? (
            <ActivityIndicator color={COLORS.red} style={{ marginTop: SPACING.xl }} />
          ) : canchas.length === 0 ? (
            <Text style={styles.emptyText}>No hay canchas activas por el momento.</Text>
          ) : (
            canchas.map((c) => (
              <Card key={c.id} variant="glass" style={styles.section} onPress={() => toggleExpand(c)}>
                <CanchaCardBody cancha={c} />
                {expandedId === c.id && (
                  <View style={{ marginTop: SPACING.md }}>
                    <Text style={styles.miniLabel}>Disponibilidad de hoy (1 hora)</Text>
                    {previewLoading ? (
                      <ActivityIndicator color={COLORS.gray} style={{ marginTop: SPACING.sm }} />
                    ) : previewSlots.length === 0 ? (
                      <Text style={styles.subText}>La cancha no opera hoy o no hay franjas de 1 hora.</Text>
                    ) : (
                      <View style={styles.slotWrap}>
                        {previewSlots.map((s) => (
                          <View key={s.hora_inicio} style={[styles.slotChip, !s.disponible && styles.slotChipDisabled]}>
                            <Text style={[styles.slotChipText, !s.disponible && styles.slotChipTextDisabled]}>
                              {fmt12(s.hora_inicio)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </Card>
            ))
          )}
          <View style={{ height: SPACING.xxl }} />
        </ResponsiveContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Flujo del gestor (gestor / cancha_admin / admin) ────────────────────────
function GestorCanchaScreen({ navigation, user, walletBalance }) {
  // Mis reservas
  const [misReservas,        setMisReservas]        = useState([]);
  const [misReservasLoading, setMisReservasLoading] = useState(true);

  // Paso 1 — canchas
  const [canchas,        setCanchas]        = useState([]);
  const [canchasLoading, setCanchasLoading] = useState(true);
  const [selectedCanchaId, setSelectedCanchaId] = useState(null);
  const [selectedTarifaId, setSelectedTarifaId] = useState(null);

  // Paso 2 — fecha/hora
  const [selectedDate,     setSelectedDate]     = useState(todayIso());
  const [selectedDuracion, setSelectedDuracion] = useState(60);
  const [slots,        setSlots]        = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null); // { hora_inicio, hora_fin }

  // Paso 3 — confirmar
  const [submittingReserva, setSubmittingReserva] = useState(false);

  // Estado de pantalla completa: browse (stepper+mis reservas) | payment | success
  const [screenState, setScreenState] = useState('browse');
  const [paymentCtx,  setPaymentCtx]  = useState(null);
  const [successCtx,  setSuccessCtx]  = useState(null);

  // Sheet de pago de saldo (desde Mis Reservas)
  const [saldoSheetReserva, setSaldoSheetReserva] = useState(null);

  const DATES = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayIso(), i)), []);

  // ── fetch: mis reservas ──
  const fetchMisReservas = useCallback(async () => {
    if (!user?.id) { setMisReservasLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('cancha_reservas')
        .select(`
          id, codigo_reserva, cancha_id, tarifa_id, fecha, hora_inicio, hora_fin,
          status, estado_pago, monto_total, deposito_requerido, deposito_pagado, saldo_pagado,
          expira_en, motivo_rechazo, canal, created_at, updated_at,
          cancha:cancha_id ( nombre, telefono ),
          tarifa:tarifa_id ( deporte, formato_jpe )
        `)
        .eq('gestor_id', user.id)
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: false })
        .limit(15);
      if (error) throw error;
      const now = Date.now();
      const filtered = (data ?? [])
        .filter((r) => {
          if (r.status !== 'cancelled') return true;
          const ts = new Date(r.updated_at ?? r.created_at).getTime();
          return now - ts < 7 * 24 * 60 * 60 * 1000;
        })
        .slice(0, 10);
      setMisReservas(filtered);
    } catch (e) {
      console.warn('fetchMisReservas', e.message);
    } finally {
      setMisReservasLoading(false);
    }
  }, [user?.id]);

  // ── fetch: canchas ──
  const fetchCanchas = useCallback(async () => {
    try {
      setCanchas(await fetchCanchasConTarifas());
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudieron cargar las canchas.');
    } finally {
      setCanchasLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchMisReservas(); fetchCanchas(); }, [fetchMisReservas, fetchCanchas]));

  const combinedRefetch = useCallback(async () => { await Promise.all([fetchMisReservas(), fetchCanchas()]); }, [fetchMisReservas, fetchCanchas]);
  const { refreshing, onRefresh } = useAppRefresh(combinedRefetch);

  // Polling suave: mientras haya una reserva propia esperando pago/aprobación, refetch cada 30s.
  const needsPolling = useMemo(
    () => misReservas.some((r) => r.status === 'pending' && (r.estado_pago === 'pendiente' || r.estado_pago === 'abono_pagado')),
    [misReservas],
  );
  useEffect(() => {
    if (!needsPolling) return undefined;
    const id = setInterval(fetchMisReservas, 30000);
    return () => clearInterval(id);
  }, [needsPolling, fetchMisReservas]);

  // ── selección de cancha / tarifa (Paso 1) ──
  const selectedCancha = useMemo(() => canchas.find((c) => c.id === selectedCanchaId) ?? null, [canchas, selectedCanchaId]);
  const tarifasDeCancha = selectedCancha?.tarifas ?? [];
  const selectedTarifa = useMemo(
    () => tarifasDeCancha.find((t) => t.id === selectedTarifaId) ?? tarifasDeCancha[0] ?? null,
    [tarifasDeCancha, selectedTarifaId],
  );

  function handleSelectCancha(c) {
    if (selectedCanchaId === c.id) {
      setSelectedCanchaId(null); setSelectedTarifaId(null); setSelectedSlot(null);
      return;
    }
    setSelectedCanchaId(c.id);
    setSelectedTarifaId(c.tarifas?.[0]?.id ?? null);
    setSelectedDuracion(60);
    setSelectedSlot(null);
  }

  // ── duración (Paso 2) ──
  const duracionOptions = useMemo(() => {
    if (!selectedCancha) return [];
    const opts = [{ value: 60, label: '1 hora' }];
    if (selectedCancha.permite_media_hora_extra) opts.push({ value: 90, label: '1 h 30' });
    if ((selectedCancha.duracion_max_minutos ?? 120) >= 120) opts.push({ value: 120, label: '2 horas' });
    return opts;
  }, [selectedCancha]);

  useEffect(() => {
    if (!selectedCanchaId || !selectedDate || !selectedDuracion) { setSlots([]); return undefined; }
    let cancelled = false;
    setSlotsLoading(true);
    setSelectedSlot(null);
    fetchSlots(selectedCanchaId, selectedDate, selectedDuracion)
      .then((rows) => { if (!cancelled) setSlots(rows); })
      .catch(() => { if (!cancelled) setSlots([]); })
      .finally(() => { if (!cancelled) setSlotsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCanchaId, selectedDate, selectedDuracion]);

  // ── resumen (Paso 3) ──
  const monto = useMemo(() => {
    if (!selectedTarifa || !selectedSlot) return 0;
    return Number((Number(selectedTarifa.precio_hora) * (selectedDuracion / 60)).toFixed(2));
  }, [selectedTarifa, selectedSlot, selectedDuracion]);
  const depositoEstimado = useMemo(() => computeAbono(selectedCancha, monto), [selectedCancha, monto]);

  function resetWizard() {
    setSelectedCanchaId(null); setSelectedTarifaId(null); setSelectedSlot(null);
  }

  async function handleSolicitar() {
    setSubmittingReserva(true);
    try {
      const [h, m] = selectedSlot.hora_inicio.split(':').map(Number);
      const { data, error } = await supabase.rpc('crear_cancha_reserva', {
        p_cancha_id:   selectedCancha.id,
        p_tarifa_id:   selectedTarifa.id,
        p_gestor_id:   user.id,
        p_fecha:       selectedDate,
        p_hora_inicio: selectedSlot.hora_inicio,
        p_hora_fin:    selectedSlot.hora_fin,
        p_precio_hora: selectedTarifa.precio_hora,
        p_canal:       'app',
      });
      if (error) throw new Error(mapReservaError(error.message));
      if (!data?.length) throw new Error('No se pudo crear la reserva.');
      const r = data[0];
      const ctxBase = {
        canchaNombre: selectedCancha.nombre, canchaTelefono: selectedCancha.telefono,
        tarifaLabel: tarifaLabelFor(selectedTarifa), fecha: selectedDate,
        horaInicio: selectedSlot.hora_inicio, horaFin: selectedSlot.hora_fin,
      };
      // v4: sin pago al solicitar — el abono se paga recién cuando la cancha aprueba
      setSuccessCtx({ ...r, ...ctxBase });
      setScreenState('success');
      resetWizard();
      fetchMisReservas();
    } catch (e) {
      Alert.alert('No se pudo reservar', e.message ?? 'Intentá de nuevo.');
    } finally {
      setSubmittingReserva(false);
    }
  }

  // Pagar el abono de una reserva que la cancha YA aprobó (Mis Reservas → approved/pendiente).
  function openPagarAbonoRetomado(row) {
    setPaymentCtx({
      reserva: {
        id: row.id,
        codigo_reserva: row.codigo_reserva,
        expira_en: row.expira_en,
        monto_total: Number(row.monto_total ?? 0),
        abono_requerido: Number(row.deposito_requerido ?? 0) - Number(row.deposito_pagado ?? 0),
      },
      kind: 'abono',
      canchaNombre: row.cancha?.nombre,
      canchaTelefono: row.cancha?.telefono,
      tarifaLabel: tarifaLabelFor(row.tarifa),
      fecha: row.fecha,
      horaInicio: row.hora_inicio,
      horaFin: row.hora_fin,
    });
    setScreenState('payment');
  }

  async function handleCancelar(row) {
    const reembolso = Number(row.deposito_pagado ?? 0) + Number(row.saldo_pagado ?? 0);
    Alert.alert(
      'Cancelar reserva',
      reembolso > 0
        ? `Se te devolverán ${money(reembolso)} a tus créditos. ¿Confirmás?`
        : '¿Confirmás que querés cancelar esta reserva?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, cancelar', style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc('cancelar_cancha_reserva_usuario', { p_reserva_id: row.id });
              if (error) throw error;
              if (data?.ok === false) throw new Error(data.error ?? 'No se pudo cancelar.');
              fetchMisReservas();
            } catch (e) {
              Alert.alert('Error', e.message ?? 'No se pudo cancelar la reserva.');
            }
          },
        },
      ],
    );
  }

  // ── pantallas completas ──
  if (screenState === 'payment' && paymentCtx) {
    return (
      <PaymentScreen
        paymentCtx={paymentCtx}
        user={user}
        walletBalance={walletBalance}
        onBack={() => setScreenState('browse')}
        onPaid={() => {
          setSuccessCtx({
            ...paymentCtx.reserva, estado_pago: 'abono_pagado', status: 'approved',
            canchaNombre: paymentCtx.canchaNombre, canchaTelefono: paymentCtx.canchaTelefono,
            tarifaLabel: paymentCtx.tarifaLabel, fecha: paymentCtx.fecha,
            horaInicio: paymentCtx.horaInicio, horaFin: paymentCtx.horaFin,
          });
          setScreenState('success');
          resetWizard();
          fetchMisReservas();
        }}
      />
    );
  }

  if (screenState === 'success' && successCtx) {
    return (
      <SuccessScreen
        reserva={successCtx}
        onDone={() => {
          setScreenState('browse');
          setSuccessCtx(null);
          setPaymentCtx(null);
          fetchMisReservas();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.red} />}
      >
        <ResponsiveContainer>
          <ScreenHeader title="Reservar cancha" subtitle="Solicitá tu espacio y pagá el abono" back onBack={() => navigation.goBack()} />

          <Text style={styles.stepperTitle}>RESERVAR</Text>

          {/* Paso 1 — cancha */}
          <StepLabel n={1} label="Elegí la cancha" />
          {canchasLoading ? (
            <ActivityIndicator color={COLORS.red} style={{ marginVertical: SPACING.md }} />
          ) : canchas.length === 0 ? (
            <Text style={styles.emptyText}>No hay canchas activas por el momento.</Text>
          ) : (
            canchas.map((c) => (
              <View key={c.id}>
                <Card
                  variant="glass"
                  glow={selectedCanchaId === c.id ? 'subtle' : undefined}
                  style={[styles.section, selectedCanchaId === c.id && styles.sectionActive]}
                  onPress={() => handleSelectCancha(c)}
                >
                  <CanchaCardBody cancha={c} active={selectedCanchaId === c.id} />
                </Card>
                {selectedCanchaId === c.id && c.tarifas.length > 1 && (
                  <View style={styles.chipRow}>
                    {c.tarifas.map((t) => (
                      <Chip
                        key={t.id}
                        label={`${tarifaLabelFor(t)} · ${money(t.precio_hora)}/h`}
                        active={selectedTarifaId === t.id}
                        onPress={() => setSelectedTarifaId(t.id)}
                      />
                    ))}
                  </View>
                )}
              </View>
            ))
          )}

          {/* Paso 2 — fecha y hora */}
          {selectedCancha && selectedTarifa && (
            <>
              <StepLabel n={2} label="Fecha y hora" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {DATES.map((d) => (
                    <DateChip key={d} date={d} active={d === selectedDate} onPress={() => setSelectedDate(d)} />
                  ))}
                </View>
              </ScrollView>

              <View style={[styles.chipRow, { marginTop: SPACING.sm }]}>
                {duracionOptions.map((o) => (
                  <Chip key={o.value} label={o.label} active={selectedDuracion === o.value} onPress={() => setSelectedDuracion(o.value)} />
                ))}
              </View>

              <Text style={styles.miniLabel}>{formatDateLong(selectedDate)}</Text>
              {slotsLoading ? (
                <ActivityIndicator color={COLORS.red} style={{ marginVertical: SPACING.md }} />
              ) : slots.length === 0 ? (
                <Text style={styles.emptyText}>Ese día la cancha no opera o la duración no está disponible.</Text>
              ) : (
                <View style={styles.slotWrap}>
                  {slots.map((s) => {
                    const active = selectedSlot?.hora_inicio === s.hora_inicio;
                    return (
                      <PressableScale
                        key={s.hora_inicio}
                        disabled={!s.disponible}
                        onPress={() => setSelectedSlot({ hora_inicio: s.hora_inicio, hora_fin: s.hora_fin })}
                        style={[styles.slotBtn, active && styles.slotBtnActive, !s.disponible && styles.slotBtnDisabled]}
                      >
                        <Text style={[styles.slotBtnText, active && styles.slotBtnTextActive, !s.disponible && styles.slotBtnTextDisabled]}>
                          {fmt12(s.hora_inicio)}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* Paso 3 — confirmar y pagar */}
          {selectedSlot && (
            <>
              <StepLabel n={3} label="Confirmá y pagá" />
              <Card variant="glass" glow="mid" style={styles.section}>
                <Row label="Cancha" value={selectedCancha.nombre} />
                <Row label="Fecha" value={formatDateLong(selectedDate)} />
                <Row label="Hora" value={`${fmt12(selectedSlot.hora_inicio)} – ${fmt12(selectedSlot.hora_fin)}`} />
                <Row label="Duración" value={duracionLabel(selectedDuracion)} />
                <Row label="Precio / hora" value={money(selectedTarifa.precio_hora)} />
                <View style={styles.divider} />
                <Row big label="Total" value={money(monto)} />
                {depositoEstimado > 0 ? (
                  <>
                    <Row label={`Abono para reservar (${abonoBadgeLabel(selectedCancha)})`} value={money(depositoEstimado)} highlight />
                    <Row label="Saldo — se paga por la app el día de la reserva" value={money(monto - depositoEstimado)} />
                  </>
                ) : (
                  <Text style={[styles.subText, { marginTop: SPACING.sm }]}>Esta cancha no requiere abono.</Text>
                )}
              </Card>

              <Card variant="glass" style={[styles.section, { borderColor: withAlpha(COLORS.gold, '55') }]}>
                <Text style={styles.avisoText}>
                  Primero la cancha confirma tu solicitud — sin pagar nada. Cuando la apruebe, te avisamos para pagar el abono y asegurar el horario.
                </Text>
              </Card>

              <Btn label="SOLICITAR RESERVA" loading={submittingReserva} onPress={handleSolicitar} style={{ marginTop: SPACING.sm }} />
            </>
          )}

          {/* Historial del gestor — abajo del flujo de reserva (pedido Sergio 2026-07-05) */}
          <MisReservasSection
            reservas={misReservas}
            loading={misReservasLoading}
            onPagarAbono={openPagarAbonoRetomado}
            onPagarSaldo={(row) => setSaldoSheetReserva(row)}
            onCancelar={handleCancelar}
          />

          <View style={{ height: SPACING.xxl }} />
        </ResponsiveContainer>
      </ScrollView>

      <BottomSheetModal
        visible={!!saldoSheetReserva}
        onClose={() => setSaldoSheetReserva(null)}
        title="Pagar saldo"
        subtitle={saldoSheetReserva ? `Código ${saldoSheetReserva.codigo_reserva}` : ''}
      >
        {saldoSheetReserva && (
          <PagarSaldoSheetBody
            reserva={saldoSheetReserva}
            walletBalance={walletBalance}
            onPaid={() => {
              setSaldoSheetReserva(null);
              fetchMisReservas();
              Alert.alert('¡Listo!', 'Saldo pagado correctamente.');
            }}
          />
        )}
      </BottomSheetModal>
    </SafeAreaView>
  );
}

// ── Mis Reservas ─────────────────────────────────────────────────────────────
function reservaEstadoInfo(r) {
  const saldo = Number(r.monto_total ?? 0) - Number(r.deposito_pagado ?? 0) - Number(r.saldo_pagado ?? 0);
  if (r.status === 'rejected') {
    return {
      icon: '❌', label: 'Rechazada', color: COLORS.red2, sub: r.motivo_rechazo,
      extra: r.estado_pago === 'reembolsado' ? 'Se te reembolsó a créditos.' : null,
    };
  }
  if (r.status === 'cancelled') {
    if (r.estado_pago === 'expirado') return { icon: '⌛', label: 'Vencida (no se pagó a tiempo)', color: COLORS.gray };
    return { icon: '🚫', label: 'Cancelada', color: COLORS.gray };
  }
  if (r.status === 'completed')  return { icon: '🏁', label: 'Jugada', color: COLORS.blue2 };
  if (r.status === 'approved') {
    // v4: aprobada pero con el abono aún sin pagar → ventana de pago abierta
    if (r.estado_pago === 'pendiente' && Number(r.deposito_requerido ?? 0) > 0.009) {
      return { icon: '⏳', label: `Aprobada — pagá el abono ${money(Number(r.deposito_requerido ?? 0))}`, color: COLORS.gold, pendienteAbono: true };
    }
    if (saldo > 0.009) return { icon: '✅', label: `Confirmada — saldo ${money(saldo)}`, color: COLORS.neon, saldo };
    return { icon: '✅', label: 'Confirmada y pagada', color: COLORS.blue2 };
  }
  // status === 'pending' — v4: la cancha aún no decide (no se paga nada todavía)
  return { icon: '🕐', label: 'Esperando confirmación de la cancha', color: COLORS.gold };
}

function ExpiraEnLabel({ expiraEn }) {
  const { label, expired } = useCountdown(expiraEn);
  return (
    <Text style={[styles.subText, { color: expired ? COLORS.red2 : COLORS.gold }]}>
      {expired ? 'Venció el plazo del abono' : `Vence en ${label}`}
    </Text>
  );
}

function MisReservasSection({ reservas, loading, onPagarAbono, onPagarSaldo, onCancelar }) {
  if (loading) return <ActivityIndicator color={COLORS.red} style={{ marginVertical: SPACING.md }} />;
  if (reservas.length === 0) return null;
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={styles.stepperTitle}>MIS RESERVAS</Text>
      {reservas.map((r) => (
        <ReservaCard key={r.id} reserva={r} onPagarAbono={onPagarAbono} onPagarSaldo={onPagarSaldo} onCancelar={onCancelar} />
      ))}
    </View>
  );
}

function ReservaCard({ reserva, onPagarAbono, onPagarSaldo, onCancelar }) {
  const info = reservaEstadoInfo(reserva);
  const puedeCancelar = reserva.status === 'pending' || reserva.status === 'approved';
  return (
    <Card variant="glass" style={[styles.section, { borderColor: withAlpha(info.color, '66') }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.canchaNombre} numberOfLines={1}>{reserva.cancha?.nombre ?? 'Cancha'}</Text>
          <Text style={styles.subText}>{formatDateLong(reserva.fecha)} · {fmt12(reserva.hora_inicio)} – {fmt12(reserva.hora_fin)}</Text>
        </View>
        <CodigoChip codigo={reserva.codigo_reserva} small />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SPACING.sm }}>
        <Text style={{ fontSize: 16 }}>{info.icon}</Text>
        <Text style={[styles.estadoLabel, { color: info.color }]}>{info.label}</Text>
      </View>
      {info.pendienteAbono && reserva.expira_en && <ExpiraEnLabel expiraEn={reserva.expira_en} />}
      {!!info.sub && <Text style={styles.subText}>{info.sub}</Text>}
      {!!info.extra && <Text style={[styles.subText, { color: COLORS.green }]}>{info.extra}</Text>}

      <View style={styles.reservaAcciones}>
        {info.pendienteAbono && (
          <Btn label="PAGAR ABONO" onPress={() => onPagarAbono(reserva)} color={COLORS.gold} textColor={COLORS.bg} style={{ flex: 1 }} />
        )}
        {info.saldo > 0.009 && (
          <Btn label="PAGAR SALDO" onPress={() => onPagarSaldo(reserva)} color={COLORS.neon} textColor={COLORS.bg} style={{ flex: 1 }} />
        )}
        {puedeCancelar && (
          <Btn label="Cancelar" onPress={() => onCancelar(reserva)} outline color={COLORS.red2} style={{ flex: 1 }} />
        )}
        {!!reserva.cancha?.telefono && (
          <PressableScale
            onPress={() => openWhatsApp(reserva.cancha.telefono, `Hola, te escribo por mi reserva *${reserva.codigo_reserva}*.`)}
            style={styles.waIconBtn}
          >
            <Text style={{ fontSize: 18 }}>💬</Text>
          </PressableScale>
        )}
      </View>
    </Card>
  );
}

// ── Sheet: pagar saldo (desde Mis Reservas, reserva approved) ───────────────
function PagarSaldoSheetBody({ reserva, walletBalance, onPaid }) {
  const saldo = Number(reserva.monto_total ?? 0) - Number(reserva.deposito_pagado ?? 0) - Number(reserva.saldo_pagado ?? 0);
  const [metodo, setMetodo]         = useState('wallet');
  const [phone, setPhone]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [yappyEspera, setYappyEspera] = useState(false);
  const yappyCancelRef = useRef(null);

  useEffect(() => () => { if (yappyCancelRef.current) { try { yappyCancelRef.current(); } catch { /* no-op */ } } }, []);

  async function handleWallet() {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('pagar_saldo_cancha_wallet', { p_reserva_id: reserva.id });
      if (error) throw error;
      if (data?.ok === false) throw new Error(mapWalletError(data.error, saldo, walletBalance));
      onPaid();
    } catch (e) {
      Alert.alert('No se pudo pagar', e.message ?? 'Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleYappy() {
    if (!phone.replace(/\D/g, '')) return;
    setSubmitting(true);
    try {
      const montoConFee = Number((saldo + YAPPY_FEE).toFixed(2));
      const { orderId } = await iniciarBotonYappy({ phone, amount: montoConFee, tipo: 'saldo_cancha', cancha_reserva_id: reserva.id });
      setYappyEspera(true);
      const { promise, cancel } = pollBotonOrder({ orderId });
      yappyCancelRef.current = cancel;
      await promise;
      yappyCancelRef.current = null;
      onPaid();
    } catch (e) {
      if (e.message !== 'cancelled') Alert.alert('Yappy', e.message ?? 'No se pudo procesar el pago');
    } finally {
      setYappyEspera(false);
      setSubmitting(false);
    }
  }

  return (
    <View>
      <Text style={styles.saldoMonto}>{money(saldo)}</Text>
      <View style={[styles.chipRow, { marginTop: SPACING.sm, marginBottom: SPACING.md, justifyContent: 'center' }]}>
        <Chip label="💰 Créditos" active={metodo === 'wallet'} onPress={() => setMetodo('wallet')} color={COLORS.payWallet} />
        <Chip label="📱 Yappy" active={metodo === 'yappy'} onPress={() => setMetodo('yappy')} color={COLORS.payYappy} />
      </View>

      {metodo === 'wallet' && (
        <>
          <Row label="Tu saldo" value={money(walletBalance)} />
          <Btn
            label={`Pagar ${money(saldo)} del Wallet`}
            onPress={handleWallet} loading={submitting}
            disabled={Number(walletBalance ?? 0) < saldo}
            color={COLORS.payWallet} style={{ marginTop: SPACING.sm }}
          />
        </>
      )}

      {metodo === 'yappy' && (
        <>
          <Field
            label="Número Yappy" placeholder="6123-4567"
            value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d-]/g, ''))}
            keyboardType="phone-pad" maxLength={10}
          />
          <Btn
            label={submitting ? (yappyEspera ? 'Esperando Yappy…' : 'Procesando…') : `Pagar ${money(saldo + YAPPY_FEE)} con Yappy`}
            onPress={handleYappy} loading={submitting} disabled={!phone.replace(/\D/g, '')}
            color={COLORS.payYappy} style={{ marginTop: SPACING.sm }}
          />
          <Text style={styles.feeNote}>+ $0.25 fee Yappy</Text>
        </>
      )}
    </View>
  );
}

// ── Pantalla de pago (abono nuevo/retomado, o saldo) ────────────────────────
// Plumbing de Yappy y Tarjeta portado de CanchaBookingScreen.js (viejo):
//   - Yappy: iniciarBotonYappy() (líneas 306-311) + pollBotonOrder() (313-315),
//     con cleanup de polling al desmontar (patrón de WalletScreen.js líneas 99-104).
//   - Tarjeta: iniciarPagoTarjeta() (líneas 366-373) + verificación manual "Ya
//     pagué" re-consultando cancha_reservas (líneas 733-745).
// Diferencia deliberada vs el viejo: si el pago falla, NO se cancela la reserva
// (el viejo hacía cancha_reservas.update({status:'cancelled'}) — ya no aplica:
// el flujo v3 permite reintentar pagar el mismo hold hasta que expire o el cron
// lo expire solo; cancelar en cada error rompería el reintento con otro método).
function PaymentScreen({ paymentCtx, user, walletBalance, onBack, onPaid }) {
  const { reserva, kind, canchaNombre, canchaTelefono, tarifaLabel, fecha, horaInicio, horaFin } = paymentCtx;
  const amount = kind === 'abono' ? Number(reserva.abono_requerido ?? 0) : Number(reserva.saldo_requerido ?? 0);
  const countdown = useCountdown(kind === 'abono' ? reserva.expira_en : null);

  const [metodo, setMetodo]           = useState('yappy');
  const [phone, setPhone]             = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [yappyEspera, setYappyEspera] = useState(false);
  const [tarjetaEspera, setTarjetaEspera] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const yappyCancelRef = useRef(null);

  useEffect(() => () => { if (yappyCancelRef.current) { try { yappyCancelRef.current(); } catch { /* no-op */ } } }, []);

  const expired      = kind === 'abono' && countdown.expired;
  const tipoPago      = kind === 'abono' ? 'abono_cancha' : 'saldo_cancha';
  const montoConFee   = Number((amount + YAPPY_FEE).toFixed(2));

  async function handleWallet() {
    setSubmitting(true);
    try {
      let data, error;
      if (kind === 'abono') {
        ({ data, error } = await supabase.rpc('confirmar_abono_cancha_wallet', {
          p_reserva_id: reserva.id, p_gestor_id: user.id, p_abono_requerido: amount,
        }));
      } else {
        ({ data, error } = await supabase.rpc('pagar_saldo_cancha_wallet', { p_reserva_id: reserva.id }));
      }
      if (error) throw error;
      if (data?.ok === false) throw new Error(mapWalletError(data.error, amount, walletBalance));
      onPaid();
    } catch (e) {
      Alert.alert('No se pudo pagar', e.message ?? 'Intentá de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleYappy() {
    if (!phone.replace(/\D/g, '')) return;
    setSubmitting(true);
    try {
      const { orderId } = await iniciarBotonYappy({ phone, amount: montoConFee, tipo: tipoPago, cancha_reserva_id: reserva.id });
      setYappyEspera(true);
      const { promise, cancel } = pollBotonOrder({ orderId });
      yappyCancelRef.current = cancel;
      await promise;
      yappyCancelRef.current = null;
      onPaid();
    } catch (e) {
      if (e.message !== 'cancelled') Alert.alert('Yappy', e.message ?? 'No se pudo procesar el pago');
    } finally {
      setYappyEspera(false);
      setSubmitting(false);
    }
  }

  async function handleTarjeta() {
    setSubmitting(true);
    try {
      await iniciarPagoTarjeta({
        userId: user.id, amount: montoConFee,
        descripcion: `${kind === 'abono' ? 'Abono' : 'Saldo'} cancha ${canchaNombre ?? ''}`.trim(),
        tipo: tipoPago, cancha_reserva_id: reserva.id,
      });
      setTarjetaEspera(true);
    } catch (e) {
      Alert.alert('Tarjeta', e.message ?? 'No se pudo abrir el pago');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerificarTarjeta() {
    setVerificando(true);
    try {
      const { data } = await supabase.from('cancha_reservas').select('estado_pago').eq('id', reserva.id).maybeSingle();
      const ok = kind === 'abono' ? data?.estado_pago === 'abono_pagado' : data?.estado_pago === 'pagado';
      if (ok) { setTarjetaEspera(false); onPaid(); }
      else Alert.alert('Pago aún no detectado', 'Completá el pago en el navegador y volvé a intentar en unos segundos.');
    } finally {
      setVerificando(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ResponsiveContainer>
          <ScreenHeader title={kind === 'abono' ? 'Pagar abono' : 'Pagar saldo'} back onBack={onBack} />

          <Card variant="glass" style={styles.section}>
            <Row label="Cancha" value={canchaNombre ?? '—'} />
            {!!fecha && <Row label="Fecha" value={formatDateLong(fecha)} />}
            {!!horaInicio && <Row label="Hora" value={`${fmt12(horaInicio)} – ${fmt12(horaFin)}`} />}
            {!!tarifaLabel && <Row label="Deporte" value={tarifaLabel} />}
            <View style={styles.divider} />
            <Row big label={kind === 'abono' ? 'Abono a pagar' : 'Saldo a pagar'} value={money(amount)} />
            {kind === 'abono' && reserva.expira_en && (
              <Text style={[styles.countdownText, expired && { color: COLORS.red2 }]}>
                {expired ? 'El tiempo para pagar expiró' : `Expira en ${countdown.label}`}
              </Text>
            )}
          </Card>

          {!!canchaTelefono && (
            <Card
              variant="glass"
              onPress={() => openWhatsApp(canchaTelefono, `Hola, estoy pagando mi reserva ${reserva.codigo_reserva ?? ''} en *${canchaNombre}*.`)}
              style={[styles.section, { borderColor: '#25D366' }]}
            >
              <Text style={[styles.cardTitle, { color: '#25D366' }]}>💬 Contactar la cancha</Text>
              <Text style={styles.subText}>{canchaTelefono}</Text>
            </Card>
          )}

          {expired ? (
            <Card variant="glass" style={[styles.section, { borderColor: COLORS.red2 }]}>
              <Text style={styles.avisoText}>El tiempo para pagar este abono expiró. Volvé a solicitar la reserva desde cero.</Text>
              <Btn label="Volver" onPress={onBack} color={COLORS.card2} textColor={COLORS.white} style={{ marginTop: SPACING.sm }} />
            </Card>
          ) : tarjetaEspera ? (
            <Card variant="glass" style={styles.section}>
              <Text style={styles.cardTitle}>Completá el pago en el navegador</Text>
              <Text style={styles.subText}>Cuando pagues, volvé aquí y tocá "Ya pagué".</Text>
              <Btn
                label="Ya pagué ✓" loading={verificando} onPress={handleVerificarTarjeta}
                color={COLORS.neon} textColor={COLORS.bg} style={{ marginTop: SPACING.md }}
              />
              <PressableScale onPress={() => setTarjetaEspera(false)} style={{ marginTop: SPACING.sm, alignItems: 'center' }}>
                <Text style={styles.linkText}>Cancelar</Text>
              </PressableScale>
            </Card>
          ) : (
            <>
              <View style={styles.chipRow}>
                <Chip label="📱 Yappy" active={metodo === 'yappy'} onPress={() => setMetodo('yappy')} color={COLORS.payYappy} />
                {kind === 'abono' && (
                  <Chip label="💳 Tarjeta" active={metodo === 'tarjeta'} onPress={() => setMetodo('tarjeta')} color={COLORS.payTarjeta} />
                )}
                <Chip label="💰 Créditos" active={metodo === 'wallet'} onPress={() => setMetodo('wallet')} color={COLORS.payWallet} />
              </View>

              {metodo === 'yappy' && (
                <Card variant="glass" style={styles.section}>
                  <Field
                    label="Número Yappy" placeholder="6123-4567"
                    value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d-]/g, ''))}
                    keyboardType="phone-pad" maxLength={10}
                  />
                  <Btn
                    label={submitting ? (yappyEspera ? 'Esperando Yappy…' : 'Procesando…') : `Pagar ${money(montoConFee)} con Yappy`}
                    loading={submitting} onPress={handleYappy} disabled={!phone.replace(/\D/g, '')}
                    color={COLORS.payYappy} style={{ marginTop: SPACING.sm }}
                  />
                  <Text style={styles.feeNote}>+ $0.25 fee Yappy</Text>
                </Card>
              )}

              {metodo === 'tarjeta' && kind === 'abono' && (
                <Card variant="glass" style={styles.section}>
                  <Btn label={`Pagar ${money(montoConFee)} con Tarjeta`} loading={submitting} onPress={handleTarjeta} color={COLORS.payTarjeta} />
                  <Text style={styles.feeNote}>+ $0.25 fee</Text>
                </Card>
              )}

              {metodo === 'wallet' && (
                <Card variant="glass" style={styles.section}>
                  <Row label="Tu saldo" value={money(walletBalance)} />
                  <Btn
                    label={`Pagar ${money(amount)} del Wallet`} loading={submitting} onPress={handleWallet}
                    disabled={Number(walletBalance ?? 0) < amount} color={COLORS.payWallet} style={{ marginTop: SPACING.sm }}
                  />
                </Card>
              )}
            </>
          )}

          <View style={{ height: SPACING.xxl }} />
        </ResponsiveContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Pantalla de éxito (timeline) ────────────────────────────────────────────
function SuccessScreen({ reserva, onDone }) {
  const abonoNeeded     = Number(reserva.abono_requerido ?? 0) > 0;
  const abonoDone       = !abonoNeeded || ['abono_pagado', 'pagado'].includes(reserva.estado_pago);
  const aprobada        = reserva.status === 'approved' || reserva.status === 'completed';
  const saldoRestante   = Number(reserva.monto_total ?? 0) - Number(reserva.abono_requerido ?? 0);
  const saldoDone       = reserva.estado_pago === 'pagado' || saldoRestante <= 0;
  const jugada          = reserva.status === 'completed';

  // v4: la cancha confirma ANTES del abono
  const steps = [
    { label: 'Solicitud enviada', done: true },
    { label: 'Confirmación de la cancha', done: aprobada },
    { label: abonoNeeded ? 'Abono pagado' : 'Sin abono requerido', done: abonoDone },
    { label: 'Saldo', done: saldoDone },
    { label: 'A jugar', done: jugada },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ResponsiveContainer>
          <View style={{ alignItems: 'center', paddingTop: SPACING.xl }}>
            <Text style={{ fontSize: 52 }}>{reserva.estado_pago === 'abono_pagado' ? '✅' : '🎉'}</Text>
            <Text style={styles.successTitle}>
              {reserva.estado_pago === 'abono_pagado' ? '¡Reserva confirmada!' : '¡Solicitud enviada!'}
            </Text>
            <Text style={styles.subText}>
              {reserva.estado_pago === 'abono_pagado'
                ? 'Abono pagado. El saldo se paga por la app el día de la reserva.'
                : 'Te avisamos apenas la cancha confirme. Después de la confirmación pagás el abono.'}
            </Text>
          </View>

          <Card variant="glass" glow="mid" style={[styles.section, { alignItems: 'center' }]}>
            <Text style={styles.miniLabel}>Código de reserva</Text>
            <CodigoChip codigo={reserva.codigo_reserva} />
          </Card>

          <Card variant="glass" style={styles.section}>
            <Row label="Cancha" value={reserva.canchaNombre ?? '—'} />
            {!!reserva.fecha && <Row label="Fecha" value={formatDateLong(reserva.fecha)} />}
            {!!reserva.horaInicio && <Row label="Hora" value={`${fmt12(reserva.horaInicio)} – ${fmt12(reserva.horaFin)}`} />}
            {!!reserva.tarifaLabel && <Row label="Deporte" value={reserva.tarifaLabel} />}
            <Row label="Total" value={money(reserva.monto_total)} />
          </Card>

          <Card variant="glass" style={styles.section}>
            <Text style={styles.cardTitle}>Qué sigue</Text>
            <Timeline steps={steps} />
          </Card>

          {!!reserva.canchaTelefono && (
            <Card
              variant="glass"
              onPress={() => openWhatsApp(
                reserva.canchaTelefono,
                `Hola, acabo de reservar en *${reserva.canchaNombre}*. Mi código de reserva es *${reserva.codigo_reserva}*. ¿Pueden confirmarme?`,
              )}
              style={[styles.section, { borderColor: '#25D366' }]}
            >
              <Text style={[styles.cardTitle, { color: '#25D366' }]}>💬 Avisarle a la cancha</Text>
              <Text style={styles.subText}>Enviá tu código por WhatsApp para acelerar la confirmación.</Text>
            </Card>
          )}

          <Btn label="Ver mis reservas" onPress={onDone} style={{ marginTop: SPACING.sm }} />
          <View style={{ height: SPACING.xxl }} />
        </ResponsiveContainer>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── estilos ──────────────────────────────────────────────────────────────────
const btnStyles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.md,
    paddingVertical: 13,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  text: {
    fontFamily: FONTS.bodyBold,
    fontSize: TYPE.body,
    letterSpacing: 0.4,
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  section:       { marginBottom: SPACING.sm },
  sectionActive: { borderColor: COLORS.neon },

  gateTitle: { fontFamily: FONTS.heading, fontSize: TYPE.h2, color: COLORS.gold, letterSpacing: 1, marginBottom: 4 },
  gateBody:  { fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray2, lineHeight: 20 },

  emptyText: { fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray2, textAlign: 'center', paddingVertical: SPACING.lg },
  miniLabel: {
    fontFamily: FONTS.bodySemiBold, fontSize: TYPE.caption, color: COLORS.gray,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: SPACING.sm, marginBottom: 6,
  },
  subText: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2 },

  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm },
  slotChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.neon },
  slotChipDisabled: { borderColor: COLORS.line },
  slotChipText: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.neon },
  slotChipTextDisabled: { color: COLORS.gray },

  canchaImg: {
    width: '100%', height: 120, borderRadius: RADIUS.md, backgroundColor: COLORS.bg2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  canchaNombre: { fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white },
  canchaDesde:  { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.gold, marginTop: 2 },

  badge: {
    backgroundColor: withAlpha(COLORS.gold, '22'), borderWidth: 1, borderColor: withAlpha(COLORS.gold, '66'),
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3,
  },
  badgeText: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gold, letterSpacing: 0.4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm, marginBottom: SPACING.sm },

  stepperTitle: { fontFamily: FONTS.heading, fontSize: TYPE.h1, color: COLORS.white, letterSpacing: 1, marginTop: SPACING.lg, marginBottom: SPACING.sm },
  stepLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SPACING.md, marginBottom: 4 },
  stepDot:      { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center' },
  stepDotText:  { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.white },
  stepLabelText:{ fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white },

  slotBtn:       { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.card },
  slotBtnActive: { borderColor: COLORS.neon, backgroundColor: withAlpha(COLORS.neon, '22') },
  slotBtnDisabled: { opacity: 0.4 },
  slotBtnText:       { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.gray2 },
  slotBtnTextActive: { color: COLORS.neon },
  slotBtnTextDisabled: { color: COLORS.gray },

  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: SPACING.sm },
  avisoText: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, lineHeight: 18 },
  cardTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white, marginBottom: 4 },
  linkText:  { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.gray2, textDecorationLine: 'underline' },
  countdownText: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.gold, marginTop: 6 },
  feeNote: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, textAlign: 'center', marginTop: 6 },

  successTitle: { fontFamily: FONTS.heading, fontSize: TYPE.display, color: COLORS.neon, marginTop: 8 },

  codigoChipBig:   { alignItems: 'center', paddingVertical: SPACING.sm },
  codigoTextBig:   { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.neon, letterSpacing: 3 },
  codigoChipSmall: { alignItems: 'flex-end' },
  codigoTextSmall: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.neon, letterSpacing: 1 },
  codigoHint:      { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: 2 },

  estadoLabel: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small },
  reservaAcciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm, alignItems: 'center' },
  waIconBtn: { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: '#25D36622', alignItems: 'center', justifyContent: 'center' },

  dateChip: { width: 60, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', marginRight: 8 },
  dateChipActive: { borderColor: COLORS.neon, backgroundColor: withAlpha(COLORS.neon, '18') },
  dateMes: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, textTransform: 'capitalize' },
  dateDia: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  dateDow: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray },

  saldoMonto: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.neon, textAlign: 'center' },
});
