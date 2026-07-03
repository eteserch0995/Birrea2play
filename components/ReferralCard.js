import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

// Tarjeta "Invita y Gana" — extraída de ProfileScreen (DIS-4) para reuso.
// props: { data, onShare, sharing } — data viene de lib/referral.js
export default function ReferralCard({ data, onShare, sharing }) {
  if (!data) return null;

  const capText = data.cap_remaining > 0
    ? `${data.cap_remaining} invitado${data.cap_remaining !== 1 ? 's' : ''} disponible${data.cap_remaining !== 1 ? 's' : ''} este mes`
    : 'Cupo del mes alcanzado (5/5)';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>INVITA Y GANA</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>$1 × REFERIDO</Text>
        </View>
      </View>

      <Text style={styles.desc}>
        Compartí tu código. Cuando tu amigo/a complete su primer evento, los dos ganan $1 en créditos.
      </Text>

      {/* Código */}
      <View style={styles.codeRow}>
        <Text style={styles.code}>{data.code}</Text>
        <TouchableOpacity style={styles.shareBtn} onPress={onShare} disabled={sharing}>
          {sharing
            ? <ActivityIndicator size="small" color={COLORS.bg} />
            : <Text style={styles.shareBtnText}>COMPARTIR</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <RefStat label="Invitados" value={data.referrals_total} />
        <RefStat label="Ganado" value={`$${Number(data.earned_total ?? 0).toFixed(2)}`} accent />
        <RefStat label="Este mes" value={`${data.referrals_this_month}/${data.monthly_cap}`} />
      </View>

      <Text style={styles.cap}>{capText}</Text>

      {data.invited_by && (
        <Text style={styles.invitedBy}>Fuiste invitado/a por {data.invited_by}</Text>
      )}
    </View>
  );
}

function RefStat({ label, value, accent }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && { color: COLORS.gold }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  title: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.white,
    letterSpacing: 2,
  },
  badge: {
    backgroundColor: COLORS.green + '22',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: COLORS.green + '55',
  },
  badgeText: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.green,
    letterSpacing: 1,
  },
  desc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 19,
    marginBottom: SPACING.md,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  code: {
    flex: 1,
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.gold,
    letterSpacing: 6,
  },
  shareBtn: {
    backgroundColor: COLORS.green,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  shareBtnText: {
    fontFamily: FONTS.heading,
    fontSize: 14,
    color: COLORS.bg,
    letterSpacing: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: COLORS.bg2,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  statValue: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.white,
  },
  statLabel: {
    fontFamily: FONTS.body,
    fontSize: 10,
    color: COLORS.gray,
    marginTop: 2,
  },
  cap: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
  invitedBy: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.green,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
