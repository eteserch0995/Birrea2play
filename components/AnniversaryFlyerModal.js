import React from 'react';
import {
  Image, Modal, StyleSheet, TouchableOpacity, View,
  useWindowDimensions,
} from 'react-native';

const flyer = require('../assets/anniversary-flyer.png');

export default function AnniversaryFlyerModal({ visible, onDismiss }) {
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
          <Image source={flyer} style={styles.image} resizeMode="contain" />
          <TouchableOpacity
            style={styles.close}
            onPress={onDismiss}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Cerrar aviso de aniversario"
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
  image: {
    width: '100%',
    height: '100%',
  },
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
