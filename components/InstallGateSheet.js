// InstallGateSheet — gate por acción del embudo de instalación PWA.
// Se muestra al intentar registrarse/inscribirse desde navegador móvil.
// Persuasión fuerte, NO pared: siempre hay un link chico de escape abajo
// (decisión de Sergio). web-only — nunca se monta en nativo.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { COLORS, FONTS, TYPE, SPACING, RADIUS, withAlpha } from '../constants/theme';
import { BottomSheetModal, PressableScale } from './ui';
import { getInstallPlatform, getInstallGateFlags, setGateEscaped, logFunnel } from '../lib/installGate';
import { getInstallPrompt, clearInstallPrompt } from '../lib/installPrompt';

// ── Iconos propios (SVG, sin emojis — patrón de components/ui/TabIcons) ──────
const ICON_PROPS = { strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

function IconDownload({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 4V15" {...ICON_PROPS} stroke={color} />
      <Path d="M7 11L12 16L17 11" {...ICON_PROPS} stroke={color} />
      <Path d="M4 19H20" {...ICON_PROPS} stroke={color} />
    </Svg>
  );
}
function IconShare({ color, size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3V14" {...ICON_PROPS} stroke={color} />
      <Path d="M8 7L12 3L16 7" {...ICON_PROPS} stroke={color} />
      <Rect x="5" y="10" width="14" height="11" rx="2" {...ICON_PROPS} stroke={color} />
    </Svg>
  );
}
function IconMenu({ color, size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="6" r="1.4" fill={color} />
      <Circle cx="12" cy="12" r="1.4" fill={color} />
      <Circle cx="12" cy="18" r="1.4" fill={color} />
    </Svg>
  );
}
function IconBell({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 10C6 6.7 8.7 4 12 4C15.3 4 18 6.7 18 10V14L20 17H4L6 14V10Z" {...ICON_PROPS} stroke={color} />
      <Path d="M10 20C10 21.1 10.9 22 12 22C13.1 22 14 21.1 14 20" {...ICON_PROPS} stroke={color} />
    </Svg>
  );
}
function IconTap({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="13" r="4" {...ICON_PROPS} stroke={color} />
      <Path d="M12 3V5" {...ICON_PROPS} stroke={color} />
      <Path d="M5 13H3" {...ICON_PROPS} stroke={color} />
      <Path d="M21 13H19" {...ICON_PROPS} stroke={color} />
    </Svg>
  );
}
function IconDollar({ color, size = 18 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3V21" {...ICON_PROPS} stroke={color} />
      <Path d="M16 7C16 5.3 14.2 4 12 4C9.8 4 8 5.3 8 7C8 11 16 9 16 14C16 15.7 14.2 17 12 17C9.8 17 8 15.7 8 14" {...ICON_PROPS} stroke={color} />
    </Svg>
  );
}

function StepRow({ n, icon, text }) {
  return (
    <View style={s.stepRow}>
      <View style={s.stepNum}><Text style={s.stepNumText}>{n}</Text></View>
      {icon}
      <Text style={s.stepText}>{text}</Text>
    </View>
  );
}
function BenefitRow({ icon, text }) {
  return (
    <View style={s.benefitRow}>
      {icon}
      <Text style={s.benefitText}>{text}</Text>
    </View>
  );
}

export default function InstallGateSheet({ visible, onClose, reason }) {
  const [prompt, setPrompt] = useState(() => getInstallPrompt());
  const platform = getInstallPlatform();
  const flags = getInstallGateFlags();

  useEffect(() => {
    if (!visible) return;
    logFunnel('gate_shown', { reason, platform });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { clearInstallPrompt(); onClose?.(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [onClose]);

  const doInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') { clearInstallPrompt(); onClose?.(); }
  };

  const escape = () => {
    setGateEscaped();
    logFunnel('gate_escaped', { reason, platform });
    onClose?.();
  };

  const subtitle = reason === 'inscripcion'
    ? 'Instalá la app para confirmar tu inscripción en un toque.'
    : 'Terminá tu registro desde la app instalada — no perdés tu lugar.';

  return (
    // Cerrar por X/backdrop también cuenta como escape de sesión: sin esto,
    // el gate re-saltaba en CADA tap de "Inscribirse" (hallazgo del review).
    <BottomSheetModal visible={visible} onClose={escape} title="INSTALÁ LA APP" subtitle={subtitle}>
      <View style={s.body}>
        {platform === 'android' && prompt && (
          <PressableScale style={s.installBtn} onPress={doInstall}>
            <IconDownload color={COLORS.bg} />
            <Text style={s.installBtnText}>INSTALAR AHORA</Text>
          </PressableScale>
        )}

        {platform === 'android' && !prompt && (
          <View style={s.steps}>
            <StepRow n="1" icon={<IconMenu color={COLORS.neon} />} text="Tocá el menú (⋮) de Chrome" />
            <StepRow n="2" icon={<IconDownload color={COLORS.neon} />} text='"Instalar app" o "Añadir a pantalla de inicio"' />
          </View>
        )}

        {platform === 'ios-safari' && (
          <View style={s.steps}>
            <StepRow n="1" icon={<IconShare color={COLORS.neon} />} text="Tocá el botón de Compartir en Safari" />
            <StepRow n="2" icon={<IconDownload color={COLORS.neon} />} text='"Añadir a la pantalla de inicio"' />
          </View>
        )}

        {(platform === 'ios-otro' || platform === 'webview' || platform === 'desktop') && (
          <Text style={s.desc}>
            {platform === 'webview'
              ? 'Abrí birrea2play.com en Chrome o Safari (fuera de esta app) para poder instalarla.'
              : 'Para instalarla en tu iPhone abrí birrea2play.com en Safari.'}
          </Text>
        )}

        <View style={s.benefits}>
          <BenefitRow icon={<IconBell color={COLORS.neon} />} text="Notificaciones de tus birreas" />
          <BenefitRow icon={<IconTap color={COLORS.neon} />} text="Entrá en 1 toque, sin buscar el link" />
          {flags.bonus && (
            <BenefitRow icon={<IconDollar color={COLORS.gold} />} text="$1 de bono al instalar" />
          )}
        </View>

        <PressableScale onPress={escape} style={s.escapeLink}>
          <Text style={s.escapeText}>Continuar en la web por ahora</Text>
        </PressableScale>
      </View>
    </BottomSheetModal>
  );
}

const s = StyleSheet.create({
  body: { width: '100%' },
  desc: {
    fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.gray2,
    lineHeight: 20, marginBottom: SPACING.md,
  },

  steps: { width: '100%', marginBottom: SPACING.md, gap: SPACING.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: withAlpha(COLORS.neon, '22'), borderWidth: 1, borderColor: COLORS.neon,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepNumText: { fontFamily: FONTS.heading, fontSize: 11, color: COLORS.neon },
  stepText: { flex: 1, fontFamily: FONTS.body, fontSize: TYPE.body, color: COLORS.white, lineHeight: 19 },

  installBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs,
    backgroundColor: COLORS.neon, borderRadius: RADIUS.md,
    paddingVertical: SPACING.md, width: '100%', marginBottom: SPACING.md,
  },
  installBtnText: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.bg, letterSpacing: 1.5 },

  benefits: {
    width: '100%', gap: SPACING.sm, marginTop: SPACING.xs, marginBottom: SPACING.md,
    borderTopWidth: 1, borderTopColor: COLORS.line, paddingTop: SPACING.md,
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  benefitText: { fontFamily: FONTS.body, fontSize: TYPE.small, color: COLORS.gray2, flex: 1 },

  escapeLink: { alignSelf: 'center', paddingVertical: SPACING.sm },
  escapeText: {
    fontFamily: FONTS.body, fontSize: TYPE.caption, color: COLORS.gray,
    textDecorationLine: 'underline',
  },
});
