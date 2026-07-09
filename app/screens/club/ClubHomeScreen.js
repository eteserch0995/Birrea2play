import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import useClubStore from '../../../store/clubStore';
import { iniciarBotonYappy, pollBotonOrder } from '../../../lib/yappy';
import { BottomSheetModal, Field } from '../../../components/ui';
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

// ─── Socio del Club (membresía paga $5/mes) ─────────────────
// Helpers de fecha en formato YYYY-MM-DD — comparables como strings.

// "Hoy" en TZ Panamá (mismo truco en-CA que App.js:getPanamaDayKey).
function getHoyPanama() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Panama',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Suma/resta meses a un YYYY-MM-DD sin depender de la TZ local del device
// (todo en UTC, así el resultado es determinístico sin importar dónde corra).
function addMonthsToDateStr(dateStr, deltaMonths) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m - 1) + deltaMonths, d));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// Fecha legible es-PA. Se ancla a T12:00:00 para no cruzar de día por TZ
// (mismo patrón que DonationCampaignScreen.js).
function formatFechaLegible(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString('es-PA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
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

// ─── VentaSocioCard — pitch de venta para no-socios ──────────

function VentaBeneficioRow({ icon, text }) {
  return (
    <View style={styles.ventaBeneficioRow}>
      <Text style={styles.ventaBeneficioIcon}>{icon}</Text>
      <Text style={styles.ventaBeneficioText}>{text}</Text>
    </View>
  );
}

function VentaSocioCard({ onComprar, onCanjeado }) {
  return (
    <WCCard accent="gold" style={styles.ventaCard}>
      <Text style={styles.ventaKicker}>CLUB BIRREOSO</Text>
      <Text style={styles.ventaTitle}>CARNÉ DE SOCIO</Text>
      <Text style={styles.ventaPrecio}>
        $5<Text style={styles.ventaPrecioSub}>/mes</Text>
      </Text>

      <View style={styles.ventaBeneficios}>
        <VentaBeneficioRow icon="⚽" text="10% de descuento en los eventos del mes (fútbol, volleyball y más)" />
        <VentaBeneficioRow icon="🏷️" text="Lista de descuentos en comercios aliados" />
        <VentaBeneficioRow icon="🎟️" text="1 invitado GRATIS a un evento del mes (1 vez por ciclo)" />
      </View>

      <Text style={styles.ventaNota}>
        Se renueva cada mes desde tu fecha de pago · Solo Yappy — si no renovás antes de las 11:59pm del día de vencimiento, se pierden los beneficios.
      </Text>

      <WCButton
        label="HACERME SOCIO — $5.00"
        variant="gold"
        size="lg"
        onPress={onComprar}
        style={{ marginTop: SPACING.md }}
      />

      <CanjeEmpresaBox onCanjeado={onCanjeado} />
    </WCCard>
  );
}

// ─── Canje de código de EMPRESA aliada (socios corporativos) ──────────
// La empresa recibe un código EMP-XXXXXX. Si su correo es del dominio
// corporativo → socio al instante; si no → queda pendiente de que el
// admin confirme que es colaborador.
function CanjeEmpresaBox({ onCanjeado }) {
  const [abierto, setAbierto]   = useState(false);
  const [codigo, setCodigo]     = useState('');
  const [enviando, setEnviando] = useState(false);

  async function canjear() {
    const code = codigo.trim();
    if (!code) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc('canjear_codigo_empresa', { p_codigo: code });
      if (error) throw error;
      if (data?.ok === false) {
        const msgs = {
          codigo_invalido: 'Ese código no corresponde a una empresa aliada activa.',
          convenio_vencido: 'El convenio de esa empresa venció — que tu empresa contacte a Birrea2Play.',
          sin_cupo_empresa: 'Tu empresa ya usó todos sus cupos de socios.',
        };
        throw new Error(msgs[data.error] ?? data.error);
      }
      if (data?.estado === 'activo') {
        Alert.alert('🎖 ¡Ya sos socio!', `Bienvenido, colaborador de ${data.empresa}. Tu carnet quedó activo con todos los beneficios.`);
        setAbierto(false); setCodigo('');
        onCanjeado?.();
      } else {
        Alert.alert(
          '⏳ Canje en revisión',
          `Registramos tu código de ${data.empresa}. Falta confirmar que sos colaborador — te avisamos por notificación apenas el equipo lo apruebe.`,
        );
        setAbierto(false); setCodigo('');
      }
    } catch (e) {
      Alert.alert('No se pudo canjear', e.message ?? 'Intentá de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <TouchableOpacity
        onPress={() => setAbierto(true)}
        activeOpacity={0.85}
        style={{
          marginTop: SPACING.md,
          borderWidth: 2,
          borderColor: COLORS.gold,
          borderRadius: RADIUS.md,
          paddingVertical: 16,
          paddingHorizontal: SPACING.md,
          alignItems: 'center',
          backgroundColor: COLORS.gold + '14',
        }}
      >
        <Text style={{ fontFamily: FONTS.heading, fontSize: 18, color: COLORS.gold, letterSpacing: 1 }}>
          🎟 TENGO UN CÓDIGO
        </Text>
        <Text style={{ fontFamily: FONTS.bodySemiBold, fontSize: 13, color: COLORS.gray2, marginTop: 4, textAlign: 'center' }}>
          Código empresarial o de Beneficiat — canjealo y activá tu carnet GRATIS
        </Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={{ marginTop: SPACING.md, gap: SPACING.sm }}>
      <TextInput
        style={{ borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md, color: COLORS.white, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONTS.bodySemiBold, letterSpacing: 1, textAlign: 'center' }}
        placeholder="EMP-XXXXXX o código de beneficio"
        placeholderTextColor={COLORS.gray}
        autoCapitalize="none"
        value={codigo}
        onChangeText={setCodigo}
      />
      <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
        <WCButton label={enviando ? '...' : 'CANJEAR'} variant="gold" onPress={canjear} disabled={enviando} style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => setAbierto(false)} style={{ justifyContent: 'center', paddingHorizontal: 10 }}>
          <Text style={{ color: COLORS.gray2, fontSize: 16 }}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── SocioActivoBanner — socio con membresía vigente ─────────

function SocioActivoBanner({ vence_el, invitadoUsado, onRenovar }) {
  return (
    <WCCard accent="gold" style={styles.socioBanner}>
      <View style={styles.socioBannerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.socioBannerTitle}>✅ Socio activo</Text>
          <Text style={styles.socioBannerSub}>Vence el {formatFechaLegible(vence_el)}</Text>
          <Text style={styles.socioBannerInvitado}>
            Invitado gratis del mes: {invitadoUsado ? 'Usado' : 'Disponible'}
          </Text>
        </View>
        <WCButton label="Renovar" variant="ghost" size="sm" onPress={onRenovar} />
      </View>
    </WCCard>
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

  // Socio del Club ($5/mes, solo Yappy) — decisión del dueño 2026-07-05.
  const [membresia, setMembresia] = useState(null); // { vence_el, invitado_gratis_usado_el } | null
  const [membresiaLoading, setMembresiaLoading] = useState(true);
  const [showPagoSheet, setShowPagoSheet] = useState(false);
  const [yappyPhone, setYappyPhone] = useState('');
  const [yappyEspera, setYappyEspera] = useState(false);
  const [procesandoPago, setProcesandoPago] = useState(false);
  const yappyCancelRef = useRef(null);

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

  // ── Membresía de socio ($5/mes) ──────────────────────────────
  const fetchMembresia = useCallback(async () => {
    if (!user?.id) { setMembresiaLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('club_membresias')
        .select('vence_el, invitado_gratis_usado_el')
        .eq('user_id', user.id) // sin esto el admin hereda la membresía de otro (RLS admin ve todo)
        .maybeSingle();
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      setMembresia(data ?? null);
    } catch (err) {
      Alert.alert('Error', err.message ?? 'Error al revisar tu membresía del Club');
    } finally {
      setMembresiaLoading(false);
    }
  }, [user?.id]);

  // Al montar y cada vez que la pantalla vuelve a foco (ej. volver de otra
  // tab tras pagar en otro lado, o si un admin activó la membresía a mano).
  useFocusEffect(
    useCallback(() => {
      fetchMembresia();
    }, [fetchMembresia])
  );

  // Cleanup del polling Yappy si la pantalla se desmonta con un cobro en curso
  // (mismo patrón que WalletScreen.js/CanchaBookingScreen.js).
  useEffect(() => () => {
    if (yappyCancelRef.current) {
      try { yappyCancelRef.current(); } catch { /* no-op */ }
      yappyCancelRef.current = null;
    }
  }, []);

  function cerrarPagoSheet() {
    if (yappyCancelRef.current) { yappyCancelRef.current(); yappyCancelRef.current = null; }
    setShowPagoSheet(false);
    setYappyEspera(false);
    setProcesandoPago(false);
    setYappyPhone('');
  }

  function cancelarPagoMembresia() {
    if (yappyCancelRef.current) { yappyCancelRef.current(); yappyCancelRef.current = null; }
    setYappyEspera(false);
    setProcesandoPago(false);
  }

  async function pagarMembresia() {
    const phone = yappyPhone.replace(/\D/g, '');
    if (phone.length < 7) { Alert.alert('Error', 'Ingresá un número Yappy válido'); return; }
    if (procesandoPago) return;
    setProcesandoPago(true);

    let orderId;
    try {
      const result = await iniciarBotonYappy({ phone, amount: 5, tipo: 'membresia_club' });
      orderId = result.orderId;
    } catch (e) {
      Alert.alert('Error', e.message ?? 'No se pudo iniciar el cobro Yappy');
      setProcesandoPago(false);
      return;
    }

    setYappyEspera(true);
    const { promise, cancel } = pollBotonOrder({ orderId });
    yappyCancelRef.current = cancel;

    try {
      await promise;
      yappyCancelRef.current = null;

      // El IPN activa la membresía server-side y puede tardar 1-2s en
      // reflejarse — reintentamos el fetch hasta 3 veces con 1.5s de espera.
      let nueva = null;
      for (let i = 0; i < 3 && !nueva?.vence_el; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1500));
        const { data } = await supabase
          .from('club_membresias')
          .select('vence_el, invitado_gratis_usado_el')
          .eq('user_id', user.id)
          .maybeSingle();
        nueva = data;
      }
      setMembresia(nueva ?? null);
      setShowPagoSheet(false);
      setYappyPhone('');

      Alert.alert(
        '¡Ya sos socio!',
        nueva?.vence_el
          ? `Tu carné vence el ${formatFechaLegible(nueva.vence_el)}.`
          : 'Tu pago fue aprobado — tu carné se activa en unos segundos, actualizá la pantalla si no lo ves todavía.'
      );
    } catch (e) {
      yappyCancelRef.current = null;
      if (e.message !== 'cancelled') {
        Alert.alert('Pago no completado', e.message ?? 'Intentá de nuevo.');
      }
    } finally {
      setYappyEspera(false);
      setProcesandoPago(false);
    }
  }

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
    await Promise.all([loadAll(), fetchMembresia()]);
    setRefreshing(false);
  }, [loadAll, fetchMembresia]);

  const grouped = groupByCategoria(companies);
  const isAdmin = user?.role === 'admin';
  const staffMode = isStaff();

  // ── Gate de socio pago ────────────────────────────────────────
  const hoyPA = getHoyPanama();
  const esSocio = !!(membresia?.vence_el && hoyPA <= membresia.vence_el);
  // Staff de comercios aliados: acceso al club SIN pagar membresía (validan cupones)
  const verClubCompleto = isAdmin || esSocio || staffMode;
  const cicloInicio = membresia?.vence_el ? addMonthsToDateStr(membresia.vence_el, -1) : null;
  const invitadoUsado = !!(
    membresia?.invitado_gratis_usado_el &&
    cicloInicio &&
    membresia.invitado_gratis_usado_el >= cicloInicio
  );

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
  if (loading || membresiaLoading) {
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

          {/* Notita admin — bypass del gate de socio */}
          {isAdmin && (
            <Text style={styles.adminGateNote}>(admin — vista completa)</Text>
          )}

          {/* Gate de socio pago: no-socios (y no-admin) solo ven la venta */}
          {!verClubCompleto && (
            <VentaSocioCard onComprar={() => setShowPagoSheet(true)} onCanjeado={fetchMembresia} />
          )}

          {/* Banner de socio activo */}
          {esSocio && (
            <SocioActivoBanner
              vence_el={membresia.vence_el}
              invitadoUsado={invitadoUsado}
              onRenovar={() => setShowPagoSheet(true)}
            />
          )}

          {/* Resto del Club — oculto para no-socios (solo la venta arriba) */}
          {verClubCompleto && (
            <>
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
            </>
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

        {/* Sheet de pago — hacerme socio / renovar */}
        <BottomSheetModal
          visible={showPagoSheet}
          onClose={cerrarPagoSheet}
          title="CARNÉ DE SOCIO"
          subtitle="$5.00 al mes · Solo Yappy"
          dismissOnBackdrop={!yappyEspera}
        >
          {yappyEspera ? (
            <View style={styles.pagoEsperaWrap}>
              <ActivityIndicator color={COLORS.gold} size="large" />
              <Text style={styles.pagoEsperaTitle}>Esperando aprobación...</Text>
              <Text style={styles.pagoEsperaSub}>
                Abrí tu app Yappy y aprobá el cobro de $5.00.{'\n'}O entrá a tu banca en línea y elegí la opción de Yappy.
              </Text>
              <TouchableOpacity onPress={cancelarPagoMembresia} style={styles.pagoCancelBtn}>
                <Text style={styles.pagoCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.pagoDesc}>
                Pagás $5.00 por Yappy y tu carné de socio queda activo al toque.
              </Text>
              <Field
                label="Número Yappy"
                placeholder="6123-4567"
                value={yappyPhone}
                onChangeText={(v) => setYappyPhone(v.replace(/[^\d-]/g, ''))}
                keyboardType="phone-pad"
                maxLength={10}
                editable={!procesandoPago}
              />
              <WCButton
                label={procesandoPago ? 'PROCESANDO...' : 'PAGAR $5.00 CON YAPPY'}
                variant="gold"
                size="lg"
                onPress={pagarMembresia}
                loading={procesandoPago}
                disabled={procesandoPago || yappyPhone.replace(/\D/g, '').length < 7}
                style={{ marginTop: SPACING.md }}
              />
            </>
          )}
        </BottomSheetModal>
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

  // Notita admin (bypass del gate de socio)
  adminGateNote: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gray2,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },

  // Venta de socio (no-socios)
  ventaCard: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  ventaKicker: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    color: COLORS.gold,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  ventaTitle: {
    fontFamily: FONTS.heading,
    fontSize: 28,
    color: COLORS.white,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  ventaPrecio: {
    fontFamily: FONTS.heading,
    fontSize: 48,
    color: COLORS.gold,
    letterSpacing: 1,
    marginTop: SPACING.xs,
  },
  ventaPrecioSub: {
    fontFamily: FONTS.body,
    fontSize: 16,
    color: COLORS.gray2,
  },
  ventaBeneficios: {
    width: '100%',
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  ventaBeneficioRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  ventaBeneficioIcon: {
    fontSize: 18,
  },
  ventaBeneficioText: {
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.white,
    lineHeight: 19,
  },
  ventaNota: {
    fontFamily: FONTS.body,
    fontSize: 11,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: SPACING.md,
  },

  // Banner de socio activo
  socioBanner: {
    marginBottom: SPACING.md,
  },
  socioBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  socioBannerTitle: {
    fontFamily: FONTS.bodyBold,
    fontSize: 15,
    color: COLORS.white,
  },
  socioBannerSub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    marginTop: 2,
  },
  socioBannerInvitado: {
    fontFamily: FONTS.body,
    fontSize: 12,
    color: COLORS.gold,
    marginTop: 4,
  },

  // Sheet de pago de membresía
  pagoDesc: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  pagoEsperaWrap: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    gap: SPACING.sm,
  },
  pagoEsperaTitle: {
    fontFamily: FONTS.bodyMedium,
    fontSize: 16,
    color: COLORS.white,
  },
  pagoEsperaSub: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 18,
  },
  pagoCancelBtn: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
  },
  pagoCancelText: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
  },
});
