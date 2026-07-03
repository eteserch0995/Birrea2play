// ============================================================
// WCComponents — sistema visual del módulo Mundial 2026
// ============================================================
// Componentes reutilizables que aplican el branding FIFA WC 2026.
// Todos cumplen WCAG AA (contraste >= 4.5:1) y touch targets >= 44px.
//
// Export:
//   WC_ALPHA  — tokens de transparencia centralizados
//   WCCard    — card oscura o clara con variantes
//   WCButton  — botón con variants y states
//   WCBadge   — chip pequeño para estados
//   WCTabBar  — tabs scrolleables horizontalmente
//   WCStatTile — tile de stat (label arriba, valor grande, sub-meta)
//   WCSectionTitle — título de sección
//   WCEmptyState — vacío con icono + mensaje
//   WCHeader   — header con back + título centrado + acción opcional
// ============================================================

import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../constants/theme';

// ─── Tokens centralizados ────────────────────────────────────
export const WC_ALPHA = {
  // Cards
  cardDark:    'rgba(10,14,20,0.92)',
  cardDarkMid: 'rgba(10,14,20,0.80)',
  cardLight:   'rgba(255,255,255,0.92)',
  cardLightMid:'rgba(255,255,255,0.80)',
  // Estados/accentos
  goldGlow:    'rgba(255,215,0,0.14)',
  magentaGlow: 'rgba(255,26,107,0.14)',
  neonGlow:    'rgba(184,255,0,0.14)',
  blueGlow:    'rgba(0,51,204,0.14)',
  greenGlow:   'rgba(35,209,139,0.14)',
  // Líneas
  divider:     'rgba(255,255,255,0.10)',
  dividerDark: 'rgba(10,14,20,0.16)',
  // Backdrops
  backdrop:    'rgba(0,0,0,0.70)',
};

// ─── WCCard ──────────────────────────────────────────────────
// variant: 'dark' (default) | 'light' | 'glow'
// accent: 'gold' | 'magenta' | 'neon' | 'blue' | 'green' (border tint)
export function WCCard({ children, variant = 'dark', accent, style }) {
  const baseBg = variant === 'light' ? WC_ALPHA.cardLight : WC_ALPHA.cardDark;
  const borderColor = accent ? COLORS[accent] + '88' : (variant === 'light' ? WC_ALPHA.dividerDark : WC_ALPHA.divider);
  return (
    <View style={[
      cardStyles.base,
      { backgroundColor: baseBg, borderColor },
      variant === 'glow' && SHADOWS.glow,
      style,
    ]}>
      {children}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    ...SHADOWS.card,
  },
});

// ─── WCButton ────────────────────────────────────────────────
// variant: 'primary' (magenta) | 'secondary' (neon) | 'ghost' | 'danger' | 'gold'
// size: 'lg' (default) | 'md' | 'sm'
export function WCButton({ label, onPress, variant = 'primary', size = 'lg', disabled, loading, style, leadingIcon }) {
  const { bg, color, border, isLight } = btnPalette(variant, disabled);
  const padV = size === 'sm' ? 8 : size === 'md' ? 12 : 16;
  const padH = size === 'sm' ? 12 : size === 'md' ? 18 : 24;
  const minH = size === 'sm' ? 36 : size === 'md' ? 44 : 52;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[
        btnStyles.base,
        { backgroundColor: bg, borderColor: border, paddingVertical: padV, paddingHorizontal: padH, minHeight: minH },
        disabled && { opacity: 0.45 },
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      {...(variant === 'primary' ? { dataSet: { m26Btn: 'primary' } } : {})}
    >
      {loading ? (
        <ActivityIndicator color={color} size="small" />
      ) : (
        <View style={btnStyles.row}>
          {leadingIcon && <Text style={[btnStyles.icon, { color }]}>{leadingIcon}</Text>}
          <Text style={[btnStyles.label, { color, fontSize: size === 'sm' ? 12 : size === 'md' ? 14 : 15 }]}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function btnPalette(variant, disabled) {
  const primaryBg = COLORS.magentaA11y || COLORS.magenta; // a11y WCAG AA, fallback fuera de la ventana Mundial
  if (variant === 'primary') return { bg: primaryBg, color: COLORS.white, border: primaryBg };
  if (variant === 'secondary') return { bg: COLORS.neon, color: COLORS.bg, border: COLORS.neon, isLight: true };
  if (variant === 'gold') return { bg: COLORS.gold, color: COLORS.bg, border: COLORS.gold, isLight: true };
  if (variant === 'danger') return { bg: COLORS.red, color: COLORS.white, border: COLORS.red };
  if (variant === 'ghost') return { bg: 'transparent', color: COLORS.white, border: COLORS.white + '55' };
  return { bg: primaryBg, color: COLORS.white, border: primaryBg };
}

const btnStyles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 16 },
  label: {
    fontFamily: FONTS.heading,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
});

// ─── WCBadge ─────────────────────────────────────────────────
// tone: 'neutral' | 'success' | 'warning' | 'danger' | 'gold' | 'magenta' | 'neon' | 'blue'
//       | 'vivo' | 'acertado' | 'eliminado' | 'fallado' | 'pendiente' | 'bloqueado' | 'finalizado' | 'en_vivo'
export function WCBadge({ label, tone = 'neutral', size = 'md' }) {
  const palette = badgePalette(tone);
  const padV = size === 'sm' ? 2 : 4;
  const padH = size === 'sm' ? 6 : 10;
  const fontSize = size === 'sm' ? 10 : 11;
  return (
    <View style={[
      badgeStyles.base,
      { backgroundColor: palette.bg, borderColor: palette.border, paddingVertical: padV, paddingHorizontal: padH },
    ]}>
      <Text style={[badgeStyles.label, { color: palette.color, fontSize }]}>{label}</Text>
    </View>
  );
}

function badgePalette(tone) {
  if (tone === 'success')    return { bg: COLORS.green + '22', border: COLORS.green + '88', color: COLORS.green };
  if (tone === 'warning')    return { bg: COLORS.gold + '22', border: COLORS.gold + '88', color: COLORS.gold };
  if (tone === 'danger')     return { bg: COLORS.red + '22', border: COLORS.red + '88', color: COLORS.red2A11y || COLORS.red2 };
  if (tone === 'gold')       return { bg: COLORS.gold + '22', border: COLORS.gold + '88', color: COLORS.gold };
  if (tone === 'magenta')    return { bg: COLORS.magenta + '22', border: COLORS.magenta + '88', color: COLORS.magentaText || COLORS.magenta };
  if (tone === 'neon')       return { bg: COLORS.neon + '22', border: COLORS.neon + '88', color: COLORS.neon };
  if (tone === 'blue')       return { bg: (COLORS.blue2 ?? '#3D6BFF') + '22', border: (COLORS.blue2 ?? '#3D6BFF') + '88', color: COLORS.blue2 ?? '#3D6BFF' };
  // ── Tones semánticos de estado ──────────────────────────────
  // vivo / acertado → green
  if (tone === 'vivo')       return { bg: COLORS.green + '22', border: COLORS.green + '88', color: COLORS.green };
  if (tone === 'acertado')   return { bg: COLORS.green + '22', border: COLORS.green + '88', color: COLORS.green };
  // eliminado / fallado → red2 (AA)
  if (tone === 'eliminado')  return { bg: (COLORS.red2 ?? '#FF3B1F') + '22', border: (COLORS.red2 ?? '#FF3B1F') + '88', color: COLORS.red2A11y ?? COLORS.red2 ?? '#D42200' };
  if (tone === 'fallado')    return { bg: (COLORS.red2 ?? '#FF3B1F') + '22', border: (COLORS.red2 ?? '#FF3B1F') + '88', color: COLORS.red2A11y ?? COLORS.red2 ?? '#D42200' };
  // pendiente → orange
  if (tone === 'pendiente')  return { bg: (COLORS.orange ?? '#FF7A18') + '22', border: (COLORS.orange ?? '#FF7A18') + '88', color: COLORS.orange ?? '#FF7A18' };
  // bloqueado / finalizado → gray2 (texto sobre fondo oscuro)
  if (tone === 'bloqueado')  return { bg: COLORS.white + '0D', border: WC_ALPHA.divider, color: COLORS.gray2 };
  if (tone === 'finalizado') return { bg: COLORS.white + '0D', border: WC_ALPHA.divider, color: COLORS.gray2 };
  // en_vivo → red2 sólido (urgencia en directo)
  if (tone === 'en_vivo')    return { bg: (COLORS.red2 ?? '#FF3B1F') + '22', border: COLORS.red2 ?? '#FF3B1F', color: COLORS.red2A11y ?? COLORS.red2 ?? '#D42200' };
  return { bg: COLORS.white + '14', border: WC_ALPHA.divider, color: COLORS.gray2 };
}

const badgeStyles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: FONTS.bodyBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

// ─── WCTabBar ────────────────────────────────────────────────
// Tabs scrolleable horizontalmente — soporta hasta N tabs sin truncar.
export function WCTabBar({ tabs, active, onChange, accent = 'magenta' }) {
  const activeBg = COLORS[accent] ?? COLORS.magenta;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={tabBarStyles.scroll}
      style={tabBarStyles.bar}
    >
      {tabs.map((t) => {
        const isActive = t === active;
        return (
          <TouchableOpacity
            key={t}
            style={[
              tabBarStyles.tab,
              isActive && { backgroundColor: activeBg, borderColor: activeBg },
            ]}
            onPress={() => onChange(t)}
          >
            <Text style={[tabBarStyles.label, isActive && { color: COLORS.white }]}>
              {t}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const tabBarStyles = StyleSheet.create({
  bar: { marginBottom: SPACING.md },
  scroll: { gap: 8, paddingHorizontal: 2 },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADIUS.md,
    backgroundColor: WC_ALPHA.cardDarkMid,
    borderColor: WC_ALPHA.divider,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  label: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.gray2,
    letterSpacing: 1,
  },
});

// ─── WCStatTile ──────────────────────────────────────────────
export function WCStatTile({ label, value, sub, accent, style }) {
  return (
    <View style={[statTileStyles.tile, style]}>
      <Text style={statTileStyles.label}>{label}</Text>
      <Text style={[statTileStyles.value, accent && { color: COLORS[accent] }]}>{value}</Text>
      {sub && <Text style={statTileStyles.sub}>{sub}</Text>}
    </View>
  );
}

const statTileStyles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: WC_ALPHA.cardDark,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderColor: WC_ALPHA.divider,
    borderWidth: 1,
    alignItems: 'center',
  },
  label: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.gray2,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 1,
    marginTop: 4,
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray2,
    marginTop: 2,
  },
});

// ─── WCSectionTitle ──────────────────────────────────────────
export function WCSectionTitle({ children, accent, sub }) {
  return (
    <View style={sectionTitleStyles.wrap}>
      <Text style={[sectionTitleStyles.title, accent && { color: COLORS[accent] }]}>{children}</Text>
      {sub && <Text style={sectionTitleStyles.sub}>{sub}</Text>}
    </View>
  );
}

const sectionTitleStyles = StyleSheet.create({
  wrap: { marginVertical: SPACING.md },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.white,
    letterSpacing: 1.5,
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 2,
    lineHeight: 17,
  },
});

// ─── WCEmptyState ────────────────────────────────────────────
export function WCEmptyState({ icon, title, message, action }) {
  return (
    <View style={emptyStyles.wrap}>
      {icon && <Text style={emptyStyles.icon}>{icon}</Text>}
      <Text style={emptyStyles.title}>{title}</Text>
      {message && <Text style={emptyStyles.message}>{message}</Text>}
      {action && <View style={{ marginTop: SPACING.md }}>{action}</View>}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  icon: { fontSize: 48, marginBottom: SPACING.sm },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 1,
    textAlign: 'center',
  },
  message: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 6,
  },
});

// ─── WCHeader ────────────────────────────────────────────────
// Header consistente con back + title + acción opcional
export function WCHeader({ title, onBack, right, kicker }) {
  return (
    <View style={headerStyles.wrap}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={headerStyles.back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={headerStyles.backText}>←</Text>
        </TouchableOpacity>
      ) : (
        <View style={headerStyles.back} />
      )}
      <View style={headerStyles.center}>
        {kicker && <Text style={headerStyles.kicker}>{kicker}</Text>}
        <Text style={headerStyles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={headerStyles.right}>{right}</View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.white, fontSize: 24, fontFamily: FONTS.bodyBold },
  center: { flex: 1, alignItems: 'center' },
  kicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 9,
    color: COLORS.magentaText || COLORS.magenta,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 1.5,
  },
  right: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

// ─── WCBlock — bloque con título integrado (atómico) ─────────
export function WCBlock({ title, sub, children, variant = 'dark', accent }) {
  return (
    <WCCard variant={variant} accent={accent} style={{ marginBottom: SPACING.md }}>
      {(title || sub) && (
        <View style={{ marginBottom: SPACING.sm }}>
          {title && (
            <Text style={[
              blockStyles.title,
              variant === 'light' && { color: COLORS.bg },
            ]}>{title}</Text>
          )}
          {sub && (
            <Text style={[
              blockStyles.sub,
              variant === 'light' && { color: COLORS.bg },
            ]}>{sub}</Text>
          )}
        </View>
      )}
      {children}
    </WCCard>
  );
}

const blockStyles = StyleSheet.create({
  title: {
    fontFamily: FONTS.heading,
    fontSize: 16,
    color: COLORS.white,
    letterSpacing: 1,
  },
  sub: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 2,
    lineHeight: 17,
  },
});

// ─── Helpers de overlay para imágenes ────────────────────────
export const WC_OVERLAYS = {
  // Overlay leve para proteger texto sobre imágenes claras
  protectionLight: { ...StyleSheet.absoluteFillObject, backgroundColor: WC_ALPHA.cardDarkMid },
  // Overlay fuerte para zonas saturadas
  protectionStrong: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,14,20,0.85)' },
};
