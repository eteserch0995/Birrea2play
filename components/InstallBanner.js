// Barra de instalación obligatoria.
// Android: botón nativo con beforeinstallprompt.
// iOS Safari: abre guía de pasos.
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

function isStandalone() {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
  );
}

function isIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) &&
    /safari/i.test(ua) &&
    !/crios|fxios|opios|chromium|chrome/i.test(ua);
}

export default function InstallBanner() {
  const [show, setShow]         = useState(false);
  const [platform, setPlatform] = useState(null);   // 'android' | 'ios'
  const [iosGuide, setIosGuide] = useState(false);
  const deferredRef             = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (isStandalone()) return;

    const onPrompt = (e) => {
      e.preventDefault();
      deferredRef.current = e;
      setPlatform('android');
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = () => { setShow(false); deferredRef.current = null; };
    window.addEventListener('appinstalled', onInstalled);

    if (isIosSafari()) { setPlatform('ios'); setShow(true); }

    // Detectar si pasan a standalone mientras la app está abierta (iOS tras "Añadir")
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onMqChange = (e) => { if (e.matches) setShow(false); };
    mq?.addEventListener?.('change', onMqChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onMqChange);
    };
  }, []);

  if (Platform.OS !== 'web' || !show) return null;

  const handleAction = async () => {
    if (platform === 'android' && deferredRef.current) {
      deferredRef.current.prompt();
      const { outcome } = await deferredRef.current.userChoice;
      if (outcome === 'accepted') { setShow(false); deferredRef.current = null; }
    } else if (platform === 'ios') {
      setIosGuide(true);
    }
  };

  return (
    <>
      {/* ── Barra top ── */}
      <View style={s.bar}>
        <View style={s.pulse} />
        <View style={s.texts}>
          <Text style={s.title}>📲 Instalá Birrea2Play en tu celular</Text>
          <Text style={s.sub}>Recibí notificaciones de eventos y partidos</Text>
        </View>
        <TouchableOpacity style={s.btn} onPress={handleAction} activeOpacity={0.82}>
          <Text style={s.btnText}>{platform === 'ios' ? 'CÓMO ▸' : 'INSTALAR ▸'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Guía iOS ── */}
      <Modal visible={iosGuide} transparent animationType="slide" onRequestClose={() => setIosGuide(false)}>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.heading}>Instalá en tu iPhone</Text>
            <Text style={m.subhead}>3 pasos — menos de 10 segundos</Text>
            <IosStep n="1" icon="⬆️" text={'Tocá el botón de Compartir en la barra inferior de Safari'} />
            <IosStep n="2" icon="➕" text={'Deslizá y tocá "Añadir a la pantalla de inicio"'} />
            <IosStep n="3" icon="✅" text={'Tocá "Añadir" y listo — Birrea2Play queda en tu inicio'} />
            <TouchableOpacity style={m.btn} onPress={() => setIosGuide(false)} activeOpacity={0.85}>
              <Text style={m.btnText}>ENTENDIDO</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function IosStep({ n, icon, text }) {
  return (
    <View style={step.row}>
      <View style={step.circle}><Text style={step.num}>{n}</Text></View>
      <Text style={step.icon}>{icon}</Text>
      <Text style={step.text}>{text}</Text>
    </View>
  );
}

const NEON = COLORS.neon ?? '#B8FF00';
const BG   = COLORS.bg   ?? '#07080B';

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BG,
    borderBottomWidth: 2,
    borderBottomColor: NEON,
    paddingVertical: 8,
    paddingLeft: SPACING.sm,
    paddingRight: SPACING.sm,
    gap: SPACING.sm,
    // Sombra que hace que se note
    shadowColor: NEON,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    zIndex: 9999,
    position: 'relative',
  },
  pulse: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: NEON,
  },
  texts: { flex: 1 },
  title: { fontFamily: FONTS.bodyBold ?? FONTS.body, fontSize: 12, color: COLORS.white },
  sub:   { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray2 ?? COLORS.gray, marginTop: 1 },
  btn: {
    backgroundColor: NEON, borderRadius: RADIUS.sm,
    paddingHorizontal: 12, paddingVertical: 6,
    flexShrink: 0,
  },
  btnText: { fontFamily: FONTS.heading, fontSize: 12, color: BG, letterSpacing: 1 },
});

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.70)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card2 ?? '#171C24',
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: SPACING.lg ?? 24, paddingTop: SPACING.md, paddingBottom: 36,
  },
  handle: { width: 40, height: 4, backgroundColor: COLORS.line ?? '#2A323F', borderRadius: 99, alignSelf: 'center', marginBottom: SPACING.md },
  heading: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 1.5, marginBottom: 4 },
  subhead: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 ?? COLORS.gray, marginBottom: SPACING.lg ?? 20 },
  btn: { backgroundColor: NEON, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.md },
  btnText: { fontFamily: FONTS.heading, fontSize: 15, color: BG, letterSpacing: 2 },
});

const step = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.md, gap: SPACING.sm },
  circle: { width: 28, height: 28, borderRadius: 14, backgroundColor: NEON + '22', borderWidth: 1, borderColor: NEON + '80', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  num:  { fontFamily: FONTS.heading, fontSize: 14, color: NEON },
  icon: { fontSize: 20, flexShrink: 0, marginTop: 2 },
  text: { flex: 1, fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, lineHeight: 21 },
});
