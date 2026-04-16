import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Text } from 'react-native';
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

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

const TAB_ICONS = {
  Inicio:   '🏠',
  Eventos:  '📅',
  Wallet:   '💰',
  Tienda:   '🛒',
  Noticias: '📰',
  Panel:    '⚙️',
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
  const role = user?.role ?? 'player';
  const isPrivileged = role === 'admin' || role === 'gestor';

  return (
    <Tab.Navigator
      key={role}                          // force rebuild on role change
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.bg2,
          borderTopColor: COLORS.navy,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
        },
        tabBarActiveTintColor:   COLORS.red,
        tabBarInactiveTintColor: COLORS.gray,
        tabBarLabelStyle: { fontFamily: FONTS.body, fontSize: 11 },
        tabBarIcon: ({ color }) => (
          <Text style={{ fontSize: 22, color }}>{TAB_ICONS[route.name]}</Text>
        ),
      })}
    >
      <Tab.Screen name="Inicio"   component={HomeScreen} />
      <Tab.Screen name="Eventos"  component={EventsStack} />
      <Tab.Screen name="Wallet"   component={WalletScreen} />
      <Tab.Screen name="Tienda"   component={StoreScreen} />
      <Tab.Screen name="Noticias" component={NewsScreen} />

      {isPrivileged && (
        <Tab.Screen
          name="Panel"
          component={
            role === 'admin'
              ? require('../admin/AdminPanel').default
              : require('../gestor/GestorPanel').default
          }
        />
      )}
    </Tab.Navigator>
  );
}

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

      {/* Legal */}
      <Stack.Screen name="PrivacyPolicy"    component={PrivacyPolicyScreen} />
      <Stack.Screen name="Terms"            component={TermsScreen} />
    </Stack.Navigator>
  );
}
