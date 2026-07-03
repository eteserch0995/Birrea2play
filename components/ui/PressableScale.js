import React, { useRef } from 'react';
import { Animated, TouchableOpacity } from 'react-native';

// Wrapper de presión unificado: scale 0.97 en pressIn, vuelve a 1 en pressOut.
// Con gate apagado se ve igual a un TouchableOpacity normal (solo suma el scale).
// El dataSet del caller se MERGEA con el marker t2Press (no lo pisa).
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function PressableScale({
  onPress, style, children, disabled, activeOpacity = 0.85, dataSet, ...rest
}) {
  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }
  function pressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  }

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      activeOpacity={activeOpacity}
      style={[{ transform: [{ scale }] }, style]}
      dataSet={{ t2Press: '', ...(dataSet || {}) }}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}
