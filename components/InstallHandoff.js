// InstallHandoff — "el dead-end": toma control full-screen de la pestaña del
// navegador apenas detecta que el usuario instaló la PWA, para que no se quede
// registrándose ahí en vez de terminar dentro de la app instalada.
//
// Web+mobile only. Jamás monta en standalone. Gateada por flags.enabled
// (kill switch remoto) — fail-open: si el fetch falla, no hace nada.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Animated, Image,
} from 'react-native';
import { COLORS, FONTS, TYPE, SPACING } from '../constants/theme';
import {
  fetchInstallGateFlags, getInstallPlatform, isStandaloneNow, isMobileWeb, logFunnel,
} from '../lib/installGate';

const appIcon = require('../assets/icon.png');
const LS_HANDOFF_KEY   = 'b2p_handoff_pending';
const SS_DISMISS_KEY   = 'b2p_handoff_dismissed';
const ESCAPE_DELAY_MS  = 10000;

function lsGet(key) {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1'; }
  catch { return false; }
}
function lsSet(key) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1'); } catch {}
}
function lsClear(key) {
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key); } catch {}
}
function ssGet(key) {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1'; }
  catch { return false; }
}
function ssSet(key) {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1'); } catch {}
}

export default function InstallHandoff() {
  const [visible, setVisible]     = useState(false);
  const [showEscape, setShowEscape] = useState(false);
  const enabledRef   = useRef(false);
  const shownRef     = useRef(false);
  const dismissedRef = useRef(ssGet(SS_DISMISS_KEY));
  const pulse        = useRef(new Animated.Value(1)).current;
  const escapeTimer  = useRef(null);

  const triggerTakeover = useCallback(() => {
    if (dismissedRef.current || shownRef.current) return;
    if (!enabledRef.current) return;
    if (isStandaloneNow()) return; // esta pestaña nunca se vuelve standalone realmente
    shownRef.current = true;
    setVisible(true);
    try { logFunnel('handoff_shown', { platform: getInstallPlatform() }); } catch {}
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isStandaloneNow()) return; // en standalone jamás monta
    if (!isMobileWeb()) return;    // desktop nunca ve el takeover (hallazgo review)

    let cancelled = false;

    fetchInstallGateFlags().then((flags) => {
      if (cancelled) return;
      enabledRef.current = !!flags?.enabled;
      // Si ya veníamos con la instalación marcada como pendiente de una sesión
      // anterior (ej. reload de la pestaña), evaluamos de una vez.
      if (lsGet(LS_HANDOFF_KEY)) triggerTakeover();
    }).catch(() => {});

    // La detección real es SOLO 'appinstalled': una pestaña de navegador nunca
    // pasa a display-mode standalone, así que el poll viejo era inalcanzable
    // (hallazgo del review) y se eliminó.
    const onInstalled = () => {
      lsSet(LS_HANDOFF_KEY);
      try { logFunnel('installed', { platform: getInstallPlatform() }); } catch {}
      triggerTakeover();
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      cancelled = true;
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [triggerTakeover]);

  useEffect(() => {
    if (!visible) return undefined;

    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,   duration: 900, useNativeDriver: true }),
    ])).start();

    escapeTimer.current = setTimeout(() => setShowEscape(true), ESCAPE_DELAY_MS);
    return () => { if (escapeTimer.current) clearTimeout(escapeTimer.current); };
  }, [visible, pulse]);

  const stayOnWeb = useCallback(() => {
    dismissedRef.current = true;
    ssSet(SS_DISMISS_KEY);
    // Limpia el pending: el takeover es por-instalación, no un castigo eterno
    // cada sesión para quien elige navegar en web (hallazgo del review).
    lsClear(LS_HANDOFF_KEY);
    setVisible(false);
  }, []);

  if (Platform.OS !== 'web' || !visible) return null;

  return (
    <View style={styles.overlay} dataSet={{ t2Aurora: '' }}>
      <Animated.Image
        source={appIcon}
        style={[styles.icon, { transform: [{ scale: pulse }] }]}
        resizeMode="contain"
      />
      <Text style={styles.title}>¡YA ESTÁ INSTALADA!</Text>
      <Text style={styles.desc}>
        Abrila desde tu pantalla de inicio y terminá ahí tu registro.
      </Text>

      {showEscape && (
        <TouchableOpacity onPress={stayOnWeb} activeOpacity={0.7} style={styles.escapeBtn}>
          <Text style={styles.escapeText}>seguir en la web por ahora</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bg, zIndex: 999999,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  icon: {
    width: 96, height: 96, borderRadius: 22, marginBottom: SPACING.lg,
  },
  title: {
    fontFamily: FONTS.heading, fontSize: TYPE.display, color: COLORS.white,
    letterSpacing: 1.5, textAlign: 'center', marginBottom: SPACING.sm,
  },
  desc: {
    fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 22, maxWidth: 320,
  },
  escapeBtn: { marginTop: SPACING.xxl, padding: SPACING.sm },
  escapeText: {
    fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray,
    textDecorationLine: 'underline',
  },
});
