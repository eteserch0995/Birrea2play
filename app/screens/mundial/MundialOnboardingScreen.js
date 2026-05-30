import React, { useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Dimensions, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCButton, WCBadge } from '../../../components/mundial/WCComponents';

const { width: SW } = Dimensions.get('window');
const ONBOARDED_KEY = 'wc_onboarded_v1';

const SLIDES = [
  {
    kicker: 'BIENVENIDO A',
    title: 'MUNDIAL 2026',
    body: 'Pronósticos del Mundial 2026 en USA · México · Canadá. Inscribite a Survivor o Polla, gana puntos por aciertos y llevate el pozo.',
    icon: '🏆',
    accent: 'gold',
  },
  {
    kicker: '2 MODOS DE JUEGO',
    title: 'ELEGÍ TU ESTILO',
    body: 'Survivor: $10, 3 vidas, pick 1 equipo por día durante fase de grupos. Polla: $15, predice todos los marcadores + bracket completo; el pozo se reparte entre los 3 primeros (60/25/15).',
    icon: '⚽',
    accent: 'magenta',
  },
  {
    kicker: 'IMPORTANTE',
    title: 'CIERRE 11 JUN 11AM',
    body: 'Tenés que llenar TODA la polla (72 grupos + 32 bracket + 5 bonus) antes del 11 jun 11am Panamá. Después del cierre nada se puede modificar.',
    icon: '⏰',
    accent: 'neon',
  },
];

export default function MundialOnboardingScreen({ navigation }) {
  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);

  const goNext = async () => {
    if (page < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: SW * (page + 1), animated: true });
      setPage(page + 1);
    } else {
      await AsyncStorage.setItem(ONBOARDED_KEY, '1');
      navigation.replace('MundialHome');
    }
  };

  const skip = async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    navigation.replace('MundialHome');
  };

  return (
    <MundialScreenFrame>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={skip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skip}>Saltar →</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SW))}
          style={styles.scroll}
        >
          {SLIDES.map((s, i) => (
            <View key={i} style={[styles.slide, { width: SW }]}>
              <Text style={styles.icon}>{s.icon}</Text>
              <WCBadge label={s.kicker} tone={s.accent} size="md" />
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.footer}>
          <WCButton
            label={page < SLIDES.length - 1 ? 'SIGUIENTE' : 'EMPEZAR'}
            variant={page < SLIDES.length - 1 ? 'primary' : 'secondary'}
            size="lg"
            onPress={goNext}
          />
        </View>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

export async function shouldShowOnboarding() {
  try {
    const v = await AsyncStorage.getItem(ONBOARDED_KEY);
    return v !== '1';
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
  },
  skip: {
    fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gray2,
  },
  scroll: { flex: 1 },
  slide: {
    paddingHorizontal: SPACING.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  icon: { fontSize: 72, marginBottom: SPACING.lg },
  title: {
    fontFamily: FONTS.heading, fontSize: 36, color: COLORS.white,
    letterSpacing: 2, textAlign: 'center', marginTop: SPACING.md,
  },
  body: {
    fontFamily: FONTS.body, fontSize: 15, color: COLORS.gray2,
    textAlign: 'center', lineHeight: 22, marginTop: SPACING.md,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingVertical: SPACING.md,
  },
  dot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.line,
  },
  dotActive: { width: 24, backgroundColor: COLORS.neon },
  footer: {
    paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xl,
  },
});
