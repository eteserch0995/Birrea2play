import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../constants/theme';
import PressableScale from './PressableScale';

// Superficie base del rediseño. variant='glass'/'holo' solo cambian look con
// el gate tema2 encendido (dataSet); con gate apagado siempre es la card solida actual.
export default function Card({
  children, variant = 'solid', glow, padding = SPACING.md, onPress, style, ...rest
}) {
  const isGlass = variant === 'glass' || variant === 'holo';
  const isHolo = variant === 'holo';

  const glowStyle = glow === 'subtle' ? SHADOWS.glowSubtle
    : glow === 'mid' ? SHADOWS.glow
    : glow === 'hero' ? SHADOWS.glowHero
    : null;

  const dataSet = {
    ...(isGlass ? { t2Glass: '' } : {}),
    ...(isHolo ? { t2Holo: 'auto', t2Tilt: '' } : {}),
    ...(glow ? { t2Glow: glow } : {}),
  };

  const content = (
    <View
      style={[
        styles.base,
        { padding },
        glowStyle,
        isGlass && styles.relativeOverflow,
        style,
      ]}
      dataSet={dataSet}
      {...rest}
    >
      {children}
    </View>
  );

  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={styles.pressWrap}>
        {content}
      </PressableScale>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  relativeOverflow: {
    position: 'relative',
    overflow: 'hidden',
  },
  pressWrap: {
    // el spring de scale vive en PressableScale; esta card solo aporta el layout base
  },
});
