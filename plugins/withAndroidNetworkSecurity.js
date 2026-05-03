const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs   = require('fs');

const PROD_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Bloquea todo cleartext HTTP por defecto -->
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <!-- Excepción: localhost y 10.0.2.2 para Metro bundler (dev builds) -->
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
  <!-- Dominios de producción — HTTPS forzado explícitamente -->
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">rumreditrvxkcnlhawut.supabase.co</domain>
    <domain includeSubdomains="true">api.yappy.com.pa</domain>
    <domain includeSubdomains="true">yappy.com.pa</domain>
    <domain includeSubdomains="true">u.expo.dev</domain>
  </domain-config>
  <!-- Debug: confiar también en CAs de usuario (certificados de desarrollo) -->
  <debug-overrides>
    <trust-anchors>
      <certificates src="user" />
    </trust-anchors>
  </debug-overrides>
</network-security-config>`;

module.exports = function withAndroidNetworkSecurity(config) {
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
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
