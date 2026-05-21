// SW KILLSWITCH (2026-05-20)
//
// Reportes de pantalla en blanco en Android Chrome incluso en incógnito sugieren
// un SW viejo con bug. Este SW se autodesregistra y limpia todos los caches
// para que el browser vuelva a comportarse como SPA web normal sin SW.
//
// Plan: dejar este killswitch unos días, después decidir si volvemos a un SW
// limpio o si dejamos la app sin SW (web push se puede reactivar después).

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Tomar control inmediato de las tabs ya abiertas — sin esto, el killswitch
    // no aplica hasta el siguiente reload manual del user.
    try { await self.clients.claim(); } catch (_) {}
    try {
      // Borrar TODOS los caches que cualquier SW previo haya creado.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) {}
    try {
      // Desregistrar este SW para que el browser deje de usarlo.
      await self.registration.unregister();
    } catch (_) {}
    try {
      // Forzar reload de todas las pestañas abiertas para que reciban
      // el HTML fresco sin SW intermediando.
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach((c) => {
        if ('navigate' in c) c.navigate(c.url);
      });
    } catch (_) {}
  })());
});

// Sin fetch handler: nada cachea, nada intercepta.
