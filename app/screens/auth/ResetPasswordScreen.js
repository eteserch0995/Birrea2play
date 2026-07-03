// Pantalla que recibe el deep link / URL de reset de Supabase.
// El user llega acá desde el email "Restablecer tu contraseña".
// Maneja los 3 formatos de enlace que puede mandar Supabase:
//   - token_hash + type   -> verifyOtp     (plantilla recomendada, inmune a prefetch)
//   - code (PKCE)         -> exchangeCodeForSession
//   - access_token/refresh_token en el hash (implícito) -> setSession / detectSessionInUrl
// Si el enlace viene con error (ej: otp_expired por prefetch del cliente de correo),
// muestra el MOTIVO REAL en vez del genérico "Link inválido".
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import { remoteLog } from '../../../lib/remoteLogger';

// Lee params tanto del fragment (#) como del query (?). Supabase usa uno u otro
// según el formato del enlace y la versión de la plantilla de correo.
function readAuthParams() {
  if (typeof window === 'undefined' || !window.location) return {};
  const out = {};
  const add = (raw) => {
    const s = (raw || '').replace(/^[#?]/, '');
    if (!s) return;
    try {
      for (const [k, v] of new URLSearchParams(s).entries()) {
        if (out[k] == null) out[k] = v;
      }
    } catch (_) {}
  };
  add(window.location.hash);
  add(window.location.search);
  return out;
}

function cleanAuthParamsFromUrl() {
  if (typeof window !== 'undefined' && window.location && window.history?.replaceState) {
    try { window.history.replaceState(null, '', window.location.pathname); } catch (_) {}
  }
}

export default function ResetPasswordScreen({ navigation }) {
  const [password,    setPassword]    = useState('');
  const [confirm,     setConfirm]     = useState('');
  const [loading,     setLoading]     = useState(false);
  const [sessionReady,setSessionReady]= useState(false);
  const [sessionErr,  setSessionErr]  = useState(null);
  const [done,        setDone]        = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function establishRecoverySession() {
      const p = readAuthParams();

      // 1) Supabase devolvió un error explícito en el enlace. El caso más común:
      //    el token de un solo uso fue consumido por un prefetch del cliente de
      //    correo (Gmail/Outlook/WhatsApp/antivirus) antes de que el user haga clic.
      if (p.error || p.error_code || p.error_description) {
        let desc = p.error_description || p.error_code || p.error || '';
        try { desc = decodeURIComponent(desc); } catch (_) {}
        desc = desc.replace(/\+/g, ' ');
        const expired = p.error_code === 'otp_expired' || /expir|invalid|used|otp/i.test(desc);
        throw new Error(expired
          ? 'El enlace ya fue usado o expiró. Solicita uno nuevo (los enlaces son de un solo uso).'
          : `No se pudo validar el enlace: ${desc}`);
      }

      // 2) Plantilla recomendada: token_hash + type -> verifyOtp.
      if (p.token_hash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: p.token_hash, type: p.type || 'recovery' });
        if (error) throw error;
        return;
      }

      // 3) Flujo PKCE: ?code=... -> exchangeCodeForSession.
      if (p.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(p.code);
        if (error) throw error;
        return;
      }

      // 4) Flujo implícito: tokens en el hash -> setSession (por si
      //    detectSessionInUrl no alcanzó a procesarlos a tiempo).
      if (p.access_token && p.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: p.access_token,
          refresh_token: p.refresh_token,
        });
        if (error) throw error;
        return;
      }

      // 5) detectSessionInUrl (web) pudo haber procesado y limpiado el hash ya.
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) return;

      // 6) Darle margen a la inicialización async de supabase y reintentar.
      await new Promise((r) => setTimeout(r, 1200));
      if (cancelled) return;
      const { data: { session: s2 } } = await supabase.auth.getSession();
      if (s2?.user) return;

      throw new Error('Enlace inválido o expirado. Solicita uno nuevo.');
    }

    (async () => {
      try {
        await establishRecoverySession();
        if (!cancelled) {
          setSessionReady(true);
          cleanAuthParamsFromUrl();
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e?.message ?? 'No se pudo validar el enlace.';
        setSessionErr(msg);
        try {
          remoteLog({ level: 'error', screen: 'ResetPassword', action: 'establish_session', error_message: msg });
        } catch (_) {}
      }
    })();

    return () => { cancelled = true; };
  }, []);

  function goRequestNewLink() {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      window.location.assign('/recuperar-acceso');
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'ForgotPassword' }] });
    }
  }

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
          <TouchableOpacity style={styles.btn} onPress={goRequestNewLink}>
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
