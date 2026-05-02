import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// SDK 54 / expo-notifications 0.32: shouldShowAlert deprecated
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
  }),
});

const isExpoGo = Constants.appOwnership === 'expo';

export async function registerForPushNotifications(userId) {
  if (isExpoGo) return null;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name:      'default',
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

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return null;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await supabase.from('users').update({ push_token: token }).eq('id', userId);
    return token;
  } catch {
    return null;
  }
}

export async function sendLocalNotification(title, body) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {}
}

/**
 * Send Expo push notifications to all confirmed players of an event.
 * Safe to call in Expo Go (tokens won't be available, so it's a no-op).
 *
 * @param {string}   eventId
 * @param {string}   title
 * @param {string}   body
 */
export async function sendPushNotificationsToEventPlayers(eventId, title, body) {
  if (isExpoGo) return;  // push tokens not available in Expo Go

  try {
    // Fetch confirmed registrations with push tokens
    const { data: regs } = await supabase
      .from('event_registrations')
      .select('users(push_token)')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');

    const tokens = (regs ?? [])
      .map(r => r.users?.push_token)
      .filter(Boolean);

    if (!tokens.length) return;

    // Send via Expo Push API in batches of 100
    const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
    const BATCH_SIZE    = 100;
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE).map(token => ({
        to:    token,
        title,
        body,
        sound: 'default',
      }));
      await fetch(EXPO_PUSH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(batch),
      }).catch(e => console.warn('sendPush batch error:', e.message));
    }
  } catch (e) {
    console.warn('sendPushNotificationsToEventPlayers error:', e.message);
  }
}
