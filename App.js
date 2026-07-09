import 'react-native-url-polyfill/auto';
import './lib/installPrompt'; // captura beforeinstallprompt antes del primer render
import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from '@expo-google-fonts/barlow';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Platform } from 'react-native';
import { supabase, clearCorruptedSession } from './lib/supabase';
import useAuthStore from './store/authStore';
import AuthNavigator from './app/navigation/AuthNavigator';
import AppNavigator from './app/navigation/AppNavigator';
import ResetPasswordScreen from './app/screens/auth/ResetPasswordScreen';
import SocialPreviewScreen from './app/screens/social/SocialPreviewScreen';
import { COLORS } from './constants/theme';
import { registerForPushNotifications } from './lib/notifications';
import NotificationPermissionModal from './components/NotificationPermissionModal';
import PlayerOnboardingModal from './components/PlayerOnboardingModal';
import WCFlyerModal from './components/WCFlyerModal';
import RecaudoFlyerModal from './components/RecaudoFlyerModal';
import InstallCloud from './components/InstallCloud';
import InstallHandoff from './components/InstallHandoff';
import RequiredInstallWall from './components/RequiredInstallWall';
import ErrorBoundary from './components/ErrorBoundary';
import useWcStore from './store/wcStore';
import { captureRefFromUrl } from './lib/referral';
import { linking } from './lib/navigationLinking';
import { getPendingDeepLink, clearPendingDeepLink } from './lib/pendingDeepLink';
import { logWarn } from './lib/logger';
import { initRemoteLogger, setRemoteLogUser } from './lib/remoteLogger';
import { applyModo26DomAttribute } from './lib/modo26';
import { applyTema2DomAttribute } from './lib/tema2';
import { requestCameraPermissionWeb } from './lib/cameraPermissionWeb';

// Instala captura global de errores y flush periódico hacia Supabase client_logs.
// Idempotente. Llamar antes del primer render para no perder errores tempranos.
initRemoteLogger();

// Detección eager (síncrona) si la URL es de recovery. Así bloqueamos el render
// del AppNavigator/AuthNavigator antes de que supabase procese el hash.
function detectRecoveryFromUrl() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const path = window.location.pathname || '';
  const hash = window.location.hash || '';
  return path.startsWith('/reset-password') || /type=recovery/i.test(hash);
}

// DEV-only: permite ver el prototipo del muro social SIN login abriendo
// localhost con ?preview=social. Gateado por __DEV__: nunca afecta produccion.
function detectSocialPreviewFromUrl() {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  return /preview=social/.test(search) || /preview=social/.test(hash);
}

const ONBOARDING_KEY_PREFIX = 'birrea_player_onboarding_seen_v1';
const WC_FLYER_KEY = 'birrea_wc_flyer_ts'; // epoch ms de la última vez mostrado
const WC_FLYER_INTERVAL_MS = 3 * 60 * 60 * 1000; // mostrar como máximo cada 3 horas
const RECAUDO_FLYER_KEY_PREFIX = 'b2p_recaudo_flyer_day'; // flyer de arranque: Recaudo Solidario (Venezuela)

// Detecta si la app está corriendo como PWA instalada (standalone).
function getPwaStandalone() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator?.standalone === true
  );
}

function getPanamaDayKey() {
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

// Captura el ?ref=CODE del link de invitación apenas carga la app (web).
// Idempotente; se consume al inscribirse al Mundial.
captureRefFromUrl();

SplashScreen.preventAutoHideAsync().catch(() => {});

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
    ),
  ]);
}

export default function App() {
  const [fontsLoaded, fontsError] = useFonts({
    BebasNeue_400Regular,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    Anton_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
  });
  const fontsReady = fontsLoaded;
  const [authReady,    setAuthReady]    = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [showFlyer, setShowFlyer] = useState(false);
  const [showRecaudoFlyer, setShowRecaudoFlyer] = useState(false);
  const [flyerPozos, setFlyerPozos] = useState({ survivor: null, polla: null });
  const wcPool = useWcStore((s) => s.pool);
  const loadWcPool = useWcStore((s) => s.loadPool);
  // BLOQUEO DE RECOVERY: si la URL es de reset, fuerza ResetPasswordScreen
  // por encima de cualquier otra cosa (evita que la sesión de recovery dé
  // acceso directo a la cuenta sin cambiar password).
  const [inRecovery, setInRecovery] = useState(detectRecoveryFromUrl());
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadProfile     = useAuthStore((s) => s.loadProfile);
  const user            = useAuthStore((s) => s.user);
  const navigationRef   = useNavigationContainerRef();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  // Si el flyer del Mundial llegó a mostrarse en ESTE arranque, no abrimos otro flyer
  // encima (ni al cerrarlo): el Recaudo queda para un próximo arranque. Determinista,
  // independiente del timing de AsyncStorage (ver effect del flyer Recaudo).
  const wcFlyerShownRef = useRef(false);

  // Aplica data-modo26 y data-tema2 en <html> al montar (web). Sin deps: una vez.
  useEffect(() => { applyModo26DomAttribute(); applyTema2DomAttribute(); }, []);

  // Suscripción única a auth events: evita doble loadProfile (race condition)
  // que generaba escrituras simultáneas al store de usuario.
  useEffect(() => {
    let lastLoadedAuthId = null; // dedupe loadProfile por mismo authId

    const safeLoadProfile = async (authId) => {
      if (!authId || authId === lastLoadedAuthId) return;
      lastLoadedAuthId = authId;
      try {
        await loadProfile(authId);
        setRemoteLogUser(authId);
      } catch (e) {
        logWarn({ screen: 'App', action: 'safeLoadProfile', userId: authId, technical: e });
      }
    };

    withTimeout(supabase.auth.getSession(), 6000, 'auth.getSession')
      .then(({ data: { session } }) => {
        if (session?.user) {
          setTimeout(() => {
            safeLoadProfile(session.user.id);
          }, 0);
        }
      })
      .catch((e) => {
        logWarn({ screen: 'App', action: 'getSession', technical: e });
        // Si getSession() timeouteó o tiró, los tokens en localStorage probablemente
        // están corruptos. Limpiarlos para que el próximo reload empiece limpio en
        // vez de repetir el mismo timeout cada vez.
        clearCorruptedSession();
      })
      .finally(() => setAuthReady(true));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setInRecovery(true);
        return;
      }
      if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event) && session?.user) {
        setTimeout(() => {
          safeLoadProfile(session.user.id);
        }, 0);
      }
      if (event === 'SIGNED_OUT') {
        lastLoadedAuthId = null;
        setRemoteLogUser(null);
        useAuthStore.getState().setUser(null);
        const useCartStore = require('./store/cartStore').default;
        useCartStore.getState().clearCart();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authReady) {
      // Splash nativo de Expo se oculta apenas auth resuelve; las fonts cargan
      // en segundo plano sin bloquear el render.
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [authReady]);

  // Restaurar deep link pendiente al pasar de no-autenticado a autenticado.
  // Caso: user abrió /evento/:id sin sesión → fue a login → ahora vuelve.
  // Sin esto, el NavigationContainer remount lo deja en MainTabs > Inicio.
  useEffect(() => {
    if (!authReady) return;
    const transitionedToAuthed = isAuthenticated && !wasAuthenticatedRef.current;
    wasAuthenticatedRef.current = isAuthenticated;
    if (!transitionedToAuthed) return;

    (async () => {
      const pending = await getPendingDeepLink();
      if (!pending?.screen) return;
      // Clear ANTES de navegar — evita doble-fire si isAuthenticated flip dos veces
      // (e.g. token refresh dispara SIGNED_IN de nuevo y este effect vuelve a leer el
      // mismo destino).
      await clearPendingDeepLink();
      // Esperar a que el NavigationContainer del AppNavigator termine de montar.
      const tryNavigate = (attempt = 0) => {
        if (navigationRef.isReady()) {
          try {
            navigationRef.navigate(pending.screen, pending.params ?? {});
          } catch (e) {
            console.warn('[App] pending deep link navigate failed', e?.message);
          }
        } else if (attempt < 20) {
          setTimeout(() => tryNavigate(attempt + 1), 50);
        }
      };
      tryNavigate();
    })();
  }, [isAuthenticated, authReady]);

  useEffect(() => {
    if (!user?.id) {
      setShowOnboarding(false);
      setOnboardingReady(false);
      return;
    }
    const isPlayer = (user.role ?? 'player') === 'player';
    if (!isPlayer) {
      setShowOnboarding(false);
      setOnboardingReady(true);
      return;
    }

    const key = `${ONBOARDING_KEY_PREFIX}:${user.id}`;
    AsyncStorage.getItem(key)
      .then((seen) => setShowOnboarding(!seen))
      .catch(() => setShowOnboarding(false))
      .finally(() => setOnboardingReady(true));
  }, [user?.id, user?.role]);

  // Re-registrar web push en cada arranque para usuarios que YA dieron permiso.
  // Tras el cambio de Service Worker (killswitch -> SW solo-push), las
  // suscripciones viejas quedaron muertas porque el SW anterior se desregistraba.
  // Esto las renueva bajo el SW nuevo SIN volver a mostrar el modal de permiso.
  useEffect(() => {
    if (!user?.id) return;
    if (Platform.OS !== 'web') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    registerForPushNotifications(user.id).catch(() => {});
  }, [user?.id]);

  // Solicitar permiso de cámara en web al arrancar la app (sin requerir login).
  // getUserMedia dispara el diálogo nativo de Chrome ("¿Permitir cámara?").
  // requestCameraPermissionWeb() guarda 'granted' en localStorage y cierra
  // el stream inmediatamente; si ya fue pedido, sale sin volver a llamar.
  useEffect(() => {
    if (!authReady || Platform.OS !== 'web') return;
    requestCameraPermissionWeb();
  }, [authReady]);

  // Acceso liberado (2026-06-29): se removió el bloqueo obligatorio de
  // instalar la app / activar notificaciones / reclamar recompensa (PWAGate).
  // Las notificaciones ya NO son requeridas: el modal forzado quedó desactivado
  // para que cualquiera pueda usar la app directo desde el navegador, sin muros.
  // Los usuarios que ya dieron permiso siguen recibiendo push (re-registro arriba).

  // Cargar config del Mundial (para el flyer) cuando hay usuario.
  useEffect(() => {
    if (user?.id) loadWcPool();
  }, [user?.id, loadWcPool]);

  // Flyer del Mundial: como máximo cada 3 h mientras el módulo esté visible y
  // dentro de la ventana flyer_until. No se muestra encima del onboarding/notif.
  useEffect(() => {
    if (!user?.id || !onboardingReady || showOnboarding || showNotifModal) return;
    if (!wcPool?.is_visible) return;
    const until = wcPool.flyer_until ? new Date(wcPool.flyer_until).getTime() : 0;
    if (!until || Date.now() > until) return;
    (async () => {
      const last = Number(await AsyncStorage.getItem(WC_FLYER_KEY)) || 0;
      if (Date.now() - last < WC_FLYER_INTERVAL_MS) return;
      try {
        const { data: stats } = await supabase.rpc('wc_pool_stats');
        const m = { survivor: null, polla: null };
        (stats ?? []).forEach((s) => { m[s.mode] = s.pozo; });
        setFlyerPozos(m);
      } catch (_) { /* el flyer igual se muestra sin pozos */ }
      setShowFlyer(true);
    })();
  }, [user?.id, user?.role, onboardingReady, showOnboarding, showNotifModal, wcPool?.is_visible, wcPool?.flyer_until]);

  // Marca que el flyer del Mundial se mostró en este arranque (lo lee el effect del Recaudo).
  useEffect(() => { if (showFlyer) wcFlyerShownRef.current = true; }, [showFlyer]);

  // Recaudo Solidario (Venezuela): flyer de arranque para usuarios logueados en web,
  // como máximo una vez por día calendario de Panamá, sin encimarse al onboarding,
  // al permiso de notificaciones ni al flyer del Mundial.
  useEffect(() => {
    if (!user?.id || !onboardingReady || showOnboarding || showNotifModal || showFlyer) return;
    if (Platform.OS !== 'web') return;
    // Si el Mundial ya tuvo su flyer en este arranque, no encimamos el Recaudo (ni al
    // cerrar aquel: el cambio de showFlyer re-dispara este effect). Determinista: no
    // depende de releer WC_FLYER_KEY (que dismissFlyer acaba de escribir con `now`).
    if (wcFlyerShownRef.current) return;

    let cancelled = false;
    (async () => {
      // No encimarse al flyer del Mundial. showFlyer se setea de forma asíncrona en su
      // propio effect (tras awaits), así que leerlo aquí da un valor obsoleto y ambos
      // flyers podrían apilarse. Evaluamos nosotros la elegibilidad del flyer WC con los
      // mismos signos (read-only) y, si va a salir, le cedemos el turno al Mundial.
      if (wcPool?.is_visible) {
        const until = wcPool.flyer_until ? new Date(wcPool.flyer_until).getTime() : 0;
        if (until && Date.now() <= until) {
          const last = Number(await AsyncStorage.getItem(WC_FLYER_KEY)) || 0;
          if (Date.now() - last >= WC_FLYER_INTERVAL_MS) return; // el flyer WC va a mostrarse
        }
      }
      if (cancelled) return;

      // Campaña Recaudo Solidario (Venezuela) DESACTIVADA 2026-07-05 (decisión Sergio).
      // Reactivar: volver RECAUDO_CAMPANA_ACTIVA a true (y RECAUDO_FOCUS en HomeScreen).
      const RECAUDO_CAMPANA_ACTIVA = false;
      if (!RECAUDO_CAMPANA_ACTIVA) return;

      const storageKey = `${RECAUDO_FLYER_KEY_PREFIX}:${user.id}`;
      const lastDay = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (cancelled) return;
      if (lastDay !== getPanamaDayKey()) setShowRecaudoFlyer(true);
    })();

    return () => { cancelled = true; };
  }, [user?.id, onboardingReady, showOnboarding, showNotifModal, showFlyer, wcPool?.is_visible, wcPool?.flyer_until]);

  async function dismissRecaudoFlyer() {
    setShowRecaudoFlyer(false);
    if (!user?.id) return;
    try {
      await AsyncStorage.setItem(
        `${RECAUDO_FLYER_KEY_PREFIX}:${user.id}`,
        getPanamaDayKey(),
      );
    } catch {}
  }

  function recaudoVerMas() {
    dismissRecaudoFlyer();
    const go = (attempt = 0) => {
      if (navigationRef.isReady()) {
        try { navigationRef.navigate('Recaudo'); } catch (_) {}
      } else if (attempt < 20) {
        setTimeout(() => go(attempt + 1), 50);
      }
    };
    go();
  }

  async function dismissFlyer() {
    setShowFlyer(false);
    try { await AsyncStorage.setItem(WC_FLYER_KEY, String(Date.now())); } catch (_) {}
  }

  function flyerVerMas() {
    dismissFlyer();
    const go = (attempt = 0) => {
      if (navigationRef.isReady()) {
        try { navigationRef.navigate('Mundial'); } catch (_) {}
      } else if (attempt < 20) {
        setTimeout(() => go(attempt + 1), 50);
      }
    };
    go();
  }

  async function handleFinishOnboarding() {
    if (user?.id) {
      await AsyncStorage.setItem(`${ONBOARDING_KEY_PREFIX}:${user.id}`, 'true');
    }
    setShowOnboarding(false);
  }

  async function handleAllowNotifications() {
    setShowNotifModal(false);
    registerForPushNotifications(user.id).catch(() => {});
  }

  // Solo bloqueamos el render hasta authReady (necesario para decidir qué
  // navigator montar). Las fonts NO bloquean: RN-Web re-aplica los estilos
  // cuando Barlow carga, mientras tanto usa el system font del SO. Esto le
  // quita 1-2s de pantalla blanca/spinner en Android 4G.
  // DEV-only: prototipo del muro social sin login (localhost/?preview=social).
  if (detectSocialPreviewFromUrl()) {
    return (
      <SafeAreaProvider>
        <SocialPreviewScreen
          navigation={{ goBack: () => { if (typeof window !== 'undefined') window.history.back(); } }}
        />
      </SafeAreaProvider>
    );
  }

  if (!authReady) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.red} size="large" />
      </View>
    );
  }

  // BLOQUEO DE SEGURIDAD: si estamos en flow de recovery, no renderizar la app
  // ni los modals. Solo la pantalla de cambio de password.
  if (inRecovery) {
    async function exitRecovery() {
      // Limpieza: signOut para invalidar la sesión de recovery + limpiar URL.
      try { await supabase.auth.signOut(); } catch (_) {}
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState(null, '', '/');
      }
      setInRecovery(false);
    }
    return (
      <SafeAreaProvider>
        <ResetPasswordScreen
          navigation={{ reset: exitRecovery, replace: exitRecovery }}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          {/* WorldCupSplash desmontado 2026-07-02: campaña 10-25 jun vencida
              (montaba, corría su effect y retornaba null — overhead sin función). */}
          {/* key forzando remount al cambiar auth state — esto re-evalúa el linking
              config y, si la URL es /evento/:id, abre EventDetail tanto en
              AuthNavigator (vista pública) como en AppNavigator (con inscripción). */}
          <NavigationContainer
            key={isAuthenticated ? 'app' : 'auth'}
            ref={navigationRef}
            linking={linking}
          >
            {isAuthenticated ? <AppNavigator /> : <AuthNavigator />}
          </NavigationContainer>
          <PlayerOnboardingModal
            visible={showOnboarding}
            userName={user?.nombre}
            onFinish={handleFinishOnboarding}
          />
          <NotificationPermissionModal
            visible={showNotifModal}
            onAllow={handleAllowNotifications}
          />
          <WCFlyerModal
            visible={showFlyer}
            onVerMas={flyerVerMas}
            onDismiss={dismissFlyer}
            survivorPozo={flyerPozos.survivor}
            pollaPozo={flyerPozos.polla}
          />
          <RecaudoFlyerModal
            visible={showRecaudoFlyer}
            onDismiss={dismissRecaudoFlyer}
            onOpen={recaudoVerMas}
          />
          {Platform.OS === 'web' && <InstallCloud />}
          {Platform.OS === 'web' && <InstallHandoff />}
          {/* Muro DURO instalar+notifs (flag remoto install_gate.required) — va al final: tapa todo */}
          {Platform.OS === 'web' && <RequiredInstallWall />}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
