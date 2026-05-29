// Procesa una imagen de evento: crop center 16:9 + resize a 1600x900 + JPEG calidad 0.85.
// En web usa Canvas y devuelve un Blob estable + dataURL para preview (no expira).
// En native confía en el crop nativo del picker (allowsEditing + aspect [16,9]) y
// devuelve el source tal cual — file:// no expira.
//
// Resultado en web: ~120-300 KB por imagen, sin importar el tamaño original.
// Esto previene errores de "Failed Fetch" por blob: URLs expirados.

import { Platform } from 'react-native';

const TARGET_W = 1600;
const TARGET_H = 900;
const TARGET_AR = TARGET_W / TARGET_H; // 16:9
const QUALITY = 0.85;

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
    img.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob devolvió null'))),
      type,
      quality,
    );
  });
}

async function processWeb(source) {
  const file = source?.file ?? (source instanceof Blob ? source : null);
  const uri  = typeof source === 'string' ? source : source?.uri;
  if (!file && !uri) throw new Error('Imagen sin file ni uri.');

  let objectUrl = null;
  let imgSrc = uri;
  try {
    if (file) {
      objectUrl = URL.createObjectURL(file);
      imgSrc = objectUrl;
    }
    const img = await loadImageElement(imgSrc);

    const srcAR = img.naturalWidth / img.naturalHeight;
    let sx, sy, sw, sh;
    if (srcAR > TARGET_AR) {
      sh = img.naturalHeight;
      sw = sh * TARGET_AR;
      sx = (img.naturalWidth - sw) / 2;
      sy = 0;
    } else {
      sw = img.naturalWidth;
      sh = sw / TARGET_AR;
      sx = 0;
      sy = (img.naturalHeight - sh) / 2;
    }

    const canvas = document.createElement('canvas');
    canvas.width  = TARGET_W;
    canvas.height = TARGET_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TARGET_W, TARGET_H);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);

    const blob    = await canvasToBlob(canvas, 'image/jpeg', QUALITY);
    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    const processedFile = new File([blob], 'event.jpg', { type: 'image/jpeg' });

    return { blob, file: processedFile, previewUrl: dataUrl, ext: 'jpg' };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Procesa una imagen de evento para upload estable a 16:9 / 1600x900 / JPEG 0.85.
 * @param {object|string} source — asset de expo-image-picker, File, Blob o uri string
 * @returns {Promise<{ blob?: Blob, file?: File, previewUrl: string, uri?: string, ext: string }>}
 */
export async function processEventImage(source) {
  if (Platform.OS === 'web') {
    return processWeb(source);
  }
  const uri = typeof source === 'string' ? source : source?.uri;
  return { uri, previewUrl: uri, ext: 'jpg' };
}
