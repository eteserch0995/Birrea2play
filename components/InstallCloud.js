// InstallCloud — "la nube": coach-mark flotante que empuja a instalar la PWA
// en navegador móvil. Nunca en standalone, gateada por flags remotos (app_settings
// key='install_gate'), aparece 1 vez por sesión ~5s tras montar.
//
// Web+mobile only. Fail-open: si el fetch de flags falla, lib/installGate.js ya
// devuelve todo apagado — acá simplemente no se muestra nada, nunca bloquea.
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Animated,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS, FONTS, TYPE, SPACING, RADIUS } from '../constants/theme';
import { getInstallPrompt, clearInstallPrompt } from '../lib/installPrompt';
import {
  fetchInstallGateFlags, getInstallPlatform, isStandaloneNow, isMobileWeb, logFunnel,
} from '../lib/installGate';

const SS_SEEN_KEY      = 'b2p_cloud_seen';
const LS_HANDOFF_KEY   = 'b2p_handoff_pending';
const SHOW_DELAY_MS    = 5000;

// Webview de apps (Instagram/Facebook/Line, etc.): no disparan beforeinstallprompt
// y Chrome real no está disponible desde su menú — caso propio no cubierto por
// getInstallPlatform() (esa función solo distingue iOS/Android). Detección local,
// no toca lib/installGate.js.
function isInAppWebview() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|MiuiBrowser|Twitter|TikTok/i.test(ua) ||
    (/Android/i.test(ua) && /\bwv\b/i.test(ua));
}

function ssGet(key) {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1'; }
  catch { return false; }
}
function ssSet(key) {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1'); } catch {}
}
function lsSet(key) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, '1'); } catch {}
}

async function copyLink() {
  const url = 'https://birrea2play.com';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {}
  // Fallback: textarea oculto + execCommand (navegadores/webviews viejos)
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch { return false; }
}

export default function InstallCloud() {
  const [visible, setVisible]   = useState(false);
  const [prompt, setPrompt]     = useState(null);
  const [copied, setCopied]     = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isStandaloneNow()) return;
    if (!isMobileWeb()) return;
    if (ssGet(SS_SEEN_KEY)) return;

    let cancelled = false;
    let timer = null;

    fetchInstallGateFlags().then((flags) => {
      if (cancelled || !flags?.cloud) return;
      if (isStandaloneNow() || ssGet(SS_SEEN_KEY)) return;
      timer = setTimeout(() => {
        if (cancelled || isStandaloneNow()) return;
        ssSet(SS_SEEN_KEY);
        setPrompt(getInstallPrompt());
        setVisible(true);
        try {
          const p = getInstallPlatform();
          logFunnel('cloud_shown', { platform: p });
          if (p === 'ios-safari') logFunnel('cloud_ios_guide', { platform: p });
        } catch {}
        Animated.spring(anim, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }).start();
      }, SHOW_DELAY_MS);
    }).catch(() => {});

    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [anim]);

  const close = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setVisible(false));
  }, [anim]);

  const clickInstall = useCallback(async () => {
    try { logFunnel('cloud_install_click', { platform: getInstallPlatform() }); } catch {}
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    clearInstallPrompt();
    if (outcome === 'accepted') {
      lsSet(LS_HANDOFF_KEY);
      close();
    } else {
      setPrompt(null);
    }
  }, [prompt, close]);

  const clickCopy = useCallback(async () => {
    try { logFunnel('cloud_install_click', { platform: 'webview', action: 'copy' }); } catch {}
    const ok = await copyLink();
    if (ok) setCopied(true);
  }, []);

  if (!visible) return null;

  const platform = isInAppWebview() ? 'webview' : getInstallPlatform();

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <Animated.View
      style={[styles.wrap, { opacity: anim, transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <View style={styles.bubble} dataSet={{ t2Glass: '', t2Glow: 'mid' }}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={close}
          accessibilityLabel="Cerrar aviso de instalación"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M6 6L18 18M18 6L6 18" stroke={COLORS.gray2} strokeWidth={2} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>

        <CloudContent
          platform={platform}
          hasPrompt={!!prompt}
          copied={copied}
          onInstall={clickInstall}
          onCopy={clickCopy}
        />
      </View>
      {/* Pico de la nube: apunta hacia abajo, al chrome del navegador */}
      <View style={styles.tailWrap} pointerEvents="none">
        <View style={styles.tail} dataSet={{ t2Glass: '' }} />
      </View>
    </Animated.View>
  );
}

function CloudContent({ platform, hasPrompt, copied, onInstall, onCopy }) {
  if (platform === 'webview') {
    return (
      <>
        <Text style={styles.title}>Abrí esto en tu navegador</Text>
        <Text style={styles.desc}>
          Para instalar la app copiá el link y pegalo en Chrome o Safari.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={onCopy} activeOpacity={0.85}>
          <Text style={styles.btnText}>{copied ? 'LINK COPIADO ✓' : 'COPIAR LINK'}</Text>
        </TouchableOpacity>
      </>
    );
  }

  if (platform === 'ios-otro') {
    return (
      <>
        <Text style={styles.title}>Abrí birrea2play.com en Safari</Text>
        <Text style={styles.desc}>
          Este navegador no permite instalar apps. Copiá la dirección y abrila en Safari.
        </Text>
      </>
    );
  }

  if (platform === 'ios-safari') {
    return (
      <>
        <Text style={styles.title}>Instalá la app de Birrea2Play</Text>
        <Text style={styles.desc}>Tocá Compartir y elegí "Agregar a inicio"</Text>
        <View style={styles.miniSteps}>
          <MiniStep n="1" text="Botón Compartir, abajo de Safari" />
          <MiniStep n="2" text='"Añadir a pantalla de inicio"' />
        </View>
        <View style={styles.arrowDown}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d="M12 4V20M12 20L6 14M12 20L18 14" stroke={COLORS.neon} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </>
    );
  }

  // android-prompt / android-manual
  return (
    <>
      <Text style={styles.title}>Instalá la app de Birrea2Play</Text>
      {hasPrompt ? (
        <>
          <Text style={styles.desc}>Sumá la app a tu inicio en un toque.</Text>
          <TouchableOpacity style={styles.btn} onPress={onInstall} activeOpacity={0.85}>
            <Text style={styles.btnText}>INSTALAR</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.desc}>Tocá el menú (⋮) de Chrome y elegí "Instalar app".</Text>
        </>
      )}
    </>
  );
}

function MiniStep({ n, text }) {
  return (
    <View style={styles.miniStepRow}>
      <View style={styles.miniStepNum}><Text style={styles.miniStepNumText}>{n}</Text></View>
      <Text style={styles.miniStepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: SPACING.md,
    right: SPACING.md,
    bottom: 96,
    alignItems: 'center',
    zIndex: 9500,
  },
  bubble: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: SPACING.md,
    paddingTop: SPACING.lg,
  },
  closeBtn: {
    position: 'absolute',
    top: 4, right: 4,
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  tailWrap: { width: '100%', alignItems: 'center', marginTop: -1 },
  tail: {
    width: 18, height: 18,
    backgroundColor: COLORS.card2,
    borderRightWidth: 1, borderBottomWidth: 1, borderColor: COLORS.line,
    transform: [{ rotate: '45deg' }],
    marginTop: -9,
  },
  title: {
    fontFamily: FONTS.heading, fontSize: TYPE.h1, color: COLORS.white,
    letterSpacing: 0.5, marginBottom: 6, paddingRight: 28,
  },
  desc: {
    fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray2,
    lineHeight: 20, marginBottom: SPACING.sm,
  },
  btn: {
    backgroundColor: COLORS.neon, borderRadius: RADIUS.md,
    paddingVertical: 12, alignItems: 'center', marginTop: SPACING.xs,
  },
  btnText: { fontFamily: FONTS.heading, fontSize: TYPE.h3, color: COLORS.bg, letterSpacing: 1.5 },

  miniSteps: { marginTop: SPACING.xs, marginBottom: SPACING.xs, gap: 8 },
  miniStepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniStepNum: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.neon + '22',
    borderWidth: 1, borderColor: COLORS.neon, alignItems: 'center', justifyContent: 'center',
  },
  miniStepNumText: { fontFamily: FONTS.heading, fontSize: 11, color: COLORS.neon },
  miniStepText: { flex: 1, fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.white },
  arrowDown: { alignItems: 'center', marginTop: 4 },
});
