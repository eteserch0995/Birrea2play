import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import useClubStore from '../../../store/clubStore';
import { COLORS, FONTS, SPACING, RADIUS } from '../../../constants/theme';
import {
  WCCard,
  WCBadge,
  WCSectionTitle,
  WCEmptyState,
  WCHeader,
  WCTabBar,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

// ─── helpers ────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function channelLabel(channel) {
  if (channel === 'presencial') return 'Presencial';
  if (channel === 'online') return 'Online';
  if (channel === 'ambos') return 'Ambos';
  return channel ?? '—';
}

function channelTone(channel) {
  if (channel === 'presencial') return 'gold';
  if (channel === 'online') return 'neon';
  return 'neutral';
}

// ─── component ─────────────────────────────────────────────────

export default function ClubHistorialScreen({ navigation }) {
  const { user } = useAuthStore();
  const { myCompanies, loadMyCompanies } = useClubStore();

  const [activeCompanyId, setActiveCompanyId] = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load companies once on mount
  useEffect(() => {
    if (user?.id) {
      loadMyCompanies(user.id);
    }
  }, [user?.id]);

  // Once myCompanies loads, set active company
  useEffect(() => {
    if (myCompanies.length > 0 && !activeCompanyId) {
      setActiveCompanyId(myCompanies[0].id);
    }
  }, [myCompanies]);

  // Load redemptions whenever active company changes
  useEffect(() => {
    if (activeCompanyId) {
      fetchRedemptions(false);
    }
  }, [activeCompanyId]);

  const fetchRedemptions = useCallback(async (isRefresh = false) => {
    if (!activeCompanyId) return;

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Step 1: benefit ids + titulos for this company
      const { data: benefits, error: bErr } = await supabase
        .from('partner_benefits')
        .select('id, titulo')
        .eq('company_id', activeCompanyId);

      if (bErr) {
        Alert.alert('Error', bErr.message);
        return;
      }

      if (!benefits || benefits.length === 0) {
        setRedemptions([]);
        return;
      }

      const benefitIds = benefits.map((b) => b.id);
      const benefitMap = {};
      benefits.forEach((b) => { benefitMap[b.id] = b.titulo; });

      // Step 2: redemptions redeemed for those benefits
      const { data: reds, error: rErr } = await supabase
        .from('benefit_redemptions')
        .select('*')
        .in('benefit_id', benefitIds)
        .eq('status', 'redeemed')
        .order('redeemed_at', { ascending: false });

      if (rErr) {
        Alert.alert('Error', rErr.message);
        return;
      }

      if (!reds || reds.length === 0) {
        setRedemptions([]);
        return;
      }

      // Step 3: fetch socio nombres
      const userIds = [...new Set(reds.map((r) => r.user_id).filter(Boolean))];
      let userMap = {};
      if (userIds.length > 0) {
        const { data: users, error: uErr } = await supabase
          .from('users')
          .select('id, nombre')
          .in('id', userIds);
        if (!uErr && users) {
          users.forEach((u) => { userMap[u.id] = u.nombre; });
        }
      }

      // Step 4: merge
      const merged = reds.map((r) => ({
        ...r,
        benefit_titulo: benefitMap[r.benefit_id] ?? '—',
        socio_nombre: userMap[r.user_id] ?? 'Socio',
      }));

      setRedemptions(merged);
    } catch (err) {
      Alert.alert('Error inesperado', err.message ?? 'Intenta de nuevo');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeCompanyId]);

  const onRefresh = useCallback(() => {
    fetchRedemptions(true);
  }, [fetchRedemptions]);

  // ── No company assigned ──────────────────────────────────────
  if (!loading && myCompanies.length === 0) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <WCHeader
            title="Historial"
            kicker="COMERCIO ALIADO"
            onBack={() => navigation.goBack()}
          />
          <WCEmptyState
            icon="🏪"
            title="Sin comercio asignado"
            message="No tenes un comercio asignado a tu cuenta."
          />
        </SafeAreaView>
      </View>
    );
  }

  // ── Tab labels (company names) ───────────────────────────────
  const tabs = myCompanies.map((c) => c.nombre);
  const activeTab = myCompanies.find((c) => c.id === activeCompanyId)?.nombre ?? null;

  const handleTabChange = (tabName) => {
    const company = myCompanies.find((c) => c.nombre === tabName);
    if (company) setActiveCompanyId(company.id);
  };

  // ── Main render ──────────────────────────────────────────────
  return (
    <View style={styles.frame}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <WCHeader
          title="Historial"
          kicker="COMERCIO ALIADO"
          onBack={() => navigation.goBack()}
        />

        {loading && !refreshing ? (
          <View style={styles.loadingWrapper}>
            <ActivityIndicator size="large" color={COLORS.gold} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.gold}
                colors={[COLORS.gold]}
              />
            }
          >
            {/* Multi-company tab switcher */}
            {myCompanies.length > 1 && activeTab && (
              <WCTabBar
                tabs={tabs}
                active={activeTab}
                onChange={handleTabChange}
                accent="gold"
              />
            )}

            <WCSectionTitle accent="gold" sub={`${redemptions.length} canje${redemptions.length !== 1 ? 's' : ''}`}>
              Canjes registrados
            </WCSectionTitle>

            {redemptions.length === 0 ? (
              <WCEmptyState
                icon="🧾"
                title="Sin canjes todavía"
                message="Cuando un socio canjee un beneficio de tu comercio, aparecerá acá."
              />
            ) : (
              redemptions.map((item) => (
                <RedemptionRow key={item.id} item={item} />
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

// ─── RedemptionRow ──────────────────────────────────────────────

function RedemptionRow({ item }) {
  return (
    <WCCard accent="gold" style={styles.card}>
      {/* Top row: code + channel badge */}
      <View style={styles.rowBetween}>
        <Text style={styles.code} numberOfLines={1} selectable>
          {item.code}
        </Text>
        <WCBadge
          label={channelLabel(item.channel_used)}
          tone={channelTone(item.channel_used)}
          size="sm"
        />
      </View>

      {/* Benefit titulo */}
      <Text style={styles.benefitTitle} numberOfLines={2}>
        {item.benefit_titulo}
      </Text>

      {/* Socio + date row */}
      <View style={styles.rowBetween}>
        <View style={styles.socioRow}>
          <Text style={styles.label}>Socio</Text>
          <Text style={styles.value} numberOfLines={1}>{item.socio_nombre}</Text>
        </View>
        <View style={styles.dateBlock}>
          <Text style={styles.label}>Canjeado</Text>
          <Text style={styles.value}>{formatDate(item.redeemed_at)}</Text>
        </View>
      </View>
    </WCCard>
  );
}

// ─── styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl * 2,
  },
  loadingWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    marginBottom: SPACING.sm,
    gap: SPACING.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
  },
  code: {
    fontFamily: FONTS.bodyBold,
    fontSize: 14,
    color: COLORS.gold,
    letterSpacing: 1.5,
    flex: 1,
  },
  benefitTitle: {
    fontFamily: FONTS.bodySemiBold,
    fontSize: 15,
    color: COLORS.white,
    marginTop: 2,
  },
  socioRow: {
    flex: 1,
    gap: 2,
  },
  dateBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  label: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  value: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 13,
    color: COLORS.gray2,
  },
});
