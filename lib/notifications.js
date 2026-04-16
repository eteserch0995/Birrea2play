import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// En Expo Go SDK 53+ las push notifications remotas no están soportadas.
// executionEnvironment === 'storeClient' identifica Expo Go.
const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  Constants.appOwnership === 'expo';

export async function registerForPushNotifications(userId) {
  // Saltar silenciosamente en Expo Go — funcionará en development/production build
  if (isExpoGo) return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await supabase.from('users').update({ push_token: token }).eq('id', userId);
    return token;
  } catch {
    // Push notifications son opcionales — no bloquear el flujo
    return null;
  }
}

export async function sendLocalNotification(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {
    // Silently fail
  }
}
