// Solicita permiso de cámara en web/PWA.
// Llama a getUserMedia para que Chrome muestre su diálogo nativo.
// Solo almacena 'granted' en localStorage; si fue denegado o hay error,
// no almacena nada y reintenta en la próxima sesión (a menos que Chrome
// ya lo tenga marcado como 'denied' en permissions API, en cuyo caso
// saltamos la llamada para no hacer ruido).

const KEY = 'b2p_camera_perm';

export async function requestCameraPermissionWeb() {
  if (typeof window === 'undefined') return;

  if (!window.isSecureContext) {
    console.warn('[camera] La cámara solo funciona en HTTPS o localhost.');
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[camera] Este navegador no soporta getUserMedia.');
    return;
  }

  // Si en esta sesión ya confirmamos el permiso, no volvemos a pedir.
  try {
    if (localStorage.getItem(KEY) === 'granted') return;
  } catch (_) {}

  // Consultar estado actual de Chrome sin disparar getUserMedia todavía.
  if (navigator.permissions) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' });
      if (status.state === 'granted') {
        try { localStorage.setItem(KEY, 'granted'); } catch (_) {}
        return;
      }
      if (status.state === 'denied') {
        // Chrome ya lo bloqueó: getUserMedia fallaría de todos modos.
        // El scanner mostrará el mensaje de bloqueo cuando se intente usar.
        return;
      }
      // state === 'prompt' → continuar con getUserMedia para mostrar el diálogo nativo.
    } catch (_) {
      // permissions API no disponible (Safari < 16) → intentar directo.
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    // Permiso concedido. Cerrar stream de inmediato; no dejar cámara encendida.
    stream.getTracks().forEach((t) => t.stop());
    try { localStorage.setItem(KEY, 'granted'); } catch (_) {}
  } catch (err) {
    const name = err?.name;
    if (name === 'NotFoundError') {
      // No hay cámara disponible en este dispositivo.
      console.warn('[camera] No se encontró cámara en el dispositivo.');
    } else if (name === 'NotReadableError') {
      // Cámara ocupada por otra app.
      console.warn('[camera] La cámara está siendo usada por otra aplicación.');
    }
    // NotAllowedError (usuario bloqueó) → no almacenamos nada; la próxima sesión
    // el permissions API lo detectará como 'denied' y saldrá temprano.
  }
}

export function isCameraGranted() {
  try { return localStorage.getItem(KEY) === 'granted'; } catch (_) { return false; }
}
