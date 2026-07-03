import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS, FONTS, TYPE, SPACING } from '../../constants/theme';

// Header unificado de pantalla: titulo grande + subtitulo/right/back opcionales.
// Sin background propio: vive transparente sobre el fondo de la pantalla.
export default function ScreenHeader({ title, subtitle, right, back, onBack }) {
  return (
    <View style={styles.row}>
      {back ? (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityLabel="Volver"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24">
            <Path d="M15 6L9 12L15 18" stroke={COLORS.white} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </TouchableOpacity>
      ) : null}

      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.xs,
    marginLeft: -SPACING.xs,
  },
  textWrap: { flex: 1 },
  title: {
    fontFamily: FONTS.heading,
    fontSize: TYPE.display,
    color: COLORS.white,
    letterSpacing: 1,
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: TYPE.small,
    color: COLORS.gray,
    marginTop: 2,
  },
  right: {
    marginLeft: SPACING.md,
  },
});
