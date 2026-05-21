// Pantalla que recibe el deep link / URL de reset de Supabase.
// El user llega acá desde el email "Restablecer tu contraseña".
// Supabase auto-loguea con la sesión de recovery → el user solo ingresa la nueva password.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

export default function ResetPasswordScreen({ navigation }) {
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionReady,setSessionReady]= useState(false);
  const [sessionErr,  setSessionErr]  = useState(null);
  const [done,        setDone]        = useState(false);

  useEffect(() => {
    // En web, Supabase parsea el hash de la URL y crea la sesión automáticamente
    // (gracias a detectSessionInUrl: true que ya seteamos en lib/supabase.js).
    // Verificamos que efectivamente haya sesión de recovery.
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (session?.user) {
          setSessionReady(true);
        } else {
          // Esperar a que Supabase procese el hash (puede tardar unos ms en web)
          const t = setTimeout(async () => {
            const { data: { session: s2 } } = await supabase.auth.getSession();
            if (!cancelled) {
              if (s2?.user) setSessionReady(true);
              else setSessionErr('Link inválido o expirado. Solicita un nuevo enlace.');
            }
          }, 1500);
          return () => clearTimeout(t);
        }
      } catch (e) {
        if (!cancelled) setSessionErr(e?.message ?? 'Error al verificar el link');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleReset() {
    if (password.length < 8) { Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres.'); return; }
    if (!/\d/.test(password)) { Alert.alert('Error', 'La contraseña debe incluir al menos un número.'); return; }
    if (password !== confirm) { Alert.alert('Error', 'Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.brand}>CONTRASEÑA ACTUALIZADA</Text>
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successBody}>
            Tu contraseña fue cambiada exitosamente. Ya puedes iniciar sesión con la nueva.
          </Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={async () => {
              await supabase.auth.signOut();
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            }}
          >
            <Text style={styles.btnText}>IR AL LOGIN</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (sessionErr) {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.brand}>LINK INVÁLIDO</Text>
          <Text style={styles.errorBody}>{sessionErr}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => navigation.reset({ index: 0, routes: [{ name: 'ForgotPassword' }] })}
          >
            <Text style={styles.btnText}>SOLICITAR NUEVO ENLACE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!sessionReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={COLORS.red} size="large" style={{ marginTop: 80 }} />
        <Text style={{ color: COLORS.gray, textAlign: 'center', marginTop: 16, fontFamily: FONTS.body }}>
          Verificando enlace…
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.brand}>NUEVA CONTRASEÑA</Text>
        <Text style={styles.subtitle}>Ingresa tu nueva contraseña (mínimo 8 caracteres, al menos 1 número).</Text>

        <TextInput
          style={styles.input}
          placeholder="Nueva contraseña"
          placeholderTextColor={COLORS.gray}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="Confirmar contraseña"
          placeholderTextColor={COLORS.gray}
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />
        <TouchableOpacity style={styles.btn} onPress={handleReset} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.btnText}>GUARDAR CONTRASEÑA</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  inner:        { flexGrow: 1, justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl, gap: SPACING.md },
  brand:        { fontFamily: FONTS.heading, fontSize: 28, color: COLORS.white, letterSpacing: 4, textAlign: 'center', marginBottom: SPACING.lg },
  subtitle:     { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray, textAlign: 'center', marginBottom: SPACING.md, lineHeight: 20 },
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
  successIcon:  { fontFamily: FONTS.heading, fontSize: 80, color: COLORS.green, textAlign: 'center', marginVertical: SPACING.lg },
  successBody:  { fontFamily: FONTS.body, color: COLORS.gray2, textAlign: 'center', lineHeight: 22, marginBottom: SPACING.lg, fontSize: 15 },
  errorBody:    { fontFamily: FONTS.body, color: COLORS.gray2, textAlign: 'center', lineHeight: 22, marginVertical: SPACING.lg, fontSize: 14 },
});
