import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS, withAlpha } from '../constants/theme';
import { getEventStatusInfo, freeLabel } from '../lib/eventHelpers';
import { isModo26Active } from '../lib/modo26';
import { isTema2Active } from '../lib/tema2';
import PressableScale from './ui/PressableScale';

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function EventCard({ event, onPress }) {
  const inscritos = event.event_registrations?.[0]?.count ?? 0;
  const pct = event.cupos_total ? inscritos / event.cupos_total : 0;
  const { label, color } = getEventStatusInfo(event.status);

  // Compute effective status client-side (cupos full or deadline passed)
  const cuposFull = !event.cupos_ilimitado && event.cupos_total > 0 && inscritos >= event.cupos_total;
  let regClosed = false;
  if (event.status === 'open' && event.hora && event.fecha) {
    const [hh, mm] = event.hora.split(':').map(Number);
    const deadline = parseLocalDate(event.fecha);
    deadline.setHours(hh - 1, mm);
    regClosed = new Date() >= deadline;
  }
  const effectiveLabel = event.status === 'open' && cuposFull ? 'Lleno'
    : event.status === 'open' && regClosed ? 'Cerrado'
    : label;
  const effectiveColor = (event.status === 'open' && (cuposFull || regClosed)) ? COLORS.red : color;

  const tema2 = isTema2Active();
  // Con tema2 activo el glass/holo del rediseño pisa la franja tricolor de modo26
  // (el gate tema2 tiene prioridad estética sobre modo26).
  const cardDataSet = tema2
    ? { m26Card: '', t2Glass: '', t2Holo: 'auto', t2Tilt: '', t2Glow: 'subtle' }
    : { m26Card: '' };

  return (
    <PressableScale style={[styles.card, tema2 && styles.cardTema2]} onPress={onPress} activeOpacity={0.85} dataSet={cardDataSet}>
      {isModo26Active() && !tema2 && (
        <View pointerEvents="none" style={styles.m26Stripe}>
          <View style={{ flex: 1, backgroundColor: COLORS.green }} />
          <View style={{ flex: 1, backgroundColor: COLORS.blue }} />
          <View style={{ flex: 1, backgroundColor: COLORS.red }} />
        </View>
      )}
      {event.cancha_foto_url ? (
        <View>
          <Image
            source={{ uri: event.cancha_foto_url }}
            style={styles.cardImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['#00000010', '#000000CC']}
            style={styles.imageFade}
          />
        </View>
      ) : (
        // Placeholder "cancha nocturna" (F0, sin gate): misma altura que la foto
        // real para que la lista no salte de layout entre cards con/sin imagen.
        <View style={styles.cardPlaceholder}>
          <View style={styles.placeholderStripes}>
            <View style={[styles.placeholderStripe, { backgroundColor: withAlpha(COLORS.green, '14') }]} />
            <View style={[styles.placeholderStripe, { backgroundColor: withAlpha(COLORS.green, '14') }]} />
            <View style={[styles.placeholderStripe, { backgroundColor: withAlpha(COLORS.green, '14') }]} />
            <View style={[styles.placeholderStripe, { backgroundColor: withAlpha(COLORS.green, '14') }]} />
            <View style={[styles.placeholderStripe, { backgroundColor: withAlpha(COLORS.green, '14') }]} />
          </View>
          <View style={styles.placeholderCircle} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={styles.badgeGroup}>
            <View style={[styles.badge, { backgroundColor: effectiveColor + '20' }]}>
              <Text style={[styles.badgeText, { color: effectiveColor }]}>{effectiveLabel}</Text>
            </View>
            {event.my_registered && (
              <View style={[styles.badge, styles.badgeInscrito]}>
                <Text style={[styles.badgeText, { color: COLORS.green }]}>✓ Inscrito</Text>
              </View>
            )}
          </View>
          <Text style={styles.price}>{(event.precio ?? 0) > 0 ? `$${event.precio.toFixed(2)}` : freeLabel(event.deporte)}</Text>
        </View>

        <Text style={styles.nombre}>{event.nombre}</Text>

        {event.deporte ? (
          <Text style={styles.deporte}>{event.deporte} · {event.formato}</Text>
        ) : (
          <Text style={styles.deporte}>{event.formato}</Text>
        )}

        <Text style={styles.meta}>{event.lugar}</Text>
        <Text style={styles.meta}>
          {parseLocalDate(event.fecha).toLocaleDateString('es-PA', { weekday: 'short', day: 'numeric', month: 'short' })}
          {event.hora ? ` · ${event.hora.slice(0, 5)}` : ''}
        </Text>

        {!event.cupos_ilimitado && event.cupos_total > 0 && (
          <View style={styles.cuposRow}>
            <View style={styles.progressBg}>
              <View style={[
                styles.progressFill,
                { width: `${Math.min(pct * 100, 100)}%`, backgroundColor: pct > 0.9 ? COLORS.red : COLORS.green },
              ]} />
            </View>
            <Text style={styles.cuposText}>
              {inscritos}/{event.cupos_total}
              {event.cupos_hombres != null && event.cupos_mujeres != null
                ? `  · ♂${event.cupos_hombres} ♀${event.cupos_mujeres}`
                : ''}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

export default React.memo(EventCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
    ...SHADOWS.card,
  },
  cardTema2: {
    borderRadius: RADIUS.xl,
  },
  cardImage: {
    width: '100%',
    height: 142,
  },
  cardPlaceholder: {
    width: '100%',
    height: 142,
    backgroundColor: COLORS.bg2,
    flexDirection: 'row',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderStripes: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  placeholderStripe: { flex: 1 },
  placeholderCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: withAlpha(COLORS.white, '22'),
  },
  imageFade:   { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  body:        { padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.white + '08' },
  top:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.white + '12' },
  badgeText:   { fontFamily: FONTS.bodyBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  price:       { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.neon, letterSpacing: 1 },
  nombre:      { fontFamily: FONTS.heading, fontSize: 24, color: COLORS.white, marginBottom: 4, letterSpacing: 1 },
  deporte:     { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon, marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' },
  meta:        { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray, marginBottom: 2 },
  cuposRow:    { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 8 },
  progressBg:  { flex: 1, height: 5, backgroundColor: COLORS.line, borderRadius: 2, overflow: 'hidden' },
  progressFill:{ height: '100%', borderRadius: 2 },
  cuposText:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray2 },
  m26Stripe:   { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, flexDirection: 'column', overflow: 'hidden', zIndex: 2 },
});
