import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { signUp, signOut, createUserProfile, uploadAvatar } from '../../../lib/auth';
import { logError, logWarn } from '../../../lib/logger';
import { savePendingEventRefCode } from '../../../lib/referral';
import ResponsiveContainer from '../../../components/ResponsiveContainer';
import InstallGateSheet from '../../../components/InstallGateSheet';
import { isMobileWeb, isStandaloneNow, fetchInstallGateFlags, hasEscapedGate } from '../../../lib/installGate';

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
  const [showInstallGate, setShowInstallGate] = useState(false);

  // Gate por acción — solo navegador móvil, no instalada, sin escape de sesión
  // y con el kill switch remoto encendido. Fail-open: si el fetch falla, el
  // flag queda `enabled:false` y el formulario se usa normal, sin gate.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!isMobileWeb() || isStandaloneNow() || hasEscapedGate()) return;
    fetchInstallGateFlags().then((flags) => {
      if (flags.enabled) setShowInstallGate(true);
    });
  }, []);

  const [form, setForm] = useState({
    nombre: '', correo: '', telefono: '',
    password: '', confirmPassword: '',
    residencia: '', contacto_emergencia: '', refCode: '',
    genero: '',
    deportes: [], otroDeporte: '', nivel: 'Recreativo', posicion: '',
    terminos: false,
  });

  const update = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const normalizePhone = (raw) => (raw ?? '').replace(/[\s\-().]/g, '');

  const goNext = () => {
    if (step === 1) {
      if (!form.nombre.trim() || form.nombre.trim().length < 3) {
        Alert.alert('Falta el nombre', 'Ingresa tu nombre y apellido (mínimo 3 caracteres).');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!form.correo.trim()) {
        Alert.alert('Falta el correo', 'Por favor ingresa tu correo electrónico.');
        return;
      }
      if (!emailRegex.test(form.correo.trim())) {
        Alert.alert('Correo inválido', 'Revisa el formato: nombre@dominio.com');
        return;
      }
      const tel = normalizePhone(form.telefono);
      if (!tel) {
        Alert.alert('Falta el teléfono', 'El número de teléfono / WhatsApp es obligatorio.');
        return;
      }
      if (!/^\+?\d{7,15}$/.test(tel)) {
        Alert.alert('Teléfono inválido', 'Usa solo números (7 a 15 dígitos). Puedes incluir el código de país: +507...');
        return;
      }
      if (!form.genero) {
        Alert.alert('Falta el sexo', 'Seleccioná tu sexo (Masculino o Femenino). Es necesario para inscribirte en eventos mixtos o por categoría.');
        return;
      }
    }
    if (step === 2) {
      if (!form.password || form.password.length < 8) {
        Alert.alert('Contraseña muy corta', 'La contraseña debe tener al menos 8 caracteres.');
        return;
      }
      if (!/\d/.test(form.password)) {
        Alert.alert('Contraseña inválida', 'La contraseña debe incluir al menos un número.');
        return;
      }
      if (form.password !== form.confirmPassword) {
        Alert.alert('No coinciden', 'La contraseña y su confirmación no son iguales.');
        return;
      }
    }
    // Step 3 (residencia y contacto de emergencia) — opcionales por ahora.
    if (step === 4) {
      if (form.deportes.length === 0) {
        Alert.alert('Falta seleccionar deporte', 'Marcá al menos un deporte que practiques.');
        return;
      }
      if (form.deportes.includes('Otro') && !form.otroDeporte.trim()) {
        Alert.alert('Especificá el otro deporte', 'Marcaste "Otro" pero no escribiste cuál.');
        return;
      }
      if (!form.nivel) {
        Alert.alert('Falta el nivel', 'Seleccioná tu nivel de juego.');
        return;
      }
      if (!form.posicion) {
        Alert.alert('Falta la posición', 'Seleccioná tu posición favorita.');
        return;
      }
      // Defensa: si concatenado supera el largo de la columna (255 después
      // de la migración) avisamos al usuario en vez de fallar con 22001.
      const deporteText = form.deportes.includes('Otro')
        ? [...form.deportes.filter(d => d !== 'Otro'), form.otroDeporte].filter(Boolean).join(', ')
        : form.deportes.join(', ');
      if (deporteText.length > 250) {
        Alert.alert('Demasiados deportes', 'Reducí la selección — la lista combinada es muy larga.');
        return;
      }
    }
    setStep((s) => s + 1);
  };

  const submit = async () => {
    if (!form.terminos) { Alert.alert('Falta aceptar', 'Debes aceptar los términos y condiciones para continuar.'); return; }
    if (loading) return; // guard against double-tap
    setLoading(true);
    let authUser = null;
    let profileCreated = false;
    try {
      const signUpResult = await signUp(form.correo.trim().toLowerCase(), form.password);
      authUser = signUpResult?.user ?? null;
      const session = signUpResult?.session ?? null;
      if (!authUser) {
        throw new Error('No se pudo crear la cuenta. Intenta nuevamente.');
      }
      let foto_url = null;
      if (photoUri) {
        try {
          foto_url = await uploadAvatar(authUser.id, photoUri);
        } catch (uploadErr) {
          // La foto es opcional — continúa sin ella
          logWarn({ screen: 'RegisterScreen', action: 'uploadAvatar', userId: authUser?.id, technical: uploadErr });
        }
      }
      await createUserProfile(authUser.id, {
        nombre: form.nombre.trim(),
        correo: form.correo.trim().toLowerCase(),
        telefono: normalizePhone(form.telefono),
        residencia: form.residencia?.trim() || null,
        contacto_emergencia: form.contacto_emergencia?.trim() || null,
        deporte: form.deportes.includes('Otro')
          ? [...form.deportes.filter(d => d !== 'Otro'), form.otroDeporte].filter(Boolean).join(', ')
          : form.deportes.join(', ') || 'Sin especificar',
        nivel: form.nivel,
        posicion: form.posicion || null,
        foto_url,
        genero: form.genero || null,
      });
      profileCreated = true;

      // Guardar código de referido para aplicarlo después del primer login
      if (form.refCode.trim()) {
        await savePendingEventRefCode(form.refCode.trim());
      }

      // Si Supabase tiene confirm-email activado, signUp NO devuelve session.
      // En ese caso el usuario NO puede loguearse hasta confirmar correo.
      if (!session) {
        Alert.alert(
          'Revisa tu correo',
          'Te enviamos un email para confirmar tu cuenta. Ábrelo y haz clic en el enlace, luego inicia sesión.',
          [{ text: 'OK', onPress: () => navigation.replace('Login') }],
        );
      } else {
        Alert.alert(
          '¡Cuenta creada!',
          'Tu cuenta quedó lista. Por favor inicia sesión.',
          [{ text: 'OK', onPress: () => navigation.replace('Login') }],
        );
      }
    } catch (e) {
      // Logueo técnico para depuración (no se muestra al usuario).
      logError({
        screen: 'RegisterScreen',
        action: 'submit',
        userId: authUser?.id,
        technical: e,
        extra: { phase: profileCreated ? 'post-profile' : authUser ? 'profile-insert' : 'sign-up' },
      });

      // Si signUp pasó pero el insert de perfil falló, dejamos la cuenta auth
      // en limbo. Sign-out para que el usuario pueda reintentar limpio.
      if (authUser && !profileCreated) {
        signOut().catch(() => {});
      }

      const msg     = (e?.message ?? '').toString();
      const lower   = msg.toLowerCase();
      const pgCode  = e?.code ?? '';
      const details = (e?.details ?? '').toString().toLowerCase();

      if (lower.includes('rate limit') || lower.includes('too many')) {
        Alert.alert(
          'Demasiados intentos',
          'Se enviaron demasiados correos en poco tiempo. Espera unos minutos antes de intentarlo de nuevo.',
        );
      } else if (lower.includes('already registered') || lower.includes('already been registered') || lower.includes('user already')) {
        Alert.alert('Correo ya registrado', 'Este correo ya tiene una cuenta. Por favor inicia sesión.');
      } else if (lower.includes('email not confirmed')) {
        Alert.alert(
          'Correo sin confirmar',
          'Ya tienes una cuenta pero no has confirmado tu correo. Revisa tu bandeja de entrada y haz clic en el enlace de confirmación.',
        );
      } else if (pgCode === '23505' || lower.includes('duplicate key')) {
        // UNIQUE violation: correo / cedula / auth_id. Mensaje según constraint.
        if (details.includes('correo') || lower.includes('correo')) {
          Alert.alert('Correo ya en uso', 'Este correo ya está registrado. Iniciá sesión.');
        } else if (details.includes('cedula') || lower.includes('cedula')) {
          Alert.alert('Cédula ya registrada', 'Esta cédula ya tiene un perfil asociado.');
        } else {
          Alert.alert('Cuenta ya existe', 'Detectamos un perfil parcial con estos datos. Probá iniciar sesión o usá otro correo.');
        }
      } else if (pgCode === '22001' || lower.includes('value too long')) {
        Alert.alert('Datos demasiado largos', 'Alguno de los campos (probable: deportes seleccionados) supera el largo permitido. Reducí la selección o acortá el texto.');
      } else if (lower.includes('password')) {
        Alert.alert('Contraseña inválida', 'La contraseña no cumple los requisitos. Usá al menos 8 caracteres e incluí un número.');
      } else if (lower.includes('invalid') && lower.includes('email')) {
        Alert.alert('Correo inválido', 'El correo electrónico no tiene un formato válido.');
      } else if (lower.includes('network') || lower.includes('fetch')) {
        Alert.alert('Sin conexión', 'No pudimos conectar con el servidor. Revisá tu internet e intentá de nuevo.');
      } else {
        // Mostrar SIEMPRE algo útil al usuario: code real + mensaje técnico
        // truncado (sin secrets/SQL). El detalle completo queda en client_logs.
        const safeDetail = (msg || details || 'sin detalle disponible').slice(0, 240);
        Alert.alert(
          'No pudimos crear tu cuenta',
          `${safeDetail}${pgCode ? `\n\nCódigo: ${pgCode}` : ''}\n\nSi el problema continúa, mostrale este texto al organizador.`,
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <InstallGateSheet
        visible={showInstallGate}
        onClose={() => setShowInstallGate(false)}
        reason="registro"
      />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <ResponsiveContainer>
        {/* Step indicator */}
        <View style={styles.stepRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <View key={n} style={[styles.stepDot, step >= n && styles.stepDotActive]} />
          ))}
        </View>
        <Text style={styles.title}>REGISTRO — PASO {step}/5</Text>

        {step === 1 && (
          <View style={styles.form}>
            <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto} activeOpacity={0.75}>
              <Text style={styles.photoText}>{photoUri ? '✓ Foto seleccionada' : '📷 Subir foto de perfil (opcional)'}</Text>
            </TouchableOpacity>
            <Field
              label="Nombre completo *"
              value={form.nombre}
              onChangeText={(v) => update('nombre', v)}
              returnKeyType="next"
              autoCapitalize="words"
            />
            <Field
              label="Correo electrónico *"
              value={form.correo}
              onChangeText={(v) => update('correo', v)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Field
              label="Teléfono / WhatsApp *"
              value={form.telefono}
              onChangeText={(v) => update('telefono', v)}
              keyboardType="phone-pad"
              returnKeyType="done"
            />
            <Text style={styles.label}>Sexo *</Text>
            <Chips
              options={['Masculino', 'Femenino']}
              selected={form.genero}
              onSelect={(v) => update('genero', v)}
            />
            <Text style={styles.hint}>Si te equivocás, luego podés pedir el cambio desde tu perfil.</Text>
          </View>
        )}

        {step === 2 && (
          <View style={styles.form}>
            <Field
              label="Contraseña"
              value={form.password}
              onChangeText={(v) => update('password', v)}
              secureTextEntry
              returnKeyType="next"
            />
            <Field
              label="Confirmar contraseña"
              value={form.confirmPassword}
              onChangeText={(v) => update('confirmPassword', v)}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={goNext}
            />
            <Text style={styles.hint}>Mínimo 8 caracteres y al menos 1 número.</Text>
          </View>
        )}

        {step === 3 && (
          <View style={styles.form}>
            <Field label="Residencia" value={form.residencia} onChangeText={(v) => update('residencia', v)} />
            <Field label="Contacto de emergencia" value={form.contacto_emergencia} onChangeText={(v) => update('contacto_emergencia', v)} keyboardType="phone-pad" />
            <Text style={styles.label}>¿Alguien te invitó? (opcional)</Text>
            <Field
              label="Código de invitación"
              value={form.refCode}
              onChangeText={(v) => update('refCode', v.toUpperCase().replace(/\s/g, ''))}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.hint}>Si un amigo/a te compartió su código, ingrésalo aquí y los dos ganan $1 en créditos cuando completes tu primer evento.</Text>
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
      </ResponsiveContainer>
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
    borderColor: COLORS.line,
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
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
    borderStyle: 'dashed',
    marginBottom: SPACING.sm,
    minHeight: 56,
    justifyContent: 'center',
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
