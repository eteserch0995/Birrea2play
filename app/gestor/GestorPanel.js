import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Modal, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { createStackNavigator } from '@react-navigation/stack';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import Constants from 'expo-constants';

const APP_VERSION = Constants.expoConfig?.version ?? Constants.manifest?.version ?? '1.1.3';
const BUILD_NUMBER = Constants.nativeBuildVersion ?? '14';
import { supabase } from '../../lib/supabase';
import { sendLocalNotification, sendPushNotificationsToEventPlayers } from '../../lib/notifications';
import useAuthStore from '../../store/authStore';
import { DateField, TimeField } from '../../components/DateTimeField';
import { uploadImage } from '../../lib/uploadImage';
import { processEventImage } from '../../lib/processEventImage';
import { shareEvent } from '../../lib/shareEvent';
import { filterActiveEventGuests } from '../../lib/eventGuests';
import GananciaCard from '../../components/GananciaCard';
import {
  generateLigaFixture,
  generateGroupStageFixture,
  generateKnockoutBracket,
  generateRoundRobin,
  generate2VidasFixture,
  applyVidaLossFor2Vidas,
  ensure2VidasFinalIfReady,
  populateNextKnockoutPhase,
  computeStandingsFromMatches,
  detectGroupTiesNeedingDecision,
  getQualifiedTeams,
  populateKnockoutFromGroups,
  isGroupStageComplete,
  getTournamentWinner,
  TEAM_COLORS,
  calcTeams,
} from '../../lib/eventHelpers';

const Stack = createStackNavigator();

const PHASE_LABELS = {
  grupos:       'FASE DE GRUPOS',
  octavos:      '🎯 OCTAVOS DE FINAL',
  cuartos:      '⚡ CUARTOS DE FINAL',
  semis:        '🥊 SEMIFINALES',
  tercer_lugar: '🥉 3ER LUGAR',
  final:        '🏆 FINAL',
};

// ── Dashboard Gestor ───────────────────────────────────────────────────────
function GestorDashboard({ navigation }) {
  const { user } = useAuthStore();
  const [events,          setEvents]          = useState([]);
  const [selectedEvent,   setSelectedEvent]   = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [cashPending,     setCashPending]      = useState(0);

  // Refresh whenever the screen is focused (so newly created events appear)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => { fetchEvents(); fetchCashPending(); });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => { fetchEvents(); fetchCashPending(); }, []);

  async function fetchCashPending() {
    if (!user?.id) return;
    try {
      // Limpiar expirados antes de contar — fire-and-forget, no bloquea la UI
      Promise.resolve(supabase.rpc('expire_pending_cash_requests')).catch(() => {});
      Promise.resolve(supabase.rpc('expire_pending_guests')).catch(() => {});

      const { data: evs } = await supabase
        .from('events')
        .select('id')
        .eq('created_by', user.id);
      if (!evs?.length) { setCashPending(0); return; }
      const eventIds = evs.map((e) => e.id);
      const nowIso       = new Date().toISOString();
      const guestCutoff  = new Date(Date.now() - 24 * 3600_000).toISOString();
      const [{ count: regs }, { count: guests }] = await Promise.all([
        supabase.from('cash_payment_requests').select('id', { count: 'exact', head: true })
          .in('event_id', eventIds).eq('status', 'pending')
          .gt('expires_at', nowIso),
        supabase.from('event_guests').select('id', { count: 'exact', head: true })
          .in('event_id', eventIds).eq('status', 'pending_payment').eq('metodo_pago', 'efectivo')
          .gt('created_at', guestCutoff),
      ]);
      setCashPending((regs ?? 0) + (guests ?? 0));
    } catch { /* non-critical */ }
  }

  async function fetchEvents() {
    if (!user?.id) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('created_by', user.id)           // solo eventos propios
        .in('status', ['draft', 'open', 'active'])
        .order('fecha', { ascending: true });
      if (error) throw error;
      setEvents(data ?? []);
    } catch (e) {
      console.warn('GestorDashboard fetchEvents error:', e.message);
      // WC fix M6: mostrar error en lugar de lista vacía engañosa
      Alert.alert('Error de conexión', 'No se pudieron cargar tus eventos. Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  }

  const sections = [
    { label: 'Equipos',    icon: '🎽', route: 'GestorTeams'        },
    { label: 'Jornadas',   icon: '📆', route: 'GestorMatches'       },
    { label: 'Resultados', icon: '⚽', route: 'GestorResults'       },
    { label: 'MVP',        icon: '🏆', route: 'GestorMvp'           },
    { label: 'Config',     icon: '⚙️', route: 'GestorConfig'        },
    { label: 'Ventas',     icon: '💵', route: 'GestorVentas'        },
    { label: 'Efectivo',   icon: '💵', route: 'GestorCashApprovals' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView>
        {/* Header with "Crear evento" button */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: SPACING.md }}>
          <Text style={styles.title}>PANEL GESTOR</Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: COLORS.red, paddingHorizontal: SPACING.md, flex: 0 }]}
            onPress={() => navigation.navigate('GestorCreateEvent')}
          >
            <Text style={styles.btnText}>+ Crear evento</Text>
          </TouchableOpacity>
        </View>

        {/* Acceso rápido a pagos en efectivo pendientes */}
        <TouchableOpacity
          style={{ marginHorizontal: SPACING.md, marginBottom: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: cashPending > 0 ? COLORS.gold : COLORS.navy, flexDirection: 'row', alignItems: 'center', padding: SPACING.md, gap: SPACING.sm }}
          onPress={() => navigation.navigate('GestorCashApprovals', {})}
        >
          <Text style={{ fontSize: 20 }}>💵</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 14 }}>Pagos en Efectivo</Text>
            <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 12 }}>
              {cashPending > 0 ? `${cashPending} solicitud(es) pendiente(s)` : 'Sin solicitudes pendientes'}
            </Text>
          </View>
          {cashPending > 0 && (
            <View style={{ backgroundColor: COLORS.red, borderRadius: 10, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text style={{ color: COLORS.white, fontSize: 11, fontFamily: FONTS.bodyMedium }}>{cashPending}</Text>
            </View>
          )}
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={COLORS.red} style={{ margin: SPACING.xl }} />
        ) : events.length === 0 ? (
          <Text style={styles.empty}>No tienes eventos activos. Crea uno con el botón de arriba.</Text>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Mis eventos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: SPACING.md, marginBottom: SPACING.md }}>
              {events.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[styles.eventChip, selectedEvent?.id === ev.id && styles.eventChipActive]}
                  onPress={() => setSelectedEvent(ev)}
                >
                  <Text style={[styles.eventChipText, selectedEvent?.id === ev.id && { color: COLORS.white }]}>{ev.nombre}</Text>
                  <Text style={[styles.eventChipSub,  selectedEvent?.id === ev.id && { color: COLORS.white + 'AA' }]}>{ev.formato} · {ev.status?.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {selectedEvent && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md }}>
              <Text style={[styles.selectedEvent, { paddingHorizontal: 0, flex: 1 }]}>{selectedEvent.nombre}</Text>
              <TouchableOpacity
                onPress={async () => {
                  const [{ data: regs }, { data: gs }] = await Promise.all([
                    supabase.from('event_registrations').select('users(nombre, genero)').eq('event_id', selectedEvent.id).eq('status', 'confirmed'),
                    supabase.from('event_guests').select('nombre').eq('event_id', selectedEvent.id).eq('status', 'confirmed'),
                  ]);
                  const jugadores = [
                    ...(regs ?? []).filter(r => r.users?.nombre).map(r => ({ nombre: r.users.nombre, genero: r.users.genero })),
                    ...(gs ?? []).filter(g => g.nombre).map(g => ({ nombre: g.nombre, genero: g.genero ?? null })),
                  ];
                  shareEvent(selectedEvent, { inscritos: jugadores.length, jugadores });
                }}
                style={{ paddingHorizontal: SPACING.sm, paddingVertical: 4, backgroundColor: COLORS.card, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.navy, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                accessibilityLabel="Compartir evento"
              >
                <Text style={{ fontSize: 14 }}>📤</Text>
                <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 11, letterSpacing: 0.5 }}>COMPARTIR</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.menuGrid}>
              {sections.map((s) => {
                const badge = s.route === 'GestorCashApprovals' && cashPending > 0 ? cashPending : 0;
                return (
                  <TouchableOpacity
                    key={s.route}
                    style={styles.menuCard}
                    onPress={() => navigation.navigate(s.route, { eventId: selectedEvent.id })}
                  >
                    <View>
                      <Text style={styles.menuIcon}>{s.icon}</Text>
                      {badge > 0 && (
                        <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: COLORS.red, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                          <Text style={{ color: COLORS.white, fontSize: 9, fontFamily: FONTS.bodyMedium }}>{badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.menuLabel}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
        <View style={{ height: SPACING.sm }} />
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center', paddingBottom: SPACING.md }}>
          v{APP_VERSION} (build {BUILD_NUMBER})
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Crear Evento (gestor) ──────────────────────────────────────────────────
function GestorCreateEvent({ navigation }) {
  const { user } = useAuthStore();
  const [saving, setSaving]           = useState(false);
  const [canchaImageUri, setCanchaUri] = useState(null);
  const [form, setForm] = useState({
    nombre: '', formato: 'Liga', deporte: 'Fútbol 7', fecha: '', hora: '',
    lugar: '', direccion: '', precio: '0', cupos_total: '', cupos_ilimitado: false,
    descripcion: '', jugadores_por_equipo: null, jornadas: '1',
    num_grupos: '2', equipos_por_grupo: '3',
    tiene_octavos: false, tiene_cuartos: false,
    tiene_semis: true, tiene_tercer_lugar: true, tiene_final: true,
    ida_y_vuelta: false, maps_url: '', genero: null,
    vidas_por_equipo: 3,
  });

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cuposNum = parseInt(form.cupos_total) || 0;

  const pickCanchaPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Habilitá el acceso a tus fotos para poder subir la imagen del evento.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: Platform.OS !== 'web', aspect: [16, 9], quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      const processed = await processEventImage(Platform.OS === 'web' ? asset : asset.uri);
      setCanchaUri(processed);
    } catch (e) {
      Alert.alert('No se pudo procesar la imagen', e.message || 'Probá con otra foto.');
    }
  };

  const uploadCanchaPhoto = async (source, eventId) => {
    const path = `events/${eventId}_${Date.now()}.jpg`;
    return uploadImage('event-photos', path, source);
  };
  const teamCalc = form.jugadores_por_equipo && cuposNum
    ? calcTeams(cuposNum, form.jugadores_por_equipo) : null;

  async function saveEvent() {
    if (!form.nombre.trim() || !form.fecha || !form.hora || !form.lugar.trim()) {
      Alert.alert('Error', 'Nombre, fecha, hora y lugar son obligatorios.'); return;
    }
    // BUG FIX: validate fecha is not in the past
    const eventDateTime = new Date(`${form.fecha}T${form.hora}`);
    if (isNaN(eventDateTime.getTime())) {
      Alert.alert('Fecha inválida', 'Usa el formato YYYY-MM-DD y HH:MM.'); return;
    }
    if (eventDateTime < new Date()) {
      Alert.alert('Fecha inválida', 'La fecha del evento no puede ser en el pasado.'); return;
    }
    // BUG FIX: validate cupos > 0 when not ilimitado
    if (!form.cupos_ilimitado) {
      const cuposVal = parseInt(form.cupos_total);
      if (!cuposVal || cuposVal <= 0) {
        Alert.alert('Cupos inválidos', 'Los cupos deben ser mayor a 0, o activa "Cupos ilimitados".'); return;
      }
    }
    // BUG FIX: validate precio is a valid non-negative number (0 = gratis, handled fine)
    const precioVal = parseFloat(form.precio);
    if (isNaN(precioVal) || precioVal < 0) {
      Alert.alert('Precio inválido', 'El precio debe ser 0 (gratis) o un monto positivo.'); return;
    }
    // Cupos must be exact multiple of jugadores_por_equipo — HARD BLOCK
    if (teamCalc && !teamCalc.esExacto) {
      const jpq  = form.jugadores_por_equipo;
      const numEq = Math.floor(cuposNum / jpq);
      Alert.alert(
        'Cupos inválidos',
        `Con ${jpq} jugadores por equipo, los cupos deben ser múltiplo de ${jpq}.\n\n• ${numEq} equipos → ${numEq * jpq} cupos\n• ${numEq + 1} equipos → ${(numEq + 1) * jpq} cupos`
      );
      return;
    }
    setSaving(true);
    try {
      const { data: created, error } = await supabase.from('events').insert({
        nombre:              form.nombre.trim(),
        formato:             form.formato,
        deporte:             form.deporte,
        fecha:               form.fecha,
        hora:                form.hora,
        lugar:               form.lugar.trim(),
        direccion:           form.direccion.trim() || null,
        precio:              precioVal,
        cupos_total:         form.cupos_ilimitado ? null : (parseInt(form.cupos_total) || null),
        cupos_ilimitado:     form.cupos_ilimitado,
        descripcion:         form.descripcion || null,
        status:              'draft',
        visible:             false,
        created_by:          user?.id,
        jugadores_por_equipo:form.jugadores_por_equipo,
        genero:              form.genero || null,
        jornadas:            form.formato === 'Liga' ? (parseInt(form.jornadas) || 1) : 1,
        num_grupos:          form.formato === 'Torneo' ? (parseInt(form.num_grupos) || 2) : null,
        equipos_por_grupo:   form.formato === 'Torneo' ? (parseInt(form.equipos_por_grupo) || 3) : null,
        tiene_octavos:       form.formato === 'Torneo' ? form.tiene_octavos : false,
        tiene_cuartos:       form.formato === 'Torneo' ? form.tiene_cuartos : false,
        tiene_semis:         form.formato === 'Torneo' ? form.tiene_semis : false,
        tiene_tercer_lugar:  form.formato === 'Torneo' ? form.tiene_tercer_lugar : false,
        tiene_final:         form.formato === 'Torneo' ? form.tiene_final : false,
        ida_y_vuelta:        form.ida_y_vuelta,
        maps_url:            form.maps_url.trim() || null,
        vidas_por_equipo:    form.formato === '2 Vidas' ? (form.vidas_por_equipo ?? 3) : null,
      }).select('id').single();
      if (error) throw error;

      // Upload court photo if selected
      if (canchaImageUri && created?.id) {
        try {
          const photoUrl = await uploadCanchaPhoto(canchaImageUri, created.id);
          await supabase.from('events').update({ cancha_foto_url: photoUrl }).eq('id', created.id);
        } catch (_) {}
      }

      Alert.alert('¡Evento creado!', `"${form.nombre}" creado en borrador. Ve a Config para publicarlo cuando esté listo.`);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white }}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { padding: 0, flex: 1 }]}>NUEVO EVENTO</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: 60 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Nombre *</Text>
        <TextInput style={styles.input} placeholder="Nombre del evento" placeholderTextColor={COLORS.gray} value={form.nombre} onChangeText={(v) => upd('nombre', v)} />

        <Text style={styles.fieldLabel}>Deporte</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm }}>
            {['Fútbol','Fútbol 7','Fútbol Sala','Volleyball','Pádel','Basketball','Otro'].map((d) => (
              <TouchableOpacity key={d} style={[styles.chip, form.deporte === d && styles.chipActive]} onPress={() => upd('deporte', d)}>
                <Text style={[styles.chipText, form.deporte === d && { color: COLORS.white }]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.fieldLabel}>Formato</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm }}>
          {['Liga','Torneo','Amistoso','2 Vidas'].map((f) => (
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
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              {[2, 3].map((v) => (
                <TouchableOpacity key={v} style={[styles.chip, (form.vidas_por_equipo ?? 3) === v && styles.chipActive]} onPress={() => upd('vidas_por_equipo', v)}>
                  <Text style={[styles.chipText, (form.vidas_por_equipo ?? 3) === v && { color: COLORS.white }]}>{v} vidas</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.fieldLabel}>Género</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm }}>
          {[null, 'Masculino', 'Femenino', 'Mixto'].map((g) => (
            <TouchableOpacity key={String(g)} style={[styles.chip, form.genero === g && styles.chipActive]} onPress={() => upd('genero', g)}>
              <Text style={[styles.chipText, form.genero === g && { color: COLORS.white }]}>{g ?? 'Todos'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Fecha *</Text>
        <DateField style={styles.input} value={form.fecha} onChange={(v) => upd('fecha', v)} />

        <Text style={styles.fieldLabel}>Hora *</Text>
        <TimeField style={styles.input} value={form.hora} onChange={(v) => upd('hora', v)} />

        <Text style={styles.fieldLabel}>Lugar *</Text>
        <TextInput style={styles.input} placeholder="Cancha / Estadio" placeholderTextColor={COLORS.gray} value={form.lugar} onChangeText={(v) => upd('lugar', v)} />

        <Text style={styles.fieldLabel}>Dirección (opcional)</Text>
        <TextInput style={styles.input} placeholder="Calle, barrio, ciudad..." placeholderTextColor={COLORS.gray} value={form.direccion} onChangeText={(v) => upd('direccion', v)} />

        <Text style={styles.fieldLabel}>Link de Google Maps (opcional)</Text>
        <TextInput style={styles.input} placeholder="https://maps.google.com/..." placeholderTextColor={COLORS.gray} autoCapitalize="none" autoCorrect={false} value={form.maps_url} onChangeText={(v) => upd('maps_url', v)} />

        <Text style={styles.fieldLabel}>Foto de la cancha (opcional)</Text>
        <TouchableOpacity style={[styles.input, { alignItems: 'center', justifyContent: 'center', minHeight: 80 }]} onPress={pickCanchaPhoto}>
          {canchaImageUri
            ? <Image source={{ uri: typeof canchaImageUri === 'string' ? canchaImageUri : (canchaImageUri.previewUrl || canchaImageUri.uri) }} style={{ width: '100%', height: 120, borderRadius: RADIUS.sm }} resizeMode="cover" />
            : <Text style={{ color: COLORS.gray, fontFamily: FONTS.body }}>📷 Agregar foto de cancha</Text>
          }
        </TouchableOpacity>

        <Text style={styles.fieldLabel}>Precio ($) — deja 0 para gratis</Text>
        <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={COLORS.gray} keyboardType="decimal-pad" value={form.precio} onChangeText={(v) => upd('precio', v)} />

        {/* Cupos */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm }}>
          <Text style={styles.fieldLabel}>Cupos ilimitados</Text>
          <TouchableOpacity
            style={[styles.toggle, form.cupos_ilimitado && styles.toggleActive]}
            onPress={() => upd('cupos_ilimitado', !form.cupos_ilimitado)}
          >
            <Text style={styles.toggleText}>{form.cupos_ilimitado ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
        {!form.cupos_ilimitado && (
          <>
            <Text style={styles.fieldLabel}>Cupos totales</Text>
            <TextInput style={styles.input} placeholder="20" placeholderTextColor={COLORS.gray} keyboardType="number-pad" value={form.cupos_total} onChangeText={(v) => upd('cupos_total', v)} />
          </>
        )}

        <Text style={styles.fieldLabel}>Jugadores por equipo</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm }}>
          {[null, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
            <TouchableOpacity key={String(n)} style={[styles.chip, form.jugadores_por_equipo === n && styles.chipActive]} onPress={() => upd('jugadores_por_equipo', n)}>
              <Text style={[styles.chipText, form.jugadores_por_equipo === n && { color: COLORS.white }]}>{n === null ? 'Libre' : `${n}v${n}`}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {teamCalc && (
          <View style={[styles.card, { borderColor: teamCalc.esExacto ? COLORS.green : COLORS.gold }]}>
            <Text style={{ fontFamily: FONTS.bodyMedium, color: teamCalc.esExacto ? COLORS.green : COLORS.gold, fontSize: 13 }}>
              {teamCalc.esExacto
                ? `✓ ${teamCalc.numEquipos} equipos de ${form.jugadores_por_equipo} jugadores`
                : `⚠ ${teamCalc.numEquipos} equipos + ${teamCalc.sobrantes} sobrante(s). Recomendado: ${teamCalc.sugerido} cupos`
              }
            </Text>
          </View>
        )}

        {/* Liga: jornadas */}
        {form.formato === 'Liga' && (
          <>
            <Text style={styles.fieldLabel}>Jornadas (vueltas)</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
              {['1','2','3'].map((j) => (
                <TouchableOpacity key={j} style={[styles.chip, form.jornadas === j && styles.chipActive]} onPress={() => upd('jornadas', j)}>
                  <Text style={[styles.chipText, form.jornadas === j && { color: COLORS.white }]}>{j}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm }}>
              <TouchableOpacity
                style={[styles.chip, form.ida_y_vuelta && styles.chipActive]}
                onPress={() => upd('ida_y_vuelta', !form.ida_y_vuelta)}
              >
                <Text style={[styles.chipText, form.ida_y_vuelta && { color: COLORS.white }]}>Ida y vuelta</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Torneo: grupos */}
        {form.formato === 'Torneo' && (
          <>
            <Text style={styles.fieldLabel}>Grupos</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' }}>
              {['1','2','3','4'].map((n) => (
                <TouchableOpacity key={n} style={[styles.chip, form.num_grupos === n && styles.chipActive]} onPress={() => upd('num_grupos', n)}>
                  <Text style={[styles.chipText, form.num_grupos === n && { color: COLORS.white }]}>{n === '1' ? 'Grupo único' : `${n} grupos`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {form.num_grupos === '1' && (
              <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 11, marginBottom: SPACING.sm }}>
                ℹ Grupo único: todos los equipos juegan round-robin entre sí. Después avanzan TODOS a fase eliminatoria.
              </Text>
            )}
            <Text style={styles.fieldLabel}>Fases eliminatorias</Text>
            {[['tiene_cuartos','Cuartos de final'],['tiene_semis','Semifinales'],['tiene_tercer_lugar','3er lugar'],['tiene_final','Final']].map(([key, label]) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: 4 }}>
                <TouchableOpacity
                  style={[styles.chip, form[key] && styles.chipActive]}
                  onPress={() => upd(key, !form[key])}
                >
                  <Text style={[styles.chipText, form[key] && { color: COLORS.white }]}>{label}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        <Text style={styles.fieldLabel}>Descripción (opcional)</Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
          placeholder="Detalles del evento..."
          placeholderTextColor={COLORS.gray}
          multiline
          value={form.descripcion}
          onChangeText={(v) => upd('descripcion', v)}
        />

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: COLORS.blue, marginTop: SPACING.md }]}
          onPress={saveEvent}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator color={COLORS.white} size="small" />
            : <Text style={styles.btnText}>✓ Crear evento</Text>
          }
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Equipos ────────────────────────────────────────────────────────────────
function GestorTeams({ route }) {
  const { eventId } = route.params ?? {};
  const [event,           setEvent]           = useState(null);
  const [teams,           setTeams]           = useState([]);
  const [players,         setPlayers]         = useState([]);
  const [mixModal,        setMixModal]        = useState(false);
  const [chicasPorEquipo, setChicasPorEquipo] = useState('1');
  const [editTeamModal,   setEditTeamModal]   = useState(null); // null | team obj
  const [editTeamForm,    setEditTeamForm]    = useState({ nombre: '', color: '' });
  const [assignExpanded,  setAssignExpanded]  = useState(null); // userId being assigned
  const [addPlayerModal,  setAddPlayerModal]  = useState(false);
  const [addPlayerNombre, setAddPlayerNombre] = useState('');
  const [addPlayerGenero, setAddPlayerGenero] = useState(null);
  const [addPlayerSaving, setAddPlayerSaving] = useState(false);

  // Refresh every time the screen comes into focus so new guests appear immediately
  useFocusEffect(useCallback(() => { if (eventId) fetchData(); }, [eventId]));

  async function fetchData() {
    try {
      const [{ data: ev }, { data: t }, { data: regs, error: regsErr }, { data: gs, error: gsErr }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('teams').select('*, team_players(id, user_id, guest_id)').eq('event_id', eventId),
        supabase.from('event_registrations').select('user_id, users(nombre, genero)').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('event_guests').select('id, nombre, genero, status, invited_by').eq('event_id', eventId).in('status', ['confirmed', 'pending_payment']),
      ]);

      console.log('[GestorTeams] EVENT ID:', eventId);
      console.log('[GestorTeams] REGISTRATIONS RAW:', regs);
      console.log('[GestorTeams] GUESTS RAW:', gs);
      if (regsErr) console.warn('[GestorTeams] regs error:', regsErr.message);
      if (gsErr)   console.warn('[GestorTeams] guests error:', gsErr.message);

      setEvent(ev ?? null);
      setTeams(t ?? []);

      const regPlayers = (regs ?? []).map(r => ({
        participantKey: `user:${r.user_id}`,
        user_id:  r.user_id,
        guest_id: null,
        users:    r.users,
        isGuest:  false,
      }));

      const activeGuests = filterActiveEventGuests(gs ?? [], regs ?? []);

      const guestPlayers = activeGuests.map(g => ({
        participantKey: `guest:${g.id}`,
        user_id:  null,
        guest_id: g.id,
        users:    { nombre: g.nombre, genero: g.genero ?? null },
        isGuest:  true,
      }));

      const unified = [...regPlayers, ...guestPlayers];
      console.log('[GestorTeams] REGISTERED PLAYERS:', regPlayers);
      console.log('[GestorTeams] GUEST PLAYERS:', guestPlayers);
      console.log('[GestorTeams] PLAYERS UNIFIED:', unified);
      console.log('[GestorTeams] PLAYERS UNIFIED COUNT:', unified.length);
      console.log('[GestorTeams] TEAMS RAW:', t);
      const allTp = (t ?? []).flatMap(team => team.team_players ?? []);
      console.log('[GestorTeams] TEAM PLAYERS RAW:', allTp);
      console.log('[GestorTeams] TEAM PLAYERS WITHOUT USER OR GUEST:', allTp.filter(tp => !tp.user_id && !tp.guest_id));
      setPlayers(unified);
    } catch (e) {
      console.warn('[GestorTeams] fetchData error:', e.message);
    }
  }

  async function createAutoTeams() {
    const jpq   = event?.jugadores_por_equipo;
    const cupos = event?.cupos_total ?? players.length;
    if (!jpq) { Alert.alert('Error', 'El evento no tiene jugadores por equipo definido.'); return; }
    if (players.length === 0) {
      Alert.alert('Sin jugadores', 'No hay jugadores inscritos ni invitados disponibles para crear equipos.');
      return;
    }

    // Hard block — cupos must be exact multiple of jugadores_por_equipo
    if (jpq && cupos > 0 && cupos % jpq !== 0) {
      const numEq   = Math.floor(cupos / jpq);
      const opcionA = numEq > 0 ? `• ${numEq} equipos → ${numEq * jpq} cupos` : '';
      const opcionB = `• ${numEq + 1} equipos → ${(numEq + 1) * jpq} cupos`;
      Alert.alert(
        '⛔ Cupos inválidos',
        `Con ${jpq} jugadores por equipo, los cupos deben ser múltiplo de ${jpq}.\n\n${opcionA}\n${opcionB}\n\nAjusta los cupos.`
      );
      return;
    }

    const numEquipos = Math.floor(cupos / jpq);
    if (numEquipos < 2) { Alert.alert('Error', 'No hay suficientes cupos para crear 2 o más equipos.'); return; }

    // Guard: si ya hay equipos, confirmar antes de recrear
    if (teams.length > 0) {
      const ok = await new Promise(res =>
        Alert.alert('Equipos existentes', `Ya hay ${teams.length} equipo(s). ¿Eliminarlos y crear nuevos?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
          { text: 'Recrear', style: 'destructive', onPress: () => res(true) },
        ])
      );
      if (!ok) return;
      for (const t of teams) {
        await supabase.from('team_players').delete().eq('team_id', t.id);
      }
      await supabase.from('teams').delete().in('id', teams.map(t => t.id));
    }

    const numGrupos = event?.num_grupos ?? 1;
    const grupos    = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const inserts   = [];
    for (let i = 0; i < numEquipos; i++) {
      const colorEntry = TEAM_COLORS[i % TEAM_COLORS.length];
      const grupoIdx   = event?.formato === 'Torneo'
        ? Math.floor(i / Math.ceil(numEquipos / numGrupos))
        : 0;
      inserts.push({
        event_id: eventId,
        nombre:   colorEntry.nombre,
        color:    colorEntry.color,
        grupo:    grupos[grupoIdx] ?? 'A',
      });
    }
    const { error } = await supabase.from('teams').insert(inserts);
    if (error) { Alert.alert('Error', error.message); return; }
    fetchData();
    const warn = players.length < numEquipos * jpq
      ? `\n⚠️ Solo ${players.length} inscritos — faltan jugadores para llenar todos los cupos.`
      : '';
    Alert.alert('¡Listo!', `${numEquipos} equipos creados.${warn}`);
  }

  function requestAutoAssign() {
    if (players.length === 0) {
      Alert.alert('Sin jugadores', 'No hay jugadores inscritos ni invitados disponibles para asignar.');
      return;
    }
    const hasWomen = players.some((p) => p.users?.genero === 'Femenino');
    if (hasWomen) { setMixModal(true); }
    else { doAutoAssign(0); }
  }

  async function doAutoAssign(chicasCount) {
    if (teams.length === 0) { Alert.alert('Error', 'Crea equipos primero.'); return; }
    setMixModal(false);
    for (const t of teams) {
      await supabase.from('team_players').delete().eq('team_id', t.id);
    }

    // Helper: always pick team with fewest players → perfectly even distribution
    const teamCount = new Array(teams.length).fill(0);
    const nextTeamIdx = () => {
      let min = 0;
      for (let i = 1; i < teamCount.length; i++) if (teamCount[i] < teamCount[min]) min = i;
      teamCount[min]++;
      return min;
    };

    const toInsert = (p, teamId) => ({ team_id: teamId, ...(p.isGuest ? { guest_id: p.guest_id } : { user_id: p.user_id }) });
    const allInserts = [];

    if (chicasCount > 0) {
      const mujeres = players.filter(p => p.users?.genero === 'Femenino').sort(() => Math.random() - 0.5);
      // First: assign exactly chicasCount mujeres per team
      let fi = 0;
      for (let t = 0; t < teams.length; t++) {
        for (let slot = 0; slot < chicasCount && fi < mujeres.length; slot++, fi++) {
          allInserts.push(toInsert(mujeres[fi], teams[t].id));
          teamCount[t]++;
        }
      }
      // Remaining players (extra mujeres + hombres + guests) → fill smallest team
      const rest = [
        ...mujeres.slice(fi),
        ...players.filter(p => p.users?.genero !== 'Femenino'),
      ].sort(() => Math.random() - 0.5);
      for (const p of rest) allInserts.push(toInsert(p, teams[nextTeamIdx()].id));
    } else {
      // Non-mixto: shuffle all, fill smallest team
      const all = [...players].sort(() => Math.random() - 0.5);
      for (const p of all) allInserts.push(toInsert(p, teams[nextTeamIdx()].id));
    }

    if (allInserts.length > 0) {
      const { error } = await supabase.from('team_players').insert(allInserts);
      if (error) { Alert.alert('Error al asignar', error.message); fetchData(); return; }
    }
    fetchData();
    Alert.alert('¡Listo!', `${allInserts.length} jugadores asignados aleatoriamente.`);
  }

  function deleteTeam(team) {
    Alert.alert(
      'Eliminar equipo',
      `¿Eliminar "${team.nombre}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: async () => {
          await supabase.from('team_players').delete().eq('team_id', team.id);
          await supabase.from('teams').delete().eq('id', team.id);
          fetchData();
        }},
      ]
    );
  }

  async function saveTeamEdit() {
    if (!editTeamModal || !editTeamForm.nombre.trim()) return;
    const { error } = await supabase.from('teams').update({ nombre: editTeamForm.nombre.trim(), color: editTeamForm.color }).eq('id', editTeamModal.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setEditTeamModal(null);
    fetchData();
  }

  async function removePlayerFromTeam(teamId, playerId, isGuest = false) {
    const q = supabase.from('team_players').delete().eq('team_id', teamId);
    const { error } = await (isGuest ? q.eq('guest_id', playerId) : q.eq('user_id', playerId));
    if (error) { Alert.alert('Error', error.message); return; }
    fetchData();
  }

  async function assignPlayerToTeam(teamId, playerId, isGuest = false) {
    if (isGuest) {
      await supabase.from('team_players').delete().eq('guest_id', playerId);
      const { error } = await supabase.from('team_players').insert({ team_id: teamId, guest_id: playerId });
      if (error) { Alert.alert('Error', error.message); return; }
    } else {
      await supabase.from('team_players').delete().eq('user_id', playerId);
      const { error } = await supabase.from('team_players').insert({ team_id: teamId, user_id: playerId });
      if (error) { Alert.alert('Error', error.message); return; }
    }
    setAssignExpanded(null);
    fetchData();
  }

  // Map para lookup de nombres sin depender del join anidado de PostgREST
  const playerMap = new Map();
  players.forEach(p => {
    if (p.user_id)  playerMap.set(p.user_id,  p);
    if (p.guest_id) playerMap.set(p.guest_id, p);
  });
  const assignedActiveKeys = new Set(
    teams.flatMap(t => t.team_players ?? []).map(tp => {
      if (tp.guest_id && playerMap.has(tp.guest_id)) return `guest:${tp.guest_id}`;
      if (tp.user_id && playerMap.has(tp.user_id)) return `user:${tp.user_id}`;
      return null;
    }).filter(Boolean)
  );
  const unassigned = players.filter(p => !assignedActiveKeys.has(p.participantKey));
  console.log('[GestorTeams] assignedKeys:', [...assignedActiveKeys]);
  console.log('[GestorTeams] unassigned:', unassigned.length, unassigned);
  const activeTeamPlayers = (team) => (team.team_players ?? []).filter((tp) => {
    if (tp.user_id) return playerMap.has(tp.user_id);
    if (tp.guest_id) return playerMap.has(tp.guest_id);
    return false;
  });

  async function addManualPlayer() {
    if (!addPlayerNombre.trim()) { Alert.alert('Error', 'El nombre es requerido'); return; }
    if (!addPlayerGenero) { Alert.alert('Error', 'El género es requerido'); return; }
    setAddPlayerSaving(true);
    try {
      const { error } = await supabase.from('event_guests').insert({
        event_id:     eventId,
        nombre:       addPlayerNombre.trim(),
        genero:       addPlayerGenero,
        invited_by:   null,
        metodo_pago:  'efectivo',
        monto_pagado: 0,
        status:       'confirmed',
      });
      if (error) throw error;
      setAddPlayerNombre('');
      setAddPlayerGenero(null);
      setAddPlayerModal(false);
      fetchData();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setAddPlayerSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>EQUIPOS</Text>

      {/* Acciones globales */}
      <View style={[styles.btnRow, { paddingHorizontal: SPACING.md }]}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue }]} onPress={createAutoTeams}>
          <Text style={styles.btnText}>⚡ Crear equipos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.purple ?? COLORS.blue }]} onPress={requestAutoAssign}>
          <Text style={styles.btnText}>🎲 Asignar aleatoria</Text>
        </TouchableOpacity>
      </View>
      <View style={{ paddingHorizontal: SPACING.md, marginBottom: SPACING.sm }}>
        <TouchableOpacity
          style={{ backgroundColor: COLORS.green + 'CC', borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center' }}
          onPress={() => { setAddPlayerNombre(''); setAddPlayerModal(true); }}
        >
          <Text style={styles.btnText}>➕ Agregar jugador manualmente</Text>
        </TouchableOpacity>
      </View>

      {/* Resumen */}
      <View style={[styles.card, { flexDirection:'row', flexWrap:'wrap', gap: SPACING.sm, marginHorizontal: SPACING.md, marginBottom: SPACING.sm }]}>
        <Text style={styles.cardSub}>👥 {players.length} inscritos</Text>
        <Text style={styles.cardSub}>🏟 {teams.length} equipos</Text>
        {event?.jugadores_por_equipo && <Text style={styles.cardSub}>⚽ {event.jugadores_por_equipo}v{event.jugadores_por_equipo}</Text>}
        {unassigned.length > 0 && <Text style={[styles.cardSub, { color: COLORS.gold }]}>⚠️ {unassigned.length} sin equipo</Text>}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {teams.length === 0 && <Text style={styles.empty}>Sin equipos. Usa "Crear equipos" primero.</Text>}

        {teams.map((t) => (
          <View key={t.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: t.color ?? COLORS.blue }]}>
            {/* Cabecera */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
              {t.color && <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.color }} />}
              <Text style={[styles.cardName, { flex: 1 }]}>{t.nombre}</Text>
              {t.grupo && (
                <View style={styles.grupoBadge}>
                  <Text style={styles.grupoBadgeText}>GRP {t.grupo}</Text>
                </View>
              )}
              <Text style={styles.cardSub}>{activeTeamPlayers(t).length} jug.</Text>
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: COLORS.blue + '40' }]}
                onPress={() => { setEditTeamModal(t); setEditTeamForm({ nombre: t.nombre, color: t.color ?? '' }); }}
              >
                <Text style={styles.btnSmallText}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSmall, { backgroundColor: COLORS.red + '40' }]}
                onPress={() => deleteTeam(t)}
              >
                <Text style={styles.btnSmallText}>🗑</Text>
              </TouchableOpacity>
            </View>

            {/* Jugadores con botón quitar */}
            {activeTeamPlayers(t).length === 0
              ? <Text style={[styles.cardSub, { fontStyle:'italic', paddingLeft: 18 }]}>Sin jugadores asignados</Text>
              : activeTeamPlayers(t).map((tp) => {
                  if (!tp.user_id && !tp.guest_id) {
                    console.warn('[GestorTeams] team_player sin user_id ni guest_id, id:', tp.id);
                    return null;
                  }
                  const isGuest  = !!tp.guest_id;
                  const playerId = tp.user_id ?? tp.guest_id;
                  const p        = playerMap.get(playerId);
                  if (!p) console.warn('[GestorTeams] jugador en equipo no encontrado en players list, id:', playerId);
                  const nombre   = p
                    ? (p.isGuest ? p.users?.nombre + ' 👤' : p.users?.nombre)
                    : (isGuest ? '? 👤' : '?');
                  const genero   = p?.users?.genero;
                  return (
                    <View key={tp.id} style={{ flexDirection:'row', alignItems:'center', paddingLeft: 18, paddingVertical: 2 }}>
                      <Text style={[styles.playerItem, { flex: 1 }]}>
                        {nombre}{genero === 'Femenino' ? ' ♀' : ''}
                      </Text>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 8 }}
                        onPress={() => removePlayerFromTeam(t.id, playerId, isGuest)}
                      >
                        <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyBold, fontSize: 14 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
            }
          </View>
        ))}

        {/* Jugadores sin equipo */}
        {unassigned.length > 0 && (
          <View style={styles.card}>
            <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: SPACING.sm }]}>
              ⚠️ Sin equipo ({unassigned.length})
            </Text>
            {unassigned.map((p) => {
              const pid = p.isGuest ? p.guest_id : p.user_id;
              return (
                <View key={pid}>
                  <View style={{ flexDirection:'row', alignItems:'center', paddingVertical: 4 }}>
                    <Text style={[styles.cardSub, { flex: 1 }]}>
                      {p.users?.nombre}{p.isGuest ? ' 👤' : ''}{p.users?.genero === 'Femenino' ? ' ♀' : ''}
                    </Text>
                    <TouchableOpacity
                      style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]}
                      onPress={() => setAssignExpanded(assignExpanded === pid ? null : pid)}
                    >
                      <Text style={styles.btnSmallText}>{assignExpanded === pid ? '▲' : '+ Equipo'}</Text>
                    </TouchableOpacity>
                  </View>
                  {assignExpanded === pid && (
                    <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 6, paddingLeft: 8, paddingBottom: 4 }}>
                      {teams.map((t) => (
                        <TouchableOpacity
                          key={t.id}
                          style={{ flexDirection:'row', alignItems:'center', gap: 4, backgroundColor: (t.color ?? COLORS.blue) + '30', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.color ?? COLORS.navy }}
                          onPress={() => assignPlayerToTeam(t.id, pid, p.isGuest)}
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
      </ScrollView>

      {/* Modal mixto */}
      <Modal visible={mixModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Evento Mixto</Text>
            <Text style={styles.modalSub}>¿Cuántas mujeres por equipo?</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, justifyContent: 'center', marginVertical: SPACING.md }}>
              {['0', '1', '2', '3'].map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.chip, chicasPorEquipo === n && styles.chipActive]}
                  onPress={() => setChicasPorEquipo(n)}
                >
                  <Text style={[styles.chipText, chicasPorEquipo === n && { color: COLORS.white }]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: COLORS.gray }]} onPress={() => setMixModal(false)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: COLORS.blue }]} onPress={() => doAutoAssign(parseInt(chicasPorEquipo) || 0)}>
                <Text style={styles.btnText}>Asignar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal editar equipo */}
      <Modal visible={!!editTeamModal} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalBox, { borderColor: (editTeamForm.color || COLORS.blue) + '80' }]}>
            <Text style={[styles.modalTitle, { color: editTeamForm.color || COLORS.blue, marginBottom: SPACING.sm }]}>✏️ Editar equipo</Text>
            <Text style={styles.modalSub}>Nombre</Text>
            <TextInput
              style={[styles.input, { marginTop: 4, marginBottom: SPACING.sm }]}
              value={editTeamForm.nombre}
              onChangeText={(v) => setEditTeamForm(f => ({ ...f, nombre: v }))}
              placeholder="Nombre del equipo"
              placeholderTextColor={COLORS.gray}
              autoFocus
            />
            <Text style={styles.modalSub}>Color</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 8, marginVertical: SPACING.sm }}>
              {TEAM_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.color}
                  style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c.color, borderWidth: editTeamForm.color === c.color ? 3 : 1, borderColor: editTeamForm.color === c.color ? COLORS.white : COLORS.navy }}
                  onPress={() => setEditTeamForm(f => ({ ...f, color: c.color }))}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: COLORS.gray }]} onPress={() => setEditTeamModal(null)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: editTeamForm.color || COLORS.blue }]} onPress={saveTeamEdit} disabled={!editTeamForm.nombre.trim()}>
                <Text style={styles.btnText}>✓ Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal agregar jugador manualmente */}
      <Modal visible={addPlayerModal} transparent animationType="fade">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <Text style={[styles.modalTitle, { marginBottom: SPACING.sm }]}>➕ Agregar jugador</Text>
            <Text style={styles.modalSub}>Nombre completo</Text>
            <TextInput
              style={[styles.input, { marginTop: 4, marginBottom: SPACING.sm }]}
              value={addPlayerNombre}
              onChangeText={setAddPlayerNombre}
              placeholder="Ej: Juan Pérez"
              placeholderTextColor={COLORS.gray}
              autoFocus
              autoCapitalize="words"
            />
            <Text style={[styles.modalSub, { marginBottom: 4 }]}>Género</Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
              {['Masculino', 'Femenino'].map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[styles.chip, { flex: 1, justifyContent: 'center' }, addPlayerGenero === g && styles.chipActive]}
                  onPress={() => setAddPlayerGenero(g)}
                >
                  <Text style={[styles.chipText, addPlayerGenero === g && { color: COLORS.white }]}>
                    {g === 'Masculino' ? '♂ Masc.' : '♀ Fem.'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
              <TouchableOpacity
                style={[styles.btn, { flex: 1, backgroundColor: COLORS.gray }]}
                onPress={() => { setAddPlayerModal(false); setAddPlayerNombre(''); setAddPlayerGenero(null); }}
                disabled={addPlayerSaving}
              >
                <Text style={styles.btnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { flex: 1, backgroundColor: COLORS.green }]}
                onPress={addManualPlayer}
                disabled={addPlayerSaving || !addPlayerNombre.trim()}
              >
                <Text style={styles.btnText}>{addPlayerSaving ? 'Guardando…' : '✓ Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Jornadas / Fixture ─────────────────────────────────────────────────────
function GestorMatches({ route }) {
  const { eventId } = route.params ?? {};
  const [event,   setEvent]   = useState(null);
  const [matches, setMatches] = useState([]);
  const [teams,   setTeams]   = useState([]);

  // BUG A FIX: useFocusEffect so the list refreshes when navigating back
  useFocusEffect(useCallback(() => { if (eventId) fetchData(); }, [eventId]));

  async function fetchData() {
    try {
      const [{ data: ev }, { data: m }, { data: t }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('matches')
          .select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color)')
          .eq('event_id', eventId).order('jornada'),
        supabase.from('teams').select('*').eq('event_id', eventId),
      ]);
      setEvent(ev ?? null);
      setMatches(m ?? []);
      setTeams(t ?? []);
    } catch (e) {
      console.warn('GestorPartidos fetchData error:', e.message);
    }
  }

  async function generateFixture() {
    if (teams.length < 2) { Alert.alert('Error', 'Se necesitan al menos 2 equipos.'); return; }

    // WC fix M1: verificar si ya hay resultados guardados antes de borrar
    const { data: existing } = await supabase.from('matches').select('id, status').eq('event_id', eventId);
    if (existing?.length > 0) {
      const hasResults = existing.some(m => m.status === 'finished');
      const ok = await new Promise(res =>
        Alert.alert(
          'Regenerar fixture',
          hasResults
            ? `⚠️ Hay ${existing.filter(m => m.status === 'finished').length} resultados guardados que se ELIMINARÁN.\n\n¿Continuar?`
            : '¿Borrar los partidos actuales y generar nuevos?',
          [
            { text: 'Cancelar', style: 'cancel', onPress: () => res(false) },
            { text: 'Regenerar', style: 'destructive', onPress: () => res(true) },
          ]
        )
      );
      if (!ok) return;
      // MVP is now per-event — delete by event_id (not match_id)
      await supabase.from('mvp_votes').delete().eq('event_id', eventId);
      await supabase.from('mvp_results').delete().eq('event_id', eventId);
    }
    await supabase.from('matches').delete().eq('event_id', eventId);

    const formato  = event?.formato ?? 'Amistoso';
    let fixtures   = [];

    if (formato === 'Liga') {
      const jornadas  = parseInt(event?.jornadas ?? '1') || 1;
      const idaVuelta = event?.ida_y_vuelta ?? false;
      fixtures = generateLigaFixture(teams, jornadas, idaVuelta);

    } else if (formato === 'Torneo') {
      const grupos = {};
      teams.forEach((t) => { const g = t.grupo ?? 'A'; if (!grupos[g]) grupos[g] = []; grupos[g].push(t); });
      fixtures = [
        ...generateGroupStageFixture(grupos),
        ...generateKnockoutBracket({
          numGroups:        event?.num_grupos ?? 2,
          teamsPerGroup:    event?.equipos_por_grupo ?? 3,
          tieneOctavos:     event?.tiene_octavos ?? false,
          tieneCuartos:     event?.tiene_cuartos ?? false,
          tieneSemis:       event?.tiene_semis ?? true,
          tieneTercerLugar: event?.tiene_tercer_lugar ?? true,
          tieneFinal:       event?.tiene_final ?? true,
          idaYVuelta:       event?.ida_y_vuelta ?? false,
        }),
      ];

    } else if (formato === '2 Vidas') {
      // Validar 4 o 6 equipos
      if (![4, 6].includes(teams.length)) {
        Alert.alert('Modo 2 Vidas', `Necesitas 4 o 6 equipos exactos. Tienes ${teams.length}.`);
        return;
      }
      // Setear vidas iniciales y actuales en cada team
      const vidasIni = event?.vidas_por_equipo ?? 3;
      await Promise.all(teams.map((t) =>
        supabase.from('teams').update({ vidas_iniciales: vidasIni, vidas_actuales: vidasIni }).eq('id', t.id)
      ));
      fixtures = generate2VidasFixture(teams);

    } else {
      fixtures = generateRoundRobin(teams).map((f) => ({ ...f, fase: 'grupos' }));
    }

    const inserts = fixtures.map((f) => ({
      event_id:     eventId,
      jornada:      f.jornada ?? f.round ?? 1,
      team_home_id: f.home?.id ?? null,
      team_away_id: f.away?.id ?? null,
      fase:         f.fase ?? 'grupos',
      grupo:        f.grupo ?? null,
      status:       'pending',
    }));

    const { error } = await supabase.from('matches').insert(inserts);
    if (error) { Alert.alert('Error', error.message); return; }
    fetchData();
    Alert.alert('¡Listo!', `${inserts.length} partidos generados (${formato}).`);
  }

  const phaseOrder = ['grupos', 'octavos', 'cuartos', 'semis', 'tercer_lugar', 'final'];
  const byPhase    = matches.reduce((acc, m) => {
    const k = m.fase ?? 'grupos';
    if (!acc[k]) acc[k] = [];
    acc[k].push(m);
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>JORNADAS</Text>
      <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue, margin: SPACING.md }]} onPress={generateFixture}>
        <Text style={styles.btnText}>⚡ Generar fixture ({event?.formato ?? '…'})</Text>
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.list}>
        {phaseOrder.filter((p) => byPhase[p]).map((phase) => (
          <View key={phase}>
            <Text style={styles.roundTitle}>{PHASE_LABELS[phase] ?? phase.toUpperCase()}</Text>
            {byPhase[phase].map((m) => (
              <View key={m.id} style={styles.matchCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  {m.home?.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.home.color, marginRight: 4 }} />}
                  <Text style={styles.matchTeam}>{m.home?.nombre ?? m.equipo_local ?? '?'}</Text>
                </View>
                <Text style={styles.matchVs}>VS</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <Text style={[styles.matchTeam, { textAlign: 'right' }]}>{m.away?.nombre ?? m.equipo_visitante ?? '?'}</Text>
                  {m.away?.color && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.away.color, marginLeft: 4 }} />}
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Resultados ─────────────────────────────────────────────────────────────
function GestorResults({ route }) {
  const { eventId } = route.params ?? {};
  const [event,   setEvent]   = useState(null);
  const [matches, setMatches] = useState([]);
  const [teams,   setTeams]   = useState([]);
  const [scores,  setScores]  = useState({});
  const [saving,  setSaving]  = useState(null);
  const [inscritosCount, setInscritosCount] = useState(0);
  const [gestorEnEvento, setGestorEnEvento] = useState(true);
  // Gate de confidencialidad para las ganancias (mismo PIN que el panel admin)
  const [gananciaUnlocked, setGananciaUnlocked] = useState(false);
  const [gananciaPinInput, setGananciaPinInput] = useState('');
  function unlockGanancia() {
    if (gananciaPinInput.trim() === '2426') { setGananciaUnlocked(true); setGananciaPinInput(''); }
    else { Alert.alert('PIN incorrecto', 'El PIN de confidencialidad no es correcto.'); setGananciaPinInput(''); }
  }

  const fetchData = useCallback(() => {
    if (!eventId) return;
    Promise.all([
      supabase.from('events').select('id, status, formato, vidas_por_equipo, num_grupos, precio, cupos_total, cupos_ilimitado, cancha_costo, tarifa_app_por_jugador, gestor_juega, created_by').eq('id', eventId).single(),
      supabase.from('matches')
        .select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color)')
        .eq('event_id', eventId)
        .not('team_home_id', 'is', null)
        .order('jornada'),
      supabase.from('teams')
        .select('id, nombre, color, vidas_iniciales, vidas_actuales')
        .eq('event_id', eventId),
      supabase.from('event_registrations').select('user_id', { count: 'exact', head: true })
        .eq('event_id', eventId).eq('status', 'confirmed'),
      supabase.from('event_guests').select('id, invited_by, status')
        .eq('event_id', eventId).in('status', ['confirmed','pending_payment']),
    ]).then(([{ data: ev }, { data: m }, { data: t }, { count: regsCount }, { data: gs }]) => {
      setEvent(ev ?? null);
      setMatches(m ?? []);
      setTeams(t ?? []);
      const activeGuests = filterActiveEventGuests(gs ?? [], []);
      setInscritosCount((regsCount ?? 0) + activeGuests.length);
      // ¿El gestor está inscrito en su propio evento?
      if (ev?.created_by) {
        supabase.from('event_registrations')
          .select('id').eq('event_id', eventId).eq('user_id', ev.created_by)
          .in('status', ['confirmed','pending']).maybeSingle()
          .then(({ data: reg }) => setGestorEnEvento(!!reg));
      }
    });
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function saveResult(match) {
    if (saving === match.id) return;
    if (event?.status === 'finished') {
      Alert.alert('Evento finalizado', 'No se pueden editar resultados de un evento finalizado.'); return;
    }
    const { home: hG, away: aG } = scores[match.id] ?? {};
    if (hG === undefined || hG === '' || aG === undefined || aG === '') {
      Alert.alert('Error', 'Ingresa los goles de ambos equipos.'); return;
    }
    const homeGoals = parseInt(hG, 10);
    const awayGoals = parseInt(aG, 10);
    if (isNaN(homeGoals) || isNaN(awayGoals) || homeGoals < 0 || awayGoals < 0) {
      Alert.alert('Error', 'Ingresa un número válido (0 o más) para el marcador.'); return;
    }
    // Empate: si formato 2 Vidas o knockout, requerir marcador de penales
    const phase = match.fase ?? 'grupos';
    const isKnockout = ['octavos','cuartos','semis','tercer_lugar','final'].includes(phase);
    const is2Vidas = event?.formato === '2 Vidas';
    const isTie = homeGoals === awayGoals;
    const needsPenalties = isTie && (is2Vidas || isKnockout);

    let penH = null, penA = null, fuePenales = false;
    if (needsPenalties) {
      const { penHome, penAway } = scores[match.id] ?? {};
      const ph = parseInt(penHome, 10);
      const pa = parseInt(penAway, 10);
      if (isNaN(ph) || isNaN(pa) || ph < 0 || pa < 0) {
        Alert.alert('Penales requeridos', 'Empate en tiempo regular. Ingresa el marcador de penales.'); return;
      }
      if (ph === pa) {
        Alert.alert('Penales empatados', 'No puede empatar en penales — debe haber un ganador.'); return;
      }
      penH = ph; penA = pa; fuePenales = true;
    }

    setSaving(match.id);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('matches').update({
        goles_home:     homeGoals,
        goles_away:     awayGoals,
        goles_pen_home: penH,
        goles_pen_away: penA,
        fue_a_penales:  fuePenales,
        status:         'finished',
        finished_at:    now,
      }).eq('id', match.id);
      if (error) { Alert.alert('Error', error.message); return; }
      const updatedMatch = {
        ...match, status: 'finished',
        goles_home: homeGoals, goles_away: awayGoals,
        goles_pen_home: penH, goles_pen_away: penA, fue_a_penales: fuePenales,
        team_home_id: match.team_home_id, team_away_id: match.team_away_id,
      };
      setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, ...updatedMatch } : m));
      setScores((s) => { const n = { ...s }; delete n[match.id]; return n; });

      // Modo 2 Vidas: restar vida al perdedor + auto-crear final si terminó round-robin
      if (is2Vidas) {
        const loss = await applyVidaLossFor2Vidas({ supabase, match: updatedMatch });
        // Refrescar teams para calcular finalistas con vidas actualizadas
        const { data: freshTeams } = await supabase.from('teams')
          .select('id, nombre, color, vidas_iniciales, vidas_actuales')
          .eq('event_id', eventId);
        const allMatchesUpdated = matches.map((m) => m.id === match.id ? updatedMatch : m);
        const finalCreated = await ensure2VidasFinalIfReady({
          supabase, eventId, matches: allMatchesUpdated, teams: freshTeams ?? [],
        });
        if (finalCreated?.final) {
          Alert.alert('🏆 ¡Final generada!', `Los 2 con más vidas se enfrentan: ${finalCreated.finalists[0].nombre} vs ${finalCreated.finalists[1].nombre}`);
        }
        fetchData();
      }

      // Knockout: auto-popular la siguiente fase con los ganadores cuando termine la actual
      if (isKnockout && phase !== 'final') {
        const allMatchesUpdated = matches.map((m) => m.id === match.id ? updatedMatch : m);
        const result = await populateNextKnockoutPhase({
          supabase, eventId, matches: allMatchesUpdated,
        });
        if (result?.ok) {
          Alert.alert('⚡ Avance automático', `Los ganadores pasaron a ${result.populated.toUpperCase()}.`);
          fetchData();
        }
      }

      // Torneo: cuando se cierra la fase de grupos, auto-poblar la primera ronda de
      // knockout (semis/cuartos/octavos) con los clasificados.
      //   - 1 grupo  → todos los equipos avanzan; pairing 1°vs4°, 2°vs3°
      //   - 2+ grupos → top 2 por grupo; pairing cruzado 1°A vs 2°B, 1°B vs 2°A
      // Si hay empates exactos en pts/dg/gf en la plaza de corte, abrir modal de override.
      if (event?.formato === 'Torneo' && phase === 'grupos') {
        const allMatchesUpdated = matches.map((m) => m.id === match.id ? updatedMatch : m);
        if (isGroupStageComplete(allMatchesUpdated)) {
          const koAlreadyPopulated = allMatchesUpdated.some((m) =>
            ['octavos','cuartos','semis'].includes(m.fase) && (m.team_home_id || m.team_away_id)
          );
          if (!koAlreadyPopulated) {
            const standings = computeStandingsFromMatches(allMatchesUpdated, teams);
            const numGrupos = parseInt(event?.num_grupos ?? '2', 10) || 2;
            const avanzan = numGrupos === 1 ? teams.length : 2;
            const conflicts = detectGroupTiesNeedingDecision(standings, avanzan);
            if (conflicts.length > 0) {
              const initial = {};
              const byGroup = standings.reduce((acc, s) => { (acc[s.grupo] ??= []).push(s); return acc; }, {});
              Object.entries(byGroup).forEach(([g, list]) => {
                initial[g] = list.slice(0, avanzan).map((s) => s.team_id);
              });
              setTieOverrides(initial);
              setTieModal({ conflicts, standings, avanzan });
            } else {
              const qualified = getQualifiedTeams(standings, avanzan);
              const result = await populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup: qualified });
              if (result?.ok) {
                Alert.alert('⚡ Avance automático', `${result.count} llaves de ${result.phase.toUpperCase()} pobladas con los clasificados.`);
                fetchData();
              }
            }
          }
        }
      }

      const penTxt = fuePenales ? ` (pen ${penH}-${penA})` : '';
      sendPushNotificationsToEventPlayers(eventId, 'Resultado registrado', `${match.home?.nombre} ${homeGoals} - ${awayGoals} ${match.away?.nombre}${penTxt}`);
      Alert.alert('✓ Guardado', `${match.home?.nombre} ${homeGoals} - ${awayGoals} ${match.away?.nombre}${penTxt}`);
    } finally {
      setSaving(null);
    }
  }

  const eventLocked  = event?.status === 'finished';
  const pendingMatches  = matches.filter(m => m.status !== 'finished');
  const finishedMatches = matches.filter(m => m.status === 'finished');

  // ── Cierre de fase de grupos para formato Torneo ─────────────────────────
  const [tieModal, setTieModal] = useState(null); // null | { conflicts, standings, avanzan }
  const [tieOverrides, setTieOverrides] = useState({}); // { grupo: [team_id_avance_1, team_id_avance_2] }

  const isTorneo = event?.formato === 'Torneo';
  const groupComplete = isTorneo && isGroupStageComplete(matches);
  const koPopulated = matches.some((m) =>
    ['octavos','cuartos','semis'].includes(m.fase) && (m.team_home_id || m.team_away_id)
  );
  const shouldShowAdvanceButton = isTorneo && groupComplete && !koPopulated && !eventLocked;

  async function handleAdvanceToKnockout() {
    const standings = computeStandingsFromMatches(matches, teams);
    // Grupo único: TODOS los equipos avanzan a knockout
    // Múltiples grupos: top 2 por grupo
    const numGrupos = parseInt(event?.num_grupos ?? '2', 10) || 2;
    const teamsPerGroup = teams.length;  // total de equipos
    const avanzan = numGrupos === 1 ? teamsPerGroup : 2;
    const conflicts = detectGroupTiesNeedingDecision(standings, avanzan);
    if (conflicts.length > 0) {
      // Inicializar overrides con orden actual (DG)
      const initial = {};
      const byGroup = standings.reduce((acc, s) => { (acc[s.grupo] ??= []).push(s); return acc; }, {});
      Object.entries(byGroup).forEach(([g, list]) => {
        initial[g] = list.slice(0, avanzan).map((s) => s.team_id);
      });
      setTieOverrides(initial);
      setTieModal({ conflicts, standings, avanzan });
      return;
    }
    const qualified = getQualifiedTeams(standings, avanzan);
    const result = await populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup: qualified });
    if (result?.error) { Alert.alert('Error', result.error); return; }
    Alert.alert('⚡ Avance a knockout', `${result.count} llaves de ${result.phase.toUpperCase()} pobladas con los clasificados.`);
    fetchData();
  }

  async function confirmAdvanceWithOverrides() {
    const standings = tieModal?.standings ?? computeStandingsFromMatches(matches, teams);
    const avanzan = tieModal?.avanzan ?? 2;
    const qualified = getQualifiedTeams(standings, avanzan, tieOverrides);
    const result = await populateKnockoutFromGroups({ supabase, eventId, qualifiedByGroup: qualified });
    if (result?.error) { Alert.alert('Error', result.error); return; }
    setTieModal(null);
    Alert.alert('⚡ Avance confirmado', `${result.count} llaves pobladas.`);
    fetchData();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>RESULTADOS</Text>
      {eventLocked && (
        <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gold, textAlign:'center', marginBottom: SPACING.sm }}>
          🔒 Evento finalizado — resultados bloqueados
        </Text>
      )}
      {shouldShowAdvanceButton && (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: COLORS.gold, marginHorizontal: SPACING.md, marginBottom: SPACING.sm }]}
          onPress={handleAdvanceToKnockout}
        >
          <Text style={[styles.btnText, { color: COLORS.bg }]}>⚡ Avanzar a knockout (cerrar grupos)</Text>
        </TouchableOpacity>
      )}

      {event?.formato === '2 Vidas' && teams.length > 0 && (
        <View style={{ marginHorizontal: SPACING.md, marginBottom: SPACING.sm, backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold + '40' }}>
          <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.gold, fontSize: 12, marginBottom: SPACING.sm }}>⚡ VIDAS RESTANTES</Text>
          {teams.sort((a,b) => (b.vidas_actuales ?? 0) - (a.vidas_actuales ?? 0)).map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.color ?? COLORS.gray, marginRight: 8 }} />
              <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.white, fontSize: 13, flex: 1 }}>{t.nombre}</Text>
              <Text style={{ fontFamily: FONTS.bodyBold, color: (t.vidas_actuales ?? 0) > 0 ? COLORS.red : COLORS.gray, fontSize: 14 }}>
                {'❤'.repeat(t.vidas_actuales ?? 0) || '☠ Eliminado'}
              </Text>
            </View>
          ))}
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list}>
        {event && (
          <View style={{ paddingHorizontal: SPACING.md }}>
            {!gananciaUnlocked ? (
              <View style={styles.card}>
                <Text style={styles.cardName}>🔒 Ganancias confidenciales</Text>
                <Text style={[styles.cardSub, { marginBottom: SPACING.sm }]}>Ingresá el PIN de confidencialidad para ver las ganancias.</Text>
                <TextInput
                  style={styles.input}
                  placeholder="PIN"
                  placeholderTextColor={COLORS.gray}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  value={gananciaPinInput}
                  onChangeText={setGananciaPinInput}
                  onSubmitEditing={unlockGanancia}
                />
                <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.green, marginTop: SPACING.sm }]} onPress={unlockGanancia}>
                  <Text style={styles.btnText}>Ver ganancias</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <GananciaCard event={event} inscritosConfirmados={inscritosCount} gestorEnEvento={gestorEnEvento} />
            )}
          </View>
        )}
        {matches.length === 0 && <Text style={styles.empty}>Sin partidos. Genera el fixture primero.</Text>}
        {pendingMatches.map((m) => {
          const sc = scores[m.id] ?? {};
          const hG = parseInt(sc.home, 10);
          const aG = parseInt(sc.away, 10);
          const tieEntered = !isNaN(hG) && !isNaN(aG) && hG === aG;
          const phase = m.fase ?? 'grupos';
          const isKO = ['octavos','cuartos','semis','tercer_lugar','final'].includes(phase);
          const showPenInputs = tieEntered && (event?.formato === '2 Vidas' || isKO);
          return (
          <View key={m.id} style={styles.card}>
            <Text style={styles.cardSub}>Jornada {m.jornada} · {phase.toUpperCase()}</Text>
            <View style={styles.resultRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                {m.home?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.home.color, marginRight: 6 }} />}
                <Text style={[styles.teamName, { flex: 0 }]}>{m.home?.nombre}</Text>
              </View>
              <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.home ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], home: v } }))} />
              <Text style={styles.vsText}>:</Text>
              <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.away ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], away: v } }))} />
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                <Text style={[styles.teamName, { flex: 0, textAlign: 'right' }]}>{m.away?.nombre}</Text>
                {m.away?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.away.color, marginLeft: 6 }} />}
              </View>
            </View>
            {showPenInputs && (
              <View style={[styles.resultRow, { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.navy }]}>
                <Text style={[styles.cardSub, { flex: 1, color: COLORS.gold }]}>🎯 Penales</Text>
                <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.penHome ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], penHome: v } }))} />
                <Text style={styles.vsText}>:</Text>
                <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder="0" placeholderTextColor={COLORS.gray} value={sc.penAway ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], penAway: v } }))} />
                <Text style={[styles.cardSub, { flex: 1, textAlign: 'right', color: COLORS.gold }]}>muerte súbita</Text>
              </View>
            )}
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#2DC65399', marginTop: SPACING.sm, opacity: saving === m.id ? 0.6 : 1 }]} onPress={() => saveResult(m)} disabled={saving === m.id}>
              {saving === m.id ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.btnText}>✓ Guardar resultado</Text>}
            </TouchableOpacity>
          </View>
          );
        })}
        {finishedMatches.length > 0 && (
          <>
            <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.green, marginTop: SPACING.md, marginBottom: 4 }}>REGISTRADOS ({finishedMatches.length})</Text>
            {finishedMatches.map((m) => (
              <View key={m.id} style={[styles.card, { borderColor: '#2DC65340' }]}>
                <Text style={styles.cardSub}>Jornada {m.jornada} · {(m.fase ?? 'grupos').toUpperCase()} ✓</Text>
                <View style={styles.resultRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    {m.home?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.home.color, marginRight: 6 }} />}
                    <Text style={[styles.teamName, { flex: 0 }]}>{m.home?.nombre}</Text>
                  </View>
                  {eventLocked
                    ? <Text style={[styles.vsText, { color: COLORS.gold }]}>{m.goles_home} - {m.goles_away}</Text>
                    : <>
                        <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder={String(m.goles_home ?? 0)} placeholderTextColor={COLORS.gray} value={scores[m.id]?.home ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], home: v } }))} />
                        <Text style={styles.vsText}>:</Text>
                        <TextInput style={styles.scoreInput} keyboardType="number-pad" maxLength={2} placeholder={String(m.goles_away ?? 0)} placeholderTextColor={COLORS.gray} value={scores[m.id]?.away ?? ''} onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], away: v } }))} />
                      </>
                  }
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                    <Text style={[styles.teamName, { flex: 0, textAlign: 'right' }]}>{m.away?.nombre}</Text>
                    {m.away?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.away.color, marginLeft: 6 }} />}
                  </View>
                </View>
                {!eventLocked && (
                  <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.blue + '99', marginTop: SPACING.sm, opacity: saving === m.id ? 0.6 : 1 }]} onPress={() => saveResult(m)} disabled={saving === m.id}>
                    {saving === m.id ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.btnText}>✏️ Editar resultado</Text>}
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </>
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>

      {/* Modal de override para empates ambiguos */}
      <Modal visible={!!tieModal} transparent animationType="slide" onRequestClose={() => setTieModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: SPACING.md }}>
          <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, maxHeight: '85%' }}>
            <ScrollView>
              <Text style={{ fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gold, marginBottom: SPACING.sm }}>EMPATE EN GRUPOS</Text>
              <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, marginBottom: SPACING.md }}>
                Hay equipos con mismos puntos, diferencia de goles y goles a favor. Elegí manualmente el orden de avance.
              </Text>
              {tieModal?.conflicts.map(({ grupo, tied }) => (
                <View key={grupo} style={{ marginBottom: SPACING.md }}>
                  <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white, marginBottom: 4 }}>Grupo {grupo}</Text>
                  {(tieModal?.standings ?? []).filter((s) => s.grupo === grupo).map((s, idx) => {
                    const order = (tieOverrides[grupo] ?? []).indexOf(s.team_id);
                    const isAdvance = order !== -1;
                    return (
                      <TouchableOpacity
                        key={s.team_id}
                        style={{ flexDirection: 'row', alignItems: 'center', padding: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: isAdvance ? COLORS.gold : COLORS.navy, marginBottom: 4, backgroundColor: isAdvance ? COLORS.gold + '20' : 'transparent' }}
                        onPress={() => {
                          // Toggle: si está, quitarlo; sino agregarlo si hay espacio
                          const cur = tieOverrides[grupo] ?? [];
                          let next;
                          if (cur.includes(s.team_id)) {
                            next = cur.filter((id) => id !== s.team_id);
                          } else if (cur.length < (tieModal?.avanzan ?? 2)) {
                            next = [...cur, s.team_id];
                          } else {
                            next = [...cur.slice(1), s.team_id];  // FIFO
                          }
                          setTieOverrides({ ...tieOverrides, [grupo]: next });
                        }}
                      >
                        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: s.color ?? COLORS.gray, marginRight: 8 }} />
                        <Text style={{ flex: 1, fontFamily: FONTS.bodyMedium, color: COLORS.white }}>{s.equipo}</Text>
                        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 }}>
                          {s.pts}pts · DG {s.dg > 0 ? '+' : ''}{s.dg} · GF {s.gf}
                        </Text>
                        {isAdvance && <Text style={{ marginLeft: 8, color: COLORS.gold, fontFamily: FONTS.bodyBold }}>{order + 1}º</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: COLORS.navy }]} onPress={() => setTieModal(null)}>
                  <Text style={styles.btnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { flex: 1, backgroundColor: COLORS.gold }]} onPress={confirmAdvanceWithOverrides}>
                  <Text style={[styles.btnText, { color: COLORS.bg }]}>Confirmar avance</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── MVP ────────────────────────────────────────────────────────────────────
function GestorMvp({ route }) {
  const { eventId } = route.params ?? {};
  const [event,            setEvent]            = useState(null);
  // BUG B FIX: unified candidate list (registered users + guests)
  const [candidates,       setCandidates]       = useState([]);
  // keep original registered players list for vote-lookup
  const [regPlayers,       setRegPlayers]       = useState([]);
  const [mvpResult,        setMvpResult]        = useState(null);
  const [mvpVotesByPlayer, setMvpVotesByPlayer] = useState({});
  const [mvpTotalVotes,    setMvpTotalVotes]    = useState(0);
  const [loading,          setLoading]          = useState(true);
  // BUG B FIX: state for manually selected MVP candidate and local guest MVP nombre
  const [selectedMvp,      setSelectedMvp]      = useState(null);
  const [localMvpNombre,   setLocalMvpNombre]   = useState(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // BUG E FIX: useFocusEffect so data refreshes when navigating back to this screen
  useFocusEffect(useCallback(() => { if (eventId) fetchData(); else setLoading(false); }, [eventId]));

  async function fetchData() {
    if (mountedRef.current) setLoading(true);
    try {
      // BUG B FIX: load both event_registrations and event_guests as candidates
      const [{ data: ev }, { data: regs }, { data: gs }, { data: evMvpResult }, { data: evVotes }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('event_registrations').select('user_id, users(nombre, foto_url)').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('event_guests').select('id, nombre, genero, status, invited_by').eq('event_id', eventId).in('status', ['confirmed', 'pending_payment']),
        supabase.from('mvp_results').select('*, users(nombre, foto_url)').eq('event_id', eventId).maybeSingle(),
        supabase.from('mvp_votes').select('voted_for_id').eq('event_id', eventId),
      ]);
      if (!mountedRef.current) return;

      const byPlayer = (evVotes ?? []).reduce((acc, v) => {
        acc[v.voted_for_id] = (acc[v.voted_for_id] ?? 0) + 1;
        return acc;
      }, {});

      // BUG B FIX: build unified candidate list (same pattern as GestorTeams)
      const regCandidates = (regs ?? []).map(r => ({
        key:      `user:${r.user_id}`,
        user_id:  r.user_id,
        guest_id: null,
        nombre:   r.users?.nombre ?? '?',
        foto_url: r.users?.foto_url ?? null,
        isGuest:  false,
      }));
      const activeGuests = filterActiveEventGuests(gs ?? [], regs ?? []);
      const guestCandidates = activeGuests.map(g => ({
        key:      `guest:${g.id}`,
        user_id:  null,
        guest_id: g.id,
        nombre:   g.nombre + ' 👤',
        foto_url: null,
        isGuest:  true,
      }));
      const allCandidates = [...regCandidates, ...guestCandidates];

      setEvent(ev);
      setCandidates(allCandidates);
      setRegPlayers(regs ?? []);
      setMvpResult(evMvpResult ?? null);
      setMvpVotesByPlayer(byPlayer);
      setMvpTotalVotes((evVotes ?? []).length);
      // Reset selection on refresh
      setSelectedMvp(null);
    } catch (e) {
      console.warn('GestorMvp fetchData error:', e.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openVoting() {
    const closesAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('events').update({ mvp_voting_open: true, mvp_closes_at: closesAt }).eq('id', eventId);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('✅ Votación abierta', 'Los jugadores pueden votar por el MVP del evento durante 2 horas.');
    fetchData();
  }

  async function closeVoting() {
    if (!mvpTotalVotes) { Alert.alert('Sin votos', 'No hay votos registrados para este evento.'); return; }

    const sorted    = Object.entries(mvpVotesByPlayer).sort((a, b) => b[1] - a[1]);
    const maxVotos  = sorted[0][1];
    const empatados = sorted.filter(([, v]) => v === maxVotos);
    const [winnerId, winnerVotes] = empatados[Math.floor(Math.random() * empatados.length)];

    const { error: mvpErr } = await supabase.from('mvp_results').insert({
      event_id:      eventId,
      user_id:       winnerId,
      votos_totales: winnerVotes,
      premio_wallet: 1.00,
      premio_pagado: true,
    });
    if (mvpErr) {
      if (mvpErr.code === '23505') {
        Alert.alert('Ya declarado', 'El MVP de este evento ya fue registrado.');
      } else {
        Alert.alert('Error', mvpErr.message);
      }
      fetchData();
      return;
    }

    await supabase.from('events').update({ mvp_voting_open: false }).eq('id', eventId);

    try {
      await supabase.rpc('credit_wallet', {
        p_user_id:     winnerId,
        p_monto:       1.00,
        p_tipo:        'mvp_premio',
        p_descripcion: 'Premio MVP del evento',
      });
    } catch (e) {
      console.warn('credit_wallet error:', e.message);
    }

    const winner = regPlayers.find((p) => p.user_id === winnerId);
    Alert.alert('🏆 MVP Definido', `${winner?.users?.nombre ?? 'Jugador'} con ${winnerVotes} voto(s). +$1 acreditado.`);
    fetchData();
  }

  // BUG B FIX: declareMvp — handles both registered users and guests
  async function declareMvp(candidate) {
    if (!candidate) return;

    if (candidate.isGuest) {
      // Guest MVP: mvp_results.user_id is NOT NULL so we can't insert there.
      // Save locally and show confirmation — no DB persist for guests.
      const nombreLimpio = candidate.nombre.replace(' 👤', '');
      setLocalMvpNombre(nombreLimpio);
      setSelectedMvp(null);
      Alert.alert('🏆 MVP Declarado', `${nombreLimpio} es el MVP del evento.`);
    } else {
      // Registered user MVP: usa RPC declare_mvp (atómico, valida caller=gestor/admin,
      // acredita +$1 al wallet en la misma transacción). Idempotente: si el mvp_results
      // ya existe sin pagar, solo acredita; si ya está pagado, no doble-paga.
      const { data, error } = await supabase.rpc('declare_mvp', {
        p_event_id:      eventId,
        p_user_id:       candidate.user_id,
        p_votos_totales: mvpVotesByPlayer[candidate.user_id] ?? 0,
      });
      if (error) {
        Alert.alert('Error al declarar MVP', error.message ?? 'Intentá nuevamente.');
      } else if (data?.already_paid) {
        Alert.alert('🏆 MVP ya declarado', `${candidate.nombre} ya tenía el premio acreditado.`);
      } else if (data?.credit_added) {
        Alert.alert('🏆 MVP Declarado', `${candidate.nombre} es el MVP. +$1 acreditado.`);
      } else {
        Alert.alert('🏆 MVP Declarado', `${candidate.nombre} es el MVP.`);
      }
      fetchData();
    }
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  const votingOpen = event?.mvp_voting_open && !mvpResult;
  const closesAt   = event?.mvp_closes_at ? new Date(event.mvp_closes_at) : null;
  const expired    = closesAt && closesAt < new Date();
  const countdown  = closesAt && !expired
    ? Math.max(0, Math.ceil((closesAt - new Date()) / 60000))
    : 0;

  // Determine if MVP has already been declared (DB result or local guest result)
  const mvpDeclared = !!mvpResult || !!localMvpNombre;
  const mvpNombre   = mvpResult?.users?.nombre ?? localMvpNombre ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>MVP DEL EVENTO</Text>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.card}>
          <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>🏆 Jugador más valioso</Text>

          {mvpDeclared ? (
            <View style={{ backgroundColor: COLORS.gold + '20', borderRadius: RADIUS.sm, padding: SPACING.md }}>
              <Text style={[styles.cardName, { color: COLORS.gold }]}>🥇 {mvpNombre}</Text>
              {mvpResult && (
                <Text style={styles.cardSub}>{mvpResult.votos_totales} votos · +${mvpResult.premio_wallet} acreditado</Text>
              )}
              {localMvpNombre && !mvpResult && (
                <Text style={styles.cardSub}>Declarado manualmente por el gestor</Text>
              )}
            </View>
          ) : votingOpen ? (
            <>
              <Text style={[styles.cardSub, { color: COLORS.green }]}>✅ Votación en curso</Text>
              <Text style={[styles.cardSub, { color: expired ? COLORS.red : COLORS.blue2 }]}>
                {expired ? '⏰ Tiempo expirado — listo para cerrar' : `⏱ Cierra en ${countdown} min`}
              </Text>
              <Text style={[styles.cardSub, { color: COLORS.gold, marginTop: 4 }]}>
                ⚡ {mvpTotalVotes} voto(s) recibidos
              </Text>
              {Object.entries(mvpVotesByPlayer)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([uid, cnt]) => {
                  const p = regPlayers.find(pl => pl.user_id === uid);
                  return (
                    <View key={uid} style={{ flexDirection:'row', justifyContent:'space-between', paddingVertical: 2 }}>
                      <Text style={styles.cardSub}>{p?.users?.nombre ?? 'Jugador'}</Text>
                      <Text style={[styles.cardSub, { color: COLORS.gold }]}>{cnt} voto{cnt !== 1 ? 's' : ''}</Text>
                    </View>
                  );
                })
              }
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.gold + 'CC', marginTop: SPACING.sm }]}
                onPress={closeVoting}
              >
                <Text style={styles.btnText}>🏆 Cerrar y declarar MVP</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.cardSub}>
                {candidates.length} candidato(s) ({candidates.filter(c => !c.isGuest).length} inscritos + {candidates.filter(c => c.isGuest).length} invitados).
              </Text>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.blue, marginTop: SPACING.sm,
                  opacity: (event?.status === 'active' || event?.status === 'finished') ? 1 : 0.4 }]}
                onPress={openVoting}
                disabled={event?.status !== 'active' && event?.status !== 'finished'}
              >
                <Text style={styles.btnText}>⭐ Abrir votación MVP</Text>
              </TouchableOpacity>
              {event?.status !== 'active' && event?.status !== 'finished' && (
                <Text style={[styles.cardSub, { color: COLORS.red, marginTop: 4 }]}>
                  El evento debe estar activo o finalizado.
                </Text>
              )}
            </>
          )}
        </View>

        {/* BUG B FIX: Manual MVP declaration — gestor selects from full candidate list */}
        {!mvpDeclared && (
          <View style={styles.card}>
            <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>🎯 Declarar MVP manualmente</Text>
            <Text style={styles.cardSub}>Toca un candidato para seleccionarlo, luego pulsa el botón.</Text>
            {candidates.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={{
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: SPACING.sm,
                  borderRadius: RADIUS.sm, marginTop: 4,
                  backgroundColor: selectedMvp?.key === c.key ? COLORS.gold + '30' : COLORS.navy,
                  borderWidth: 1,
                  borderColor: selectedMvp?.key === c.key ? COLORS.gold : COLORS.navy,
                }}
                onPress={() => setSelectedMvp(selectedMvp?.key === c.key ? null : c)}
              >
                <Text style={{ fontSize: 16, marginRight: 8 }}>{c.isGuest ? '👤' : '⚽'}</Text>
                <Text style={[styles.cardSub, { flex: 1, color: selectedMvp?.key === c.key ? COLORS.gold : COLORS.gray2 }]}>
                  {c.nombre}
                  {!c.isGuest && mvpVotesByPlayer[c.user_id] ? ` · ${mvpVotesByPlayer[c.user_id]} voto(s)` : ''}
                </Text>
                {selectedMvp?.key === c.key && (
                  <Text style={{ color: COLORS.gold, fontSize: 18 }}>★</Text>
                )}
              </TouchableOpacity>
            ))}
            {selectedMvp && (
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.gold + 'CC', marginTop: SPACING.md }]}
                onPress={() => declareMvp(selectedMvp)}
              >
                <Text style={styles.btnText}>🏆 Declarar MVP: {selectedMvp.nombre}</Text>
              </TouchableOpacity>
            )}
            {candidates.length === 0 && (
              <Text style={[styles.cardSub, { fontStyle: 'italic', textAlign: 'center', marginTop: SPACING.sm }]}>
                Sin candidatos — agrega jugadores o invitados primero.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Config Evento ──────────────────────────────────────────────────────────
function GestorConfig({ route, navigation }) {
  const { eventId } = route.params ?? {};
  const [event,      setEvent]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  useEffect(() => {
    if (!eventId) { setLoading(false); return; }
    supabase.from('events').select('*').eq('id', eventId).single()
      .then(({ data, error }) => {
        if (error) console.warn('GestorConfig load:', error.message);
        setEvent(data ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggleStatus(newStatus) {
    if (newStatus === 'finished') {
      const newsTitle  = `🏁 ${event?.nombre ?? 'Evento'} — Finalizado`;
      const newsBody   = `El evento ${event?.nombre ?? ''} ha concluido. Revisa los resultados y la tabla de posiciones.`;
      const finishedAt = new Date().toISOString();
      const { error } = await supabase.from('events').update({ status: 'finished', event_finished_at: finishedAt }).eq('id', eventId);
      if (error) { Alert.alert('Error', error.message); return; }
      setEvent((e) => ({ ...e, status: 'finished', event_finished_at: finishedAt }));
      try { await supabase.from('news').insert({ titulo: newsTitle, contenido: newsBody, tipo: 'resultados' }); } catch {}
      sendLocalNotification(newsTitle, newsBody);
      sendPushNotificationsToEventPlayers(eventId, newsTitle, newsBody);
      Alert.alert('Evento finalizado', 'Se publicó una noticia automáticamente.');
      return;
    }
    if (newStatus === 'active' && event?.status === 'finished') {
      // Reactivar: limpiar event_finished_at para que no se auto-oculte
      const { error } = await supabase.from('events').update({ status: 'active', event_finished_at: null }).eq('id', eventId);
      if (error) { Alert.alert('Error', error.message); return; }
      setEvent((e) => ({ ...e, status: 'active', event_finished_at: null }));
      return;
    }
    const { error } = await supabase.from('events').update({ status: newStatus }).eq('id', eventId);
    if (error) { Alert.alert('Error', error.message); return; }
    setEvent((e) => ({ ...e, status: newStatus }));
  }

  async function toggleField(field, value) {
    const { error } = await supabase.from('events').update({ [field]: value }).eq('id', eventId);
    if (error) { Alert.alert('Error', error.message); return; }
    setEvent((e) => ({ ...e, [field]: value }));
  }

  // BUG FIX: cancel event with automatic refunds to all confirmed registrations
  async function cancelEventWithRefunds() {
    Alert.alert(
      'Cancelar evento',
      `¿Cancelar "${event.nombre}"?\n\nTodos los jugadores con inscripción confirmada recibirán un reembolso automático a sus créditos. Esta acción NO se puede deshacer.`,
      [
        { text: 'No cancelar', style: 'cancel' },
        { text: 'Cancelar evento', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            // Una sola llamada atomica: acredita a wallet TODO lo pagado (efectivo/yappy/wallet),
            // marca inscripciones cancelled y oculta el evento, en una transaccion.
            // Idempotente: reintentar no duplica reembolsos (tag referencia_externa).
            const { data: result, error: rpcErr } = await supabase.rpc('cancel_event_with_refunds', {
              p_event_id: eventId,
            });
            if (rpcErr) throw rpcErr;

            const refundCount = result?.refund_count ?? 0;
            const refundTotal = Number(result?.refund_total ?? 0);
            const noWalletCount = result?.nowallet_count ?? 0;
            const noWalletTotal = Number(result?.nowallet_total ?? 0);

            setEvent((e) => ({ ...e, status: 'cancelled', visible: false }));

            // Auto-news (best-effort, fuera de la transaccion)
            try {
              await supabase.from('news').insert({
                titulo:    `🚫 ${event.nombre} — Cancelado`,
                contenido: `El evento "${event.nombre}" fue cancelado. ${refundCount} jugador(es) recibieron crédito automático por un total de $${refundTotal.toFixed(2)}.`,
                tipo:      'general',
              });
            } catch (_) {}
            sendLocalNotification(`🚫 ${event.nombre} cancelado`, `Se acreditaron ${refundCount} reembolso(s) automáticos.`);
            sendPushNotificationsToEventPlayers(eventId, `🚫 ${event.nombre} cancelado`, `El evento fue cancelado. ${refundCount > 0 ? `Recibiste un crédito a tu wallet.` : 'Contacta al organizador.'}`);

            const edgeMsg = noWalletCount > 0
              ? `\n\n${noWalletCount} jugador(es) sin wallet ($${noWalletTotal.toFixed(2)}) quedaron pendientes de gestión manual.`
              : '';
            Alert.alert(
              'Evento cancelado',
              `${refundCount} jugador(es) acreditados a sus créditos ($${refundTotal.toFixed(2)} en total). El evento ya no es visible.${edgeMsg}`
            );
          } catch (e) {
            Alert.alert('Error al cancelar', e.message);
          } finally {
            setCancelling(false);
          }
        }},
      ]
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  if (!event)  return (
    <SafeAreaView style={styles.safe}>
      <Text style={[styles.cardSub, { textAlign:'center', marginTop: 40 }]}>No se pudo cargar el evento.</Text>
    </SafeAreaView>
  );

  const statusActions = {
    draft:    [{ label: '✅ Publicar evento',    next: 'open',      color: '#2DC65399' }],
    open:     [
      { label: '▶ Activar evento',    next: 'active',    color: COLORS.blue },
      { label: '⏸ Despublicar',        next: 'draft',     color: COLORS.gray },
    ],
    active:   [{ label: '🏁 Finalizar evento',   next: 'finished',  color: COLORS.red  }],
    finished: [{ label: '▶ Reactivar evento',   next: 'active',    color: COLORS.blue }],
    cancelled: [],
  };

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>CONFIG</Text>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.card}>
          <Text style={styles.cardName}>{event.nombre}</Text>
          <Text style={styles.cardSub}>Status: {event.status?.toUpperCase()}</Text>
          <Text style={styles.cardSub}>Formato: {event.formato} · {event.deporte}</Text>
          {event.jugadores_por_equipo && (
            <Text style={styles.cardSub}>Jugadores por equipo: {event.jugadores_por_equipo}v{event.jugadores_por_equipo}</Text>
          )}

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: COLORS.blue, marginTop: SPACING.md }]}
            onPress={() => navigation.navigate('EditEvent', { eventId })}
          >
            <Text style={styles.btnText}>✏️ Editar información del evento</Text>
          </TouchableOpacity>

          <View style={[styles.btnRow, { marginTop: SPACING.sm }]}>
            {(statusActions[event.status] ?? []).map((a) => (
              <TouchableOpacity
                key={a.next}
                style={[styles.btn, { backgroundColor: a.color }]}
                onPress={() => {
                  Alert.alert('Cambiar estado', `¿Cambiar a "${a.next}"?`, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Confirmar', onPress: () => toggleStatus(a.next) },
                  ]);
                }}
              >
                <Text style={styles.btnText}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.cardSub}>Cupos ilimitados</Text>
            <TouchableOpacity
              style={[styles.toggle, event.cupos_ilimitado && styles.toggleActive]}
              onPress={() => toggleField('cupos_ilimitado', !event.cupos_ilimitado)}
            >
              <Text style={styles.toggleText}>{event.cupos_ilimitado ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {/* Visibilidad — auto-oculta 24h después de finalizar */}
          <View style={[styles.toggleRow, { borderTopWidth: 1, borderTopColor: COLORS.navy, marginTop: SPACING.sm, paddingTop: SPACING.sm }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardSub}>👁 Visible para jugadores</Text>
              {event.status === 'finished' && event.event_finished_at && (
                <Text style={[styles.cardSub, { color: COLORS.gold, fontSize: 11, marginTop: 2 }]}>
                  Auto-oculta: {new Date(new Date(event.event_finished_at).getTime() + 24*60*60*1000).toLocaleString('es-PA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.toggle, (event.visible !== false) && styles.toggleActive, { backgroundColor: event.visible !== false ? COLORS.green : COLORS.red }]}
              onPress={() => toggleField('visible', event.visible !== false ? false : true)}
            >
              <Text style={styles.toggleText}>{event.visible !== false ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {/* BUG FIX: Cancel event with automatic refunds — only for non-cancelled events */}
          {event.status !== 'cancelled' && event.status !== 'finished' && (
            <View style={[{ borderTopWidth: 1, borderTopColor: COLORS.navy, marginTop: SPACING.sm, paddingTop: SPACING.sm }]}>
              <Text style={[styles.cardSub, { color: COLORS.red, marginBottom: SPACING.sm }]}>
                Zona de peligro
              </Text>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.red + '99' }]}
                onPress={cancelEventWithRefunds}
                disabled={cancelling}
              >
                {cancelling
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.btnText}>🚫 Cancelar evento y reembolsar</Text>
                }
              </TouchableOpacity>
              <Text style={[styles.cardSub, { color: COLORS.gray, fontSize: 11, marginTop: 4 }]}>
                Cancela el evento y emite reembolsos automáticos a todos los inscritos con pago.
              </Text>
            </View>
          )}

          {event.status === 'cancelled' && (
            <Text style={[styles.cardSub, { color: COLORS.red, marginTop: SPACING.sm }]}>
              Este evento fue cancelado. Los reembolsos fueron emitidos.
            </Text>
          )}

          {/* Eliminar evento — disponible para cualquier estado */}
          <View style={[{ borderTopWidth: 1, borderTopColor: COLORS.navy, marginTop: SPACING.md, paddingTop: SPACING.sm }]}>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: COLORS.red + '99', opacity: deleting ? 0.5 : 1 }]}
              disabled={deleting}
              onPress={() => {
                Alert.alert(
                  'Eliminar evento',
                  `¿Eliminar "${event.nombre}" permanentemente?\n\nSe eliminarán inscripciones, equipos, partidos y todos los datos asociados. Esta acción no se puede deshacer.`,
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Eliminar', style: 'destructive', onPress: async () => {
                      setDeleting(true);
                      try {
                        // DB cascade handles related records automatically (migration 20260503000003)
                        // mvp_results.event_id → SET NULL (historial de jugadores preservado)
                        const { error } = await supabase.from('events').delete().eq('id', eventId);
                        if (error) throw error;
                        Alert.alert('Eliminado', 'El evento fue eliminado.', [
                          { text: 'OK', onPress: () => navigation.popToTop() },
                        ]);
                      } catch (e) {
                        Alert.alert('Error al eliminar', e.message);
                      } finally {
                        setDeleting(false);
                      }
                    }},
                  ]
                );
              }}
            >
              {deleting
                ? <ActivityIndicator color={COLORS.white} size="small" />
                : <Text style={styles.btnText}>🗑 Eliminar evento</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Ventas / Comisiones ────────────────────────────────────────────────────
function GestorVentas() {
  const { user } = useAuthStore();
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [total,   setTotal]   = useState(0);

  useEffect(() => { fetchOrders(); }, []);

  async function fetchOrders() {
    if (!user?.id) { setLoading(false); return; }
    const { data } = await supabase
      .from('orders')
      .select('*, users(nombre), order_items(qty, precio_unitario, talla, products(nombre))')
      .eq('gestor_id', user.id)
      .order('created_at', { ascending: false });
    const list = data ?? [];
    setOrders(list);
    setTotal(list.reduce((s, o) => s + (o.total ?? 0), 0));
    setLoading(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>MIS VENTAS</Text>
      <View style={[styles.card, { margin: SPACING.md, backgroundColor: COLORS.blue, borderColor: '#1a3a5c' }]}>
        <Text style={{ fontFamily: FONTS.body, fontSize: 11, color: COLORS.white + 'AA', letterSpacing: 2 }}>TOTAL COMISIONADO</Text>
        <Text style={{ fontFamily: FONTS.heading, fontSize: 42, color: COLORS.white }}>${(total * 0.05).toFixed(2)}</Text>
        <Text style={{ fontFamily: FONTS.body, fontSize: 12, color: COLORS.white + '88' }}>5% de ${total.toFixed(2)} en ventas</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {orders.length === 0 && <Text style={styles.empty}>No tienes ventas registradas aún.</Text>}
        {orders.map((o) => (
          <View key={o.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.cardName}>{o.users?.nombre}</Text>
              <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gold }}>${o.total?.toFixed(2)}</Text>
            </View>
            <Text style={styles.cardSub}>{new Date(o.created_at).toLocaleString('es-PA')}</Text>
            {o.order_items?.map((item, i) => (
              <Text key={i} style={styles.cardSub}>
                {item.products?.nombre}{item.talla ? ` (${item.talla})` : ''} × {item.qty} — ${(item.precio_unitario * item.qty).toFixed(2)}
              </Text>
            ))}
            <Text style={{ fontFamily: FONTS.bodyMedium, fontSize: 12, color: '#2DC653', paddingTop: SPACING.sm, borderTopWidth: 1, borderColor: COLORS.navy }}>
              Comisión: ${((o.total ?? 0) * 0.05).toFixed(2)}
            </Text>
          </View>
        ))}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Pagos en efectivo (aprobación del gestor) ─────────────────────────────
function GestorCashApprovals({ route, navigation }) {
  const { user } = useAuthStore();
  const eventId  = route?.params?.eventId;

  const [requests,  setRequests]  = useState([]);
  const [guestReqs, setGuestReqs] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [processing,setProcessing]= useState(null);

  useEffect(() => { fetchRequests(); }, []);
  useEffect(() => {
    const unsub = navigation.addListener('focus', fetchRequests);
    return unsub;
  }, [navigation]);

  async function fetchRequests() {
    setLoading(true);
    // Expirar antes de leer: el RPC marca como 'expired' las que pasaron el plazo.
    // Fire-and-forget para no bloquear (Promise.resolve(...) porque rpc retorna
    // PostgrestBuilder Thenable y .catch directo tira TypeError).
    Promise.resolve(supabase.rpc('expire_pending_cash_requests')).catch(() => {});
    Promise.resolve(supabase.rpc('expire_pending_guests')).catch(() => {});

    // PERMISOS: el gestor SOLO debe ver requests de SUS eventos. Antes la
    // query traía todas las pendientes de la plataforma (bug de permisos).
    // Sacamos los event_ids del gestor primero y luego filtramos por esos.
    const { data: myEvents } = await supabase
      .from('events').select('id').eq('created_by', user.id);
    const myEventIds = (myEvents ?? []).map((e) => e.id);
    // Si el gestor no tiene eventos, no hay solicitudes que mostrar.
    if (myEventIds.length === 0) {
      setRequests([]); setGuestReqs([]); setLoading(false); return;
    }
    // Si vienen filtrados por eventId del prop, intersectamos.
    const targetIds = eventId ? [eventId].filter((id) => myEventIds.includes(id)) : myEventIds;
    if (targetIds.length === 0) {
      setRequests([]); setGuestReqs([]); setLoading(false); return;
    }

    const nowIso      = new Date().toISOString();
    const guestCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

    // 1. Solicitudes de usuarios registrados (cash_payment_requests)
    //    Filtro por expires_at>now para que las expiradas no aparezcan aunque
    //    el RPC todavía no las haya marcado (defensa en profundidad).
    const q1 = supabase
      .from('cash_payment_requests')
      .select('*, user:users!user_id(nombre, correo), event:events!event_id(nombre, precio)')
      .eq('status', 'pending')
      .in('event_id', targetIds)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true });

    // 2. Invitados pendientes de pago en efectivo: 24h desde created_at.
    const q2 = supabase
      .from('event_guests')
      .select('id, event_id, nombre, telefono, monto_pagado, invited_by, created_at, event:events!event_id(nombre, precio), inviter:users!invited_by(nombre, correo)')
      .eq('status', 'pending_payment')
      .eq('metodo_pago', 'efectivo')
      .in('event_id', targetIds)
      .gt('created_at', guestCutoff)
      .order('created_at', { ascending: true });

    const [{ data: regs }, { data: gs }] = await Promise.all([q1, q2]);
    setRequests(regs ?? []);
    setGuestReqs(gs ?? []);
    setLoading(false);
  }

  async function approve(r) {
    setProcessing(r.id);
    try {
      const { error } = await supabase.from('event_registrations').upsert({
        event_id:     r.event_id,
        user_id:      r.user_id,
        metodo_pago:  'efectivo',
        monto_pagado: r.amount,
        status:       'confirmed',
      }, { onConflict: 'event_id,user_id' });
      if (error) throw error;

      await supabase
        .from('cash_payment_requests')
        .update({ status: 'approved', gestor_id: user.id })
        .eq('id', r.id);

      fetchRequests();
      Alert.alert('✅ Aprobado', `${r.user?.nombre} ha sido inscrito.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function reject(r) {
    setProcessing(r.id);
    await supabase
      .from('cash_payment_requests')
      .update({ status: 'rejected', gestor_id: user.id })
      .eq('id', r.id);
    fetchRequests();
    setProcessing(null);
  }

  async function approveGuest(g) {
    setProcessing(`g:${g.id}`);
    try {
      const { error } = await supabase
        .from('event_guests')
        .update({ status: 'confirmed' })
        .eq('id', g.id);
      if (error) throw error;
      fetchRequests();
      Alert.alert('✅ Invitado confirmado', `${g.nombre} ha sido aceptado.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setProcessing(null);
    }
  }

  async function rejectGuest(g) {
    Alert.alert(
      'Rechazar invitado',
      `¿Rechazar a "${g.nombre}"? El cupo se libera.`,
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, rechazar', style: 'destructive', onPress: async () => {
          setProcessing(`g:${g.id}`);
          await supabase
            .from('event_guests')
            .update({ status: 'cancelled' })
            .eq('id', g.id);
          fetchRequests();
          setProcessing(null);
        }},
      ],
    );
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  const totalPending = requests.length + guestReqs.length;
  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>PAGOS EFECTIVO</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {totalPending === 0 && <Text style={styles.empty}>Sin solicitudes de efectivo pendientes</Text>}

        {requests.length > 0 && (
          <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gold, letterSpacing: 1, marginTop: SPACING.sm }}>
            JUGADORES REGISTRADOS ({requests.length})
          </Text>
        )}
        {requests.map((r) => {
          const expired   = new Date(r.expires_at) < new Date();
          const hoursLeft = Math.max(0, Math.ceil((new Date(r.expires_at) - new Date()) / 3600000));
          return (
            <View key={r.id} style={[styles.card, expired && { borderColor: COLORS.red + '44', opacity: 0.7 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{r.user?.nombre}</Text>
                  <Text style={styles.cardSub}>{r.event?.nombre}</Text>
                  <Text style={styles.cardSub}>{r.user?.correo}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.walletBalance}>${Number(r.amount).toFixed(2)}</Text>
                  <Text style={[styles.cardSub, { color: expired ? COLORS.red : COLORS.gold }]}>
                    {expired ? '⏰ Expirado' : `⏱ ${hoursLeft}h restantes`}
                  </Text>
                </View>
              </View>
              {!expired && (
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: COLORS.green + 'CC', opacity: processing === r.id ? 0.5 : 1 }]}
                    onPress={() => approve(r)}
                    disabled={!!processing}
                  >
                    {processing === r.id
                      ? <ActivityIndicator color={COLORS.white} size="small" />
                      : <Text style={styles.btnText}>✓ Confirmar pago</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: COLORS.red + 'CC', opacity: processing === r.id ? 0.5 : 1 }]}
                    onPress={() => reject(r)}
                    disabled={!!processing}
                  >
                    <Text style={styles.btnText}>✗ Rechazar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {guestReqs.length > 0 && (
          <Text style={{ fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.gold, letterSpacing: 1, marginTop: SPACING.lg }}>
            👥 INVITADOS PENDIENTES ({guestReqs.length})
          </Text>
        )}
        {guestReqs.map((g) => (
          <View key={`g:${g.id}`} style={[styles.card, { borderColor: COLORS.purple + '80' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{g.nombre}</Text>
                <Text style={styles.cardSub}>{g.event?.nombre}</Text>
                <Text style={styles.cardSub}>Invitado por: {g.inviter?.nombre ?? '?'}</Text>
                {!!g.telefono && <Text style={styles.cardSub}>📱 {g.telefono}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.walletBalance}>${Number(g.monto_pagado ?? 0).toFixed(2)}</Text>
                <Text style={[styles.cardSub, { color: COLORS.purple }]}>⏳ Esperando</Text>
              </View>
            </View>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.green + 'CC', opacity: processing === `g:${g.id}` ? 0.5 : 1 }]}
                onPress={() => approveGuest(g)}
                disabled={!!processing}
              >
                {processing === `g:${g.id}`
                  ? <ActivityIndicator color={COLORS.white} size="small" />
                  : <Text style={styles.btnText}>✓ Confirmar invitado</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: COLORS.red + 'CC', opacity: processing === `g:${g.id}` ? 0.5 : 1 }]}
                onPress={() => rejectGuest(g)}
                disabled={!!processing}
              >
                <Text style={styles.btnText}>✗ Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Stack ──────────────────────────────────────────────────────────────────
export default function GestorPanel() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="GestorDashboard"    component={GestorDashboard}    />
      <Stack.Screen name="GestorCreateEvent"  component={GestorCreateEvent}  />
      <Stack.Screen name="GestorTeams"        component={GestorTeams}        />
      <Stack.Screen name="GestorMatches"      component={GestorMatches}      />
      <Stack.Screen name="GestorResults"      component={GestorResults}      />
      <Stack.Screen name="GestorMvp"          component={GestorMvp}          />
      <Stack.Screen name="GestorConfig"       component={GestorConfig}       />
      <Stack.Screen name="GestorVentas"       component={GestorVentas}       />
      <Stack.Screen name="GestorCashApprovals"component={GestorCashApprovals}/>
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: COLORS.bg },
  title:          { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, padding: SPACING.md },
  sectionTitle:   { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  selectedEvent:  { fontFamily: FONTS.bodySemiBold, fontSize: 16, color: COLORS.gold, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  eventChip:      { paddingHorizontal: SPACING.md, paddingVertical: 8, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy, marginRight: SPACING.sm, minWidth: 130 },
  eventChipActive:{ backgroundColor: COLORS.blue, borderColor: '#1a3a5c' },
  eventChipText:  { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray2 },
  eventChipSub:   { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: 2 },
  menuGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, padding: SPACING.md },
  menuCard:       { width: '47%', backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.lg, alignItems: 'center', borderWidth: 1, borderColor: COLORS.navy },
  menuIcon:       { fontSize: 32, marginBottom: SPACING.sm },
  menuLabel:      { fontFamily: FONTS.bodyMedium, fontSize: 14, color: COLORS.white },
  list:           { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl },
  card:           { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.sm },
  cardName:       { fontFamily: FONTS.bodySemiBold, fontSize: 15, color: COLORS.white },
  cardSub:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray },
  playerItem:     { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, paddingLeft: SPACING.sm },
  btnRow:         { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', padding: SPACING.md },
  btn:            { flex: 1, borderRadius: RADIUS.sm, padding: SPACING.sm, alignItems: 'center' },
  btnText:        { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  roundTitle:     { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gold, letterSpacing: 2, marginBottom: SPACING.sm, marginTop: SPACING.md },
  matchCard:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.bg2 ?? COLORS.navy, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.sm },
  matchTeam:      { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white, flex: 1, textAlign: 'center' },
  matchVs:        { fontFamily: FONTS.heading, fontSize: 14, color: COLORS.gray, marginHorizontal: SPACING.sm },
  resultRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  teamName:       { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white, flex: 1 },
  scoreInput:     { width: 48, height: 48, backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, textAlign: 'center', fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, borderWidth: 1, borderColor: COLORS.blue },
  vsText:         { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.gray },
  toggleRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggle:         { paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.navy },
  toggleActive:   { backgroundColor: '#2DC653' },
  toggleText:     { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.white },
  empty:          { fontFamily: FONTS.body, color: COLORS.gray, textAlign: 'center', padding: SPACING.xl },
  grupoBadge:     { backgroundColor: COLORS.navy, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: COLORS.blue },
  grupoBadgeText: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray2 },
  chip:           { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  chipActive:     { backgroundColor: COLORS.blue, borderColor: '#1a3a5c' },
  chipText:       { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14 },
  modalOverlay:   { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', alignItems: 'center' },
  modalBox:       { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.lg, width: '80%', borderWidth: 1, borderColor: COLORS.navy },
  modalTitle:     { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2, marginBottom: SPACING.sm },
  modalSub:       { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },
  // GestorCreateEvent styles
  fieldLabel:     { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gray, marginTop: SPACING.sm, marginBottom: 4 },
  input:          { backgroundColor: COLORS.navy, borderRadius: RADIUS.sm, padding: SPACING.sm, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, borderWidth: 1, borderColor: COLORS.navy + 'CC' },
  btnSmall:       { borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 4, backgroundColor: COLORS.navy, borderWidth: 1, borderColor: COLORS.navy },
  btnSmallText:   { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white },
});
