import 'react-native-url-polyfill/auto';
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
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Platform } from 'react-native';
import { supabase, clearCorruptedSession } from './lib/supabase';
import useAuthStore from './store/authStore';
import AuthNavigator from './app/navigation/AuthNavigator';
import AppNavigator from './app/navigation/AppNavigator';
import ResetPasswordScreen from './app/screens/auth/ResetPasswordScreen';
import { COLORS } from './constants/theme';
import { registerForPushNotifications } from './lib/notifications';
import NotificationPermissionModal from './components/NotificationPermissionModal';
import PlayerOnboardingModal from './components/PlayerOnboardingModal';
import ErrorBoundary from './components/ErrorBoundary';
import { linking } from './lib/navigationLinking';
import { getPendingDeepLink, clearPendingDeepLink } from './lib/pendingDeepLink';
import { logWarn } from './lib/logger';
import { initRemoteLogger, setRemoteLogUser } from './lib/remoteLogger';

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

const NOTIF_ASKED_KEY = 'birrea_notif_asked';
const ONBOARDING_KEY_PREFIX = 'birrea_player_onboarding_seen_v1';

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
  });
  const fontsReady = fontsLoaded;
  const [authReady,    setAuthReady]    = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingReady, setOnboardingReady] = useState(false);
  // BLOQUEO DE RECOVERY: si la URL es de reset, fuerza ResetPasswordScreen
  // por encima de cualquier otra cosa (evita que la sesión de recovery dé
  // acceso directo a la cuenta sin cambiar password).
  const [inRecovery, setInRecovery] = useState(detectRecoveryFromUrl());
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadProfile     = useAuthStore((s) => s.loadProfile);
  const user            = useAuthStore((s) => s.user);
  const navigationRef   = useNavigationContainerRef();
  const wasAuthenticatedRef = useRef(isAuthenticated);

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

  useEffect(() => {
    if (!user?.id || !onboardingReady || showOnboarding) return;
    AsyncStorage.getItem(NOTIF_ASKED_KEY).then((asked) => {
      if (!asked) setShowNotifModal(true);
    });
  }, [user?.id, onboardingReady, showOnboarding]);

  async function handleFinishOnboarding() {
    if (user?.id) {
      await AsyncStorage.setItem(`${ONBOARDING_KEY_PREFIX}:${user.id}`, 'true');
    }
    setShowOnboarding(false);
  }

  async function handleAllowNotifications() {
    setShowNotifModal(false);
    await AsyncStorage.setItem(NOTIF_ASKED_KEY, 'true');
    registerForPushNotifications(user.id).catch(() => {});
  }

  async function handleSkipNotifications() {
    setShowNotifModal(false);
    await AsyncStorage.setItem(NOTIF_ASKED_KEY, 'true');
  }

  // Solo bloqueamos el render hasta authReady (necesario para decidir qué
  // navigator montar). Las fonts NO bloquean: RN-Web re-aplica los estilos
  // cuando Barlow carga, mientras tanto usa el system font del SO. Esto le
  // quita 1-2s de pantalla blanca/spinner en Android 4G.
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
            onSkip={handleSkipNotifications}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
