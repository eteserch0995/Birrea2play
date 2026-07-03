import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  Share,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { qrToDataURL } from '../../../lib/qr';

import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import useAuthStore from '../../../store/authStore';
import { isTema2Active } from '../../../lib/tema2';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCHeader,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

function formatSocioDesdeFecha(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('es-PA', {
      year: 'numeric',
      month: 'long',
    });
  } catch (_) {
    return '';
  }
}

function roleLabel(role) {
  if (!role) return 'Socio';
  if (role === 'admin') return 'Admin';
  if (role === 'staff') return 'Staff';
  if (role === 'comercio') return 'Comercio';
  return 'Socio';
}

export default function ClubCarneScreen({ navigation }) {
  const { user } = useAuthStore();
  const [qrUri, setQrUri] = useState(null);
  const [qrLoading, setQrLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) return;
    setQrLoading(true);
    const uri = qrToDataURL('B2P-SOCIO:' + user.id, { size: 220 });
    if (!cancelled) { setQrUri(uri); setQrLoading(false); }
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleCompartir = useCallback(async () => {
    const codigo = user?.id ? `B2P-SOCIO:${user.id}` : '';
    const message =
      'Soy socio de Birrea2Play' +
      (codigo ? `\nCódigo de socio: ${codigo}` : '') +
      '\nhttps://birrea2play.com';
    try {
      await Share.share({ message });
    } catch (_) {}
  }, [user?.id]);

  const initials = user?.nombre
    ? user.nombre
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
    : '?';

  const socioDesdeFecha = formatSocioDesdeFecha(user?.created_at);
  const badge = roleLabel(user?.role);
  // Tema2: el carné se vuelve carta holo. WCCard (componente compartido) no
  // reenvía dataSet/props extra al View interno, así que el holo se aplica
  // en un contenedor EXTERIOR propio de esta screen (no toca WCComponents.js).
  const tema2 = isTema2Active();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <WCHeader
            title="Mi Carne"
            kicker="CLUB BIRREOSO"
            onBack={() => navigation.goBack()}
          />

          {/* ── Carne premium ── */}
          {(() => {
            const carneCard = (
              <WCCard variant="glow" accent="gold" style={styles.carneCard}>
                {/* Franja superior dorada */}
                <View style={styles.goldStripe} />

            {/* Avatar */}
            <View style={styles.avatarWrap}>
              {user?.foto_url ? (
                <Image
                  source={{ uri: user.foto_url }}
                  style={styles.avatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
            </View>

            {/* Nombre */}
            <Text style={styles.nombre} numberOfLines={2}>
              {user?.nombre ?? '—'}
            </Text>

            {/* Role badge */}
            <View style={styles.badgeRow}>
              <WCBadge label={badge} tone="gold" size="md" />
            </View>

            {/* Socio desde */}
            {socioDesdeFecha ? (
              <Text style={styles.socioDesdeTxt}>
                Socio desde {socioDesdeFecha}
              </Text>
            ) : null}

            {/* Separador */}
            <View style={styles.divider} />

            {/* QR sub-card */}
            <View style={styles.qrSubCard}>
              {qrLoading ? (
                <View style={styles.qrLoadingWrap}>
                  <ActivityIndicator size="large" color={COLORS.gold} />
                </View>
              ) : qrUri ? (
                <Image
                  source={{ uri: qrUri }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.qrLoadingWrap}>
                  <Text style={styles.qrErrorTxt}>No se pudo generar el QR</Text>
                </View>
              )}
              <Text style={styles.qrCaption}>
                Mostra este carne en comercios aliados
              </Text>
            </View>
              </WCCard>
            );
            // El foil (mix-blend color-dodge) es matemáticamente inerte sobre
            // negro/blanco puros (satura a negro/blanco sin alterar el valor),
            // así que no distorsiona el QR (blanco/negro) aunque el ::after
            // quede por encima de la sub-card del QR.
            return tema2 ? (
              <View style={styles.carneHoloWrap} dataSet={{ t2Holo: 'auto', t2Tilt: '', t2Glow: 'hero' }}>
                {carneCard}
              </View>
            ) : carneCard;
          })()}

          {/* ── Acciones ── */}
          <WCButton
            label="VER BENEFICIOS"
            variant="gold"
            size="lg"
            onPress={() => navigation.navigate('ClubHome')}
            style={styles.btnPrimary}
          />
          <WCButton
            label="COMPARTIR"
            variant="ghost"
            size="lg"
            onPress={handleCompartir}
            style={styles.btnSecondary}
          />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
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

  /* ── Tema2: contenedor holo exterior del carné (borderRadius/overflow
     propios, no existían a este nivel; solo se usan con tema2 activo) ── */
  carneHoloWrap: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    position: 'relative',
    // sin marginBottom propio: carneCard ya trae marginBottom: SPACING.lg,
    // evita duplicar el espaciado cuando el wrapper envuelve la card.
  },

  /* ── Carne card ── */
  carneCard: {
    alignItems: 'center',
    paddingTop: 0,
    paddingHorizontal: 0,
    paddingBottom: SPACING.lg,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
    borderColor: COLORS.gold + '99',
  },
  goldStripe: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.gold,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    marginBottom: SPACING.lg,
  },

  /* ── Avatar ── */
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: COLORS.gold,
    overflow: 'hidden',
    marginBottom: SPACING.md,
    ...SHADOWS.card,
  },
  avatar: {
    width: 96,
    height: 96,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    backgroundColor: COLORS.gold + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONTS.heading,
    fontSize: 36,
    color: COLORS.gold,
    letterSpacing: 2,
  },

  /* ── Info ── */
  nombre: {
    fontFamily: FONTS.heading,
    fontSize: 32,
    color: COLORS.white,
    letterSpacing: 2,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  badgeRow: {
    marginBottom: SPACING.sm,
  },
  socioDesdeTxt: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    letterSpacing: 0.5,
    marginBottom: SPACING.md,
  },

  /* ── Divider ── */
  divider: {
    width: '80%',
    height: 1,
    backgroundColor: COLORS.gold + '33',
    marginBottom: SPACING.lg,
  },

  /* ── QR sub-card ── */
  qrSubCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    marginHorizontal: SPACING.lg,
    ...SHADOWS.card,
  },
  qrLoadingWrap: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrImage: {
    width: 220,
    height: 220,
    borderRadius: RADIUS.sm,
  },
  qrErrorTxt: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.bg,
    textAlign: 'center',
  },
  qrCaption: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.bg,
    marginTop: SPACING.sm,
    textAlign: 'center',
    letterSpacing: 0.3,
  },

  /* ── Botones ── */
  btnPrimary: {
    marginBottom: SPACING.sm,
  },
  btnSecondary: {},
});
