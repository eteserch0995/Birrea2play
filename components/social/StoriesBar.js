// Barra horizontal de HISTORIAS (estilo Instagram).
//
// Primer circulo = "Tu historia" con un + para publicar. Luego cada usuario con su
// foto de perfil y un anillo: gradiente colorido = historia sin ver, gris = ya vista.
// Solo tokens de theme.js para los avatares; el anillo usa el gradiente clasico de
// historias para que se lea como tal.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import BeltRingOverlay from './BeltRingOverlay';

const RING_UNSEEN = ['#F9CE34', '#EE2A7B', '#6228D7']; // gradiente clasico de historias
const RING_SEEN = [COLORS.line, COLORS.line];

function StoryCircle({ story, onPress }) {
  const hasStory = (story.items?.length ?? 0) > 0;
  const ring = story.isYou
    ? (hasStory ? RING_UNSEEN : [COLORS.line, COLORS.line])
    : (story.seen ? RING_SEEN : RING_UNSEEN);

  return (
    <TouchableOpacity style={styles.item} activeOpacity={0.85} onPress={onPress}>
      <LinearGradient colors={ring} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring}>
        <View style={styles.ringGap}>
          <View style={[styles.avatar, { backgroundColor: story.tone ?? COLORS.navy }]}>
            <Text style={styles.avatarText}>{story.initial}</Text>
          </View>
        </View>
      </LinearGradient>

      {story.isYou && (
        <View style={styles.plusBadge}>
          <Text style={styles.plusText}>+</Text>
        </View>
      )}

      {story.belt ? <BeltRingOverlay belt={story.belt} /> : null}

      <Text style={styles.username} numberOfLines={1}>{story.username}</Text>
    </TouchableOpacity>
  );
}

export default function StoriesBar({ stories, onPressStory, onPressAdd }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {stories.map((s, i) => (
        <StoryCircle
          key={s.id}
          story={s}
          onPress={() => {
            if (s.isYou && (s.items?.length ?? 0) === 0) onPressAdd();
            else onPressStory(i);
          }}
        />
      ))}
    </ScrollView>
  );
}

const RING = 70;
const GAP = RING - 6;
const AV = RING - 12;

const styles = StyleSheet.create({
  row: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.md },
  item: { width: RING + 6, alignItems: 'center' },
  ring: { width: RING, height: RING, borderRadius: RING / 2, alignItems: 'center', justifyContent: 'center' },
  ringGap: { width: GAP, height: GAP, borderRadius: GAP / 2, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: AV, height: AV, borderRadius: AV / 2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  plusBadge: {
    position: 'absolute', top: RING - 20, right: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.neon, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.bg,
  },
  plusText: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.bg, lineHeight: 17 },
  username: { marginTop: 5, fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2, maxWidth: RING + 4, textAlign: 'center' },
});
