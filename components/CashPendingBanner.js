import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

// Numeros de contacto del gestor para coordinar el pago en efectivo.
const GESTOR_PHONES = ['6325-5309', '6122-2854'];
const WINDOW_MS = 4 * 3600 * 1000; // ventana de 4 horas

function fmtRemaining(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Banner del estado "pago en efectivo pendiente": cuenta regresiva de la ventana
 * de 4h (desde createdAt) + numeros del gestor para contactar.
 */
export default function CashPendingBanner({ createdAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const deadline = createdAt ? new Date(createdAt).getTime() + WINDOW_MS : null;
  const remaining = deadline != null ? deadline - now : null;
  const expired = remaining != null && remaining <= 0;

  const call = (p) => {
    const digits = p.replace(/[^0-9]/g, '');
    Linking.openURL(`tel:${digits}`).catch(() => {});
  };

  return (
    <View style={[styles.box, expired && styles.boxExpired]}>
      <Text style={styles.title}>⏳ Pago en efectivo pendiente</Text>

      {remaining == null ? (
        <Text style={styles.timer}>Tenés 4 horas para contactar y completar el pago.</Text>
      ) : expired ? (
        <Text style={styles.sub}>
          La ventana de 4 horas venció. Si ya pagaste, esperá la confirmación del gestor; si no, tu cupo pudo liberarse.
        </Text>
      ) : (
        <Text style={styles.timer}>
          Te quedan <Text style={styles.timerStrong}>{fmtRemaining(remaining)}</Text> para contactar y pagar
        </Text>
      )}

      <Text style={styles.contactLabel}>Contactá al gestor para coordinar el pago:</Text>
      <View style={styles.phonesRow}>
        {GESTOR_PHONES.map((p) => (
          <TouchableOpacity key={p} style={styles.phoneBtn} onPress={() => call(p)} activeOpacity={0.85}>
            <Text style={styles.phoneBtnText}>📞 {p}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: COLORS.gold + '14',
    borderColor: COLORS.gold,
    borderWidth: 1.5,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    gap: 6,
  },
  boxExpired: { borderColor: COLORS.red, backgroundColor: COLORS.red + '14' },
  title: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gold, letterSpacing: 1 },
  timer: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.white, lineHeight: 20 },
  timerStrong: { fontFamily: FONTS.heading, fontSize: 19, color: COLORS.neon, letterSpacing: 1 },
  sub: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2, lineHeight: 18 },
  contactLabel: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.white, marginTop: 4 },
  phonesRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', marginTop: 2 },
  phoneBtn: {
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  phoneBtnText: { fontFamily: FONTS.bodyBold, fontSize: 15, color: COLORS.white, letterSpacing: 0.5 },
});
