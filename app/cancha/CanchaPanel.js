import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator, FlatList,
  KeyboardAvoidingView, Platform,
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
  const { user } = useAuthStore();
  const [cancha, setCancha]   = useState(null);
  const [slots, setSlots]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showCancha, setShowCancha] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: canchas, error: cErr } = await supabase
        .from('canchas')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;

      const mine = canchas?.[0] ?? null;
      setCancha(mine);

      if (mine) {
        const { data: ss, error: sErr } = await supabase
          .from('cancha_slots')
          .select(`
            id, fecha, hora_inicio, hora_fin, precio_hora,
            visibility, reserved_for_gestor_id, status, notas,
            reserved_for_gestor:reserved_for_gestor_id ( id, nombre ),
            cancha_slot_reservas ( id, status, gestor:gestor_id ( id, nombre ) )
          `)
          .eq('cancha_id', mine.id)
          .gte('fecha', todayIso())
          .order('fecha', { ascending: true })
          .order('hora_inicio', { ascending: true });
        if (sErr) throw sErr;
        setSlots(ss ?? []);
      } else {
        setSlots([]);
      }
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo cargar la cancha');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.red} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!cancha) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyWrap}>
          <Text style={styles.title}>Panel de cancha</Text>
          <Text style={styles.emptyText}>
            Todavía no registraste tu cancha. Crea una para publicar horarios libres.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowCancha(true)}>
            <Text style={styles.primaryBtnText}>Registrar mi cancha</Text>
          </TouchableOpacity>
        </View>
        <CanchaFormModal
          visible={showCancha}
          onClose={() => setShowCancha(false)}
          onSaved={fetchAll}
          userId={user.id}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{cancha.nombre}</Text>
            {!!cancha.direccion && <Text style={styles.subText}>{cancha.direccion}</Text>}
          </View>
          <TouchableOpacity onPress={() => setShowCancha(true)}>
            <Text style={styles.linkText}>Editar</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={() => setShowNew(true)}>
            <Text style={styles.primaryBtnText}>+ Nuevo slot</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>Horarios próximos ({slots.length})</Text>

        {slots.length === 0 ? (
          <Text style={styles.subText}>No tienes slots publicados.</Text>
        ) : (
          slots.map((s) => (
            <SlotCard key={s.id} slot={s} onChange={fetchAll} />
          ))
        )}
      </ScrollView>

      <NewSlotModal
        visible={showNew}
        onClose={() => setShowNew(false)}
        onSaved={fetchAll}
        canchaId={cancha.id}
        precioDefault={cancha.precio_hora}
      />
      <CanchaFormModal
        visible={showCancha}
        onClose={() => setShowCancha(false)}
        onSaved={fetchAll}
        userId={user.id}
        existing={cancha}
      />
    </SafeAreaView>
  );
}

// ── Slot card ──────────────────────────────────────────────────────────────
function SlotCard({ slot, onChange }) {
  const reserva = slot.cancha_slot_reservas?.find((r) => r.status === 'reserved' || r.status === 'converted');
  const isReservedForGestor = slot.visibility === 'reserved_for_gestor';
  const reservedFor = slot.reserved_for_gestor?.nombre;
  const claimedBy = reserva?.gestor?.nombre;

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

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardDate}>{fmtDate(slot.fecha)}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[slot.status] }]}>
          <Text style={styles.badgeText}>{slot.status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.cardTime}>{fmtTime(slot.hora_inicio)} – {fmtTime(slot.hora_fin)}</Text>
      {slot.precio_hora != null && (
        <Text style={styles.subText}>${Number(slot.precio_hora).toFixed(2)} / hora</Text>
      )}
      {isReservedForGestor && (
        <Text style={styles.lockText}>🔒 Bloqueado para: {reservedFor ?? '—'}</Text>
      )}
      {claimedBy && (
        <Text style={styles.claimText}>✓ Reclamado por: {claimedBy}</Text>
      )}
      {!!slot.notas && <Text style={styles.subText}>{slot.notas}</Text>}

      {slot.status === 'available' && (
        <TouchableOpacity style={styles.dangerBtn} onPress={handleCancel}>
          <Text style={styles.dangerBtnText}>Cancelar slot</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Modal: Registrar / editar cancha ───────────────────────────────────────
function CanchaFormModal({ visible, onClose, onSaved, userId, existing }) {
  const [nombre,    setNombre]    = useState(existing?.nombre ?? '');
  const [direccion, setDireccion] = useState(existing?.direccion ?? '');
  const [telefono,  setTelefono]  = useState(existing?.telefono ?? '');
  const [precio,    setPrecio]    = useState(existing?.precio_hora?.toString() ?? '');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (visible) {
      setNombre(existing?.nombre ?? '');
      setDireccion(existing?.direccion ?? '');
      setTelefono(existing?.telefono ?? '');
      setPrecio(existing?.precio_hora?.toString() ?? '');
    }
  }, [visible, existing]);

  async function handleSave() {
    if (!nombre.trim()) {
      Alert.alert('Falta nombre', 'El nombre de la cancha es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre: nombre.trim(),
        direccion: direccion.trim() || null,
        telefono: telefono.trim() || null,
        precio_hora: precio ? Number(precio) : null,
      };
      if (existing?.id) {
        const { error } = await supabase
          .from('canchas')
          .update(payload)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('canchas')
          .insert({ ...payload, owner_id: userId });
        if (error) throw error;
      }
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo guardar');
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
          <TextInput value={nombre} onChangeText={setNombre} style={styles.input} placeholder="Cancha El Dorado" placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Dirección</Text>
          <TextInput value={direccion} onChangeText={setDireccion} style={styles.input} placeholder="Calle, distrito, referencia" placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Teléfono</Text>
          <TextInput value={telefono} onChangeText={setTelefono} style={styles.input} keyboardType="phone-pad" placeholder="6000-0000" placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Precio por hora ($)</Text>
          <TextInput value={precio} onChangeText={setPrecio} style={styles.input} keyboardType="decimal-pad" placeholder="25.00" placeholderTextColor={COLORS.gray} />

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
function NewSlotModal({ visible, onClose, onSaved, canchaId, precioDefault }) {
  const [fecha,    setFecha]    = useState(todayIso());
  const [horaIni,  setHoraIni]  = useState('18:00');
  const [horaFin,  setHoraFin]  = useState('20:00');
  const [precio,   setPrecio]   = useState(precioDefault?.toString() ?? '');
  const [notas,    setNotas]    = useState('');
  const [visibility, setVisibility] = useState('public');
  const [reservedFor, setReservedFor] = useState(null);  // { id, nombre }
  const [showGestorPicker, setShowGestorPicker] = useState(false);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    if (visible) {
      setFecha(todayIso());
      setHoraIni('18:00');
      setHoraFin('20:00');
      setPrecio(precioDefault?.toString() ?? '');
      setNotas('');
      setVisibility('public');
      setReservedFor(null);
    }
  }, [visible, precioDefault]);

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
    setSaving(true);
    try {
      const { error } = await supabase.from('cancha_slots').insert({
        cancha_id: canchaId,
        fecha,
        hora_inicio: horaIni + ':00',
        hora_fin:    horaFin + ':00',
        precio_hora: precio ? Number(precio) : null,
        visibility,
        reserved_for_gestor_id: visibility === 'reserved_for_gestor' ? reservedFor.id : null,
        notas: notas.trim() || null,
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

            <Text style={styles.label}>Precio por hora ($)</Text>
            <TextInput value={precio} onChangeText={setPrecio} style={styles.input} keyboardType="decimal-pad" placeholder="25.00" placeholderTextColor={COLORS.gray} />

            <Text style={styles.label}>Notas</Text>
            <TextInput value={notas} onChangeText={setNotas} style={[styles.input, { height: 60 }]} multiline placeholder="Cancha sintética, iluminación, etc." placeholderTextColor={COLORS.gray} />

            <Text style={styles.label}>Visibilidad</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[styles.toggle, visibility === 'public' && styles.toggleActive]}
                onPress={() => setVisibility('public')}
              >
                <Text style={[styles.toggleText, visibility === 'public' && styles.toggleTextActive]}>
                  Público
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggle, visibility === 'reserved_for_gestor' && styles.toggleActive]}
                onPress={() => setVisibility('reserved_for_gestor')}
              >
                <Text style={[styles.toggleText, visibility === 'reserved_for_gestor' && styles.toggleTextActive]}>
                  Bloquear para gestor
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
  lockText:   { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.purple2, marginTop: 4 },
  claimText:  { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.green, marginTop: 4 },

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
  toggleActive: { backgroundColor: COLORS.purple, borderColor: COLORS.purple2 },
  toggleText:   { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.gray2 },
  toggleTextActive: { color: COLORS.white },

  gestorPickerBtn: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.sm, padding: SPACING.md,
    marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.purple,
  },
  gestorPickerText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14 },

  gestorRow: { paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.card2 },
  gestorName: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white },
});
