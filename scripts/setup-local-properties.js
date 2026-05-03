#!/usr/bin/env node
// Regenera android/local.properties después de cada prebuild --clean.
// local.properties es ignorado por git pero Gradle lo necesita para encontrar el SDK.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const localPropsPath = path.join(__dirname, '..', 'android', 'local.properties');

// Buscar el SDK en las ubicaciones más comunes
const candidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),   // Windows
  path.join(os.homedir(), 'Library', 'Android', 'sdk'),             // macOS
  path.join(os.homedir(), 'Android', 'Sdk'),                        // Linux
].filter(Boolean);

const sdkPath = candidates.find(p => fs.existsSync(p));

if (!sdkPath) {
  console.warn('⚠️  No se encontró el Android SDK. Configura ANDROID_HOME o instala Android Studio.');
  process.exit(0);
}

// En Windows las rutas necesitan las barras escapadas
const escaped = sdkPath.replace(/\\/g, '\\\\');
fs.writeFileSync(localPropsPath, `sdk.dir=${escaped}\n`, 'utf8');
console.log(`✓ local.properties generado: sdk.dir=${sdkPath}`);
