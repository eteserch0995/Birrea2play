// Selector de cancha + duración con dropdowns. Calcula automáticamente el
// costo (precio_hora × duracion_horas). Override manual disponible si la
// cancha no está en la tabla de tarifas.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, Modal, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

const DURACIONES = [
  { value: 1.0, label: '1 hora' },
  { value: 1.5, label: '1 h 30 min' },
  { value: 2.0, label: '2 horas' },
  { value: 2.5, label: '2 h 30 min' },
  { value: 3.0, label: '3 horas' },
  { value: 3.5, label: '3 h 30 min' },
  { value: 4.0, label: '4 horas' },
];

/**
 * Props:
 *   deporte               : 'Fútbol' | 'Volleyball' | ...
 *   jugadoresPorEquipo    : number  (5/6/7/9) — filtra la lista de canchas
 *   costoValue            : número actual de cancha_costo
 *   tarifaIdValue         : uuid actual de cancha_tarifa_id
 *   duracionValue         : número actual de duracion_horas
 *   onChange              : ({ cancha_costo, cancha_tarifa_id, duracion_horas }) => void
 */
export default function CanchaCostoPicker({
  deporte,
  jugadoresPorEquipo,
  costoValue,
  tarifaIdValue,
  duracionValue,
  onChange,
}) {
  const [tarifas,        setTarifas]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [manualMode,     setManualMode]     = useState(false);
  const [canchaModal,    setCanchaModal]    = useState(false);
  const [duracionModal,  setDuracionModal]  = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    supabase.from('cancha_tarifas')
      .select('id, cancha, deporte, formato_jpe, precio_hora')
      .eq('activo', true)
      .order('cancha').order('formato_jpe')
      .then(({ data }) => { if (mounted) { setTarifas(data ?? []); setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  // Si el caller tiene tarifaIdValue precargado pero las tarifas todavía no
  // están en memoria, esperamos al fetch.
  const tarifaSel = useMemo(
    () => tarifas.find((t) => t.id === tarifaIdValue) ?? null,
    [tarifas, tarifaIdValue],
  );
  const duracionSel = useMemo(
    () => DURACIONES.find((d) => d.value === Number(duracionValue)) ?? null,
    [duracionValue],
  );

  // Lista filtrada por deporte + jugadores por equipo del evento
  const filtradas = useMemo(() => tarifas.filter((t) =>
    (!deporte || normalize(t.deporte) === normalize(deporte))
    && (!jugadoresPorEquipo || t.formato_jpe === jugadoresPorEquipo)
  ), [tarifas, deporte, jugadoresPorEquipo]);

  // Toda la lista (cuando no hay filtros que matcheen)
  const mostrarSinFiltro = filtradas.length === 0;
  const lista = mostrarSinFiltro ? tarifas : filtradas;

  function pickCancha(t) {
    setCanchaModal(false);
    const horas = Number(duracionValue) || 1;
    onChange?.({
      cancha_tarifa_id: t.id,
      cancha_costo:     Number((t.precio_hora * horas).toFixed(2)),
      duracion_horas:   horas,
    });
  }

  function pickDuracion(opt) {
    setDuracionModal(false);
    const precioHora = tarifaSel?.precio_hora ?? null;
    onChange?.({
      cancha_tarifa_id: tarifaSel?.id ?? null,
      cancha_costo:     precioHora != null ? Number((precioHora * opt.value).toFixed(2)) : costoValue,
      duracion_horas:   opt.value,
    });
  }

  function setManualCosto(v) {
    const num = v === '' ? null : (parseFloat(v) || 0);
    onChange?.({
      cancha_tarifa_id: null,
      cancha_costo:     num,
      duracion_horas:   duracionValue ?? null,
    });
  }

  return (
    <View style={styles.box}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>💵 Costo de la cancha</Text>
        <TouchableOpacity onPress={() => setManualMode((m) => !m)}>
          <Text style={styles.toggle}>{manualMode ? '↻ Usar tarifa' : '✎ Manual'}</Text>
        </TouchableOpacity>
      </View>

      {manualMode ? (
        <>
          <Text style={styles.label}>Total cancha (USD)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={COLORS.gray}
            value={costoValue != null ? String(costoValue) : ''}
            onChangeText={setManualCosto}
          />
          <Text style={styles.hint}>Lo definís tú. La duración debajo es informativa.</Text>
        </>
      ) : loading ? (
        <Text style={styles.hint}>Cargando tarifas…</Text>
      ) : (
        <>
          {/* Dropdown CANCHA */}
          <Text style={styles.label}>Cancha</Text>
          <TouchableOpacity style={styles.dropdown} onPress={() => setCanchaModal(true)} activeOpacity={0.85}>
            <Text style={[styles.dropdownText, !tarifaSel && { color: COLORS.gray }]}>
              {tarifaSel ? `${tarifaSel.cancha} · ${tarifaSel.formato_jpe}v${tarifaSel.formato_jpe} · $${Number(tarifaSel.precio_hora).toFixed(2)}/h` : 'Seleccioná una cancha'}
            </Text>
            <Text style={styles.dropdownChevron}>▾</Text>
          </TouchableOpacity>

          {/* Dropdown DURACIÓN */}
          <Text style={[styles.label, { marginTop: SPACING.sm }]}>Duración</Text>
          <TouchableOpacity style={styles.dropdown} onPress={() => setDuracionModal(true)} activeOpacity={0.85}>
            <Text style={[styles.dropdownText, !duracionSel && { color: COLORS.gray }]}>
              {duracionSel ? duracionSel.label : 'Seleccioná la duración'}
            </Text>
            <Text style={styles.dropdownChevron}>▾</Text>
          </TouchableOpacity>

          {/* Total calculado */}
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Costo total</Text>
            <Text style={styles.totalValue}>
              {(tarifaSel && duracionSel)
                ? `$${(tarifaSel.precio_hora * duracionSel.value).toFixed(2)}`
                : '—'}
            </Text>
          </View>

          {mostrarSinFiltro && (
            <Text style={[styles.hint, { color: COLORS.gold }]}>
              No hay tarifas para {deporte ?? 'este deporte'}{jugadoresPorEquipo ? ` · ${jugadoresPorEquipo}v${jugadoresPorEquipo}` : ''}. Mostrando todas las canchas.
            </Text>
          )}
        </>
      )}

      {/* Modal lista de canchas */}
      <Modal visible={canchaModal} transparent animationType="fade" onRequestClose={() => setCanchaModal(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setCanchaModal(false)}>
          <View style={styles.modalBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Elegí una cancha</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {lista.length === 0 ? (
                <Text style={styles.hint}>No hay tarifas cargadas. Usá "Manual".</Text>
              ) : (
                lista.map((t) => {
                  const sel = t.id === tarifaIdValue;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.optionRow, sel && styles.optionRowSel]}
                      onPress={() => pickCancha(t)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionName}>{t.cancha}</Text>
                        <Text style={styles.optionMeta}>{t.deporte} · {t.formato_jpe}v{t.formato_jpe}</Text>
                      </View>
                      <Text style={styles.optionPrice}>${Number(t.precio_hora).toFixed(2)}/h</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <TouchableOpacity style={styles.modalClose} onPress={() => setCanchaModal(false)}>
              <Text style={styles.modalCloseText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal duración */}
      <Modal visible={duracionModal} transparent animationType="fade" onRequestClose={() => setDuracionModal(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setDuracionModal(false)}>
          <View style={styles.modalBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Duración del evento</Text>
            {DURACIONES.map((d) => {
              const sel = Number(duracionValue) === d.value;
              return (
                <TouchableOpacity
                  key={d.value}
                  style={[styles.optionRow, sel && styles.optionRowSel]}
                  onPress={() => pickDuracion(d)}
                >
                  <Text style={styles.optionName}>{d.label}</Text>
                  {tarifaSel && (
                    <Text style={styles.optionPrice}>${(tarifaSel.precio_hora * d.value).toFixed(2)}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.modalClose} onPress={() => setDuracionModal(false)}>
              <Text style={styles.modalCloseText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function normalize(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

const styles = StyleSheet.create({
  box:          { backgroundColor: COLORS.card, padding: SPACING.md, borderRadius: RADIUS.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.sm },
  headerRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title:        { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, letterSpacing: 0.5 },
  toggle:       { fontFamily: FONTS.bodyBold, fontSize: 11, color: COLORS.neon, letterSpacing: 0.5 },
  label:        { fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gray2 },
  hint:         { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray },
  input:        { backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, color: COLORS.white, fontFamily: FONTS.body, fontSize: 14, borderWidth: 1, borderColor: COLORS.navy },
  dropdown:     { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, minHeight: 44 },
  dropdownText: { flex: 1, fontFamily: FONTS.body, fontSize: 13, color: COLORS.white },
  dropdownChevron: { fontFamily: FONTS.body, fontSize: 18, color: COLORS.gold },
  totalBox:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.navy, marginTop: 4 },
  totalLabel:   { fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.gray2 },
  totalValue:   { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.green, letterSpacing: 1 },

  // Modal
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: SPACING.md },
  modalBox:     { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.md, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.sm },
  modalTitle:   { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.white, letterSpacing: 1.5, marginBottom: SPACING.sm },
  optionRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderWidth: 1, borderColor: COLORS.navy, marginBottom: 6, gap: SPACING.sm, minHeight: 56 },
  optionRowSel: { borderColor: COLORS.gold, backgroundColor: COLORS.gold + '15' },
  optionName:   { flex: 1, fontFamily: FONTS.bodySemiBold, fontSize: 14, color: COLORS.white },
  optionMeta:   { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gray, marginTop: 2 },
  optionPrice:  { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gold },
  modalClose:   { backgroundColor: COLORS.navy, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, alignItems: 'center', marginTop: SPACING.sm },
  modalCloseText:{ fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
});
