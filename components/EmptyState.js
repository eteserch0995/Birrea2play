import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

// Estado vacio/error unificado (patron del emptyBox de HomeScreen).
// icon: string emoji del caller (mantiene el lenguaje visual existente).
// onAction + actionLabel opcionales para reintentar/CTA.
export default function EmptyState({ icon, title, subtitle, actionLabel, onAction, style }) {
  return (
    <View style={[styles.box, style]}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.btn} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.line,
    marginHorizontal: SPACING.md,
  },
  icon: {
    fontSize: 40,
    marginBottom: SPACING.sm,
  },
  title: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
    color: COLORS.gray2,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: 4,
  },
  btn: {
    marginTop: SPACING.md,
    minHeight: 44,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
    backgroundColor: COLORS.neon + '14',
    borderWidth: 1,
    borderColor: COLORS.neon + '55',
    borderRadius: RADIUS.full,
  },
  btnText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.neon,
    letterSpacing: 0.5,
  },
});
