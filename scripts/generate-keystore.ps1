# Genera el keystore de producción para Google Play Store.
# Ejecutar UNA SOLA VEZ. Guardar el .keystore FUERA del repo (nunca commitear).

param(
  [string]$Alias       = "birrea2play",
  [string]$StorePass   = $(Read-Host "Store password (min 6 chars)"),
  [string]$KeyPass     = $(Read-Host "Key password   (min 6 chars)")
)

$KeystorePath = "birrea2play-release.keystore"

keytool `
  -genkeypair -v `
  -storetype PKCS12 `
  -keystore $KeystorePath `
  -alias $Alias `
  -keyalg RSA -keysize 2048 `
  -validity 10000 `
  -storepass $StorePass `
  -keypass $KeyPass `
  -dname "CN=Birrea2Play, OU=Mobile, O=Birrea2Play, L=Panama, S=Panama, C=PA"

Write-Host ""
Write-Host "Keystore generado: $KeystorePath" -ForegroundColor Green
Write-Host ""
Write-Host "PASO 2 — Agrega esto a android/gradle.properties (está en .gitignore):" -ForegroundColor Yellow
Write-Host "  MYAPP_UPLOAD_STORE_FILE=../$KeystorePath"
Write-Host "  MYAPP_UPLOAD_KEY_ALIAS=$Alias"
Write-Host "  MYAPP_UPLOAD_STORE_PASSWORD=$StorePass"
Write-Host "  MYAPP_UPLOAD_KEY_PASSWORD=$KeyPass"
Write-Host ""
Write-Host "PASO 3 — Para builds en EAS Cloud (recomendado):" -ForegroundColor Cyan
Write-Host "  eas credentials"
Write-Host ""
Write-Host "GUARDA el .keystore en un lugar seguro (Google Drive, 1Password, etc.)" -ForegroundColor Red
Write-Host "Si lo pierdes NO podrás actualizar la app en Play Store."
