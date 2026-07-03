import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCSectionTitle,
  WCHeader,
  WCBlock,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function descuentoLabel(benefit) {
  if (!benefit) return '';
  switch (benefit.tipo) {
    case 'porcentaje': return `${benefit.valor_num}% OFF`;
    case 'monto':      return `$${benefit.valor_num} OFF`;
    case '2x1':        return '2x1';
    case 'regalo':     return 'Regalo';
    default:           return benefit.titulo;
  }
}

function formatDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-PA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function vigenciaText(benefit) {
  const desde = formatDate(benefit.valido_desde);
  const hasta = formatDate(benefit.valido_hasta);
  if (!desde && !hasta) return 'Sin vencimiento';
  if (desde && hasta)   return `Del ${desde} al ${hasta}`;
  if (hasta)            return `Hasta el ${hasta}`;
  return `Desde el ${desde}`;
}

function usosText(maxUses) {
  if (maxUses === 1)    return 'Uso único';
  if (maxUses === null || maxUses === undefined) return 'Usos ilimitados';
  return `Hasta ${maxUses} usos`;
}

function channelLabel(channel) {
  if (channel === 'presencial') return 'Presencial';
  if (channel === 'online')     return 'Online';
  if (channel === 'ambos')      return 'Presencial y Online';
  return channel;
}

function channelTone(channel) {
  if (channel === 'online')     return 'neon';
  if (channel === 'presencial') return 'gold';
  return 'neutral';
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ClubBeneficioScreen({ route, navigation }) {
  const { benefitId } = route.params;
  const { user } = useAuthStore();

  const [benefit, setBenefit]         = useState(null);
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    // Benefit + company
    const { data: bData, error: bErr } = await supabase
      .from('partner_benefits')
      .select('*, partner_companies(*)')
      .eq('id', benefitId)
      .maybeSingle();

    if (bErr) {
      Alert.alert('Error', bErr.message);
      setLoading(false);
      return;
    }

    setBenefit(bData);

    // User redemptions for this benefit
    if (user?.id) {
      const { data: rData, error: rErr } = await supabase
        .from('benefit_redemptions')
        .select('*')
        .eq('benefit_id', benefitId)
        .eq('user_id', user.id);

      if (rErr) {
        Alert.alert('Error', rErr.message);
      } else {
        setRedemptions(rData ?? []);
      }
    }

    setLoading(false);
  }, [benefitId, user?.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  // ── Computed ──────────────────────────────────────────────────────────────

  const redeemedCount = redemptions.filter((r) => r.status === 'redeemed').length;
  const hasPending    = redemptions.some((r) => r.status === 'pending');
  const maxUses       = benefit?.max_uses_per_user;
  const isExhausted   = maxUses != null && redeemedCount >= maxUses;
  const company       = benefit?.partner_companies ?? null;

  // ── CTA label / state ─────────────────────────────────────────────────────

  let ctaLabel    = 'GENERAR CUPÓN';
  let ctaDisabled = false;

  if (isExhausted) {
    ctaLabel    = 'GENERAR CUPÓN';
    ctaDisabled = true;
  } else if (hasPending) {
    ctaLabel = 'VER MI CUPÓN';
  }

  const handleCta = () => {
    navigation.navigate('ClubCupon', { benefitId });
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.gold} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!benefit) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <WCHeader title="Beneficio" onBack={() => navigation.goBack()} kicker="CLUB BIRREOSO" />
          <View style={styles.loadingWrap}>
            <Text style={styles.errorText}>Beneficio no encontrado.</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const descuento = descuentoLabel(benefit);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl * 2 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.gold}
              colors={[COLORS.gold]}
            />
          }
        >
          {/* Header */}
          <WCHeader
            title={benefit.titulo}
            kicker="CLUB BIRREOSO"
            onBack={() => navigation.goBack()}
          />

          {/* Banner imagen */}
          {!!benefit.imagen_url && (
            <View style={styles.bannerWrap}>
              <Image
                source={{ uri: benefit.imagen_url }}
                style={styles.bannerImage}
                resizeMode="cover"
              />
            </View>
          )}

          {/* Título + empresa + descuento */}
          <WCCard accent="gold" style={styles.heroCard}>
            {!!company?.nombre && (
              <Text style={styles.companyName}>{company.nombre.toUpperCase()}</Text>
            )}
            <Text style={styles.benefitTitulo}>{benefit.titulo}</Text>
            <Text style={styles.descuentoLabel}>{descuento}</Text>

            {/* Badges: canal + estado agotado */}
            <View style={styles.badgeRow}>
              {!!benefit.channel && (
                <WCBadge
                  label={channelLabel(benefit.channel)}
                  tone={channelTone(benefit.channel)}
                  size="md"
                />
              )}
              {isExhausted && (
                <WCBadge label="Ya usado" tone="finalizado" size="md" />
              )}
            </View>
          </WCCard>

          {/* Meta-info: vigencia + usos */}
          <View style={styles.metaRow}>
            <View style={styles.metaTile}>
              <Text style={styles.metaLabel}>VIGENCIA</Text>
              <Text style={styles.metaValue}>{vigenciaText(benefit)}</Text>
            </View>
            <View style={[styles.metaTile, styles.metaTileRight]}>
              <Text style={styles.metaLabel}>USOS</Text>
              <Text style={styles.metaValue}>{usosText(benefit.max_uses_per_user)}</Text>
            </View>
          </View>

          {/* Descripción */}
          {!!benefit.descripcion && (
            <WCBlock title="Descripción" style={styles.block}>
              <Text style={styles.bodyText}>{benefit.descripcion}</Text>
            </WCBlock>
          )}

          {/* Código online */}
          {benefit.channel === 'online' && !!benefit.codigo_online && (
            <WCCard accent="neon" style={styles.block}>
              <Text style={styles.onlineTitulo}>CÓDIGO ONLINE</Text>
              <Text style={styles.onlineCodigo}>{benefit.codigo_online}</Text>
              <Text style={styles.onlineHint}>
                Ingresá este código en la tienda online del comercio para aplicar el descuento.
              </Text>
            </WCCard>
          )}

          {/* Términos */}
          {!!benefit.terminos && (
            <WCBlock title="Términos y condiciones" style={styles.block}>
              <Text style={styles.bodyTextSmall}>{benefit.terminos}</Text>
            </WCBlock>
          )}

          {/* CTA */}
          <View style={styles.ctaWrap}>
            {isExhausted ? (
              <WCBadge label="Beneficio ya utilizado" tone="finalizado" size="md" />
            ) : null}
            <WCButton
              label={ctaLabel}
              variant="gold"
              size="lg"
              disabled={ctaDisabled}
              onPress={handleCta}
              style={styles.ctaButton}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xxl,
  },
  errorText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    textAlign: 'center',
  },

  // Banner
  bannerWrap: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    ...SHADOWS.card,
  },
  bannerImage: {
    width: '100%',
    height: 200,
  },

  // Hero card
  heroCard: {
    marginBottom: SPACING.md,
  },
  companyName: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.gold,
    letterSpacing: 2.5,
    marginBottom: SPACING.xs,
  },
  benefitTitulo: {
    fontFamily: FONTS.heading,
    fontSize: 30,
    color: COLORS.white,
    letterSpacing: 1.5,
    lineHeight: 34,
    marginBottom: SPACING.sm,
  },
  descuentoLabel: {
    fontFamily: FONTS.heading,
    fontSize: 44,
    color: COLORS.gold,
    letterSpacing: 2,
    marginBottom: SPACING.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: SPACING.xs,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  metaTile: {
    flex: 1,
    backgroundColor: WC_ALPHA.cardDark,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: WC_ALPHA.divider,
  },
  metaTileRight: {
    borderColor: COLORS.gold + '44',
  },
  metaLabel: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.gray2,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  metaValue: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.white,
    lineHeight: 18,
  },

  // Blocks
  block: {
    marginBottom: SPACING.md,
  },
  bodyText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    lineHeight: 21,
  },
  bodyTextSmall: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    lineHeight: 18,
  },

  // Online code
  onlineTitulo: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.neon,
    letterSpacing: 2.5,
    marginBottom: SPACING.sm,
  },
  onlineCodigo: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.neon,
    letterSpacing: 4,
    marginBottom: SPACING.sm,
  },
  onlineHint: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    lineHeight: 17,
  },

  // CTA
  ctaWrap: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
    alignItems: 'stretch',
  },
  ctaButton: {
    width: '100%',
  },
});
