// Upload cross-platform de una imagen desde un URI local (file:// en native,
// blob:/data: en web) hacia Supabase Storage.
//
// El patrón RN clásico `formData.append('file', { uri, type, name })` NO funciona
// en web — el navegador no sabe leer ese objeto custom y envía body vacío
// (resulta en 400 "no content provided"). Acá usamos fetch().blob() que funciona
// en ambos: web devuelve Blob real, RN moderno (Hermes/SDK 54+) también lee
// file:// y blob:// y devuelve un Blob compatible.
import { Platform } from 'react-native';
import { supabase } from './supabase';

function inferExtAndType(uri, fallback = 'jpg') {
  let ext = (uri.split('.').pop() ?? '').toLowerCase().replace(/\?.*$/, '');
  if (!ext || ext.length > 5 || !['jpg','jpeg','png','webp','heic'].includes(ext)) {
    ext = fallback;
  }
  if (ext === 'jpeg') ext = 'jpg';
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return { ext, contentType };
}

export { inferExtAndType };

async function uriToBlob(uri) {
  if (!uri) throw new Error('URI vacío');
  let resp;
  try {
    resp = await fetch(uri);
  } catch (e) {
    throw new Error(`No se pudo leer la imagen seleccionada. Volvé a elegirla y guardá enseguida.`);
  }
  if (!resp.ok) throw new Error(`No se pudo leer la imagen (HTTP ${resp.status})`);
  const blob = await resp.blob();
  if (!blob || blob.size === 0) throw new Error('Imagen vacía o ilegible');
  return blob;
}

// Resuelve cualquier "source" a un Blob/File listo para subir.
// Acepta:
//   - string (uri file:// o blob: o data:)
//   - Blob / File
//   - { uri, file? } (asset de expo-image-picker; en web file es un File real)
async function resolveToBlob(source) {
  if (!source) throw new Error('Source vacío para upload');
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source;
  if (typeof source === 'object') {
    if (source.blob && (typeof Blob === 'undefined' || source.blob instanceof Blob)) {
      return source.blob;
    }
    if (source.file && (typeof Blob === 'undefined' || source.file instanceof Blob)) {
      return source.file;
    }
    if (source.uri) return uriToBlob(source.uri);
  }
  if (typeof source === 'string') return uriToBlob(source);
  throw new Error('Source de imagen no soportado');
}

/**
 * Sube una imagen al bucket especificado.
 * @param {string} bucket          — nombre del bucket de Supabase Storage
 * @param {string} path            — path dentro del bucket (sin slash inicial)
 * @param {string|Blob|object} source — uri, Blob/File, o asset { uri, file }
 * @returns {Promise<string>} publicUrl
 */
export async function uploadImage(bucket, path, source) {
  const sourceUri = typeof source === 'string' ? source : source?.uri;
  const explicitExt = typeof source === 'object' ? source?.ext : null;
  const { contentType, ext } = inferExtAndType(sourceUri ?? '', explicitExt || 'jpg');
  const finalPath = path.endsWith(`.${ext}`) || path.includes('.') ? path : `${path}.${ext}`;
  const blob = await resolveToBlob(source);

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(finalPath, blob, { contentType, upsert: true });
    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(finalPath);
      return data.publicUrl;
    }
    lastErr = error;
  }
  throw lastErr;
}
