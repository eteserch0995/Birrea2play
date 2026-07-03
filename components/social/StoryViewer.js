// Visor de HISTORIA a pantalla completa (estilo Instagram).
//
// Barras de progreso arriba (una por segmento), auto-avance, tap izquierda/derecha
// para retroceder/avanzar, X para cerrar. Muestra el contador "desaparece en Xh"
// para comunicar la regla de 24h. Foto = placeholder de color (offline).

import React from 'react';
import { View, Text, StyleSheet, TouchableWithoutFeedback, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../constants/theme';
import BeltPoster from './BeltPoster';

const ITEM_MS = 4500;
const TICK = 60;

// Recorta un indice al rango [0, len-1] tolerando NaN/negativos (clamp defensivo).
function clampIndex(i, len) {
  if (!Number.isFinite(i) || i < 0) return 0;
  if (len <= 0) return 0;
  return Math.min(i, len - 1);
}

export default function StoryViewer({ stories, startIndex = 0, onClose, onRetar, onCompartir, onSeen }) {
  const safeStories = Array.isArray(stories) ? stories : [];

  const [userIdx, setUserIdx] = React.useState(() => clampIndex(startIndex, safeStories.length));
  const [itemIdx, setItemIdx] = React.useState(0);
  const [progress, setProgress] = React.useState(0);

  const user = safeStories[userIdx];
  const items = user?.items ?? [];
  // Clamp defensivo: aunque itemIdx quede fuera de rango (cambio de usuario, tap-spam, data corrupta)
  // nunca indexamos undefined => el visor jamas queda en blanco dejando ver el Home detras.
  const safeItemIdx = clampIndex(itemIdx, items.length);
  const item = items[safeItemIdx];
  const hasContent = !!user && !!item;

  // Reportar al padre CADA usuario alcanzado como 'visto' (incluye los recorridos por auto-avance,
  // no solo el de entrada). Ref para no recrear el effect si el padre pasa una funcion inline.
  const onSeenRef = React.useRef(onSeen);
  React.useEffect(() => { onSeenRef.current = onSeen; });
  React.useEffect(() => {
    if (user) onSeenRef.current?.(userIdx);
    // Intencional: solo depende de userIdx (un disparo por usuario alcanzado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIdx]);

  // Si itemIdx quedo fuera de rango, corregir el estado (el render ya usa safeItemIdx).
  React.useEffect(() => {
    if (items.length > 0 && itemIdx > items.length - 1) setItemIdx(items.length - 1);
  }, [items.length, itemIdx]);

  const goNext = React.useCallback(() => {
    setProgress(0);
    if (safeItemIdx < items.length - 1) { setItemIdx(safeItemIdx + 1); return; }
    // saltar al siguiente usuario que tenga historias
    let nu = userIdx + 1;
    while (nu < safeStories.length && (safeStories[nu].items?.length ?? 0) === 0) nu++;
    if (nu < safeStories.length) { setUserIdx(nu); setItemIdx(0); return; }
    onClose?.();
  }, [safeItemIdx, items.length, userIdx, safeStories, onClose]);

  const goPrev = React.useCallback(() => {
    setProgress(0);
    if (safeItemIdx > 0) { setItemIdx(safeItemIdx - 1); return; }
    let pu = userIdx - 1;
    while (pu >= 0 && (safeStories[pu].items?.length ?? 0) === 0) pu--;
    if (pu >= 0) {
      setUserIdx(pu);
      // Modelo Instagram: retroceder cae en el ULTIMO segmento del usuario previo, no en el 0.
      setItemIdx(Math.max((safeStories[pu].items?.length ?? 1) - 1, 0));
      return;
    }
    setItemIdx(0); // ya estamos en el primer segmento del primer usuario: reinicia el actual
  }, [safeItemIdx, userIdx, safeStories]);

  React.useEffect(() => {
    // El afiche del cinturon (belt_card) NO auto-avanza: es terminal y tiene botones.
    // Sin contenido valido: no se arma timer (evita subir progress sobre la nada).
    if (!hasContent || item.kind === 'belt_card') return undefined;
    const t = setInterval(() => {
      // Updater PURO: solo acumula progress y lo capa en 1. El avance se dispara en otro effect.
      setProgress((p) => (p >= 1 ? 1 : p + TICK / ITEM_MS));
    }, TICK);
    return () => clearInterval(t);
  }, [hasContent, item, userIdx, safeItemIdx]);

  // Avance al completar la barra: side-effect en un effect, NUNCA dentro de un updater de setState
  // (asi no se dispara 'Cannot update a component while rendering a different component').
  React.useEffect(() => {
    if (progress >= 1) goNext();
  }, [progress, goNext]);

  // Sin contenido valido (usuario sin items, data corrupta): pintamos overlay negro para no filtrar
  // el Home y cerramos en el proximo tick (no se queda colgado ni en blanco).
  React.useEffect(() => {
    if (!hasContent) {
      const id = setTimeout(() => onClose?.(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [hasContent, onClose]);

  if (!hasContent) return <View style={styles.overlay} />;

  return (
    <View style={styles.overlay}>
      {/* Contenido: afiche del cinturon (belt_card) o foto (placeholder de color) */}
      {item.kind === 'belt_card' ? (
        <View style={styles.photo}>
          <BeltPoster
            fight={item.fight}
            onRetar={() => onRetar?.(item.fight)}
            onCompartir={() => onCompartir?.(item.fight)}
          />
        </View>
      ) : (
        <View style={[styles.photo, { backgroundColor: item.tone }]} />
      )}

      {/* Zonas de tap solo para fotos: en el afiche se omiten para no robarle el toque a los botones */}
      {item.kind !== 'belt_card' && (
        <>
          <TouchableWithoutFeedback onPress={goPrev}><View style={styles.zoneLeft} /></TouchableWithoutFeedback>
          <TouchableWithoutFeedback onPress={goNext}><View style={styles.zoneRight} /></TouchableWithoutFeedback>
        </>
      )}

      {/* Barras de progreso */}
      <View style={styles.progressRow}>
        {items.map((_, i) => (
          <View key={i} style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${i < safeItemIdx ? 100 : i === safeItemIdx ? Math.min(progress * 100, 100) : 0}%` },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.hAvatar, { backgroundColor: user.tone ?? COLORS.navy }]}>
          <Text style={styles.hAvatarText}>{user.initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.hName}>{user.username}</Text>
          <Text style={styles.hMeta}>{item.timeAgo} · desaparece en {item.expiresIn}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.close}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Caption */}
      {item.caption ? (
        <View style={styles.captionWrap}>
          <Text style={styles.caption}>{item.caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', zIndex: 100 },
  photo: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  zoneLeft: { position: 'absolute', top: 96, bottom: 0, left: 0, width: '30%', zIndex: 2 },
  zoneRight: { position: 'absolute', top: 96, bottom: 0, right: 0, width: '70%', zIndex: 2 },

  progressRow: { position: 'absolute', top: 14, left: SPACING.sm, right: SPACING.sm, flexDirection: 'row', gap: 4, zIndex: 3 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#FFFFFF55', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },

  header: { position: 'absolute', top: 28, left: SPACING.md, right: SPACING.md, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, zIndex: 3 },
  hAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  hAvatarText: { fontFamily: FONTS.heading, fontSize: 16, color: COLORS.white },
  hName: { fontFamily: FONTS.bodyBold, fontSize: 14, color: '#FFFFFF' },
  hMeta: { fontFamily: FONTS.body, fontSize: 11, color: '#FFFFFFCC' },
  close: { fontFamily: FONTS.bodyBold, fontSize: 22, color: '#FFFFFF' },

  captionWrap: { position: 'absolute', bottom: 40, left: SPACING.md, right: SPACING.md, zIndex: 3 },
  caption: { fontFamily: FONTS.bodyMedium, fontSize: 16, color: '#FFFFFF', textShadowColor: '#00000088', textShadowRadius: 6 },
});
