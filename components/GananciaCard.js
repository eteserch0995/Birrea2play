// Card que muestra al gestor / admin la ganancia estimada y real del evento.
//
// Fórmula:
//   cupos_facturables = (cupos_total ?? inscritos) - (gestor_juega ? 1 : 0)
//   ingresos_esperados = precio × cupos_facturables                  (si llenara)
//   ingresos_reales    = precio × (inscritos_confirmados - gestor)   (lo que entró ya)
//   tarifa_app_total   = tarifa_app_por_jugador × cupos_facturables_reales
//   ganancia           = ingresos - cancha_costo - tarifa_app_total
//
// El "gestor no cuenta" significa: si el gestor está inscrito en el evento, no
// le cobramos su cupo ni la tarifa de mantenimiento por él (asumimos que su
// ganancia ya descuenta su propio juego "gratis").
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * Props:
 *   event           : { precio, cupos_total, cupos_ilimitado, cancha_costo,
 *                       tarifa_app_por_jugador, gestor_juega, created_by }
 *   inscritosConfirmados : number — count de registrations + guests CONFIRMADOS
 *   gestorEnEvento  : boolean   — true si el created_by tiene una inscripción
 */
export default function GananciaCard({ event, inscritosConfirmados = 0, gestorEnEvento = true }) {
  if (!event) return null;

  const precio       = Number(event.precio ?? 0);
  const cuposTotal   = event.cupos_ilimitado ? null : (event.cupos_total ?? null);
  const canchaCosto  = Number(event.cancha_costo ?? 0);
  const tarifaApp    = Number(event.tarifa_app_por_jugador ?? 0.25);
  const gestorCuenta = gestorEnEvento && (event.gestor_juega ?? true);
  const gestorSubtractor = gestorCuenta ? 1 : 0;

  // Esperado (escenario de evento lleno o por cupos definidos)
  const facturablesEsp = cuposTotal != null ? Math.max(0, cuposTotal - gestorSubtractor) : null;
  const ingresosEsp = facturablesEsp != null ? precio * facturablesEsp : null;
  const tarifaAppEsp = facturablesEsp != null ? tarifaApp * facturablesEsp : null;
  const gananciaEsp = ingresosEsp != null ? ingresosEsp - canchaCosto - tarifaAppEsp : null;

  // Real (con inscritos confirmados al día de hoy)
  const facturablesReal = Math.max(0, inscritosConfirmados - gestorSubtractor);
  const ingresosReal = precio * facturablesReal;
  const tarifaAppReal = tarifaApp * facturablesReal;
  const gananciaReal = ingresosReal - canchaCosto - tarifaAppReal;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>💰 GANANCIA ESTIMADA</Text>

      <Row label="Precio por jugador"          value={`$${precio.toFixed(2)}`} />
      <Row label="Costo cancha"                value={`-$${canchaCosto.toFixed(2)}`} negative />
      <Row label={`Tarifa app ($${tarifaApp.toFixed(2)}/jug)`} value="" muted />
      <Row
        label={`Cupos facturables ${gestorCuenta ? '(sin gestor)' : ''}`}
        value={cuposTotal != null ? `${facturablesEsp}/${cuposTotal}` : '— ilimitado'}
        muted
      />

      <View style={styles.divider} />

      {/* ESPERADA */}
      {ingresosEsp != null && (
        <View style={styles.scenarioBox}>
          <Text style={styles.scenarioTitle}>Si se llena</Text>
          <Row label="Ingresos"              value={`$${ingresosEsp.toFixed(2)}`} />
          <Row label="Costo cancha"          value={`-$${canchaCosto.toFixed(2)}`} negative />
          <Row label="Comisión app"          value={`-$${tarifaAppEsp.toFixed(2)}`} negative />
          <Row label="Ganancia estimada"     value={`$${gananciaEsp.toFixed(2)}`} highlight />
        </View>
      )}

      {/* REAL */}
      <View style={[styles.scenarioBox, { marginTop: SPACING.sm }]}>
        <Text style={styles.scenarioTitle}>Hoy ({inscritosConfirmados} inscritos)</Text>
        <Row label="Ingresos confirmados"  value={`$${ingresosReal.toFixed(2)}`} />
        <Row label="Costo cancha"          value={`-$${canchaCosto.toFixed(2)}`} negative />
        <Row label="Comisión app"          value={`-$${tarifaAppReal.toFixed(2)}`} negative />
        <Row label="Ganancia actual"       value={`$${gananciaReal.toFixed(2)}`} highlight={gananciaReal >= 0} negative={gananciaReal < 0} />
      </View>

      <Text style={styles.footnote}>
        La comisión de la app es ${tarifaApp.toFixed(2)} por cada jugador inscrito (sin contar al gestor si está jugando). El costo de la cancha se descuenta una sola vez.
      </Text>
    </View>
  );
}

function Row({ label, value, highlight, negative, muted }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, muted && { color: COLORS.gray }]}>{label}</Text>
      <Text style={[
        styles.value,
        highlight && { color: COLORS.green, fontFamily: FONTS.bodyBold, fontSize: 16 },
        negative && !highlight && { color: COLORS.red },
        muted && { color: COLORS.gray2 },
      ]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:        { backgroundColor: COLORS.card, borderRadius: RADIUS.md, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.green + '40', marginVertical: SPACING.sm, gap: 4 },
  title:       { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.green, letterSpacing: 1.5, marginBottom: SPACING.sm },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  label:       { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },
  value:       { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  divider:     { height: 1, backgroundColor: COLORS.navy, marginVertical: SPACING.sm },
  scenarioBox: { backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy },
  scenarioTitle:{ fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.gold, letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' },
  footnote:    { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: SPACING.sm, lineHeight: 14 },
});
