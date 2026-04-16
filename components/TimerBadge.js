import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

function pad(n) { return String(n).padStart(2, '0'); }

/**
 * TimerBadge — live countdown to a deadline.
 * Props: deadline (Date | string | number), label
 */
export default function TimerBadge({ deadline, label = 'Cierra en' }) {
  const [remaining, setRemaining] = useState('');
  const [expired, setExpired]     = useState(false);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadline) - Date.now();
      if (diff <= 0) { setExpired(true); setRemaining('00:00:00'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000)    / 1_000);
      setRemaining(`${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  return (
    <View style={[styles.badge, expired && styles.expiredBadge]}>
      <Text style={[styles.label, expired && styles.expiredText]}>
        {expired ? 'Inscripción cerrada' : label}
      </Text>
      {!expired && <Text style={styles.time}>{remaining}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.gold + '20',
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  expiredBadge: { backgroundColor: COLORS.red + '20', borderColor: COLORS.red },
  label:        { fontFamily: FONTS.body, fontSize: 11, color: COLORS.gold },
  expiredText:  { color: COLORS.red },
  time:         { fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.gold },
});
