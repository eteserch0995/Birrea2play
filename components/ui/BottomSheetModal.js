import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COLORS, FONTS, TYPE, SPACING, RADIUS } from '../../constants/theme';

// Bottom sheet unificado (patron de PaymentModal/RecargasModal, formalizado).
// El boton cerrar (X) SIEMPRE visible ademas del backdrop, por accesibilidad.
export default function BottomSheetModal({
  visible, onClose, title, subtitle, children, footer, dismissOnBackdrop = true,
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={dismissOnBackdrop ? onClose : undefined}
        />
        <View style={styles.sheet} dataSet={{ t2Glass: '' }}>
          <View style={styles.handle} />

          {(title || subtitle) && (
            <View style={styles.header}>
              <View style={styles.headerText}>
                {title ? <Text style={styles.title}>{title}</Text> : null}
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                accessibilityLabel="Cerrar"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24">
                  <Path d="M6 6L18 18M18 6L6 18" stroke={COLORS.gray2} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>
          )}

          {!(title || subtitle) && (
            <TouchableOpacity
              style={[styles.closeBtn, styles.closeBtnFloating]}
              onPress={onClose}
              accessibilityLabel="Cerrar"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path d="M6 6L18 18M18 6L6 18" stroke={COLORS.gray2} strokeWidth={2} strokeLinecap="round" />
              </Svg>
            </TouchableOpacity>
          )}

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.card2,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    position: 'relative',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.line,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  headerText: { flex: 1, paddingRight: SPACING.md },
  title: {
    fontFamily: FONTS.heading,
    fontSize: TYPE.h2,
    color: COLORS.white,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: FONTS.body,
    fontSize: TYPE.small,
    color: COLORS.gray,
    marginTop: 2,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnFloating: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
  },
  scroll: { maxHeight: '85%' },
  footer: { marginTop: SPACING.md },
});
