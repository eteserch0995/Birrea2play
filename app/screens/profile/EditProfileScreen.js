import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { updateUserProfile, uploadAvatar } from '../../../lib/auth';
import SportChips from '../../../components/SportChips';
import { getSportTerms } from '../../../lib/sportTerms';

const NIVELES  = ['Recreativo', 'Amateur', 'Semi-profesional', 'Profesional'];
const GENEROS  = ['Masculino', 'Femenino'];

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
    cedula:               user?.cedula ?? '',
    contacto_emergencia:  user?.contacto_emergencia ?? '',
    nivel:                user?.nivel ?? 'Recreativo',
    posicion:             user?.posicion ?? '',
    deportes:             deportesInit,
    genero:               user?.genero ?? '',   // solo editable si es null/vacío
  });
  const [saving,  setSaving]  = useState(false);
  const [photoUri, setPhotoUri] = useState(null);

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
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
        cedula:              form.cedula,
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
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
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
          <Field label="Cédula" value={form.cedula} onChangeText={(v) => upd('cedula', v)} />
          <Field label="Contacto de emergencia" value={form.contacto_emergencia} onChangeText={(v) => upd('contacto_emergencia', v)} keyboardType="phone-pad" />

          {/* Género — solo editable la primera vez */}
          <Text style={styles.label}>Género {generoYaSet && <Text style={{ color: COLORS.gray, fontSize: 11 }}>(no modificable)</Text>}</Text>
          {generoYaSet
            ? (
              <View style={[styles.chip, styles.chipActive, { alignSelf: 'flex-start', opacity: 0.7 }]}>
                <Text style={styles.chipTextActive}>{form.genero === 'Masculino' ? '♂ Masculino' : '♀ Femenino'}</Text>
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
          <View style={{ height: SPACING.xxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  inner:       { padding: SPACING.md, gap: SPACING.sm },
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
