const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Configura signingConfigs.release en build.gradle usando variables de gradle.properties.
 * Las variables se leen de android/gradle.properties (NO commitear ese archivo si tiene contraseñas).
 * Para builds en la nube usar: eas credentials
 */
module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    // Evitar duplicar si ya fue aplicado
    if (gradle.includes('MYAPP_UPLOAD_STORE_FILE')) return config;

    // Agregar signingConfig release dentro de signingConfigs { ... }
    gradle = gradle.replace(
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

    // Hacer que release use signingConfigs.release (con fallback a debug para cuando no hay keystore)
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('MYAPP_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`
    );

    config.modResults.contents = gradle;
    return config;
  });
};
