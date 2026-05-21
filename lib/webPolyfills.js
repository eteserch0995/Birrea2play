// Polyfills web-only. Importar PRIMERO en index.js para que aplique antes
// de que cualquier componente use estas APIs.
import { Alert, Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// ── Alert.alert ────────────────────────────────────────────────────────────
// En RN Web, Alert.alert muestra solo el mensaje pero ignora `buttons`.
// Los callbacks `onPress` nunca se ejecutan, rompiendo cualquier flujo de
// confirmación (finalizar evento, cancelar inscripción, eliminar producto…).
// Lo mapeamos a window.alert/confirm preservando el contrato de RN.
if (isWeb && typeof window !== 'undefined') {
  Alert.alert = (title, message, buttons, _options) => {
    const text = [title, message].filter(Boolean).join('\n\n');

    // Sin botones o un solo botón: mostrar alert + ejecutar callback opcional
    if (!buttons || buttons.length === 0) {
      window.alert(text);
      return;
    }
    if (buttons.length === 1) {
      window.alert(text);
      try { buttons[0].onPress?.(); } catch (_) {}
      return;
    }

    // 2+ botones: confirm. "OK" => primer botón no-cancel; "Cancel" => botón cancel.
    const cancelBtn  = buttons.find((b) => b.style === 'cancel');
    const confirmBtn = buttons.find((b) => b.style !== 'cancel') ?? buttons[buttons.length - 1];
    const accepted = window.confirm(text);
    try {
      if (accepted) confirmBtn?.onPress?.();
      else cancelBtn?.onPress?.();
    } catch (_) {}
  };
}
