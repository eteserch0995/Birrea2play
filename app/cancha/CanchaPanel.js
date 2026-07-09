import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Linking, Switch, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS, TYPE, withAlpha } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useAuthStore from '../../store/authStore';
import { useAppRefresh } from '../../hooks/useAppRefresh';
import { TimeField } from '../../components/DateTimeField';
import ResponsiveContainer from '../../components/ResponsiveContainer';
import { Card, Chip, Field, BottomSheetModal, ScreenHeader, PressableScale } from '../../components/ui';

// ═══════════════════════════════════════════════════════════════════════════
// CanchaPanel — panel del administrador de cancha (rol cancha_admin).
// Rediseño 2026-07-05: reemplaza el modelo LEGACY de cancha_slots (muerto,
// 0 filas) por el flujo v3 de cancha_reservas (abono → aprobación → saldo)
// + cancha_bloqueos_externos vía RPC. Ver contrato completo en las
// migraciones supabase/migrations/20260704000*_canchas_v3_*.sql.
// ═══════════════════════════════════════════════════════════════════════════

const HEIGHT_PER_MIN   = 1.5;  // px por minuto de duración en los bloques de agenda
const MIN_BLOCK_HEIGHT = 50;   // alto mínimo de una franja (tap target + legible)

const DEPORTES   = ['Fútbol', 'Fútbol Sala', 'Pádel', 'Volleyball', 'Basketball'];
const FORMATOS   = [5, 6, 7, 8, 9, 11];
const DIAS_LABEL = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const CANALES    = [['interno', 'Interno'], ['whatsapp', 'WhatsApp'], ['llamada', 'Llamada'], ['presencial', 'Presencial']];

// ── helpers de fecha/hora ────────────────────────────────────────────────
function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayOfWeek(dateStr) { return new Date(dateStr + 'T12:00:00').getDay(); }
function pad2(n) { return n.toString().padStart(2, '0'); }
function toMin(hhmmss) {
  if (!hhmmss) return 0;
  const [h, m] = hhmmss.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}
function toHHMM(min) { return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`; }
function fmtHora(hhmmss) { return (hhmmss ?? '').slice(0, 5); }

function fmtDateChip(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()];
  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getMonth()];
  return { dia: d.getDate(), mes, dow };
}
function fmtFechaCorta(dateStr) {
  if (!dateStr) return '';
  const { dia, mes, dow } = fmtDateChip(dateStr);
  return `${dow} ${pad2(dia)} ${mes}`;
}

function openWhatsApp(telefono, mensaje) {
  const digits = (telefono ?? '').replace(/\D/g, '');
  const num = digits.startsWith('507') ? digits : '507' + digits;
  const url = `https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`;
  Linking.openURL(url).catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp'));
}

function humanizeRpcError(code) {
  if (!code) return 'Ocurrió un error inesperado.';
  if (typeof code === 'string' && code.startsWith('invalid_status')) {
    return `La reserva ya cambió de estado (${code.split(':')[1] ?? ''}).`;
  }
  const map = {
    abono_no_pagado:   'El gestor todavía no pagó el abono — no se puede aprobar.',
    reserva_not_found: 'La reserva ya no existe.',
    forbidden:         'No tenés permiso sobre esta cancha.',
  };
  return map[code] ?? code;
}

// ── visual por estado de una reserva (colores del timeline/solicitudes) ──
function reservaVisual(r) {
  // v4: toda solicitud pending espera la decisión de la cancha (aún sin pago)
  if (r.status === 'pending') {
    return { bg: COLORS.gold, label: 'POR APROBAR' };
  }
  if (r.status === 'completed') {
    return { bg: COLORS.gray, label: 'JUGADA' };
  }
  // v4: aprobada con ventana de pago abierta (el gestor debe pagar el abono)
  if (r.status === 'approved' && r.estado_pago === 'pendiente') {
    return { bg: COLORS.gold, label: 'APROBADA · ESPERANDO ABONO', dashed: true };
  }
  if (r.status === 'approved' && r.estado_pago === 'pagado') {
    return { bg: COLORS.blue2, label: 'PAGADA' };
  }
  if (r.status === 'approved' && (r.estado_pago === 'abono_pagado' || r.estado_pago === 'no_requerido')) {
    const saldo = Math.max(0, Number(r.monto_total || 0) - Number(r.deposito_pagado || 0) - Number(r.saldo_pagado || 0));
    return { bg: COLORS.neon, label: `CONFIRMADA · saldo $${saldo.toFixed(2)}` };
  }
  return { bg: COLORS.line, label: (r.estado_pago || r.status || '').toUpperCase() || '—' };
}

// ── grilla de la agenda (ticks de la franja horaria de un día) ───────────
function stepMinutosDe(horario, cancha) {
  return (horario?.medias_horas || cancha?.permite_media_hora_extra) ? 30 : 60;
}

function gridPoints(horario, cancha) {
  if (!horario) return [];
  const stepMin = stepMinutosDe(horario, cancha);
  const openMin = toMin(horario.hora_apertura);
  const closeMin = toMin(horario.hora_cierre);
  const points = [];
  for (let m = openMin; m <= closeMin; m += stepMin) points.push(toHHMM(m));
  return points;
}

// Arma las filas del timeline: reserva / bloqueo / libre, una por franja,
// con alto proporcional a la duración cuando hay algo que ocupa el bloque.
function buildAgendaRows({ horario, reservas, bloqueos, cancha }) {
  if (!horario) return [];
  const stepMin = stepMinutosDe(horario, cancha);
  let openMin  = toMin(horario.hora_apertura);
  let closeMin = toMin(horario.hora_cierre);

  // Defensivo: si hay reservas/bloqueos fuera del horario configurado
  // (ej. horario editado después de crear la reserva), igual se muestran.
  reservas.forEach((r) => {
    openMin  = Math.min(openMin, toMin(r.hora_inicio));
    closeMin = Math.max(closeMin, toMin(r.hora_fin));
  });
  bloqueos.forEach((b) => {
    openMin  = Math.min(openMin, toMin(b.hora_inicio));
    closeMin = Math.max(closeMin, toMin(b.hora_fin));
  });

  const rows = [];
  let cur = openMin;
  while (cur < closeMin) {
    const reserva = reservas.find((r) => toMin(r.hora_inicio) === cur);
    const bloqueo = !reserva ? bloqueos.find((b) => toMin(b.hora_inicio) === cur) : null;
    if (reserva) {
      const dur = Math.max(stepMin, toMin(reserva.hora_fin) - toMin(reserva.hora_inicio));
      rows.push({ type: 'reserva', key: `r_${reserva.reserva_id}`, time: toHHMM(cur), durationMin: dur, data: reserva });
      cur += dur;
    } else if (bloqueo) {
      const dur = Math.max(stepMin, toMin(bloqueo.hora_fin) - toMin(bloqueo.hora_inicio));
      rows.push({ type: 'bloqueo', key: `b_${bloqueo.bloqueo_id}`, time: toHHMM(cur), durationMin: dur, data: bloqueo });
      cur += dur;
    } else {
      rows.push({ type: 'free', key: `f_${toHHMM(cur)}`, time: toHHMM(cur), durationMin: stepMin });
      cur += stepMin;
    }
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// Panel principal
// ═══════════════════════════════════════════════════════════════════════════
export default function CanchaPanel() {
  const user = useAuthStore((s) => s.user);

  const [canchas,          setCanchas]          = useState([]);
  const [loadingCanchas,   setLoadingCanchas]   = useState(true);
  const [selectedCanchaId, setSelectedCanchaId] = useState(null);
  const [selectedDate,     setSelectedDate]     = useState(todayIso());

  const [reservas,    setReservas]    = useState([]); // get_reservas_del_dia (todas las canchas del owner)
  const [bloqueos,    setBloqueos]    = useState([]); // get_bloqueos_del_dia
  const [horarioDia,  setHorarioDia]  = useState(null);
  const [loadingDia,  setLoadingDia]  = useState(true);
  const [dotDates,    setDotDates]    = useState(new Set());

  const [liquidacion,        setLiquidacion]        = useState(0);
  const [loadingLiquidacion, setLoadingLiquidacion] = useState(true);

  const [nowMs, setNowMs] = useState(Date.now());

  // Sheets (dato "sticky": no se limpia al cerrar para no ver el contenido
  // parpadear vacío durante la animación de salida del BottomSheetModal).
  const [reservaSheetData,    setReservaSheetData]    = useState(null);
  const [reservaSheetVisible, setReservaSheetVisible] = useState(false);
  const [bloqueoSheetData,    setBloqueoSheetData]    = useState(null);
  const [bloqueoSheetVisible, setBloqueoSheetVisible] = useState(false);
  const [motivoData,          setMotivoData]          = useState(null); // { mode: 'rechazar'|'cancelar', reserva }
  const [motivoVisible,       setMotivoVisible]        = useState(false);
  const [bloquearPrefill,     setBloquearPrefill]     = useState('');
  const [bloquearVisible,     setBloquearVisible]     = useState(false);
  const [configExisting,      setConfigExisting]      = useState(null);
  const [configVisible,       setConfigVisible]       = useState(false);

  const selectedCancha = canchas.find((c) => c.id === selectedCanchaId) ?? null;

  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(todayIso(), i)), []);

  // ── Fetchers ────────────────────────────────────────────────────────────
  const fetchLiquidacionForIds = useCallback(async (ids) => {
    if (!ids?.length) { setLiquidacion(0); setLoadingLiquidacion(false); return; }
    setLoadingLiquidacion(true);
    try {
      const { data, error } = await supabase
        .from('cancha_reservas')
        .select('deposito_pagado, saldo_pagado')
        .in('cancha_id', ids)
        .eq('liquidada', false)
        .in('estado_pago', ['abono_pagado', 'pagado']);
      if (error) throw error;
      const total = (data ?? []).reduce(
        (acc, r) => acc + Number(r.deposito_pagado || 0) + Number(r.saldo_pagado || 0), 0);
      setLiquidacion(total);
    } catch (_e) {
      // sección informativa: fallo silencioso, no bloquea el resto del panel
    } finally {
      setLoadingLiquidacion(false);
    }
  }, []);

  const fetchCanchas = useCallback(async () => {
    if (!user?.id) { setLoadingCanchas(false); return; }
    setLoadingCanchas(true);
    try {
      const { data, error } = await supabase
        .from('canchas')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const list = data ?? [];
      setCanchas(list);
      setSelectedCanchaId((prev) => (prev && list.some((c) => c.id === prev)) ? prev : (list[0]?.id ?? null));
      fetchLiquidacionForIds(list.map((c) => c.id));
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudieron cargar tus canchas');
    } finally {
      setLoadingCanchas(false);
    }
  }, [user?.id, fetchLiquidacionForIds]);

  const fetchDia = useCallback(async () => {
    if (!selectedCanchaId) {
      setReservas([]); setBloqueos([]); setHorarioDia(null); setLoadingDia(false);
      return;
    }
    setLoadingDia(true);
    try {
      const dow = dayOfWeek(selectedDate);
      const [reservasRes, bloqueosRes, horarioRes] = await Promise.all([
        supabase.rpc('get_reservas_del_dia', { p_fecha: selectedDate }),
        supabase.rpc('get_bloqueos_del_dia', { p_fecha: selectedDate }),
        supabase.from('cancha_horarios').select('*')
          .eq('cancha_id', selectedCanchaId).eq('dia_semana', dow)
          .eq('activo', true).is('tarifa_id', null).maybeSingle(),
      ]);
      if (reservasRes.error) throw reservasRes.error;
      const fetchedAt = Date.now();
      const withExpiry = (reservasRes.data ?? []).map((r) => ({
        ...r,
        _expiraAtMs: r.segundos_hasta_expiracion != null
          ? fetchedAt + Number(r.segundos_hasta_expiracion) * 1000
          : null,
      }));
      setReservas(withExpiry);
      setBloqueos(bloqueosRes.error ? [] : (bloqueosRes.data ?? []));
      setHorarioDia(horarioRes.data ?? null);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo cargar la agenda del día');
    } finally {
      setLoadingDia(false);
    }
  }, [selectedCanchaId, selectedDate]);

  const fetchDots = useCallback(async () => {
    if (!selectedCanchaId) { setDotDates(new Set()); return; }
    try {
      const { data, error } = await supabase
        .from('cancha_reservas')
        .select('fecha')
        .eq('cancha_id', selectedCanchaId)
        .in('fecha', dates)
        .in('status', ['pending', 'approved', 'completed']);
      if (error) throw error;
      setDotDates(new Set((data ?? []).map((r) => r.fecha)));
    } catch (_e) {
      // decorativo, fallo silencioso
    }
  }, [selectedCanchaId, dates]);

  const refetchEverything = useCallback(async () => {
    await fetchCanchas();
    await fetchDia();
    fetchDots();
  }, [fetchCanchas, fetchDia, fetchDots]);

  useEffect(() => { fetchCanchas(); }, [fetchCanchas]);
  useEffect(() => { fetchDia(); }, [fetchDia]);
  useEffect(() => { fetchDots(); }, [fetchDots]);
  useFocusEffect(useCallback(() => { fetchDia(); }, [fetchDia]));

  const { refreshing, onRefresh } = useAppRefresh(refetchEverything);

  // ── Derivados del día seleccionado (scopeados a la cancha seleccionada) ──
  const reservasCancha = useMemo(
    () => reservas.filter((r) => r.cancha_id === selectedCanchaId && !['cancelled', 'rejected'].includes(r.status)),
    [reservas, selectedCanchaId]);
  const bloqueosCancha = useMemo(
    () => bloqueos.filter((b) => b.cancha_id === selectedCanchaId),
    [bloqueos, selectedCanchaId]);

  // v4: TODA solicitud pending se aprueba/rechaza (el abono se paga después de aprobar)
  const paraAprobar = useMemo(
    () => reservasCancha.filter((r) => r.status === 'pending'),
    [reservasCancha]);
  // v4: aprobadas con la ventana de pago del abono abierta (countdown)
  const holds = useMemo(
    () => reservasCancha.filter((r) => r.status === 'approved' && r.estado_pago === 'pendiente'),
    [reservasCancha]);

  const statReservas   = reservasCancha.length;
  const statPorAprobar = paraAprobar.length;
  const statRecaudado  = reservasCancha.reduce(
    (acc, r) => acc + Number(r.deposito_pagado || 0) + Number(r.saldo_pagado || 0), 0);

  const agendaRows = useMemo(
    () => buildAgendaRows({ horario: horarioDia, reservas: reservasCancha, bloqueos: bloqueosCancha, cancha: selectedCancha }),
    [horarioDia, reservasCancha, bloqueosCancha, selectedCancha]);

  // Countdown en vivo de los holds impagos (solo corre mientras hay alguno)
  useEffect(() => {
    if (holds.length === 0) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [holds.length]);

  // ── Handlers de sheets ────────────────────────────────────────────────
  function openReservaDetail(r) { setReservaSheetData(r); setReservaSheetVisible(true); }
  function closeReservaDetail() { setReservaSheetVisible(false); }
  function openBloqueoDetail(b) { setBloqueoSheetData(b); setBloqueoSheetVisible(true); }
  function closeBloqueoDetail() { setBloqueoSheetVisible(false); }
  function openMotivo(mode, reserva) {
    setReservaSheetVisible(false);
    setMotivoData({ mode, reserva });
    setMotivoVisible(true);
  }
  function closeMotivo() { setMotivoVisible(false); }
  function openLibre(hora) { setBloquearPrefill(hora); setBloquearVisible(true); }
  function closeBloquear() { setBloquearVisible(false); }
  function openConfig(cancha) { setConfigExisting(cancha ?? null); setConfigVisible(true); }
  function closeConfig() { setConfigVisible(false); }

  // ── Estados de carga / vacío ────────────────────────────────────────────
  if (loadingCanchas) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={COLORS.neon} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (canchas.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <ResponsiveContainer>
          <ScrollView contentContainerStyle={{ padding: SPACING.md }}>
            <ScreenHeader title="Mi Cancha" />
            <EmptyCanchaCard onCreate={() => openConfig(null)} />
          </ScrollView>
        </ResponsiveContainer>
        <ConfigSheet
          visible={configVisible} onClose={closeConfig}
          onSaved={async () => { await fetchCanchas(); fetchDia(); fetchDots(); }}
          userId={user?.id} existing={configExisting}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ResponsiveContainer>
        <ScrollView
          contentContainerStyle={{ paddingBottom: SPACING.xxl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.neon} />}
        >
          <ScreenHeader
            title={selectedCancha?.nombre ?? 'Mi Cancha'}
            subtitle={selectedCancha?.direccion || undefined}
            right={
              <TouchableOpacity
                onPress={refetchEverything}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Actualizar"
              >
                <Text style={styles.refreshIcon}>⟳</Text>
              </TouchableOpacity>
            }
          />

          {canchas.length > 1 && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.canchaChipsRow}
            >
              {canchas.map((c) => (
                <Chip key={c.id} label={c.nombre} active={c.id === selectedCanchaId}
                  color={COLORS.gold} onPress={() => setSelectedCanchaId(c.id)} />
              ))}
            </ScrollView>
          )}

          {/* ── Stats del día ── */}
          <View style={styles.statsRow}>
            <StatTile label="Reservas" value={String(statReservas)} />
            <StatTile label="Por aprobar" value={String(statPorAprobar)} color={statPorAprobar > 0 ? COLORS.gold : undefined} />
            <StatTile label="Recaudado" value={`$${statRecaudado.toFixed(2)}`} color={COLORS.neon} />
          </View>

          {/* ── Solicitudes por aprobar ── */}
          {(paraAprobar.length + holds.length) > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SOLICITUDES POR APROBAR</Text>
              {paraAprobar.map((r) => (
                <SolicitudCard
                  key={r.reserva_id} reserva={r} fecha={selectedDate}
                  onAprobado={refetchEverything}
                  onRechazar={(reserva) => openMotivo('rechazar', reserva)}
                />
              ))}
              {holds.map((r) => (
                <HoldCard key={r.reserva_id} reserva={r} fecha={selectedDate} nowMs={nowMs} />
              ))}
            </View>
          )}

          {/* ── Agenda ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AGENDA</Text>
            <DateStrip dates={dates} selectedDate={selectedDate} onSelect={setSelectedDate} dotDates={dotDates} />

            {loadingDia ? (
              <ActivityIndicator color={COLORS.neon} style={{ marginTop: SPACING.lg }} />
            ) : (
              <AgendaTimeline
                rows={agendaRows}
                onOpenReserva={openReservaDetail}
                onOpenBloqueo={openBloqueoDetail}
                onOpenLibre={openLibre}
              />
            )}
          </View>

          {/* ── Configuración ── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CONFIGURACIÓN</Text>
            <Card onPress={() => openConfig(selectedCancha)} style={styles.configRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.configRowTitle}>{selectedCancha?.nombre ?? 'Tu cancha'}</Text>
                <Text style={styles.configRowSub}>Tarifas, horarios, abono y hora y media</Text>
              </View>
              <Text style={styles.configRowArrow}>⚙</Text>
            </Card>
            <TouchableOpacity onPress={() => openConfig(null)} style={{ alignSelf: 'flex-start', marginTop: SPACING.sm }}>
              <Text style={styles.addLink}>+ Nueva cancha</Text>
            </TouchableOpacity>
          </View>

          {/* ── Liquidación (solo lectura) ── */}
          <LiquidacionCard total={liquidacion} loading={loadingLiquidacion} />
        </ScrollView>
      </ResponsiveContainer>

      {/* ── Sheets ── */}
      <ReservaDetailSheet
        visible={reservaSheetVisible} reserva={reservaSheetData}
        fecha={selectedDate} cancha={selectedCancha}
        onClose={closeReservaDetail}
        onChanged={refetchEverything}
        onRechazar={(r) => openMotivo('rechazar', r)}
        onCancelar={(r) => openMotivo('cancelar', r)}
      />
      <BloqueoDetailSheet
        visible={bloqueoSheetVisible} bloqueo={bloqueoSheetData}
        fecha={selectedDate}
        onClose={closeBloqueoDetail}
        onChanged={refetchEverything}
      />
      <MotivoSheet
        visible={motivoVisible} data={motivoData}
        onClose={closeMotivo}
        onDone={refetchEverything}
      />
      <BloquearHorarioSheet
        visible={bloquearVisible} prefillHora={bloquearPrefill}
        horario={horarioDia} cancha={selectedCancha}
        canchaId={selectedCanchaId} fecha={selectedDate}
        onClose={closeBloquear}
        onDone={refetchEverything}
      />
      <ConfigSheet
        visible={configVisible} onClose={closeConfig}
        onSaved={async () => { await fetchCanchas(); fetchDia(); fetchDots(); }}
        userId={user?.id} existing={configExisting}
      />
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Stat tile
// ═══════════════════════════════════════════════════════════════════════════
function StatTile({ label, value, color }) {
  return (
    <Card variant="glass" style={styles.statTile}>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Solicitud por aprobar
// ═══════════════════════════════════════════════════════════════════════════
function SolicitudCard({ reserva, fecha, onAprobado, onRechazar }) {
  const [loading, setLoading] = useState(false);
  const sinAbono = reserva.estado_pago === 'no_requerido' || !(reserva.deposito_requerido > 0);
  const abonoYaPagado = Number(reserva.deposito_pagado || 0) > 0;
  const montoLine = sinAbono
    ? `$${Number(reserva.monto_total || 0).toFixed(2)} · sin abono`
    : abonoYaPagado
      ? `$${Number(reserva.monto_total || 0).toFixed(2)} · abono pagado $${Number(reserva.deposito_pagado || 0).toFixed(2)}`
      : `$${Number(reserva.monto_total || 0).toFixed(2)} · al aprobar se le pide el abono de $${Number(reserva.deposito_requerido || 0).toFixed(2)}`;

  async function handleAprobar() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('aprobar_cancha_reserva', { p_reserva_id: reserva.reserva_id });
      if (error) throw new Error(error.message);
      if (data?.ok === false) { Alert.alert('No se pudo aprobar', humanizeRpcError(data.error)); return; }
      if (data?.abono_pendiente) {
        Alert.alert('Solicitud aprobada', `Le avisamos a ${reserva.gestor_nombre ?? 'el gestor'} para que pague el abono de $${Number(data.abono_pendiente).toFixed(2)}. El horario queda asegurado cuando pague.`);
      }
      onAprobado();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo aprobar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card style={styles.solicitudCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.solicitudNombre}>{reserva.gestor_nombre ?? 'Gestor'}</Text>
          {!!reserva.gestor_telefono && <Text style={styles.solicitudSub}>{reserva.gestor_telefono}</Text>}
        </View>
        <View style={styles.solicitudBadge}><Text style={styles.solicitudBadgeText}>POR APROBAR</Text></View>
      </View>
      <Text style={styles.solicitudFecha}>{fmtFechaCorta(fecha)} · {fmtHora(reserva.hora_inicio)}–{fmtHora(reserva.hora_fin)}</Text>
      <Text style={styles.solicitudMonto}>{montoLine}</Text>
      {reserva.es_combinada && !!reserva.canchas_base_nombres?.length && (
        <Text style={styles.solicitudCombo}>Combo: {reserva.canchas_base_nombres.join(' + ')}</Text>
      )}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        <PressableScale style={[styles.btnPrimary, { flex: 1 }]} onPress={handleAprobar} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnPrimaryText}>APROBAR</Text>}
        </PressableScale>
        <PressableScale style={[styles.btnDangerOutline, { flex: 1 }]} onPress={() => onRechazar(reserva)} disabled={loading}>
          <Text style={styles.btnDangerOutlineText}>RECHAZAR</Text>
        </PressableScale>
      </View>
    </Card>
  );
}

function HoldCard({ reserva, fecha, nowMs }) {
  const remaining = reserva._expiraAtMs != null ? Math.max(0, Math.round((reserva._expiraAtMs - nowMs) / 1000)) : null;
  const label = remaining != null
    ? (remaining > 0 ? `Expira en ${Math.floor(remaining / 60)}:${pad2(remaining % 60)}` : 'Por expirar')
    : 'Esperando abono';
  return (
    <Card style={[styles.solicitudCard, styles.holdCard]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.holdNombre}>{reserva.gestor_nombre ?? 'Gestor'}</Text>
        <Text style={styles.holdBadge}>ESPERANDO ABONO</Text>
      </View>
      <Text style={styles.solicitudFecha}>{fmtFechaCorta(fecha)} · {fmtHora(reserva.hora_inicio)}–{fmtHora(reserva.hora_fin)}</Text>
      <Text style={styles.holdSub}>{label}</Text>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Agenda: strip de 14 días + timeline vertical
// ═══════════════════════════════════════════════════════════════════════════
function DateStrip({ dates, selectedDate, onSelect, dotDates }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStripRow}>
      {dates.map((d) => {
        const active = d === selectedDate;
        const { dia, mes, dow } = fmtDateChip(d);
        const hasDot = dotDates.has(d);
        return (
          <PressableScale key={d} onPress={() => onSelect(d)} style={[styles.dateChip, active && styles.dateChipActive]}>
            <Text style={[styles.dateChipDow, active && styles.dateChipTextActive]}>{dow}</Text>
            <Text style={[styles.dateChipDia, active && styles.dateChipTextActive]}>{dia}</Text>
            <Text style={[styles.dateChipMes, active && styles.dateChipTextActive]}>{mes}</Text>
            <View style={[styles.dateDot, { opacity: hasDot ? 1 : 0 }, active && { backgroundColor: COLORS.bg }]} />
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

function AgendaTimeline({ rows, onOpenReserva, onOpenBloqueo, onOpenLibre }) {
  if (rows.length === 0) {
    return <Text style={styles.emptyTimelineText}>La cancha no opera este día.</Text>;
  }
  return (
    <View style={{ gap: 6, marginTop: SPACING.sm }}>
      {rows.map((row) => {
        if (row.type === 'reserva') return <ReservaBlock key={row.key} row={row} onPress={() => onOpenReserva(row.data)} />;
        if (row.type === 'bloqueo') return <BloqueoBlock key={row.key} row={row} onPress={() => onOpenBloqueo(row.data)} />;
        return <FreeRow key={row.key} row={row} onPress={() => onOpenLibre(row.time)} />;
      })}
    </View>
  );
}

function ReservaBlock({ row, onPress }) {
  const r = row.data;
  const visual = reservaVisual(r);
  const height = Math.max(MIN_BLOCK_HEIGHT, row.durationMin * HEIGHT_PER_MIN);
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.block, { height, backgroundColor: withAlpha(visual.bg, '1F'), borderColor: visual.bg },
        visual.dashed && styles.blockDashed,
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[styles.blockTime, { color: visual.bg }]}>{fmtHora(r.hora_inicio)}–{fmtHora(r.hora_fin)}</Text>
        <Text style={[styles.blockBadge, { color: visual.bg }]} numberOfLines={1}>{visual.label}</Text>
      </View>
      <Text style={styles.blockTitle} numberOfLines={1}>{r.gestor_nombre ?? 'Gestor'} · {r.codigo_reserva}</Text>
      {r.es_combinada && !!r.canchas_base_nombres?.length && (
        <Text style={styles.blockSub} numberOfLines={1}>Combo: {r.canchas_base_nombres.join(' + ')}</Text>
      )}
    </PressableScale>
  );
}

function BloqueoBlock({ row, onPress }) {
  const b = row.data;
  const height = Math.max(MIN_BLOCK_HEIGHT, row.durationMin * HEIGHT_PER_MIN);
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.block, { height, backgroundColor: withAlpha(COLORS.red2, '1F'), borderColor: COLORS.red2 }]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[styles.blockTime, { color: COLORS.red2 }]}>{fmtHora(b.hora_inicio)}–{fmtHora(b.hora_fin)}</Text>
        <Text style={[styles.blockBadge, { color: COLORS.red2 }]}>{(b.fuente_canal ?? 'interno').toUpperCase()}</Text>
      </View>
      <Text style={styles.blockTitle} numberOfLines={1}>BLOQUEADO · {b.cliente_nombre ?? 'Sin nombre'}</Text>
    </PressableScale>
  );
}

function FreeRow({ row, onPress }) {
  const height = Math.max(MIN_BLOCK_HEIGHT, row.durationMin * HEIGHT_PER_MIN);
  return (
    <PressableScale onPress={onPress} style={[styles.freeRow, { height }]}>
      <Text style={styles.freeRowText}>+  {fmtHora(row.time)} libre — tocá para bloquear</Text>
    </PressableScale>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Detalle de reserva (BottomSheetModal)
// ═══════════════════════════════════════════════════════════════════════════
function DetailRow({ label, value, highlight }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && { color: COLORS.gold }]}>{value}</Text>
    </View>
  );
}

function ReservaDetailSheet({ visible, reserva, fecha, cancha, onClose, onChanged, onRechazar, onCancelar }) {
  const [loading, setLoading] = useState(false);
  const [notasCobro, setNotasCobro] = useState('');

  useEffect(() => { if (visible) setNotasCobro(''); }, [visible, reserva?.reserva_id]);

  const r = reserva ?? {};
  const visual = reservaVisual(r);
  const saldoPendiente = Math.max(0, Number(r.monto_total || 0) - Number(r.deposito_pagado || 0) - Number(r.saldo_pagado || 0));
  const puedeAprobar       = r.status === 'pending';
  const puedeMarcarCobrado = ['pending', 'approved'].includes(r.status) && ['pendiente', 'abono_pagado', 'no_requerido'].includes(r.estado_pago);
  const puedeCancelar      = ['pending', 'approved'].includes(r.status);

  async function handleAprobar() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('aprobar_cancha_reserva', { p_reserva_id: r.reserva_id });
      if (error) throw new Error(error.message);
      if (data?.ok === false) { Alert.alert('No se pudo aprobar', humanizeRpcError(data.error)); return; }
      onChanged(); onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo aprobar');
    } finally {
      setLoading(false);
    }
  }

  async function handleMarcarCobrado() {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('marcar_reserva_pagada_admin', {
        p_reserva_id: r.reserva_id, p_notas: notasCobro.trim() || null,
      });
      if (error) throw new Error(error.message);
      Alert.alert('Listo', 'Se registró el cobro en sitio.');
      onChanged(); onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo registrar el cobro');
    } finally {
      setLoading(false);
    }
  }

  function handleWhatsApp() {
    if (!r.gestor_telefono) { Alert.alert('Sin teléfono', 'El gestor no tiene teléfono registrado.'); return; }
    const msg = `Hola ${r.gestor_nombre ?? ''}, te escribimos de ${cancha?.nombre ?? 'la cancha'} sobre tu reserva ${r.codigo_reserva ?? ''} del ${fmtFechaCorta(fecha)} ${fmtHora(r.hora_inicio)}–${fmtHora(r.hora_fin)}.`;
    openWhatsApp(r.gestor_telefono, msg);
  }

  return (
    <BottomSheetModal
      visible={visible} onClose={onClose}
      title={r.codigo_reserva ?? 'Reserva'}
      subtitle={`${fmtFechaCorta(fecha)} · ${fmtHora(r.hora_inicio)}–${fmtHora(r.hora_fin)}`}
    >
      <View style={[styles.detailBadge, { backgroundColor: withAlpha(visual.bg, '22'), borderColor: visual.bg }]}>
        <Text style={[styles.detailBadgeText, { color: visual.bg }]}>{visual.label}</Text>
      </View>

      <DetailRow label="Gestor" value={r.gestor_nombre ?? '—'} />
      {!!r.gestor_telefono && <DetailRow label="Teléfono" value={r.gestor_telefono} />}
      {!!r.gestor_email && <DetailRow label="Correo" value={r.gestor_email} />}
      <DetailRow label="Canal" value={(r.canal ?? 'app').toUpperCase()} />
      {r.es_combinada && !!r.canchas_base_nombres?.length && (
        <DetailRow label="Combo" value={r.canchas_base_nombres.join(' + ')} />
      )}
      <DetailRow label="Total" value={`$${Number(r.monto_total || 0).toFixed(2)}`} />
      <DetailRow label="Abono pagado" value={`$${Number(r.deposito_pagado || 0).toFixed(2)}`} />
      <DetailRow label="Saldo pagado" value={`$${Number(r.saldo_pagado || 0).toFixed(2)}`} />
      {saldoPendiente > 0 && <DetailRow label="Saldo pendiente" value={`$${saldoPendiente.toFixed(2)}`} highlight />}
      {!!r.motivo_rechazo && <DetailRow label="Motivo rechazo" value={r.motivo_rechazo} />}
      {!!r.notas && <DetailRow label="Notas" value={r.notas} />}

      <View style={{ gap: SPACING.sm, marginTop: SPACING.md }}>
        {puedeAprobar && (
          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <PressableScale style={[styles.btnPrimary, { flex: 1 }]} onPress={handleAprobar} disabled={loading}>
              {loading ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnPrimaryText}>APROBAR</Text>}
            </PressableScale>
            <PressableScale style={[styles.btnDangerOutline, { flex: 1 }]} onPress={() => onRechazar(r)} disabled={loading}>
              <Text style={styles.btnDangerOutlineText}>RECHAZAR</Text>
            </PressableScale>
          </View>
        )}
        {puedeMarcarCobrado && (
          <>
            <Field label="Nota de cobro (opcional)" value={notasCobro} onChangeText={setNotasCobro}
              placeholder="Ej: pagó en efectivo en recepción" />
            <PressableScale style={styles.btnGold} onPress={handleMarcarCobrado} disabled={loading}>
              {loading ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnGoldText}>MARCAR COBRADO EN SITIO</Text>}
            </PressableScale>
          </>
        )}
        {!!r.gestor_telefono && (
          <PressableScale style={styles.btnWhatsapp} onPress={handleWhatsApp}>
            <Text style={styles.btnWhatsappText}>WHATSAPP AL GESTOR</Text>
          </PressableScale>
        )}
        {puedeCancelar && (
          <PressableScale style={styles.btnDangerOutline} onPress={() => onCancelar(r)}>
            <Text style={styles.btnDangerOutlineText}>CANCELAR RESERVA</Text>
          </PressableScale>
        )}
      </View>
    </BottomSheetModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Detalle de bloqueo externo
// ═══════════════════════════════════════════════════════════════════════════
function BloqueoDetailSheet({ visible, bloqueo, fecha, onClose, onChanged }) {
  const [loading, setLoading] = useState(false);
  const b = bloqueo ?? {};

  async function handleQuitar() {
    setLoading(true);
    try {
      const { error } = await supabase.rpc('eliminar_bloqueo_externo', { p_bloqueo_id: b.bloqueo_id });
      if (error) throw new Error(error.message);
      onChanged(); onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo quitar el bloqueo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheetModal
      visible={visible} onClose={onClose} title="Bloqueo"
      subtitle={`${fmtFechaCorta(fecha)} · ${fmtHora(b.hora_inicio)}–${fmtHora(b.hora_fin)}`}
    >
      <DetailRow label="Cliente / actividad" value={b.cliente_nombre ?? '—'} />
      <DetailRow label="Canal" value={(b.fuente_canal ?? 'interno').toUpperCase()} />
      {Number(b.monto_acordado) > 0 && <DetailRow label="Monto acordado" value={`$${Number(b.monto_acordado).toFixed(2)}`} />}
      {b.es_combinada && <DetailRow label="Combo" value="Sí" />}
      {!!b.nota_interna && <DetailRow label="Nota" value={b.nota_interna} />}
      <PressableScale style={[styles.btnDangerOutline, { marginTop: SPACING.md }]} onPress={handleQuitar} disabled={loading}>
        {loading ? <ActivityIndicator color={COLORS.red2} /> : <Text style={styles.btnDangerOutlineText}>QUITAR BLOQUEO</Text>}
      </PressableScale>
    </BottomSheetModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Motivo compartido: Rechazar solicitud / Cancelar reserva (admin)
// ═══════════════════════════════════════════════════════════════════════════
function MotivoSheet({ visible, data, onClose, onDone }) {
  const [motivo, setMotivo]   = useState('');
  const [loading, setLoading] = useState(false);
  const mode    = data?.mode ?? 'rechazar';
  const reserva = data?.reserva ?? {};
  const isRechazar = mode === 'rechazar';

  useEffect(() => { if (visible) setMotivo(''); }, [visible, data]);

  async function handleConfirm() {
    setLoading(true);
    try {
      const rpcName = isRechazar ? 'rechazar_cancha_reserva' : 'cancelar_cancha_reserva_admin';
      const params = isRechazar
        ? { p_reserva_id: reserva.reserva_id, p_motivo: motivo.trim() || null }
        : { p_reserva_id: reserva.reserva_id, p_notas: motivo.trim() || null };
      const { data: res, error } = await supabase.rpc(rpcName, params);
      if (error) throw new Error(error.message);
      if (res?.ok === false) { Alert.alert('No se pudo completar', humanizeRpcError(res.error)); return; }
      const reembolso = Number(res?.reembolso || 0);
      Alert.alert(
        isRechazar ? 'Solicitud rechazada' : 'Reserva cancelada',
        reembolso > 0
          ? `Reembolsamos $${reembolso.toFixed(2)} a los créditos de ${reserva.gestor_nombre ?? 'el gestor'}.`
          : 'No había pagos que reembolsar.'
      );
      onClose(); onDone();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo completar la acción');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BottomSheetModal
      visible={visible} onClose={onClose}
      title={isRechazar ? 'Rechazar solicitud' : 'Cancelar reserva'}
      subtitle={`${reserva.gestor_nombre ?? 'Gestor'} · ${fmtHora(reserva.hora_inicio)}–${fmtHora(reserva.hora_fin)}`}
      footer={
        <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
          <TouchableOpacity style={[styles.btnGhost, { flex: 1 }]} onPress={onClose} disabled={loading}>
            <Text style={styles.btnGhostText}>Volver</Text>
          </TouchableOpacity>
          <PressableScale style={[styles.btnDanger, { flex: 1 }]} onPress={handleConfirm} disabled={loading}>
            {loading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.btnDangerText}>{isRechazar ? 'Rechazar' : 'Cancelar reserva'}</Text>}
          </PressableScale>
        </View>
      }
    >
      <Field
        label={isRechazar ? 'Motivo (opcional, se lo mostramos al gestor)' : 'Nota interna (opcional)'}
        value={motivo} onChangeText={setMotivo} multiline
        style={{ height: 90, textAlignVertical: 'top' }}
        placeholder={isRechazar ? 'Ej: la cancha está en mantenimiento ese horario' : 'Ej: lluvia, cancha inhabilitada'}
      />
    </BottomSheetModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Bloquear horario (crear_bloqueo_externo)
// ═══════════════════════════════════════════════════════════════════════════
function BloquearHorarioSheet({ visible, prefillHora, horario, cancha, canchaId, fecha, onClose, onDone }) {
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin,    setHoraFin]    = useState('');
  const [nombre,     setNombre]     = useState('Uso interno');
  const [telefono,   setTelefono]   = useState('');
  const [canal,      setCanal]      = useState('interno');
  const [monto,      setMonto]      = useState('');
  const [nota,       setNota]       = useState('');
  const [saving,     setSaving]     = useState(false);

  const points = useMemo(() => gridPoints(horario, cancha), [horario, cancha]);
  const inicioOptions = points.slice(0, -1);
  const finOptions = useMemo(
    () => points.filter((p) => horaInicio && toMin(p) > toMin(horaInicio)),
    [points, horaInicio]);

  useEffect(() => {
    if (!visible) return;
    const ini = prefillHora && inicioOptions.includes(prefillHora) ? prefillHora : (inicioOptions[0] ?? '');
    setHoraInicio(ini);
    setNombre('Uso interno'); setTelefono(''); setCanal('interno'); setMonto(''); setNota('');
    // Solo al abrir el sheet (no en cada tecleo): las opciones dependen de `horario`/`cancha`, estables mientras está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, prefillHora]);

  useEffect(() => {
    if (!visible) return;
    if (!finOptions.includes(horaFin)) setHoraFin(finOptions[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, horaInicio, finOptions.length]);

  async function handleSave() {
    if (!horaInicio || !horaFin) { Alert.alert('Faltan horas', 'Elegí hora de inicio y fin.'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_bloqueo_externo', {
        p_cancha_id:        canchaId,
        p_fecha:            fecha,
        p_hora_inicio:      horaInicio + ':00',
        p_hora_fin:         horaFin + ':00',
        p_cliente_nombre:   nombre.trim() || 'Uso interno',
        p_cliente_telefono: telefono.trim() || null,
        p_fuente_canal:     canal,
        p_monto_acordado:   monto ? Number(monto) : 0,
        p_nota_interna:     nota.trim() || null,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      onClose();
      onDone();
      if (row?.tiene_conflictos) {
        Alert.alert(
          'Bloqueo creado con conflictos',
          'Igual quedó creado. Choca con:\n\n• ' + (row.conflictos_detalle ?? []).join('\n• ')
        );
      } else {
        Alert.alert('Bloqueo creado', 'El horario quedó bloqueado.');
      }
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo crear el bloqueo');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheetModal
      visible={visible} onClose={onClose} title="Bloquear horario"
      footer={
        <PressableScale style={styles.btnPrimary} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnPrimaryText}>BLOQUEAR HORARIO</Text>}
        </PressableScale>
      }
    >
      <Text style={styles.formLabel}>Desde</Text>
      <View style={styles.chipWrapRow}>
        {inicioOptions.map((p) => (
          <Chip key={p} label={fmtHora(p)} active={horaInicio === p} color={COLORS.blue2} onPress={() => setHoraInicio(p)} />
        ))}
      </View>
      <Text style={styles.formLabel}>Hasta</Text>
      <View style={styles.chipWrapRow}>
        {finOptions.map((p) => (
          <Chip key={p} label={fmtHora(p)} active={horaFin === p} color={COLORS.blue2} onPress={() => setHoraFin(p)} />
        ))}
      </View>
      <Field label="Cliente / actividad" value={nombre} onChangeText={setNombre} placeholder="Uso interno" />
      <Field label="Teléfono (opcional)" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="6000-0000" />
      <Text style={styles.formLabel}>Canal</Text>
      <View style={styles.chipWrapRow}>
        {CANALES.map(([val, lbl]) => (
          <Chip key={val} label={lbl} active={canal === val} color={COLORS.blue2} onPress={() => setCanal(val)} />
        ))}
      </View>
      <Field label="Monto acordado ($, opcional)" value={monto} onChangeText={setMonto} keyboardType="decimal-pad" placeholder="0.00" />
      <Field label="Nota (opcional)" value={nota} onChangeText={setNota} multiline
        style={{ height: 70, textAlignVertical: 'top' }} placeholder="Detalles del acuerdo" />
    </BottomSheetModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Liquidación (solo lectura)
// ═══════════════════════════════════════════════════════════════════════════
function LiquidacionCard({ total, loading }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>LIQUIDACIÓN</Text>
      <Card variant="glass">
        {loading ? (
          <ActivityIndicator color={COLORS.gold} style={{ marginVertical: SPACING.sm }} />
        ) : (
          <Text style={styles.liquidacionAmount}>${total.toFixed(2)}</Text>
        )}
        <Text style={styles.liquidacionLabel}>Recaudado por la app (pendiente de transferirte)</Text>
        <Text style={styles.liquidacionNote}>Birrea2Play te transfiere por Yappy.</Text>
      </Card>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Estado vacío: sin canchas registradas
// ═══════════════════════════════════════════════════════════════════════════
function EmptyCanchaCard({ onCreate }) {
  return (
    <Card variant="glass" style={{ alignItems: 'center', padding: SPACING.xl, gap: SPACING.sm, marginTop: SPACING.lg }}>
      <Text style={{ fontSize: 40 }}>🏟️</Text>
      <Text style={styles.emptyTitle}>Todavía no tenés canchas registradas</Text>
      <Text style={styles.emptySub}>Registrá tu cancha para empezar a recibir reservas de gestores.</Text>
      <PressableScale style={styles.btnPrimary} onPress={onCreate}>
        <Text style={styles.btnPrimaryText}>+ REGISTRAR MI CANCHA</Text>
      </PressableScale>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuración de cancha (tarifas, horarios, abono, hora y media, hold)
// ═══════════════════════════════════════════════════════════════════════════
function emptyTarifa() {
  return { _key: `${Date.now()}_${Math.random()}`, deporte: 'Fútbol', formato_jpe: 7, precio_hora: '', descripcion: '', bloqueaActivo: false, bloqueos: [] };
}

function ConfigSheet({ visible, onClose, onSaved, userId, existing }) {
  const [nombre,             setNombre]             = useState('');
  const [direccion,          setDireccion]          = useState('');
  const [telefono,           setTelefono]           = useState('');
  const [tarifas,            setTarifas]            = useState([emptyTarifa()]);
  const [diasActivos,        setDiasActivos]        = useState([1, 2, 3, 4, 5, 6]);
  const [apertura,           setApertura]           = useState('08:00');
  const [cierre,             setCierre]             = useState('22:00');
  const [abonoTipo,          setAbonoTipo]          = useState('porcentaje');
  const [porcentajeDeposito, setPorcentajeDeposito] = useState('50');
  const [abonoMontoFijo,     setAbonoMontoFijo]     = useState('');
  const [permiteMediaHoraExtra, setPermiteMediaHoraExtra] = useState(false);
  const [holdMinutos,        setHoldMinutos]        = useState('2880');
  const [saving,             setSaving]             = useState(false);
  const [deleting,           setDeleting]           = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNombre(existing?.nombre ?? '');
    setDireccion(existing?.direccion ?? '');
    setTelefono(existing?.telefono ?? '');
    setAbonoTipo(existing?.abono_tipo ?? (existing?.requiere_deposito ? 'porcentaje' : 'ninguno'));
    setPorcentajeDeposito((existing?.porcentaje_deposito ?? 50).toString());
    setAbonoMontoFijo(existing?.abono_monto_fijo != null ? String(existing.abono_monto_fijo) : '');
    setPermiteMediaHoraExtra(!!existing?.permite_media_hora_extra);
    setHoldMinutos((existing?.hold_minutos ?? 2880).toString());

    if (existing?.id) {
      supabase.from('cancha_tarifas')
        .select('id, deporte, formato_jpe, descripcion, precio_hora, bloquea_tarifas')
        .eq('cancha_id', existing.id).eq('activo', true)
        .order('precio_hora', { ascending: true })
        .then(({ data }) => {
          setTarifas(data?.length ? data.map((t) => ({
            ...t, _key: t.id,
            precio_hora: t.precio_hora?.toString() ?? '',
            bloqueaActivo: (t.bloquea_tarifas ?? []).length > 0,
            bloqueos: t.bloquea_tarifas ?? [],
          })) : [emptyTarifa()]);
        });
      supabase.from('cancha_horarios')
        .select('dia_semana, hora_apertura, hora_cierre')
        .eq('cancha_id', existing.id).is('tarifa_id', null).eq('activo', true)
        .then(({ data }) => {
          if (data?.length) {
            setDiasActivos(data.map((h) => h.dia_semana).sort((a, b) => a - b));
            setApertura(data[0].hora_apertura?.slice(0, 5) ?? '08:00');
            setCierre(data[0].hora_cierre?.slice(0, 5) ?? '22:00');
          } else {
            setDiasActivos([1, 2, 3, 4, 5, 6]); setApertura('08:00'); setCierre('22:00');
          }
        });
    } else {
      setTarifas([emptyTarifa()]);
      setDiasActivos([1, 2, 3, 4, 5, 6]);
      setApertura('08:00'); setCierre('22:00');
    }
  }, [visible, existing]);

  function updTarifa(key, field, val) { setTarifas((prev) => prev.map((t) => t._key === key ? { ...t, [field]: val } : t)); }
  function addTarifa() { setTarifas((prev) => [...prev, emptyTarifa()]); }
  function removeTarifa(key) { setTarifas((prev) => prev.filter((t) => t._key !== key)); }
  function toggleDia(d) { setDiasActivos((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)); }

  async function handleSave() {
    if (!nombre.trim()) { Alert.alert('Falta nombre', 'El nombre de la cancha es obligatorio.'); return; }
    const tarifasValidas = tarifas.filter((t) => t.precio_hora !== '' && Number(t.precio_hora) > 0);
    if (tarifasValidas.length === 0) { Alert.alert('Falta precio', 'Ingresá el precio por hora de al menos un formato.'); return; }
    if (diasActivos.length === 0) { Alert.alert('Falta horario', 'Seleccioná al menos un día de operación.'); return; }
    if (!apertura || !cierre || cierre <= apertura) { Alert.alert('Horario inválido', 'El cierre debe ser mayor que la apertura.'); return; }
    if (abonoTipo === 'fijo' && !(Number(abonoMontoFijo) > 0)) { Alert.alert('Falta el monto', 'Ingresá el monto fijo de abono.'); return; }

    setSaving(true);
    try {
      let canchaId = existing?.id;
      const payload = {
        nombre:                nombre.trim(),
        direccion:              direccion.trim() || null,
        telefono:               telefono.trim() || null,
        requiere_deposito:      abonoTipo !== 'ninguno',
        porcentaje_deposito:    abonoTipo === 'porcentaje' ? (Number(porcentajeDeposito) || 50) : 0,
        abono_tipo:             abonoTipo,
        abono_monto_fijo:       abonoTipo === 'fijo' ? (Number(abonoMontoFijo) || null) : null,
        duracion_max_minutos:   120,
        permite_media_hora_extra: permiteMediaHoraExtra,
        hold_minutos:           Number(holdMinutos) > 0 ? Number(holdMinutos) : 2880,
      };
      if (canchaId) {
        const { error } = await supabase.from('canchas').update(payload).eq('id', canchaId);
        if (error) throw new Error('Error guardando cancha: ' + error.message);
      } else {
        const { data, error } = await supabase.from('canchas').insert({ ...payload, owner_id: userId }).select('id').single();
        if (error) throw new Error('Error creando cancha: ' + error.message);
        canchaId = data.id;
      }

      if (existing?.id) {
        const idsActuales = tarifasValidas.filter((t) => t.id).map((t) => t.id);
        const { error } = await supabase.from('cancha_tarifas').update({ activo: false })
          .eq('cancha_id', canchaId)
          .not('id', 'in', `(${idsActuales.length ? idsActuales.join(',') : '00000000-0000-0000-0000-000000000000'})`);
        if (error) console.warn('Warn deactivate tarifas:', error.message);
      }

      const keyToId = {};
      for (const t of tarifasValidas) {
        const tarifaPayload = {
          deporte:     t.deporte,
          formato_jpe: Number(t.formato_jpe),
          descripcion: t.descripcion?.trim() || null,
          precio_hora: Number(t.precio_hora),
          activo:      true,
        };
        if (t.id) {
          const { error } = await supabase.from('cancha_tarifas').update(tarifaPayload).eq('id', t.id);
          if (error) throw new Error('Error actualizando tarifa: ' + error.message);
          keyToId[t._key] = t.id;
        } else {
          const { data: tData, error } = await supabase.from('cancha_tarifas')
            .insert({ ...tarifaPayload, cancha_id: canchaId }).select('id').single();
          if (error) throw new Error('Error insertando tarifa: ' + error.message);
          keyToId[t._key] = tData.id;
        }
      }

      for (const t of tarifasValidas) {
        const myId = keyToId[t._key];
        if (!myId) continue;
        const bloqueoIds = (t.bloqueos ?? []).map((k) => keyToId[k] ?? k).filter(Boolean);
        const { error } = await supabase.from('cancha_tarifas').update({ bloquea_tarifas: bloqueoIds }).eq('id', myId);
        if (error) console.warn('Warn bloqueos:', error.message);
      }

      await supabase.from('cancha_horarios').delete().eq('cancha_id', canchaId).is('tarifa_id', null);
      for (const dia of diasActivos) {
        const { error } = await supabase.from('cancha_horarios').insert({
          cancha_id: canchaId, tarifa_id: null, dia_semana: dia,
          hora_apertura: apertura + ':00', hora_cierre: cierre + ':00',
          // El motor v3 valida duración por horas completas (+30 si permite_media_hora_extra)
          // en crear_cancha_reserva; estos 3 valores quedan fijos y ya no gobiernan la duración.
          duracion_slot_min: 60, horario_libre: true, medias_horas: false,
        });
        if (error) throw new Error('Error guardando horario día ' + dia + ': ' + error.message);
      }

      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error al guardar', e.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!existing?.id) return;
    Alert.alert('Eliminar cancha', `¿Eliminás "${existing.nombre}"? Se borran sus tarifas y horarios.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            const { error } = await supabase.from('canchas').delete().eq('id', existing.id);
            if (error) throw error;
            onSaved(); onClose();
          } catch (e) {
            Alert.alert('Error', e.message ?? 'No se pudo eliminar');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  return (
    <BottomSheetModal
      visible={visible} onClose={onClose}
      title={existing ? 'Editar cancha' : 'Registrar cancha'}
      footer={
        <View style={{ gap: SPACING.sm }}>
          <PressableScale style={styles.btnPrimary} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnPrimaryText}>GUARDAR</Text>}
          </PressableScale>
          {!!existing?.id && (
            <TouchableOpacity onPress={handleDelete} disabled={deleting} style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Text style={styles.deleteLink}>{deleting ? 'Eliminando…' : 'Eliminar esta cancha'}</Text>
            </TouchableOpacity>
          )}
        </View>
      }
    >
      <Field label="Nombre *" value={nombre} onChangeText={setNombre} placeholder="Fredy Sport Center" />
      <Field label="Dirección" value={direccion} onChangeText={setDireccion} placeholder="Calle, distrito, referencia" />
      <Field label="Teléfono" value={telefono} onChangeText={setTelefono} keyboardType="phone-pad" placeholder="6000-0000" />

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, marginBottom: 4 }}>
        <Text style={[styles.formLabel, { flex: 1, marginTop: 0 }]}>Formatos / sub-canchas *</Text>
        <TouchableOpacity onPress={addTarifa}><Text style={styles.addLink}>+ Agregar</Text></TouchableOpacity>
      </View>
      {tarifas.map((t, idx) => (
        <Card key={t._key} style={styles.tarifaCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[styles.formLabel, { flex: 1, marginTop: 0 }]}>Formato {idx + 1}</Text>
            {tarifas.length > 1 && (
              <TouchableOpacity onPress={() => removeTarifa(t._key)}><Text style={styles.removeX}>×</Text></TouchableOpacity>
            )}
          </View>

          <Text style={styles.formLabel}>Deporte</Text>
          <View style={styles.chipWrapRow}>
            {DEPORTES.map((d) => (
              <Chip key={d} label={d} active={t.deporte === d} color={COLORS.neon} onPress={() => updTarifa(t._key, 'deporte', d)} />
            ))}
          </View>

          <Text style={styles.formLabel}>Formato</Text>
          <View style={styles.chipWrapRow}>
            {FORMATOS.map((f) => (
              <Chip key={f} label={`${f}v${f}`} active={t.formato_jpe === f} color={COLORS.neon} onPress={() => updTarifa(t._key, 'formato_jpe', f)} />
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="Precio / hora ($) *" value={t.precio_hora} onChangeText={(v) => updTarifa(t._key, 'precio_hora', v)}
                keyboardType="decimal-pad" placeholder="50.00" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Descripción" value={t.descripcion} onChangeText={(v) => updTarifa(t._key, 'descripcion', v)}
                placeholder="Ej: Canchas 1+2" />
            </View>
          </View>

          <TouchableOpacity style={styles.checkRow} onPress={() => updTarifa(t._key, 'bloqueaActivo', !t.bloqueaActivo)}>
            <View style={[styles.checkbox, t.bloqueaActivo && styles.checkboxActive]}>
              {t.bloqueaActivo && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>¿Bloquea otros formatos al reservar?</Text>
          </TouchableOpacity>

          {t.bloqueaActivo && tarifas.filter((o) => o._key !== t._key).length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={[styles.formLabel, { fontSize: 11 }]}>Quedan bloqueados:</Text>
              <View style={styles.chipWrapRow}>
                {tarifas.filter((o) => o._key !== t._key).map((other) => {
                  const otherKey = other.id ?? other._key;
                  const isSel = (t.bloqueos ?? []).includes(otherKey) || (t.bloqueos ?? []).includes(other._key);
                  return (
                    <Chip key={other._key} label={`${other.deporte ?? 'Formato'} ${other.formato_jpe}v${other.formato_jpe}`}
                      active={isSel} color={COLORS.gold}
                      onPress={() => {
                        const cur = t.bloqueos ?? [];
                        updTarifa(t._key, 'bloqueos', isSel
                          ? cur.filter((k) => k !== otherKey && k !== other._key)
                          : [...cur, otherKey]);
                      }} />
                  );
                })}
              </View>
            </View>
          )}
        </Card>
      ))}

      <Text style={[styles.formLabel, { marginTop: SPACING.md }]}>Días activos</Text>
      <View style={styles.chipWrapRow}>
        {DIAS_LABEL.map((d, i) => (
          <Chip key={i} label={d} active={diasActivos.includes(i)} color={COLORS.blue2} onPress={() => toggleDia(i)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.formLabel}>Apertura</Text>
          <TimeField value={apertura} onChange={setApertura} style={styles.timeInput} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.formLabel}>Cierre</Text>
          <TimeField value={cierre} onChange={setCierre} style={styles.timeInput} />
        </View>
      </View>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchTitle}>Permitir hora y media (+30 min)</Text>
          <Text style={styles.switchSub}>El gestor puede reservar 1.5h además de horas completas. Nunca bloques de 30 min sueltos.</Text>
        </View>
        <Switch value={permiteMediaHoraExtra} onValueChange={setPermiteMediaHoraExtra}
          trackColor={{ false: COLORS.line, true: COLORS.neon }} thumbColor={COLORS.white} />
      </View>

      <Field label="Plazo para pagar el abono tras aprobar (min — 2880 = 48h)" value={holdMinutos} onChangeText={setHoldMinutos}
        keyboardType="number-pad" placeholder="2880" style={{ maxWidth: 100 }} />

      <Text style={[styles.formLabel, { marginTop: SPACING.md }]}>Tipo de abono</Text>
      <View style={styles.chipWrapRow}>
        {[['ninguno', 'Sin abono'], ['porcentaje', 'Porcentaje'], ['fijo', 'Monto fijo'], ['total', 'Pago total']].map(([val, lbl]) => (
          <Chip key={val} label={lbl} active={abonoTipo === val} color={COLORS.gold} onPress={() => setAbonoTipo(val)} />
        ))}
      </View>

      {abonoTipo === 'porcentaje' && (
        <>
          <Text style={styles.formLabel}>Porcentaje</Text>
          <View style={styles.chipWrapRow}>
            {['25', '30', '50', '100'].map((p) => (
              <Chip key={p} label={`${p}%`} active={porcentajeDeposito === p} color={COLORS.gold} onPress={() => setPorcentajeDeposito(p)} />
            ))}
          </View>
        </>
      )}

      {abonoTipo === 'fijo' && (
        <Field label="Monto fijo de abono ($)" value={abonoMontoFijo} onChangeText={setAbonoMontoFijo} keyboardType="decimal-pad" placeholder="10.00" />
      )}

      {abonoTipo !== 'ninguno' && (
        <Text style={styles.hintText}>
          {abonoTipo === 'total' ? 'El gestor paga el 100% al reservar.'
            : abonoTipo === 'fijo' ? `El gestor paga $${abonoMontoFijo || '?'} al reservar. El saldo lo paga por la app o en la cancha.`
            : `El gestor paga el ${porcentajeDeposito}% al reservar. El saldo lo paga por la app o en la cancha.`}
        </Text>
      )}
    </BottomSheetModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Estilos
// ═══════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  refreshIcon: { fontSize: 22, color: COLORS.neon, fontFamily: FONTS.bodyBold },

  canchaChipsRow: { paddingHorizontal: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.sm },

  statsRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.md, marginTop: SPACING.sm },
  statTile: { flex: 1, alignItems: 'flex-start', minHeight: 76 },
  statValue: { fontFamily: FONTS.heading, fontSize: TYPE.h2, color: COLORS.white, letterSpacing: 0.5 },
  statLabel: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, marginTop: 2 },

  section: { paddingHorizontal: SPACING.md, marginTop: SPACING.lg },
  sectionTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.gray2, letterSpacing: 1.2, marginBottom: SPACING.sm },

  solicitudCard: { borderColor: COLORS.gold, borderWidth: 1, marginBottom: SPACING.sm },
  solicitudNombre: { fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white },
  solicitudSub: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, marginTop: 1 },
  solicitudBadge: { backgroundColor: withAlpha(COLORS.gold, '22'), borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  solicitudBadgeText: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gold, letterSpacing: 0.5 },
  solicitudFecha: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.body, color: COLORS.white, marginTop: SPACING.sm },
  solicitudMonto: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, marginTop: 2 },
  solicitudCombo: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, marginTop: 2 },

  holdCard: { opacity: 0.6, borderColor: COLORS.line },
  holdNombre: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.body, color: COLORS.gray2 },
  holdBadge: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.gray, letterSpacing: 0.5 },
  holdSub: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray, marginTop: 2 },

  btnPrimary: { backgroundColor: COLORS.neon, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnPrimaryText: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.bg, letterSpacing: 0.5 },
  btnGold: { backgroundColor: COLORS.gold, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnGoldText: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.bg, letterSpacing: 0.5 },
  btnDangerOutline: { borderWidth: 1, borderColor: COLORS.red2, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnDangerOutlineText: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.red2, letterSpacing: 0.5 },
  btnDanger: { backgroundColor: COLORS.red2, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnDangerText: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.white, letterSpacing: 0.5 },
  btnGhost: { backgroundColor: COLORS.card2, borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnGhostText: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.gray2 },
  btnWhatsapp: { backgroundColor: '#25D366', borderRadius: RADIUS.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  btnWhatsappText: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: '#fff', letterSpacing: 0.5 },

  dateStripRow: { gap: SPACING.xs, paddingBottom: SPACING.sm },
  dateChip: { width: 56, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', backgroundColor: COLORS.card },
  dateChipActive: { borderColor: COLORS.neon, backgroundColor: COLORS.neon },
  dateChipDow: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, textTransform: 'uppercase' },
  dateChipDia: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  dateChipMes: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray },
  dateChipTextActive: { color: COLORS.bg },
  dateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.gold, marginTop: 3 },

  block: { borderRadius: RADIUS.md, borderWidth: 1, padding: SPACING.sm, justifyContent: 'center' },
  blockDashed: { borderStyle: 'dashed' },
  blockTime: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small },
  blockBadge: { fontFamily: FONTS.bodyBold, fontSize: 10, letterSpacing: 0.5, flexShrink: 1, textAlign: 'right' },
  blockTitle: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.body, color: COLORS.white, marginTop: 2 },
  blockSub: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray2, marginTop: 1 },

  freeRow: {
    borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.line,
    justifyContent: 'center', paddingHorizontal: SPACING.sm,
  },
  freeRowText: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray },

  emptyTimelineText: { fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray, textAlign: 'center', marginTop: SPACING.lg, marginBottom: SPACING.sm },

  detailBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 4, marginBottom: SPACING.sm },
  detailBadgeText: { fontFamily: FONTS.bodyBold, fontSize: 11, letterSpacing: 0.5 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  detailLabel: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray },
  detailValue: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.white, flexShrink: 1, textAlign: 'right', marginLeft: SPACING.sm },

  configRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  configRowTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white },
  configRowSub: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, marginTop: 2 },
  configRowArrow: { fontSize: 20, color: COLORS.gold },
  addLink: { fontFamily: FONTS.bodyBold, fontSize: TYPE.small, color: COLORS.gold },

  formLabel: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.caption, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 1, marginTop: SPACING.sm, marginBottom: 6 },
  chipWrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: SPACING.sm },
  tarifaCard: { marginBottom: SPACING.sm },
  removeX: { fontFamily: FONTS.bodyBold, color: COLORS.red2, fontSize: 20, lineHeight: 22 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: withAlpha(COLORS.gold, '33'), borderColor: COLORS.gold },
  checkboxMark: { color: COLORS.gold, fontSize: 14, lineHeight: 16 },
  checkLabel: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2 },

  timeInput: {
    backgroundColor: COLORS.bg2, color: COLORS.white, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md, fontFamily: FONTS.body, fontSize: TYPE.body, borderWidth: 1, borderColor: COLORS.line, width: '100%',
  },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md, paddingVertical: SPACING.sm },
  switchTitle: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.body, color: COLORS.white },
  switchSub: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, marginTop: 2 },

  hintText: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, marginTop: 4, marginBottom: SPACING.sm },
  deleteLink: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.red2 },

  liquidacionAmount: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.neon, letterSpacing: 0.5 },
  liquidacionLabel: { fontFamily: FONTS.bodySemiBold, fontSize: TYPE.small, color: COLORS.white, marginTop: 4 },
  liquidacionNote: { fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray, marginTop: 2 },

  emptyTitle: { fontFamily: FONTS.bodyBold, fontSize: TYPE.h3, color: COLORS.white, textAlign: 'center' },
  emptySub: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, textAlign: 'center' },
});
