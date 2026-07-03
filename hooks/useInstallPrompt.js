import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISS_KEY = 'b2p_install_dismissed_at';
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow]                     = useState(false);
  const [platform, setPlatform]             = useState(null); // 'android' | 'ios'

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (isStandalone) return;

    const ua        = navigator.userAgent;
    const isIOS     = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isAndroid = /Android/.test(ua);

    const checkDismissed = async () => {
      const val = await AsyncStorage.getItem(DISMISS_KEY);
      if (val) {
        const dismissed = parseInt(val, 10);
        if (Date.now() - dismissed < DISMISS_TTL_MS) return true;
      }
      return false;
    };

    if (isIOS) {
      // Only guide in Safari proper (CriOS/FxiOS can't install PWA the same way)
      const isChromeiOS  = /CriOS/.test(ua);
      const isFirefoxiOS = /FxiOS/.test(ua);
      if (!isChromeiOS && !isFirefoxiOS) {
        checkDismissed().then((dismissed) => {
          if (!dismissed) { setPlatform('ios'); setShow(true); }
        });
      }
    }

    if (isAndroid) {
      const handler = (e) => {
        e.preventDefault();
        const prompt = e;
        checkDismissed().then((dismissed) => {
          if (!dismissed) {
            setDeferredPrompt(prompt);
            setPlatform('android');
            setShow(true);
          }
        });
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setShow(false);
      AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setShow(false);
    AsyncStorage.setItem(DISMISS_KEY, String(Date.now()));
  }, []);

  return { show, platform, triggerInstall, dismiss };
}
