// Service Worker de Birrea2Play — SOLO push notifications.
//
// IMPORTANTE: este SW NO tiene handler `fetch` y NO cachea nada.
// El bug histórico de "pantalla en blanco en Android" (2026-05-20) lo causaba
// un SW que interceptaba `fetch` y servía bundles/HTML viejos cacheados.
// Al no tener `fetch` handler ni Cache Storage, este SW no puede reintroducir
// ese problema: solo recibe push y muestra notificaciones.
//
// Responsabilidades:
//   - install / activate  -> tomar control sin desregistrarse ni cachear
//   - push                -> mostrar la notificación
//   - notificationclick   -> enfocar/abrir la app en la URL del aviso

self.addEventListener('install', () => {
  // Activar de inmediato la versión nueva sin esperar a que cierren las tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Tomar control de las pestañas abiertas. NO desregistrar, NO borrar caches.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    try { payload = { title: 'Birrea2Play', body: event.data ? event.data.text() : '' }; } catch (_2) {}
  }

  const title = payload.title || 'Birrea2Play';
  const options = {
    body:    payload.body || '',
    icon:    payload.icon  || '/pwa-icon-192.png',
    badge:   payload.badge || '/pwa-icon-192.png',
    data:    { url: payload.url || '/' },
    tag:     payload.tag || 'b2p-notif', // agrupa para no apilar duplicados
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        try { await client.focus(); } catch (_) {}
        if ('navigate' in client && targetUrl) {
          try { await client.navigate(targetUrl); } catch (_) {}
        }
        return;
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
