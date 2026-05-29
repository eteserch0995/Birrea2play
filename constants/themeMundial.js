// ============================================================
// Tema visual Mundial 2026 — paleta basada en branding FIFA WC 2026.
// Activo cuando useWCTheme() === true (admin siempre, resto desde 29-may).
//
// Reglas de contraste obligatorias (WCAG AA mínimo):
// - Texto CLARO (white, white90) → SOLO sobre fondos OSCUROS (bg, bgDeep, primaryDark).
// - Texto OSCURO (ink, ink70)    → SOLO sobre fondos CLAROS (white, lime, gold).
// - Validar con https://webaim.org/resources/contrastchecker/ — ratio >= 4.5:1.
//
// Paleta inspirada en el branding oficial FIFA 26 (logo dorado + bloques
// de color vibrante, estilo USA/MEX/CAN host cities).
// ============================================================

export const COLORS_WC = {
  // Fondos base
  bg:        '#0A0E14',  // negro profundo (background principal)
  bgDeep:    '#000000',  // negro absoluto (modales, overlays)
  bgCard:    '#141821',  // gris oscuro card primario
  bgCard2:   '#1C2230',  // gris oscuro card secundario
  bgLight:   '#FFFFFF',  // blanco puro (cards luminosas, hero)
  bgLight2:  '#F4F6F9',  // gris claro (cards secundarias claras)

  // Colores primarios del branding FIFA 26
  primary:        '#FF1A6B',  // magenta/rosa intenso (acento principal)
  primaryDark:    '#C40854',  // magenta oscuro
  secondary:      '#0033CC',  // azul rey FIFA
  secondaryLight: '#3D6BFF',
  accent:         '#B8FF00',  // verde lima neón
  accentDark:     '#83BD00',
  gold:           '#FFD700',  // dorado (la copa)
  goldDark:       '#C9A000',

  // Sport modes (mantener compatibilidad)
  survivor:       '#E1062C',  // rojo intenso para Survivor
  survivorLight:  '#FF2D4E',
  polla:          '#FF1A6B',  // magenta para Polla
  pollaLight:     '#FF4E8F',

  // Estados
  success:    '#23D18B',
  warning:    '#FF7A18',
  danger:     '#E1062C',
  info:       '#3D6BFF',

  // Texto sobre fondos OSCUROS (usar solo en bg, bgDeep, bgCard, bgCard2, primaryDark)
  white:      '#FFFFFF',
  white90:    'rgba(255,255,255,0.90)',
  white70:    'rgba(255,255,255,0.70)',
  white50:    'rgba(255,255,255,0.50)',

  // Texto sobre fondos CLAROS (usar solo en bgLight, bgLight2, accent, gold, accentDark)
  ink:        '#0A0E14',
  ink70:      'rgba(10,14,20,0.70)',
  ink50:      'rgba(10,14,20,0.50)',

  // Líneas y bordes
  line:       '#2A3142',
  lineLight:  '#D8DDE5',
};

export const FONTS_WC = {
  heading:      'BebasNeue_400Regular',   // bold, condensed — para títulos grandes
  body:         'Barlow_400Regular',
  bodyMedium:   'Barlow_500Medium',
  bodySemiBold: 'Barlow_600SemiBold',
  bodyBold:     'Barlow_700Bold',
};

export const SPACING_WC = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

export const RADIUS_WC = {
  sm: 6, md: 12, lg: 18, xl: 28, full: 9999,
};

export const SHADOWS_WC = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 12,
  },
  glow: {
    shadowColor: COLORS_WC.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 14,
  },
  glowGold: {
    shadowColor: COLORS_WC.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 12,
  },
};

// Gradientes sugeridos (usar con expo-linear-gradient si Codex lo agrega)
export const GRADIENTS_WC = {
  heroHost:     ['#0033CC', '#FF1A6B'],         // azul → magenta (USA/MEX/CAN)
  pollaCard:    ['#FF1A6B', '#7C3AED'],         // magenta → purple
  survivorCard: ['#E1062C', '#7C2D12'],         // rojo → marrón oscuro
  goldShine:    ['#FFD700', '#C9A000', '#FFD700'],
  fieldGreen:   ['#0F4F2A', '#1A6B3A'],         // verde cancha
};

// Helpers de contraste (para validar combos en runtime)
export const SAFE_COMBOS = {
  whiteOnDark:   { color: COLORS_WC.white, bg: COLORS_WC.bg },
  inkOnLight:    { color: COLORS_WC.ink,   bg: COLORS_WC.bgLight },
  whiteOnPrimary:{ color: COLORS_WC.white, bg: COLORS_WC.primary },
  inkOnAccent:   { color: COLORS_WC.ink,   bg: COLORS_WC.accent },
  inkOnGold:     { color: COLORS_WC.ink,   bg: COLORS_WC.gold },
  whiteOnNavy:   { color: COLORS_WC.white, bg: COLORS_WC.secondary },
};

// Combinaciones PROHIBIDAS (no usar nunca):
// - white / white90 sobre bgLight, bgLight2, accent, gold, lineLight
// - ink / ink70    sobre bg, bgDeep, bgCard, bgCard2, primaryDark, secondary
