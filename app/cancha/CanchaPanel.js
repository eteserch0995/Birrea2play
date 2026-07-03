import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator, FlatList,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import useAuthStore from '../../store/authStore';
import { DateField, TimeField } from '../../components/DateTimeField';

// ── helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
  return dt.toLocaleDateString('es-PA', { weekday: 'short', day: '2-digit', month: 'short' });
}
function fmtTime(t) {
  if (!t) return '';
  return t.slice(0, 5);
}
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ── Panel principal ───────────────────────────────────────────────────────
export default function CanchaPanel() {
  const user = useAuthStore((s) => s.user);
  const [canchas,     setCanchas]     = useState([]);
  const [slotsMap,    setSlotsMap]    = useState({});
  const [tarifasMap,  setTarifasMap]  = useState({});
  const [reservas,    setReservas]    = useState([]); // solicitudes pendientes
  const [loading,     setLoading]     = useState(true);
  const [editingCancha,    setEditingCancha]    = useState(null);
  const [showCanchaModal,  setShowCanchaModal]  = useState(false);
  const [newSlotForCanchaId, setNewSlotForCanchaId] = useState(null);

  const fetchAll = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: list, error: cErr } = await supabase
        .from('canchas')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;
      setCanchas(list ?? []);

      if (list?.length) {
        const ids = list.map((c) => c.id);
        const [slotsRes, tarifasRes] = await Promise.all([
          supabase
            .from('cancha_slots')
            .select(`
              id, cancha_id, fecha, hora_inicio, hora_fin, precio_hora, tarifa_id,
              visibility, reserved_for_gestor_id, status, notas,
              cliente_externo_nombre, cliente_externo_telefono,
              tarifa:tarifa_id ( id, deporte, formato_jpe, descripcion, precio_hora ),
              reserved_for_gestor:reserved_for_gestor_id ( id, nombre ),
              cancha_slot_reservas ( id, status, gestor:gestor_id ( id, nombre, telefono ) )
            `)
            .in('cancha_id', ids)
            .gte('fecha', todayIso())
            .order('fecha', { ascending: true })
            .order('hora_inicio', { ascending: true }),
          supabase
            .from('cancha_tarifas')
            .select('id, cancha_id, deporte, formato_jpe, descripcion, precio_hora')
            .in('cancha_id', ids)
            .eq('activo', true)
            .order('precio_hora', { ascending: true }),
        ]);

        const sm = {};
        const tm = {};
        ids.forEach((id) => { sm[id] = []; tm[id] = []; });
        (slotsRes.data ?? []).forEach((s) => { sm[s.cancha_id]?.push(s); });
        (tarifasRes.data ?? []).forEach((t) => { tm[t.cancha_id]?.push(t); });
        setSlotsMap(sm);
        setTarifasMap(tm);

        // Cargar solicitudes pendientes del nuevo flujo (cancha_reservas)
        if (ids.length) {
          const { data: resData } = await supabase
            .from('cancha_reservas')
            .select(`
              id, cancha_id, tarifa_id, fecha, hora_inicio, hora_fin,
              status, monto_total, deposito_pagado, created_at,
              tarifa:tarifa_id ( deporte, formato_jpe ),
              gestor:gestor_id ( id, nombre, telefono )
            `)
            .in('cancha_id', ids)
            .eq('status', 'pending')
            .order('fecha', { ascending: true })
            .order('hora_inicio', { ascending: true });
          setReservas(resData ?? []);
        } else {
          setReservas([]);
        }
      }
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function openNewCancha() { setEditingCancha(null); setShowCanchaModal(true); }
  function openEditCancha(c) { setEditingCancha(c); setShowCanchaModal(true); }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.red} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { flex: 1 }]}>Mis Canchas</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={openNewCancha}>
            <Text style={styles.primaryBtnText}>+ Nueva cancha</Text>
          </TouchableOpacity>
        </View>

        {/* Solicitudes de reserva pendientes */}
        {reservas.length > 0 && (
          <View style={{ marginBottom: SPACING.md }}>
            <Text style={[styles.section, { color: COLORS.gold }]}>
              Solicitudes pendientes ({reservas.length})
            </Text>
            {reservas.map((r) => (
              <ReservaRequestCard key={r.id} reserva={r} canchasMap={Object.fromEntries(canchas.map(c => [c.id, c]))} onResolved={fetchAll} />
            ))}
          </View>
        )}

        {canchas.length === 0 && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No tenés canchas registradas aún.</Text>
          </View>
        )}

        {canchas.map((cancha) => {
          const slots   = slotsMap[cancha.id] ?? [];
          const tarifas = tarifasMap[cancha.id] ?? [];
          return (
            <View key={cancha.id} style={styles.canchaSection}>
              <View style={styles.canchaHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.canchaTitle}>{cancha.nombre}</Text>
                  {!!cancha.direccion && <Text style={styles.subText}>{cancha.direccion}</Text>}
                  {tarifas.length > 0 && (
                    <Text style={styles.subText}>
                      {tarifas.map((t) => `${t.formato_jpe}vs${t.formato_jpe} $${Number(t.precio_hora).toFixed(0)}/h`).join(' · ')}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => openEditCancha(cancha)} style={{ paddingLeft: 8 }}>
                  <Text style={styles.linkText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ paddingLeft: 12 }}
                  onPress={() => Alert.alert(
                    'Eliminar cancha',
                    `¿Eliminás "${cancha.nombre}"? Se borrarán todos sus slots, tarifas y horarios.`,
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Eliminar', style: 'destructive', onPress: async () => {
                        const { error } = await supabase.from('canchas').delete().eq('id', cancha.id);
                        if (error) Alert.alert('Error', error.message);
                        else fetchAll();
                      }},
                    ]
                  )}
                >
                  <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.red, fontSize: 18 }}>🗑</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { alignSelf: 'flex-start', marginBottom: SPACING.sm }]}
                onPress={() => setNewSlotForCanchaId(cancha.id)}
              >
                <Text style={styles.primaryBtnText}>+ Nuevo slot</Text>
              </TouchableOpacity>

              {slots.length === 0 ? (
                <Text style={[styles.subText, { marginBottom: SPACING.sm }]}>Sin slots publicados.</Text>
              ) : (
                slots.map((s) => (
                  <SlotCard key={s.id} slot={s} onChange={fetchAll} canchaName={cancha.nombre} />
                ))
              )}
            </View>
          );
        })}
      </ScrollView>

      <CanchaFormModal
        visible={showCanchaModal}
        onClose={() => setShowCanchaModal(false)}
        onSaved={fetchAll}
        userId={user.id}
        existing={editingCancha}
      />

      {newSlotForCanchaId && (
        <NewSlotModal
          visible={!!newSlotForCanchaId}
          onClose={() => setNewSlotForCanchaId(null)}
          onSaved={fetchAll}
          canchaId={newSlotForCanchaId}
          tarifas={tarifasMap[newSlotForCanchaId] ?? []}
        />
      )}
    </SafeAreaView>
  );
}

// ── helpers WhatsApp ───────────────────────────────────────────────────────
function openWhatsApp(telefono, mensaje) {
  const num = telefono.replace(/\D/g, '');
  const url = `https://wa.me/${num.startsWith('507') ? '' : '507'}${num}?text=${encodeURIComponent(mensaje)}`;
  Linking.openURL(url).catch(() => Alert.alert('Error', 'No se pudo abrir WhatsApp'));
}

// ── Slot card ──────────────────────────────────────────────────────────────
function SlotCard({ slot, onChange, canchaName }) {
  const reserva = slot.cancha_slot_reservas?.find((r) => r.status === 'reserved' || r.status === 'converted');
  const isReservedForGestor = slot.visibility === 'reserved_for_gestor';
  const isBlockedExternal   = slot.visibility === 'blocked_external';
  const reservedFor  = slot.reserved_for_gestor?.nombre;
  const claimedBy    = reserva?.gestor?.nombre;
  const claimedByTel = reserva?.gestor?.telefono;

  const STATUS_COLORS = {
    available: COLORS.green,
    claimed:   COLORS.gold,
    expired:   COLORS.gray,
    cancelled: COLORS.gray,
  };

  async function handleCancel() {
    Alert.alert(
      'Cancelar slot',
      '¿Eliminar este horario? Si un gestor lo reclamó, se le notificará.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('cancha_slots')
              .update({ status: 'cancelled' })
              .eq('id', slot.id);
            if (error) Alert.alert('Error', error.message);
            else onChange();
          },
        },
      ],
    );
  }

  function handleWaGestor() {
    if (!claimedByTel) { Alert.alert('Sin teléfono', 'El gestor no tiene teléfono registrado.'); return; }
    const msg = `Hola, te escribo por el slot del ${fmtDate(slot.fecha)} ${fmtTime(slot.hora_inicio)}-${fmtTime(slot.hora_fin)} en ${canchaName ?? 'la cancha'}.`;
    openWhatsApp(claimedByTel, msg);
  }

  function handleWaExterno() {
    if (!slot.cliente_externo_telefono) { Alert.alert('Sin teléfono', 'No hay teléfono del cliente externo.'); return; }
    const msg = `Hola ${slot.cliente_externo_nombre ?? 'cliente'}, confirmo tu reserva del ${fmtDate(slot.fecha)} ${fmtTime(slot.hora_inicio)}-${fmtTime(slot.hora_fin)}.`;
    openWhatsApp(slot.cliente_externo_telefono, msg);
  }

  return (
    <View style={[styles.card, isBlockedExternal && styles.cardExternal]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{fmtDate(slot.fecha)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isBlockedExternal && (
            <View style={[styles.badge, { backgroundColor: COLORS.orange ?? '#E67E22' }]}>
              <Text style={styles.badgeText}>EXTERNO</Text>
            </View>
          )}
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[slot.status] }]}>
            <Text style={styles.badgeText}>{slot.status.toUpperCase()}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.cardTime}>{fmtTime(slot.hora_inicio)} – {fmtTime(slot.hora_fin)}</Text>
      {slot.tarifa ? (
        <Text style={styles.tarifaText}>
          {slot.tarifa.deporte} {slot.tarifa.formato_jpe}vs{slot.tarifa.formato_jpe}
          {slot.tarifa.descripcion ? ` · ${slot.tarifa.descripcion}` : ''}
          {' · '}${Number(slot.tarifa.precio_hora).toFixed(2)}/h
        </Text>
      ) : slot.precio_hora != null ? (
        <Text style={styles.subText}>${Number(slot.precio_hora).toFixed(2)} / hora</Text>
      ) : null}

      {isReservedForGestor && (
        <Text style={styles.lockText}>Bloqueado para: {reservedFor ?? '—'}</Text>
      )}
      {isBlockedExternal && (
        <View>
          <Text style={styles.externalText}>
            Cliente externo: {slot.cliente_externo_nombre ?? '—'}
          </Text>
          {!!slot.cliente_externo_telefono && (
            <Text style={styles.subText}>{slot.cliente_externo_telefono}</Text>
          )}
        </View>
      )}
      {claimedBy && (
        <Text style={styles.claimText}>Reclamado por: {claimedBy}</Text>
      )}
      {!!slot.notas && <Text style={styles.subText}>{slot.notas}</Text>}

      <View style={styles.cardActions}>
        {claimedBy && claimedByTel && (
          <TouchableOpacity style={styles.waBtn} onPress={handleWaGestor}>
            <Text style={styles.waBtnText}>WhatsApp gestor</Text>
          </TouchableOpacity>
        )}
        {isBlockedExternal && slot.cliente_externo_telefono && (
          <TouchableOpacity style={styles.waBtn} onPress={handleWaExterno}>
            <Text style={styles.waBtnText}>WhatsApp cliente</Text>
          </TouchableOpacity>
        )}
        {slot.status === 'available' && (
          <TouchableOpacity style={styles.dangerBtn} onPress={handleCancel}>
            <Text style={styles.dangerBtnText}>Cancelar slot</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Modal: Registrar / editar cancha ───────────────────────────────────────
const DEPORTES    = ['Fútbol', 'Fútbol Sala', 'Pádel', 'Volleyball', 'Basketball'];
const FORMATOS    = [5, 6, 7, 8, 9, 11];
const DIAS_LABEL  = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DURACIONES  = [30, 60, 90, 120];

function emptyTarifa() {
  return { _key: Date.now(), deporte: 'Fútbol', formato_jpe: 7, precio_hora: '', descripcion: '', bloqueaActivo: false, bloqueos: [] };
}

function CanchaFormModal({ visible, onClose, onSaved, userId, existing }) {
  const [nombre,            setNombre]            = useState('');
  const [direccion,         setDireccion]         = useState('');
  const [requiereDeposito,  setRequiereDeposito]  = useState(false);
  const [porcentajeDeposito,setPorcentajeDeposito]= useState('50');
  const [abonoTipo,         setAbonoTipo]         = useState('porcentaje'); // ninguno|fijo|porcentaje|total
  const [abonoMontoFijo,    setAbonoMontoFijo]    = useState('');
  const [duracionMax,       setDuracionMax]       = useState(120);
  const [telefono,    setTelefono]    = useState('');
  const [tarifas,     setTarifas]     = useState([emptyTarifa()]);
  // Horarios de operación
  const [diasActivos,   setDiasActivos]   = useState([1,2,3,4,5,6]); // Lun–Sáb por default
  const [apertura,      setApertura]      = useState('08:00');
  const [cierre,        setCierre]        = useState('22:00');
  const [duracionSlot,  setDuracionSlot]  = useState(60);
  const [horarioLibre,  setHorarioLibre]  = useState(false); // usuario elige rango libre
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNombre(existing?.nombre ?? '');
    setDireccion(existing?.direccion ?? '');
    setTelefono(existing?.telefono ?? '');
    setRequiereDeposito(existing?.requiere_deposito ?? false);
    setPorcentajeDeposito((existing?.porcentaje_deposito ?? 50).toString());
    setAbonoTipo(existing?.abono_tipo ?? (existing?.requiere_deposito ? 'porcentaje' : 'ninguno'));
    setAbonoMontoFijo((existing?.abono_monto_fijo ?? '').toString());
    setDuracionMax(existing?.duracion_max_minutos ?? 120);

    if (existing?.id) {
      // Cargar tarifas
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
      // Cargar horarios existentes
      supabase.from('cancha_horarios')
        .select('dia_semana, hora_apertura, hora_cierre, duracion_slot_min, horario_libre')
        .eq('cancha_id', existing.id).is('tarifa_id', null).eq('activo', true)
        .then(({ data }) => {
          if (data?.length) {
            setDiasActivos(data.map((h) => h.dia_semana));
            setApertura(data[0].hora_apertura?.slice(0, 5) ?? '08:00');
            setCierre(data[0].hora_cierre?.slice(0, 5) ?? '22:00');
            setDuracionSlot(data[0].duracion_slot_min ?? 60);
            setHorarioLibre(data[0].horario_libre ?? false);
          } else {
            setDiasActivos([1,2,3,4,5,6]);
            setApertura('08:00');
            setCierre('22:00');
            setDuracionSlot(60);
          }
        });
    } else {
      setTarifas([emptyTarifa()]);
      setDiasActivos([1,2,3,4,5,6]);
      setApertura('08:00');
      setCierre('22:00');
      setDuracionSlot(60);
    }
  }, [visible, existing]);

  function updTarifa(key, field, val) {
    setTarifas((prev) => prev.map((t) => t._key === key ? { ...t, [field]: val } : t));
  }
  function addTarifa() { setTarifas((prev) => [...prev, { ...emptyTarifa(), _key: Date.now() }]); }
  function removeTarifa(key) { setTarifas((prev) => prev.filter((t) => t._key !== key)); }
  function toggleDia(d) {
    setDiasActivos((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a,b) => a-b));
  }

  async function handleSave() {
    if (!nombre.trim()) { Alert.alert('Falta nombre', 'El nombre de la cancha es obligatorio.'); return; }
    const tarifasValidas = tarifas.filter((t) => t.precio_hora !== '' && Number(t.precio_hora) > 0);
    if (tarifasValidas.length === 0) {
      Alert.alert('Falta precio', 'Ingresá el precio por hora de al menos una sub-cancha.'); return;
    }
    if (diasActivos.length === 0) {
      Alert.alert('Falta horario', 'Seleccioná al menos un día de operación.'); return;
    }
    if (!apertura || !cierre || cierre <= apertura) {
      Alert.alert('Horario inválido', 'El cierre debe ser mayor que la apertura (ej: 08:00 – 22:00).'); return;
    }

    setSaving(true);
    try {
      // 1. Guardar la cancha
      let canchaId = existing?.id;
      const payload = {
        nombre: nombre.trim(), direccion: direccion.trim() || null,
        telefono: telefono.trim() || null, precio_hora: null,
        // Legacy booleans (compatibilidad)
        requiere_deposito:   abonoTipo !== 'ninguno',
        porcentaje_deposito: abonoTipo === 'porcentaje' ? (Number(porcentajeDeposito) || 50) : 0,
        // Nuevo modelo
        abono_tipo:          abonoTipo,
        abono_monto_fijo:    abonoTipo === 'fijo' ? (Number(abonoMontoFijo) || null) : null,
        duracion_max_minutos: duracionMax,
      };
      if (canchaId) {
        const { error } = await supabase.from('canchas').update(payload).eq('id', canchaId);
        if (error) throw new Error('Error guardando cancha: ' + error.message);
      } else {
        const { data, error } = await supabase.from('canchas').insert({ ...payload, owner_id: userId }).select('id').single();
        if (error) throw new Error('Error creando cancha: ' + error.message);
        canchaId = data.id;
      }

      // 2. Desactivar tarifas antiguas que ya no están
      if (existing?.id) {
        const idsActuales = tarifasValidas.filter((t) => t.id).map((t) => t.id);
        const { error } = await supabase.from('cancha_tarifas').update({ activo: false })
          .eq('cancha_id', canchaId)
          .not('id', 'in', `(${idsActuales.length ? idsActuales.join(',') : '00000000-0000-0000-0000-000000000000'})`);
        if (error) console.warn('Warn deactivate tarifas:', error.message);
      }

      // 3. Guardar tarifas y construir mapa _key → id
      const keyToId = {};
      for (const t of tarifasValidas) {
        const tarifaPayload = {
          deporte:     t.deporte,
          formato_jpe: Number(t.formato_jpe),
          descripcion: t.descripcion?.trim() || null,
          precio_hora: Number(t.precio_hora),
          activo:      true,
          cancha:      '',
        };
        if (t.id) {
          const { error } = await supabase.from('cancha_tarifas').update(tarifaPayload).eq('id', t.id);
          if (error) throw new Error('Error actualizando tarifa: ' + error.message);
          keyToId[t._key] = t.id;
        } else {
          const { data: tData, error } = await supabase
            .from('cancha_tarifas')
            .insert({ ...tarifaPayload, cancha_id: canchaId })
            .select('id').single();
          if (error) throw new Error('Error insertando tarifa: ' + error.message);
          keyToId[t._key] = tData.id;
        }
      }

      // 3b. Actualizar bloquea_tarifas ahora que tenemos todos los IDs
      for (const t of tarifasValidas) {
        const myId = keyToId[t._key];
        if (!myId) continue;
        // Resolver _key → id (para tarifas nuevas) o uuid directo (para existentes)
        const bloqueoIds = (t.bloqueos ?? []).map((k) => keyToId[k] ?? k).filter(Boolean);
        const { error } = await supabase
          .from('cancha_tarifas')
          .update({ bloquea_tarifas: bloqueoIds })
          .eq('id', myId);
        if (error) console.warn('Warn bloqueos:', error.message);
      }

      // 4. Guardar horarios: borrar y recrear
      await supabase.from('cancha_horarios').delete().eq('cancha_id', canchaId).is('tarifa_id', null);
      for (const dia of diasActivos) {
        const { error } = await supabase.from('cancha_horarios').insert({
          cancha_id: canchaId, tarifa_id: null,
          dia_semana: dia,
          hora_apertura: apertura + ':00',
          hora_cierre: cierre + ':00',
          duracion_slot_min: horarioLibre ? 30 : duracionSlot,
          horario_libre: horarioLibre,
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
        <View style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.modalTitle}>{existing ? 'Editar cancha' : 'Registrar cancha'}</Text>

          <Text style={styles.label}>Nombre *</Text>
          <TextInput value={nombre} onChangeText={setNombre} style={styles.input} placeholder="Fredy Sport Center" placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Dirección</Text>
          <TextInput value={direccion} onChangeText={setDireccion} style={styles.input} placeholder="Calle, distrito, referencia" placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Teléfono</Text>
          <TextInput value={telefono} onChangeText={setTelefono} style={styles.input} keyboardType="phone-pad" placeholder="6000-0000" placeholderTextColor={COLORS.gray} />

          {/* ── Sub-canchas / tarifas ── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.md, marginBottom: 4 }}>
            <Text style={[styles.label, { flex: 1, marginTop: 0 }]}>Sub-canchas / formatos *</Text>
            <TouchableOpacity onPress={addTarifa}>
              <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 13 }}>+ Agregar</Text>
            </TouchableOpacity>
          </View>
          {tarifas.map((t, idx) => (
            <View key={t._key} style={styles.tarifaRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={[styles.label, { flex: 1, marginTop: 0 }]}>Sub-cancha {idx + 1}</Text>
                {tarifas.length > 1 && (
                  <TouchableOpacity onPress={() => removeTarifa(t._key)}>
                    <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.red, fontSize: 20, lineHeight: 22 }}>×</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.label}>Deporte</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {DEPORTES.map((d) => (
                    <TouchableOpacity key={d}
                      style={[styles.toggle, t.deporte === d && styles.toggleActive, { paddingHorizontal: 10 }]}
                      onPress={() => updTarifa(t._key, 'deporte', d)}
                    >
                      <Text style={[styles.toggleText, t.deporte === d && styles.toggleTextActive]}>{d}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={styles.label}>Formato</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {FORMATOS.map((f) => (
                  <TouchableOpacity key={f}
                    style={[styles.toggle, t.formato_jpe === f && styles.toggleActive, { minWidth: 52 }]}
                    onPress={() => updTarifa(t._key, 'formato_jpe', f)}
                  >
                    <Text style={[styles.toggleText, t.formato_jpe === f && styles.toggleTextActive]}>{f}vs{f}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Precio / hora ($) *</Text>
                  <TextInput
                    value={t.precio_hora}
                    onChangeText={(v) => updTarifa(t._key, 'precio_hora', v)}
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="50.00"
                    placeholderTextColor={COLORS.gray}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Descripción (ej: Canchas 1+2)</Text>
                  <TextInput
                    value={t.descripcion}
                    onChangeText={(v) => updTarifa(t._key, 'descripcion', v)}
                    style={styles.input}
                    placeholder="Opcional"
                    placeholderTextColor={COLORS.gray}
                  />
                </View>
              </View>

              {/* Bloqueo de otras sub-canchas */}
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
                onPress={() => updTarifa(t._key, 'bloqueaActivo', !t.bloqueaActivo)}
              >
                <View style={[styles.toggle, { width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', padding: 0 },
                  t.bloqueaActivo && styles.toggleActive]}>
                  {t.bloqueaActivo && <Text style={{ color: COLORS.neon, fontSize: 14, lineHeight: 16 }}>✓</Text>}
                </View>
                <Text style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray }}>
                  ¿Bloquea otras sub-canchas al reservar?
                </Text>
              </TouchableOpacity>

              {t.bloqueaActivo && tarifas.filter((o) => o._key !== t._key).length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={[styles.label, { fontSize: 12 }]}>
                    Seleccioná cuáles quedan bloqueadas:
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {tarifas.filter((o) => o._key !== t._key).map((other) => {
                      const isSelected = (t.bloqueos ?? []).includes(other._key) || (t.bloqueos ?? []).includes(other.id);
                      const otherKey   = other.id ?? other._key;
                      return (
                        <TouchableOpacity key={other._key}
                          style={[styles.toggle, isSelected && styles.toggleActive, { paddingHorizontal: 10 }]}
                          onPress={() => {
                            const cur = t.bloqueos ?? [];
                            updTarifa(t._key, 'bloqueos',
                              isSelected ? cur.filter((k) => k !== otherKey && k !== other._key)
                                         : [...cur, otherKey]);
                          }}
                        >
                          <Text style={[styles.toggleText, isSelected && styles.toggleTextActive]}>
                            {other.deporte ?? 'Sub-cancha'} {other.formato_jpe}vs{other.formato_jpe}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          ))}

          {/* ── Horarios de operación ── */}
          <Text style={[styles.label, { marginTop: SPACING.md }]}>Horarios de operación *</Text>
          <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginBottom: 8 }}>
            Los gestores verán los espacios disponibles en estos días y horas.
          </Text>

          <Text style={styles.label}>Días activos</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: SPACING.sm }}>
            {DIAS_LABEL.map((d, i) => (
              <TouchableOpacity key={i}
                style={[styles.toggle, diasActivos.includes(i) && styles.toggleActive, { minWidth: 44 }]}
                onPress={() => toggleDia(i)}
              >
                <Text style={[styles.toggleText, diasActivos.includes(i) && styles.toggleTextActive]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Apertura (HH:MM)</Text>
              <TextInput value={apertura} onChangeText={setApertura} style={styles.input}
                placeholder="08:00" placeholderTextColor={COLORS.gray} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Cierre (HH:MM)</Text>
              <TextInput value={cierre} onChangeText={setCierre} style={styles.input}
                placeholder="22:00" placeholderTextColor={COLORS.gray} />
            </View>
          </View>

          {/* Horario libre / Horario fijo */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, marginBottom: 4 }}
            onPress={() => setHorarioLibre((v) => !v)}
          >
            <View style={[styles.toggle, { width: 24, height: 24, borderRadius: 4, alignItems: 'center', justifyContent: 'center', padding: 0 },
              horarioLibre && styles.toggleActive]}>
              {horarioLibre && <Text style={{ color: COLORS.neon, fontSize: 14, lineHeight: 16 }}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: FONTS.bodySemiBold ?? FONTS.bodyBold, fontSize: 13, color: COLORS.white }}>
                Horario libre (el usuario elige el rango)
              </Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray }}>
                Permite escoger hora inicio y fin como un calendario. Si está desactivado, el tiempo es fijo.
              </Text>
            </View>
          </TouchableOpacity>

          {!horarioLibre && (
            <>
              <Text style={styles.label}>Duración de cada slot</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: SPACING.md }}>
                {DURACIONES.filter(d => d >= 60).map((d) => (
                  <TouchableOpacity key={d}
                    style={[styles.toggle, duracionSlot === d && styles.toggleActive, { flex: 1, alignItems: 'center' }]}
                    onPress={() => setDuracionSlot(d)}
                  >
                    <Text style={[styles.toggleText, duracionSlot === d && styles.toggleTextActive]}>
                      {d === 60 ? '1h' : d === 90 ? '1.5h' : '2h'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* ── Configuración de abono ── */}
          <Text style={[styles.label, { marginTop: SPACING.md }]}>Tipo de abono</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: SPACING.sm, flexWrap: 'wrap' }}>
            {[['ninguno','Sin abono'],['porcentaje','Porcentaje'],['fijo','Monto fijo'],['total','Pago total']].map(([val, lbl]) => (
              <TouchableOpacity key={val}
                style={[styles.toggle, abonoTipo === val && styles.toggleActive, { paddingHorizontal: 10, alignItems: 'center' }]}
                onPress={() => setAbonoTipo(val)}
              >
                <Text style={[styles.toggleText, abonoTipo === val && styles.toggleTextActive, { fontSize: 12 }]}>{lbl}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {abonoTipo === 'porcentaje' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm }}>
              <Text style={[styles.label, { marginTop: 0 }]}>Porcentaje</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['25','30','50','100'].map((p) => (
                  <TouchableOpacity key={p}
                    style={[styles.toggle, porcentajeDeposito === p && styles.toggleActive, { minWidth: 44, alignItems: 'center' }]}
                    onPress={() => setPorcentajeDeposito(p)}
                  >
                    <Text style={[styles.toggleText, porcentajeDeposito === p && styles.toggleTextActive]}>{p}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {abonoTipo === 'fijo' && (
            <View style={{ marginBottom: SPACING.sm }}>
              <Text style={styles.label}>Monto fijo de abono ($)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: 10.00"
                placeholderTextColor={COLORS.gray}
                value={abonoMontoFijo}
                onChangeText={setAbonoMontoFijo}
                keyboardType="decimal-pad"
              />
            </View>
          )}

          {abonoTipo !== 'ninguno' && (
            <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginBottom: SPACING.sm }}>
              {abonoTipo === 'total' ? 'El gestor paga el 100% al reservar.' :
               abonoTipo === 'fijo'  ? `El gestor paga $${abonoMontoFijo || '?'} al reservar. El saldo lo paga en la cancha.` :
               `El gestor paga el ${porcentajeDeposito}% al reservar. El saldo lo paga en la cancha.`}
            </Text>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.secondaryBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.primaryBtnText}>Guardar</Text>}
            </TouchableOpacity>
          </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Modal: Nuevo slot ──────────────────────────────────────────────────────
function NewSlotModal({ visible, onClose, onSaved, canchaId, precioDefault, tarifas }) {
  const [fecha,         setFecha]         = useState(todayIso());
  const [horaIni,       setHoraIni]       = useState('18:00');
  const [horaFin,       setHoraFin]       = useState('20:00');
  const [precio,        setPrecio]        = useState(precioDefault?.toString() ?? '');
  const [tarifaId,      setTarifaId]      = useState(null);
  const [notas,         setNotas]         = useState('');
  const [visibility,    setVisibility]    = useState('public');
  const [reservedFor,   setReservedFor]   = useState(null);
  const [externoNombre, setExternoNombre] = useState('');
  const [externoTel,    setExternoTel]    = useState('');
  const [showGestorPicker, setShowGestorPicker] = useState(false);
  const [saving,        setSaving]        = useState(false);

  useEffect(() => {
    if (visible) {
      setFecha(todayIso());
      setHoraIni('18:00');
      setHoraFin('20:00');
      setPrecio(precioDefault?.toString() ?? '');
      setTarifaId(null);
      setNotas('');
      setVisibility('public');
      setReservedFor(null);
      setExternoNombre('');
      setExternoTel('');
    }
  }, [visible, precioDefault]);

  function selectTarifa(t) {
    setTarifaId(t.id);
    setPrecio(t.precio_hora?.toString() ?? '');
  }

  async function handleSave() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      Alert.alert('Fecha inválida', 'Usa formato YYYY-MM-DD.');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(horaIni) || !/^\d{2}:\d{2}$/.test(horaFin)) {
      Alert.alert('Hora inválida', 'Usa formato HH:MM (24h).');
      return;
    }
    if (horaFin <= horaIni) {
      Alert.alert('Horas inválidas', 'La hora fin debe ser mayor que la de inicio.');
      return;
    }
    if (visibility === 'reserved_for_gestor' && !reservedFor) {
      Alert.alert('Falta gestor', 'Seleccioná el gestor para quien queda bloqueado el slot.');
      return;
    }
    if (visibility === 'blocked_external' && !externoNombre.trim()) {
      Alert.alert('Falta nombre', 'Ingresá el nombre del cliente externo.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('cancha_slots').insert({
        cancha_id:                canchaId,
        tarifa_id:                tarifaId ?? null,
        fecha,
        hora_inicio:              horaIni + ':00',
        hora_fin:                 horaFin + ':00',
        precio_hora:              precio ? Number(precio) : null,
        visibility,
        reserved_for_gestor_id:   visibility === 'reserved_for_gestor' ? reservedFor.id : null,
        cliente_externo_nombre:   visibility === 'blocked_external' ? externoNombre.trim() : null,
        cliente_externo_telefono: visibility === 'blocked_external' ? (externoTel.trim() || null) : null,
        notas:                    notas.trim() || null,
      });
      if (error) throw error;
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo crear el slot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalRoot}>
        <View style={styles.modalCard}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Nuevo slot</Text>

            <Text style={styles.label}>Fecha</Text>
            <DateField value={fecha} onChange={setFecha} style={styles.input} />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: SPACING.sm }}>
                <Text style={styles.label}>Inicio</Text>
                <TimeField value={horaIni} onChange={setHoraIni} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Fin</Text>
                <TimeField value={horaFin} onChange={setHoraFin} style={styles.input} />
              </View>
            </View>

            {tarifas.length > 0 && (
              <>
                <Text style={styles.label}>Formato / tarifa</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SPACING.sm }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {tarifas.map((t) => (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.tarifaChip, tarifaId === t.id && styles.tarifaChipActive]}
                        onPress={() => selectTarifa(t)}
                      >
                        <Text style={[styles.tarifaChipText, tarifaId === t.id && { color: COLORS.white }]}>
                          {t.deporte} {t.formato_jpe}vs{t.formato_jpe}
                        </Text>
                        <Text style={[styles.tarifaChipPrice, tarifaId === t.id && { color: COLORS.gold }]}>
                          ${Number(t.precio_hora).toFixed(2)}/h
                        </Text>
                        {!!t.descripcion && (
                          <Text style={[styles.tarifaChipSub, tarifaId === t.id && { color: COLORS.gray2 }]}>
                            {t.descripcion}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <Text style={styles.label}>Precio por hora ($)</Text>
            <TextInput value={precio} onChangeText={setPrecio} style={styles.input} keyboardType="decimal-pad" placeholder="25.00" placeholderTextColor={COLORS.gray} />

            <Text style={styles.label}>Notas</Text>
            <TextInput value={notas} onChangeText={setNotas} style={[styles.input, { height: 60 }]} multiline placeholder="Cancha sintética, iluminación, etc." placeholderTextColor={COLORS.gray} />

            <Text style={styles.label}>Tipo de slot</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggle, visibility === 'public' && styles.toggleActive]}
                onPress={() => setVisibility('public')}
              >
                <Text style={[styles.toggleText, visibility === 'public' && styles.toggleTextActive]}>
                  Publico
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggle, visibility === 'reserved_for_gestor' && styles.toggleActive]}
                onPress={() => setVisibility('reserved_for_gestor')}
              >
                <Text style={[styles.toggleText, visibility === 'reserved_for_gestor' && styles.toggleTextActive]}>
                  Para gestor
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggle, visibility === 'blocked_external' && styles.toggleActiveExternal]}
                onPress={() => setVisibility('blocked_external')}
              >
                <Text style={[styles.toggleText, visibility === 'blocked_external' && styles.toggleTextActive]}>
                  Externo
                </Text>
              </TouchableOpacity>
            </View>

            {visibility === 'reserved_for_gestor' && (
              <TouchableOpacity style={styles.gestorPickerBtn} onPress={() => setShowGestorPicker(true)}>
                <Text style={styles.gestorPickerText}>
                  {reservedFor ? `Gestor: ${reservedFor.nombre}` : 'Elegir gestor'}
                </Text>
              </TouchableOpacity>
            )}

            {visibility === 'blocked_external' && (
              <View style={styles.externalBox}>
                <Text style={styles.label}>Nombre del cliente *</Text>
                <TextInput
                  value={externoNombre}
                  onChangeText={setExternoNombre}
                  style={styles.input}
                  placeholder="Juan Perez / Empresa X"
                  placeholderTextColor={COLORS.gray}
                />
                <Text style={styles.label}>Telefono (WhatsApp)</Text>
                <TextInput
                  value={externoTel}
                  onChangeText={setExternoTel}
                  style={styles.input}
                  keyboardType="phone-pad"
                  placeholder="6000-0000"
                  placeholderTextColor={COLORS.gray}
                />
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.secondaryBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color={COLORS.white} />
                  : <Text style={styles.primaryBtnText}>Crear slot</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>

          <GestorPickerModal
            visible={showGestorPicker}
            onClose={() => setShowGestorPicker(false)}
            onPick={(g) => { setReservedFor(g); setShowGestorPicker(false); }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Modal: Selector de gestor ─────────────────────────────────────────────
function GestorPickerModal({ visible, onClose, onPick }) {
  const [query, setQuery]   = useState('');
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from('users')
        .select('id, nombre, correo')
        .eq('role', 'gestor')
        .order('nombre', { ascending: true })
        .limit(30);
      if (query.trim()) q = q.ilike('nombre', `%${query.trim()}%`);
      const { data, error } = await q;
      if (!cancelled) {
        if (error) Alert.alert('Error', error.message);
        else setItems(data ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [query, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Elegir gestor</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={styles.input}
            placeholder="Buscar por nombre"
            placeholderTextColor={COLORS.gray}
          />
          {loading ? (
            <ActivityIndicator color={COLORS.red} style={{ marginVertical: SPACING.md }} />
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it) => it.id}
              style={{ maxHeight: 280 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.gestorRow} onPress={() => onPick(item)}>
                  <Text style={styles.gestorName}>{item.nombre}</Text>
                  <Text style={styles.subText}>{item.correo}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.subText}>Sin gestores que coincidan.</Text>
              }
            />
          )}
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Solicitud de reserva (card para cancha_admin) ─────────────────────────
function fmt12c(h) {
  const [hr, mn] = h.split(':').map(Number);
  return `${hr % 12 || 12}:${mn.toString().padStart(2, '0')}${hr >= 12 ? 'pm' : 'am'}`;
}

function ReservaRequestCard({ reserva, canchasMap, onResolved }) {
  const [loading, setLoading] = useState(false);
  const gestor = reserva.gestor ?? {};
  const tarifa = reserva.tarifa ?? {};

  function fmtFecha(d) {
    if (!d) return '';
    const dt  = new Date(d + 'T12:00:00');
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const mes  = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${dias[dt.getDay()]} ${dt.getDate()} ${mes[dt.getMonth()]}`;
  }

  async function respond(newStatus) {
    setLoading(true);
    try {
      const { error } = await supabase.from('cancha_reservas').update({ status: newStatus }).eq('id', reserva.id);
      if (error) throw error;
      onResolved();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo actualizar');
    } finally {
      setLoading(false);
    }
  }

  const canchaName = reserva.cancha_id ? (canchasMap[reserva.cancha_id]?.nombre ?? '') : '';

  return (
    <View style={styles.reservaCard}>
      <View style={{ marginBottom: SPACING.xs }}>
        <Text style={styles.reservaGestor}>{gestor.nombre ?? 'Gestor'}</Text>
        {!!gestor.telefono && <Text style={styles.reservaDetail}>{gestor.telefono}</Text>}
        <Text style={styles.reservaDetail}>
          {fmtFecha(reserva.fecha)}  {reserva.hora_inicio ? fmt12c(reserva.hora_inicio) : ''}
          {reserva.hora_fin ? ` – ${fmt12c(reserva.hora_fin)}` : ''}
        </Text>
        {tarifa.deporte && (
          <Text style={styles.reservaDetail}>
            {tarifa.deporte} {tarifa.formato_jpe}v{tarifa.formato_jpe}
          </Text>
        )}
        {canchaName && <Text style={styles.reservaDetail}>{canchaName}</Text>}
        {reserva.monto_total > 0 && (
          <Text style={[styles.reservaDetail, { color: COLORS.gold }]}>
            ${Number(reserva.monto_total).toFixed(2)}
            {reserva.deposito_pagado > 0 ? ` · abono $${Number(reserva.deposito_pagado).toFixed(2)}` : ''}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <TouchableOpacity
          style={[styles.primaryBtn, { flex: 1, backgroundColor: COLORS.neon + '22', borderWidth: 1, borderColor: COLORS.neon }]}
          onPress={() => respond('approved')} disabled={loading}
        >
          {loading ? <ActivityIndicator size="small" color={COLORS.neon} />
            : <Text style={[styles.primaryBtnText, { color: COLORS.neon }]}>✓ Aprobar</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, { flex: 1, backgroundColor: COLORS.red + '22', borderWidth: 1, borderColor: COLORS.red }]}
          onPress={() => respond('rejected')} disabled={loading}
        >
          <Text style={[styles.primaryBtnText, { color: COLORS.red }]}>✗ Rechazar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Estilos ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  emptyWrap: { padding: SPACING.lg, alignItems: 'center', marginTop: SPACING.xl },
  title:      { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 1 },
  subText:    { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, marginTop: 2 },
  section:    { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, marginTop: SPACING.lg, marginBottom: SPACING.sm, letterSpacing: 0.5 },
  emptyText:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, textAlign: 'center', marginVertical: SPACING.md },
  linkText:   { fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.gold },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  row:       { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm },

  primaryBtn: {
    backgroundColor: COLORS.red, paddingVertical: 12, paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md, alignItems: 'center', minWidth: 140,
  },
  primaryBtnText: { fontFamily: FONTS.bodyBold, color: COLORS.white, fontSize: 14, letterSpacing: 0.5 },


  secondaryBtn: {
    backgroundColor: COLORS.card2, paddingVertical: 12, paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md, alignItems: 'center', minWidth: 100, marginRight: SPACING.sm,
  },
  secondaryBtnText: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 13 },

  dangerBtn: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.red,
    paddingVertical: 8, borderRadius: RADIUS.sm, alignItems: 'center', marginTop: SPACING.sm,
  },
  dangerBtnText: { fontFamily: FONTS.bodySemiBold, color: COLORS.red, fontSize: 12 },

  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.card2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate:   { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, textTransform: 'uppercase' },
  cardTime:   { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.gold, marginTop: 4 },
  lockText:      { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.purple2, marginTop: 4 },
  claimText:     { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.green, marginTop: 4 },
  externalText:  { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: '#E67E22', marginTop: 4 },
  cardExternal:  { borderColor: '#E67E22' },
  cardActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.sm },
  waBtn: {
    backgroundColor: '#25D366', paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: RADIUS.sm, alignItems: 'center',
  },
  waBtnText: { fontFamily: FONTS.bodyBold, color: '#fff', fontSize: 12 },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
  badgeText: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.white, letterSpacing: 0.5 },

  modalRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: SPACING.md },
  modalCard: { backgroundColor: COLORS.bg2, borderRadius: RADIUS.lg, padding: SPACING.lg, maxHeight: '90%' },
  modalTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, marginBottom: SPACING.md, letterSpacing: 1 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.md },

  label: { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.gray2, marginTop: SPACING.sm, marginBottom: 4, letterSpacing: 0.3 },
  input: {
    backgroundColor: COLORS.card, color: COLORS.white, paddingHorizontal: SPACING.md,
    paddingVertical: 10, borderRadius: RADIUS.sm, fontFamily: FONTS.body, fontSize: 14,
    borderWidth: 1, borderColor: COLORS.card2,
  },

  toggleRow: { flexDirection: 'row', marginTop: 4 },
  toggle: {
    flex: 1, paddingVertical: 10, borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card, alignItems: 'center', marginRight: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.card2,
  },
  toggleActive:         { backgroundColor: COLORS.purple, borderColor: COLORS.purple2 },
  toggleActiveExternal: { backgroundColor: '#5D4037', borderColor: '#E67E22' },
  externalBox: { backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.sm, marginTop: SPACING.sm, borderWidth: 1, borderColor: '#E67E22' },
  toggleText:   { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.gray2 },
  toggleTextActive: { color: COLORS.white },

  gestorPickerBtn: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.md,
    marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.purple,
  },
  gestorPickerText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },

  gestorRow: { paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.card2 },
  gestorName: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white },

  reservaCard: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.gold,
  },
  reservaGestor: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, marginBottom: 2 },
  reservaDetail: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginBottom: 1 },

  canchaSection: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.card2,
  },
  canchaHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.sm },
  canchaTitle:  { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 0.5 },

  tarifaText: { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.gold, marginTop: 4 },
  tarifaRow: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.sm,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.card2,
  },
  tarifaChip: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.card2, minWidth: 110, alignItems: 'center',
  },
  tarifaChipActive: { borderColor: COLORS.gold, backgroundColor: COLORS.gold + '22' },
  tarifaChipText:   { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gray2 },
  tarifaChipPrice:  { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.gray, marginTop: 2 },
  tarifaChipSub:    { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: 1 },
});
