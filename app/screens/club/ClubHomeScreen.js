import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import useClubStore from '../../../store/clubStore';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCSectionTitle,
  WCEmptyState,
  WCHeader,
  WC_ALPHA,
} from '../../../components/mundial/WCComponents';

// ─── Helpers ─────────────────────────────────────────────────

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function groupByCategoria(companies) {
  const map = {};
  for (const c of companies) {
    const key = c.categoria ?? 'Otros';
    if (!map[key]) map[key] = [];
    map[key].push(c);
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
}

// ─── CompanyCard ─────────────────────────────────────────────

function CompanyCard({ company, benefitCount, onPress }) {
  const initials = (company.nombre ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <TouchableOpacity activeOpacity={0.82} onPress={onPress} style={styles.companyCardTouch}>
      <WCCard accent="gold" style={styles.companyCard}>
        <View style={styles.companyRow}>
          {company.logo_url ? (
            <Image
              source={{ uri: company.logo_url }}
              style={styles.companyLogo}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.companyLogoFallback}>
              <Text style={styles.companyLogoInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.companyInfo}>
            <Text style={styles.companyNombre} numberOfLines={1}>
              {company.nombre}
            </Text>
            <WCBadge
              label={capitalize(company.categoria ?? 'Otro')}
              tone="gold"
              size="sm"
            />
            <Text style={styles.companyBenefits}>
              {benefitCount === 1
                ? '1 beneficio'
                : `${benefitCount ?? 0} beneficios`}
            </Text>
          </View>
          <Text style={styles.companyChevron}>›</Text>
        </View>
      </WCCard>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────

export default function ClubHomeScreen({ navigation }) {
  const { user } = useAuthStore();
  const { settings, myCompanies, loadSettings, loadMyCompanies, isStaff } = useClubStore();

  const [companies, setCompanies] = useState([]);
  const [benefitCounts, setBenefitCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCameraPrompt, setShowCameraPrompt] = useState(false);
  const [requestingCamera, setRequestingCamera] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Companies
      const { data: companiesData, error: companiesError } = await supabase
        .from('partner_companies')
        .select('*')
        .eq('activo', true)
        .order('orden')
        .order('nombre');

      if (companiesError) {
        Alert.alert('Error', companiesError.message);
        return;
      }

      setCompanies(companiesData ?? []);

      // Benefit counts per company_id
      const { data: benefitsData, error: benefitsError } = await supabase
        .from('partner_benefits')
        .select('company_id')
        .eq('activo', true);

      if (benefitsError) {
        Alert.alert('Error', benefitsError.message);
        return;
      }

      const counts = {};
      for (const b of benefitsData ?? []) {
        counts[b.company_id] = (counts[b.company_id] ?? 0) + 1;
      }
      setBenefitCounts(counts);
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Error al cargar el Club');
    }
  }, []);

  const loadAll = useCallback(async () => {
    loadSettings();
    if (user?.id) loadMyCompanies(user.id);
    await fetchData();
  }, [user?.id, loadSettings, loadMyCompanies, fetchData]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll();
      setLoading(false);
    })();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  const grouped = groupByCategoria(companies);
  const isAdmin = user?.role === 'admin';
  const staffMode = isStaff();

  useEffect(() => {
    if (!loading && staffMode && Platform.OS === 'web') {
      setShowCameraPrompt(true);
    }
  }, [loading, staffMode]);

  const openScannerWithCamera = useCallback(async () => {
    if (Platform.OS !== 'web') {
      setShowCameraPrompt(false);
      navigation.navigate('ClubScanner');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      Alert.alert('Cámara no disponible', 'Este navegador no permite usar la cámara.');
      return;
    }

    setRequestingCamera(true);
    try {
      // Esta llamada ocurre directamente desde el toque del gestor, requisito
      // de navegadores móviles/PWA para mostrar el permiso del sistema.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      stream.getTracks().forEach((track) => track.stop());
      setShowCameraPrompt(false);
      navigation.navigate('ClubScanner');
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        Alert.alert(
          'Permiso de cámara bloqueado',
          'Permití la cámara para birrea2play.com desde la configuración del sitio y volvé a intentarlo.'
        );
      } else {
        Alert.alert('No se pudo abrir la cámara', err?.message ?? 'Intentá nuevamente.');
      }
    } finally {
      setRequestingCamera(false);
    }
  }, [navigation]);

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.frame}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.gold} />
            <Text style={styles.loadingText}>Cargando Club...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top']}>
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
          {/* Header */}
          <View style={styles.heroWrap}>
            <Text style={styles.heroKicker}>BIRREA2PLAY</Text>
            <Text style={styles.heroTitle}>CLUB BIRREOSO</Text>
            <Text style={styles.heroSubtitle}>Beneficios y descuentos para socios</Text>
          </View>

          {/* Admin banner: club oculto */}
          {isAdmin && settings && settings.is_visible === false && (
            <View style={styles.adminBanner}>
              <Text style={styles.adminBannerLabel}>MODO ADMIN</Text>
              <Text style={styles.adminBannerText}>
                El Club está oculto a usuarios. Activalo desde el panel admin.
              </Text>
            </View>
          )}

          {/* Mi carne de socio */}
          <WCButton
            label="Mi carne de socio"
            variant="gold"
            size="lg"
            leadingIcon="🎫"
            onPress={() => navigation.navigate('ClubCarne')}
            style={styles.carneBtn}
          />

          {/* Comercio aliado banner */}
          {staffMode && (
            <WCCard accent="gold" style={styles.comercioCard}>
              <Text style={styles.comercioTitle}>Sos comercio aliado</Text>
              <Text style={styles.comercioSub}>
                Gestioná cupones y tu vitrina desde acá.
              </Text>
              <View style={styles.comercioBtns}>
                <WCButton
                  label="Validar cupones"
                  variant="gold"
                  size="md"
                  leadingIcon="📷"
                  onPress={openScannerWithCamera}
                  style={styles.comercioBtnItem}
                />
                <WCButton
                  label="Historial"
                  variant="ghost"
                  size="md"
                  leadingIcon="📋"
                  onPress={() => navigation.navigate('ClubHistorial')}
                  style={styles.comercioBtnItem}
                />
                {myCompanies.length > 0 && (
                  <WCButton
                    label="Mi galería"
                    variant="ghost"
                    size="md"
                    leadingIcon="🖼️"
                    onPress={() =>
                      navigation.navigate('ClubGaleria', {
                        companyId: myCompanies[0].id,
                      })
                    }
                    style={styles.comercioBtnItem}
                  />
                )}
              </View>
            </WCCard>
          )}

          {/* Companies list grouped by categoria */}
          {companies.length === 0 ? (
            <WCEmptyState
              icon="🎁"
              title="Sin beneficios todavia"
              message="Pronto vas a ver descuentos de comercios aliados."
            />
          ) : (
            grouped.map(([categoria, cats]) => (
              <View key={categoria}>
                <WCSectionTitle accent="gold">
                  {capitalize(categoria)}
                </WCSectionTitle>
                {cats.map((c) => (
                  <CompanyCard
                    key={c.id}
                    company={c}
                    benefitCount={benefitCounts[c.id] ?? 0}
                    onPress={() =>
                      navigation.navigate('ClubEmpresa', { companyId: c.id })
                    }
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>

        <Modal
          visible={showCameraPrompt}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCameraPrompt(false)}
        >
          <View style={styles.cameraPromptOverlay}>
            <WCCard accent="gold" style={styles.cameraPromptCard}>
              <Text style={styles.cameraPromptIcon}>📷</Text>
              <Text style={styles.cameraPromptTitle}>ACTIVAR CÁMARA</Text>
              <Text style={styles.cameraPromptBody}>
                Birrea2Play necesita la cámara para escanear los códigos QR de los socios y validar sus beneficios.
              </Text>
              <WCButton
                label={requestingCamera ? 'Solicitando permiso...' : 'Permitir cámara'}
                variant="gold"
                size="lg"
                onPress={openScannerWithCamera}
                loading={requestingCamera}
                disabled={requestingCamera}
              />
              <WCButton
                label="Ahora no"
                variant="ghost"
                size="md"
                onPress={() => setShowCameraPrompt(false)}
                disabled={requestingCamera}
              />
            </WCCard>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl * 2,
  },

  // Loading
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: SPACING.md,
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
  },

  // Hero header
  heroWrap: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    marginBottom: SPACING.md,
  },
  heroKicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 10,
    color: COLORS.gold,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  heroTitle: {
    fontFamily: FONTS.heading,
    fontSize: 44,
    color: COLORS.white,
    letterSpacing: 2,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Admin banner
  adminBanner: {
    backgroundColor: WC_ALPHA.cardLight,
    borderColor: COLORS.gold + '88',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  adminBannerLabel: {
    fontFamily: FONTS.heading,
    fontSize: 13,
    color: COLORS.bg,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  adminBannerText: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.bg,
    lineHeight: 18,
  },

  // Carne de socio button
  carneBtn: {
    marginBottom: SPACING.md,
  },

  // Comercio banner
  comercioCard: {
    marginBottom: SPACING.md,
  },
  comercioTitle: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.gold,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  comercioSub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  comercioBtns: {
    gap: SPACING.sm,
  },
  comercioBtnItem: {
    marginBottom: 0,
  },

  // Company cards
  companyCardTouch: {
    marginBottom: SPACING.sm,
  },
  companyCard: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  companyLogo: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
  },
  companyLogoFallback: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold + '22',
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  companyLogoInitials: {
    fontFamily: FONTS.heading,
    fontSize: 20,
    color: COLORS.gold,
    letterSpacing: 1,
  },
  companyInfo: {
    flex: 1,
    gap: 4,
  },
  companyNombre: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  companyBenefits: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    marginTop: 2,
  },
  companyChevron: {
    fontFamily: FONTS.bodyBold,
    fontSize: 22,
    color: COLORS.gold,
    paddingLeft: SPACING.xs,
  },
  cameraPromptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  cameraPromptCard: {
    width: '100%',
    maxWidth: 420,
    gap: SPACING.md,
  },
  cameraPromptIcon: {
    fontSize: 44,
    textAlign: 'center',
  },
  cameraPromptTitle: {
    fontFamily: FONTS.heading,
    color: COLORS.white,
    fontSize: 22,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  cameraPromptBody: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
