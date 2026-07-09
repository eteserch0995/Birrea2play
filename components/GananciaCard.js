// Card que muestra al gestor / admin la ganancia estimada y real del evento.
//
// Modelo vigente (2026-07-05, 2ª decisión del día — fee INCLUIDO): el jugador
// paga exactamente el precio del evento; la app retiene app_fee_per_player
// ($0.50) de cada inscrito → sale de la ganancia del gestor:
//   ganancia = (precio − fee) × inscritos_facturables − cancha_costo
// Gestores exentos (is_fee_exempt) tienen fee 0 y cobran el precio completo.
// El gestor no paga su propio cupo (si juega) ni fee en su propio evento.
//
// Además calcula la TARIFA MÍNIMA (cubrir la cancha) y una RECOMENDADA
// (cancha + ~25% de margen) para guiar al gestor al ponerle precio.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

/**
 * Props:
 *   event           : { precio, cupos_total, cupos_ilimitado, cancha_costo,
 *                       app_fee_per_player, gestor_juega, created_by }
 *   inscritosConfirmados : number — count de registrations + guests CONFIRMADOS
 *   gestorEnEvento  : boolean   — true si el created_by tiene una inscripción
 */
export default function GananciaCard({ event, inscritosConfirmados = 0, gestorEnEvento = true }) {
  if (!event) return null;

  const precio       = Number(event.precio ?? 0);
  const cuposTotal   = event.cupos_ilimitado ? null : (event.cupos_total ?? null);
  const canchaCosto  = Number(event.cancha_costo ?? 0);
  const feeApp       = Number(event.app_fee_per_player ?? 0.50);
  const gestorCuenta = gestorEnEvento && (event.gestor_juega ?? true);
  const gestorSubtractor = gestorCuenta ? 1 : 0;

  // Fee INCLUIDO en el precio (2026-07-05): el jugador paga el precio tal cual
  // y la app retiene feeApp de cada inscrito → el neto del gestor por jugador
  // es (precio − fee). Gestores exentos tienen app_fee_per_player = 0.
  const netoPorJugador = Math.max(precio - feeApp, 0);

  // Esperado (escenario de evento lleno o por cupos definidos)
  const facturablesEsp = cuposTotal != null ? Math.max(0, cuposTotal - gestorSubtractor) : null;
  const ingresosEsp = facturablesEsp != null ? netoPorJugador * facturablesEsp : null;
  const gananciaEsp = ingresosEsp != null ? ingresosEsp - canchaCosto : null;

  // Real (con inscritos confirmados al día de hoy)
  const facturablesReal = Math.max(0, inscritosConfirmados - gestorSubtractor);
  const ingresosReal = netoPorJugador * facturablesReal;
  const gananciaReal = ingresosReal - canchaCosto;

  // Tarifa mínima / recomendada: deben cubrir la cancha DESPUÉS de la retención
  const redondeo25 = (n) => Math.ceil(n * 4) / 4; // al 0.25 más cercano hacia arriba
  const tarifaMinima = (canchaCosto > 0 && facturablesEsp > 0)
    ? redondeo25(canchaCosto / facturablesEsp + feeApp) : null;
  const tarifaRecomendada = tarifaMinima != null
    ? redondeo25((canchaCosto * 1.25) / facturablesEsp + feeApp) : null;
  const precioBajoMinimo = tarifaMinima != null && precio > 0 && precio < tarifaMinima;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>💰 GANANCIA ESTIMADA</Text>

      <Row label="Tu tarifa por jugador (lo que paga)" value={`$${precio.toFixed(2)}`} />
      {feeApp > 0 && <Row label={`Retención app por inscrito`} value={`-$${feeApp.toFixed(2)}`} negative />}
      <Row label="Tu neto por jugador"          value={`$${netoPorJugador.toFixed(2)}`} muted />
      <Row label="Costo cancha"                value={`-$${canchaCosto.toFixed(2)}`} negative />
      <Row
        label={`Cupos facturables ${gestorCuenta ? '(sin gestor)' : ''}`}
        value={cuposTotal != null ? `${facturablesEsp}/${cuposTotal}` : '— ilimitado'}
        muted
      />

      {tarifaMinima != null && (
        <View style={[styles.scenarioBox, precioBajoMinimo && { borderColor: COLORS.red }]}>
          <Text style={styles.scenarioTitle}>Guía de tarifa</Text>
          <Row label="Mínima (cubre la cancha)"  value={`$${tarifaMinima.toFixed(2)}`} />
          <Row label="Recomendada (con margen)"  value={`$${tarifaRecomendada.toFixed(2)}`} highlight />
          {precioBajoMinimo && (
            <Text style={styles.warn}>⚠️ Tu tarifa actual no alcanza a cubrir la cancha si se llena.</Text>
          )}
        </View>
      )}

      <View style={styles.divider} />

      {/* ESPERADA */}
      {ingresosEsp != null && (
        <View style={styles.scenarioBox}>
          <Text style={styles.scenarioTitle}>Si se llena</Text>
          <Row label="Ingresos"              value={`$${ingresosEsp.toFixed(2)}`} />
          <Row label="Costo cancha"          value={`-$${canchaCosto.toFixed(2)}`} negative />
          <Row label="Ganancia estimada"     value={`$${gananciaEsp.toFixed(2)}`} highlight />
        </View>
      )}

      {/* REAL */}
      <View style={[styles.scenarioBox, { marginTop: SPACING.sm }]}>
        <Text style={styles.scenarioTitle}>Hoy ({inscritosConfirmados} inscritos)</Text>
        <Row label="Ingresos confirmados"  value={`$${ingresosReal.toFixed(2)}`} />
        <Row label="Costo cancha"          value={`-$${canchaCosto.toFixed(2)}`} negative />
        <Row label="Ganancia actual"       value={`$${gananciaReal.toFixed(2)}`} highlight={gananciaReal >= 0} negative={gananciaReal < 0} />
      </View>

      <Text style={styles.footnote}>
        La app retiene ${feeApp.toFixed(2)} por inscrito del precio que paga el jugador (tu inscripción propia no cuenta). El costo de la cancha se descuenta una sola vez.
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
  warn:        { fontFamily: FONTS.bodySemiBold, fontSize: 11, color: COLORS.red, marginTop: 4 },
  footnote:    { fontFamily: FONTS.body, fontSize: 10, color: COLORS.gray, marginTop: SPACING.sm, lineHeight: 14 },
});
