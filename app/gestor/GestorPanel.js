import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createStackNavigator } from '@react-navigation/stack';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { sendLocalNotification, sendPushNotificationsToEventPlayers } from '../../lib/notifications';
import useAuthStore from '../../store/authStore';
import {
  generateLigaFixture,
  generateGroupStageFixture,
  generateKnockoutBracket,
  generateRoundRobin,
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
  const [events,        setEvents]        = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading,       setLoading]       = useState(true);

  // Refresh whenever the screen is focused (so newly created events appear)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', fetchEvents);
    return unsubscribe;
  }, [navigation]);

  useEffect(() => { fetchEvents(); }, []);

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
    { label: 'Equipos',    icon: '🎽', route: 'GestorTeams'   },
    { label: 'Jornadas',   icon: '📆', route: 'GestorMatches'  },
    { label: 'Resultados', icon: '⚽', route: 'GestorResults'  },
    { label: 'MVP',        icon: '🏆', route: 'GestorMvp'      },
    { label: 'Config',     icon: '⚙️', route: 'GestorConfig'   },
    { label: 'Ventas',     icon: '💵', route: 'GestorVentas'   },
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
            <Text style={styles.selectedEvent}>{selectedEvent.nombre}</Text>
            <View style={styles.menuGrid}>
              {sections.map((s) => (
                <TouchableOpacity
                  key={s.route}
                  style={styles.menuCard}
                  onPress={() => navigation.navigate(s.route, { eventId: selectedEvent.id })}
                >
                  <Text style={styles.menuIcon}>{s.icon}</Text>
                  <Text style={styles.menuLabel}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <View style={{ height: SPACING.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Crear Evento (gestor) ──────────────────────────────────────────────────
function GestorCreateEvent({ navigation }) {
  const { user } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nombre: '', formato: 'Liga', deporte: 'Fútbol 7', fecha: '', hora: '',
    lugar: '', precio: '0', cupos_total: '', cupos_ilimitado: false,
    descripcion: '', jugadores_por_equipo: null, jornadas: '1',
    num_grupos: '2', equipos_por_grupo: '3',
    tiene_octavos: false, tiene_cuartos: false,
    tiene_semis: true, tiene_tercer_lugar: true, tiene_final: true,
    ida_y_vuelta: false,
  });

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cuposNum = parseInt(form.cupos_total) || 0;
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
      const { error } = await supabase.from('events').insert({
        nombre:              form.nombre.trim(),
        formato:             form.formato,
        deporte:             form.deporte,
        fecha:               form.fecha,
        hora:                form.hora,
        lugar:               form.lugar.trim(),
        precio:              precioVal,
        cupos_total:         form.cupos_ilimitado ? null : (parseInt(form.cupos_total) || null),
        cupos_ilimitado:     form.cupos_ilimitado,
        descripcion:         form.descripcion || null,
        status:              'draft',
        created_by:          user?.id,
        jugadores_por_equipo:form.jugadores_por_equipo,
        jornadas:            form.formato === 'Liga' ? (parseInt(form.jornadas) || 1) : 1,
        num_grupos:          form.formato === 'Torneo' ? (parseInt(form.num_grupos) || 2) : null,
        equipos_por_grupo:   form.formato === 'Torneo' ? (parseInt(form.equipos_por_grupo) || 3) : null,
        tiene_octavos:       form.formato === 'Torneo' ? form.tiene_octavos : false,
        tiene_cuartos:       form.formato === 'Torneo' ? form.tiene_cuartos : false,
        tiene_semis:         form.formato === 'Torneo' ? form.tiene_semis : false,
        tiene_tercer_lugar:  form.formato === 'Torneo' ? form.tiene_tercer_lugar : false,
        tiene_final:         form.formato === 'Torneo' ? form.tiene_final : false,
        ida_y_vuelta:        form.ida_y_vuelta,
      });
      if (error) throw error;
      Alert.alert('¡Evento creado!', `"${form.nombre}" creado en borrador. Publica cuando esté listo.`);
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
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: 60 }]}>
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
          {['Liga','Torneo','Amistoso'].map((f) => (
            <TouchableOpacity key={f} style={[styles.chip, form.formato === f && styles.chipActive]} onPress={() => upd('formato', f)}>
              <Text style={[styles.chipText, form.formato === f && { color: COLORS.white }]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Fecha * (YYYY-MM-DD)</Text>
        <TextInput style={styles.input} placeholder="2026-06-15" placeholderTextColor={COLORS.gray} value={form.fecha} onChangeText={(v) => upd('fecha', v)} />

        <Text style={styles.fieldLabel}>Hora * (HH:MM)</Text>
        <TextInput style={styles.input} placeholder="08:00" placeholderTextColor={COLORS.gray} value={form.hora} onChangeText={(v) => upd('hora', v)} />

        <Text style={styles.fieldLabel}>Lugar *</Text>
        <TextInput style={styles.input} placeholder="Cancha / Estadio" placeholderTextColor={COLORS.gray} value={form.lugar} onChangeText={(v) => upd('lugar', v)} />

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
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm }}>
              {['2','3','4'].map((n) => (
                <TouchableOpacity key={n} style={[styles.chip, form.num_grupos === n && styles.chipActive]} onPress={() => upd('num_grupos', n)}>
                  <Text style={[styles.chipText, form.num_grupos === n && { color: COLORS.white }]}>{n} grupos</Text>
                </TouchableOpacity>
              ))}
            </View>
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

  // WC fix M5: guard against undefined eventId (deep-link / missing params)
  useEffect(() => { if (eventId) fetchData(); }, []);

  async function fetchData() {
    try {
      const [{ data: ev }, { data: t }, { data: regs }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('teams').select('*, team_players(user_id, users(nombre, genero))').eq('event_id', eventId),
        supabase.from('event_registrations').select('user_id, users(nombre, genero)').eq('event_id', eventId).eq('status', 'confirmed'),
      ]);
      setEvent(ev ?? null);
      setTeams(t ?? []);
      setPlayers(regs ?? []);
    } catch (e) {
      console.warn('GestorTeams fetchData error:', e.message);
    }
  }

  async function createAutoTeams() {
    const jpq   = event?.jugadores_por_equipo;
    const cupos = event?.cupos_total ?? players.length;
    if (!jpq) { Alert.alert('Error', 'El evento no tiene jugadores por equipo definido.'); return; }

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
    const hasWomen = players.some((p) => p.users?.genero === 'Femenino');
    if (hasWomen) { setMixModal(true); }
    else { doAutoAssign(0); }
  }

  async function doAutoAssign(chicasCount) {
    if (teams.length === 0) { Alert.alert('Error', 'Crea equipos primero.'); return; }
    setMixModal(false);
    // Limpiar asignaciones previas
    for (const t of teams) {
      await supabase.from('team_players').delete().eq('team_id', t.id);
    }

    const mujeres   = players.filter((p) => p.users?.genero === 'Femenino').sort(() => Math.random() - 0.5);
    const hombres   = players.filter((p) => p.users?.genero !== 'Femenino').sort(() => Math.random() - 0.5);
    const sobrantes = [];
    const allInserts = [];

    // Slot-filling: garantiza chicasCount mujeres por equipo
    let fi = 0;
    for (let t = 0; t < teams.length && fi < mujeres.length; t++) {
      for (let slot = 0; slot < chicasCount && fi < mujeres.length; slot++) {
        allInserts.push({ team_id: teams[t].id, user_id: mujeres[fi].user_id });
        fi++;
      }
    }
    while (fi < mujeres.length) { sobrantes.push(mujeres[fi]); fi++; }

    // Hombres en round-robin
    hombres.forEach((p, i) => {
      allInserts.push({ team_id: teams[i % teams.length].id, user_id: p.user_id });
    });

    if (allInserts.length > 0) {
      // WC fix C8: verificar error en insert — no mostrar "asignados" si falló
      const { error } = await supabase.from('team_players').insert(allInserts);
      if (error) {
        Alert.alert('Error al asignar', error.message);
        fetchData();
        return;
      }
    }
    fetchData();
    Alert.alert(
      '¡Listo!',
      sobrantes.length > 0
        ? `Jugadores asignados. ${sobrantes.length} mujer(es) quedaron sin equipo — asígnalas manualmente.`
        : 'Jugadores asignados aleatoriamente.',
    );
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

  async function removePlayerFromTeam(teamId, userId) {
    const { error } = await supabase.from('team_players').delete().eq('team_id', teamId).eq('user_id', userId);
    if (error) { Alert.alert('Error', error.message); return; }
    fetchData();
  }

  async function assignPlayerToTeam(teamId, userId) {
    // WC fix M8: eliminar de cualquier otro equipo antes de asignar
    await supabase.from('team_players').delete().eq('user_id', userId);
    const { error } = await supabase.from('team_players').insert({ team_id: teamId, user_id: userId });
    if (error) { Alert.alert('Error', error.message); return; }
    setAssignExpanded(null);
    fetchData();
  }

  const assignedIds = new Set(teams.flatMap(t => t.team_players?.map(tp => tp.user_id) ?? []));
  const unassigned  = players.filter(p => !assignedIds.has(p.user_id));

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
              <Text style={styles.cardSub}>{t.team_players?.length ?? 0} jug.</Text>
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
            {(t.team_players?.length ?? 0) === 0
              ? <Text style={[styles.cardSub, { fontStyle:'italic', paddingLeft: 18 }]}>Sin jugadores asignados</Text>
              : t.team_players?.map((tp) => (
                <View key={tp.user_id} style={{ flexDirection:'row', alignItems:'center', paddingLeft: 18, paddingVertical: 2 }}>
                  <Text style={[styles.playerItem, { flex: 1 }]}>
                    {tp.users?.nombre}{tp.users?.genero === 'Femenino' ? ' ♀' : ''}
                  </Text>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 8 }}
                    onPress={() => removePlayerFromTeam(t.id, tp.user_id)}
                  >
                    <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyBold, fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))
            }
          </View>
        ))}

        {/* Jugadores sin equipo */}
        {unassigned.length > 0 && (
          <View style={styles.card}>
            <Text style={[styles.cardName, { color: COLORS.gold, marginBottom: SPACING.sm }]}>
              ⚠️ Sin equipo ({unassigned.length})
            </Text>
            {unassigned.map((p) => (
              <View key={p.user_id}>
                <View style={{ flexDirection:'row', alignItems:'center', paddingVertical: 4 }}>
                  <Text style={[styles.cardSub, { flex: 1 }]}>
                    {p.users?.nombre}{p.users?.genero === 'Femenino' ? ' ♀' : ''}
                  </Text>
                  <TouchableOpacity
                    style={[styles.btnSmall, { backgroundColor: COLORS.green + '40' }]}
                    onPress={() => setAssignExpanded(assignExpanded === p.user_id ? null : p.user_id)}
                  >
                    <Text style={styles.btnSmallText}>{assignExpanded === p.user_id ? '▲' : '+ Equipo'}</Text>
                  </TouchableOpacity>
                </View>
                {assignExpanded === p.user_id && (
                  <View style={{ flexDirection:'row', flexWrap:'wrap', gap: 6, paddingLeft: 8, paddingBottom: 4 }}>
                    {teams.map((t) => (
                      <TouchableOpacity
                        key={t.id}
                        style={{ flexDirection:'row', alignItems:'center', gap: 4, backgroundColor: (t.color ?? COLORS.blue) + '30', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.color ?? COLORS.navy }}
                        onPress={() => assignPlayerToTeam(t.id, p.user_id)}
                      >
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? COLORS.blue }} />
                        <Text style={{ fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.white }}>{t.nombre}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
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
        <View style={styles.modalOverlay}>
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
        </View>
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

  // WC fix M5: guard against undefined eventId
  useEffect(() => { if (eventId) fetchData(); }, []);

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
  const [matches, setMatches] = useState([]);
  const [scores,  setScores]  = useState({});
  const [saving,  setSaving]  = useState(null); // matchId being saved — WC M2: previene doble-tap

  useEffect(() => {
    if (!eventId) return; // WC fix M5
    supabase.from('matches')
      .select('*, home:team_home_id(nombre,color), away:team_away_id(nombre,color)')
      .eq('event_id', eventId)
      .neq('status', 'finished')
      .not('team_home_id', 'is', null)
      .order('jornada')
      .then(({ data }) => setMatches(data ?? []));
  }, []);

  async function saveResult(match) {
    if (saving === match.id) return; // WC fix M2: previene doble-tap
    const { home: hG, away: aG } = scores[match.id] ?? {};
    if (hG === undefined || hG === '' || aG === undefined || aG === '') {
      Alert.alert('Error', 'Ingresa los goles de ambos equipos.'); return;
    }
    const homeGoals = parseInt(hG, 10);
    const awayGoals = parseInt(aG, 10);
    if (isNaN(homeGoals) || isNaN(awayGoals) || homeGoals < 0 || awayGoals < 0) {
      Alert.alert('Error', 'Ingresa un número válido (0 o más) para el marcador.'); return;
    }
    setSaving(match.id);
    try {
      const now      = new Date().toISOString();
      const closesAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      // BUG FIX: add .neq('status','finished') guard so a re-save on an already-finished
      // match (e.g. app closed mid-save, screen not yet refreshed) does NOT overwrite.
      const { error, count } = await supabase.from('matches').update({
        goles_home:    homeGoals,
        goles_away:    awayGoals,
        status:        'finished',
        finished_at:   now,
        mvp_closes_at: closesAt,
      }).eq('id', match.id).neq('status', 'finished').select('id', { count: 'exact', head: true });
      if (error) { Alert.alert('Error', error.message); return; }
      if (count === 0) {
        // 0 rows affected — already finished by another session
        Alert.alert('Ya registrado', 'Este partido ya fue registrado por otra sesión.');
        setMatches((prev) => prev.filter((m) => m.id !== match.id));
        return;
      }
      setMatches((prev) => prev.filter((m) => m.id !== match.id));
      // Standings se actualizan automáticamente via VIEW en Supabase
      // Notify all registered players about the result
      sendPushNotificationsToEventPlayers(
        eventId,
        `Resultado registrado`,
        `${match.home?.nombre} ${homeGoals} - ${awayGoals} ${match.away?.nombre}`
      );
      Alert.alert('✓ Guardado', `${match.home?.nombre} ${homeGoals} - ${awayGoals} ${match.away?.nombre}\n\n🏆 Votación MVP abierta por 2 horas.`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>RESULTADOS</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {matches.length === 0 && <Text style={styles.empty}>No hay partidos pendientes</Text>}
        {matches.map((m) => (
          <View key={m.id} style={styles.card}>
            <Text style={styles.cardSub}>Jornada {m.jornada} · {(m.fase ?? 'grupos').toUpperCase()}</Text>
            <View style={styles.resultRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                {m.home?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.home.color, marginRight: 6 }} />}
                <Text style={[styles.teamName, { flex: 0 }]}>{m.home?.nombre}</Text>
              </View>
              <TextInput
                style={styles.scoreInput}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="0"
                placeholderTextColor={COLORS.gray}
                value={scores[m.id]?.home ?? ''}
                onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], home: v } }))}
              />
              <Text style={styles.vsText}>:</Text>
              <TextInput
                style={styles.scoreInput}
                keyboardType="number-pad"
                maxLength={2}
                placeholder="0"
                placeholderTextColor={COLORS.gray}
                value={scores[m.id]?.away ?? ''}
                onChangeText={(v) => setScores((s) => ({ ...s, [m.id]: { ...s[m.id], away: v } }))}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                <Text style={[styles.teamName, { flex: 0, textAlign: 'right' }]}>{m.away?.nombre}</Text>
                {m.away?.color && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.away.color, marginLeft: 6 }} />}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#2DC65399', marginTop: SPACING.sm, opacity: saving === m.id ? 0.6 : 1 }]}
              onPress={() => saveResult(m)}
              disabled={saving === m.id}
            >
              {saving === m.id
                ? <ActivityIndicator color={COLORS.white} size="small" />
                : <Text style={styles.btnText}>✓ Guardar resultado</Text>
              }
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── MVP ────────────────────────────────────────────────────────────────────
function GestorMvp({ route }) {
  const { eventId } = route.params ?? {};
  const [event,          setEvent]          = useState(null);
  const [players,        setPlayers]        = useState([]);
  const [mvpResult,      setMvpResult]      = useState(null);
  const [mvpVotesByPlayer, setMvpVotesByPlayer] = useState({});
  const [mvpTotalVotes,  setMvpTotalVotes]  = useState(0);
  const [loading,        setLoading]        = useState(true);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => { if (eventId) fetchData(); else setLoading(false); }, []);

  async function fetchData() {
    if (mountedRef.current) setLoading(true);
    try {
      const [{ data: ev }, { data: regs }, { data: evMvpResult }, { data: evVotes }] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('event_registrations').select('user_id, users(nombre, foto_url)').eq('event_id', eventId).eq('status', 'confirmed'),
        supabase.from('mvp_results').select('*, users(nombre, foto_url)').eq('event_id', eventId).maybeSingle(),
        supabase.from('mvp_votes').select('voted_for_id').eq('event_id', eventId),
      ]);
      if (!mountedRef.current) return;

      const byPlayer = (evVotes ?? []).reduce((acc, v) => {
        acc[v.voted_for_id] = (acc[v.voted_for_id] ?? 0) + 1;
        return acc;
      }, {});

      setEvent(ev);
      setPlayers(regs ?? []);
      setMvpResult(evMvpResult ?? null);
      setMvpVotesByPlayer(byPlayer);
      setMvpTotalVotes((evVotes ?? []).length);
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

    const winner = players.find((p) => p.user_id === winnerId);
    Alert.alert('🏆 MVP Definido', `${winner?.users?.nombre ?? 'Jugador'} con ${winnerVotes} voto(s). +$1 acreditado.`);
    fetchData();
  }

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;

  const votingOpen = event?.mvp_voting_open && !mvpResult;
  const closesAt   = event?.mvp_closes_at ? new Date(event.mvp_closes_at) : null;
  const expired    = closesAt && closesAt < new Date();
  const countdown  = closesAt && !expired
    ? Math.max(0, Math.ceil((closesAt - new Date()) / 60000))
    : 0;

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.title}>MVP DEL EVENTO</Text>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.card}>
          <Text style={[styles.cardName, { marginBottom: SPACING.sm }]}>🏆 Jugador más valioso</Text>

          {mvpResult ? (
            <View style={{ backgroundColor: COLORS.gold + '20', borderRadius: RADIUS.sm, padding: SPACING.md }}>
              <Text style={[styles.cardName, { color: COLORS.gold }]}>🥇 {mvpResult.users?.nombre}</Text>
              <Text style={styles.cardSub}>{mvpResult.votos_totales} votos · +${mvpResult.premio_wallet} acreditado</Text>
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
                  const p = players.find(pl => pl.user_id === uid);
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
                {players.length} jugador(es) inscrito(s) son candidatos.
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
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Config Evento ──────────────────────────────────────────────────────────
function GestorConfig({ route }) {
  const { eventId } = route.params ?? {};
  const [event,      setEvent]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [cancelling, setCancelling] = useState(false);

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
      const newsTitle = `🏁 ${event?.nombre ?? 'Evento'} — Finalizado`;
      const newsBody  = `El evento ${event?.nombre ?? ''} ha concluido. Revisa los resultados y la tabla de posiciones.`;
      const finishedAt = new Date().toISOString();
      const { error } = await supabase.from('events').update({ status: newStatus, event_finished_at: finishedAt }).eq('id', eventId);
      if (error) { Alert.alert('Error', error.message); return; }
      setEvent((e) => ({ ...e, status: newStatus, event_finished_at: finishedAt }));
      await supabase.from('news').insert({
        titulo:    newsTitle,
        contenido: newsBody,
        tipo:      'resultados',
      }).catch(() => {});
      sendLocalNotification(newsTitle, newsBody);
      // Notify all players of this event via push
      sendPushNotificationsToEventPlayers(eventId, newsTitle, newsBody);
      Alert.alert('Evento finalizado', 'Se publicó una noticia automáticamente. El evento se ocultará a los jugadores en 24 horas.');
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
      `¿Cancelar "${event.nombre}"?\n\nTodos los jugadores con inscripción confirmada recibirán un reembolso automático a su wallet. Esta acción NO se puede deshacer.`,
      [
        { text: 'No cancelar', style: 'cancel' },
        { text: 'Cancelar evento', style: 'destructive', onPress: async () => {
          setCancelling(true);
          try {
            // 1. Get all confirmed paid registrations
            const { data: regs, error: regsErr } = await supabase
              .from('event_registrations')
              .select('id, user_id, monto_pagado')
              .eq('event_id', eventId)
              .eq('status', 'confirmed');
            if (regsErr) throw regsErr;

            // 2. Cancel all registrations atomically
            await supabase.from('event_registrations').update({ status: 'cancelled' }).eq('event_id', eventId).eq('status', 'confirmed');

            // 3. Refund each paid player
            let refundCount = 0;
            let refundTotal = 0;
            for (const reg of (regs ?? [])) {
              const monto = reg.monto_pagado ?? 0;
              if (monto > 0) {
                try {
                  await supabase.rpc('credit_wallet', {
                    p_user_id:     reg.user_id,
                    p_monto:       monto,
                    p_tipo:        'reembolso',
                    p_descripcion: `Reembolso: cancelación de ${event.nombre}`,
                  });
                  refundCount++;
                  refundTotal += monto;
                } catch (e) {
                  console.warn(`cancelEvent refund error for ${reg.user_id}:`, e.message);
                }
              }
            }

            // 4. Mark event as cancelled and hidden
            await supabase.from('events').update({ status: 'cancelled', visible: false }).eq('id', eventId);
            setEvent((e) => ({ ...e, status: 'cancelled', visible: false }));

            // 5. Auto-news
            await supabase.from('news').insert({
              titulo:    `🚫 ${event.nombre} — Cancelado`,
              contenido: `El evento "${event.nombre}" fue cancelado. ${refundCount} jugador(es) recibieron reembolso automático por un total de $${refundTotal.toFixed(2)}.`,
              tipo:      'general',
            }).catch(() => {});
            sendLocalNotification(`🚫 ${event.nombre} cancelado`, `Se emitieron ${refundCount} reembolso(s) automáticos.`);
            // Notify all players via push
            sendPushNotificationsToEventPlayers(eventId, `🚫 ${event.nombre} cancelado`, `El evento fue cancelado. ${refundCount > 0 ? `Recibiste un reembolso.` : 'Contacta al organizador.'}`);

            Alert.alert(
              'Evento cancelado',
              `${refundCount} jugador(es) reembolsados ($${refundTotal.toFixed(2)} en total). El evento ya no es visible.`
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
    finished: [],
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

// ── Stack ──────────────────────────────────────────────────────────────────
export default function GestorPanel() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="GestorDashboard"   component={GestorDashboard}   />
      <Stack.Screen name="GestorCreateEvent" component={GestorCreateEvent} />
      <Stack.Screen name="GestorTeams"       component={GestorTeams}       />
      <Stack.Screen name="GestorMatches"     component={GestorMatches}     />
      <Stack.Screen name="GestorResults"     component={GestorResults}     />
      <Stack.Screen name="GestorMvp"         component={GestorMvp}         />
      <Stack.Screen name="GestorConfig"      component={GestorConfig}      />
      <Stack.Screen name="GestorVentas"      component={GestorVentas}      />
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
