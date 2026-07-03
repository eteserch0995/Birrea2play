// Boton de entrada al PREVIEW del muro social. Unico punto de entrada.
//
// Se renderiza SOLO si isSocialPreviewEnabled(user). Se monta con una linea dentro
// de app/admin/AdminPanel.js (que ya es admin-only). NO hay FAB ni entrada en el Home,
// asi HomeScreen.js queda byte-identico. Quitar esta linea oculta el preview sin tocar
// nada mas.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import useAuthStore from '../../store/authStore';
import { isSocialPreviewEnabled } from '../../lib/featureFlags';

export default function SocialPreviewLauncher() {
  const navigation = useNavigation();
  const { user } = useAuthStore();

  if (!isSocialPreviewEnabled(user)) return null;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('SocialPreview')}
    >
      <Text style={styles.icon}>⚽</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>PREVIEW · NO PRODUCTIVO</Text>
        <Text style={styles.title}>HISTORIAS (24h)</Text>
        <Text style={styles.sub}>Mock data · gateado · no toca el Home</Text>
      </View>
      <Text style={styles.arrow}>→</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.bg2,
    borderWidth: 1.5,
    borderColor: COLORS.neon,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  icon: { fontSize: 28, width: 40, textAlign: 'center' },
  kicker: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.neon, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 2 },
  title: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 1 },
  sub: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  arrow: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.neon },
});
