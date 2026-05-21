import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

const isWeb = Platform.OS === 'web';
// En web: URL pública con la página de reset. En native: deep link a la app.
function getResetRedirect() {
  if (isWeb && typeof window !== 'undefined') {
    return `${window.location.origin}/reset-password`;
  }
  return 'birrea2play://reset-password';
}

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);

  const handleReset = async () => {
    if (!email.trim()) { Alert.alert('Error', 'Ingresa tu correo electrónico.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: getResetRedirect(),
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo enviar el correo. Verifica que el correo sea correcto.');
    } finally {
      setLoading(false);
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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>

        <Text style={styles.brand}>RECUPERAR ACCESO</Text>

        {sent ? (
          <View style={styles.successBox}>
            <Text style={styles.successIcon}>📧</Text>
            <Text style={styles.successTitle}>Correo enviado</Text>
            <Text style={styles.successBody}>
              Revisa tu bandeja de entrada ({email}) y sigue el enlace para restablecer tu contraseña.
            </Text>
            <TouchableOpacity style={[styles.btn, { marginTop: SPACING.lg }]} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.btnText}>VOLVER AL LOGIN</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.subtitle}>
              Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Correo electrónico"
              placeholderTextColor={COLORS.gray}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <TouchableOpacity style={styles.btn} onPress={handleReset} disabled={loading}>
              {loading
                ? <ActivityIndicator color={COLORS.white} />
                : <Text style={styles.btnText}>ENVIAR ENLACE</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  inner:        { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl },
  backBtn:      { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginBottom: SPACING.md },
  backText:     { fontFamily: FONTS.body, color: COLORS.gold, fontSize: 15 },
  brand:        { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, textAlign: 'center', marginBottom: SPACING.xl },
  subtitle:     { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 20 },
  form:         { gap: SPACING.md },
  input: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.md,
    color: COLORS.white, fontFamily: FONTS.body, fontSize: 16,
    borderWidth: 1, borderColor: COLORS.navy,
  },
  btn: {
    backgroundColor: COLORS.red, borderRadius: RADIUS.md,
    paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.sm,
  },
  btnText:      { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 3 },
  successBox:   { alignItems: 'center', gap: SPACING.md },
  successIcon:  { fontSize: 48 },
  successTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  successBody:  { fontFamily: FONTS.body, color: COLORS.gray2, textAlign: 'center', lineHeight: 20 },
});
