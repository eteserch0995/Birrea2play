const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <!-- Yappy API: trust system CAs, enforce HTTPS -->
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">yappy.com.pa</domain>
    <domain includeSubdomains="true">api.yappy.com.pa</domain>
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </domain-config>
  <!-- Supabase -->
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">supabase.co</domain>
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </domain-config>
  <!-- Base: allow cleartext for Metro dev bundler, trust user CAs -->
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system"/>
      <certificates src="user"/>
    </trust-anchors>
  </base-config>
</network-security-config>`;

function withAndroidNetworkSecurity(config) {
  // 1. Inject networkSecurityConfig attribute into AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });

  // 2. Write the XML file into the Android res/xml directory
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), XML);
      return config;
    },
  ]);

  return config;
}

module.exports = withAndroidNetworkSecurity;
