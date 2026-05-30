import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { sendPushNotificationsToEventPlayers, broadcastNotification } from '../../../lib/notifications';
import { calcTeams } from '../../../lib/eventHelpers';
import { DateField, TimeField } from '../../../components/DateTimeField';
import { uploadImage } from '../../../lib/uploadImage';
import { processEventImage } from '../../../lib/processEventImage';
import CanchaCostoPicker from '../../../components/CanchaCostoPicker';

export default function EditEventScreen({ route, navigation }) {
  const { eventId } = route.params ?? {};
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [newImageUri, setNewImageUri] = useState(null);
  const [form, setForm] = useState(null);

  useEffect(() => { loadEvent(); }, [eventId]);

  async function loadEvent() {
    if (!eventId) { setLoading(false); return; }
    const { data, error } = await supabase.from('events').select('*').eq('id', eventId).single();
    if (error || !data) {
      Alert.alert('Error', 'No se pudo cargar el evento.');
      navigation.goBack();
      return;
    }
    setForm({
      nombre:              data.nombre ?? '',
      formato:             data.formato ?? 'Liga',
      deporte:             data.deporte ?? 'Fútbol',
      fecha:               data.fecha ?? '',
      hora:                data.hora?.slice(0, 5) ?? '',
      lugar:               data.lugar ?? '',
      direccion:           data.direccion ?? '',
      maps_url:            data.maps_url ?? '',
      precio:              String(data.precio ?? '0'),
      cupos_total:         data.cupos_total != null ? String(data.cupos_total) : '',
      cupos_hombres:       data.cupos_hombres != null ? String(data.cupos_hombres) : '',
      cupos_mujeres:       data.cupos_mujeres != null ? String(data.cupos_mujeres) : '',
      cupos_ilimitado:     data.cupos_ilimitado ?? false,
      cancha_costo:        data.cancha_costo ?? null,
      cancha_tarifa_id:    data.cancha_tarifa_id ?? null,
      duracion_horas:      data.duracion_horas ?? null,
      descripcion:         data.descripcion ?? '',
      jugadores_por_equipo: data.jugadores_por_equipo ?? null,
      genero:              data.genero ?? null,
      cancha_foto_url:     data.cancha_foto_url ?? null,
      vidas_por_equipo:    data.vidas_por_equipo ?? 3,
      jornadas:            data.jornadas != null ? String(data.jornadas) : '1',
      ida_y_vuelta:        data.ida_y_vuelta ?? false,
      num_grupos:          data.num_grupos ?? 1,
    });
    setLoading(false);
  }

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cuposNum = parseInt(form?.cupos_total) || 0;
  const teamCalc = form?.jugadores_por_equipo && cuposNum
    ? calcTeams(cuposNum, form.jugadores_por_equipo) : null;

  const pickPhoto = async () => {
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
      setNewImageUri(processed);
    } catch (e) {
      Alert.alert('No se pudo procesar la imagen', e.message || 'Probá con otra foto.');
    }
  };

  const uploadPhoto = async (source) => {
    const path = `events/${eventId}_${Date.now()}.jpg`;
    return uploadImage('event-photos', path, source);
  };

  async function saveEvent() {
    if (!form.nombre.trim() || !form.fecha || !form.hora || !form.lugar.trim()) {
      Alert.alert('Error', 'Nombre, fecha, hora y lugar son obligatorios.'); return;
    }
    const precioVal = parseFloat(form.precio);
    if (isNaN(precioVal) || precioVal < 0) {
      Alert.alert('Precio inválido', 'El precio debe ser 0 (gratis) o un monto positivo.'); return;
    }
    if (!form.cupos_ilimitado) {
      const cuposVal = parseInt(form.cupos_total);
      if (!cuposVal || cuposVal <= 0) {
        Alert.alert('Cupos inválidos', 'Introduce un número válido de cupos o activa "Cupos ilimitados".'); return;
      }
      if (form.genero === 'Mixto' && (form.cupos_hombres !== '' || form.cupos_mujeres !== '')) {
        const ch = parseInt(form.cupos_hombres);
        const cm = parseInt(form.cupos_mujeres);
        if (isNaN(ch) || isNaN(cm) || ch < 0 || cm < 0) {
          Alert.alert('Cupos por género inválidos', 'Ingresá un número válido (0 o más) en cupos hombres y mujeres.'); return;
        }
        if (ch + cm !== cuposVal) {
          Alert.alert('La suma no coincide', `Hombres (${ch}) + Mujeres (${cm}) = ${ch + cm}, pero los cupos totales son ${cuposVal}. Ajustá la división.`); return;
        }
      }
    }
    if (teamCalc && !teamCalc.esExacto) {
      const jpq   = form.jugadores_por_equipo;
      const numEq = Math.floor(cuposNum / jpq);
      Alert.alert('Cupos inválidos', `Con ${jpq} por equipo los cupos deben ser múltiplo de ${jpq}.\n• ${numEq} equipos → ${numEq * jpq}\n• ${numEq + 1} equipos → ${(numEq + 1) * jpq}`);
      return;
    }

    setSaving(true);
    try {
      let cancha_foto_url = form.cancha_foto_url;
      if (newImageUri) {
        cancha_foto_url = await uploadPhoto(newImageUri);
      }

      const { error } = await supabase.from('events').update({
        nombre:               form.nombre.trim(),
        formato:              form.formato,
        deporte:              form.deporte,
        fecha:                form.fecha,
        hora:                 form.hora,
        lugar:                form.lugar.trim(),
        direccion:            form.direccion.trim() || null,
        maps_url:             form.maps_url.trim() || null,
        precio:               precioVal,
        cupos_total:          form.cupos_ilimitado ? null : (parseInt(form.cupos_total) || null),
        cupos_hombres:        (form.genero === 'Mixto' && !form.cupos_ilimitado && form.cupos_hombres !== '') ? (parseInt(form.cupos_hombres) || 0) : null,
        cupos_mujeres:        (form.genero === 'Mixto' && !form.cupos_ilimitado && form.cupos_mujeres !== '') ? (parseInt(form.cupos_mujeres) || 0) : null,
        cupos_ilimitado:      form.cupos_ilimitado,
        cancha_costo:         form.cancha_costo != null ? Number(form.cancha_costo) : null,
        cancha_tarifa_id:     form.cancha_tarifa_id ?? null,
        duracion_horas:       form.duracion_horas ?? null,
        descripcion:          form.descripcion || null,
        jugadores_por_equipo: form.jugadores_por_equipo,
        genero:               form.genero || null,
        cancha_foto_url,
        vidas_por_equipo:     form.formato === '2 Vidas' ? (form.vidas_por_equipo ?? 3) : null,
        jornadas:             form.formato === 'Liga' ? (parseInt(form.jornadas) || 1) : null,
        ida_y_vuelta:         form.formato === 'Liga' ? !!form.ida_y_vuelta : false,
        num_grupos:           form.formato === 'Torneo' ? (parseInt(form.num_grupos) || 1) : null,
      }).eq('id', eventId);
      if (error) throw error;

      // Notify registered players about the update
      const title = `📝 ${form.nombre.trim()} — Información actualizada`;
      const body  = `Se actualizaron los detalles del evento. Revisa fecha, hora o lugar.`;
      sendPushNotificationsToEventPlayers(eventId, title, body).catch(() => {});

      Alert.alert('¡Listo!', 'Evento actualizado. Los jugadores inscritos recibieron una notificación.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  // Broadcast a TODOS los usuarios (no solo inscritos) para atraer nuevas inscripciones.
  // El edge function valida rol admin/gestor del lado servidor.
  const notifyEventAvailable = () => {
    const nombre  = (form?.nombre || '').trim() || 'el evento';
    const cuando  = [form?.fecha, form?.hora].filter(Boolean).join(' ');
    const lugar   = (form?.lugar || '').trim();
    const detalle = [cuando, lugar].filter(Boolean).join(' · ');
    Alert.alert(
      'Notificar a todos',
      `Se enviará una alerta a TODOS los usuarios con notificaciones activas anunciando "${nombre}". ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar', onPress: async () => {
          setNotifying(true);
          try {
            const res = await broadcastNotification(
              `⚽ Nuevo evento: ${nombre}`,
              detalle ? `${detalle}. ¡Inscribite ya!` : '¡Ya está disponible! Inscribite ya.',
              { url: `/evento/${eventId}` }
            );
            const a = res?.result?.audience ?? 0;
            if (res?.ok) {
              Alert.alert('📣 Aviso enviado', `Notificamos a ${a} ${a === 1 ? 'usuario' : 'usuarios'} con notificaciones activas.`);
            } else {
              Alert.alert('No se pudo enviar', res?.error ?? 'Error desconocido. Verificá que tu cuenta sea admin/gestor.');
            }
          } finally {
            setNotifying(false);
          }
        }},
      ]
    );
  };

  if (loading || !form) {
    return <ActivityIndicator style={{ flex: 1 }} color={COLORS.red} />;
  }

  const photoUri = (typeof newImageUri === 'object' && (newImageUri?.previewUrl || newImageUri?.uri))
    ? (newImageUri.previewUrl || newImageUri.uri)
    : (newImageUri ?? form.cancha_foto_url);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>EDITAR EVENTO</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          <Text style={styles.label}>Nombre *</Text>
          <TextInput style={styles.input} value={form.nombre} onChangeText={(v) => upd('nombre', v)} placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Deporte</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {['Fútbol','Fútbol 7','Fútbol Sala','Volleyball','Pádel','Basketball','Otro'].map((d) => (
                <TouchableOpacity key={d} style={[styles.chip, form.deporte === d && styles.chipActive]} onPress={() => upd('deporte', d)}>
                  <Text style={[styles.chipText, form.deporte === d && { color: COLORS.white }]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={styles.label}>Formato</Text>
          <View style={styles.chipRow}>
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
              <Text style={styles.label}>Vidas por equipo</Text>
              <View style={styles.chipRow}>
                {[2, 3].map((v) => (
                  <TouchableOpacity key={v} style={[styles.chip, (form.vidas_por_equipo ?? 3) === v && styles.chipActive]} onPress={() => upd('vidas_por_equipo', v)}>
                    <Text style={[styles.chipText, (form.vidas_por_equipo ?? 3) === v && { color: COLORS.white }]}>{v} vidas</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {form.formato === 'Liga' && (
            <>
              <Text style={styles.label}>Jornadas (vueltas)</Text>
              <View style={styles.chipRow}>
                {['1','2','3'].map((j) => (
                  <TouchableOpacity key={j} style={[styles.chip, String(form.jornadas) === j && styles.chipActive]} onPress={() => upd('jornadas', j)}>
                    <Text style={[styles.chipText, String(form.jornadas) === j && { color: COLORS.white }]}>{j}</Text>
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

          {form.formato === 'Torneo' && (
            <>
              <Text style={styles.label}>Número de grupos</Text>
              <View style={styles.chipRow}>
                {[1,2,3,4].map((g) => (
                  <TouchableOpacity key={g} style={[styles.chip, form.num_grupos === g && styles.chipActive]} onPress={() => upd('num_grupos', g)}>
                    <Text style={[styles.chipText, form.num_grupos === g && { color: COLORS.white }]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.label}>Género</Text>
          <View style={styles.chipRow}>
            {[null, 'Masculino', 'Femenino', 'Mixto'].map((g) => (
              <TouchableOpacity key={String(g)} style={[styles.chip, form.genero === g && styles.chipActive]} onPress={() => upd('genero', g)}>
                <Text style={[styles.chipText, form.genero === g && { color: COLORS.white }]}>{g ?? 'Todos'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Fecha *</Text>
          <DateField style={styles.input} value={form.fecha} onChange={(v) => upd('fecha', v)} />

          <Text style={styles.label}>Hora *</Text>
          <TimeField style={styles.input} value={form.hora} onChange={(v) => upd('hora', v)} />

          <Text style={styles.label}>Lugar *</Text>
          <TextInput style={styles.input} value={form.lugar} onChangeText={(v) => upd('lugar', v)} placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Dirección (opcional)</Text>
          <TextInput style={styles.input} value={form.direccion} onChangeText={(v) => upd('direccion', v)} placeholder="Calle, barrio, ciudad..." placeholderTextColor={COLORS.gray} />

          <Text style={styles.label}>Link Google Maps (opcional)</Text>
          <TextInput style={styles.input} value={form.maps_url} onChangeText={(v) => upd('maps_url', v)} placeholder="https://maps.google.com/..." placeholderTextColor={COLORS.gray} autoCapitalize="none" autoCorrect={false} />

          <Text style={styles.label}>Foto de la cancha</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
            <TouchableOpacity
              style={[styles.input, { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }]}
              onPress={pickPhoto}
            >
              {photoUri
                ? <Image source={{ uri: photoUri }} style={{ width: 96, height: 96, borderRadius: RADIUS.sm }} resizeMode="cover" />
                : <Text style={{ color: COLORS.gray, fontFamily: FONTS.body, fontSize: 11, textAlign: 'center' }}>📷{'\n'}Foto</Text>
              }
            </TouchableOpacity>
            {photoUri && (
              <TouchableOpacity
                style={{ backgroundColor: COLORS.red + '22', borderRadius: RADIUS.sm, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.red + '60' }}
                onPress={() => { setNewImageUri(null); upd('cancha_foto_url', null); }}
              >
                <Text style={{ color: COLORS.red, fontFamily: FONTS.bodyMedium, fontSize: 13 }}>🗑 Eliminar foto</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.label}>Precio ($)</Text>
          <TextInput style={styles.input} value={form.precio} onChangeText={(v) => upd('precio', v)} keyboardType="decimal-pad" placeholderTextColor={COLORS.gray} />

          <View style={styles.toggleRow}>
            <Text style={styles.label}>Cupos ilimitados</Text>
            <TouchableOpacity style={[styles.toggle, form.cupos_ilimitado && styles.toggleActive]} onPress={() => upd('cupos_ilimitado', !form.cupos_ilimitado)}>
              <Text style={styles.toggleText}>{form.cupos_ilimitado ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {!form.cupos_ilimitado && (
            <>
              <Text style={styles.label}>Cupos totales</Text>
              <TextInput style={styles.input} value={form.cupos_total} onChangeText={(v) => upd('cupos_total', v)} keyboardType="number-pad" placeholder="20" placeholderTextColor={COLORS.gray} />

              {form.genero === 'Mixto' && (
                <View style={{ backgroundColor: COLORS.card, padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy }}>
                  <Text style={[styles.label, { marginTop: 0, marginBottom: SPACING.sm }]}>Cupos por género (Mixto)</Text>
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, { marginTop: 0 }]}>♂ Hombres</Text>
                      <TextInput style={styles.input} value={form.cupos_hombres} onChangeText={(v) => upd('cupos_hombres', v)} keyboardType="number-pad" placeholder="12" placeholderTextColor={COLORS.gray} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, { marginTop: 0 }]}>♀ Mujeres</Text>
                      <TextInput style={styles.input} value={form.cupos_mujeres} onChangeText={(v) => upd('cupos_mujeres', v)} keyboardType="number-pad" placeholder="8" placeholderTextColor={COLORS.gray} />
                    </View>
                  </View>
                  {(form.cupos_hombres !== '' || form.cupos_mujeres !== '') && form.cupos_total !== '' && (() => {
                    const ch = parseInt(form.cupos_hombres) || 0;
                    const cm = parseInt(form.cupos_mujeres) || 0;
                    const ct = parseInt(form.cupos_total) || 0;
                    const ok = ch + cm === ct;
                    return (
                      <Text style={{ marginTop: SPACING.sm, fontSize: 12, color: ok ? COLORS.green : COLORS.red, fontFamily: FONTS.body }}>
                        {ok ? `✓ Suma OK: ${ch} + ${cm} = ${ct}` : `⚠ Suma ${ch + cm}, esperaba ${ct}`}
                      </Text>
                    );
                  })()}
                  <Text style={{ marginTop: 4, fontSize: 11, color: COLORS.gray, fontFamily: FONTS.body }}>
                    Opcional. Si lo dejás vacío, los cupos se asignan por orden de inscripción sin distinción de género.
                  </Text>
                </View>
              )}
            </>
          )}

          {/* Costo de la cancha — base para calcular la ganancia del gestor */}
          <CanchaCostoPicker
            deporte={form.deporte}
            jugadoresPorEquipo={form.jugadores_por_equipo}
            costoValue={form.cancha_costo}
            tarifaIdValue={form.cancha_tarifa_id}
            duracionValue={form.duracion_horas}
            onChange={({ cancha_costo, cancha_tarifa_id, duracion_horas }) => {
              upd('cancha_costo', cancha_costo);
              upd('cancha_tarifa_id', cancha_tarifa_id);
              upd('duracion_horas', duracion_horas);
            }}
          />

          <Text style={styles.label}>Jugadores por equipo</Text>
          <View style={styles.chipRow}>
            {[null, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
              <TouchableOpacity key={String(n)} style={[styles.chip, form.jugadores_por_equipo === n && styles.chipActive]} onPress={() => upd('jugadores_por_equipo', n)}>
                <Text style={[styles.chipText, form.jugadores_por_equipo === n && { color: COLORS.white }]}>{n === null ? 'Libre' : `${n}v${n}`}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {teamCalc && (
            <View style={[styles.hint, { borderColor: teamCalc.esExacto ? COLORS.green : COLORS.gold }]}>
              <Text style={{ fontFamily: FONTS.bodyMedium, color: teamCalc.esExacto ? COLORS.green : COLORS.gold, fontSize: 13 }}>
                {teamCalc.esExacto
                  ? `✓ ${teamCalc.numEquipos} equipos de ${form.jugadores_por_equipo} jugadores`
                  : `⚠ ${teamCalc.numEquipos} equipos + ${teamCalc.sobrantes} sobrante(s). Recomendado: ${teamCalc.sugerido} cupos`
                }
              </Text>
            </View>
          )}

          <Text style={styles.label}>Descripción</Text>
          <TextInput
            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
            value={form.descripcion}
            onChangeText={(v) => upd('descripcion', v)}
            placeholder="Detalles del evento..."
            placeholderTextColor={COLORS.gray}
            multiline
          />

          <View style={styles.notifHint}>
            <Text style={styles.notifHintText}>🔔 Al guardar se enviará una notificación push a todos los jugadores inscritos.</Text>
          </View>

          <TouchableOpacity style={[styles.btn, saving && { opacity: 0.6 }]} onPress={saveEvent} disabled={saving}>
            {saving
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text style={styles.btnText}>💾 Guardar cambios</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={[styles.notifyAllBtn, (notifying || saving) && { opacity: 0.6 }]} onPress={notifyEventAvailable} disabled={notifying || saving}>
            {notifying
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text style={styles.notifyAllText}>📣 Notificar a todos: evento disponible</Text>
            }
          </TouchableOpacity>
          <Text style={styles.notifyAllHint}>
            Envía una alerta a TODOS los usuarios (no solo inscritos) para atraer nuevas inscripciones. Usalo cuando el evento esté listo.
          </Text>

          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: COLORS.bg },
  header:     { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
  back:       { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  title:      { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 3 },
  content:    { padding: SPACING.md },
  label:      { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray, marginTop: SPACING.md, marginBottom: 4 },
  input:      { backgroundColor: COLORS.card, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.navy, color: COLORS.white, fontFamily: FONTS.body, fontSize: 14, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.sm },
  chip:       { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  chipActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipText:   { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray },
  toggleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.md },
  toggle:     { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  toggleActive:{ backgroundColor: COLORS.blue, borderColor: COLORS.blue },
  toggleText: { fontFamily: FONTS.bodyBold, fontSize: 12, color: COLORS.white },
  hint:       { borderWidth: 1, borderRadius: RADIUS.sm, padding: SPACING.sm, marginTop: 4, marginBottom: SPACING.sm },
  notifHint:  { backgroundColor: COLORS.navy + '66', borderRadius: RADIUS.sm, padding: SPACING.md, marginTop: SPACING.lg, marginBottom: SPACING.md },
  notifHintText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, textAlign: 'center' },
  btn:        { backgroundColor: COLORS.red, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnText:    { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 1 },
  notifyAllBtn:  { backgroundColor: COLORS.blue, borderRadius: RADIUS.md, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.md },
  notifyAllText: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.white },
  notifyAllHint: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center', marginTop: 6 },
});
