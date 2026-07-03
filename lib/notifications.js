import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

const isWeb = Platform.OS === 'web';
const isExpoGo = Constants.appOwnership === 'expo';

// SDK 54 / expo-notifications 0.32
if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   true,
    }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE PUSH TOKENS / SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Web Push: registra service worker, pide permiso, suscribe via VAPID y
// persiste la subscription en Supabase via RPC `add_web_push_sub`.
// Devuelve true si quedó suscripto, false/null si no.
async function registerWebPush() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.warn('web push no soportado en este browser');
    return null;
  }
  if (!VAPID_PUBLIC_KEY) {
    console.warn('VAPID_PUBLIC_KEY no configurada — saltando web push');
    return null;
  }

  try {
    if (Notification.permission === 'denied') return false;
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return false;
    }

    // Registrar (idempotente) y esperar a que esté activo antes de suscribir.
    // `serviceWorker.ready` solo NO basta: si no hay SW previo, queda pendiente
    // para siempre y nunca llega a subscribe().
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const subJson = sub.toJSON();
    const { error } = await supabase.rpc('add_web_push_sub', { p_sub: subJson });
    if (error) {
      console.warn('add_web_push_sub error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('registerWebPush error:', e?.message ?? e);
    return false;
  }
}

// Native push: Expo Push token (móvil)
async function registerNativePush(userId) {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name:       'default',
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
  } catch (e) {
    console.warn('registerNativePush error:', e?.message ?? e);
    return null;
  }
}

// Punto de entrada único — selecciona el path según plataforma.
export async function registerForPushNotifications(userId) {
  if (isWeb) return registerWebPush();
  if (isExpoGo) return null;  // Expo Go no soporta push real
  return registerNativePush(userId);
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL NOTIFICATIONS (sólo native)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendLocalNotification(title, body) {
  if (isWeb) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVÍO MASIVO A JUGADORES DE UN EVENTO
// Usa la edge function `send-notification` que unifica Expo Push + Web Push.
// Funciona desde web y desde native — todo va al mismo endpoint.
// ═══════════════════════════════════════════════════════════════════════════

export async function sendPushNotificationsToEventPlayers(eventId, title, body, opts = {}) {
  try {
    // Get confirmed players
    const { data: regs } = await supabase
      .from('event_registrations')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');
    const userIds = (regs ?? []).map(r => r.user_id).filter(Boolean);
    if (userIds.length === 0) return;

    await sendNotificationToUsers(userIds, title, body, opts);
  } catch (e) {
    console.warn('sendPushNotificationsToEventPlayers error:', e?.message ?? e);
  }
}

// Notifica al gestor (creador del evento) que alguien se inscribió, SOLO si el evento
// ya tiene equipos creados. Permite que el gestor reasigne / cubra el cupo del comodín.
// No-op si el evento aún no tiene equipos (el gestor los va a armar después).
export async function notifyGestorOfNewRegistration(eventId, playerName) {
  try {
    const [{ data: event }, { count: teamCount }] = await Promise.all([
      supabase.from('events').select('id, nombre, created_by').eq('id', eventId).maybeSingle(),
      supabase.from('teams').select('id', { head: true, count: 'exact' }).eq('event_id', eventId),
    ]);
    if (!event?.created_by) return;
    if (!teamCount || teamCount === 0) return; // sin equipos creados, no hace falta avisar
    await sendNotificationToUsers(
      [event.created_by],
      '⚽ Nueva inscripción',
      `${playerName ?? 'Un jugador'} se inscribió en "${event.nombre}". Asígnalo a un equipo.`,
      { url: `/evento/${eventId}` }
    );
  } catch (e) {
    console.warn('notifyGestorOfNewRegistration error:', e?.message ?? e);
  }
}

// Broadcast a TODOS los usuarios registrados con token (Expo o Web Push).
// La edge function valida que el caller tenga rol admin/gestor — si no, devuelve 401.
// Devuelve { ok, result:{ audience, expo, web } } o { ok:false, error }.
export async function broadcastNotification(title, body, opts = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'sin sesión' };
    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        broadcast: true,
        title,
        body,
        ...(opts.url ? { url: opts.url } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    return data;
  } catch (e) {
    console.warn('broadcastNotification error:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'error de red' };
  }
}

// Helper genérico: envía a una lista de user_ids específicos.
export async function sendNotificationToUsers(userIds, title, body, opts = {}) {
  if (!userIds || userIds.length === 0) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`;
    await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({
        user_ids: userIds,
        title,
        body,
        ...(opts.url ? { url: opts.url } : {}),
      }),
    });
  } catch (e) {
    console.warn('sendNotificationToUsers error:', e?.message ?? e);
  }
}
