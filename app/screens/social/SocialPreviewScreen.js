// PREVIEW de HISTORIAS (estilo Instagram) para Birrea2Play.
//
// Pantalla aparte, gateada, 100% mock y offline. Muestra la barra de historias ARRIBA
// (como Instagram) + el visor a pantalla completa + el publicador "Tu historia" (24h).
// Debajo, un placeholder que representa el Home actual, para que se vea que las historias
// van ENCIMA del Home sin reemplazarlo. No toca Supabase ni el Home real.

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import { getMockStories, ADD_TONES } from '../../../lib/social/mockStories';
import { getMockBeltStories } from '../../../lib/social/mockBeltStories';
import { isBeltPreviewEnabled } from '../../../lib/featureFlags';
import useAuthStore from '../../../store/authStore';
import StoriesBar from '../../../components/social/StoriesBar';
import StoryViewer from '../../../components/social/StoryViewer';

const DAY_MS = 86400000;
const MAX_STORY_ITEMS = 6; // tope de segmentos vivos por usuario (evita spam de publicaciones)

export default function SocialPreviewScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const beltMode = isBeltPreviewEnabled(user);

  const [simDays, setSimDays] = React.useState(0);
  const buildStories = React.useCallback(
    () => (beltMode ? getMockBeltStories(Date.now() + simDays * DAY_MS) : getMockStories()),
    [beltMode, simDays],
  );
  const [stories, setStories] = React.useState(buildStories);
  const [viewerAt, setViewerAt] = React.useState(null); // indice de usuario abierto, o null
  const [adding, setAdding] = React.useState(false);
  const [pickTone, setPickTone] = React.useState(ADD_TONES[0]);
  const [notice, setNotice] = React.useState(null);

  // Re-derivar al simular el reloj anti-campeo (held -> en disputa -> vacante) SIN destruir lo
  // que hizo el usuario: se preserva la historia recien publicada ('Tu historia') y los aros ya
  // marcados como vistos, mergeando por id sobre el arreglo recien construido.
  React.useEffect(() => {
    setStories((prev) => {
      const next = buildStories();
      return next.map((s) => {
        const old = prev.find((p) => p && p.id === s.id);
        if (!old) return s;
        const keepItems = s.isYou && (old.items?.length ?? 0) > 0 ? old.items : s.items;
        return { ...s, seen: old.seen || s.seen, items: keepItems };
      });
    });
  }, [buildStories]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function showRetar(fight) {
    setViewerAt(null);
    setNotice(fight?.type === 'vacancy'
      ? `Vas por ${fight?.beltRoleLabel} de ${fight?.canchaNombre}: quedas inscrito en la proxima birrea para reclamarlo.`
      : `Le tiraste el reto por ${fight?.beltRoleLabel} de ${fight?.canchaNombre}. Quedas inscrito en la proxima birrea. (mock)`);
  }
  function showCompartir(fight) {
    setViewerAt(null);
    setNotice(`Compartir solo-dominio: "El fajon de ${fight?.canchaNombre} se movio en ${fight?.eventNombre}. birrea2play.com" (mock)`);
  }

  // Marca un circulo como visto. Lo invoca el visor por CADA usuario que alcanza (entrada +
  // los recorridos por auto-avance), no solo el indice de apertura. Guardado idempotente:
  // si ya estaba visto devuelve el mismo arreglo y React evita el re-render.
  function markSeen(idx) {
    setStories((prev) => {
      if (!prev[idx] || prev[idx].seen) return prev;
      return prev.map((s, i) => (i === idx ? { ...s, seen: true } : s));
    });
  }

  function publicarHistoria() {
    setStories((prev) => {
      const next = [...prev];
      const you = next[0] ?? {};
      const existing = you.items ?? [];
      const nuevo = { tone: pickTone, timeAgo: 'ahora', expiresIn: '24 h', caption: 'Mi historia' };
      // Dedupe: si el ultimo segmento es identico (mismo color), no duplicamos por spam del '+'.
      if (existing[0] && existing[0].tone === nuevo.tone && existing[0].caption === nuevo.caption) {
        return prev;
      }
      // Tope: la barra de progreso del visor reparte el ancho entre N tracks; sin cota se aplastan
      // a ~0px y el auto-avance tarda ~4.5s*N. Cap de segmentos vivos por usuario.
      const items = [nuevo, ...existing].slice(0, MAX_STORY_ITEMS);
      next[0] = { ...you, items };
      return next;
    });
    setAdding(false);
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.topSafe}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>‹ Volver</Text>
          </TouchableOpacity>
          <Text style={styles.brand}>BIRREA2PLAY</Text>
          <TouchableOpacity onPress={() => setAdding(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.plus}>+</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
      >
        {/* HISTORIAS arriba, como Instagram */}
        <StoriesBar
          stories={stories}
          onPressStory={(i) => setViewerAt(i)}
          onPressAdd={() => setAdding(true)}
        />

        {beltMode && (
          <View style={styles.beltCtl}>
            <Text style={styles.beltCtlHint}>Los campeones (aro dorado + corona) van primero. Tocá uno para ver el afiche.</Text>
            <View style={styles.beltCtlRow}>
              <TouchableOpacity style={styles.simBtn} onPress={() => setSimDays((d) => d + 7)}>
                <Text style={styles.simBtnText}>Simular +7 días (anti-campeo)</Text>
              </TouchableOpacity>
              {simDays > 0 && (
                <TouchableOpacity style={styles.simReset} onPress={() => setSimDays(0)}>
                  <Text style={styles.simResetText}>reset (+{simDays}d)</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <View style={styles.divider} />

        {/* Placeholder: el Home actual sigue debajo, sin cambios */}
        <Text style={styles.note}>Las historias van arriba. Debajo sigue tu Home actual, sin cambios:</Text>
        {['Próximos eventos', 'Tus créditos', 'Mis MVPs'].map((t) => (
          <View key={t} style={styles.fakeCard}>
            <Text style={styles.fakeTitle}>{t}</Text>
            <View style={styles.fakeLineWide} />
            <View style={styles.fakeLine} />
          </View>
        ))}
      </ScrollView>

      {/* Publicador "Tu historia" (24h) */}
      {adding && (
        <View style={styles.sheetWrap}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setAdding(false)} />
          <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Subí tu historia</Text>
            <Text style={styles.sheetSub}>Elegí una foto. Desaparece en 24 h.</Text>
            <View style={styles.tonesRow}>
              {ADD_TONES.map((tn) => (
                <TouchableOpacity
                  key={tn}
                  style={[styles.tone, { backgroundColor: tn }, pickTone === tn && styles.toneOn]}
                  onPress={() => setPickTone(tn)}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.publishBtn} activeOpacity={0.85} onPress={publicarHistoria}>
              <Text style={styles.publishText}>PUBLICAR HISTORIA</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Visor a pantalla completa */}
      {viewerAt != null && (
        <StoryViewer
          stories={stories}
          startIndex={viewerAt}
          onRetar={showRetar}
          onCompartir={showCompartir}
          onSeen={markSeen}
          onClose={() => setViewerAt(null)}
        />
      )}

      {/* Aviso mock (Retar / Compartir), por encima de todo */}
      {notice && (
        <View style={styles.noticeWrap} pointerEvents="box-none">
          <TouchableOpacity activeOpacity={0.9} style={styles.notice} onPress={() => setNotice(null)}>
            <Text style={styles.noticeText}>{notice}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  topSafe: { backgroundColor: COLORS.asphalt, borderBottomWidth: 1, borderBottomColor: COLORS.line, zIndex: 60 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  back: { fontFamily: FONTS.bodyBold, fontSize: 14, color: COLORS.neon, width: 64 },
  brand: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 2 },
  plus: { fontFamily: FONTS.bodyBold, fontSize: 26, color: COLORS.white, width: 64, textAlign: 'right' },

  divider: { height: 1, backgroundColor: COLORS.line, marginTop: 2 },

  note: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  fakeCard: { marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, opacity: 0.55 },
  fakeTitle: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1, marginBottom: SPACING.sm },
  fakeLineWide: { height: 10, borderRadius: 5, backgroundColor: COLORS.line, marginBottom: 8 },
  fakeLine: { height: 10, width: '60%', borderRadius: 5, backgroundColor: COLORS.line },

  beltCtl: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm, gap: SPACING.sm },
  beltCtlHint: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  beltCtlRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  simBtn: { borderWidth: 1, borderColor: COLORS.line, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.card },
  simBtnText: { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gray2 },
  simReset: { paddingHorizontal: 8, paddingVertical: 6 },
  simResetText: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.neon },

  noticeWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: SPACING.md, zIndex: 200, alignItems: 'center' },
  notice: { maxWidth: 420, backgroundColor: COLORS.card2, borderWidth: 1, borderColor: COLORS.neon + '88', borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  noticeText: { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white, textAlign: 'center' },

  sheetWrap: { ...StyleSheet.absoluteFillObject, zIndex: 90, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000AA' },
  sheet: { backgroundColor: COLORS.card2, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SPACING.lg, borderTopWidth: 1, borderColor: COLORS.line },
  sheetHandle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: COLORS.gray, marginBottom: SPACING.md },
  sheetTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  sheetSub: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, marginTop: 2, marginBottom: SPACING.md },
  tonesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.lg },
  tone: { width: 56, height: 80, borderRadius: RADIUS.md, borderWidth: 2, borderColor: 'transparent' },
  toneOn: { borderColor: COLORS.neon },
  publishBtn: { backgroundColor: COLORS.neon, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  publishText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.bg, letterSpacing: 1 },
});
