import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image,
  ActivityIndicator, Alert, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { qrToDataURL } from '../../../lib/qr';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import {
  WCCard, WCButton, WCBadge, WCEmptyState, WCHeader,
} from '../../../components/mundial/WCComponents';

function descuentoLabel(benefit) {
  if (!benefit) return '';
  switch (benefit.tipo) {
    case 'porcentaje': return benefit.valor_num + '% OFF';
    case 'monto':      return '$' + benefit.valor_num + ' OFF';
    case '2x1':        return '2x1';
    case 'regalo':     return 'Regalo';
    default:           return benefit.titulo;
  }
}

function formatFecha(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('es-PA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ClubCuponScreen({ route, navigation }) {
  const { benefitId } = route.params;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [benefit, setBenefit] = useState(null);   // objeto de partner_benefits + partner_companies
  const [code, setCode] = useState(null);
  const [qrUri, setQrUri] = useState(null);
  const [redemption, setRedemption] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);

      // 1) Detalle del beneficio + empresa (para mostrar; el RPC solo da el code)
      const { data: b } = await supabase
        .from('partner_benefits')
        .select('*, partner_companies(*)')
        .eq('id', benefitId)
        .maybeSingle();
      if (!cancelled) setBenefit(b);

      // 2) Generar / obtener el cupon
      const { data, error } = await supabase.rpc('generate_benefit_coupon', {
        p_benefit_id: benefitId,
      });
      if (cancelled) return;
      if (error) {
        Alert.alert('No se pudo generar el cupón', error.message);
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }
      setCode(data.code);

      // 3) QR (no critico) — JS puro, web + native
      const uri = qrToDataURL(data.code, { size: 260 });
      if (!cancelled && uri) setQrUri(uri);

      // 4) Estado del cupon
      const { data: red } = await supabase
        .from('benefit_redemptions')
        .select('status, redeemed_at')
        .eq('code', data.code)
        .maybeSingle();
      if (!cancelled) setRedemption(red);

      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [benefitId]);

  const company = benefit?.partner_companies ?? null;
  const channel = benefit?.channel ?? 'presencial';

  const handleCompartir = async () => {
    if (!code) return;
    const texto =
      `Mi cupón ${descuentoLabel(benefit)} en ${company?.nombre ?? 'Birrea2Play'}: ${code}\n` +
      `Birrea2Play — https://birrea2play.com`;
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ text: texto }).catch(() => {});
      } else {
        Alert.alert('Compartir', texto);
      }
    } else {
      Share.share({ message: texto }).catch(() => {});
    }
  };

  if (loading) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <WCHeader title="MI CUPÓN" kicker="CLUB BIRREOSO" onBack={() => navigation.goBack()} />
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.gold} />
            <Text style={styles.loadingText}>Generando cupón…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <WCHeader title="MI CUPÓN" kicker="CLUB BIRREOSO" onBack={() => navigation.goBack()} />
          <WCEmptyState
            icon="🎟️"
            title="Cupón no disponible"
            message={errorMsg}
            action={<WCButton label="VOLVER" variant="ghost" size="md" onPress={() => navigation.goBack()} />}
          />
        </SafeAreaView>
      </View>
    );
  }

  const isRedeemed = redemption?.status === 'redeemed';

  let canalInstruccion = 'Mostrá este código en el local';
  if (channel === 'online') canalInstruccion = 'Usá este código al pagar en línea';
  else if (channel === 'ambos') canalInstruccion = 'Mostrá este código en el local o usalo al pagar en línea';

  return (
    <View style={styles.frame}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ padding: SPACING.md, paddingBottom: SPACING.xxl * 2 }}
          showsVerticalScrollIndicator={false}
        >
          <WCHeader title="MI CUPÓN" kicker="CLUB BIRREOSO" onBack={() => navigation.goBack()} />

          <WCCard accent="gold" style={styles.infoCard}>
            <View style={styles.badgeRow}>
              <WCBadge label={descuentoLabel(benefit)} tone="gold" size="md" />
              {channel === 'presencial' && <WCBadge label="PRESENCIAL" tone="neutral" size="sm" />}
              {channel === 'online'    && <WCBadge label="ONLINE" tone="blue" size="sm" />}
              {channel === 'ambos'     && <WCBadge label="PRESENCIAL + ONLINE" tone="neon" size="sm" />}
            </View>
            <Text style={styles.benefitTitle}>{benefit?.titulo}</Text>
            {company?.nombre ? <Text style={styles.companyName}>{company.nombre}</Text> : null}
          </WCCard>

          <WCCard variant="light" style={styles.qrCard}>
            {isRedeemed && (
              <View style={styles.usadoBanner}>
                <WCBadge label="USADO" tone="finalizado" size="md" />
                <Text style={styles.usadoFecha}>Canjeado el {formatFecha(redemption.redeemed_at)}</Text>
              </View>
            )}

            <View style={[styles.qrWrap, isRedeemed && styles.qrDimmed]}>
              {qrUri ? (
                <Image source={{ uri: qrUri }} style={styles.qrImage} resizeMode="contain" />
              ) : (
                <View style={styles.qrFallback}>
                  <Text style={styles.qrFallbackText}>QR no disponible</Text>
                </View>
              )}
            </View>

            <Text style={[styles.codeText, isRedeemed && styles.codeTextDimmed]} selectable>
              {code}
            </Text>

            <Text style={styles.canalText}>{canalInstruccion}</Text>

            {channel !== 'presencial' && benefit?.codigo_online ? (
              <View style={styles.codigoOnlineRow}>
                <Text style={styles.codigoOnlineLabel}>CÓDIGO ONLINE</Text>
                <Text style={styles.codigoOnlineValue} selectable>{benefit.codigo_online}</Text>
              </View>
            ) : null}
          </WCCard>

          <View style={styles.notaWrap}>
            <Text style={styles.notaText}>El comercio valida tu cupón. Cada cupón se usa una sola vez.</Text>
          </View>

          <WCButton
            label="COMPARTIR CUPÓN"
            variant="ghost"
            size="md"
            leadingIcon="↑"
            onPress={handleCompartir}
            style={styles.shareBtn}
          />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: COLORS.bg },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  loadingText: { fontFamily: FONTS.body, fontSize: 14, color: COLORS.gray2 },

  infoCard: { marginBottom: SPACING.md },
  badgeRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', marginBottom: SPACING.sm },
  benefitTitle: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.white, letterSpacing: 1.5, marginBottom: 2 },
  companyName: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.gold, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },

  qrCard: { marginBottom: SPACING.md, alignItems: 'center', paddingVertical: SPACING.lg },
  usadoBanner: { alignItems: 'center', marginBottom: SPACING.md, gap: SPACING.xs },
  usadoFecha: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.bg, marginTop: 4 },
  qrWrap: { marginBottom: SPACING.md },
  qrDimmed: { opacity: 0.35 },
  qrImage: { width: 260, height: 260, borderRadius: RADIUS.md, alignSelf: 'center' },
  qrFallback: { width: 260, height: 260, borderRadius: RADIUS.md, backgroundColor: COLORS.line, alignItems: 'center', justifyContent: 'center' },
  qrFallbackText: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.gray2 },

  codeText: { fontFamily: FONTS.heading, fontSize: 30, color: COLORS.bg, letterSpacing: 5, textAlign: 'center', marginBottom: SPACING.sm },
  codeTextDimmed: { opacity: 0.45 },
  canalText: { fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.bg, textAlign: 'center', letterSpacing: 0.5, marginBottom: SPACING.sm },

  codigoOnlineRow: { marginTop: SPACING.sm, alignItems: 'center', backgroundColor: COLORS.bg + '0D', borderRadius: RADIUS.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderWidth: 1, borderColor: COLORS.bg + '22', width: '100%' },
  codigoOnlineLabel: { fontFamily: FONTS.bodyBold, fontSize: 10, color: COLORS.bg, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 },
  codigoOnlineValue: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.bg, letterSpacing: 3 },

  notaWrap: { backgroundColor: COLORS.gold + '14', borderColor: COLORS.gold + '44', borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md },
  notaText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gold, textAlign: 'center', lineHeight: 18 },
  shareBtn: { marginTop: SPACING.xs },
});
