import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, RADIUS } from '../../constants/theme';

let CameraView = null;
if (Platform.OS !== 'web') {
  try { CameraView = require('expo-camera').CameraView; } catch (_) {}
}

let jsQR = null;
if (Platform.OS === 'web') {
  try { jsQR = require('jsqr'); } catch (_) {}
}

export default function AdminQRScannerScreen({ navigation }) {
  // 'idle' | 'granted' | 'denied'
  const [camState, setCamState] = useState('idle');
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);
  const doneRef   = useRef(false);

  // Iniciar cámara en web una vez que tengamos permiso
  useEffect(() => {
    if (Platform.OS !== 'web' || camState !== 'granted') return;
    doneRef.current = false;
    let active = true;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        tick();
      })
      .catch(() => setCamState('denied'));

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [camState]);

  function tick() {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || doneRef.current) return;
    if (v.readyState === 4) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(v, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR?.(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        doneRef.current = true;
        handleResult(code.data);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function handleResult(raw) {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(rafRef.current);
    const codigo = raw.split('/').pop().toUpperCase().trim();
    Alert.alert('Código QR', codigo, [
      { text: 'Escanear otro', onPress: () => { doneRef.current = false; setCamState('idle'); setTimeout(() => setCamState('granted'), 100); } },
      { text: 'Cerrar', onPress: () => navigation.goBack() },
    ]);
  }

  // ── Este onPress llama getUserMedia DIRECTAMENTE — Chrome lo requiere ──────
  function handleSolicitarPermiso() {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop()); // liberar; el useEffect abre de nuevo
        setCamState('granted');
      })
      .catch((err) => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCamState('denied');
        } else {
          Alert.alert('Error', err.message);
        }
      });
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={s.title}>Escanear QR</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Contenido */}
      {camState === 'idle' && (
        <View style={s.gate}>
          <Text style={s.gateIcon}>📷</Text>
          <Text style={s.gateTitle}>SE NECESITA{'\n'}LA CÁMARA</Text>
          <Text style={s.gateBody}>
            Tocá el botón para que el navegador te pida acceso a la cámara y puedas escanear los QR.
          </Text>
          {/* Botón HTML nativo — garantiza "user gesture" para getUserMedia en Chrome */}
          <button
            onClick={handleSolicitarPermiso}
            style={{
              backgroundColor: '#23D18B',
              color: '#07080B',
              border: 'none',
              borderRadius: 10,
              padding: '16px 32px',
              fontSize: 16,
              fontWeight: '600',
              cursor: 'pointer',
              marginTop: 16,
            }}
          >
            Solicitar permiso de cámara
          </button>
        </View>
      )}

      {camState === 'denied' && (
        <View style={s.gate}>
          <Text style={s.gateIcon}>🚫</Text>
          <Text style={s.gateTitle}>CÁMARA{'\n'}BLOQUEADA</Text>
          <Text style={s.gateBody}>
            Habilitá el permiso en el ícono 🔒 de la barra de dirección del navegador → Cámara → Permitir. Luego recargá la página.
          </Text>
        </View>
      )}

      {camState === 'granted' && Platform.OS === 'web' && (
        <View style={s.scanArea}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline muted />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <View style={s.overlay} pointerEvents="none">
            <Text style={s.hint}>Apuntá al código QR del cupón</Text>
            <View style={s.reticle}>
              <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} />
              <View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
            </View>
          </View>
        </View>
      )}

      {Platform.OS !== 'web' && CameraView && (
        <NativeScanner onScanned={handleResult} />
      )}
    </SafeAreaView>
  );
}

function NativeScanner({ onScanned }) {
  const done = useRef(false);
  return (
    <View style={s.scanArea}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          done.current = true;
          onScanned(data);
        }}
      />
      <View style={s.overlay} pointerEvents="none">
        <Text style={s.hint}>Apuntá al código QR del cupón</Text>
        <View style={s.reticle}>
          <View style={[s.corner, s.tl]} /><View style={[s.corner, s.tr]} />
          <View style={[s.corner, s.bl]} /><View style={[s.corner, s.br]} />
        </View>
      </View>
    </View>
  );
}

const C = 28; const T = 4;
const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: COLORS.bg },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  back:     { padding: SPACING.sm, minWidth: 80 },
  backText: { fontFamily: FONTS.body, color: COLORS.gray2, fontSize: 14 },
  title:    { fontFamily: FONTS.heading, color: COLORS.white, fontSize: 18, letterSpacing: 1 },

  gate:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.lg },
  gateIcon:  { fontSize: 64 },
  gateTitle: { fontFamily: FONTS.heading, fontSize: 26, color: COLORS.white, letterSpacing: 3, textAlign: 'center', lineHeight: 32 },
  gateBody:  { fontFamily: FONTS.body, fontSize: 15, color: COLORS.gray2, textAlign: 'center', lineHeight: 22 },
  btn:       { backgroundColor: COLORS.green, borderRadius: RADIUS.md, paddingVertical: SPACING.lg, paddingHorizontal: SPACING.xl, marginTop: SPACING.md },
  btnText:   { fontFamily: FONTS.bodySemiBold, color: COLORS.bg, fontSize: 16 },

  scanArea:  { flex: 1, backgroundColor: '#000', position: 'relative' },
  overlay:   { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hint:      { fontFamily: FONTS.body, color: COLORS.white, fontSize: 14, marginBottom: SPACING.xl, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  reticle:   { width: 220, height: 220, position: 'relative' },
  corner:    { position: 'absolute', width: C, height: C },
  tl: { top: 0, left: 0,    borderTopWidth: T, borderLeftWidth: T,  borderColor: COLORS.green },
  tr: { top: 0, right: 0,   borderTopWidth: T, borderRightWidth: T, borderColor: COLORS.green },
  bl: { bottom: 0, left: 0, borderBottomWidth: T, borderLeftWidth: T,  borderColor: COLORS.green },
  br: { bottom: 0, right: 0,borderBottomWidth: T, borderRightWidth: T, borderColor: COLORS.green },
});
