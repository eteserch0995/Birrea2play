import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../constants/theme';

/**
 * PlayerAvatar
 * Props: user { nombre, foto_url }, size (default 44), borderColor
 */
export default function PlayerAvatar({ user, size = 44, borderColor = COLORS.navy }) {
  const half = size / 2;

  if (user?.foto_url) {
    return (
      <Image
        source={{ uri: user.foto_url }}
        style={{
          width: size, height: size, borderRadius: half,
          borderWidth: 2, borderColor,
        }}
      />
    );
  }

  return (
    <View style={[styles.placeholder, { width: size, height: size, borderRadius: half, borderColor }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>
        {user?.nombre?.[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  initial: { fontFamily: FONTS.heading, color: COLORS.white },
});
