// PWAGate — bloqueo full-screen obligatorio en web móvil.
//
// Flujo:
//   browser (no standalone) → bloqueado siempre
//   standalone + sin notif  → paso: activar notificaciones
//   standalone + notif + no reclamado → botón OBTENER RECOMPENSA ($1, un solo uso)
//   standalone + notif + ya reclamado → pasa directo a la app
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform,
  Animated, Image, ActivityIndicator, ScrollView,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';
import { registerForPushNotifications } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import useAuthStore from '../store/authStore';
import { getInstallPrompt, clearInstallPrompt } from '../lib/installPrompt';

const mundialLogo = require('../assets/birrea2play-logo.png');
const LS_KEY      = 'b2p_pwa_bonus_claimed';

// ── Helpers de detección ──────────────────────────────────────
function isStandalone() {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
  );
}
function isMobileWeb() {
  if (typeof window === 'undefined') return false;
  // User agent + pantalla pequeña o touch — cubre modo desktop en Chrome móvil
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const uaMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  const smallScreen = window.innerWidth < 1024 && navigator?.maxTouchPoints > 0;
  return uaMobile || smallScreen;
}
function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) &&
    /safari/i.test(ua) && !/crios|fxios|opios|chromium|chrome/i.test(ua);
}
function isIosChrome() {
  return typeof navigator !== 'undefined' && /crios/i.test(navigator.userAgent);
}
function notifPerm() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}
function lsGet()     { try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; } }
function lsSet()     { try { localStorage.setItem(LS_KEY, '1'); } catch {} }

// ── Pantalla: instalar ────────────────────────────────────────
// Siempre muestra instrucciones de instalación en mobile web.
// No distingue "ya instalada / no instalada" — el usuario simplemente
// debe instalar y abrir desde el inicio para continuar.
function StepInstall({ onInstalled }) {
  const [prompt, setPrompt] = useState(() => getInstallPrompt());
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.06, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
    ])).start();

    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstall = () => { clearInstallPrompt(); onInstalled(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstall);
    const poll = setInterval(() => { if (isStandalone()) onInstalled(); }, 1500);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstall);
      clearInterval(poll);
    };
  }, [onInstalled, pulse]);

  const doInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') onInstalled();
  };

  // iOS Chrome — no puede instalar desde Chrome
  if (isIosChrome()) return (
    <View style={s.body}>
      <Text style={s.bigIcon}>🌐</Text>
      <Text style={s.title}>Abrí en Safari</Text>
      <Text style={s.desc}>
        Para instalar Birrea2Play en tu iPhone necesitás usar{' '}
        <Text style={s.accent}>Safari</Text>, no Chrome.{'\n\n'}
        Copiá la dirección y pegala en Safari.
      </Text>
      <View style={s.urlBox}><Text style={s.urlText}>birrea2play.com</Text></View>
    </View>
  );

  // iOS Safari — guía de 3 pasos
  if (isIosSafari()) return (
    <View style={s.body}>
      <Animated.Text style={[s.bigIcon, { transform: [{ scale: pulse }] }]}>📲</Animated.Text>
      <Text style={s.title}>Instalá la app</Text>
      <Text style={s.desc}>Seguí estos 3 pasos en Safari:</Text>
      <View style={s.steps}>
        <StepRow n="1" icon="⬆️" text="Tocá el botón de Compartir en la barra inferior de Safari" />
        <StepRow n="2" icon="➕" text='"Añadir a la pantalla de inicio"' />
        <StepRow n="3" icon="🏠" text='Tocá "Añadir" y abrí la app desde tu pantalla de inicio para continuar' />
      </View>
      <Waiting pulse={pulse} label="Esperando que instales y abras la app…" />
    </View>
  );

  // Android — con prompt disponible: botón nativo
  if (prompt) return (
    <View style={s.body}>
      <Animated.Text style={[s.bigIcon, { transform: [{ scale: pulse }] }]}>📲</Animated.Text>
      <Text style={s.title}>Instalá la app</Text>
      <Text style={s.desc}>
        Tocá <Text style={s.accent}>INSTALAR</Text> para agregar{'\n'}
        Birrea2Play a tu pantalla de inicio.{'\n\n'}
        Luego abrila desde ahí para activar{'\n'}
        notificaciones y reclamar tu <Text style={s.accent}>$1</Text>.
      </Text>
      <TouchableOpacity style={s.btn} onPress={doInstall} activeOpacity={0.85}>
        <Text style={s.btnText}>INSTALAR AHORA ▸</Text>
      </TouchableOpacity>
      <Waiting pulse={pulse} label="Abrila desde tu inicio para continuar…" />
    </View>
  );

  // Android — sin prompt (cooldown de Chrome tras desinstalar, o navegador no compatible)
  return (
    <View style={s.body}>
      <Animated.Text style={[s.bigIcon, { transform: [{ scale: pulse }] }]}>📲</Animated.Text>
      <Text style={s.title}>Instalá la app</Text>
      <Text style={s.desc}>Para instalar Birrea2Play en Android:</Text>
      <View style={s.steps}>
        <StepRow n="1" icon="⋮" text="Tocá el menú (⋮) en la esquina superior de Chrome" />
        <StepRow n="2" icon="➕" text='"Instalar app" o "Añadir a pantalla de inicio"' />
        <StepRow n="3" icon="🏠" text="Abrila desde tu pantalla de inicio para continuar" />
      </View>
      <Waiting pulse={pulse} label="Esperando que instales y abras la app…" />
    </View>
  );
}

// ── Pantalla: notificaciones ──────────────────────────────────
function StepNotifications({ onGranted }) {
  const { user }          = useAuthStore();
  const [perm, setPerm]   = useState(notifPerm());
  const [busy, setBusy]   = useState(false);
  const pulse             = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 800, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1,    duration: 800, useNativeDriver: true }),
    ])).start();
  }, [pulse]);

  const activate = async () => {
    setBusy(true);
    try {
      await registerForPushNotifications(user?.id);
      const p = notifPerm();
      setPerm(p);
      if (p === 'granted') onGranted();
    } catch { setPerm(notifPerm()); }
    finally { setBusy(false); }
  };

  const recheck = () => {
    const p = notifPerm();
    setPerm(p);
    if (p === 'granted') onGranted();
  };

  return (
    <View style={s.body}>
      <Animated.Text style={[s.bigIcon, { transform: [{ scale: pulse }] }]}>🔔</Animated.Text>
      <Text style={s.title}>
        {perm === 'denied'
          ? 'Notificaciones bloqueadas'
          : perm === 'unsupported'
            ? 'Navegador no compatible'
            : 'Activá las notificaciones'}
      </Text>

      {perm === 'unsupported' ? (
        <>
          <Text style={s.desc}>
            Esta versión del navegador no permite notificaciones web.{'\n\n'}
            Actualizá el sistema y abrí Birrea2Play desde la app instalada con{' '}
            <Text style={s.accent}>Safari en iPhone</Text> o{' '}
            <Text style={s.accent}>Chrome en Android</Text>.
          </Text>
          <TouchableOpacity style={s.btnOutline} onPress={recheck} activeOpacity={0.85}>
            <Text style={s.btnOutlineText}>VOLVER A COMPROBAR</Text>
          </TouchableOpacity>
        </>
      ) : perm === 'denied' ? (
        <>
          <Text style={s.desc}>
            Las bloqueaste. Para habilitarlas de nuevo:{'\n\n'}
            <Text style={s.accent}>Android:</Text> Configuración → Apps → Chrome → Notificaciones{'\n'}
            <Text style={s.accent}>iOS:</Text> Configuración → Birrea2Play → Notificaciones
          </Text>
          <TouchableOpacity style={s.btnOutline} onPress={recheck} activeOpacity={0.85}>
            <Text style={s.btnOutlineText}>YA LO HABILITÉ ✓</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.desc}>
            Necesitamos avisarte de partidos, eventos y ofertas.{'\n\n'}
            Tocá <Text style={s.accent}>ACTIVAR</Text> y luego "Permitir".
          </Text>
          <TouchableOpacity
            style={[s.btn, busy && s.btnDim]}
            onPress={activate}
            activeOpacity={0.85}
            disabled={busy}
          >
            <Text style={s.btnText}>{busy ? 'ACTIVANDO…' : 'ACTIVAR NOTIFICACIONES ▸'}</Text>
          </TouchableOpacity>
        </>
      )}
      <Text style={s.foot}>Sin notificaciones no podés usar la app.</Text>
    </View>
  );
}

// ── Pantalla: reclamar bono ───────────────────────────────────
function StepClaim({ onClaimed }) {
  const [busy, setBusy]       = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState(null);
  const scale                 = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }).start();
  }, [scale]);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('claim_pwa_install_bonus');
      if (rpcErr) throw rpcErr;
      if (data?.granted === true) {
        lsSet();
        setDone(true);
        setTimeout(onClaimed, 2200);
      } else if (data?.already_claimed) {
        lsSet();
        onClaimed();
      } else {
        setError(data?.error ?? 'No se pudo procesar. Intentá de nuevo.');
      }
    } catch (e) {
      setError(e?.message ?? 'Error de conexión.');
    } finally {
      setBusy(false);
    }
  };

  if (done) return (
    <View style={s.body}>
      <Text style={[s.bigIcon, { fontSize: 80 }]}>🎉</Text>
      <Text style={s.title}>¡$1 acreditado!</Text>
      <Text style={s.desc}>Ya está disponible en tu wallet.{'\n'}¡Bienvenido a Birrea2Play!</Text>
    </View>
  );

  return (
    <View style={s.body}>
      <Text style={s.bigIcon}>🎁</Text>
      <Text style={s.title}>¡Todo listo!</Text>
      <Text style={s.desc}>
        Instalaste la app y activaste las notificaciones.{'\n\n'}
        Tocá el botón para reclamar tu{' '}
        <Text style={s.accent}>recompensa de $1</Text>.{'\n'}
        Solo se puede usar <Text style={s.accent}>una vez</Text>.
      </Text>

      <Animated.View style={{ width: '100%', transform: [{ scale }] }}>
        <TouchableOpacity
          style={[s.btnGold, busy && s.btnDim]}
          onPress={claim}
          activeOpacity={0.85}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#07080B" />
            : <Text style={s.btnGoldText}>OBTENER RECOMPENSA · $1 ▸</Text>}
        </TouchableOpacity>
      </Animated.View>

      {error && <Text style={s.errorText}>{error}</Text>}
      <Text style={s.foot}>Este botón desaparece una vez usado.</Text>
    </View>
  );
}

// ── Subcomponentes menores ────────────────────────────────────
function StepRow({ n, icon, text }) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
      <Text style={s.stepIcon}>{icon}</Text>
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}
function Waiting({ pulse, label }) {
  return (
    <View style={s.waitRow}>
      <Animated.View style={[s.waitDot, { transform: [{ scale: pulse }] }]} />
      <Text style={s.waitText}>{label}</Text>
    </View>
  );
}

// ── Gate principal ────────────────────────────────────────────
export default function PWAGate({ children, onReady }) {
  // step: null=evaluando | 'install' | 'notifications' | 'claim' | 'done'
  const [step, setStep] = useState(null);
  const fade = useRef(new Animated.Value(0)).current;

  const evaluate = useCallback(async () => {
    if (Platform.OS !== 'web') { setStep('done'); return; }
    if (!isMobileWeb())        { setStep('done'); return; }

    // Paso 1: standalone obligatorio
    if (!isStandalone()) { setStep('install'); return; }

    // Paso 2: notificaciones obligatorias
    const perm = notifPerm();
    if (perm !== 'granted') { setStep('notifications'); return; }

    // Si localStorage dice que ya reclamó → pasa directo
    if (lsGet()) { setStep('done'); return; }

    // Todo listo, no reclamó aún → mostrar botón de recompensa
    // (el RPC claim_pwa_install_bonus maneja el caso already_claimed si el LS fue borrado)
    setStep('claim');
  }, []);

  useEffect(() => {
    evaluate();
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') evaluate();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible); };
  }, [evaluate]);

  useEffect(() => {
    if (step && step !== 'done') {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    }
  }, [step, fade]);

  useEffect(() => {
    if (step === 'done') onReady?.();
  }, [step, onReady]);

  const goNotif  = useCallback(() => setStep('notifications'), []);
  const goClaim  = useCallback(() => {
    const perm = notifPerm();
    if (perm !== 'granted') { setStep('notifications'); return; }
    if (lsGet()) { setStep('done'); return; }
    setStep('claim');
  }, []);
  const goDone   = useCallback(() => setStep('done'), []);

  if (step === null) return (
    <>
      {children}
      <View style={s.loadingOverlay}>
        <ActivityIndicator color={COLORS.neon ?? '#B8FF00'} size="large" />
      </View>
    </>
  );

  if (step === 'done') return children;

  const stepNum   = step === 'install' ? 1 : step === 'notifications' ? 2 : 3;
  const stepLabel = step === 'install' ? 'Instalar app' : step === 'notifications' ? 'Notificaciones' : 'Recompensa';

  return (
    <>
      {children}
      <Animated.View style={[s.overlay, { opacity: fade }]}>
        {/* Header fijo */}
        <View style={s.header}>
          <Image source={mundialLogo} style={s.logo} resizeMode="contain" />
          <Text style={s.brand}>BIRREA2PLAY</Text>
        </View>

        {/* Progreso fijo */}
        <View style={s.prog}>
          <ProgDot active={stepNum >= 1} />
          <ProgLine />
          <ProgDot active={stepNum >= 2} />
          <ProgLine />
          <ProgDot active={stepNum >= 3} />
        </View>
        <Text style={s.progLabel}>Paso {stepNum} de 3 — {stepLabel}</Text>

        {/* Contenido scrollable para que nada se corte */}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {step === 'install'       && <StepInstall onInstalled={goNotif} />}
          {step === 'notifications' && <StepNotifications onGranted={goClaim} />}
          {step === 'claim'         && <StepClaim onClaimed={goDone} />}
        </ScrollView>
      </Animated.View>
    </>
  );
}

function ProgDot({ active }) {
  const NEON = COLORS.neon ?? '#B8FF00';
  return (
    <View style={[s.progDot, active && { backgroundColor: NEON, borderColor: NEON }]} />
  );
}
function ProgLine() {
  return <View style={s.progLine} />;
}

// ── Estilos ───────────────────────────────────────────────────
const NEON = COLORS.neon  ?? '#B8FF00';
const GOLD = COLORS.gold  ?? '#FFD700';
const BG   = COLORS.bg    ?? '#07080B';
const BG2  = COLORS.bg2   ?? '#0A0E14';
const GRAY = COLORS.gray2 ?? '#7F8794';

const s = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: BG, zIndex: 99999,
    alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 52, paddingBottom: 36,
  },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: BG, zIndex: 99999,
    alignItems: 'center', justifyContent: 'center',
  },
  header: { alignItems: 'center', marginBottom: 20 },
  logo:   { width: 64, height: 64, borderRadius: 14, marginBottom: 8 },
  brand:  { fontFamily: FONTS.heading, fontSize: 14, color: NEON, letterSpacing: 4 },

  prog:      { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  progDot:   { width: 14, height: 14, borderRadius: 7, backgroundColor: COLORS.line ?? '#2A323F', borderWidth: 2, borderColor: COLORS.line ?? '#2A323F' },
  progLine:  { width: 40, height: 2, backgroundColor: COLORS.line ?? '#2A323F', marginHorizontal: 6 },
  progLabel: { fontFamily: FONTS.body, fontSize: 12, color: GRAY, letterSpacing: 1, marginBottom: 24 },

  body:    { flex: 1, alignItems: 'center', width: '100%' },
  bigIcon: { fontSize: 68, marginBottom: 12 },
  title:   { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.white, letterSpacing: 1, textAlign: 'center', marginBottom: 10 },
  desc:    { fontFamily: FONTS.body, fontSize: 15, color: GRAY, textAlign: 'center', lineHeight: 24, marginBottom: 24 },
  accent:  { fontFamily: FONTS.bodyBold ?? FONTS.body, color: NEON },
  foot:    { fontFamily: FONTS.body, fontSize: 12, color: GRAY + '88', textAlign: 'center', marginTop: 20, lineHeight: 18 },
  errorText: { fontFamily: FONTS.body, fontSize: 13, color: '#FF4444', textAlign: 'center', marginTop: 12 },

  btn: {
    backgroundColor: NEON, borderRadius: RADIUS.md,
    paddingVertical: 16, width: '100%', alignItems: 'center',
    shadowColor: NEON, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  btnText: { fontFamily: FONTS.heading, fontSize: 17, color: BG, letterSpacing: 2 },
  btnDim:  { opacity: 0.55 },

  btnOutline: {
    borderWidth: 2, borderColor: NEON, borderRadius: RADIUS.md,
    paddingVertical: 14, width: '100%', alignItems: 'center', marginTop: 8,
  },
  btnOutlineText: { fontFamily: FONTS.heading, fontSize: 15, color: NEON, letterSpacing: 1.5 },

  btnGold: {
    backgroundColor: GOLD, borderRadius: RADIUS.md,
    paddingVertical: 18, width: '100%', alignItems: 'center',
    shadowColor: GOLD, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  btnGoldText: { fontFamily: FONTS.heading, fontSize: 18, color: BG, letterSpacing: 1.5 },

  steps:   { width: '100%', marginBottom: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14, gap: 10 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: NEON + '22', borderWidth: 1.5, borderColor: NEON, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepNumText: { fontFamily: FONTS.heading, fontSize: 13, color: NEON },
  stepIcon:    { fontSize: 18, flexShrink: 0, marginTop: 4 },
  stepText:    { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, lineHeight: 22, paddingTop: 3 },

  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  waitDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: NEON },
  waitText: { fontFamily: FONTS.body, fontSize: 13, color: GRAY },

  hint:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: NEON + '12', borderWidth: 1, borderColor: NEON + '44', borderRadius: RADIUS.md, padding: 14, width: '100%', marginTop: 8 },
  hintIcon: { fontSize: 20 },
  hintText: { flex: 1, fontFamily: FONTS.body, fontSize: 13, color: GRAY, lineHeight: 19 },

  urlBox:  { backgroundColor: BG2, borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 20, marginTop: 14, borderWidth: 1, borderColor: NEON + '40' },
  urlText: { fontFamily: FONTS.heading, fontSize: 18, color: NEON, letterSpacing: 1 },
});
