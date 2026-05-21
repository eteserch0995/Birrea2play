// Cross-platform date/time pickers.
// En web: usa <input type="date|time"> HTML nativo (calendario/reloj del browser,
// AM/PM según locale del usuario). En native: TextInput simple por ahora —
// migrar a @react-native-community/datetimepicker cuando se quiera nativo.
import React from 'react';
import { Platform, TextInput } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';

const isWeb = Platform.OS === 'web';

// Convierte el style array/object de RN a un style plano para input HTML.
function flattenStyle(style) {
  if (!style) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  }
  return style;
}

function WebInput({ type, value, onChange, style, placeholder, min, max, step }) {
  const s = flattenStyle(style);
  // Default styling para que se vea como los otros inputs de la app
  const merged = {
    backgroundColor: COLORS.card,
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.navy,
    borderRadius: 8,
    padding: 12,
    width: '100%',
    boxSizing: 'border-box',
    colorScheme: 'dark',  // pickers del browser en modo dark
    ...s,
  };
  return React.createElement('input', {
    type,
    value: value || '',
    onChange: (e) => onChange(e.target.value),
    style: merged,
    placeholder,
    min,
    max,
    step,
  });
}

// ── Date: YYYY-MM-DD ────────────────────────────────────────────────────────
export function DateField({ value, onChange, style, min, max, placeholder = 'YYYY-MM-DD' }) {
  if (isWeb) {
    return <WebInput type="date" value={value} onChange={onChange} style={style} placeholder={placeholder} min={min} max={max} />;
  }
  return (
    <TextInput
      style={style}
      value={value || ''}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={COLORS.gray}
      keyboardType="numbers-and-punctuation"
    />
  );
}

// ── Time: HH:MM (24h interno, browser muestra 12h con AM/PM si la locale es es-PA) ──
export function TimeField({ value, onChange, style, placeholder = 'HH:MM' }) {
  if (isWeb) {
    return <WebInput type="time" value={value} onChange={onChange} style={style} placeholder={placeholder} step={60} />;
  }
  return (
    <TextInput
      style={style}
      value={value || ''}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={COLORS.gray}
      keyboardType="numbers-and-punctuation"
    />
  );
}
