const { withAndroidManifest } = require('@expo/config-plugins');

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
      app.$['android:allowBackup'] = 'false';
      // No seteamos usesCleartextTraffic aquí — lo maneja network_security_config.xml
      // que permite localhost para Metro (dev) y bloquea todo lo demás (prod)
    }

    // WRITE_EXTERNAL_STORAGE: obsoleto en API 29+, restringir a versiones antiguas
    const perms = manifest['uses-permission'] || [];
    const writePerm = perms.find(
      (p) => p.$['android:name'] === 'android.permission.WRITE_EXTERNAL_STORAGE'
    );
    if (writePerm) writePerm.$['android:maxSdkVersion'] = '28';

    return config;
  });
};
