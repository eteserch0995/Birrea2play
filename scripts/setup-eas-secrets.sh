#!/bin/bash
# Configura EAS Secrets para reemplazar las claves expuestas en eas.json.
# Requiere: npm install -g eas-cli && eas login
# Ejecutar: bash scripts/setup-eas-secrets.sh

set -e
echo "Configurando EAS Secrets para el proyecto birrea2play..."
echo ""

eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "sb_publishable_U56Yg1Y7h0zDcrpwH8AlTQ_H7ir7oBK" --force

echo ""
echo "Secrets configurados. Verificar con: eas secret:list"
