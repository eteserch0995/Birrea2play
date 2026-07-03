import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS, FONTS, TYPE, SPACING, RADIUS } from '../../constants/theme';

// Input unificado con label arriba, foco visible y error inline.
export default function Field({ label, error, style, onFocus, onBlur, ...rest }) {
  const [focused, setFocused] = useState(false);

  function handleFocus(e) {
    setFocused(true);
    onFocus?.(e);
  }
  function handleBlur(e) {
    setFocused(false);
    onBlur?.(e);
  }

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          error && styles.inputError,
          style,
        ]}
        placeholderTextColor={COLORS.gray}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  label: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: TYPE.caption,
    color: COLORS.gray,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.bg2,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontFamily: FONTS.body,
    fontSize: TYPE.body,
    color: COLORS.white,
  },
  inputFocused: {
    borderColor: COLORS.blue2,
    borderWidth: 2,
  },
  inputError: {
    borderColor: COLORS.red2,
  },
  error: {
    fontFamily: FONTS.body,
    fontSize: TYPE.small,
    color: COLORS.red2,
    marginTop: SPACING.xs,
  },
});
