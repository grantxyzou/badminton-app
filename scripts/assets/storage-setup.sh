#!/usr/bin/env bash
# One-time: the storage account that serves the generated racket and string
# pictures (docs/plans/asset-storage.md).
#
#   az login
#   scripts/assets/storage-setup.sh [account-name]
#
# Creates a Standard_LRS account in the app's resource group and region, a
# `public` container whose blobs anyone can read (they are pictures the app
# already serves to anyone), and a CORS rule letting the app's own origins
# fetch them, which the share card needs to export a racket picture.
# Prints the NEXT_PUBLIC_ASSET_BASE to build with. Safe to re-run.
set -euo pipefail

ACCOUNT="${1:-bpmgrantzouassets}"   # 3–24 lowercase letters and digits, unique across Azure
RG="${RG:-grantzou}"
LOCATION="${LOCATION:-canadacentral}"
CONTAINER=public

if ! az account show --output none 2>/dev/null; then
  echo "Run 'az login' first." >&2
  exit 1
fi

if ! az storage account show --name "$ACCOUNT" --resource-group "$RG" --output none 2>/dev/null; then
  if [ "$(az storage account check-name --name "$ACCOUNT" --query nameAvailable -o tsv)" != "true" ]; then
    echo "The name '$ACCOUNT' is taken across Azure. Pass another: $0 <name>" >&2
    exit 1
  fi
  az storage account create \
    --name "$ACCOUNT" --resource-group "$RG" --location "$LOCATION" \
    --sku Standard_LRS --kind StorageV2 --https-only true --min-tls-version TLS1_2 \
    --allow-blob-public-access true --output none
fi

KEY="$(az storage account keys list --resource-group "$RG" --account-name "$ACCOUNT" --query '[0].value' -o tsv)"

az storage container create --name "$CONTAINER" --public-access blob \
  --account-name "$ACCOUNT" --account-key "$KEY" --output none

az storage cors clear --services b --account-name "$ACCOUNT" --account-key "$KEY"
az storage cors add --services b --methods GET HEAD \
  --origins https://bpm.grantzou.com https://vnext-badminton-app.azurewebsites.net http://localhost:3000 \
  --allowed-headers '*' --exposed-headers '*' --max-age 86400 \
  --account-name "$ACCOUNT" --account-key "$KEY"

echo
echo "Done. Build with:"
echo "  NEXT_PUBLIC_ASSET_BASE=https://$ACCOUNT.blob.core.windows.net/$CONTAINER"
