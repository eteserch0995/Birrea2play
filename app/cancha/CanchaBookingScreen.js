import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, ActivityIndicator, Alert, SafeAreaView, Platform, Linking,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useAuthStore from '../../store/authStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../lib/yappy';
import { iniciarPagoTarjeta } from '../../lib/paguelofacil';

const YAPPY_FEE = 0.25;

// ── utils ──────────────────────────────────────────────────────────────────
function todayIso() { return new Date().toISOString().split('T')[0]; }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay(); // 0=Dom, 1=Lun ... 6=Sáb
}

function formatDateChip(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const mes = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return { dia: d.getDate(), mes: mes[d.getMonth()], dow: dow[d.getDay()] };
}

function formatDateLong(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const dow = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const mes = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${dow[d.getDay()]} ${d.getDate()} ${mes[d.getMonth()]}`;
}

function fmt12(hora) {
  const [h, m] = hora.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

function pad2(n) { return n.toString().padStart(2, '0'); }

function openWhatsApp(telefono, mensaje) {
  const digits = (telefono ?? '').replace(/\D/g, '');
  const num = digits.startsWith('507') ? digits : '507' + digits;
  const url = `https://wa.me/${num}?text=${encodeURIComponent(mensaje)}`;
  Linking.openURL(url).catch(() => Alert.alert('WhatsApp', 'No se pudo abrir WhatsApp.'));
}

// Genera todos los time-blocks dentro de un horario
function generarSlots(horario, tarifa) {
  const [ah, am] = horario.hora_apertura.split(':').map(Number);
  const [ch, cm] = horario.hora_cierre.split(':').map(Number);
  // Horario libre → bloques de 30 min para que el usuario elija el rango
  const dur = horario.horario_libre ? 30 : (horario.duracion_slot_min ?? 60);
  const closeMin = ch * 60 + cm;
  const slots = [];
  let cur = ah * 60 + am;
  while (cur + dur <= closeMin) {
    const fh = Math.floor((cur + dur) / 60);
    const fm = (cur + dur) % 60;
    slots.push({
      _vid: `${horario.cancha_id}_${tarifa?.id ?? 'null'}_${pad2(Math.floor(cur/60))}:${pad2(cur%60)}`,
      cancha_id:   horario.cancha_id,
      tarifa_id:   tarifa?.id ?? null,
      hora_inicio: `${pad2(Math.floor(cur/60))}:${pad2(cur % 60)}`,
      hora_fin:    `${pad2(fh)}:${pad2(fm)}`,
      precio_hora: tarifa?.precio_hora ?? 0,
      duracion_min:  dur,
      horario_libre: horario.horario_libre ?? false,
      cancha:        horario.cancha,
      tarifa,
    });
    cur += dur;
  }
  return slots;
}

// ── pantalla principal ─────────────────────────────────────────────────────
export default function CanchaBookingScreen({ navigation }) {
  const user = useAuthStore((s) => s.user);

  const [selectedDate,    setSelectedDate]    = useState(todayIso());
  const [selectedDeporte, setSelectedDeporte] = useState(null);
  const [selectedHora,    setSelectedHora]    = useState(null);
  const [selectedSlot,    setSelectedSlot]    = useState(null);
  const [selectedDuracion,setSelectedDuracion]= useState(null); // null = usa slot.duracion_min
  const [step,            setStep]            = useState(1);
  const [yappyEspera,       setYappyEspera]       = useState(false);
  const [tarjetaOrdenEspera,setTarjetaOrdenEspera]= useState(null);
  const [reservaCreada,     setReservaCreada]     = useState(null);  // resultado del RPC crear_cancha_reserva
  const [metodoPago,        setMetodoPago]        = useState('yappy');

  // Data
  const [virtualSlots, setVirtualSlots] = useState([]); // todos los slots generados del día
  const [loading,      setLoading]      = useState(false);
  const [submitting,   setSubmitting]   = useState(false);

  const dates = useMemo(() => {
    const today = todayIso();
    return Array.from({ length: 14 }, (_, i) => addDays(today, i));
  }, []);

  // Cargar horarios del día seleccionado y generar slots virtuales
  const fetchDisponibilidad = useCallback(async () => {
    setLoading(true);
    setSelectedHora(null);
    setSelectedSlot(null);
    try {
      const dow = dayOfWeek(selectedDate);

      // 1. Horarios de operación para el dia_semana
      const { data: horarios, error: hErr } = await supabase
        .from('cancha_horarios')
        .select(`
          id, cancha_id, tarifa_id, hora_apertura, hora_cierre, duracion_slot_min, horario_libre,
          cancha:cancha_id ( id, nombre, direccion, telefono,
            requiere_deposito, porcentaje_deposito,
            abono_tipo, abono_monto_fijo, duracion_min_minutos, duracion_max_minutos, hold_minutos )
        `)
        .eq('dia_semana', dow)
        .eq('activo', true);
      if (hErr) throw hErr;

      if (!horarios?.length) { setVirtualSlots([]); return; }

      // 2. Tarifas de las canchas con horarios globales (tarifa_id IS NULL)
      const canchaIds = [...new Set(horarios.map((h) => h.cancha_id))];
      const { data: tarifas } = await supabase
        .from('cancha_tarifas')
        .select('id, cancha_id, deporte, formato_jpe, descripcion, precio_hora')
        .in('cancha_id', canchaIds)
        .eq('activo', true);

      // 3. Reservas activas + bloqueos externos directos para la fecha
      const [{ data: reservas }, { data: bloqueos }] = await Promise.all([
        supabase
          .from('cancha_reservas')
          .select(`cancha_id, tarifa_id, hora_inicio, hora_fin, status, expira_en,
                   tarifa:tarifa_id ( bloquea_tarifas )`)
          .eq('fecha', selectedDate)
          .in('status', ['pending', 'approved']),
        supabase
          .from('cancha_bloqueos_externos')
          .select('cancha_id, hora_inicio, hora_fin')
          .eq('fecha', selectedDate)
          .is('recurrencia_id', null)
          .eq('activo', true),
      ]);

      const now = Date.now();
      const bookedSet = new Set();

      // Reservas internas (excluir pending con hold vencido)
      (reservas ?? []).forEach((r) => {
        if (r.status === 'pending' && r.expira_en && new Date(r.expira_en).getTime() < now) return;
        const [sh, sm] = r.hora_inicio.slice(0, 5).split(':').map(Number);
        const [eh, em] = (r.hora_fin ?? r.hora_inicio).slice(0, 5).split(':').map(Number);
        let cur = sh * 60 + sm;
        const endMin = eh * 60 + em || cur + 30;
        do {
          const hh = pad2(Math.floor(cur / 60));
          const mm = pad2(cur % 60);
          bookedSet.add(`${r.cancha_id}_${r.tarifa_id ?? 'null'}_${hh}:${mm}`);
          (r.tarifa?.bloquea_tarifas ?? []).forEach((blockedId) => {
            bookedSet.add(`${r.cancha_id}_${blockedId}_${hh}:${mm}`);
          });
          cur += 30;
        } while (cur < endMin);
      });

      // Bloqueos externos de fecha directa — bloquean todos los formatos de esa cancha
      const tarifasPorCancha = {};
      (tarifas ?? []).forEach((t) => {
        (tarifasPorCancha[t.cancha_id] = tarifasPorCancha[t.cancha_id] ?? []).push(t.id);
      });

      (bloqueos ?? []).forEach((b) => {
        const [sh, sm] = b.hora_inicio.slice(0, 5).split(':').map(Number);
        const [eh, em] = b.hora_fin.slice(0, 5).split(':').map(Number);
        let cur = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const ids = tarifasPorCancha[b.cancha_id] ?? [];
        while (cur < endMin) {
          const hh = pad2(Math.floor(cur / 60));
          const mm = pad2(cur % 60);
          bookedSet.add(`${b.cancha_id}_null_${hh}:${mm}`);
          ids.forEach((tid) => bookedSet.add(`${b.cancha_id}_${tid}_${hh}:${mm}`));
          cur += 30;
        }
      });

      // 4. Generar slots virtuales
      const allSlots = [];
      for (const h of horarios) {
        if (h.tarifa_id) {
          // horario específico para una tarifa
          const tarifa = (tarifas ?? []).find((t) => t.id === h.tarifa_id) ?? null;
          generarSlots(h, tarifa).forEach((s) => {
            if (!bookedSet.has(`${s.cancha_id}_${s.tarifa_id ?? 'null'}_${s.hora_inicio}`)) allSlots.push(s);
          });
        } else {
          // horario global: aplica a TODAS las tarifas de esa cancha
          const canchaT = (tarifas ?? []).filter((t) => t.cancha_id === h.cancha_id);
          for (const tarifa of canchaT) {
            generarSlots(h, tarifa).forEach((s) => {
              if (!bookedSet.has(`${s.cancha_id}_${s.tarifa_id ?? 'null'}_${s.hora_inicio}`)) allSlots.push(s);
            });
          }
        }
      }

      setVirtualSlots(allSlots);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo cargar disponibilidad');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { fetchDisponibilidad(); }, [fetchDisponibilidad]);

  // Deportes únicos disponibles
  const deportes = useMemo(() => {
    const set = new Set(virtualSlots.map((s) => s.tarifa?.deporte).filter(Boolean));
    return [...set].sort();
  }, [virtualSlots]);

  // Filtrar por deporte
  const filteredSlots = useMemo(() =>
    selectedDeporte ? virtualSlots.filter((s) => s.tarifa?.deporte === selectedDeporte) : virtualSlots,
    [virtualSlots, selectedDeporte]);

  // Agrupar por hora_inicio
  const slotsByHora = useMemo(() => {
    const map = {};
    filteredSlots.forEach((s) => { (map[s.hora_inicio] = map[s.hora_inicio] ?? []).push(s); });
    return map;
  }, [filteredSlots]);

  const horasAM = useMemo(() => Object.keys(slotsByHora).filter((h) => parseInt(h) < 12).sort(), [slotsByHora]);
  const horasPM = useMemo(() => Object.keys(slotsByHora).filter((h) => parseInt(h) >= 12).sort(), [slotsByHora]);
  const slotsPista = useMemo(() => selectedHora ? (slotsByHora[selectedHora] ?? []) : [], [selectedHora, slotsByHora]);

  // Set de _vids disponibles (para verificar bloques consecutivos en medias horas)
  const availableVids = useMemo(() => new Set(virtualSlots.map((s) => s._vid)), [virtualSlots]);

  // En horario libre, durActiva = null hasta que el usuario elija hora fin
  const durActiva = selectedSlot?.horario_libre
    ? selectedDuracion                          // null = aún no eligió
    : (selectedDuracion ?? selectedSlot?.duracion_min ?? 60);

  const monto = useMemo(() => {
    if (!selectedSlot) return 0;
    return Number(selectedSlot.precio_hora ?? 0) * (durActiva / 60);
  }, [selectedSlot, durActiva]);

  const deposito = useMemo(() => {
    const c = selectedSlot?.cancha;
    if (!c || !monto) return 0;
    // abono_tipo sobrescribe el bool legacy requiere_deposito
    const tipo = c.abono_tipo ?? (c.requiere_deposito ? 'porcentaje' : 'ninguno');
    switch (tipo) {
      case 'ninguno':    return 0;
      case 'fijo':       return Number(c.abono_monto_fijo ?? 0);
      case 'total':      return monto;
      case 'porcentaje':
      default:           return monto * ((c.porcentaje_deposito ?? 50) / 100);
    }
  }, [selectedSlot, monto]);

  // ── Helper: crea la reserva en servidor y retorna el record ──────────────
  async function crearReservaRPC() {
    const [h, m] = selectedSlot.hora_inicio.split(':').map(Number);
    const finMin  = h * 60 + m + durActiva;
    const hora_fin = `${pad2(Math.floor(finMin / 60))}:${pad2(finMin % 60)}:00`;
    const { data, error } = await supabase.rpc('crear_cancha_reserva', {
      p_cancha_id:   selectedSlot.cancha_id,
      p_tarifa_id:   selectedSlot.tarifa_id,
      p_gestor_id:   user.id,
      p_fecha:       selectedDate,
      p_hora_inicio: selectedSlot.hora_inicio + ':00',
      p_hora_fin:    hora_fin,
      p_precio_hora: selectedSlot.precio_hora,
    });
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Reserva no creada');
    return data[0]; // { id, codigo_reserva, status, estado_pago, expira_en, monto_total, abono_requerido }
  }

  // ── Pago con Yappy ────────────────────────────────────────────────────────
  async function handleYappyPago({ phone }) {
    if (!selectedSlot || !user?.id) return;
    setSubmitting(true);
    let reserva = null;
    try {
      reserva = await crearReservaRPC();
      setReservaCreada(reserva);

      const montoYappy = Number((reserva.abono_requerido + YAPPY_FEE).toFixed(2));
      const { orderId } = await iniciarBotonYappy({
        phone,
        amount:            montoYappy,
        tipo:              'abono_cancha',
        cancha_reserva_id: reserva.id,
      });

      setYappyEspera(true);
      const { promise } = pollBotonOrder({ orderId });
      await promise;

      setYappyEspera(false);
      setStep(3);
    } catch (e) {
      if (e.message === 'cancelled') { setYappyEspera(false); setSubmitting(false); return; }
      if (reserva?.id) await supabase.from('cancha_reservas').update({ status: 'cancelled', cancelada_por: 'sistema' }).eq('id', reserva.id);
      Alert.alert('Error', e.message ?? 'No se pudo procesar el pago');
    } finally {
      setYappyEspera(false);
      setSubmitting(false);
    }
  }

  // ── Pago con Wallet ───────────────────────────────────────────────────────
  async function handleWalletPago() {
    if (!selectedSlot || !user?.id) return;
    setSubmitting(true);
    let reserva = null;
    try {
      reserva = await crearReservaRPC();
      setReservaCreada(reserva);

      if (reserva.abono_requerido > 0) {
        if ((user?.wallet_balance ?? 0) < reserva.abono_requerido) {
          throw new Error(`Saldo insuficiente. Necesitás $${reserva.abono_requerido.toFixed(2)}.`);
        }
        const { error: wErr } = await supabase.rpc('confirmar_abono_cancha_wallet', {
          p_reserva_id:      reserva.id,
          p_gestor_id:       user.id,
          p_abono_requerido: reserva.abono_requerido,
        });
        if (wErr) throw new Error(wErr.message);
      }
      setStep(3);
    } catch (e) {
      if (reserva?.id && reserva.estado_pago !== 'pagado')
        await supabase.from('cancha_reservas').update({ status: 'cancelled', cancelada_por: 'sistema' }).eq('id', reserva.id);
      Alert.alert('Error', e.message ?? 'No se pudo procesar el pago');
    } finally { setSubmitting(false); }
  }

  // ── Pago con Tarjeta ──────────────────────────────────────────────────────
  async function handleTarjetaPago() {
    if (!selectedSlot || !user?.id) return;
    setSubmitting(true);
    let reserva = null;
    try {
      reserva = await crearReservaRPC();
      setReservaCreada(reserva);

      const montoCard = Number((reserva.abono_requerido + YAPPY_FEE).toFixed(2));
      await iniciarPagoTarjeta({
        userId:            user.id,
        amount:            montoCard,
        descripcion:       `Abono cancha ${selectedSlot.cancha?.nombre} ${selectedDate}`,
        tipo:              'abono_cancha',
        cancha_reserva_id: reserva.id,
      });
      setTarjetaOrdenEspera(reserva.id);
    } catch (e) {
      if (reserva?.id) await supabase.from('cancha_reservas').update({ status: 'cancelled', cancelada_por: 'sistema' }).eq('id', reserva.id);
      Alert.alert('Error', e.message ?? 'No se pudo abrir el pago');
    } finally { setSubmitting(false); }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (step === 3 && reservaCreada) {
    return (
      <ConfirmacionView
        reserva={reservaCreada}
        slot={selectedSlot}
        selectedDate={selectedDate}
        duracion={durActiva}
        onDone={() => navigation.goBack()}
      />
    );
  }

  if (step === 2 && selectedSlot) {
    return (
      <ConfirmStep
        slot={selectedSlot} selectedDate={selectedDate} monto={monto} deposito={deposito}
        duracion={durActiva}
        metodoPago={metodoPago} setMetodoPago={setMetodoPago}
        user={user} submitting={submitting} yappyEspera={yappyEspera}
        tarjetaOrdenEspera={tarjetaOrdenEspera} setTarjetaOrdenEspera={setTarjetaOrdenEspera}
        onBack={() => setStep(1)}
        onConfirmWallet={handleWalletPago}
        onConfirmYappy={handleYappyPago}
        onConfirmTarjeta={handleTarjetaPago}
        onTarjetaPaid={() => setStep(3)}
      />
    );
  }

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Reservar cancha</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Deporte */}
        {deportes.length > 0 && (
          <>
            <Text style={s.sectionLabel}>Deporte</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.sm }}>
              <View style={s.chipRow}>
                <TouchableOpacity style={[s.chip, !selectedDeporte && s.chipActive]} onPress={() => setSelectedDeporte(null)}>
                  <Text style={[s.chipText, !selectedDeporte && s.chipTextActive]}>Todos</Text>
                </TouchableOpacity>
                {deportes.map((d) => (
                  <TouchableOpacity key={d} style={[s.chip, selectedDeporte === d && s.chipActive]} onPress={() => setSelectedDeporte(d)}>
                    <Text style={[s.chipText, selectedDeporte === d && s.chipTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}

        {/* Fecha */}
        <Text style={s.sectionLabel}>Fecha</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.sm }}>
          <View style={s.chipRow}>
            {dates.map((d) => {
              const { dia, mes, dow } = formatDateChip(d);
              const active = d === selectedDate;
              return (
                <TouchableOpacity key={d} style={[s.dateChip, active && s.dateChipActive]} onPress={() => setSelectedDate(d)}>
                  <Text style={[s.dateMes, active && s.dateMesActive]}>{mes}</Text>
                  <Text style={[s.dateDia, active && s.dateDiaActive]}>{dia}</Text>
                  <Text style={[s.dateDow, active && s.dateDowActive]}>{dow}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* Horarios */}
        <Text style={s.sectionLabel}>Horarios disponibles</Text>
        <Text style={[s.subText, { marginBottom: SPACING.sm }]}>
          El número entre paréntesis indica las pistas disponibles.
        </Text>

        {loading ? (
          <ActivityIndicator color={COLORS.red} style={{ marginTop: 24 }} />
        ) : filteredSlots.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>Sin disponibilidad</Text>
            <Text style={[s.subText, { textAlign: 'center', marginTop: 4 }]}>
              No hay canchas operando este día con el filtro seleccionado.
            </Text>
          </View>
        ) : (
          <>
            {horasAM.length > 0 && (
              <>
                <Text style={s.ampm}>AM</Text>
                <TimeGrid horas={horasAM} slotsByHora={slotsByHora} selectedHora={selectedHora} onSelect={setSelectedHora} />
              </>
            )}
            {horasPM.length > 0 && (
              <>
                <Text style={s.ampm}>PM</Text>
                <TimeGrid horas={horasPM} slotsByHora={slotsByHora} selectedHora={selectedHora} onSelect={setSelectedHora} />
              </>
            )}
          </>
        )}

        {/* Pistas disponibles a la hora seleccionada */}
        {selectedHora && slotsPista.length > 0 && (
          <>
            <Text style={s.pistaHeader}>
              {formatDateLong(selectedDate)} · {slotsPista.length} pista{slotsPista.length !== 1 ? 's' : ''}
            </Text>
            <View style={s.pistaGrid}>
              {slotsPista.map((slot) => {
                const active = selectedSlot?._vid === slot._vid;
                const total  = Number(slot.precio_hora ?? 0) * (Math.max(slot.duracion_min ?? 60, 60) / 60);
                return (
                  <TouchableOpacity key={slot._vid}
                    style={[s.pistaCard, active && s.pistaCardActive]}
                    onPress={() => {
                      if (active) { setSelectedSlot(null); setSelectedDuracion(null); }
                      else {
                        setSelectedSlot(slot);
                        // Horario libre: esperar que el usuario elija rango → no pre-setear duración
                        setSelectedDuracion(slot.horario_libre ? null : Math.max(slot.duracion_min ?? 60, 60));
                      }
                    }}
                  >
                    <Text style={[s.pistaTime,    active && s.pistaTimeActive]}>{fmt12(slot.hora_inicio)}</Text>
                    <Text style={[s.pistaMonto,   active && s.pistaMontoActive]}>${total.toFixed(0)}</Text>
                    <Text style={[s.pistaDeporte, active && s.pistaDeporteActive]}>
                      {slot.tarifa?.deporte ?? '—'}
                    </Text>
                    <Text style={[s.pistaFormato, active && s.pistaFormatoActive]}>
                      {slot.tarifa ? `${slot.tarifa.formato_jpe}v${slot.tarifa.formato_jpe}` : ''}
                    </Text>
                    <Text style={[s.pistaNombre, active && s.pistaNombreActive]} numberOfLines={1}>
                      {slot.cancha?.nombre ?? ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* Selector de hora fin — solo cuando la cancha tiene Horario Libre activado */}
        {selectedSlot?.horario_libre === true && (() => {
          const [sh, sm] = selectedSlot.hora_inicio.split(':').map(Number);
          // Encontrar la hora de cierre de este horario (avanzar hasta que no haya slot disponible)
          const opciones = [];
          let cur = sh * 60 + sm + 60; // mínimo 1 hora
          let allAvailable = true;
          while (allAvailable && cur <= (sh * 60 + sm) + 360) { // máx 6 horas
            const vid = `${selectedSlot.cancha_id}_${selectedSlot.tarifa_id ?? 'null'}_${pad2(Math.floor(cur/60))}:${pad2(cur%60)}`;
            // El primer slot extra debe existir para que esta opción sea válida
            if (cur > sh * 60 + sm + 30 && !availableVids.has(`${selectedSlot.cancha_id}_${selectedSlot.tarifa_id ?? 'null'}_${pad2(Math.floor((cur-30)/60))}:${pad2((cur-30)%60)}`)) {
              allAvailable = false; break;
            }
            const durEsta = cur - (sh * 60 + sm);
            opciones.push({ horaFin: `${pad2(Math.floor(cur/60))}:${pad2(cur%60)}`, dur: durEsta });
            cur += 30;
            // Verificar si el PRÓXIMO bloque está disponible para continuar ofreciendo opciones
            const nextVid = `${selectedSlot.cancha_id}_${selectedSlot.tarifa_id ?? 'null'}_${pad2(Math.floor(cur/60))}:${pad2(cur%60)}`;
            if (!availableVids.has(vid) && cur > sh * 60 + sm + 30) { allAvailable = false; }
          }
          if (opciones.length === 0) return null;
          return (
            <View style={{ marginTop: SPACING.md }}>
              <Text style={s.sectionLabel}>¿Hasta qué hora?</Text>
              <View style={s.timeGrid}>
                {opciones.map(({ horaFin, dur }) => {
                  const active = durActiva === dur;
                  const label  = dur < 60 ? '30min' : dur % 60 === 0 ? `${dur/60}h` : `${Math.floor(dur/60)}h 30`;
                  return (
                    <TouchableOpacity key={horaFin}
                      style={[s.timeChip, active && s.timeChipActive]}
                      onPress={() => setSelectedDuracion(dur)}
                    >
                      <Text style={[s.timeText, active && s.timeTextActive]}>{fmt12(horaFin)}</Text>
                      <Text style={[{ fontSize: 10, color: active ? COLORS.neon : COLORS.gray, fontFamily: FONTS.body ?? FONTS.bodyBold, textAlign: 'center' }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })()}

        <View style={{ height: 100 }} />
      </ScrollView>

      {selectedSlot && (!selectedSlot.horario_libre || durActiva) && (
        <View style={s.bottomBar}>
          <View>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalMonto}>${monto.toFixed(2)}</Text>
            {deposito > 0 && <Text style={s.depositoLabel}>Abono: ${deposito.toFixed(2)}</Text>}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {!!selectedSlot.cancha?.telefono && (
              <TouchableOpacity
                style={[s.reservarBtn, { backgroundColor: '#25D366', paddingHorizontal: 14 }]}
                onPress={() => {
                  const msg = `Hola, soy gestor de Birrea2Play. Quisiera consultar disponibilidad de *${selectedSlot.cancha.nombre}* para el *${formatDateLong(selectedDate)}* a las *${fmt12(selectedSlot.hora_inicio)}*.`;
                  openWhatsApp(selectedSlot.cancha.telefono, msg);
                }}
              >
                <Text style={s.reservarBtnText}>💬</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.reservarBtn} onPress={() => setStep(2)}>
              <Text style={s.reservarBtnText}>Solicitar →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Grilla de horarios ────────────────────────────────────────────────────
function TimeGrid({ horas, slotsByHora, selectedHora, onSelect }) {
  return (
    <View style={s.timeGrid}>
      {horas.map((h) => {
        const count  = (slotsByHora[h] ?? []).length;
        const active = selectedHora === h;
        return (
          <TouchableOpacity key={h} style={[s.timeChip, active && s.timeChipActive]}
            onPress={() => onSelect(active ? null : h)}>
            <Text style={[s.timeText, active && s.timeTextActive]}>{fmt12(h)} ({count})</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Confirmación ──────────────────────────────────────────────────────────
function ConfirmStep({ slot, selectedDate, monto, deposito, duracion, metodoPago, setMetodoPago,
  user, submitting, yappyEspera,
  tarjetaOrdenEspera, setTarjetaOrdenEspera,
  onBack, onConfirmWallet, onConfirmYappy, onConfirmTarjeta, onTarjetaPaid }) {
  const cancha  = slot.cancha ?? {};
  const tarifa  = slot.tarifa ?? {};
  const dur     = duracion ?? slot.duracion_min ?? 60;
  const [phone, setPhone]             = useState('');
  const [verificando, setVerificando] = useState(false);
  // abono_tipo: 'ninguno' | 'fijo' | 'porcentaje' | 'total' (o fallback al bool legacy)
  const requiereAbono = deposito > 0;
  const [fh, fm] = (() => {
    const [h, m] = slot.hora_inicio.split(':').map(Number);
    const fin = h * 60 + m + dur;
    return [Math.floor(fin / 60), fin % 60];
  })();
  const horaFin = `${fh % 12 || 12}:${fm.toString().padStart(2, '0')}${fh >= 12 ? 'pm' : 'am'}`;

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}><Text style={s.backText}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Confirmar solicitud</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.summaryCard}>
          <Row label="Cancha"    value={cancha.nombre ?? '—'} />
          {!!cancha.direccion && <Row label="Ubicación" value={cancha.direccion} />}
          <Row label="Fecha"     value={formatDateLong(selectedDate)} />
          <Row label="Hora"      value={`${fmt12(slot.hora_inicio)} – ${horaFin}`} />
          <Row label="Deporte"   value={tarifa.deporte ? `${tarifa.deporte} ${tarifa.formato_jpe}v${tarifa.formato_jpe}` : '—'} />
          <Row label="Duración"  value={dur === 60 ? '1 hora' : dur === 90 ? '1.5 horas' : '2 horas'} />
        </View>

        <View style={s.summaryCard}>
          <Text style={s.cardTitle}>Información del pago</Text>
          <View style={s.payRow}>
            <Text style={s.payLabel}>{tarifa.deporte ?? 'Cancha'} · {dur === 60 ? '1h' : dur === 90 ? '1.5h' : '2h'}</Text>
            <Text style={s.payMonto}>${monto.toFixed(2)}</Text>
          </View>
          <View style={[s.payRow, { borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 6, paddingTop: 8 }]}>
            <Text style={[s.payLabel, { color: COLORS.white }]}>Total</Text>
            <Text style={[s.payMonto, { color: COLORS.white, fontFamily: FONTS.bodyBold }]}>${monto.toFixed(2)}</Text>
          </View>
        </View>

        {!!cancha.telefono && (
          <TouchableOpacity
            style={[s.summaryCard, { flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: '#25D366' }]}
            onPress={() => {
              const dur = slot.duracion_min ?? 60;
              const msg = `Hola, soy gestor de Birrea2Play. Quiero reservar *${cancha.nombre}* el *${formatDateLong(selectedDate)}* de *${fmt12(slot.hora_inicio)}* a *${horaFin}* (${tarifa.deporte ?? 'cancha'} ${tarifa.formato_jpe ? tarifa.formato_jpe + 'v' + tarifa.formato_jpe : ''}). ¿Está disponible?`;
              openWhatsApp(cancha.telefono, msg);
            }}
          >
            <Text style={{ fontSize: 28 }}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: '#25D366', marginBottom: 2 }]}>Contactar por WhatsApp</Text>
              <Text style={s.subText}>{cancha.telefono}</Text>
            </View>
            <Text style={{ color: '#25D366', fontSize: 18 }}>→</Text>
          </TouchableOpacity>
        )}

        {requiereAbono ? (
          <View style={[s.summaryCard, { borderColor: COLORS.gold }]}>
            <Text style={[s.cardTitle, { color: COLORS.gold }]}>Abono requerido: ${deposito.toFixed(2)}</Text>
            <Text style={s.subText}>
              {cancha.abono_tipo === 'fijo'
                ? `Abono fijo de $${deposito.toFixed(2)} para confirmar el espacio.`
                : cancha.abono_tipo === 'total'
                  ? 'Esta cancha requiere pago completo por adelantado.'
                  : `Esta cancha requiere un abono del ${cancha.porcentaje_deposito ?? 50}% para confirmar el espacio.`}
            </Text>
            <View style={[s.payRow, { marginTop: 6 }]}>
              <Text style={s.payLabel}>Saldo pendiente al llegar</Text>
              <Text style={[s.payMonto, { color: COLORS.white }]}>${(monto - deposito).toFixed(2)}</Text>
            </View>
          </View>
        ) : (
          <View style={[s.summaryCard, { borderColor: COLORS.neon }]}>
            <Text style={[s.cardTitle, { color: COLORS.neon }]}>Sin abono requerido</Text>
            <Text style={s.subText}>
              El espacio queda reservado mientras la cancha aprueba tu solicitud.
            </Text>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Sección de pago */}
      {requiereAbono ? (
        <>
          {/* Estado de espera cuando el usuario fue al browser de tarjeta */}
          {tarjetaOrdenEspera ? (
            <View style={[s.bottomBar, { flexDirection: 'column', gap: 10, paddingTop: 12, alignItems: 'stretch' }]}>
              <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, textAlign: 'center' }}>
                Completá el pago en el browser
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center' }}>
                Cuando pagues, volvé aquí y tocá "Ya pagué"
              </Text>
              <TouchableOpacity
                style={[s.reservarBtn, { alignSelf: 'stretch', backgroundColor: COLORS.neon ?? '#39FF14' }, verificando && { opacity: 0.6 }]}
                disabled={verificando}
                onPress={async () => {
                  setVerificando(true);
                  const { data } = await supabase.from('cancha_reservas')
                    .select('estado_pago, deposito_yappy_pagado')
                    .eq('id', tarjetaOrdenEspera).maybeSingle();
                  setVerificando(false);
                  if (data?.estado_pago === 'pagado' || data?.deposito_yappy_pagado) {
                    setTarjetaOrdenEspera(null);
                    onTarjetaPaid();
                  } else {
                    Alert.alert('Pago aún no detectado', 'Asegurate de haber completado el pago en el browser. Intentá de nuevo en unos segundos.');
                  }
                }}
              >
                {verificando ? <ActivityIndicator color={COLORS.bg ?? '#0d0d0d'} /> : <Text style={[s.reservarBtnText, { color: COLORS.bg ?? '#0d0d0d' }]}>Ya pagué ✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTarjetaOrdenEspera(null)}>
                <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center' }}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[s.bottomBar, { flexDirection: 'column', gap: 8, paddingTop: 12, alignItems: 'stretch' }]}>
              {/* Tabs de método */}
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[['yappy','📱 Yappy'],['tarjeta','💳 Tarjeta'],['wallet','💰 Wallet']].map(([m,l]) => (
                  <TouchableOpacity key={m} style={[s.chip, metodoPago === m && s.chipActive, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}
                    onPress={() => setMetodoPago(m)}>
                    <Text style={[s.chipText, metodoPago === m && s.chipTextActive, { fontSize: 12 }]}>{l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {metodoPago === 'yappy' && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontSize: 18 }}>📱</Text>
                    <TextInput style={s.phoneInput} placeholder="Número Yappy (ej: 6123-4567)"
                      placeholderTextColor={COLORS.gray} value={phone}
                      onChangeText={(v) => setPhone(v.replace(/[^\d-]/g, ''))}
                      keyboardType="phone-pad" maxLength={10} />
                  </View>
                  <TouchableOpacity
                    style={[s.reservarBtn, { backgroundColor: '#25D366' }, (submitting || !phone.replace(/\D/g,'')) && { opacity: 0.5 }]}
                    onPress={() => onConfirmYappy({ phone })} disabled={submitting || !phone.replace(/\D/g,'')}>
                    {submitting
                      ? <><ActivityIndicator color={COLORS.white} size="small" /><Text style={[s.reservarBtnText, { marginLeft: 8 }]}>{yappyEspera ? 'Esperando Yappy...' : 'Procesando...'}</Text></>
                      : <Text style={s.reservarBtnText}>Pagar ${(deposito + YAPPY_FEE).toFixed(2)} con Yappy</Text>}
                  </TouchableOpacity>
                </>
              )}

              {metodoPago === 'tarjeta' && (
                <TouchableOpacity
                  style={[s.reservarBtn, { backgroundColor: '#1a56db' }, submitting && { opacity: 0.5 }]}
                  onPress={onConfirmTarjeta} disabled={submitting}>
                  {submitting ? <ActivityIndicator color={COLORS.white} />
                    : <Text style={s.reservarBtnText}>Pagar ${(deposito + YAPPY_FEE).toFixed(2)} con Tarjeta</Text>}
                </TouchableOpacity>
              )}

              {metodoPago === 'wallet' && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 }}>
                    <Text style={s.subText}>Tu saldo</Text>
                    <Text style={[s.subText, { color: (user?.wallet_balance ?? 0) >= deposito ? COLORS.neon : COLORS.red }]}>
                      ${(user?.wallet_balance ?? 0).toFixed(2)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.reservarBtn, (submitting || (user?.wallet_balance ?? 0) < deposito) && { opacity: 0.5 }]}
                    onPress={onConfirmWallet} disabled={submitting || (user?.wallet_balance ?? 0) < deposito}>
                    {submitting ? <ActivityIndicator color={COLORS.white} />
                      : <Text style={s.reservarBtnText}>Pagar ${deposito.toFixed(2)} del Wallet</Text>}
                  </TouchableOpacity>
                </>
              )}

              <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center' }}>
                Incluye $0.25 cargo · Saldo pendiente pago en cancha: ${(monto - deposito).toFixed(2)}
              </Text>
            </View>
          )}
        </>
      ) : (
        <View style={s.bottomBar}>
          <TouchableOpacity style={[s.reservarBtn, { flex: 1 }, submitting && { opacity: 0.6 }]}
            onPress={onConfirmWallet} disabled={submitting}>
            {submitting ? <ActivityIndicator color={COLORS.white} />
              : <Text style={s.reservarBtnText}>Confirmar solicitud</Text>}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Pantalla de confirmación exitosa ──────────────────────────────────────
function ConfirmacionView({ reserva, slot, selectedDate, duracion, onDone }) {
  const cancha = slot?.cancha ?? {};
  const tarifa = slot?.tarifa ?? {};
  const dur    = duracion ?? slot?.duracion_min ?? 60;
  const [fh, fm] = (() => {
    const [h, m] = (slot?.hora_inicio ?? '0:0').split(':').map(Number);
    const fin = h * 60 + m + dur;
    return [Math.floor(fin / 60), fin % 60];
  })();
  const horaFin = `${fh % 12 || 12}:${fm.toString().padStart(2, '0')}${fh >= 12 ? 'pm' : 'am'}`;
  const pagoDesc = reserva.estado_pago === 'pagado'
    ? `Abono de $${Number(reserva.abono_requerido ?? 0).toFixed(2)} confirmado`
    : 'Sin abono requerido';
  const saldoPendiente = Number(reserva.monto_total ?? 0) - Number(reserva.abono_requerido ?? 0);

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={[s.scroll, { alignItems: 'center', paddingTop: 32 }]}>
        <Text style={{ fontSize: 56, marginBottom: 8 }}>🎉</Text>
        <Text style={{ fontFamily: FONTS.heading, fontSize: 22, color: COLORS.neon, marginBottom: 4, textAlign: 'center' }}>
          ¡Reserva enviada!
        </Text>
        <Text style={{ fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 13, color: COLORS.gray, textAlign: 'center', marginBottom: 24 }}>
          La cancha revisará tu solicitud pronto
        </Text>

        {/* Código */}
        <View style={[s.summaryCard, { alignItems: 'center', width: '100%', borderColor: COLORS.neon }]}>
          <Text style={{ fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 11, color: COLORS.gray, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Código de reserva
          </Text>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 30, color: COLORS.neon, letterSpacing: 3 }}>
            {reserva.codigo_reserva ?? '—'}
          </Text>
        </View>

        {/* Detalles */}
        <View style={[s.summaryCard, { width: '100%' }]}>
          <Row label="Cancha"   value={cancha.nombre ?? '—'} />
          <Row label="Fecha"    value={formatDateLong(selectedDate)} />
          <Row label="Horario"  value={`${fmt12(slot.hora_inicio)} – ${horaFin}`} />
          {tarifa.deporte && <Row label="Deporte" value={`${tarifa.deporte} ${tarifa.formato_jpe}v${tarifa.formato_jpe}`} />}
          <Row label="Duración" value={dur < 60 ? `${dur}min` : dur % 60 === 0 ? `${dur/60}h` : `${Math.floor(dur/60)}h 30min`} />
        </View>

        {/* Pago */}
        <View style={[s.summaryCard, { width: '100%' }]}>
          <Row label="Total"          value={`$${Number(reserva.monto_total ?? 0).toFixed(2)}`} />
          <Row label="Abono pagado"   value={reserva.estado_pago === 'pagado' ? `$${Number(reserva.abono_requerido ?? 0).toFixed(2)}` : '$0.00'} />
          {saldoPendiente > 0 && <Row label="Pago al llegar" value={`$${saldoPendiente.toFixed(2)}`} />}
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 12,
              color: reserva.estado_pago === 'pagado' ? COLORS.neon : COLORS.gold }}>
              {pagoDesc}
            </Text>
          </View>
        </View>

        {/* WhatsApp */}
        {!!cancha.telefono && (
          <TouchableOpacity
            style={[s.summaryCard, { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: '#25D366' }]}
            onPress={() => {
              const msg = `Hola, acabo de reservar *${cancha.nombre}* para el *${formatDateLong(selectedDate)}* de *${fmt12(slot.hora_inicio)}* a *${horaFin}*. Mi código de reserva es *${reserva.codigo_reserva}*. ¿Pueden confirmarme?`;
              openWhatsApp(cancha.telefono, msg);
            }}
          >
            <Text style={{ fontSize: 28 }}>💬</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.cardTitle, { color: '#25D366', marginBottom: 2 }]}>Contactar la cancha</Text>
              <Text style={s.subText}>Envía tu código por WhatsApp para acelerar la confirmación</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[s.reservarBtn, { alignSelf: 'stretch', marginTop: 8, marginBottom: 40, alignItems: 'center' }]}
          onPress={onDone}
        >
          <Text style={s.reservarBtnText}>Volver al inicio</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={s.subText}>{label}</Text>
      <Text style={[s.subText, { color: COLORS.white, fontFamily: FONTS.bodySemiBold ?? FONTS.bodyBold, flex: 1, textAlign: 'right' }]}>{value}</Text>
    </View>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
const NEON = COLORS.neon ?? '#39FF14';
const RED  = COLORS.red  ?? '#E63946';
const GOLD = COLORS.gold ?? '#FFD166';
const GRAY = COLORS.gray ?? '#888';

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: COLORS.bg ?? '#0d0d0d' },
  header:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line ?? '#222' },
  backBtn:        { width: 40, height: 40, justifyContent: 'center' },
  backText:       { fontFamily: FONTS.bodyBold, fontSize: 22, color: COLORS.white },
  headerTitle:    { flex: 1, fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, textAlign: 'center', letterSpacing: 0.5 },
  scroll:         { padding: SPACING.md },

  sectionLabel:   { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, marginTop: SPACING.md, marginBottom: 6 },
  subText:        { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 12, color: GRAY },
  ampm:           { fontFamily: FONTS.bodyBold, fontSize: 13, color: GRAY, marginTop: SPACING.sm, marginBottom: 4 },

  chipRow:        { flexDirection: 'row', flexWrap: 'nowrap', gap: 8 },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: GRAY },
  chipActive:     { borderColor: NEON, backgroundColor: NEON + '18' },
  chipText:       { fontFamily: FONTS.bodySemiBold ?? FONTS.bodyBold, fontSize: 13, color: GRAY },
  chipTextActive: { color: NEON },

  dateChip:       { width: 66, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: GRAY, alignItems: 'center', marginHorizontal: 3 },
  dateChipActive: { borderColor: NEON, backgroundColor: NEON + '22' },
  dateMes:        { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 11, color: GRAY, textTransform: 'capitalize' },
  dateMesActive:  { color: NEON },
  dateDia:        { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white },
  dateDiaActive:  { color: NEON },
  dateDow:        { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 11, color: GRAY },
  dateDowActive:  { color: NEON },

  timeGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
  timeChip:       { paddingHorizontal: 12, paddingVertical: 9, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: GRAY },
  timeChipActive: { borderColor: NEON, backgroundColor: NEON + '22' },
  timeText:       { fontFamily: FONTS.bodySemiBold ?? FONTS.bodyBold, fontSize: 13, color: GRAY },
  timeTextActive: { color: NEON },

  pistaHeader:    { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, marginTop: SPACING.md, marginBottom: SPACING.sm },
  pistaGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pistaCard:      { width: '47%', padding: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: GRAY, backgroundColor: COLORS.card ?? '#1a1a1a', alignItems: 'center' },
  pistaCardActive:    { borderColor: NEON, backgroundColor: NEON + '18' },
  pistaTime:          { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 12, color: GRAY, marginBottom: 2 },
  pistaTimeActive:    { color: NEON },
  pistaMonto:         { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
  pistaMontoActive:   { color: NEON },
  pistaDeporte:       { fontFamily: FONTS.bodyBold, fontSize: 11, color: GRAY, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  pistaDeporteActive: { color: NEON },
  pistaFormato:       { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 11, color: GRAY },
  pistaFormatoActive: { color: NEON },
  pistaNombre:        { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 10, color: GRAY, marginTop: 4, textAlign: 'center' },
  pistaNombreActive:  { color: NEON + 'cc' },

  emptyBox:       { alignItems: 'center', paddingVertical: SPACING.lg },
  emptyText:      { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, textAlign: 'center' },

  bottomBar:      { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: COLORS.asphalt ?? '#111', borderTopWidth: 1, borderTopColor: COLORS.line ?? '#222', paddingBottom: Platform.OS === 'ios' ? 28 : SPACING.sm },
  totalLabel:     { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 12, color: GRAY },
  totalMonto:     { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white },
  depositoLabel:  { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 11, color: GOLD },
  reservarBtn:    { backgroundColor: RED, paddingHorizontal: SPACING.lg, paddingVertical: 13, borderRadius: RADIUS.md },
  reservarBtnText:{ fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white },

  summaryCard:    { backgroundColor: COLORS.card ?? '#1a1a1a', borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.line ?? '#222' },
  cardTitle:      { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, marginBottom: SPACING.sm },
  payRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  payLabel:       { fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 13, color: GRAY },
  payMonto:       { fontFamily: FONTS.bodySemiBold ?? FONTS.bodyBold, fontSize: 13, color: GRAY },
  phoneInput:     { flex: 1, fontFamily: FONTS.body ?? FONTS.bodyBold, fontSize: 15, color: COLORS.white, borderWidth: 1, borderColor: GRAY, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.card ?? '#1a1a1a' },
});
