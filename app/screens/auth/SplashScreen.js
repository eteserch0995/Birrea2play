import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { COLORS, FONTS } from '../../../constants/theme';

export default function SplashScreen({ navigation }) {
  const opacity = new Animated.Value(0);
  const scale = new Animated.Value(0.8);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      navigation.replace('Login');
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { opacity, transform: [{ scale }] }]}>
        <Text style={styles.logo}>PANAMA</Text>
        <Text style={styles.logoSub}>BIRREAS</Text>
        <View style={styles.line} />
        <Text style={styles.tagline}>Tu liga, tu comunidad</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoWrap: { alignItems: 'center' },
  logo: {
    fontFamily: FONTS.heading,
    fontSize: 56,
    color: COLORS.white,
    letterSpacing: 8,
  },
  logoSub: {
    fontFamily: FONTS.heading,
    fontSize: 40,
    color: COLORS.red,
    letterSpacing: 12,
    marginTop: -8,
  },
  line: {
    width: 80,
    height: 2,
    backgroundColor: COLORS.gold,
    marginVertical: 16,
  },
  tagline: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    letterSpacing: 2,
  },
});
