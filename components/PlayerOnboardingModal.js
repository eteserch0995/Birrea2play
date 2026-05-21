import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../constants/theme';

const SALIX_AVATAR = require('../assets/Salix.png');

const STEPS = [
  {
    icon: '🎽',
    title: 'Tu perfil de jugador',
    body: 'Después del registro entras como jugador. Completa nombre, teléfono, residencia, deportes, nivel y posición para que los gestores puedan ubicarte mejor en cada birrea.',
    bullets: ['Perfil → Editar perfil', 'Agrega foto y deportes', 'Mantén tus datos al día'],
  },
  {
    icon: '📅',
    title: 'Encuentra eventos',
    body: 'En Eventos ves ligas, torneos y amistosos disponibles. Filtra por categoría, abre el detalle y revisa fecha, cancha, precio, cupos y jugadores inscritos.',
    bullets: ['Toca un evento para ver detalles', 'Revisa cupos antes de pagar', 'Puedes cancelar desde el detalle'],
  },
  {
    icon: '💳',
    title: 'Créditos y pagos',
    body: 'Los créditos internos sirven para inscribirte rápido a eventos y servicios. Puedes comprarlos con Yappy o tarjeta, o pagar algunos eventos directamente según disponibilidad.',
    bullets: ['Créditos → Comprar', 'Consulta historial de movimientos', 'Usa créditos para inscripciones'],
  },
  {
    icon: '🛍',
    title: 'Compra en tienda',
    body: 'En Tienda encuentras ropa, accesorios y equipamiento. Abre un producto, revisa imagen, precio, stock y talla si aplica, luego agrégalo al carrito.',
    bullets: ['Tienda → elegir producto', 'Selecciona talla cuando aplique', 'Carrito → confirma tu pedido'],
  },
  {
    icon: '🤖',
    title: 'IA y ayuda',
    body: 'La pestaña IA te ayuda con dudas sobre inscripciones, pagos, créditos, tienda y reglas de uso. También puedes revisar Noticias para resultados, MVPs y comunicados.',
    bullets: ['IA para preguntas rápidas', 'Noticias para novedades', 'Perfil para configuración'],
  },
];

export default function PlayerOnboardingModal({ visible, userName, onFinish }) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const firstName = useMemo(() => userName?.split(' ')?.[0] ?? 'jugador', [userName]);

  function next() {
    if (isLast) {
      onFinish?.();
      return;
    }
    setIndex((i) => i + 1);
  }

  function back() {
    setIndex((i) => Math.max(0, i - 1));
  }

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={SALIX_AVATAR} style={styles.avatar} />
            <View>
              <Text style={styles.kicker}>PRIMER RECORRIDO</Text>
              <Text style={styles.brand}>Birrea2Play</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onFinish} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skip}>Saltar</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.welcome}>Bienvenido, {firstName}</Text>
          <View style={styles.progressRow}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.progressDot, i <= index && styles.progressDotOn]} />
            ))}
          </View>

          <View style={styles.card}>
            <View style={styles.iconBadge}>
              <Text style={styles.icon}>{step.icon}</Text>
            </View>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.body}</Text>

            <View style={styles.bullets}>
              {step.bullets.map((item) => (
                <View key={item} style={styles.bulletRow}>
                  <Text style={styles.bulletMark}>•</Text>
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.secondaryBtn, index === 0 && styles.disabledBtn]}
            onPress={back}
            disabled={index === 0}
          >
            <Text style={styles.secondaryText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={next}>
            <Text style={styles.primaryText}>{isLast ? 'Empezar' : 'Siguiente'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: COLORS.neon },
  kicker: { fontFamily: FONTS.bodyBold, color: COLORS.neon, fontSize: 10, letterSpacing: 1.4 },
  brand: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 24, letterSpacing: 2 },
  skip: { fontFamily: FONTS.bodyBold, color: COLORS.gray2, fontSize: 13 },
  content: { padding: SPACING.md, paddingBottom: SPACING.xl },
  welcome: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 38, letterSpacing: 1, marginTop: SPACING.sm },
  progressRow: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm, marginBottom: SPACING.lg },
  progressDot: { flex: 1, height: 4, borderRadius: 4, backgroundColor: COLORS.line },
  progressDotOn: { backgroundColor: COLORS.neon },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: SPACING.xl,
    ...SHADOWS.card,
  },
  iconBadge: {
    width: 66,
    height: 66,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.neon + '14',
    borderWidth: 1,
    borderColor: COLORS.neon + '55',
    marginBottom: SPACING.lg,
  },
  icon: { fontSize: 34 },
  title: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 32, letterSpacing: 1, marginBottom: SPACING.sm },
  body: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 15, lineHeight: 23 },
  bullets: { gap: SPACING.sm, marginTop: SPACING.lg },
  bulletRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start' },
  bulletMark: { fontFamily: FONTS.bodyBold, color: COLORS.neon, fontSize: 18, lineHeight: 20 },
  bulletText: { flex: 1, fontFamily: FONTS.bodySemiBold, color: COLORS.white, fontSize: 14, lineHeight: 20 },
  footer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  secondaryBtn: {
    flex: 0.8,
    minHeight: 50,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
  },
  disabledBtn: { opacity: 0.35 },
  secondaryText: { fontFamily: FONTS.bodyBold, color: COLORS.gray2, fontSize: 14 },
  primaryBtn: {
    flex: 1.2,
    minHeight: 50,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.red,
  },
  primaryText: { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 17, letterSpacing: 2 },
});
