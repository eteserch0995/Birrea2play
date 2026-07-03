import { isModo26Active } from '../lib/modo26';

// BUMP OBLIGATORIO EN CADA DEPLOY donde solo cambien chunks lazy (paneles).
// Gotcha 2026-07-02: Metro reusa el nombre del bundle principal (index-<hash>.js)
// aunque cambien las referencias a chunks; con Cache-Control immutable, los
// browsers quedan apuntando a chunks del deploy anterior (404 -> panel roto).
// Cambiar este valor fuerza contenido nuevo en el grafo principal -> nombre nuevo.
export const BUILD_STAMP = '2026-07-02.6';

const MUNDIAL_THEME_START_MS = Date.UTC(2026, 4, 29, 5, 0, 0); // 2026-05-29 00:00 PA
const MUNDIAL_THEME_END_MS = Date.UTC(2026, 6, 20, 5, 0, 0); // 2026-07-20 00:00 PA

function isMundialThemeWindow() {
  const now = Date.now();
  return now >= MUNDIAL_THEME_START_MS && now < MUNDIAL_THEME_END_MS;
}

const BASE_COLORS = {
  bg: '#07080B',
  bg2: '#101318',
  navy: '#1B2230',
  blue: '#1E3A8A',
  blue2: '#2563EB',
  red: '#E1062C',
  red2: '#FF2D4E',
  magenta: '#FF1E78',
  purple: '#4C1D95',
  purple2: '#7C3AED',
  gold: '#D6FF2F',
  gold2: '#F8FF7A',
  white: '#FFFFFF',
  gray: '#7F8794',
  gray2: '#C6CBD3',
  card: '#11151C',
  card2: '#171C24',
  green: '#23D18B',
  asphalt: '#0B0D10',
  line: '#2A323F',
  neon: '#D6FF2F',
  orange: '#FF7A18',
  // Token A11y: magenta legible sobre fondo oscuro (ratio ≥4.5:1)
  magentaText: '#FF5C97',
};

const MUNDIAL_COLORS = {
  bg: '#0A0E14',
  bg2: '#111827',
  navy: '#0033CC',
  blue: '#2457FF',
  blue2: '#72A7FF',
  red: '#E1062C',
  red2: '#FF3B1F',
  magenta: '#FF1A6B',
  purple: '#6E22FF',
  purple2: '#9B6DFF',
  gold: '#FFD700',
  gold2: '#FFE766',
  white: '#FFFFFF',
  gray: '#8C96A8',
  gray2: '#D7DCE6',
  card: '#141821',
  card2: '#1C2230',
  green: '#23D18B',
  asphalt: '#05070B',
  line: '#2F384A',
  neon: '#B8FF00',
  orange: '#FF7A18',
  // Tokens A11y (validados por agentes 01/04 - WCAG AA pass):
  magentaA11y:  '#C4004D',  // magenta sobre blanco con ratio 4.7:1 (vs 3.9:1 original)
  red2A11y:     '#D42200',  // rojo sobre blanco con ratio 5.1:1 (vs 3.2:1 original)
  lineVisible:  '#556070',  // borde/icono visible sobre bg oscuro con ratio 3.2:1
  magentaText:  '#FF5C97',  // magenta WCAG AA sobre fondo oscuro (ratio ≥4.5:1)
};

const MODO26_COLORS = {
  bg: '#0D0D1F',
  bg2: '#16162B',
  navy: '#1E3AAD',
  blue: '#2D5BFF',
  blue2: '#6E8CFF',
  red: '#FF3B4E',
  red2: '#FF5566',
  magenta: '#2D5BFF',
  purple: '#6E5BFF',
  purple2: '#9B8CFF',
  gold: '#FFC93C',
  gold2: '#FFD96B',
  white: '#F7F5F0',
  gray: '#9C9CB8',
  gray2: '#C8C8DC',
  card: '#16162B',
  card2: '#1F1F38',
  green: '#00C865',
  asphalt: '#0A0A18',
  line: '#2A2A45',
  neon: '#00C865',
  orange: '#FF7A18',
  magentaA11y: '#2D5BFF',
  red2A11y: '#E0263C',
  lineVisible: '#3A3A5A',
  magentaText: '#6E8CFF',
};

export const COLORS = isModo26Active() ? MODO26_COLORS : (isMundialThemeWindow() ? MUNDIAL_COLORS : BASE_COLORS);

const FONTS_BASE = {
  heading: 'BebasNeue_400Regular',
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodySemiBold: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
};

const FONTS_MODO26 = {
  heading: 'Anton_400Regular',
  body: 'Archivo_400Regular',
  bodyMedium: 'Archivo_500Medium',
  bodySemiBold: 'Archivo_600SemiBold',
  bodyBold: 'Archivo_700Bold',
};

export const FONTS = isModo26Active() ? FONTS_MODO26 : FONTS_BASE;

export const GRAD_TRI = ['#00C865', '#2D5BFF', '#FF3B4E'];

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const RADIUS = isMundialThemeWindow() ? {
  sm: 6,
  md: 12,
  lg: 18,
  xl: 24,
  full: 9999,
} : {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  full: 9999,
};

export const SHADOWS = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isMundialThemeWindow() ? 0.45 : 0.38,
    shadowRadius: isMundialThemeWindow() ? 18 : 16,
    elevation: isMundialThemeWindow() ? 12 : 10,
  },
  glow: {
    shadowColor: isModo26Active() ? '#2D5BFF' : (isMundialThemeWindow() ? '#FF1A6B' : '#E1062C'),
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: isMundialThemeWindow() ? 0.36 : 0.28,
    shadowRadius: isMundialThemeWindow() ? 22 : 18,
    elevation: isMundialThemeWindow() ? 14 : 12,
  },
};
