import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCSectionTitle,
  WCEmptyState,
  WCHeader,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

// ─── helpers ─────────────────────────────────────────────────

function descuentoLabel(b) {
  if (b.tipo === 'porcentaje') return b.valor_num + '% OFF';
  if (b.tipo === 'monto')      return '$' + b.valor_num + ' OFF';
  if (b.tipo === '2x1')        return '2x1';
  if (b.tipo === 'regalo')     return 'Regalo';
  return b.titulo;
}

function channelLabel(channel) {
  if (channel === 'presencial') return 'Presencial';
  if (channel === 'online')     return 'Online';
  if (channel === 'ambos')      return 'Pres. + Online';
  return channel ?? '';
}

function fmtVence(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `vence ${dd}/${mm}`;
}

function digitsOnly(str) {
  return (str ?? '').replace(/\D/g, '');
}

// ─── ProductCard (galería horizontal) ────────────────────────

function ProductCard({ product }) {
  return (
    <View style={styles.productCard}>
      {product.imagen_url ? (
        <Image
          source={{ uri: product.imagen_url }}
          style={styles.productImg}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.productImgPlaceholder}>
          <Text style={styles.productImgLetter}>
            {(product.nombre ?? '?')[0].toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.productBody}>
        <Text style={styles.productNombre} numberOfLines={2}>{product.nombre}</Text>
        {product.precio != null && (
          <Text style={styles.productPrecio}>${Number(product.precio).toFixed(2)}</Text>
        )}
      </View>
    </View>
  );
}

// ─── BenefitRow ───────────────────────────────────────────────

function BenefitRow({ benefit, onPress }) {
  const label  = descuentoLabel(benefit);
  const vence  = fmtVence(benefit.valido_hasta);
  const chLbl  = channelLabel(benefit.channel);

  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress}>
      <WCCard accent="gold" style={styles.benefitCard}>
        <View style={styles.benefitTop}>
          <Text style={styles.benefitTitulo} numberOfLines={2}>{benefit.titulo}</Text>
          <Text style={styles.benefitDescuento}>{label}</Text>
        </View>
        <View style={styles.benefitBottom}>
          <WCBadge label={chLbl} tone="gold" size="sm" />
          {vence && (
            <Text style={styles.benefitVence}>{vence}</Text>
          )}
        </View>
      </WCCard>
    </TouchableOpacity>
  );
}

// ─── ContactRow ───────────────────────────────────────────────

function ContactRow({ icon, label, onPress }) {
  const El = onPress ? TouchableOpacity : View;
  return (
    <El
      activeOpacity={0.78}
      onPress={onPress}
      style={styles.contactRow}
    >
      <Text style={styles.contactIcon}>{icon}</Text>
      <Text style={[styles.contactLabel, onPress && { color: COLORS.gold }]} numberOfLines={1}>
        {label}
      </Text>
    </El>
  );
}

// ─── Main screen ──────────────────────────────────────────────

export default function ClubEmpresaScreen({ route, navigation }) {
  const { companyId } = route.params;

  const [company,   setCompany]   = useState(null);
  const [benefits,  setBenefits]  = useState([]);
  const [products,  setProducts]  = useState([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [compRes, benRes, prodRes] = await Promise.all([
        supabase.from('partner_companies').select('*').eq('id', companyId).maybeSingle(),
        supabase.from('partner_benefits').select('*').eq('company_id', companyId).eq('activo', true).order('orden'),
        supabase.from('partner_products').select('*').eq('company_id', companyId).eq('activo', true).order('orden'),
      ]);

      if (compRes.error)  Alert.alert('Error', compRes.error.message);
      if (benRes.error)   Alert.alert('Error', benRes.error.message);
      if (prodRes.error)  Alert.alert('Error', prodRes.error.message);

      setCompany(company => compRes.data ?? company);
      setBenefits(benRes.data ?? []);
      setProducts(prodRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── loading state ──
  if (loading) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <WCHeader
            title="Cargando..."
            kicker="CLUB BIRREOSO"
            onBack={() => navigation.goBack()}
          />
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.gold} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── company not found ──
  if (!company) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <WCHeader
            title="Empresa"
            kicker="CLUB BIRREOSO"
            onBack={() => navigation.goBack()}
          />
          <WCEmptyState
            icon="🏪"
            title="Empresa no encontrada"
            message="Este comercio no está disponible."
          />
        </SafeAreaView>
      </View>
    );
  }

  // ── avatar letter fallback ──
  const initial = (company.nombre ?? '?')[0].toUpperCase();

  return (
    <View style={styles.frame}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <WCHeader
            title={company.nombre}
            kicker="CLUB BIRREOSO"
            onBack={() => navigation.goBack()}
          />

          {/* ── COMPANY CARD ── */}
          <WCCard accent="gold" style={styles.companyCard}>
            {/* Logo + nombre */}
            <View style={styles.companyHero}>
              {company.logo_url ? (
                <Image
                  source={{ uri: company.logo_url }}
                  style={styles.logo}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.logoFallback}>
                  <Text style={styles.logoLetter}>{initial}</Text>
                </View>
              )}
              <View style={styles.companyMeta}>
                <Text style={styles.companyNombre}>{company.nombre}</Text>
                {company.categoria ? (
                  <WCBadge label={company.categoria} tone="neutral" size="sm" />
                ) : null}
              </View>
            </View>

            {/* Descripción */}
            {!!company.descripcion && (
              <Text style={styles.companyDesc}>{company.descripcion}</Text>
            )}

            {/* Separador */}
            <View style={styles.divider} />

            {/* Contacto */}
            <View style={styles.contactList}>
              {!!company.telefono && (
                <ContactRow
                  icon="📞"
                  label={company.telefono}
                  onPress={() => Linking.openURL('tel:' + digitsOnly(company.telefono))}
                />
              )}
              {!!company.whatsapp && (
                <ContactRow
                  icon="💬"
                  label={company.whatsapp}
                  onPress={() => Linking.openURL('https://wa.me/' + digitsOnly(company.whatsapp))}
                />
              )}
              {!!company.instagram && (
                <ContactRow
                  icon="📸"
                  label={'@' + company.instagram.replace(/^@/, '')}
                  onPress={() =>
                    Linking.openURL('https://instagram.com/' + company.instagram.replace(/^@/, ''))
                  }
                />
              )}
              {!!company.website && (
                <ContactRow
                  icon="🌐"
                  label={company.website}
                  onPress={() => Linking.openURL(
                    company.website.startsWith('http') ? company.website : 'https://' + company.website
                  )}
                />
              )}
              {!!company.direccion && (
                <ContactRow icon="📍" label={company.direccion} />
              )}
              {!!company.distrito && (
                <ContactRow icon="🗺️" label={company.distrito} />
              )}
            </View>
          </WCCard>

          {/* ── BENEFICIOS ── */}
          <WCSectionTitle accent="gold" sub="Tocá un beneficio para ver los detalles y generar tu cupón">
            BENEFICIOS
          </WCSectionTitle>

          {benefits.length === 0 ? (
            <WCEmptyState
              icon="🎁"
              title="Sin beneficios activos"
              message="Este comercio aún no tiene beneficios disponibles para socios."
            />
          ) : (
            <View style={styles.benefitsList}>
              {benefits.map((b) => (
                <BenefitRow
                  key={b.id}
                  benefit={b}
                  onPress={() => navigation.navigate('ClubBeneficio', { benefitId: b.id })}
                />
              ))}
            </View>
          )}

          {/* ── GALERÍA DE PRODUCTOS ── */}
          {products.length > 0 && (
            <>
              <WCSectionTitle accent="gold">PRODUCTOS</WCSectionTitle>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.productsScroll}
              >
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </ScrollView>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl * 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xxl,
  },

  // Company card
  companyCard: {
    marginBottom: SPACING.md,
  },
  companyHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
  },
  logoFallback: {
    width: 72,
    height: 72,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold + '22',
    borderWidth: 1,
    borderColor: COLORS.gold + '88',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    fontFamily: FONTS.heading,
    fontSize: 32,
    color: COLORS.gold,
  },
  companyMeta: {
    flex: 1,
    gap: SPACING.xs,
  },
  companyNombre: {
    fontFamily: FONTS.heading,
    fontSize: 26,
    color: COLORS.white,
    letterSpacing: 1,
  },
  companyDesc: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    lineHeight: 21,
    marginBottom: SPACING.sm,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.line,
    marginVertical: SPACING.sm,
  },

  // Contact
  contactList: {
    gap: SPACING.xs,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: 6,
    minHeight: 36,
  },
  contactIcon: {
    fontSize: 16,
    width: 24,
    textAlign: 'center',
  },
  contactLabel: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    flex: 1,
  },

  // Benefits
  benefitsList: {
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  benefitCard: {
    gap: SPACING.sm,
  },
  benefitTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  benefitTitulo: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
    flex: 1,
    lineHeight: 20,
  },
  benefitDescuento: {
    fontFamily: FONTS.heading,
    fontSize: 22,
    color: COLORS.gold,
    letterSpacing: 1,
    flexShrink: 0,
  },
  benefitBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  benefitVence: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray2,
  },

  // Products gallery
  productsScroll: {
    gap: SPACING.sm,
    paddingBottom: SPACING.sm,
    paddingRight: SPACING.md,
  },
  productCard: {
    width: 140,
    backgroundColor: WC_ALPHA.cardDark,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: WC_ALPHA.divider,
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  productImg: {
    width: 140,
    height: 120,
    backgroundColor: COLORS.card,
  },
  productImgPlaceholder: {
    width: 140,
    height: 120,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImgLetter: {
    fontFamily: FONTS.heading,
    fontSize: 40,
    color: COLORS.gray2,
  },
  productBody: {
    padding: SPACING.sm,
    gap: 4,
  },
  productNombre: {
    fontFamily: FONTS.bodyBold,
    fontSize: 13,
    color: COLORS.white,
    lineHeight: 17,
  },
  productPrecio: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.gold,
    letterSpacing: 0.5,
  },
});
