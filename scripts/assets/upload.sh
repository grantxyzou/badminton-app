#!/usr/bin/env bash
# Upload the generated pictures to the storage container
# (docs/plans/asset-storage.md). Run after storage-setup.sh, and again after
# every scripts/render-racket-images.mjs or render-string-images.mjs run.
#
#   az login
#   scripts/assets/upload.sh [account-name]
#
# Blobs get the Cache-Control the app sends for the same files
# (next.config.js: a day, a week stale), and an explicit image/webp type.
# Overwrites what is there; deletes nothing.
set -euo pipefail

ACCOUNT="${1:-bpmgrantzouassets}"
RG="${RG:-grantzou}"
CONTAINER=public
CACHE='public, max-age=86400, stale-while-revalidate=604800'

cd "$(dirname "$0")/../.."
KEY="$(az storage account keys list --resource-group "$RG" --account-name "$ACCOUNT" --query '[0].value' -o tsv)"

for DIR in rackets strings; do
  az storage blob upload-batch \
    --account-name "$ACCOUNT" --account-key "$KEY" \
    --destination "$CONTAINER" --destination-path "$DIR" --source "public/$DIR" \
    --pattern '*.webp' --content-type image/webp --content-cache-control "$CACHE" \
    --overwrite true --output none
  LOCAL="$(find "public/$DIR" -name '*.webp' | wc -l | tr -d ' ')"
  REMOTE="$(az storage blob list --account-name "$ACCOUNT" --account-key "$KEY" --container-name "$CONTAINER" \
    --prefix "$DIR/" --num-results '*' --query 'length(@)' -o tsv)"
  echo "$DIR: $LOCAL here, $REMOTE in the container"
done

echo "Check one: https://$ACCOUNT.blob.core.windows.net/$CONTAINER/rackets/_default.webp"
