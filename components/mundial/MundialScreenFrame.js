import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

const mundialBg = require('../../assets/mundial/mundial-bg.png');

export default function MundialScreenFrame({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <Image
        source={mundialBg}
        resizeMode="stretch"
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ECFFB9',
  },
});
