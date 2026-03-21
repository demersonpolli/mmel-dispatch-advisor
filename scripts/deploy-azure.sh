#!/usr/bin/env bash
# Full Azure deployment for MMEL Dispatch Advisor backend.
# - Ensures az login
# - Creates/updates RG, storage, Function App, Cosmos DB (SQL API db/container)
# - Auto-configures Function App app settings from Azure-derived values
# - Optionally publishes backend code
#
# Usage:
#   chmod +x scripts/deploy-azure.sh
#   ./scripts/deploy-azure.sh \
#     <resource-group> <function-app-name> <runtime-storage-account> <cosmos-account-name> [location]
#
# Optional env vars:
#   SUBSCRIPTION_ID
#   DATA_STORAGE_ACCOUNT_NAME      (defaults to runtime storage)
#   COSMOS_DATABASE_NAME           (default: mmel-dispatch)
#   COSMOS_CONTAINER_NAME          (default: mmel-items)
#   BLOB_CONTAINER_NAME            (default: mmel-page-images)
#   FOUNDRY_APPLICATION_BASE_URL
#   FOUNDRY_API_VERSION            (default: 2025-11-15-preview)
#   FOUNDRY_TOKEN_SCOPE            (default: https://ai.azure.com/.default)
#   SKIP_PUBLISH=1

set -euo pipefail

RESOURCE_GROUP="${1:?resource group required}"
FUNCTION_APP="${2:?function app name required}"
RUNTIME_STORAGE_ACCOUNT="${3:?runtime storage account required}"
COSMOS_ACCOUNT_NAME="${4:?cosmos account name required}"
LOCATION="${5:-eastus}"

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
DATA_STORAGE_ACCOUNT_NAME="${DATA_STORAGE_ACCOUNT_NAME:-$RUNTIME_STORAGE_ACCOUNT}"
COSMOS_DATABASE_NAME="${COSMOS_DATABASE_NAME:-mmel-dispatch}"
COSMOS_CONTAINER_NAME="${COSMOS_CONTAINER_NAME:-mmel-items}"
BLOB_CONTAINER_NAME="${BLOB_CONTAINER_NAME:-mmel-page-images}"
FOUNDRY_APPLICATION_BASE_URL="${FOUNDRY_APPLICATION_BASE_URL:-}"
FOUNDRY_API_VERSION="${FOUNDRY_API_VERSION:-2025-11-15-preview}"
FOUNDRY_TOKEN_SCOPE="${FOUNDRY_TOKEN_SCOPE:-https://ai.azure.com/.default}"
SKIP_PUBLISH="${SKIP_PUBLISH:-0}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is not installed." >&2
  exit 1
fi

if ! az account show >/dev/null 2>&1; then
  echo "==> Azure CLI not logged in. Starting az login..."
  az login >/dev/null
fi

if [[ -n "$SUBSCRIPTION_ID" ]]; then
  echo "==> Setting active subscription: $SUBSCRIPTION_ID"
  az account set --subscription "$SUBSCRIPTION_ID"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

echo "==> Ensuring resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

ensure_storage_account() {
  local acct="$1"
  if ! az storage account show --name "$acct" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    az storage account create \
      --name "$acct" \
      --location "$LOCATION" \
      --resource-group "$RESOURCE_GROUP" \
      --sku Standard_LRS >/dev/null
  fi
}

echo "==> Ensuring runtime storage account: $RUNTIME_STORAGE_ACCOUNT"
ensure_storage_account "$RUNTIME_STORAGE_ACCOUNT"

echo "==> Ensuring data storage account: $DATA_STORAGE_ACCOUNT_NAME"
ensure_storage_account "$DATA_STORAGE_ACCOUNT_NAME"

echo "==> Ensuring blob container: $BLOB_CONTAINER_NAME"
DATA_STORAGE_KEY="$(az storage account keys list \
  --resource-group "$RESOURCE_GROUP" \
  --account-name "$DATA_STORAGE_ACCOUNT_NAME" \
  --query "[0].value" -o tsv)"
az storage container create \
  --name "$BLOB_CONTAINER_NAME" \
  --account-name "$DATA_STORAGE_ACCOUNT_NAME" \
  --account-key "$DATA_STORAGE_KEY" >/dev/null

echo "==> Ensuring Cosmos DB account: $COSMOS_ACCOUNT_NAME"
if ! az cosmosdb show --name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az cosmosdb create \
    --name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --locations regionName="$LOCATION" failoverPriority=0 isZoneRedundant=False \
    --default-consistency-level Session >/dev/null
fi

echo "==> Ensuring Cosmos SQL database/container"
az cosmosdb sql database create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$COSMOS_DATABASE_NAME" >/dev/null

az cosmosdb sql container create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$COSMOS_DATABASE_NAME" \
  --name "$COSMOS_CONTAINER_NAME" \
  --partition-key-path "/aircraftNorm" >/dev/null

echo "==> Ensuring Function App: $FUNCTION_APP"
if ! az functionapp show --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az functionapp create \
    --name "$FUNCTION_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-account "$RUNTIME_STORAGE_ACCOUNT" \
    --consumption-plan-location "$LOCATION" \
    --runtime dotnet-isolated \
    --runtime-version 8 \
    --functions-version 4 \
    --os-type Linux >/dev/null
fi

echo "==> Enabling system-assigned managed identity"
az functionapp identity assign -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" >/dev/null

echo "==> Resolving Azure-derived app settings"
RUNTIME_CONN="$(az storage account show-connection-string \
  --resource-group "$RESOURCE_GROUP" \
  --name "$RUNTIME_STORAGE_ACCOUNT" \
  --query connectionString -o tsv)"

BLOB_CONN="$(az storage account show-connection-string \
  --resource-group "$RESOURCE_GROUP" \
  --name "$DATA_STORAGE_ACCOUNT_NAME" \
  --query connectionString -o tsv)"

COSMOS_CONN="$(az cosmosdb keys list \
  --name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --type connection-strings \
  --query "connectionStrings[0].connectionString" -o tsv)"

BLOB_BASE_URL="https://${DATA_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${BLOB_CONTAINER_NAME}"

SETTINGS=(
  "AzureWebJobsStorage=$RUNTIME_CONN"
  "FUNCTIONS_WORKER_RUNTIME=dotnet-isolated"
  "Cosmos__ConnectionString=$COSMOS_CONN"
  "Cosmos__DatabaseName=$COSMOS_DATABASE_NAME"
  "Cosmos__ContainerName=$COSMOS_CONTAINER_NAME"
  "Blob__ConnectionString=$BLOB_CONN"
  "Blob__ContainerName=$BLOB_CONTAINER_NAME"
  "Blob__PublicBlobBaseUrl=$BLOB_BASE_URL"
  "Blob__SasExpiryMinutes=60"
  "Foundry__ApiVersion=$FOUNDRY_API_VERSION"
  "Foundry__TokenScope=$FOUNDRY_TOKEN_SCOPE"
)
if [[ -n "$FOUNDRY_APPLICATION_BASE_URL" ]]; then
  SETTINGS+=("Foundry__ApplicationBaseUrl=$FOUNDRY_APPLICATION_BASE_URL")
fi

echo "==> Applying Function App configuration"
az functionapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --settings "${SETTINGS[@]}" >/dev/null

if [[ "$SKIP_PUBLISH" != "1" ]]; then
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
    --src "$ZIP_PATH" >/dev/null
  rm -f "$ZIP_PATH"
else
  echo "SKIP_PUBLISH=1 — infrastructure and app settings configured."
fi

echo ""
echo "Deploy finished."
echo "  App URL: https://${FUNCTION_APP}.azurewebsites.net"
echo "  Function keys: az functionapp keys list -g $RESOURCE_GROUP -n $FUNCTION_APP"
echo "  Cosmos account: $COSMOS_ACCOUNT_NAME"
echo "  Blob account/container: $DATA_STORAGE_ACCOUNT_NAME / $BLOB_CONTAINER_NAME"
