// RequiredInstallWall — MURO OBLIGATORIO de instalación + notificaciones.
// (pedido Sergio 2026-07-05: "sí o sí deben tener la app instalada y luego,
// ya instalada, activar las notificaciones")
//
// Se muestra SOLO cuando el flag remoto app_settings.install_gate tiene
// { enabled:true, required:true } — kill switch sin deploy:
//   UPDATE app_settings SET value = jsonb_set(value,'{required}','false') WHERE key='install_gate';
//
// Reglas:
//  - Web MÓVIL en navegador (no standalone) → muro de instalación sin escape:
//      android     → botón INSTALAR (prompt nativo) o guía del menú ⋮
//      ios-safari  → guía Compartir → "Añadir a pantalla de inicio"
//      ios-otro    → abrir en Safari (copiar link)
//      webview     → abrir en el navegador (copiar link)
//  - App INSTALADA (standalone) sin permiso de notificaciones → muro de
//    notificaciones (mismo copy del NotificationPermissionModal clásico).
//    Si el permiso quedó DENEGADO a nivel navegador, guía para activarlo
//    en ajustes + botón "Ya las activé" que re-chequea.
//  - Desktop y app nativa quedan EXENTOS (el muro es para el funnel móvil).
//  - Fail-open: si el fetch de flags falla, lib/installGate devuelve todo
//    apagado y este componente no renderiza nada.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { getInstallPrompt, clearInstallPrompt } from '../lib/installPrompt';
import {
  fetchInstallGateFlags, getInstallPlatform, isStandaloneNow, isMobileWeb, logFunnel,
  hasEscapedGate, setGateEscaped,
} from '../lib/installGate';
import { registerForPushNotifications } from '../lib/notifications';
import useAuthStore from '../store/authStore';

const APP_URL = 'https://birrea2play.com';
// intent:// para saltar de un webview (IG/FB) a Chrome en Android. El
// browser_fallback_url cubre el caso de que Chrome no esté instalado.
const CHROME_INTENT =
  'intent://birrea2play.com/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fbirrea2play.com;end';
const isAndroidUA = () => typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');

async function copyLink() {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(APP_URL); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = APP_URL;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

function notifPermissionNow() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  } catch { return 'unsupported'; }
}

export default function RequiredInstallWall() {
  const user = useAuthStore((s) => s.user);
  const [flags, setFlags]           = useState(null);
  const [standalone, setStandalone] = useState(() => isStandaloneNow());
  const [notifPerm, setNotifPerm]   = useState(() => notifPermissionNow());
  const [installed, setInstalled]   = useState(false); // appinstalled disparado en ESTA pestaña
  const [copied, setCopied]         = useState(false);
  const [hasPrompt, setHasPrompt]   = useState(() => !!getInstallPrompt()); // Chrome capturó beforeinstallprompt
  const [attempts, setAttempts]     = useState(0);     // intentos fallidos → habilitan el escape
  const [escaped, setEscaped]       = useState(() => hasEscapedGate()); // soft-escape de sesión

  // Flags remotos (fail-open) + refresco periódico del estado del entorno:
  // standalone y el permiso pueden cambiar sin evento confiable (iOS sobre todo).
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    let alive = true;
    fetchInstallGateFlags().then((f) => { if (alive) setFlags(f); });

    const recheck = () => {
      setStandalone(isStandaloneNow());
      setNotifPerm(notifPermissionNow());
      setHasPrompt(!!getInstallPrompt()); // el prompt puede llegar segundos después del load
      setEscaped(hasEscapedGate());
    };
    const id = setInterval(recheck, 3000);
    const onVis = () => recheck();
    const onInstalled = () => { setInstalled(true); logFunnel('installed', { via: 'required_wall' }); };
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const active = Platform.OS === 'web' && flags?.enabled && flags?.required && isMobileWeb() && !escaped;

  useEffect(() => {
    if (active && !standalone) logFunnel('gate_shown', { wall: 'install_required' });
  }, [active, standalone]);

  const handleInstall = useCallback(async () => {
    setAttempts((n) => n + 1);
    logFunnel('cloud_install_click', { via: 'required_wall' });
    const evt = getInstallPrompt();
    if (evt?.prompt) {
      try {
        evt.prompt();
        await evt.userChoice;
      } catch {}
      clearInstallPrompt();
      setHasPrompt(false);
    }
  }, []);

  // Salta de un webview de IG/FB a Chrome (Android). No hay forma de forzarlo
  // en iOS; ahí sólo queda copiar el link e instruir.
  const handleOpenChrome = useCallback(() => {
    setAttempts((n) => n + 1);
    logFunnel('cloud_install_click', { via: 'required_wall_webview_chrome' });
    try { window.location.href = CHROME_INTENT; } catch {}
  }, []);

  const handleCopy = useCallback(async () => {
    setAttempts((n) => n + 1);
    const ok = await copyLink();
    setCopied(ok);
    setTimeout(() => setCopied(false), 2500);
  }, []);

  const handleAllowNotifs = useCallback(async () => {
    try {
      const p = await Notification.requestPermission();
      setNotifPerm(p);
      if (p === 'granted') {
        logFunnel('notif_granted', { via: 'required_wall' });
        if (user?.id) registerForPushNotifications(user.id).catch(() => {});
      } else {
        setAttempts((n) => n + 1);
        if (p === 'denied') logFunnel('notif_denied', { via: 'required_wall' });
      }
    } catch { setAttempts((n) => n + 1); }
  }, [user?.id]);

  // Escape de seguridad (pedido Sergio 2026-07-06): tras 2 intentos fallidos —
  // o si el permiso quedó DENEGADO, un callejón sin salida real — dejamos entrar
  // igual para no perder al usuario. Soft-escape de sesión (sessionStorage): en
  // una pestaña nueva el muro vuelve. Requiere que el gate por acción exija
  // instalar cuando toque una acción sensible (inscribirse, pagar).
  const handleEscape = useCallback(() => {
    setGateEscaped();
    setEscaped(true);
    logFunnel('gate_escaped', { via: 'required_wall' });
  }, []);

  if (!active) return null;

  // El escape aparece tras 2 intentos fallidos, o cuando las notificaciones
  // quedaron denegadas (no se pueden re-pedir por navegador → sin salida).
  const showEscape = attempts >= 2 || (standalone && notifPerm === 'denied');
  const renderEscape = (label) => (showEscape ? (
    <TouchableOpacity
      style={styles.escapeBtn}
      onPress={handleEscape}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Text style={styles.escapeText}>{label}</Text>
    </TouchableOpacity>
  ) : null);

  // ── MURO 2: instalada pero sin notificaciones ──
  if (standalone) {
    if (notifPerm === 'granted' || notifPerm === 'unsupported') return null;
    return (
      <View style={styles.overlay} pointerEvents="auto">
        <View style={styles.card}>
          <Text style={styles.icon}>🔔</Text>
          <Text style={styles.title}>ACTIVÁ LAS{'\n'}NOTIFICACIONES</Text>
          <Text style={styles.required}>Requerido para usar la app</Text>
          {notifPerm === 'denied' ? (
            <>
              <Text style={styles.body}>
                Las notificaciones están bloqueadas en tu navegador. Activalas así:
              </Text>
              <View style={styles.benefits}>
                <Text style={styles.benefit}>1️⃣  Abrí los ajustes del navegador / de la app</Text>
                <Text style={styles.benefit}>2️⃣  Buscá "Notificaciones" para birrea2play.com</Text>
                <Text style={styles.benefit}>3️⃣  Cambialas a "Permitir" y volvé acá</Text>
              </View>
              <TouchableOpacity style={styles.btnPrimary} onPress={() => setNotifPerm(notifPermissionNow())}>
                <Text style={styles.btnPrimaryText}>YA LAS ACTIVÉ</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.body}>Entérate al instante de:</Text>
              <View style={styles.benefits}>
                <Text style={styles.benefit}>📅  Nuevos eventos y cambios de fecha</Text>
                <Text style={styles.benefit}>🏆  Cuando seas elegido MVP</Text>
                <Text style={styles.benefit}>💰  Movimientos en tus créditos</Text>
                <Text style={styles.benefit}>📢  Anuncios del gestor de tu evento</Text>
              </View>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleAllowNotifs}>
                <Text style={styles.btnPrimaryText}>ACTIVAR NOTIFICACIONES</Text>
              </TouchableOpacity>
            </>
          )}
          {renderEscape('Ahora no — entrar igual')}
        </View>
      </View>
    );
  }

  // ── MURO 1: navegador móvil sin instalar ──
  const platform = getInstallPlatform();
  const androidWebview = platform === 'webview' && isAndroidUA();
  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.card}>
        <Image source={require('../assets/icon.png')} style={styles.logo} />
        <Text style={styles.title}>INSTALÁ LA APP{'\n'}PARA CONTINUAR</Text>
        <Text style={styles.required}>Birrea2Play se usa desde la app instalada</Text>

        {installed ? (
          <>
            <Text style={styles.body}>✅ ¡Ya está instalada!</Text>
            <Text style={styles.benefit}>Abrila desde el ícono en tu pantalla de inicio.</Text>
          </>
        ) : platform === 'android' ? (
          hasPrompt ? (
            // Chrome ofreció el prompt nativo → botón real de 1 toque.
            <>
              <TouchableOpacity style={styles.btnPrimary} onPress={handleInstall}>
                <Text style={styles.btnPrimaryText}>📲 INSTALAR LA APP</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>
                ¿No pasa nada? Tocá el menú ⋮ del navegador y elegí{'\n'}"Instalar app" / "Agregar a pantalla principal".
              </Text>
            </>
          ) : (
            // Sin prompt nativo → los pasos del menú SON el camino principal
            // (antes eran un hint gris y el botón quedaba "muerto").
            <>
              <Text style={styles.body}>Instalala en 3 pasos desde el menú del navegador:</Text>
              <View style={styles.benefits}>
                <Text style={styles.benefit}>1️⃣  Tocá el menú <Text style={styles.bold}>⋮</Text> arriba a la derecha</Text>
                <Text style={styles.benefit}>2️⃣  Elegí <Text style={styles.bold}>"Instalar app"</Text> o "Agregar a pantalla principal"</Text>
                <Text style={styles.benefit}>3️⃣  Confirmá y abrila desde tu pantalla de inicio</Text>
              </View>
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() => { setHasPrompt(!!getInstallPrompt()); setStandalone(isStandaloneNow()); }}
              >
                <Text style={styles.btnSecondaryText}>REINTENTAR</Text>
              </TouchableOpacity>
            </>
          )
        ) : platform === 'ios-safari' ? (
          <View style={styles.benefits}>
            <Text style={styles.benefit}>1️⃣  Tocá el botón <Text style={styles.bold}>Compartir</Text> (cuadrito con flecha ↑) abajo</Text>
            <Text style={styles.benefit}>2️⃣  Elegí <Text style={styles.bold}>"Añadir a pantalla de inicio"</Text></Text>
            <Text style={styles.benefit}>3️⃣  Abrila desde el ícono de tu inicio</Text>
          </View>
        ) : platform === 'ios-otro' ? (
          <>
            <Text style={styles.body}>En iPhone la app se instala desde <Text style={styles.bold}>Safari</Text>.</Text>
            <View style={styles.benefits}>
              <Text style={styles.benefit}>1️⃣  Copiá el link y abrilo en Safari</Text>
              <Text style={styles.benefit}>2️⃣  Compartir → "Añadir a pantalla de inicio"</Text>
            </View>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleCopy}>
              <Text style={styles.btnPrimaryText}>{copied ? '✅ LINK COPIADO' : 'COPIAR LINK'}</Text>
            </TouchableOpacity>
          </>
        ) : androidWebview ? (
          // Dentro de IG/FB en Android → botón que SALTA a Chrome de verdad.
          <>
            <Text style={styles.body}>Estás dentro de otra app (Instagram/Facebook). Abrila en <Text style={styles.bold}>Chrome</Text> para poder instalar.</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleOpenChrome}>
              <Text style={styles.btnPrimaryText}>🌐 ABRIR EN CHROME</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Si no abre solo, tocá el menú ⋯ de esta pantalla y elegí "Abrir en el navegador".</Text>
          </>
        ) : (
          <>
            <Text style={styles.body}>Estás dentro de otra app. Abrí el link en tu navegador (Chrome o Safari) para instalar.</Text>
            <TouchableOpacity style={styles.btnPrimary} onPress={handleCopy}>
              <Text style={styles.btnPrimaryText}>{copied ? '✅ LINK COPIADO' : 'COPIAR LINK'}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>{APP_URL}</Text>
          </>
        )}

        {!installed && renderEscape('No puedo instalar — entrar igual')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    zIndex: 99999,
  },
  card: {
    backgroundColor: COLORS.card2,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  logo:     { width: 72, height: 72, borderRadius: 18 },
  icon:     { fontSize: 48 },
  title:    { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 3, textAlign: 'center' },
  required: { fontFamily: FONTS.bodySemiBold, fontSize: 12, color: COLORS.red, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 },
  body:     { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, textAlign: 'center' },
  benefits: { width: '100%', gap: SPACING.sm },
  benefit:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white },
  bold:     { fontFamily: FONTS.bodySemiBold, color: COLORS.white },
  hint:     { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, textAlign: 'center' },
  btnPrimary: {
    width: '100%',
    backgroundColor: COLORS.red,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  btnPrimaryText: { fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 16 },
  btnSecondary: {
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    marginTop: SPACING.xs,
  },
  btnSecondaryText: { fontFamily: FONTS.bodySemiBold, color: COLORS.gray2, fontSize: 13, letterSpacing: 1 },
  escapeBtn: { marginTop: SPACING.sm, paddingVertical: SPACING.sm },
  escapeText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, textAlign: 'center', textDecorationLine: 'underline' },
});
