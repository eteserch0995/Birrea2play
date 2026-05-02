import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { signUp, signOut, createUserProfile, uploadAvatar } from '../../../lib/auth';

const DEPORTES = [
  'Fútbol', 'Fútbol 7', 'Fútbol Sala',
  'Volleyball', 'Beach Volleyball',
  'Pádel', 'Tenis',
  'Basketball', 'Baseball',
  'Otro',
];

const NIVELES = ['Recreativo', 'Amateur', 'Semi-profesional', 'Profesional'];

// Posiciones por deporte
const POSICIONES_POR_DEPORTE = {
  'Fútbol':        ['Portero', 'Defensa', 'Centrocampista', 'Delantero'],
  'Fútbol 7':      ['Portero', 'Defensa', 'Centrocampista', 'Delantero'],
  'Fútbol Sala':   ['Portero', 'Cierre', 'Ala', 'Pívot'],
  'Volleyball':    ['Colocador', 'Opuesto', 'Central', 'Libero', 'Receptor'],
  'Beach Volleyball': ['Bloqueador', 'Defensor'],
  'Pádel':         ['Drive', 'Revés', 'Completo'],
  'Tenis':         ['Fondo de cancha', 'Saque y volea', 'Completo'],
  'Basketball':    ['Base', 'Escolta', 'Alero', 'Ala-Pívot', 'Pívot'],
  'Baseball':      ['Lanzador', 'Receptor', 'Cuadro', 'Jardinero'],
  'Otro':          ['Atacante', 'Defensor', 'Medio', 'Otro'],
};

export default function RegisterScreen({ navigation }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);

  const [form, setForm] = useState({
    nombre: '', correo: '', telefono: '',
    password: '', confirmPassword: '',
    residencia: '', cedula: '', contacto_emergencia: '',
    deportes: [], otroDeporte: '', nivel: 'Recreativo', posicion: '',
    terminos: false,
  });

  const update = (key, val) => setForm((f) => ({ ...f, [key]: val }));

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

  const goNext = () => {
    if (step === 1) {
      if (!form.nombre.trim()) {
        Alert.alert('Error', 'El nombre es obligatorio.');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!form.correo.trim() || !emailRegex.test(form.correo.trim())) {
        Alert.alert('Error', 'Ingresa un correo electrónico válido.');
        return;
      }
    }
    if (step === 2) {
      if (form.password.length < 8) { Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres.'); return; }
      if (!/\d/.test(form.password)) { Alert.alert('Error', 'La contraseña debe incluir al menos un número.'); return; }
      if (form.password !== form.confirmPassword) { Alert.alert('Error', 'Las contraseñas no coinciden.'); return; }
    }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (!form.terminos) { Alert.alert('Error', 'Debes aceptar los términos.'); return; }
    if (loading) return; // guard against double-tap
    setLoading(true);
    let authUser = null;
    try {
      const { user: au } = await signUp(form.correo.trim().toLowerCase(), form.password);
      authUser = au;
      let foto_url = null;
      if (photoUri) {
        try {
          foto_url = await uploadAvatar(authUser.id, photoUri);
        } catch (uploadErr) {
          // La foto es opcional — continúa sin ella
          console.warn('Upload foto fallido:', uploadErr.message);
        }
      }
      await createUserProfile(authUser.id, {
        nombre: form.nombre.trim(),
        correo: form.correo.trim().toLowerCase(),
        telefono: form.telefono,
        residencia: form.residencia,
        cedula: form.cedula,
        contacto_emergencia: form.contacto_emergencia,
        deporte: form.deportes.includes('Otro')
          ? [...form.deportes.filter(d => d !== 'Otro'), form.otroDeporte].filter(Boolean).join(', ')
          : form.deportes.join(', ') || 'Sin especificar',
        nivel: form.nivel,
        posicion: form.posicion,
        foto_url,
      });
      Alert.alert('¡Listo!', 'Cuenta creada. Por favor inicia sesión.', [
        { text: 'OK', onPress: () => navigation.replace('Login') },
      ]);
    } catch (e) {
      // If signUp succeeded but profile creation failed, the auth user exists.
      // Sign them out to avoid limbo state — they can re-register.
      if (authUser) {
        signOut().catch(() => {});
      }
      Alert.alert('Error al registrarse', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Step indicator */}
        <View style={styles.stepRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={[styles.stepDot, step >= n && styles.stepDotActive]} />
          ))}
        </View>
        <Text style={styles.title}>REGISTRO — PASO {step}/5</Text>

        {step === 1 && (
          <View style={styles.form}>
            <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
              <Text style={styles.photoText}>{photoUri ? '✓ Foto seleccionada' : '📷 Subir foto de perfil'}</Text>
            </TouchableOpacity>
            <Field label="Nombre completo" value={form.nombre} onChangeText={(v) => update('nombre', v)} />
            <Field label="Correo electrónico" value={form.correo} onChangeText={(v) => update('correo', v)} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Teléfono" value={form.telefono} onChangeText={(v) => update('telefono', v)} keyboardType="phone-pad" />
          </View>
        )}

        {step === 2 && (
          <View style={styles.form}>
            <Field label="Contraseña" value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry />
            <Field label="Confirmar contraseña" value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry />
            <Text style={styles.hint}>Mínimo 8 caracteres y al menos 1 número.</Text>
          </View>
        )}

        {step === 3 && (
          <View style={styles.form}>
            <Field label="Residencia" value={form.residencia} onChangeText={(v) => update('residencia', v)} />
            <Field label="Cédula" value={form.cedula} onChangeText={(v) => update('cedula', v)} />
            <Field label="Contacto de emergencia" value={form.contacto_emergencia} onChangeText={(v) => update('contacto_emergencia', v)} keyboardType="phone-pad" />
          </View>
        )}

        {step === 4 && (
          <View style={styles.form}>
            <Text style={styles.label}>Deportes que practicas (selecciona uno o varios)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm }}>
              {DEPORTES.map((d) => {
                const sel = form.deportes.includes(d);
                return (
                  <TouchableOpacity
                    key={d}
                    style={[chipStyles.chip, sel && chipStyles.chipActive]}
                    onPress={() => {
                      const updatedDeportes = sel
                        ? form.deportes.filter(x => x !== d)
                        : [...form.deportes, d];
                      update('deportes', updatedDeportes);
                      if (!updatedDeportes.includes('Otro')) update('otroDeporte', '');
                      // Reset posicion si cambia selección
                      update('posicion', '');
                    }}
                  >
                    <Text style={[chipStyles.chipText, sel && chipStyles.chipTextActive]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {form.deportes.includes('Otro') && (
              <>
                <Text style={styles.label}>¿Cuál otro deporte?</Text>
                <TextInput
                  style={fieldStyles.input}
                  placeholder="Ej: Rugby, Natación..."
                  placeholderTextColor={COLORS.gray}
                  value={form.otroDeporte}
                  onChangeText={(v) => update('otroDeporte', v)}
                />
              </>
            )}

            <Text style={styles.label}>Nivel</Text>
            <Chips options={NIVELES} selected={form.nivel} onSelect={(v) => update('nivel', v)} />

            {form.deportes.length > 0 && (
              <>
                <Text style={styles.label}>
                  Posición favorita
                  {form.deportes.length === 1 ? ` (${form.deportes[0]})` : ' (deporte principal)'}
                </Text>
                <Chips
                  options={POSICIONES_POR_DEPORTE[form.deportes[0]] ?? ['Atacante','Defensor','Medio','Otro']}
                  selected={form.posicion}
                  onSelect={(v) => update('posicion', v)}
                />
              </>
            )}
          </View>
        )}

        {step === 5 && (
          <View style={styles.form}>
            <View style={styles.termsBox}>
              <Text style={styles.termsText}>
                Al registrarte aceptas los Términos y Condiciones de Panama Birreas, la política de privacidad y el reglamento de los eventos.
              </Text>
            </View>
            <TouchableOpacity style={styles.checkRow} onPress={() => update('terminos', !form.terminos)}>
              <View style={[styles.check, form.terminos && styles.checkActive]} />
              <Text style={styles.checkLabel}>Acepto los términos y condiciones</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.btnRow}>
          {step > 1 && (
            <TouchableOpacity style={styles.btnBack} onPress={() => setStep((s) => s - 1)}>
              <Text style={styles.btnBackText}>Atrás</Text>
            </TouchableOpacity>
          )}
          {step < 5
            ? <TouchableOpacity style={styles.btn} onPress={goNext}><Text style={styles.btnText}>SIGUIENTE</Text></TouchableOpacity>
            : <TouchableOpacity style={styles.btn} onPress={submit} disabled={loading}>
                {loading ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>CREAR CUENTA</Text>}
              </TouchableOpacity>
          }
        </View>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>¿Ya tienes cuenta? <Text style={styles.linkAccent}>Inicia sesión</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, ...props }) {
  return (
    <TextInput
      style={fieldStyles.input}
      placeholder={label}
      placeholderTextColor={COLORS.gray}
      {...props}
    />
  );
}

function Chips({ options, selected, onSelect }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md }}>
      {options.map((o) => (
        <TouchableOpacity
          key={o}
          style={[chipStyles.chip, selected === o && chipStyles.chipActive]}
          onPress={() => onSelect(o)}
        >
          <Text style={[chipStyles.chipText, selected === o && chipStyles.chipTextActive]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
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
    marginBottom: SPACING.sm,
  },
});

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.navy,
    backgroundColor: COLORS.card,
  },
  chipActive: { backgroundColor: COLORS.blue, borderColor: COLORS.blue2 },
  chipText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },
  chipTextActive: { color: COLORS.white, fontFamily: FONTS.bodyMedium },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: { padding: SPACING.xl, paddingBottom: SPACING.xxl },
  stepRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: SPACING.md },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.navy },
  stepDotActive: { backgroundColor: COLORS.red },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3, textAlign: 'center', marginBottom: SPACING.xl },
  form: { gap: SPACING.sm },
  label: { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 13, marginBottom: 4 },
  hint: { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 12 },
  photoPicker: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
    borderStyle: 'dashed',
    marginBottom: SPACING.sm,
  },
  photoText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15 },
  btnRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xl },
  btn: {
    flex: 1,
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  btnText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 3 },
  btnBack: {
    flex: 0.4,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  btnBackText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 16 },
  termsBox: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  termsText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13, lineHeight: 20 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: COLORS.gray },
  checkActive: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  checkLabel: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14, flex: 1 },
  link: { fontFamily: FONTS.body, color: COLORS.gray2, textAlign: 'center', marginTop: SPACING.lg },
  linkAccent: { color: COLORS.gold },
});
