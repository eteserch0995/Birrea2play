import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text, Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../../constants/theme';
import useAuthStore from '../../store/authStore';

// ── Main screens ─────────────────────────────────────────────────────────────
import HomeScreen           from '../screens/player/HomeScreen';
import EventsScreen         from '../screens/player/EventsScreen';
import EventDetailScreen    from '../screens/player/EventDetailScreen';
import ActiveEventScreen    from '../screens/player/ActiveEventScreen';
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
import AssistantScreen         from '../screens/assistant/AssistantScreen';
import EditEventScreen         from '../screens/event/EditEventScreen';
import SlotsDisponiblesScreen  from '../screens/gestor/SlotsDisponiblesScreen';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

const TAB_ICONS = {
  Inicio:    '🏠',
  Eventos:   '📅',
  Wallet:    '💳',
  Tienda:    '🛍',
  Asistente: 'IA',
  Noticias:  '📰',
  Panel:     '⚙',
  Cancha:    '🏟',
  Slots:     '🕒',
};

const TAB_LABELS = {
  Inicio:    'Inicio',
  Eventos:   'Eventos',
  Wallet:    'Créditos',
  Tienda:    'Tienda',
  Asistente: 'IA',
  Noticias:  'Noticias',
  Slots:     'Slots',
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
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  const role = user?.role ?? 'player';
  const isPrivileged    = role === 'admin' || role === 'gestor' || role === 'cancha_admin';
  const isGestorOrAdmin = role === 'gestor' || role === 'admin';
  const isCanchaAdmin   = role === 'cancha_admin';

  // bottomInset = espacio reservado para la barra de gestos del sistema (debajo de los iconos)
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 0);

  return (
    <Tab.Navigator
      key={role}
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
        tabBarIcon: ({ color, focused }) => (
          <View style={tabStyles.iconSlot}>
            <View style={[tabStyles.iconBadge, focused && tabStyles.iconBadgeActive]}>
              <Text
                style={[
                  route.name === 'Asistente' ? tabStyles.aiText : tabStyles.iconText,
                  { color },
                ]}
              >
                {TAB_ICONS[route.name]}
              </Text>
            </View>
          </View>
        ),
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
      <Tab.Screen name="Asistente" component={AssistantScreen} />
      <Tab.Screen name="Noticias"  component={NewsScreen} />

      {isGestorOrAdmin && (
        <Tab.Screen name="Slots" component={SlotsDisponiblesScreen} />
      )}

      {isPrivileged && (
        <Tab.Screen
          name={isCanchaAdmin ? 'Cancha' : 'Panel'}
          component={
            role === 'admin'         ? require('../admin/AdminPanel').default :
            role === 'cancha_admin'  ? require('../cancha/CanchaPanel').default :
                                       require('../gestor/GestorPanel').default
          }
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
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs"          component={MainTabs} />

      {/* Profile stack */}
      <Stack.Screen name="Profile"           component={ProfileScreen} />
      <Stack.Screen name="EditProfile"       component={EditProfileScreen} />
      <Stack.Screen name="GestorRequest"     component={GestorRequestScreen} />
      <Stack.Screen name="Notifications"     component={NotificationsScreen} />

      {/* Event standalone (from HomeScreen deep link) */}
      <Stack.Screen name="EventDetail"       component={EventDetailScreen} />
      <Stack.Screen name="ActiveEvent"       component={ActiveEventScreen} />

      {/* Store */}
      <Stack.Screen name="Cart"              component={CartScreen} />
      <Stack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} />

      {/* Player public profile */}
      <Stack.Screen name="PlayerProfile"    component={PlayerProfileScreen} />

      {/* Event edit */}
      <Stack.Screen name="EditEvent"        component={EditEventScreen} />

      {/* Legal */}
      <Stack.Screen name="PrivacyPolicy"    component={PrivacyPolicyScreen} />
      <Stack.Screen name="Terms"            component={TermsScreen} />
    </Stack.Navigator>
  );
}
