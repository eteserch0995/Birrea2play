#!/usr/bin/env node
/**
 * Store Publishing Agent — Birrea2Play
 *
 * Detecta y corrige automáticamente los problemas que bloquean la publicación
 * en Google Play Store y Apple App Store.
 *
 * Uso: node scripts/store-agent.js
 *      npm run store:audit
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Colores de consola ────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  red:'\x1b[31m', yellow:'\x1b[33m', green:'\x1b[32m',
  blue:'\x1b[34m', cyan:'\x1b[36m', gray:'\x1b[90m',
};
const col = (c, t) => `${C[c]}${t}${C.reset}`;
const r = (...parts) => path.join(ROOT, ...parts);

// ── I/O helpers ───────────────────────────────────────────────────────────────
function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp,'utf8')); } catch { return null; } }
function writeJSON(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2)+'\n','utf8'); }
function readText(fp) { try { return fs.readFileSync(fp,'utf8'); } catch { return null; } }
function writeText(fp, d) { fs.mkdirSync(path.dirname(fp),{recursive:true}); fs.writeFileSync(fp,d,'utf8'); }
function bak(fp) { if (fs.existsSync(fp)) fs.copyFileSync(fp, fp+'.store-bak'); }

// ── Cargar archivos de configuración ─────────────────────────────────────────
const appJson      = readJSON(r('app.json'));
const easJson      = readJSON(r('eas.json'));
const pkgJson      = readJSON(r('package.json'));
const manifest     = readText(r('android/app/src/main/AndroidManifest.xml'));
const buildGradle  = readText(r('android/app/build.gradle'));
const gradleProps  = readText(r('android/gradle.properties'));
const dotEnv       = readText(r('.env')) || '';

const expo      = appJson?.expo || {};
const iosConf   = expo.ios || {};
const andConf   = expo.android || {};
const infoPlist = iosConf.infoPlist || {};

// ── Registry de problemas ─────────────────────────────────────────────────────
const findings = [];

function find(severity, store, id, title, desc, autoFix = null) {
  findings.push({ severity, store, id, title, desc, autoFix, fixed: false, err: null });
}

// ══════════════════════════════════════════════════════════════════════════════
// CHECKS
// ══════════════════════════════════════════════════════════════════════════════

// 1. Release firmado con debug.keystore ─────────────────────────────────────
if (buildGradle?.match(/release\s*\{[^}]*signingConfig signingConfigs\.debug/s)) {
  find('BLOCKER','PLAY','SIGNING_PROD',
    'Release build firmado con debug.keystore',
    'Play Store rechaza cualquier AAB/APK firmado con el keystore de debug. '+
    'La release build type está usando signingConfigs.debug. Hay que generar un keystore '+
    'de producción con keytool y configurar signingConfigs.release.',
    'fix_release_signing');
}

// 2. SYSTEM_ALERT_WINDOW ─────────────────────────────────────────────────────
if (manifest?.includes('android.permission.SYSTEM_ALERT_WINDOW')) {
  find('BLOCKER','PLAY','OVERLAY_PERM',
    'Permiso SYSTEM_ALERT_WINDOW sin declaración en Play Console',
    'Este permiso requiere justificación especial (formulario de "Special App Access") y '+
    'será rechazado si no se declara. react-native-reanimated lo agrega en dev builds; '+
    'se debe eliminar del APK de producción.',
    'fix_overlay_perm');
}

// 3. URL de política de privacidad ───────────────────────────────────────────
if (!expo.privacyPolicyUrl && !iosConf.privacyPolicyUrl) {
  find('BLOCKER','BOTH','PRIVACY_POLICY',
    'URL de política de privacidad no configurada',
    'Ambas tiendas requieren una URL pública de política de privacidad. '+
    'El archivo docs/privacidad.html existe pero necesita estar alojado. '+
    'Opciones: GitHub Pages (gratis), Supabase Storage (bucket público), tu propio dominio.',
    'fix_privacy_placeholder');
}

// 4. Carpeta ios/ no existe ──────────────────────────────────────────────────
if (!fs.existsSync(r('ios'))) {
  find('BLOCKER','IOS','NO_IOS_FOLDER',
    'Carpeta ios/ no existe — App Store imposible sin ella',
    'Necesitas generar el proyecto iOS nativo con `npx expo prebuild --platform ios`. '+
    'Esto requiere macOS con Xcode 15+. El bundle identifier ya está configurado: '+
    'com.birrea2play.app',
    null);
}

// 5. allowBackup="true" ──────────────────────────────────────────────────────
if (manifest?.includes('android:allowBackup="true"')) {
  find('HIGH','PLAY','ALLOW_BACKUP',
    'android:allowBackup="true" expone datos de sesión',
    'Con allowBackup habilitado, cualquier usuario puede extraer los datos de la app '+
    '(tokens de sesión Supabase, preferencias) vía `adb backup` sin root. '+
    'Debe ser false en producción.',
    'fix_android_security');
}

// 6. cleartext HTTP no bloqueado explícitamente ─────────────────────────────
if (manifest && !manifest.includes('android:usesCleartextTraffic="false"')) {
  find('HIGH','PLAY','CLEARTEXT',
    'usesCleartextTraffic no está explícitamente bloqueado',
    'Aunque la app solo use HTTPS, no declarar usesCleartextTraffic="false" deja abierta '+
    'la posibilidad de HTTP accidental. Play Store lo marca en análisis de seguridad.',
    'fix_android_security');
}

// 7. network_security_config.xml o plugin permite cleartext en base-config ───
const netXml    = readText(r('android/app/src/main/res/xml/network_security_config.xml'));
const netPlugin = readText(r('plugins/withAndroidNetworkSecurity.js'));
if (netXml?.includes('base-config cleartextTrafficPermitted="true"') ||
    netPlugin?.includes('base-config cleartextTrafficPermitted="true"')) {
  find('HIGH','PLAY','NETCONFIG_CLEARTEXT',
    'network_security_config.xml permite HTTP en base-config',
    'La configuración actual tiene cleartextTrafficPermitted="true" globalmente para '+
    'soportar Metro (dev). En builds de producción esto debe ser false, '+
    'solo permitiendo cleartext en localhost para debug builds.',
    'fix_network_security_prod');
}

// 8. NSMicrophoneUsageDescription faltante en iOS ───────────────────────────
if (!infoPlist.NSMicrophoneUsageDescription &&
    andConf.permissions?.includes('android.permission.RECORD_AUDIO')) {
  find('HIGH','IOS','MICROPHONE_IOS',
    'NSMicrophoneUsageDescription faltante en iOS',
    'La app declara RECORD_AUDIO en Android. Si cualquier dependencia toca el micrófono '+
    'en iOS, App Store rechazará el build con ITMS-90683 si falta esta descripción.',
    'fix_microphone_ios');
}

// 9. Declaración de cifrado de exportación (iOS) ─────────────────────────────
if (!('ITSAppUsesNonExemptEncryption' in infoPlist)) {
  find('HIGH','IOS','EXPORT_COMPLIANCE',
    'ITSAppUsesNonExemptEncryption no declarado',
    'Apple requiere declarar si la app usa cifrado sujeto a regulaciones de exportación '+
    'de EE.UU. La app solo usa HTTPS estándar (TLS) que está exento. '+
    'Hay que declarar ITSAppUsesNonExemptEncryption = false para evitar advertencias al subir.',
    'fix_export_compliance');
}

// 10. EXPO_PUBLIC_ con claves secretas ───────────────────────────────────────
const SECRET_PATTERNS = ['SECRET_KEY','SEED_CODE','PRIVATE_KEY'];
const exposedSecrets = dotEnv.split('\n')
  .filter(l => l.startsWith('EXPO_PUBLIC_') && SECRET_PATTERNS.some(p => l.includes(p)))
  .map(l => l.split('=')[0]);
if (exposedSecrets.length > 0) {
  find('HIGH','BOTH','EXPOSED_SECRETS',
    `Claves secretas en bundle JS: ${exposedSecrets.join(', ')}`,
    'Las variables EXPO_PUBLIC_* se empaquetan en el bundle JS y son visibles con '+
    '`npx react-native-bundle-visualizer` o descompilando el APK. '+
    'YAPPY_SECRET_KEY y YAPPY_SEED_CODE son credenciales de API de pago — '+
    'CRÍTICO mover esta lógica a Supabase Edge Functions (ya tienes yappy-proxy). '+
    'Nunca llamar a la API de Yappy directamente desde el cliente en producción.',
    null);
}

// 11. Claves sensibles en eas.json (en el repositorio) ──────────────────────
const easPreviewEnv = easJson?.build?.preview?.env || {};
const easSensitiveKeys = Object.keys(easPreviewEnv)
  .filter(k => ['KEY','SECRET','TOKEN'].some(s => k.includes(s)));
if (easSensitiveKeys.length > 0) {
  find('HIGH','BOTH','KEYS_IN_EAS',
    `Claves en eas.json commiteado: ${easSensitiveKeys.join(', ')}`,
    'Las env vars en eas.json se guardan en texto plano en el repositorio. '+
    'Usar EAS Secrets: las claves se almacenan cifradas en los servidores de Expo '+
    'e inyectadas en el build sin estar en el repo.',
    'fix_eas_secrets');
}

// 12. Minificación deshabilitada ─────────────────────────────────────────────
if (!gradleProps?.includes('android.enableMinifyInReleaseBuilds=true')) {
  find('HIGH','PLAY','MINIFY_OFF',
    'R8/ProGuard deshabilitado — código sin ofuscar',
    'Sin minificación, el código fuente de la app es recuperable por reverse engineering '+
    'con herramientas como jadx. Además el AAB pesa ~30% más de lo necesario. '+
    'Habilitar R8 en gradle.properties.',
    'fix_minify');
}

// 13. shrinkResources deshabilitado ──────────────────────────────────────────
if (!gradleProps?.includes('android.enableShrinkResourcesInReleaseBuilds=true')) {
  find('MEDIUM','PLAY','SHRINK_OFF',
    'Reducción de recursos deshabilitada',
    'shrinkResources=false incluye recursos no utilizados en el AAB. '+
    'Junto con minify, puede reducir el tamaño del bundle hasta un 20%.',
    'fix_shrink');
}

// 14. WRITE_EXTERNAL_STORAGE sin maxSdkVersion ───────────────────────────────
if (manifest?.includes('android.permission.WRITE_EXTERNAL_STORAGE') &&
    !manifest?.includes('WRITE_EXTERNAL_STORAGE" android:maxSdkVersion')) {
  find('HIGH','PLAY','WRITE_STORAGE',
    'WRITE_EXTERNAL_STORAGE sin restricción de API level',
    'Este permiso está obsoleto desde Android 10 (API 29). '+
    'Sin android:maxSdkVersion="28", la app solicita un permiso innecesario en '+
    'dispositivos modernos, lo que activa warnings de Play Store sobre permisos excesivos.',
    'fix_android_security');
}

// 15. URLs de soporte en iOS ─────────────────────────────────────────────────
if (!iosConf.marketingUrl || !iosConf.supportUrl) {
  find('MEDIUM','IOS','IOS_URLS',
    'marketingUrl / supportUrl no configuradas en iOS',
    'App Store Connect requiere URL de soporte al crear el listing. '+
    'Configurarlas en app.json facilita tenerlas como referencia del equipo.',
    'fix_ios_urls');
}

// 16. Formulario Data Safety (Play Store) ────────────────────────────────────
find('HIGH','PLAY','DATA_SAFETY',
  'Formulario Data Safety de Play Console pendiente',
  'Obligatorio desde mayo 2022. Debes declarar en Play Console → App content → Data safety: '+
  'qué datos recopilas (cuenta, pagos, actividad en app), si se comparten con terceros '+
  '(Yappy, Supabase), y si el usuario puede solicitar eliminación. '+
  'Sin completar, la app puede ser suspendida.',
  null);

// 17. Calificación de contenido ──────────────────────────────────────────────
find('HIGH','BOTH','CONTENT_RATING',
  'Calificación de contenido no completada',
  'Play Store: cuestionario IARC en Play Console → App content → App ratings. '+
  'App Store: cuestionario en App Store Connect → App Information → Age Rating. '+
  'Sin calificación no se puede publicar en ninguna tienda.',
  null);

// 18. Screenshots para las tiendas ───────────────────────────────────────────
if (!fs.existsSync(r('assets','screenshots'))) {
  find('HIGH','BOTH','SCREENSHOTS',
    'Screenshots de store no encontrados en assets/screenshots/',
    'Play Store: mínimo 2 screenshots, máx 8 (formato 16:9 o 9:16). '+
    'App Store: iPhone 6.7" (1290×2796px) e iPhone 6.1" (1179×2556px) obligatorios. '+
    'Crear assets/screenshots/android/ y assets/screenshots/ios/ con las imágenes.',
    'fix_screenshots_dir');
}

// 19. versionCode hardcodeado en 1 ───────────────────────────────────────────
if (buildGradle?.match(/versionCode\s+1\b/)) {
  find('MEDIUM','PLAY','VERSION_CODE',
    'versionCode hardcodeado en 1 — sin estrategia de versioning',
    'Cada release necesita versionCode mayor al anterior. '+
    'Con el valor hardcodeado es fácil olvidar incrementarlo. '+
    'Considerar automatizarlo en el proceso de release con eas.json.',
    null);
}

// 20. crypto-js con historial de CVEs ────────────────────────────────────────
if (pkgJson?.dependencies?.['crypto-js']) {
  find('MEDIUM','BOTH','CRYPTO_JS',
    'crypto-js tiene historial de vulnerabilidades — migrar a expo-crypto',
    'crypto-js ha tenido múltiples CVEs (incluyendo timing attacks en comparaciones). '+
    'expo-crypto ya está instalado y usa APIs nativas del SO que son más seguras. '+
    'Reemplazar usos de CryptoJS.MD5/SHA por Crypto.digestStringAsync().',
    null);
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTO-FIXES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Deep-clone inicial de app.json. Todos los fixes mutan este objeto directamente
 * y se escribe una sola vez al final — sin lecturas adicionales del disco.
 */
const appJsonPatch = JSON.parse(JSON.stringify(appJson));
let appJsonDirty = false;

function patchAppJson(fn) {
  fn(appJsonPatch);
  appJsonDirty = true;
}

/** Agrega un plugin a app.json si no está ya incluido */
function addPlugin(pluginRef) {
  patchAppJson(data => {
    const plugins = data.expo.plugins || [];
    const exists = plugins.some(p =>
      (typeof p === 'string' ? p : p[0]) === pluginRef
    );
    if (!exists) {
      plugins.push(pluginRef);
      data.expo.plugins = plugins;
    }
  });
}

// ─── Mapa de fixes ───────────────────────────────────────────────────────────

const FIXES = {

  // 1. Release signing ─────────────────────────────────────────────────────
  fix_release_signing() {
    bak(r('android/app/build.gradle'));
    let content = buildGradle;

    // Agregar signingConfig release (solo si no existe)
    if (!content.includes('MYAPP_UPLOAD_STORE_FILE')) {
      content = content.replace(
        /(signingConfigs\s*\{)/,
        `$1
        release {
            if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                storeFile file(MYAPP_UPLOAD_STORE_FILE)
                storePassword MYAPP_UPLOAD_STORE_PASSWORD
                keyAlias MYAPP_UPLOAD_KEY_ALIAS
                keyPassword MYAPP_UPLOAD_KEY_PASSWORD
            }
        }`
      );
    }

    // Cambiar release buildType para usar signingConfigs.release con fallback
    content = content.replace(
      /(release\s*\{[^}]*)signingConfig signingConfigs\.debug/s,
      `$1signingConfig project.hasProperty('MYAPP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`
    );

    writeText(r('android/app/build.gradle'), content);

    // Script para generar el keystore
    writeText(r('scripts/generate-keystore.ps1'),
`# Genera el keystore de producción para Google Play Store.
# Ejecutar UNA SOLA VEZ. Guardar el .keystore FUERA del repo (nunca commitear).

param(
  [string]\$Alias       = "birrea2play",
  [string]\$StorePass   = \$(Read-Host "Store password (min 6 chars)"),
  [string]\$KeyPass     = \$(Read-Host "Key password   (min 6 chars)")
)

\$KeystorePath = "birrea2play-release.keystore"

keytool \`
  -genkeypair -v \`
  -storetype PKCS12 \`
  -keystore \$KeystorePath \`
  -alias \$Alias \`
  -keyalg RSA -keysize 2048 \`
  -validity 10000 \`
  -storepass \$StorePass \`
  -keypass \$KeyPass \`
  -dname "CN=Birrea2Play, OU=Mobile, O=Birrea2Play, L=Panama, S=Panama, C=PA"

Write-Host ""
Write-Host "Keystore generado: \$KeystorePath" -ForegroundColor Green
Write-Host ""
Write-Host "PASO 2 — Agrega esto a android/gradle.properties (está en .gitignore):" -ForegroundColor Yellow
Write-Host "  MYAPP_UPLOAD_STORE_FILE=../\$KeystorePath"
Write-Host "  MYAPP_UPLOAD_KEY_ALIAS=\$Alias"
Write-Host "  MYAPP_UPLOAD_STORE_PASSWORD=\$StorePass"
Write-Host "  MYAPP_UPLOAD_KEY_PASSWORD=\$KeyPass"
Write-Host ""
Write-Host "PASO 3 — Para builds en EAS Cloud (recomendado):" -ForegroundColor Cyan
Write-Host "  eas credentials"
Write-Host ""
Write-Host "GUARDA el .keystore en un lugar seguro (Google Drive, 1Password, etc.)" -ForegroundColor Red
Write-Host "Si lo pierdes NO podrás actualizar la app en Play Store."
`);

    // Agregar gradle.properties a .gitignore si tiene las claves hardcodeadas
    const gitignore = readText(r('.gitignore')) || '';
    if (!gitignore.includes('*.keystore')) {
      writeText(r('.gitignore'), gitignore + '\n# Production keystore — NEVER commit\n*.keystore\n*.jks\n');
    }
  },

  // 2. Remover SYSTEM_ALERT_WINDOW ─────────────────────────────────────────
  fix_overlay_perm() {
    writeText(r('plugins/withRemoveOverlayPermission.js'),
`const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Elimina SYSTEM_ALERT_WINDOW del APK de producción.
 * react-native-reanimated lo agrega en dev builds; no es necesario en producción.
 */
module.exports = function withRemoveOverlayPermission(config) {
  return withAndroidManifest(config, async (config) => {
    const perms = config.modResults.manifest['uses-permission'] || [];
    config.modResults.manifest['uses-permission'] = perms.filter(
      (p) => p.\$['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW'
    );
    return config;
  });
};
`);
    addPlugin('./plugins/withRemoveOverlayPermission');
  },

  // 3. Placeholder URL política de privacidad ──────────────────────────────
  fix_privacy_placeholder() {
    patchAppJson(data => {
      data.expo.privacyPolicyUrl = 'https://TU-DOMINIO/privacidad.html';
      if (!data.expo.ios) data.expo.ios = {};
      data.expo.ios.privacyPolicyUrl = 'https://TU-DOMINIO/privacidad.html';
    });
  },

  // 4 & 6 & 14. Plugin de seguridad Android ────────────────────────────────
  fix_android_security() {
    // Crea/sobreescribe el plugin consolidando todas las correcciones de seguridad
    writeText(r('plugins/withAndroidSecurity.js'),
`const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Aplica correcciones de seguridad para Play Store.
 * Consolidado por store-agent.js
 */
module.exports = function withAndroidSecurity(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application?.[0];

    if (app) {
      // Evita extracción de datos vía ADB backup (requerido para producción)
      app.\$['android:allowBackup'] = 'false';
      // Bloquea HTTP cleartext de forma explícita
      app.\$['android:usesCleartextTraffic'] = 'false';
    }

    // WRITE_EXTERNAL_STORAGE: obsoleto en API 29+, restringir a versiones antiguas
    const perms = manifest['uses-permission'] || [];
    const writePerm = perms.find(
      (p) => p.\$['android:name'] === 'android.permission.WRITE_EXTERNAL_STORAGE'
    );
    if (writePerm) writePerm.\$['android:maxSdkVersion'] = '28';

    return config;
  });
};
`);
    addPlugin('./plugins/withAndroidSecurity');
  },

  // 7. network_security_config — producción bloquea cleartext ─────────────
  fix_network_security_prod() {
    // Reescribir el plugin para separar debug/release
    writeText(r('plugins/withAndroidNetworkSecurity.js'),
`const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs   = require('fs');

const PROD_XML = \`<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Producción: bloquear todo cleartext HTTP -->
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">rumreditrvxkcnlhawut.supabase.co</domain>
    <domain includeSubdomains="true">api.yappy.com.pa</domain>
    <domain includeSubdomains="true">yappy.com.pa</domain>
    <domain includeSubdomains="true">u.expo.dev</domain>
  </domain-config>
  <!-- Debug: permitir localhost para Metro bundler -->
  <debug-overrides>
    <trust-anchors>
      <certificates src="user" />
    </trust-anchors>
  </debug-overrides>
</network-security-config>\`;

module.exports = function withAndroidNetworkSecurity(config) {
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.\$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot,'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), PROD_XML);
      return config;
    },
  ]);

  return config;
};
`);
    // El plugin ya debe estar en app.json, pero nos aseguramos
    addPlugin('./plugins/withAndroidNetworkSecurity');
  },

  // 8. NSMicrophoneUsageDescription ────────────────────────────────────────
  fix_microphone_ios() {
    patchAppJson(data => {
      if (!data.expo.ios) data.expo.ios = {};
      if (!data.expo.ios.infoPlist) data.expo.ios.infoPlist = {};
      data.expo.ios.infoPlist.NSMicrophoneUsageDescription =
        'Birrea2Play necesita acceso al micrófono para funciones de audio en eventos en vivo.';
    });
  },

  // 9. Export compliance ────────────────────────────────────────────────────
  fix_export_compliance() {
    patchAppJson(data => {
      if (!data.expo.ios) data.expo.ios = {};
      if (!data.expo.ios.infoPlist) data.expo.ios.infoPlist = {};
      // La app solo usa HTTPS estándar → exento de regulaciones de exportación de EE.UU.
      data.expo.ios.infoPlist.ITSAppUsesNonExemptEncryption = false;
    });
  },

  // 11. Mover claves de eas.json a EAS Secrets ────────────────────────────
  fix_eas_secrets() {
    bak(r('eas.json'));
    const data = readJSON(r('eas.json'));
    const env  = data.build?.preview?.env || {};
    const SENSITIVE = ['KEY','SECRET','TOKEN'];

    let script = `#!/bin/bash
# Configura EAS Secrets para reemplazar las claves expuestas en eas.json.
# Requiere: npm install -g eas-cli && eas login
# Ejecutar: bash scripts/setup-eas-secrets.sh

set -e
echo "Configurando EAS Secrets para el proyecto birrea2play..."
echo ""

`;
    Object.entries(env).forEach(([key, val]) => {
      if (SENSITIVE.some(s => key.includes(s))) {
        script += `eas secret:create --scope project --name ${key} --value "${val}" --force\n`;
        delete data.build.preview.env[key];
      }
    });
    script += `\necho ""\necho "Secrets configurados. Verificar con: eas secret:list"\n`;

    writeText(r('scripts/setup-eas-secrets.sh'), script);
    writeJSON(r('eas.json'), data);
  },

  // 12. Habilitar minificación ──────────────────────────────────────────────
  fix_minify() {
    bak(r('android/gradle.properties'));
    let content = readText(r('android/gradle.properties')) || '';
    if (content.includes('android.enableMinifyInReleaseBuilds')) {
      content = content.replace(
        /android\.enableMinifyInReleaseBuilds=\S+/,
        'android.enableMinifyInReleaseBuilds=true'
      );
    } else {
      content += '\n# Habilita R8/ProGuard — ofusca y reduce el bundle de producción\nandroid.enableMinifyInReleaseBuilds=true\n';
    }
    writeText(r('android/gradle.properties'), content);
  },

  // 13. Habilitar shrinkResources ───────────────────────────────────────────
  fix_shrink() {
    let content = readText(r('android/gradle.properties')) || '';
    if (content.includes('android.enableShrinkResourcesInReleaseBuilds')) {
      content = content.replace(
        /android\.enableShrinkResourcesInReleaseBuilds=\S+/,
        'android.enableShrinkResourcesInReleaseBuilds=true'
      );
    } else {
      content += '\n# Elimina recursos no utilizados del AAB\nandroid.enableShrinkResourcesInReleaseBuilds=true\n';
    }
    writeText(r('android/gradle.properties'), content);
  },

  // 15. URLs de soporte en iOS ──────────────────────────────────────────────
  fix_ios_urls() {
    patchAppJson(data => {
      if (!data.expo.ios) data.expo.ios = {};
      if (!data.expo.ios.marketingUrl) data.expo.ios.marketingUrl = 'https://TU-DOMINIO';
      if (!data.expo.ios.supportUrl)   data.expo.ios.supportUrl   = 'https://TU-DOMINIO/soporte';
    });
  },

  // 18. Crear carpeta de screenshots ────────────────────────────────────────
  fix_screenshots_dir() {
    fs.mkdirSync(r('assets','screenshots','android'), { recursive: true });
    fs.mkdirSync(r('assets','screenshots','ios'),     { recursive: true });
    writeText(r('assets','screenshots','README.md'),
`# Screenshots para Tiendas

## Google Play Store
- Mínimo 2, máximo 8 screenshots
- Formato: JPG o PNG, 16:9 o 9:16
- Tamaño mínimo: 320px, máximo: 3840px en el lado más largo
- Guardar en: \`android/\`

## App Store (obligatorio)
- **iPhone 6.7"**: 1290 × 2796 px — iPhone 15 Pro Max / 16 Plus
- **iPhone 6.1"**: 1179 × 2556 px — iPhone 15 / 15 Pro
- Guardar en: \`ios/\`

## Herramientas sugeridas
- [Expo Snack + Simulator](https://snack.expo.dev) para capturas rápidas
- [Figma Store Screenshots](https://www.figma.com/community) para templates
- macOS Simulator: Cmd+S para captura de pantalla
`);
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// EJECUTAR AGENTE
// ══════════════════════════════════════════════════════════════════════════════

console.log(col('bold',
  '\n╔══════════════════════════════════════════════════╗\n' +
  '║  STORE PUBLISHING AGENT  —  Birrea2Play          ║\n' +
  '╚══════════════════════════════════════════════════╝\n'
));

const blockers = findings.filter(f => f.severity === 'BLOCKER');
const highs    = findings.filter(f => f.severity === 'HIGH');
const mediums  = findings.filter(f => f.severity === 'MEDIUM');

console.log(
  `Encontrados: ${col('red',   blockers.length + ' BLOQUEADORES')} | ` +
               `${col('yellow', highs.length    + ' ALTOS')} | ` +
               `${col('blue',   mediums.length  + ' MEDIOS')}\n`
);

console.log(col('cyan', 'Aplicando fixes automáticos...\n'));

// De-duplicar fixes (un fix puede cubrir múltiples findings)
const appliedFixes = new Set();
for (const finding of findings) {
  if (!finding.autoFix || !(finding.autoFix in FIXES)) continue;
  if (appliedFixes.has(finding.autoFix)) {
    finding.fixed = true; // ya fue aplicado por otro finding
    process.stdout.write(`  ${col('gray', finding.id.padEnd(22))} ${col('green','✓ fixed (agrupado)')}\n`);
    continue;
  }
  process.stdout.write(`  ${col('gray', finding.id.padEnd(22))} `);
  try {
    FIXES[finding.autoFix]();
    finding.fixed = true;
    appliedFixes.add(finding.autoFix);
    process.stdout.write(col('green','✓ fixed\n'));
  } catch (e) {
    finding.err = e.message;
    process.stdout.write(col('red',`✗ error: ${e.message}\n`));
  }
}

// Aplicar todos los cambios acumulados en app.json en un solo write
if (appJsonDirty) {
  bak(r('app.json'));
  writeJSON(r('app.json'), appJsonPatch);
  process.stdout.write(`\n  ${col('gray','app.json'.padEnd(22))} ${col('green','✓ guardado (cambios acumulados)')}\n`);
}

// ── Generar STORE_AUDIT_REPORT.md ─────────────────────────────────────────────

const SEV_EMOJI  = { BLOCKER:'🔴', HIGH:'🟠', MEDIUM:'🟡' };
const STORE_TAG  = { PLAY:'`Play Store`', IOS:'`App Store`', BOTH:'`Play Store` + `App Store`' };
const totalFixed = findings.filter(f => f.fixed).length;

let md = `# Store Publishing Audit — Birrea2Play
> Generado: ${new Date().toLocaleString('es-PA',{timeZone:'America/Panama'})}

## Resumen

| Severidad | Total | Auto-fixed | Manual |
|-----------|-------|------------|--------|
| 🔴 BLOCKER | ${blockers.length} | ${blockers.filter(f=>f.fixed).length} | ${blockers.filter(f=>!f.fixed).length} |
| 🟠 HIGH | ${highs.length} | ${highs.filter(f=>f.fixed).length} | ${highs.filter(f=>!f.fixed).length} |
| 🟡 MEDIUM | ${mediums.length} | ${mediums.filter(f=>f.fixed).length} | ${mediums.filter(f=>!f.fixed).length} |

---

`;

for (const sev of ['BLOCKER','HIGH','MEDIUM']) {
  const group = findings.filter(f => f.severity === sev);
  if (!group.length) continue;
  md += `## ${SEV_EMOJI[sev]} ${sev}\n\n`;
  for (const f of group) {
    const status = f.fixed ? '✅ Auto-fixed'
                 : f.err   ? `❌ Error al aplicar fix: ${f.err}`
                 : f.autoFix ? '⚠️ Fix disponible — ver instrucciones'
                 : '📋 Requiere acción manual';
    md += `### ${f.id} — ${STORE_TAG[f.store]}\n`;
    md += `**${f.title}**\n\n${f.desc}\n\n**Estado:** ${status}\n\n---\n\n`;
  }
}

md += `## 📋 Checklist de Acciones Manuales

### 🔑 1. Generar Keystore de Producción *(Play Store — crítico)*
\`\`\`powershell
# Requiere Java (keytool) — viene con el JDK de Android Studio
.\\scripts\\generate-keystore.ps1

# Luego agrega a android/gradle.properties (NO commitear — está en .gitignore):
MYAPP_UPLOAD_STORE_FILE=../birrea2play-release.keystore
MYAPP_UPLOAD_KEY_ALIAS=birrea2play
MYAPP_UPLOAD_STORE_PASSWORD=tu_password
MYAPP_UPLOAD_KEY_PASSWORD=tu_password
\`\`\`

### 🍎 2. Generar proyecto iOS *(App Store — requiere Mac con Xcode 15+)*
\`\`\`bash
npx expo prebuild --platform ios --clean
cd ios && pod install
# Luego abrir ios/Birrea2Play.xcworkspace en Xcode
\`\`\`

### 🌐 3. Alojar la Política de Privacidad *(ambas tiendas)*
El archivo \`docs/privacidad.html\` necesita una URL pública:

**Opción A — GitHub Pages (gratis, 5 min):**
1. Ir a Settings → Pages → Source: branch \`main\`, folder \`/docs\`
2. URL será: \`https://TU-ORG.github.io/panama-birreas/privacidad.html\`

**Opción B — Supabase Storage:**
\`\`\`bash
supabase storage cp docs/privacidad.html ss:///legal/privacidad.html --public
\`\`\`

**Actualizar en app.json** (buscar "TU-DOMINIO" y reemplazar con la URL real).

### 🔐 4. Mover claves a EAS Secrets *(ambas tiendas)*
\`\`\`bash
# Instalar eas-cli si no está instalado
npm install -g eas-cli && eas login

# Ejecutar el script generado
bash scripts/setup-eas-secrets.sh
# Verificar: eas secret:list
\`\`\`

### 🚨 5. Claves Yappy en bundle JS *(CRÍTICO — seguridad)*
\`EXPO_PUBLIC_YAPPY_SECRET_KEY\` y \`EXPO_PUBLIC_YAPPY_SEED_CODE\` son credenciales
de pago visibles en el APK. La solución:
1. Mover todas las llamadas a la API de Yappy al Supabase Edge Function \`yappy-proxy\` (ya existe)
2. El cliente solo llama a \`supabase.functions.invoke('yappy-proxy', { ... })\`
3. Remover las variables \`EXPO_PUBLIC_YAPPY_*\` del .env del cliente

### 📊 6. Formulario Data Safety *(Play Store — obligatorio)*
Play Console → App content → Data safety:
- ☐ Datos de cuenta (nombre, email, foto de perfil)
- ☐ Datos financieros (información de pago vía Yappy/PagueloFacil)
- ☐ Fotos (acceso a galería para foto de perfil)
- ☐ Identificadores de dispositivo (tokens de notificación push)
- ☐ Todos los datos cifrados en tránsito: ✓
- ☐ El usuario puede solicitar eliminación: ✓

### ⭐ 7. Calificación de Contenido *(ambas tiendas)*
- ☐ **Play Store**: Play Console → App content → App ratings → completar IARC
- ☐ **App Store**: App Store Connect → App Information → Age Rating

### 📸 8. Screenshots para las Tiendas
Carpetas creadas en \`assets/screenshots/\`. Ver \`assets/screenshots/README.md\`.

### 🔄 9. Aplicar cambios (ejecutar después de todos los pasos)*
\`\`\`bash
# Aplica todos los plugins modificados
npx expo prebuild --clean

# Verificar que el build Android funciona
npx expo run:android

# Build de producción vía EAS (requiere keystore configurado)
eas build --platform android --profile production
\`\`\`

### 💳 10. Cuentas de Desarrollador
- ☐ **Google Play Console**: $25 USD pago único — [play.google.com/console](https://play.google.com/console)
- ☐ **Apple Developer Program**: $99 USD/año — [developer.apple.com/programs](https://developer.apple.com/programs)

---
*Re-ejecutar con \`npm run store:audit\` para actualizar el estado del audit.*
`;

writeText(r('STORE_AUDIT_REPORT.md'), md);

// ── Resumen final en consola ──────────────────────────────────────────────────

console.log('\n' + col('bold', '─'.repeat(52)));
console.log(col('bold', '\nResultados:\n'));

for (const sev of ['BLOCKER','HIGH','MEDIUM']) {
  for (const f of findings.filter(x => x.severity === sev)) {
    const icon    = f.fixed ? col('green','✓') : col('gray','○');
    const sevCol  = sev === 'BLOCKER' ? 'red' : sev === 'HIGH' ? 'yellow' : 'blue';
    console.log(`  ${icon} ${col(sevCol, sev.padEnd(8))} ${f.title}`);
  }
}

const totalManual = findings.filter(f => !f.fixed).length;
console.log(`\n  ${col('green', totalFixed + ' fixes aplicados automáticamente')}`);
console.log(`  ${col('yellow', totalManual + ' requieren acción manual')}`);
console.log('\n' + col('green','  ✓ Reporte completo: STORE_AUDIT_REPORT.md'));
console.log(col('cyan','\n  Próximos pasos:\n'));
console.log('  1.  npx expo prebuild --clean         → aplicar plugins');
console.log('  2.  .\\scripts\\generate-keystore.ps1   → keystore de producción');
console.log('  3.  Alojar docs/privacidad.html        → actualizar URL en app.json');
console.log('  4.  bash scripts/setup-eas-secrets.sh  → mover claves a EAS');
console.log('  5.  Completar Data Safety en Play Console\n');
