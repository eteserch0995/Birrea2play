import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Linking,
  Animated, Dimensions, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';

const SALIX_AVATAR = require('../../../../assets/salix.png');

const { width: SCREEN_W } = Dimensions.get('window');
const FUNCTIONS_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';
const ANON_KEY      = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TOUR_SEEN_KEY = 'birrea_tour_seen_v1';

// ── Tour steps ──────────────────────────────────────────────────────────────
const TOUR_STEPS = [
  {
    icon:  '👋',
    title: '¡Bienvenido a Birrea2Play!',
    body:  'La app para encontrar, unirte y organizar eventos deportivos en Panamá. Te hacemos un recorrido rápido para que saques el máximo provecho.',
  },
  {
    icon:  '📅',
    title: 'Eventos',
    body:  'En la pestaña Eventos encontrarás torneos, ligas y amistosos de fútbol, pádel, basketball y más. Filtra por deporte y únete con un solo toque.',
  },
  {
    icon:  '💰',
    title: 'Tu Wallet',
    body:  'Recarga tu saldo con Yappy o tarjeta y úsalo para inscribirte a eventos. También puedes pagar directamente con Yappy sin recargar primero.',
  },
  {
    icon:  '🛒',
    title: 'Tienda',
    body:  'Compra ropa, accesorios y equipamiento deportivo directamente en la app. Los pedidos se coordinan con el equipo Birrea2Play.',
  },
  {
    icon:  '👤',
    title: 'Tu Perfil',
    body:  'Personaliza tu perfil, selecciona tus deportes favoritos y tu posición. Si quieres organizar tus propios eventos, solicita ser Gestor desde el perfil.',
  },
  {
    icon:  '🦅',
    title: '¡Salix está listo para ayudarte!',
    body:  'Soy Salix, tu asistente virtual de Panamá Birreas. Puedes preguntarme cómo inscribirte, recargar, usar la tienda o lo que necesites.',
  },
];

// ── Suggested questions ─────────────────────────────────────────────────────
const SUGGESTED = [
  '¿Cómo me inscribo a un evento?',
  '¿Cómo recargo mi wallet con Yappy?',
  '¿Cómo cancelo una inscripción?',
  '¿Qué es un Gestor?',
  '¿Cómo pago con tarjeta?',
];

// ── Escalation contacts ─────────────────────────────────────────────────────
const SUPPORT_WHATSAPP = 'https://wa.me/50761222854';
const SUPPORT_EMAIL    = 'mailto:admin@birrea2play.com';

export default function AssistantScreen() {
  const [mode,       setMode]       = useState('loading'); // 'loading' | 'tour' | 'chat'
  const [tourStep,   setTourStep]   = useState(0);
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState('');
  const [aiLoading,  setAiLoading]  = useState(false);
  const scrollRef  = useRef(null);
  const slideAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkTourSeen();
  }, []);

  async function checkTourSeen() {
    try {
      const seen = await AsyncStorage.getItem(TOUR_SEEN_KEY);
      if (seen) {
        setMode('chat');
        addWelcomeMessage();
      } else {
        setMode('tour');
      }
    } catch {
      setMode('chat');
      addWelcomeMessage();
    }
  }

  function addWelcomeMessage() {
    setMessages([{
      role:    'assistant',
      content: '¡Hola! Soy Salix, tu asistente virtual de Panamá Birreas 🦅\n\n¿En qué te puedo ayudar hoy? Puedes preguntarme sobre eventos, pagos, la tienda o cualquier función de la app.',
    }]);
  }

  // ── Tour logic ──────────────────────────────────────────────────────────────
  function animateStep(dir) {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: dir * -30, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0,         duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function nextStep() {
    if (tourStep < TOUR_STEPS.length - 1) {
      animateStep(1);
      setTourStep((s) => s + 1);
    } else {
      finishTour();
    }
  }

  function prevStep() {
    if (tourStep > 0) {
      animateStep(-1);
      setTourStep((s) => s - 1);
    }
  }

  async function finishTour() {
    await AsyncStorage.setItem(TOUR_SEEN_KEY, '1').catch(() => {});
    setMode('chat');
    addWelcomeMessage();
  }

  // ── Chat logic ──────────────────────────────────────────────────────────────
  const sendMessage = async (text) => {
    const userText = (text ?? input).trim();
    if (!userText || aiLoading) return;
    setInput('');

    const newMessages = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setAiLoading(true);

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${FUNCTIONS_URL}/ai-chat`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        ANON_KEY,
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error del asistente');

      setMessages((prev) => [...prev, { role: 'assistant', content: json.reply }]);
    } catch (e) {
      setMessages((prev) => [...prev, {
        role:    'assistant',
        content: 'Lo siento, no pude conectarme en este momento. Por favor intenta de nuevo o contacta soporte.',
      }]);
    } finally {
      setAiLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  // ── Render: loading ─────────────────────────────────────────────────────────
  if (mode === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={COLORS.red} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  // ── Render: tour ────────────────────────────────────────────────────────────
  if (mode === 'tour') {
    const step = TOUR_STEPS[tourStep];
    const isLast = tourStep === TOUR_STEPS.length - 1;

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.tourHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
            <Image source={SALIX_AVATAR} style={{ width: 36, height: 36, borderRadius: 18 }} />
            <Text style={styles.tourHeaderTitle}>SALIX</Text>
          </View>
          <TouchableOpacity onPress={finishTour}>
            <Text style={styles.tourSkip}>Saltar tour</Text>
          </TouchableOpacity>
        </View>

        {/* Progress dots */}
        <View style={styles.dots}>
          {TOUR_STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === tourStep && styles.dotActive]} />
          ))}
        </View>

        {/* Card */}
        <Animated.View style={[styles.tourCard, { transform: [{ translateX: slideAnim }] }]}>
          <Text style={styles.tourIcon}>{step.icon}</Text>
          <Text style={styles.tourTitle}>{step.title}</Text>
          <Text style={styles.tourBody}>{step.body}</Text>
        </Animated.View>

        {/* Navigation */}
        <View style={styles.tourNav}>
          <TouchableOpacity
            style={[styles.tourBtn, { opacity: tourStep === 0 ? 0 : 1 }]}
            onPress={prevStep}
            disabled={tourStep === 0}
          >
            <Text style={styles.tourBtnText}>← Anterior</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tourBtn, styles.tourBtnPrimary]}
            onPress={nextStep}
          >
            <Text style={[styles.tourBtnText, { color: COLORS.white }]}>
              {isLast ? '¡Empezar! 🚀' : 'Siguiente →'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: chat ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Header */}
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderLeft}>
            <Image source={SALIX_AVATAR} style={styles.salixAvatar} />
            <View>
              <Text style={styles.chatHeaderName}>Salix</Text>
              <Text style={styles.chatHeaderSub}>Asistente de Panamá Birreas</Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => { setTourStep(0); setMode('tour'); }}>
            <Text style={styles.tourRepeat}>Ver tour</Text>
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAI]}>
              {m.role === 'assistant' && (
                <Image source={SALIX_AVATAR} style={styles.bubbleAvatar} />
              )}
              <Text style={[styles.bubbleText, m.role === 'user' && styles.bubbleTextUser]}>
                {m.content}
              </Text>
            </View>
          ))}

          {aiLoading && (
            <View style={[styles.bubble, styles.bubbleAI]}>
              <Image source={SALIX_AVATAR} style={styles.bubbleAvatar} />
              <ActivityIndicator color={COLORS.gray} size="small" />
            </View>
          )}

          {/* Suggested questions — shown only at start */}
          {messages.length <= 1 && !aiLoading && (
            <View style={styles.suggestedBox}>
              <Text style={styles.suggestedTitle}>Preguntas frecuentes</Text>
              {SUGGESTED.map((q, i) => (
                <TouchableOpacity key={i} style={styles.suggestedChip} onPress={() => sendMessage(q)}>
                  <Text style={styles.suggestedText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Human escalation — shown after 3+ messages */}
          {messages.length >= 3 && (
            <View style={styles.escalationBox}>
              <Text style={styles.escalationTitle}>¿Necesitas hablar con una persona?</Text>
              <View style={styles.escalationBtns}>
                <TouchableOpacity
                  style={[styles.escalationBtn, { backgroundColor: '#25D366' }]}
                  onPress={() => Linking.openURL(SUPPORT_WHATSAPP)}
                >
                  <Text style={styles.escalationBtnText}>💬 WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.escalationBtn, { backgroundColor: COLORS.blue }]}
                  onPress={() => Linking.openURL(SUPPORT_EMAIL)}
                >
                  <Text style={styles.escalationBtnText}>📧 Email</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.chatInput}
            placeholder="Escribe tu pregunta..."
            placeholderTextColor={COLORS.gray}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={500}
            onSubmitEditing={() => sendMessage()}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || aiLoading) && { opacity: 0.4 }]}
            onPress={() => sendMessage()}
            disabled={!input.trim() || aiLoading}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },

  // ── Tour ──────────────────────────────────────────────────────────────────
  tourHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm,
  },
  tourHeaderTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 3 },
  tourSkip:        { fontFamily: FONTS.body, color: COLORS.gray, fontSize: 14 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: SPACING.xl },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.navy,
  },
  dotActive: { backgroundColor: COLORS.red, width: 24 },

  tourCard: {
    flex: 1,
    marginHorizontal: SPACING.xl,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.xl ?? 20,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.navy,
    gap: SPACING.lg,
  },
  tourIcon:  { fontSize: 64 },
  tourTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 2, textAlign: 'center' },
  tourBody:  { fontFamily: FONTS.body, fontSize: 15, color: COLORS.gray2, textAlign: 'center', lineHeight: 24 },

  tourNav: {
    flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md,
    padding: SPACING.lg,
  },
  tourBtn: {
    flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.navy, backgroundColor: COLORS.card,
  },
  tourBtnPrimary: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  tourBtnText:    { fontFamily: FONTS.bodyMedium, fontSize: 15, color: COLORS.gray2 },

  // ── Chat ──────────────────────────────────────────────────────────────────
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.navy,
  },
  chatHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  salixAvatar: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: COLORS.gold,
  },
  bubbleAvatar: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.gold + '66',
  },
  chatHeaderName: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white, letterSpacing: 1 },
  chatHeaderSub:  { fontFamily: FONTS.body, fontSize: 11, color: COLORS.green },
  tourRepeat:     { fontFamily: FONTS.body, color: COLORS.gold, fontSize: 13 },

  chatScroll:  { flex: 1 },
  chatContent: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },

  bubble: {
    maxWidth: '85%',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.blue,
    borderBottomRightRadius: 4,
  },
  bubbleAI: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.navy,
    borderBottomLeftRadius: 4,
  },
  bubbleText:    { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2, lineHeight: 20 },
  bubbleTextUser:{ color: COLORS.white },

  suggestedBox:   { gap: SPACING.sm, marginTop: SPACING.sm },
  suggestedTitle: { fontFamily: FONTS.bodyMedium, color: COLORS.gray, fontSize: 12 },
  suggestedChip: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.navy,
  },
  suggestedText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 13 },

  escalationBox: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md,
    borderWidth: 1, borderColor: COLORS.gold + '44', gap: SPACING.sm, marginTop: SPACING.sm,
  },
  escalationTitle: { fontFamily: FONTS.bodyMedium, color: COLORS.gray2, fontSize: 13, textAlign: 'center' },
  escalationBtns:  { flexDirection: 'row', gap: SPACING.sm },
  escalationBtn: {
    flex: 1, padding: SPACING.sm, borderRadius: RADIUS.md, alignItems: 'center',
  },
  escalationBtnText: { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm,
    padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.navy,
  },
  chatInput: {
    flex: 1, backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    color: COLORS.white, fontFamily: FONTS.body, fontSize: 15,
    borderWidth: 1, borderColor: COLORS.navy, maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.red, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white },
});
