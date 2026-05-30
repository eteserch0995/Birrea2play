import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import MundialScreenFrame from '../../../components/mundial/MundialScreenFrame';
import { WCBlock, WCBadge, WCHeader, WCButton } from '../../../components/mundial/WCComponents';

export default function MundialRulesScreen({ navigation }) {
  return (
    <MundialScreenFrame>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <WCHeader
            kicker="Mundial 2026"
            title="REGLAS Y SCORING"
            onBack={() => navigation.goBack()}
          />

          <WCBlock title="🏆 Cómo funciona el pozo" accent="gold">
            <Text style={styles.text}>
              • Tu inscripción va al pozo del modo elegido (Survivor $10 / Polla $15).{'\n'}
              • El premio = 95% del total recaudado (5% cubre fees Yappy).{'\n'}
              • Entrega manual por <Text style={styles.payAccent}>Yappy o transferencia bancaria</Text>.{'\n'}
              • Cierre de inscripciones: 11-jun-2026 11:00 AM Panamá.
            </Text>
          </WCBlock>

          <WCBlock title="❤️ Survivor 3 Vidas — $10" accent="magenta">
            <Text style={styles.text}>
              • Arrancás con 3 corazones.{'\n'}
              • Cada jornada-día elegís 1 equipo de los que juegan.{'\n'}
              • Si tu equipo <Text style={styles.bold}>gana o empata</Text> mantenés tu vida.{'\n'}
              • Si <Text style={styles.bold}>pierde</Text> perdés 1 vida.{'\n'}
              • Si no pickeás antes del deadline (1h antes del primer partido del día) → perdés 1 vida.{'\n'}
              • Cada equipo se puede usar <Text style={styles.bold}>1 sola vez</Text> en toda la fase de grupos.{'\n'}
              • Cuando llegás a 0 vidas quedás eliminado.{'\n'}
              • Ganan los que terminen con más vidas. Si empatan, se reparte el pozo.
            </Text>
          </WCBlock>

          <WCBlock title="🎯 Polla Ganadora — $15" accent="neon">
            <Text style={styles.text}>
              <Text style={styles.bold}>Antes del 11-jun 11am</Text> tenés que llenar TODO: marcadores
              de los 72 partidos de grupos + bracket de 32 KO + 5 bonus picks. Después del cierre
              ya no se puede tocar nada.
            </Text>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>3 pts</Text>
              <Text style={styles.scoreDesc}>Acertás el ganador (1X2)</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>5 pts</Text>
              <Text style={styles.scoreDesc}>Ganador + diferencia exacta de goles</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>8 pts</Text>
              <Text style={styles.scoreDesc}>Marcador exacto</Text>
            </View>
            <Text style={styles.subText}>
              Todo × multiplicador por fase: x1 grupos · x1.5 16avos · x2 octavos · x2.5 cuartos · x3 semis · x4 final/3°.
            </Text>
          </WCBlock>

          <WCBlock title="🏅 Polla — bracket KO" accent="blue">
            <Text style={styles.text}>
              Para cada partido de eliminatoria predecís <Text style={styles.bold}>quién gana</Text>.
              El marcador es opcional pero da bonus:
            </Text>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>5 pts</Text>
              <Text style={styles.scoreDesc}>Acertás solo el ganador</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>7 pts</Text>
              <Text style={styles.scoreDesc}>+ diferencia exacta de goles</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>8 pts</Text>
              <Text style={styles.scoreDesc}>Marcador exacto (90'+extra, sin penales)</Text>
            </View>
            <Text style={styles.subText}>
              Si tu pick winner no llega a ese partido → 0 pts (sin importar marcador).
              Solo podés elegir entre teams que tu predicción de grupos hizo clasificar.
            </Text>
          </WCBlock>

          <WCBlock title="🎖 Bonus picks pre-temporada" accent="gold">
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>50 pts</Text>
              <Text style={styles.scoreDesc}>Campeón del Mundial</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>30 pts</Text>
              <Text style={styles.scoreDesc}>Subcampeón</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>25 pts</Text>
              <Text style={styles.scoreDesc}>Goleador del torneo (Bota de Oro)</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>20 pts</Text>
              <Text style={styles.scoreDesc}>Tercer lugar</Text>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scorePts}>15 pts</Text>
              <Text style={styles.scoreDesc}>Mejor jugador (Balón de Oro)</Text>
            </View>
            <Text style={styles.subText}>
              Llenás los 5 al inscribirte. Total potencial bonus: 140 pts.
            </Text>
          </WCBlock>

          <WCBlock title="⚖️ Tiebreakers (Polla)" variant="light">
            <Text style={[styles.text, { color: COLORS.bg }]}>
              Si dos o más users empatan en puntos totales, gana quien tenga:
            </Text>
            <Text style={[styles.text, { color: COLORS.bg }]}>
              1. Más marcadores exactos en total{'\n'}
              2. Más puntos en fases finales (semis/3°/final){'\n'}
              3. Marcador de la final más cercano al real (predicción de bonus){'\n'}
              4. Random si persiste (con audit log)
            </Text>
          </WCBlock>

          <WCBlock title="💰 Cómo se entrega el premio" variant="light">
            <Text style={[styles.text, { color: COLORS.bg }]}>
              Al cerrar el torneo, el admin contacta al ganador para coordinar el pago
              por <Text style={[styles.bold, styles.payAccentDark]}>Yappy o transferencia bancaria</Text>. Tenés
              que tener tu wallet o número Yappy listo. El admin valida tu identidad
              antes de transferir.
            </Text>
          </WCBlock>

          <WCButton
            label="VOLVER"
            variant="ghost"
            size="lg"
            onPress={() => navigation.goBack()}
            style={{ marginTop: SPACING.lg }}
          />
        </ScrollView>
      </SafeAreaView>
    </MundialScreenFrame>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl * 2 },
  text: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 20,
  },
  bold: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
  },
  payAccent: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.blue2 ?? '#3D6BFF',
  },
  payAccentDark: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.blue ?? '#0033CC',
  },
  subText: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
    fontStyle: 'italic',
    marginTop: SPACING.sm,
    lineHeight: 16,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  scorePts: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.neon,
    width: 70,
    letterSpacing: 1,
  },
  scoreDesc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    flex: 1,
  },
});
