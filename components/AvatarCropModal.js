// Cropper circular para foto de perfil en WEB. En native no se usa: el cropper
// nativo de expo-image-picker ya cubre el caso con allowsEditing:true.
//
// Recibe la imagen original (uri o asset { uri }) y devuelve un Blob recortado
// en `onCropped`. El llamador se encarga de pasarlo a uploadAvatar.
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, RADIUS } from '../constants/theme';

// Lazy require: solo carga la lib en web (en native no se importa nunca).
const CropperLib = Platform.OS === 'web' ? require('react-easy-crop') : null;
const Cropper    = CropperLib?.default ?? null;

// Recorta el área seleccionada de la imagen y devuelve un Blob.
async function getCroppedBlob(imageSrc, cropArea, outputSize = 512) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');
      // Pintamos el crop area en el canvas escalado a outputSize x outputSize.
      ctx.drawImage(
        image,
        cropArea.x, cropArea.y, cropArea.width, cropArea.height,
        0, 0, outputSize, outputSize,
      );
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('No se pudo recortar la imagen'));
        resolve(blob);
      }, 'image/jpeg', 0.85);
    };
    image.onerror = () => reject(new Error('No se pudo cargar la imagen para recortar'));
    image.src = imageSrc;
  });
}

export default function AvatarCropModal({ visible, sourceUri, onCancel, onCropped }) {
  const [crop,      setCrop]      = useState({ x: 0, y: 0 });
  const [zoom,      setZoom]      = useState(1);
  const [areaPixels, setAreaPixels] = useState(null);
  const [saving,    setSaving]    = useState(false);

  const onCropComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    setAreaPixels(croppedAreaPixels);
  }, []);

  async function handleSave() {
    if (!sourceUri || !areaPixels) return;
    setSaving(true);
    try {
      const blob = await getCroppedBlob(sourceUri, areaPixels);
      onCropped?.(blob);
    } catch (e) {
      onCancel?.();
    } finally {
      setSaving(false);
    }
  }

  // En native no debería abrirse — el cropper nativo cubre el caso.
  if (Platform.OS !== 'web' || !Cropper) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modalBox}>
          <Text style={styles.title}>Ajustá tu foto</Text>
          <Text style={styles.subtitle}>Arrastrá y usá el zoom para centrar tu cara</Text>

          <View style={styles.cropperArea}>
            <Cropper
              image={sourceUri}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </View>

          {/* Zoom slider (HTML range en web) */}
          <View style={styles.controls}>
            <Text style={styles.controlLabel}>Zoom</Text>
            {/* @ts-ignore -- input nativo HTML disponible en web */}
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: COLORS.gold }}
            />
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={onCancel} disabled={saving}>
              <Text style={styles.btnCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSave, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving || !areaPixels}>
              {saving
                ? <ActivityIndicator color={COLORS.bg} size="small" />
                : <Text style={styles.btnSaveText}>Usar esta foto</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  modalBox:   { backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.lg, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: COLORS.navy, gap: SPACING.md },
  title:      { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.white, letterSpacing: 2 },
  subtitle:   { fontFamily: FONTS.body, fontSize: 12, color: COLORS.gray2 },
  cropperArea:{ position: 'relative', width: '100%', height: 320, backgroundColor: COLORS.bg, borderRadius: RADIUS.md, overflow: 'hidden' },
  controls:   { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  controlLabel:{ fontFamily: FONTS.bodyMedium, fontSize: 12, color: COLORS.gray2, width: 50 },
  btnRow:     { flexDirection: 'row', gap: SPACING.sm },
  btn:        { flex: 1, paddingVertical: SPACING.md, borderRadius: RADIUS.sm, alignItems: 'center' },
  btnCancel:  { backgroundColor: COLORS.navy },
  btnCancelText:{ fontFamily: FONTS.bodyMedium, fontSize: 13, color: COLORS.white },
  btnSave:    { backgroundColor: COLORS.gold },
  btnSaveText:{ fontFamily: FONTS.bodyBold, fontSize: 13, color: COLORS.bg, letterSpacing: 0.5 },
});
