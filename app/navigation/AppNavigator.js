import React, { useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text, Platform, View, StyleSheet, Image, ActivityIndicator, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../../constants/theme';
import useAuthStore from '../../store/authStore';
import useWcStore from '../../store/wcStore';
import useClubStore from '../../store/clubStore';
import { isSocialPreviewEnabled } from '../../lib/featureFlags';
import {
  IconHome, IconCalendar, IconWallet, IconBag, IconNews,
  IconGift, IconGear, IconField, IconTrophy,
} from '../../components/ui/TabIcons';

// ── Main screens ─────────────────────────────────────────────────────────────
import HomeScreen           from '../screens/player/HomeScreen';
import EventsScreen         from '../screens/player/EventsScreen';
import EventDetailScreen    from '../screens/player/EventDetailScreen';
import ActiveEventScreen    from '../screens/player/ActiveEventScreen';
import LiveBoardScreen      from '../screens/player/LiveBoardScreen';
import WalletScreen         from '../screens/wallet/WalletScreen';
import StoreScreen          from '../screens/store/StoreScreen';
import NewsScreen           from '../screens/news/NewsScreen';
import ProfileScreen        from '../screens/profile/ProfileScreen';
import EditProfileScreen    from '../screens/profile/EditProfileScreen';
import GestorRequestScreen  from '../screens/profile/GestorRequestScreen';
import NotificationsScreen  from '../screens/profile/NotificationsScreen';
import CartScreen              from '../screens/store/CartScreen';
import OrderConfirmationScreen from '../screens/store/OrderConfirmationScreen';
import PlayerProfileScreen     from '../screens/player/PlayerProfileScreen';
import PrivacyPolicyScreen     from '../screens/legal/PrivacyPolicyScreen';
import TermsScreen             from '../screens/legal/TermsScreen';
// import AssistantScreen      from '../screens/assistant/AssistantScreen'; // deshabilitado 2026-05-29
import EditEventScreen         from '../screens/event/EditEventScreen';
import RaffleScreen            from '../screens/raffle/RaffleScreen';
import DonationCampaignScreen  from '../screens/donation/DonationCampaignScreen';
import MundialNavigator        from './MundialNavigator';
import ClubBeneficiosNavigator from './ClubBeneficiosNavigator';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();
const mundialLogo = require('../../assets/mundial/mundial-logo.png');

// ── Code splitting (ARQ-1): paneles pesados montados solo si el rol los usa.
// React.lazy + Suspense a NIVEL DE MÓDULO (identidad estable) — jamás dentro
// del render, o cada re-render del navigator remontaría el panel entero.
const AdminPanelLazy         = React.lazy(() => import('../admin/AdminPanel'));
const GestorPanelLazy        = React.lazy(() => import('../gestor/GestorPanel'));
const CanchaPanelLazy        = React.lazy(() => import('../cancha/CanchaPanel'));
const CanchaBookingScreenLazy = React.lazy(() => import('../cancha/CanchaBookingScreen'));
const RotacionesScreenLazy   = React.lazy(() => import('../screens/gestor/RotacionesScreen'));

function PanelLoading() {
  return (
    <View style={panelLoadingStyles.wrap}>
      <ActivityIndicator color={COLORS.neon} />
    </View>
  );
}

function makeLazyScreen(Comp) {
  return function LazyScreen(props) {
    return (
      <React.Suspense fallback={<PanelLoading />}>
        <Comp {...props} />
      </React.Suspense>
    );
  };
}

const AdminPanelScreen         = makeLazyScreen(AdminPanelLazy);
const GestorPanelScreen        = makeLazyScreen(GestorPanelLazy);
const CanchaPanelScreen        = makeLazyScreen(CanchaPanelLazy);
const CanchaBookingScreenScreen = makeLazyScreen(CanchaBookingScreenLazy);
const RotacionesScreenScreen   = makeLazyScreen(RotacionesScreenLazy);

const panelLoadingStyles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
});

// Mapa nombre de tab → componente de icono SVG (reemplaza los emojis previos)
const TAB_ICON_COMPONENTS = {
  Inicio:    IconHome,
  Eventos:   IconCalendar,
  Wallet:    IconWallet,
  Tienda:    IconBag,
  Noticias:  IconNews,
  Mundial:   IconTrophy, // no se usa (Mundial tiene caso especial con logo), queda por completitud
  Beneficios:IconGift,
  Panel:     IconGear,
  Cancha:    IconField,
};

// Puntito indicador de tab activa: aparece con spring scale 0→1
function ActiveDot({ focused }) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      friction: 6,
      tension: 80,
    }).start();
  }, [focused, scale]);
  return (
    <Animated.View
      style={[tabStyles.activeDot, { transform: [{ scale }] }]}
    />
  );
}

const TAB_LABELS = {
  Inicio:    'Inicio',
  Eventos:   'Eventos',
  Wallet:    'Créditos',
  Tienda:    'Tienda',
  Noticias:  'Noticias',
  Mundial:   'Mundial',
  Beneficios:'Club',
  Panel:     'Panel',
  Cancha:    'Cancha',
};

// ── Nested stacks ─────────────────────────────────────────────────────────────
function EventsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="EventsList"   component={EventsScreen} />
      <Stack.Screen name="EventDetail"  component={EventDetailScreen} />
      <Stack.Screen name="ActiveEvent"  component={ActiveEventScreen} />
    </Stack.Navigator>
  );
}

// ── Bottom tabs ───────────────────────────────────────────────────────────────
function MainTabs() {
  const user = useAuthStore((s) => s.user);
  const pool = useWcStore((s) => s.pool);
  const loadPool = useWcStore((s) => s.loadPool);
  const insets = useSafeAreaInsets();
  const role = user?.role ?? 'player';
  const isPrivileged = role === 'admin' || role === 'gestor';
  const isCancha     = role === 'cancha_admin';

  // Mundial 2026: admin siempre lo ve; resto solo si is_visible=true en wc_pools
  useEffect(() => { loadPool(); }, [loadPool]);
  const showMundial = role === 'admin' || pool?.is_visible === true;

  // Club de Beneficios: admin siempre; resto solo si club_settings.is_visible=true
  const clubSettings   = useClubStore((s) => s.settings);
  const loadClub       = useClubStore((s) => s.loadSettings);
  const loadMyCompanies = useClubStore((s) => s.loadMyCompanies);
  useEffect(() => { loadClub(); }, [loadClub]);
  useEffect(() => { if (user?.id) loadMyCompanies(user.id); }, [user?.id, loadMyCompanies]);
  const showClub = role === 'admin' || clubSettings?.is_visible === true;

  // bottomInset = espacio reservado para la barra de gestos del sistema (debajo de los iconos)
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0);

  return (
    <Tab.Navigator
      key={`${role}-${showMundial ? 'wc' : 'news'}-${showClub ? 'club' : 'x'}-${isCancha ? 'c' : 'x'}`}
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.asphalt,
          borderTopColor: COLORS.line,
          borderTopWidth: 1,
          height: 72 + bottomInset,  // 72px para icono + label + espacio del sistema debajo
          // En web: tab bar fija al viewport para que siempre quede visible al scrollear
          ...(Platform.OS === 'web' ? {
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 50,
          } : null),
        },
        tabBarActiveTintColor:   COLORS.neon,
        tabBarInactiveTintColor: COLORS.gray,
        tabBarShowLabel: true,
        tabBarLabel: TAB_LABELS[route.name] ?? route.name,
        tabBarLabelStyle: {
          fontFamily: FONTS.bodyBold,
          fontSize: 9,
          lineHeight: 11,
          letterSpacing: 0,
          marginTop: 0,
          textTransform: 'none',
        },
        tabBarIcon: ({ color, focused }) => {
          // Mundial: logo grande sin badge cuadrado (se ve mejor que un emoji)
          if (route.name === 'Mundial') {
            return (
              <View style={tabStyles.iconSlot}>
                <Image
                  source={mundialLogo}
                  style={[tabStyles.mundialIcon, focused && tabStyles.mundialIconActive]}
                  resizeMode="contain"
                />
              </View>
            );
          }
          const IconComp = TAB_ICON_COMPONENTS[route.name];
          return (
            <View style={tabStyles.iconSlot}>
              <View
                style={[tabStyles.iconBadge, focused && tabStyles.iconBadgeActive]}
                dataSet={{ t2Press: '' }}
              >
                {/* Fallback: tab sin icono registrado renderiza vacío (nunca texto crudo) */}
                {IconComp ? <IconComp color={color} size={20} /> : null}
              </View>
              {focused && <ActiveDot focused={focused} />}
            </View>
          );
        },
        // Los items solo ocupan los 72px superiores — el safe area queda debajo libre
        tabBarItemStyle: { height: 72, paddingTop: 6, paddingBottom: 6 },
      })}
    >
      <Tab.Screen name="Inicio"   component={HomeScreen} />
      <Tab.Screen
        name="Eventos"
        component={EventsStack}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Eventos', { screen: 'EventsList' });
          },
        })}
      />
      <Tab.Screen name="Wallet" component={WalletScreen} />
      <Tab.Screen name="Tienda"    component={StoreScreen} />
      {showMundial ? (
        <Tab.Screen name="Mundial" component={MundialNavigator} />
      ) : (
        <Tab.Screen name="Noticias" component={NewsScreen} />
      )}

      {showClub && (
        <Tab.Screen name="Beneficios" component={ClubBeneficiosNavigator} />
      )}

      {isCancha && (
        <Tab.Screen
          name="Cancha"
          component={CanchaPanelScreen}
        />
      )}

      {isPrivileged && (
        <Tab.Screen
          name="Panel"
          component={role === 'admin' ? AdminPanelScreen : GestorPanelScreen}
        />
      )}
    </Tab.Navigator>
  );
}

const tabStyles = StyleSheet.create({
  iconSlot: {
    height: 34,
    minWidth: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadge: {
    width: 32,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  iconBadgeActive: {
    borderColor: COLORS.neon + '55',
    backgroundColor: COLORS.neon + '14',
  },
  activeDot: {
    // Absoluto: no suma alto al iconSlot de 34px (30 badge + 4 dot + margen desbordaba)
    position: 'absolute',
    bottom: -1,
    left: '50%',
    marginLeft: -2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.neon,
  },
  mundialIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  mundialIconActive: {
    transform: [{ scale: 1.08 }],
  },
  iconText: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  aiText: {
    fontFamily: FONTS.heading,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: 1,
    textAlign: 'center',
  },
});

// ── Root navigator ────────────────────────────────────────────────────────────
export default function AppNavigator() {
  const { user } = useAuthStore();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs"          component={MainTabs} />

      {/* Preview NO destructivo del muro social. Gateado (admin/__DEV__/flag local).
          Pantalla aparte, root push: no entra a MainTabs ni agrega tabs. Revertir = borrar
          este bloque + el import de isSocialPreviewEnabled + el launcher en AdminPanel. */}
      {isSocialPreviewEnabled(user) && (
        <Stack.Screen name="SocialPreview" component={require('../screens/social/SocialPreviewScreen').default} />
      )}

      {/* Profile stack */}
      <Stack.Screen name="Profile"           component={ProfileScreen} />
      <Stack.Screen name="EditProfile"       component={EditProfileScreen} />
      <Stack.Screen name="GestorRequest"     component={GestorRequestScreen} />
      <Stack.Screen name="Notifications"     component={NotificationsScreen} />

      {/* Event standalone (from HomeScreen deep link) */}
      <Stack.Screen name="EventDetail"       component={EventDetailScreen} />
      <Stack.Screen name="ActiveEvent"       component={ActiveEventScreen} />
      <Stack.Screen name="LiveBoard"         component={LiveBoardScreen} />

      {/* Store */}
      <Stack.Screen name="Cart"              component={CartScreen} />
      <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />

      {/* Player public profile */}
      <Stack.Screen name="PlayerProfile"    component={PlayerProfileScreen} />

      {/* Event edit */}
      <Stack.Screen name="EditEvent"        component={EditEventScreen} />

      {/* Cancha booking (gestores) */}
      <Stack.Screen name="CanchaBooking"    component={CanchaBookingScreenScreen} />

      {/* Rotaciones por tiempo (gestor/admin — amistosos con suplentes) */}
      <Stack.Screen name="Rotaciones"       component={RotacionesScreenScreen} />

      {/* Rifa */}
      <Stack.Screen name="Raffle"           component={RaffleScreen} />

      {/* Recaudo Solidario (Venezuela) */}
      <Stack.Screen name="Recaudo"          component={DonationCampaignScreen} />

      {/* Legal */}
      <Stack.Screen name="PrivacyPolicy"    component={PrivacyPolicyScreen} />
      <Stack.Screen name="Terms"            component={TermsScreen} />
    </Stack.Navigator>
  );
}
