import React from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

const mundialBg = require('../../assets/mundial/mundial-bg.png');

export default function MundialScreenFrame({ children, style }) {
  return (
    <View style={[styles.root, style]}>
      <ImageBackground
        source={mundialBg}
        resizeMode="contain"
        style={StyleSheet.absoluteFill}
        imageStyle={styles.image}
      >
      </ImageBackground>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ECFFB9',
  },
  image: {
    opacity: 1,
  },
});
