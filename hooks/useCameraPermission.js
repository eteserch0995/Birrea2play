import { useState, useCallback, useEffect } from 'react';
import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let useCameraPerms = null;
if (Platform.OS !== 'web') {
  useCameraPerms = require('expo-camera').useCameraPermissions;
}

const STORAGE_KEY = '@camera_pre_modal_shown';

export function useCameraPermission() {
  const [showModal, setShowModal]     = useState(false);
  const [isDenied, setIsDenied]       = useState(false);

  // Web: empieza en "checking" para no hacer flash antes de saber el estado real
  const [webChecking, setWebChecking] = useState(Platform.OS === 'web');
  const [webGranted, setWebGranted]   = useState(false);
  const [webDenied, setWebDenied]     = useState(false);

  const nativeHook = useCameraPerms ? useCameraPerms() : [null, null];
  const [permission, requestPermission] = nativeHook;

  const isWeb = Platform.OS === 'web';
  const granted = isWeb ? webGranted : (permission?.granted ?? false);

  // Web: consultar estado actual de permisos sin disparar getUserMedia
  useEffect(() => {
    if (!isWeb) return;
    if (!navigator.permissions) { setWebChecking(false); return; }
    navigator.permissions
      .query({ name: 'camera' })
      .then((s) => {
        if (s.state === 'granted') setWebGranted(true);
        if (s.state === 'denied')  setWebDenied(true);
      })
      .catch(() => {})
      .finally(() => setWebChecking(false));
  }, [isWeb]);

  // Web: llamar SOLO desde onPress — Chrome requiere gesto directo del usuario
  const grantWebCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      setWebGranted(true);
      setWebDenied(false);
      return true;
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setWebDenied(true);
      }
      return false;
    }
  }, []);

  // Nativo: flujo con modal pre-permiso
  const requestWithModal = useCallback(async () => {
    if (isWeb) return;
    if (permission?.granted) return;
    if (permission?.canAskAgain === false) {
      setIsDenied(true); setShowModal(true); return;
    }
    const alreadyShown = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    if (!alreadyShown) { setIsDenied(false); setShowModal(true); return; }
    await requestPermission();
  }, [isWeb, permission, requestPermission]);

  const handleModalAllow = useCallback(async () => {
    setShowModal(false);
    if (isDenied) { Linking.openSettings(); return; }
    await AsyncStorage.setItem(STORAGE_KEY, '1').catch(() => {});
    await requestPermission?.();
  }, [isDenied, requestPermission]);

  const handleModalSkip = useCallback(() => setShowModal(false), []);

  return {
    granted,
    webChecking,
    webDenied,
    grantWebCamera,
    showModal,
    isDenied,
    requestWithModal,
    handleModalAllow,
    handleModalSkip,
  };
}
