const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Elimina SYSTEM_ALERT_WINDOW del APK de producción.
 * react-native-reanimated lo agrega en dev builds; no es necesario en producción.
 */
module.exports = function withRemoveOverlayPermission(config) {
  return withAndroidManifest(config, async (config) => {
    const perms = config.modResults.manifest['uses-permission'] || [];
    config.modResults.manifest['uses-permission'] = perms.filter(
      (p) => p.$['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW'
    );
    return config;
  });
};
