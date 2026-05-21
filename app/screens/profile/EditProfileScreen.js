import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { updateUserProfile, uploadAvatar } from '../../../lib/auth';
import SportChips from '../../../components/SportChips';
import { getSportTerms } from '../../../lib/sportTerms';

const NIVELES  = ['Recreativo', 'Amateur', 'Semi-profesional', 'Profesional'];
const GENEROS  = ['Masculino', 'Femenino'];

// Modal para solicitar cambio de género (requiere aprobación admin)
function GenderChangeModal({ visible, currentGenero, onClose, onSent, supabase }) {
  const [newGenero, setNewGenero] = React.useState('');
  const [motivo,    setMotivo]    = React.useState('');
  const [sending,   setSending]   = React.useState(false);

  React.useEffect(() => {
    if (visible) { setNewGenero(''); setMotivo(''); }
  }, [visible]);

  async function send() {
    if (!newGenero) { Alert.alert('Error', 'Selecciona el género nuevo.'); return; }
    if (newGenero === currentGenero) { Alert.alert('Error', 'Es el mismo género actual.'); return; }
    setSending(true);
    try {
      // Obtener user_id del perfil actual
      const { data: { session } } = await supabase.auth.getSession();
      const authId = session?.user?.id;
      if (!authId) throw new Error('No autenticado');
      const { data: profile, error: pErr } = await supabase
        .from('users')
        .select('id')
        .eq('auth_id', authId)
        .single();
      if (pErr || !profile) throw new Error('No se encontró tu perfil');

      const { error } = await supabase.from('gender_change_requests').insert({
        user_id:        profile.id,
        current_genero: currentGenero || null,
        new_genero:     newGenero,
        motivo:         motivo.trim() || null,
      });
      if (error) {
        // 23505 = duplicate key → ya tiene solicitud pendiente
        const isDup = error.code === '23505' || /duplicate|unique/i.test(error.message ?? '');
        throw new Error(isDup
          ? 'Ya tenés una solicitud pendiente. Esperá a que el admin la revise.'
          : (error.message ?? 'Error al enviar la solicitud'));
      }
      Alert.alert('✓ Solicitud enviada', 'Un administrador revisará tu solicitud. Te notificaremos cuando sea aprobada o rechazada.');
      onSent?.();
      onClose();
    } catch (e) {
      Alert.alert('Error', e.message ?? 'Error al enviar');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: SPACING.md }}>
        <View style={{ backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.lg }}>
          <Text style={{ fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2, marginBottom: SPACING.sm }}>SOLICITAR CAMBIO DE GÉNERO</Text>
          <Text style={{ fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, marginBottom: SPACING.md }}>
            Esta solicitud será revisada por un administrador. Una vez aprobada, tu género se actualizará automáticamente.
          </Text>
          <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 12, marginBottom: 4 }}>ACTUAL</Text>
          <View style={[{ alignSelf: 'flex-start', paddingHorizontal: SPACING.md, paddingVertical: 6, borderRadius: RADIUS.full, backgroundColor: COLORS.navy, marginBottom: SPACING.md }]}>
            <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 13 }}>{currentGenero || 'No definido'}</Text>
          </View>

          <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 12, marginBottom: 4 }}>NUEVO GÉNERO</Text>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            {GENEROS.map((g) => (
              <TouchableOpacity
                key={g}
                style={{
                  paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: RADIUS.sm,
                  backgroundColor: newGenero === g ? COLORS.red : COLORS.navy,
                  borderWidth: 1, borderColor: newGenero === g ? COLORS.red : COLORS.navy,
                }}
                onPress={() => setNewGenero(g)}
              >
                <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 13 }}>
                  {g === 'Masculino' ? '♂ Masculino' : '♀ Femenino'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={{ fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 12, marginBottom: 4 }}>MOTIVO (opcional)</Text>
          <TextInput
            value={motivo}
            onChangeText={setMotivo}
            multiline
            numberOfLines={3}
            placeholder="Ej: cargué mi género incorrectamente en el registro"
            placeholderTextColor={COLORS.gray}
            style={{
              backgroundColor: COLORS.bg, borderRadius: RADIUS.sm,
              padding: SPACING.sm, color: COLORS.white, fontFamily: FONTS.body,
              fontSize: 13, borderWidth: 1, borderColor: COLORS.navy,
              minHeight: 70, textAlignVertical: 'top', marginBottom: SPACING.md,
            }}
          />

          <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
            <TouchableOpacity
              style={{ flex: 1, padding: 12, borderRadius: RADIUS.sm, backgroundColor: COLORS.navy, alignItems: 'center' }}
              onPress={onClose} disabled={sending}
            >
              <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.gray2 }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1, padding: 12, borderRadius: RADIUS.sm, backgroundColor: COLORS.red, alignItems: 'center', opacity: sending ? 0.6 : 1 }}
              onPress={send} disabled={sending}
            >
              {sending ? <ActivityIndicator color={COLORS.white} /> : <Text style={{ fontFamily: FONTS.bodyBold, color: COLORS.white, letterSpacing: 1 }}>ENVIAR</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function EditProfileScreen({ navigation }) {
  const { user, updateProfile, updatePhoto } = useAuthStore();

  // Parse stored deporte string → array
  const deportesInit = user?.deporte
    ? user.deporte.split(', ').filter(Boolean)
    : [];

  const generoYaSet = !!user?.genero;   // no editable si ya está guardado

  const [form, setForm] = useState({
    nombre:               user?.nombre ?? '',
    telefono:             user?.telefono ?? '',
    residencia:           user?.residencia ?? '',
    contacto_emergencia:  user?.contacto_emergencia ?? '',
    nivel:                user?.nivel ?? 'Recreativo',
    posicion:             user?.posicion ?? '',
    deportes:             deportesInit,
    genero:               user?.genero ?? '',   // solo editable si es null/vacío
  });
  const [saving,  setSaving]  = useState(false);
  const [photoUri, setPhotoUri] = useState(null);
  const [showGenderModal, setShowGenderModal] = useState(false);
  const [pendingGenderReq, setPendingGenderReq] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('gender_change_requests')
      .select('id, new_genero, status, created_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle()
      .then(({ data }) => setPendingGenderReq(data));
  }, [user?.id]);

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPhotoUri(Platform.OS === 'web' ? asset : asset.uri);
  };

  const toggleDeporte = (label) => {
    const current = form.deportes;
    const next = current.includes(label)
      ? current.filter((d) => d !== label)
      : [...current, label];
    upd('deportes', next);
    if (!next.includes(form.posicion)) upd('posicion', '');
  };

  const posiciones = form.deportes.length > 0
    ? (getSportTerms(form.deportes[0])?.posiciones ?? [])
    : [];

  const save = async () => {
    if (!form.nombre.trim()) { Alert.alert('Error', 'El nombre es requerido.'); return; }
    setSaving(true);
    try {
      if (photoUri) {
        try { await updatePhoto(photoUri); } catch (_) {}
      }
      const patch = {
        nombre:              form.nombre.trim(),
        telefono:            form.telefono,
        residencia:          form.residencia,
        contacto_emergencia: form.contacto_emergencia,
        nivel:               form.nivel,
        posicion:            form.posicion,
        deporte:             form.deportes.join(', ') || 'Sin especificar',
      };
      // Solo guardar género si aún no estaba definido
      if (!generoYaSet && form.genero) patch.genero = form.genero;
      await updateProfile(patch);
      Alert.alert('¡Guardado!', 'Perfil actualizado correctamente.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.back}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>EDITAR PERFIL</Text>
          </View>

          {/* Photo */}
          <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
            <Text style={styles.photoText}>{photoUri ? '✓ Nueva foto seleccionada' : '📷 Cambiar foto de perfil'}</Text>
          </TouchableOpacity>

          <Field label="Nombre completo" value={form.nombre} onChangeText={(v) => upd('nombre', v)} />
          <Field label="Teléfono" value={form.telefono} onChangeText={(v) => upd('telefono', v)} keyboardType="phone-pad" />
          <Field label="Residencia" value={form.residencia} onChangeText={(v) => upd('residencia', v)} />
          <Field label="Contacto de emergencia" value={form.contacto_emergencia} onChangeText={(v) => upd('contacto_emergencia', v)} keyboardType="phone-pad" />

          {/* Género — primera vez editable, después requiere aprobación admin */}
          <Text style={styles.label}>Género {generoYaSet && <Text style={{ color: COLORS.gray, fontSize: 11 }}>(requiere aprobación admin para cambiar)</Text>}</Text>
          {generoYaSet
            ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' }}>
                <View style={[styles.chip, styles.chipActive, { opacity: 0.85 }]}>
                  <Text style={styles.chipTextActive}>{form.genero === 'Masculino' ? '♂ Masculino' : '♀ Femenino'}</Text>
                </View>
                {pendingGenderReq ? (
                  <View style={[styles.chip, { backgroundColor: COLORS.gold + '30', borderColor: COLORS.gold, borderWidth: 1 }]}>
                    <Text style={[styles.chipText, { color: COLORS.gold }]}>⏳ Pendiente → {pendingGenderReq.new_genero}</Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setShowGenderModal(true)}>
                    <Text style={{ fontFamily: FONTS.bodySemiBold, color: COLORS.gold, fontSize: 12 }}>Solicitar cambio →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
            : (
              <View style={styles.chips}>
                {GENEROS.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, form.genero === g && styles.chipActive]}
                    onPress={() => upd('genero', g)}
                  >
                    <Text style={[styles.chipText, form.genero === g && styles.chipTextActive]}>
                      {g === 'Masculino' ? '♂ Masculino' : '♀ Femenino'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )
          }

          {/* Sports */}
          <Text style={styles.label}>Deportes que practicas</Text>
          <SportChips selected={form.deportes} onToggle={toggleDeporte} />

          {/* Level */}
          <Text style={[styles.label, { marginTop: SPACING.md }]}>Nivel</Text>
          <View style={styles.chips}>
            {NIVELES.map((n) => (
              <TouchableOpacity
                key={n}
                style={[styles.chip, form.nivel === n && styles.chipActive]}
                onPress={() => upd('nivel', n)}
              >
                <Text style={[styles.chipText, form.nivel === n && styles.chipTextActive]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Position */}
          {posiciones.length > 0 && (
            <>
              <Text style={[styles.label, { marginTop: SPACING.md }]}>Posición ({form.deportes[0]})</Text>
              <View style={styles.chips}>
                {posiciones.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.chip, form.posicion === p && styles.chipActive]}
                    onPress={() => upd('posicion', p)}
                  >
                    <Text style={[styles.chipText, form.posicion === p && styles.chipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <TouchableOpacity style={styles.btn} onPress={save} disabled={saving}>
            {saving
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.btnText}>GUARDAR CAMBIOS</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <GenderChangeModal
        visible={showGenderModal}
        currentGenero={form.genero}
        supabase={supabase}
        onClose={() => setShowGenderModal(false)}
        onSent={() => {
          // Refrescar el badge de pendiente
          supabase
            .from('gender_change_requests')
            .select('id, new_genero, status, created_at')
            .eq('user_id', user.id)
            .eq('status', 'pending')
            .maybeSingle()
            .then(({ data }) => setPendingGenderReq(data));
        }}
      />
    </SafeAreaView>
  );
}

function Field({ label, ...props }) {
  return (
    <TextInput
      style={styles.input}
      placeholder={label}
      placeholderTextColor={COLORS.gray}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: COLORS.bg },
  inner:       { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl },
  header:      { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginBottom: SPACING.md },
  back:        { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white },
  title:       { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, letterSpacing: 3 },
  photoPicker: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
    borderStyle: 'dashed',
  },
  photoText:     { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  label:         { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 13, marginBottom: 4 },
  chips:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
  chip:          { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.full, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.navy },
  chipActive:    { backgroundColor: COLORS.blue, borderColor: COLORS.blue2 },
  chipText:      { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  chipTextActive:{ color: COLORS.white, fontFamily: FONTS.bodyMedium },
  btn: {
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  btnText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 3 },
});
