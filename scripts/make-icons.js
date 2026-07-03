#!/usr/bin/env node
/**
 * Genera todos los íconos de la app (PWA + nativo) desde un PNG fuente,
 * aplanados sobre fondo NEGRO.
 *
 * Requiere `sharp`:  npm i -D sharp
 *
 * Uso:  node scripts/make-icons.js [ruta-al-png-fuente]
 *   Por defecto usa assets/icon-source.png
 *
 * Salidas en assets/:
 *   icon.png             1024  full, negro      -> app.json icon (iOS + general)
 *   pwa-icon-192.png      192  full, negro      -> manifest purpose "any"
 *   pwa-icon-512.png      512  full, negro      -> manifest purpose "any"
 *   pwa-maskable-512.png  512  logo 78% s/negro -> manifest purpose "maskable"
 *   apple-touch-icon.png  180  full, negro      -> iOS "Agregar a inicio"
 *   favicon.png            48  full, negro      -> pestaña del navegador
 *   adaptive-icon.png    1024  logo 78% transp. -> Android adaptive foreground
 */
const path = require('path');
let sharp;
try { sharp = require('sharp'); }
catch { console.error('Falta sharp. Instalá:  npm i -D sharp'); process.exit(1); }

const ASSETS = path.resolve(__dirname, '..', 'assets');
const SRC = process.argv[2] || path.join(ASSETS, 'icon-source.png');
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

// Arte completo, aplanado sobre negro (sin transparencia).
// fit:'cover' recorta al cuadrado (la fuente no es perfectamente cuadrada) para
// que NO queden franjas negras. El arte está centrado, no se pierde nada clave.
async function flat(size, out) {
  await sharp(SRC)
    .resize(size, size, { fit: 'cover', position: 'center' })
    .flatten({ background: BLACK })
    .png()
    .toFile(path.join(ASSETS, out));
  console.log('  +', out, `${size}x${size} (negro)`);
}

// Logo escalado y centrado con margen para que el mask del launcher no lo
// recorte. Fondo negro opaco (maskable PWA) o transparente (adaptive nativo).
async function safezone(size, out, scale, opaqueBlack) {
  const inner = Math.round(size * scale);
  const logo = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: CLEAR })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: opaqueBlack ? BLACK : CLEAR } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(ASSETS, out));
  console.log('  +', out, `${size}x${size} logo ${Math.round(scale * 100)}%`, opaqueBlack ? '(negro)' : '(transparente)');
}

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(SRC)) {
    console.error('No existe la fuente:', SRC, '\nGuardá el PNG ahí (>=1024px) o pasá la ruta como argumento.');
    process.exit(1);
  }
  console.log('Fuente:', SRC);
  await flat(1024, 'icon.png');
  await flat(512,  'pwa-icon-512.png');
  await flat(192,  'pwa-icon-192.png');
  await flat(180,  'apple-touch-icon.png');
  await flat(48,   'favicon.png');
  await safezone(512,  'pwa-maskable-512.png', 0.78, true);
  await safezone(1024, 'adaptive-icon.png',    0.78, false);
  console.log('Listo. Íconos en assets/');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
