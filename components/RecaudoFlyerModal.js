import React from 'react';
import {
  Image, Modal, StyleSheet, TouchableOpacity, View,
  useWindowDimensions,
} from 'react-native';

// Flyer vertical de arranque — Recaudo Solidario (Venezuela).
// Reemplaza el flyer de aniversario. Tocar la imagen lleva a la campaña.
const flyer = require('../assets/recaudo-flyer.png');

export default function RecaudoFlyerModal({ visible, onDismiss, onOpen }) {
  const { width, height } = useWindowDimensions();
  const maxWidth = Math.min(width - 24, 560);
  const maxHeight = height - 48;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { width: maxWidth, height: maxHeight }]}>
          <TouchableOpacity
            style={styles.imageWrap}
            activeOpacity={0.9}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel="Abrir el Recaudo Solidario por Venezuela"
          >
            <Image source={flyer} style={styles.image} resizeMode="contain" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cta}
            activeOpacity={0.85}
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel="Quiero donar"
          >
            <View style={styles.ctaInner} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.close}
            onPress={onDismiss}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Cerrar aviso"
          >
            <View style={styles.closeLineA} />
            <View style={styles.closeLineB} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  card: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
  // Banda invisible inferior para reforzar el tap "quiero donar" sobre el botón impreso del flyer.
  cta: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  ctaInner: { flex: 1 },
  close: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLineA: {
    position: 'absolute',
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
  },
  closeLineB: {
    position: 'absolute',
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '-45deg' }],
  },
});
