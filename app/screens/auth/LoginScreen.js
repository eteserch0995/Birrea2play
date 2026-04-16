import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Por favor completa todos los campos.');
      return;
    }
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e) {
      Alert.alert('Error al iniciar sesión', e.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.brand}>PANAMA BIRREAS</Text>
        <Text style={styles.subtitle}>Inicia sesión para continuar</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Correo electrónico"
            placeholderTextColor={COLORS.gray}
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            placeholderTextColor={COLORS.gray}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={isLoading}>
            {isLoading
              ? <ActivityIndicator color={COLORS.white} />
              : <Text style={styles.btnText}>ENTRAR</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Register')}>
            <Text style={styles.link}>¿No tienes cuenta? <Text style={styles.linkAccent}>Regístrate</Text></Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  brand: {
    fontFamily: FONTS.heading,
    fontSize: 36,
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
    borderColor: COLORS.navy,
  },
  btn: {
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  btnText: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 3,
  },
  link: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  linkAccent: { color: COLORS.gold },
});
