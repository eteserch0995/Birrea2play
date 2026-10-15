import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from '../../../constants/theme';
import { supabase } from '../../../lib/supabase';
import useAuthStore from '../../../store/authStore';
import {
  WCCard,
  WCButton,
  WCBadge,
  WCSectionTitle,
  WCHeader,
} from '../../../components/mundial/WCComponents';

const isWeb = Platform.OS === 'web';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleDateString('es-PA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoString;
  }
}

// ─── ResultCard ───────────────────────────────────────────────────────────────

function ResultCard({ result, onReset }) {
  if (!result) return null;

  if (result.ok) {
    const { socio, socio_foto, benefit, redeemed_at } = result;
    return (
      <WCCard accent="gold" style={styles.resultCard}>
        <View style={styles.resultHeader}>
          <WCBadge label="CANJEADO" tone="success" size="lg" />
        </View>

        {/* Socio */}
        <View style={styles.socioRow}>
          {socio_foto ? (
            <Image
              source={{ uri: socio_foto }}
              style={styles.socioAvatar}
            />
          ) : (
            <View style={[styles.socioAvatar, styles.socioAvatarPlaceholder]}>
              <Text style={styles.socioAvatarInitial}>
                {socio ? socio.charAt(0).toUpperCase() : '?'}
              </Text>
            </View>
          )}
          <View style={styles.socioInfo}>
            <Text style={styles.socioLabel}>Socio</Text>
            <Text style={styles.socioName}>{socio || '—'}</Text>
          </View>
        </View>

        {/* Benefit */}
        <View style={styles.benefitRow}>
          <Text style={styles.benefitLabel}>Beneficio canjeado</Text>
          <Text style={styles.benefitName}>{benefit || '—'}</Text>
        </View>

        {/* Fecha */}
        <View style={styles.dateRow}>
          <Text style={styles.dateLabel}>Canjeado el</Text>
          <Text style={styles.dateValue}>{formatDate(redeemed_at)}</Text>
        </View>

        {/* Contador de cupo total */}
        {result.usage_limit_total != null && (
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Canjes de este beneficio</Text>
            <Text style={styles.dateValue}>{result.total_redeemed} / {result.usage_limit_total}</Text>
          </View>
        )}

        <WCButton
          label="Validar otro"
          variant="gold"
          size="md"
          onPress={onReset}
          style={styles.resetBtn}
        />
      </WCCard>
    );
  }

  // Error result
  return (
    <WCCard accent="red2" style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <WCBadge label="ERROR" tone="danger" size="lg" />
      </View>
      <Text style={styles.errorMessage}>{result.message || 'Cupon invalido'}</Text>
      <WCButton
        label="Validar otro"
        variant="ghost"
        size="md"
        onPress={onReset}
        style={styles.resetBtn}
      />
    </WCCard>
  );
}

// ─── ManualInput ──────────────────────────────────────────────────────────────

function ManualInput({ onValidate, loading }) {
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert('Campo vacío', 'Ingresa el código del cupón.');
      return;
    }
    onValidate(trimmed, 'code');
  };

  return (
    <View style={styles.manualBlock}>
      <Text style={styles.inputLabel}>Código del cupón</Text>
      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={setCode}
        placeholder="Ej: BIRR-XXXX-1234"
        placeholderTextColor={COLORS.gray}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        editable={!loading}
      />
      <WCButton
        label={loading ? 'Validando...' : 'Validar código'}
        variant="gold"
        size="lg"
        onPress={handleSubmit}
        disabled={loading || !code.trim()}
        loading={loading}
      />
    </View>
  );
}

// ─── CameraScanner (web only) ─────────────────────────────────────────────────

function CameraScanner({ onValidate, loading }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [active, setActive] = useState(false);
  const [permState, setPermState] = useState('unknown'); // 'unknown'|'prompt'|'granted'|'denied'
  const [cameraError, setCameraError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState(0); // -1 a 1
  const [supportsFocusDistance, setSupportsFocusDistance] = useState(false);
  const touchStartRef = useRef(null);

  // Check camera permission state on mount and subscribe to changes
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    let permResult = null;
    navigator.permissions.query({ name: 'camera' }).then((result) => {
      permResult = result;
      setPermState(result.state);
      result.onchange = () => setPermState(result.state);
    }).catch(() => {
      setPermState('unknown');
    });
    return () => {
      if (permResult) permResult.onchange = null;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }
    setActive(false);
  }, []);

  // Pinch zoom handler
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      touchStartRef.current = { distance, zoom };
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartRef.current || e.touches.length !== 2) return;

    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const currentDistance = Math.hypot(
      touch2.clientX - touch1.clientX,
      touch2.clientY - touch1.clientY
    );

    const ratio = currentDistance / touchStartRef.current.distance;
    const newZoom = Math.max(1, Math.min(5, touchStartRef.current.zoom * ratio));
    setZoom(newZoom);
  }, []);

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null;
  }, []);

  // Apply zoom and focus to video
  const applyVideoTransforms = useCallback(() => {
    if (!videoRef.current) return;

    let transform = `scale(${zoom})`;
    videoRef.current.style.transform = transform;

    // Si el navegador soporta focusDistance, aplicar vía constraints
    if (supportsFocusDistance && streamRef.current && focus !== 0) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const constraints = {
          focusMode: focus < 0 ? 'continuous' : 'manual',
          focusDistance: Math.max(0, focus + 1) * 20, // 0-20
        };
        videoTrack.applyConstraints({ advanced: [constraints] }).catch(() => {});
      }
    }
  }, [zoom, focus, supportsFocusDistance]);

  // Apply video transforms when zoom or focus changes
  useEffect(() => {
    applyVideoTransforms();
  }, [zoom, focus, applyVideoTransforms]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraError(null);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setCameraError('Tu navegador no soporta acceso a cámara.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setPermState('granted');
      setActive(true);

      setTimeout(() => {
        if (!containerRef.current || typeof document === 'undefined') return;

        try {
          let video = videoRef.current;
          if (!video) {
            video = document.createElement('video');
            video.setAttribute('playsinline', '');
            video.setAttribute('autoplay', '');
            video.muted = true;
            video.style.width = '100%';
            video.style.borderRadius = '8px';
            video.style.display = 'block';
            video.style.transformOrigin = 'center';
            video.style.transition = 'transform 0.1s ease-out';
            video.addEventListener('touchstart', handleTouchStart, false);
            video.addEventListener('touchmove', handleTouchMove, false);
            video.addEventListener('touchend', handleTouchEnd, false);
            videoRef.current = video;
            containerRef.current.appendChild(video);
          }

          // Check for focusDistance support
          const checkFocusSupport = async () => {
            try {
              const videoTrack = stream.getVideoTracks()[0];
              if (videoTrack) {
                const capabilities = videoTrack.getCapabilities?.();
                if (capabilities && capabilities.focusDistance) {
                  setSupportsFocusDistance(true);
                }
              }
            } catch {}
          };
          checkFocusSupport();

          video.srcObject = stream;
          video.play().catch(() => {});

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          const tick = () => {
            if (!videoRef.current || !streamRef.current) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

              try {
                const jsQR = require('jsqr');
                const jsQRFn = jsQR.default || jsQR;
                const qrResult = jsQRFn(imageData.data, imageData.width, imageData.height);
                if (qrResult && qrResult.data) {
                  stopCamera();
                  onValidate(qrResult.data, 'scan');
                  return;
                }
              } catch {}
            }
            rafRef.current = requestAnimationFrame(tick);
          };

          rafRef.current = requestAnimationFrame(tick);
        } catch (domErr) {
          setCameraError('Error al iniciar la cámara: ' + domErr.message);
          stopCamera();
        }
      }, 100);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setPermState('denied');
      } else {
        setCameraError('No se pudo acceder a la cámara: ' + err.message);
      }
    }
  }, [onValidate, stopCamera]);

  // ── Permiso denegado — instrucciones ──────────────────────────────────────
  if (permState === 'denied') {
    return (
      <View style={styles.cameraSection}>
        <Text style={styles.sectionLabel}>Escaneo por cámara</Text>
        <WCCard style={styles.deniedCard}>
          <Text style={styles.deniedIcon}>🔒</Text>
          <Text style={styles.deniedTitle}>Cámara bloqueada</Text>
          <Text style={styles.deniedBody}>
            El permiso de cámara fue denegado. Habilitalo desde la configuración de tu dispositivo:
          </Text>

          <View style={styles.deniedPlatform}>
            <Text style={styles.deniedPlatformLabel}>Android</Text>
            <Text style={styles.deniedStep}>1. Mantén presionado el ícono de la app</Text>
            <Text style={styles.deniedStep}>2. Toca <Text style={styles.deniedMono}>Info de la app</Text> → <Text style={styles.deniedMono}>Permisos</Text></Text>
            <Text style={styles.deniedStep}>3. Activa <Text style={styles.deniedMono}>Cámara</Text> → volvé a la app</Text>
          </View>

          <View style={styles.deniedPlatform}>
            <Text style={styles.deniedPlatformLabel}>iPhone</Text>
            <Text style={styles.deniedStep}>1. Abrí <Text style={styles.deniedMono}>Configuración</Text> del iPhone</Text>
            <Text style={styles.deniedStep}>2. Buscá <Text style={styles.deniedMono}>Safari</Text> → <Text style={styles.deniedMono}>Ajustes para sitios web</Text> → <Text style={styles.deniedMono}>Cámara</Text></Text>
            <Text style={styles.deniedStep}>3. Cambiá <Text style={styles.deniedMono}>birrea2play.com</Text> a Permitir</Text>
          </View>
          <WCButton
            label="Reintentar"
            variant="ghost"
            size="md"
            onPress={startCamera}
            style={styles.retryBtn}
          />
        </WCCard>
      </View>
    );
  }

  // ── Normal render ──────────────────────────────────────────────────────────
  return (
    <View style={styles.cameraSection}>
      <Text style={styles.sectionLabel}>Escaneo por cámara</Text>

      {cameraError && (
        <WCCard style={styles.errorCard}>
          <Text style={styles.errorMessage}>{cameraError}</Text>
        </WCCard>
      )}

      {active && (
        <>
          <View
            ref={containerRef}
            style={styles.videoContainer}
            collapsable={false}
          />

          {/* Zoom display */}
          <View style={styles.controlsRow}>
            <View style={styles.zoomDisplay}>
              <Text style={styles.zoomLabel}>Zoom</Text>
              <Text style={styles.zoomValue}>{zoom.toFixed(1)}x</Text>
            </View>

            {/* Focus control */}
            <View style={styles.focusControl}>
              <Text style={styles.focusLabel}>Enfoque</Text>
              <View style={styles.focusButtonsRow}>
                <WCButton
                  label=”−”
                  variant=”secondary”
                  size=”sm”
                  onPress={() => setFocus(Math.max(-1, focus - 0.2))}
                  style={styles.focusBtn}
                />
                <View style={styles.focusSlider}>
                  <View
                    style={[
                      styles.focusSliderFill,
                      { width: `${((focus + 1) / 2) * 100}%` },
                    ]}
                  />
                </View>
                <WCButton
                  label=”+”
                  variant=”secondary”
                  size=”sm”
                  onPress={() => setFocus(Math.min(1, focus + 0.2))}
                  style={styles.focusBtn}
                />
              </View>
              <Text style={styles.focusTip}>
                {supportsFocusDistance ? 'Enfoque automático' : 'Ajuste simulado'}
              </Text>
            </View>
          </View>
        </>
      )}

      {!active ? (
        <>
          <Text style={styles.permissionHint}>
            Tocá el botón y luego elegí “Permitir” en el aviso de Chrome. Podés hacer pinch zoom con dos dedos y ajustar el enfoque.
          </Text>
          <WCButton
            label=”Permitir cámara”
            variant=”gold”
            size=”lg”
            onPress={startCamera}
            disabled={loading}
            leadingIcon=”📷”
          />
        </>
      ) : (
        <WCButton
          label=”Detener”
          variant=”ghost”
          size=”md”
          onPress={stopCamera}
          style={styles.stopBtn}
        />
      )}
    </View>
  );
}

// ─── Image preprocessing helpers ──────────────────────────────────────────────

/**
 * Mejora agresiva de contraste y brillo en una imagen para lectura de QR
 */
function enhanceImageForQR(imageData, contrastLevel = 2.5, brightnessLevel = 15) {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Convertir a luminancia (escala de grises ponderada)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Aumentar contraste alrededor del punto medio (128)
    const centered = gray - 128;
    const enhanced = Math.round(128 + centered * contrastLevel);
    const brightened = Math.min(255, Math.max(0, enhanced + brightnessLevel));

    // Establecer los 3 canales al mismo valor (escala de grises)
    data[i] = brightened;
    data[i + 1] = brightened;
    data[i + 2] = brightened;
    // Alpha se mantiene igual
  }

  return imageData;
}

/**
 * Rota el canvas 90 grados en sentido horario
 */
function rotateCanvas(canvas, degrees) {
  if (degrees === 0) return canvas;

  const rotations = Math.round((degrees % 360) / 90) % 4;
  let rotated = canvas;

  for (let i = 0; i < rotations; i++) {
    const newCanvas = document.createElement('canvas');
    const oldCanvas = rotated;

    newCanvas.width = oldCanvas.height;
    newCanvas.height = oldCanvas.width;

    const ctx = newCanvas.getContext('2d');
    ctx.translate(newCanvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(oldCanvas, 0, 0);

    rotated = newCanvas;
  }

  return rotated;
}

/**
 * Intenta leer un QR de una imagen con preprocesamiento y múltiples rotaciones
 */
function decodeQRWithEnhancement(imageData) {
  const jsQR = require('jsqr');
  const jsQRFn = jsQR.default || jsQR;

  // Intentar la imagen mejorada original
  const enhanced = enhanceImageForQR(imageData);
  let result = jsQRFn(enhanced.data, enhanced.width, enhanced.height);
  if (result && result.data) return result;

  // Si no funciona, intentar con más agresividad
  const veryEnhanced = enhanceImageForQR(imageData, 3.5, 25);
  result = jsQRFn(veryEnhanced.data, veryEnhanced.width, veryEnhanced.height);
  if (result && result.data) return result;

  return null;
}

// ─── ImageScanner (web only) ──────────────────────────────────────────────────

function ImageScanner({ onValidate, loading }) {
  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const uri = result.assets[0].uri;

      // Decode QR from image using jsQR on web
      if (typeof document === 'undefined') {
        Alert.alert('No disponible', 'El escaneo de imagen solo funciona en la versión web.');
        return;
      }

      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Intentar con preprocesamiento y mejoras
          const jsQR = require('jsqr');
          const jsQRFn = jsQR.default || jsQR;

          // Copiar imageData para no mutar el original
          const imageDataCopy = new ImageData(
            new Uint8ClampedArray(imageData.data),
            imageData.width,
            imageData.height
          );

          let qrResult = decodeQRWithEnhancement(imageDataCopy);

          if (qrResult && qrResult.data) {
            onValidate(qrResult.data, 'image');
          } else {
            Alert.alert('QR no detectado', 'No pude leer el QR. Escribí el código manualmente.');
          }
        } catch {
          Alert.alert('Error', 'No pude procesar la imagen. Escribí el código manualmente.');
        }
      };
      img.onerror = () => {
        Alert.alert('Error', 'No pude leer el QR. Escribí el código manualmente.');
      };
      img.src = uri;
    } catch (err) {
      Alert.alert('Error', 'No se pudo abrir la galería: ' + err.message);
    }
  };

  return (
    <View style={styles.imageSection}>
      <Text style={styles.sectionLabel}>Subir imagen con QR</Text>
      <WCButton
        label="Elegir imagen"
        variant="secondary"
        size="md"
        onPress={handlePickImage}
        disabled={loading}
        leadingIcon="🖼️"
      />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ClubScannerScreen({ navigation }) {
  const { user } = useAuthStore();
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null); // { ok: true, ... } | { ok: false, message }

  const handleValidate = useCallback(async (code, method) => {
    if (!code) return;
    setValidating(true);
    setResult(null);

    const { data, error } = await supabase.rpc('validate_coupon', {
      p_code: code,
      p_channel: 'presencial',
      p_method: method,
    });

    setValidating(false);

    if (error) {
      setResult({ ok: false, message: error.message });
      return;
    }

    if (data && data.ok) {
      setResult({ ok: true, ...data });
    } else {
      setResult({ ok: false, message: (data && data.message) || 'Respuesta inesperada del servidor.' });
    }
  }, []);

  const handleReset = useCallback(() => {
    setResult(null);
  }, []);

  return (
    <View style={styles.frame}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <WCHeader
            title="Escáner"
            kicker="COMERCIO ALIADO"
            onBack={() => navigation.goBack()}
          />

          {validating && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={COLORS.gold} />
              <Text style={styles.loadingText}>Validando cupón...</Text>
            </View>
          )}

          {result ? (
            <ResultCard result={result} onReset={handleReset} />
          ) : (
            <>
              {/* Web: camera + image + manual */}
              {isWeb ? (
                <>
                  <WCCard accent="gold" style={styles.methodCard}>
                    <WCSectionTitle accent="gold">Método 1</WCSectionTitle>
                    <CameraScanner onValidate={handleValidate} loading={validating} />
                  </WCCard>

                  <WCCard style={styles.methodCard}>
                    <WCSectionTitle>Método 2</WCSectionTitle>
                    <ImageScanner onValidate={handleValidate} loading={validating} />
                  </WCCard>

                  <WCCard style={styles.methodCard}>
                    <WCSectionTitle>Método 3 — Código manual</WCSectionTitle>
                    <ManualInput onValidate={handleValidate} loading={validating} />
                  </WCCard>
                </>
              ) : (
                /* Native: manual fallback; este flujo se usa como PWA web. */
                <>
                  <WCCard style={styles.infoCard}>
                    <Text style={styles.infoText}>
                      Abrí Birrea2Play desde la PWA instalada para escanear el QR con la cámara.
                    </Text>
                  </WCCard>

                  <WCCard accent="gold" style={styles.methodCard}>
                    <WCSectionTitle>Código manual</WCSectionTitle>
                    <ManualInput onValidate={handleValidate} loading={validating} />
                  </WCCard>
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl * 2,
  },

  // Loading
  loadingOverlay: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
  },
  loadingText: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 14,
  },

  // Method cards
  methodCard: {
    marginBottom: SPACING.md,
  },
  sectionLabel: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
    fontSize: 14,
    marginBottom: SPACING.sm,
  },

  // Info (native)
  infoCard: {
    marginBottom: SPACING.md,
    borderColor: COLORS.gold + '55',
  },
  infoText: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 14,
    lineHeight: 20,
  },
  infoLink: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.gold,
  },

  // Camera
  cameraSection: {
    gap: SPACING.sm,
  },
  videoContainer: {
    width: '100%',
    minHeight: 260,
    backgroundColor: '#000',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    marginBottom: SPACING.sm,
  },
  errorCard: {
    marginBottom: SPACING.sm,
  },
  stopBtn: {
    marginTop: SPACING.xs,
  },
  permissionHint: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },

  // Permiso denegado
  deniedCard: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    gap: SPACING.sm,
  },
  deniedIcon: {
    fontSize: 36,
    marginBottom: SPACING.xs,
  },
  deniedTitle: {
    fontFamily: FONTS.heading,
    fontSize: 18,
    color: COLORS.white,
    letterSpacing: 1,
    textAlign: 'center',
  },
  deniedBody: {
    fontFamily: FONTS.body,
    fontSize: 14,
    color: COLORS.gray2,
    textAlign: 'center',
    lineHeight: 20,
  },
  deniedPlatform: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  deniedPlatformLabel: {
    fontFamily: FONTS.heading,
    fontSize: 12,
    color: COLORS.gold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  deniedStep: {
    fontFamily: FONTS.body,
    fontSize: 13,
    color: COLORS.gray2,
    lineHeight: 20,
  },
  deniedMono: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
  },
  retryBtn: {
    marginTop: SPACING.sm,
    width: '100%',
  },

  // Image picker
  imageSection: {
    gap: SPACING.sm,
  },

  // Manual input
  manualBlock: {
    gap: SPACING.sm,
  },
  inputLabel: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.gray2,
    fontSize: 13,
  },
  codeInput: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontFamily: FONTS.bodyBold,
    fontSize: 16,
    color: COLORS.white,
    letterSpacing: 2,
  },

  // Result card
  resultCard: {
    marginTop: SPACING.sm,
  },
  resultHeader: {
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  socioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.card + 'CC',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  socioAvatar: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.full,
    borderWidth: 2,
    borderColor: COLORS.gold,
  },
  socioAvatarPlaceholder: {
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socioAvatarInitial: {
    fontFamily: FONTS.heading,
    fontSize: 22,
    color: COLORS.gold,
  },
  socioInfo: {
    flex: 1,
  },
  socioLabel: {
    fontFamily: FONTS.body,
    color: COLORS.gray,
    fontSize: 12,
    marginBottom: 2,
  },
  socioName: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
    fontSize: 16,
  },
  benefitRow: {
    marginBottom: SPACING.sm,
  },
  benefitLabel: {
    fontFamily: FONTS.body,
    color: COLORS.gray,
    fontSize: 12,
    marginBottom: 2,
  },
  benefitName: {
    fontFamily: FONTS.bodySemiBold,
    color: COLORS.gold,
    fontSize: 15,
  },
  dateRow: {
    marginBottom: SPACING.md,
  },
  dateLabel: {
    fontFamily: FONTS.body,
    color: COLORS.gray,
    fontSize: 12,
    marginBottom: 2,
  },
  dateValue: {
    fontFamily: FONTS.body,
    color: COLORS.gray2,
    fontSize: 14,
  },
  errorMessage: {
    fontFamily: FONTS.body,
    color: COLORS.red2,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  resetBtn: {
    marginTop: SPACING.xs,
  },

  // Zoom and focus controls
  controlsRow: {
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  zoomDisplay: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  zoomLabel: {
    fontFamily: FONTS.body,
    color: COLORS.gray,
    fontSize: 12,
    marginBottom: 2,
  },
  zoomValue: {
    fontFamily: FONTS.heading,
    color: COLORS.gold,
    fontSize: 20,
    letterSpacing: 0.5,
  },
  focusControl: {
    gap: SPACING.xs,
  },
  focusLabel: {
    fontFamily: FONTS.bodyBold,
    color: COLORS.white,
    fontSize: 13,
  },
  focusButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  focusBtn: {
    minWidth: 40,
    paddingHorizontal: SPACING.xs,
  },
  focusSlider: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.full,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  focusSliderFill: {
    height: '100%',
    backgroundColor: COLORS.gold,
    borderRadius: RADIUS.full,
  },
  focusTip: {
    fontFamily: FONTS.body,
    color: COLORS.gray,
    fontSize: 11,
    textAlign: 'center',
  },
});
