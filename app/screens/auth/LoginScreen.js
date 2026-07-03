import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { setPendingDeepLink } from '../../../lib/pendingDeepLink';
import { logError } from '../../../lib/logger';
import ResponsiveContainer from '../../../components/ResponsiveContainer';

export default function LoginScreen({ navigation, route }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const passwordRef = useRef(null);

  // Si llegamos al login desde una vista pública con destino pendiente
  // (ej: EventDetailScreen botón "Iniciar sesión para inscribirme"),
  // persistimos el destino para que App.js lo restaure después del login.
  useEffect(() => {
    const returnTo = route?.params?.returnTo;
    const returnParams = route?.params?.returnParams;
    if (returnTo && returnParams) {
      setPendingDeepLink({ screen: returnTo, params: returnParams });
    }
  }, [route?.params?.returnTo]);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Faltan datos', 'Por favor completa correo y contraseña.');
      return;
    }
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e) {
      const lower = (e?.message ?? '').toLowerCase();
      logError({ screen: 'LoginScreen', action: 'login', technical: e });
      if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
        Alert.alert('Datos incorrectos', 'Correo o contraseña no coinciden. Verifica e intenta de nuevo.');
      } else if (lower.includes('email not confirmed')) {
        Alert.alert('Correo sin confirmar', 'Aún no confirmaste tu cuenta. Revisa tu correo y haz clic en el enlace.');
      } else if (lower.includes('network') || lower.includes('fetch')) {
        Alert.alert('Sin conexión', 'No pudimos conectar con el servidor. Revisa tu internet.');
      } else {
        Alert.alert('Error al iniciar sesión', e?.message ?? 'Intenta nuevamente en unos minutos.');
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <ResponsiveContainer style={{ justifyContent: 'center' }}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>B2P</Text>
        </View>
        <Text style={styles.brand}>PANAMA BIRREAS</Text>
        <Text style={styles.subtitle}>Entra al circuito urbano de birreas</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Correo electrónico"
            placeholderTextColor={COLORS.gray}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            blurOnSubmit={false}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            ref={passwordRef}
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={COLORS.gray}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity
            style={[styles.btn, isLoading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.btnText}>ENTRAR</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.link}>¿No tienes cuenta? <Text style={styles.linkAccent}>Regístrate</Text></Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={styles.link}>¿Olvidaste tu contraseña? <Text style={styles.linkAccent}>Recupérala</Text></Text>
          </TouchableOpacity>
        </View>
      </ResponsiveContainer>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
  },
  brandMark: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: COLORS.neon,
    backgroundColor: COLORS.neon + '14',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    marginBottom: SPACING.md,
  },
  brandMarkText: { fontFamily: FONTS.heading, color: COLORS.neon, fontSize: 20, letterSpacing: 2 },
  brand: {
    fontFamily: FONTS.heading,
    fontSize: 44,
    color: COLORS.white,
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  form: { gap: SPACING.md },
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
  },
  btn: {
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.sm,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    minHeight: 52,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 3,
  },
  linkBtn: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  link: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    textAlign: 'center',
  },
  linkAccent: { color: COLORS.gold },
});
