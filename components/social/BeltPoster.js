// Afiche de cambio de mando de El Cinturon del Barrio.
//
// Cartel de pelea auto-generado desde `fight` (sin imagenes remotas, solo Views + LinearGradient + tokens).
// Ocupa el canvas del visor (StoryViewer lo renderiza en la capa de la foto para items kind:'belt_card').
// Soporta type: change | defense | coronation | vacancy. Botones Retar/Compartir no destructivos (mock).

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';
import { BELT_GOLD, BELT_GOLD_LIGHT, rolesForSport } from '../../lib/social/mockBelts';

const HEADLINE = {
  change: 'CAMBIO DE MANDO',
  defense: 'AGUANTO EL FAJON',
  coronation: 'SE CORONO',
  vacancy: 'CINTURON VACANTE',
};

function Avatar({ holder, big, gold, dim }) {
  const size = big ? 78 : 64;
  return (
    <View style={{ alignItems: 'center', opacity: dim ? 0.5 : 1 }}>
      <View style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: holder?.tone ?? COLORS.card2,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: gold ? 3 : 2, borderColor: gold ? BELT_GOLD : COLORS.line,
      }}>
        <Text style={{ fontFamily: FONTS.heading, fontSize: big ? 34 : 26, color: COLORS.white }}>
          {holder?.initial ?? '?'}
        </Text>
      </View>
    </View>
  );
}

function BeltGraphic() {
  return (
    <View style={styles.beltWrap}>
      <LinearGradient colors={[BELT_GOLD_LIGHT, BELT_GOLD]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.beltStrap}>
        <View style={styles.beltMedal}>
          <View style={styles.beltMedalInner} />
        </View>
      </LinearGradient>
    </View>
  );
}

function Chip({ label, value }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

export default function BeltPoster({ fight, onRetar, onCompartir }) {
  const type = fight?.type ?? 'change';
  const isVacancy = type === 'vacancy';
  const isDefense = type === 'defense';
  // Coronacion = PRIMER campeon del fajon: no hay destronado, no se pinta la tarjeta VS.
  const isCoronation = type === 'coronation';
  const retarLabel = isVacancy ? 'RECLAMAR EL CINTURON' : 'RETAR AL CAMPEON';

  return (
    <LinearGradient colors={['#0B0D10', '#160A0E', '#0B0D10']} style={styles.root}>
      {/* Cabecera */}
      <View style={styles.head}>
        <Text style={styles.kicker}>{HEADLINE[type] ?? 'EL CINTURON'}</Text>
        <Text style={styles.cancha}>{fight?.canchaNombre} · {fight?.deporte}</Text>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>
            {fight?.beltRoleLabel?.toUpperCase()}{rolesForSport(fight?.deporte ?? '').length === 1 ? ' · CINTURON UNICO' : ''}
          </Text>
        </View>
      </View>

      {/* Tale of the tape */}
      <View style={styles.tape}>
        {isVacancy ? (
          <View style={{ alignItems: 'center', gap: SPACING.sm }}>
            <Avatar holder={{ initial: '?', tone: COLORS.card2 }} big />
            <Text style={styles.vacancyText}>El fajon esta botado</Text>
            <Text style={styles.vacancySub}>El proximo MVP de {fight?.canchaNombre} se lo lleva</Text>
          </View>
        ) : isDefense ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Avatar holder={fight?.newHolder} big gold />
            <Text style={styles.champName}>{fight?.newHolder?.username}</Text>
            <Text style={styles.reignText}>aguanto el fajon · {fight?.defenses} defensa{fight?.defenses === 1 ? '' : 's'}</Text>
          </View>
        ) : isCoronation ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Avatar holder={fight?.newHolder} big gold />
            <Text style={styles.tapeTag}>NUEVO CAMPEON</Text>
            <Text style={styles.champName} numberOfLines={1}>{fight?.newHolder?.username}</Text>
            <Text style={styles.reignText}>primer campeon del fajon</Text>
          </View>
        ) : (
          <View style={styles.vs}>
            <View style={styles.tapeSide}>
              <Avatar holder={fight?.newHolder} big gold />
              <Text style={styles.tapeTag}>NUEVO CAMPEON</Text>
              <Text style={styles.champName} numberOfLines={1}>{fight?.newHolder?.username}</Text>
            </View>
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.tapeSide}>
              <Avatar holder={fight?.prevHolder ?? { initial: '?' }} dim />
              <Text style={[styles.tapeTag, { color: COLORS.red }]}>DESTRONADO</Text>
              <Text style={[styles.champName, { opacity: 0.6 }]} numberOfLines={1}>{fight?.prevHolder?.username ?? '—'}</Text>
            </View>
          </View>
        )}
      </View>

      <BeltGraphic />

      {/* Data strip */}
      <View style={styles.strip}>
        {fight?.mvpVotes ? <Chip label="Votos MVP" value={fight.mvpVotes} /> : null}
        {fight?.eventNombre ? <Chip label="Birrea" value={fight.fecha || '—'} /> : null}
        {!isVacancy ? <Chip label="Defensas" value={fight?.defenses ?? 0} /> : <Chip label="Estado" value="EN JUEGO" />}
      </View>
      {fight?.rosterValidated && !isVacancy ? (
        <Text style={styles.validated}>Validado por el roster del evento</Text>
      ) : null}

      {/* Botones (mock, no destructivos) */}
      <View style={styles.actions}>
        <TouchableOpacity activeOpacity={0.85} onPress={onRetar} style={styles.retarWrap}>
          <LinearGradient colors={[COLORS.red, COLORS.red2 ?? COLORS.red]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.retar}>
            <Text style={styles.retarText}>{retarLabel}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.microcopy}>
          {isVacancy
            ? 'Para reclamarlo te inscribis en la proxima birrea de la cancha.'
            : 'Para retar te inscribis en la proxima birrea. Si sos externo, te registras al tiro.'}
        </Text>
        <TouchableOpacity activeOpacity={0.85} onPress={onCompartir} style={styles.compartir}>
          <Text style={styles.compartirText}>COMPARTIR</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 96, paddingHorizontal: SPACING.lg, paddingBottom: 26, justifyContent: 'space-between' },
  head: { alignItems: 'center', gap: 4 },
  kicker: { fontFamily: FONTS.heading, fontSize: 30, color: BELT_GOLD, letterSpacing: 2, textAlign: 'center' },
  cancha: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 },
  rolePill: { marginTop: 4, borderWidth: 1, borderColor: BELT_GOLD, borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#00000055' },
  rolePillText: { fontFamily: FONTS.bodyBold, fontSize: 11, color: BELT_GOLD, letterSpacing: 1 },

  tape: { alignItems: 'center', justifyContent: 'center' },
  vs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.lg },
  tapeSide: { alignItems: 'center', gap: 4, width: 110 },
  tapeTag: { fontFamily: FONTS.bodyBold, fontSize: 9, color: BELT_GOLD, letterSpacing: 1, marginTop: 4 },
  champName: { fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white, maxWidth: 110 },
  vsText: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.red, letterSpacing: 1, textShadowColor: COLORS.red + '88', textShadowRadius: 12 },
  reignText: { fontFamily: FONTS.bodyBold, fontSize: 12, color: BELT_GOLD, letterSpacing: 0.5 },
  vacancyText: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1 },
  vacancySub: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2, textAlign: 'center' },

  beltWrap: { alignItems: 'center' },
  beltStrap: { width: '78%', height: 26, borderRadius: RADIUS.full, alignItems: 'center', justifyContent: 'center' },
  beltMedal: { width: 34, height: 34, borderRadius: 17, backgroundColor: BELT_GOLD, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0B0D10' },
  beltMedalInner: { width: 16, height: 16, borderRadius: 8, backgroundColor: BELT_GOLD_LIGHT, borderWidth: 1, borderColor: '#8a6d00' },

  strip: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.sm },
  chip: { backgroundColor: '#FFFFFF10', borderWidth: 1, borderColor: COLORS.line, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', minWidth: 78 },
  chipValue: { fontFamily: FONTS.heading, fontSize: 20, color: BELT_GOLD, letterSpacing: 0.5 },
  chipLabel: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray2, marginTop: -2 },
  validated: { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, textAlign: 'center', marginTop: -4 },

  actions: { gap: 8 },
  retarWrap: { borderRadius: RADIUS.lg, overflow: 'hidden' },
  retar: { paddingVertical: 15, alignItems: 'center', borderRadius: RADIUS.lg },
  retarText: { fontFamily: FONTS.heading, fontSize: 17, color: COLORS.white, letterSpacing: 1.5 },
  microcopy: { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, textAlign: 'center' },
  compartir: { borderWidth: 1.5, borderColor: COLORS.line, borderRadius: RADIUS.lg, paddingVertical: 13, alignItems: 'center' },
  compartirText: { fontFamily: FONTS.heading, fontSize: 15, color: COLORS.neon, letterSpacing: 1.5 },
});
