#!/usr/bin/env bash
# Deploy MMEL Dispatch Advisor backend: RG + Storage + Linux Consumption Function App + zip deploy.
# Does NOT create Cosmos, Foundry, or MMEL blob storage — set app settings after deploy.
#
# Usage:
#   chmod +x scripts/deploy-azure.sh
#   ./scripts/deploy-azure.sh <resource-group> <function-app-name> <storage-account-name> [location]
#
# Example:
#   ./scripts/deploy-azure.sh rg-mmel-advisor mmel-advisor-func-abc mmeladvstoreabc eastus

set -euo pipefail

RESOURCE_GROUP="${1:?resource group required}"
FUNCTION_APP="${2:?function app name required}"
STORAGE_ACCOUNT="${3:?storage account name required}"
LOCATION="${4:-eastus}"
SKIP_PUBLISH="${SKIP_PUBLISH:-0}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is not installed." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

echo "==> Ensuring resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

echo "==> Ensuring storage account: $STORAGE_ACCOUNT"
if ! az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --location "$LOCATION" \
    --resource-group "$RESOURCE_GROUP" \
    --sku Standard_LRS >/dev/null
fi

echo "==> Ensuring Function App: $FUNCTION_APP"
if ! az functionapp show --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az functionapp create \
    --name "$FUNCTION_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-account "$STORAGE_ACCOUNT" \
    --consumption-plan-location "$LOCATION" \
    --runtime dotnet-isolated \
    --runtime-version 8 \
    --functions-version 4 \
    --os-type Linux >/dev/null
fi

echo "==> Enabling system-assigned managed identity"
az functionapp identity assign -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" >/dev/null

if [[ "$SKIP_PUBLISH" == "1" ]]; then
  echo "SKIP_PUBLISH=1 — skipping code upload."
  echo "Function URL: https://${FUNCTION_APP}.azurewebsites.net"
  exit 0
fi

echo "==> dotnet publish"
dotnet publish "$BACKEND_DIR/backend.csproj" -c Release -o "$BACKEND_DIR/publish-deploy" --verbosity minimal

ZIP_PATH="$BACKEND_DIR/deploy.zip"
rm -f "$ZIP_PATH"
(
  cd "$BACKEND_DIR/publish-deploy"
  zip -r "$ZIP_PATH" . >/dev/null
)

echo "==> Zip deploy"
az functionapp deployment source config-zip \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --src "$ZIP_PATH"

rm -f "$ZIP_PATH"

echo ""
echo "Deploy finished."
echo "  App:  https://${FUNCTION_APP}.azurewebsites.net"
echo "  Keys: az functionapp keys list -g $RESOURCE_GROUP -n $FUNCTION_APP"
echo ""
echo "Next: set Application settings — see backend/README.md"
