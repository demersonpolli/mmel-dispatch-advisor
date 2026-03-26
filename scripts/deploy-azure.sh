#!/usr/bin/env bash
# Full Azure deployment for MMEL Dispatch Advisor backend.
#
# What this script does:
#   - Ensures az login
#   - Creates/updates RG, storage accounts, Function App, Cosmos DB (SQL API db/container)
#   - Applies Cosmos composite index policy for optimal query performance
#   - Auto-configures Function App settings from Azure-derived values
#   - Configures CORS on the Function App (allow all origins)
#   - Writes backend/local.settings.json for local development
#   - Publishes backend code via zip deploy
#   - Triggers the ingest endpoint to load MMEL data into Cosmos + Blob
#   - Prints the Function App URL and function key
#
# Usage:
#   chmod +x scripts/deploy-azure.sh
#   ./scripts/deploy-azure.sh           # all defaults, no arguments needed
#
# All resource names have built-in defaults and can be overridden via env vars:
#   RESOURCE_GROUP                 (default: rg-mmel-dispatch-advisor)
#   FUNCTION_APP                   (default: mmel-dispatch-advisor)
#   RUNTIME_STORAGE_ACCOUNT        (default: mmeldispatchstor)
#   COSMOS_ACCOUNT_NAME            (default: mmel-dispatch-cosmos)
#   LOCATION                       (default: eastus)
#   SUBSCRIPTION_ID
#   DATA_STORAGE_ACCOUNT_NAME      (defaults to runtime storage account)
#   COSMOS_DATABASE_NAME           (default: mmel-dispatch)
#   COSMOS_CONTAINER_NAME          (default: mmel-items)
#   BLOB_CONTAINER_NAME            (default: mmel-page-images)
#   FOUNDRY_APPLICATION_BASE_URL   (set later if not available at deploy time)
#   FOUNDRY_API_VERSION            (default: 2025-11-15-preview)
#   FOUNDRY_TOKEN_SCOPE            (default: https://ai.azure.com/.default)
#   KEY_VAULT_NAME                 (default: mmel-dispatch-kv)
#   LOG_ANALYTICS_WORKSPACE        (default: mmel-dispatch-logs)
#   APP_INSIGHTS_NAME              (default: mmel-dispatch-insights)
#   SKIP_PUBLISH=1                 (infrastructure + settings only, no code deploy)
#   SKIP_INGEST=1                  (skip triggering the ingest endpoint after publish)

set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-mmel-dispatch-advisor}"
FUNCTION_APP="${FUNCTION_APP:-mmel-dispatch-advisor}"
RUNTIME_STORAGE_ACCOUNT="${RUNTIME_STORAGE_ACCOUNT:-mmeldispatchstor}"
COSMOS_ACCOUNT_NAME="${COSMOS_ACCOUNT_NAME:-mmel-dispatch-cosmos}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-mmel-dispatch-kv}"
LOG_ANALYTICS_WORKSPACE="${LOG_ANALYTICS_WORKSPACE:-mmel-dispatch-logs}"
APP_INSIGHTS_NAME="${APP_INSIGHTS_NAME:-mmel-dispatch-insights}"
LOCATION="${LOCATION:-westus2}"

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
DATA_STORAGE_ACCOUNT_NAME="${DATA_STORAGE_ACCOUNT_NAME:-$RUNTIME_STORAGE_ACCOUNT}"
COSMOS_DATABASE_NAME="${COSMOS_DATABASE_NAME:-mmel-dispatch}"
COSMOS_CONTAINER_NAME="${COSMOS_CONTAINER_NAME:-mmel-items}"
BLOB_CONTAINER_NAME="${BLOB_CONTAINER_NAME:-mmel-page-images}"
FOUNDRY_APPLICATION_BASE_URL="${FOUNDRY_APPLICATION_BASE_URL:-}"
FOUNDRY_API_VERSION="${FOUNDRY_API_VERSION:-2025-11-15-preview}"
FOUNDRY_TOKEN_SCOPE="${FOUNDRY_TOKEN_SCOPE:-https://ai.azure.com/.default}"
SKIP_PUBLISH="${SKIP_PUBLISH:-0}"
SKIP_INGEST="${SKIP_INGEST:-0}"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: Azure CLI (az) is not installed." >&2
  echo "       Install from https://learn.microsoft.com/cli/azure/install-azure-cli" >&2
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

SUB_ID="$(az account show --query id -o tsv)"
if [[ -z "$SUB_ID" ]]; then echo "ERROR: Failed to retrieve subscription ID." >&2; exit 1; fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

# ---------------------------------------------------------------------------
# Resource group
# ---------------------------------------------------------------------------

echo "==> Ensuring resource group: $RESOURCE_GROUP ($LOCATION)"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

# ---------------------------------------------------------------------------
# Storage accounts
# ---------------------------------------------------------------------------

ensure_storage_account() {
  local acct="$1"
  if ! az storage account show --name "$acct" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "  Creating storage account: $acct"
    az storage account create \
      --name "$acct" \
      --location "$LOCATION" \
      --resource-group "$RESOURCE_GROUP" \
      --sku Standard_LRS >/dev/null
  else
    echo "  Storage account already exists: $acct"
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

# ---------------------------------------------------------------------------
# Cosmos DB
# ---------------------------------------------------------------------------

echo "==> Ensuring Cosmos DB account: $COSMOS_ACCOUNT_NAME"
if ! az cosmosdb show --name "$COSMOS_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "  Creating Cosmos DB account (this can take 2-3 minutes)..."
  az cosmosdb create \
    --name "$COSMOS_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --locations regionName="$LOCATION" failoverPriority=0 isZoneRedundant=False \
    --default-consistency-level Session >/dev/null
else
  echo "  Cosmos DB account already exists: $COSMOS_ACCOUNT_NAME"
fi

echo "==> Ensuring Cosmos SQL database: $COSMOS_DATABASE_NAME"
az cosmosdb sql database create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --name "$COSMOS_DATABASE_NAME" >/dev/null 2>&1 || true

echo "==> Ensuring Cosmos SQL container: $COSMOS_CONTAINER_NAME"
az cosmosdb sql container create \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$COSMOS_DATABASE_NAME" \
  --name "$COSMOS_CONTAINER_NAME" \
  --partition-key-path "/aircraftNorm" >/dev/null 2>&1 || true

# Apply composite index policy for efficient CONTAINS() and sequence lookups
INDEX_POLICY_FILE="$(mktemp)"
cat > "$INDEX_POLICY_FILE" <<'EOF'
{
  "indexingMode": "consistent",
  "automatic": true,
  "includedPaths": [{"path": "/*"}],
  "excludedPaths": [{"path": "/\"_etag\"/?"}],
  "compositeIndexes": [
    [
      {"path": "/aircraftNorm", "order": "ascending"},
      {"path": "/sequenceNorm", "order": "ascending"}
    ],
    [
      {"path": "/aircraftNorm", "order": "ascending"},
      {"path": "/itemNorm",     "order": "ascending"}
    ]
  ]
}
EOF

echo "==> Applying Cosmos container indexing policy"
az cosmosdb sql container update \
  --account-name "$COSMOS_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --database-name "$COSMOS_DATABASE_NAME" \
  --name "$COSMOS_CONTAINER_NAME" \
  --idx "@$INDEX_POLICY_FILE" >/dev/null
rm -f "$INDEX_POLICY_FILE"

# ---------------------------------------------------------------------------
# Function App
# ---------------------------------------------------------------------------

echo "==> Ensuring Function App: $FUNCTION_APP"
if ! az functionapp show --name "$FUNCTION_APP" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "  Creating Function App..."
  az functionapp create \
    --name "$FUNCTION_APP" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-account "$RUNTIME_STORAGE_ACCOUNT" \
    --consumption-plan-location "$LOCATION" \
    --runtime dotnet-isolated \
    --runtime-version 8 \
    --functions-version 4 \
    --os-type Linux >/dev/null
else
  echo "  Function App already exists: $FUNCTION_APP"
fi

echo "==> Enabling system-assigned managed identity"
az functionapp identity assign -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" >/dev/null

echo "==> Assigning Storage Blob Delegator role to Function App identity"
PRINCIPAL_ID="$(az functionapp identity show -g "$RESOURCE_GROUP" -n "$FUNCTION_APP" --query principalId -o tsv)"
STORAGE_ID="$(az storage account show --name "$DATA_STORAGE_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Delegator" \
  --scope "$STORAGE_ID" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# Application Insights
# ---------------------------------------------------------------------------

echo "==> Ensuring Log Analytics workspace: $LOG_ANALYTICS_WORKSPACE"
if ! az monitor log-analytics workspace show --workspace-name "$LOG_ANALYTICS_WORKSPACE" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "  Creating Log Analytics workspace..."
  az monitor log-analytics workspace create \
    --workspace-name "$LOG_ANALYTICS_WORKSPACE" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" >/dev/null
else
  echo "  Log Analytics workspace already exists: $LOG_ANALYTICS_WORKSPACE"
fi
WORKSPACE_ID="$(az monitor log-analytics workspace show \
  --workspace-name "$LOG_ANALYTICS_WORKSPACE" \
  --resource-group "$RESOURCE_GROUP" \
  --query id -o tsv)"

echo "==> Ensuring Application Insights: $APP_INSIGHTS_NAME"
if ! az monitor app-insights component show --app "$APP_INSIGHTS_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "  Creating Application Insights..."
  az monitor app-insights component create \
    --app "$APP_INSIGHTS_NAME" \
    --location "$LOCATION" \
    --resource-group "$RESOURCE_GROUP" \
    --kind web \
    --application-type web \
    --workspace "$WORKSPACE_ID" >/dev/null
else
  echo "  Application Insights already exists: $APP_INSIGHTS_NAME"
fi
APP_INSIGHTS_CONN_STR="$(az monitor app-insights component show \
  --app "$APP_INSIGHTS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)"

# ---------------------------------------------------------------------------
# Resolve connection strings from Azure
# ---------------------------------------------------------------------------

echo "==> Resolving connection strings"

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

# ---------------------------------------------------------------------------
# Key Vault — provision, assign roles, store secrets
# ---------------------------------------------------------------------------

set_kv_secret_with_retry() {
  # Write via ARM management plane (management.azure.com) so vault.azure.net DNS is not required.
  # Requires Key Vault Contributor on the vault resource (assigned below).
  local vault="$1" name="$2" value="$3"
  local uri="https://management.azure.com/subscriptions/${SUB_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.KeyVault/vaults/${vault}/secrets/${name}?api-version=2022-07-01"
  local tmp_body; tmp_body="$(mktemp)"
  printf '{"properties":{"value":"%s"}}' "$value" > "$tmp_body"

  local max=5 delay=20 i
  for ((i=1; i<=max; i++)); do
    if az rest --method PUT --uri "$uri" --body "@${tmp_body}" >/dev/null; then
      rm -f "$tmp_body"
      return 0
    fi
    if (( i < max )); then
      echo "  Secret write failed (attempt $i/$max), retrying in ${delay}s..."
      sleep "$delay"
      delay=$(( delay * 2 > 60 ? 60 : delay * 2 ))
    fi
  done
  rm -f "$tmp_body"
  echo "ERROR: Failed to store secret '$name' in Key Vault '$vault' after $max attempts." >&2
  exit 1
}

echo "==> Ensuring Key Vault: $KEY_VAULT_NAME"
if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  # Check whether the vault is soft-deleted (name reserved for 90 days after deletion)
  SOFT_DELETED="$(az keyvault list-deleted --resource-type vault --query "[?name=='$KEY_VAULT_NAME'].name" -o tsv 2>/dev/null || true)"
  if [[ -n "$SOFT_DELETED" ]]; then
    echo "  Soft-deleted vault '$KEY_VAULT_NAME' found — recovering..."
    az keyvault recover --name "$KEY_VAULT_NAME"
    echo "  Waiting 15s for recovered vault to become available..."
    sleep 15
  else
    echo "  Creating Key Vault..."
    az keyvault create \
      --name "$KEY_VAULT_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --enable-rbac-authorization true
    if [[ $? -ne 0 ]]; then echo "ERROR: Failed to create Key Vault '$KEY_VAULT_NAME'." >&2; exit 1; fi
  fi
else
  echo "  Key Vault already exists: $KEY_VAULT_NAME"
fi

KV_ID="$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv 2>&1)"
if [[ -z "$KV_ID" ]]; then
  echo "ERROR: Key Vault '$KEY_VAULT_NAME' is not reachable after create/recover." >&2; exit 1
fi

# Grant the Function App managed identity read access to secrets at runtime
echo "==> Assigning Key Vault Secrets User to Function App identity"
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID" >/dev/null 2>&1 || true

# Grant the current deploying identity write access so the script can store secrets
echo "==> Assigning Key Vault Secrets Officer to current identity"
CURRENT_OBJECT_ID="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)"
if [[ -z "$CURRENT_OBJECT_ID" ]]; then
  SP_NAME="$(az account show --query user.name -o tsv 2>/dev/null || true)"
  if [[ -n "$SP_NAME" ]]; then
    CURRENT_OBJECT_ID="$(az ad sp show --id "$SP_NAME" --query id -o tsv 2>/dev/null || true)"
  fi
fi
if [[ -n "$CURRENT_OBJECT_ID" ]]; then
  az role assignment create \
    --assignee "$CURRENT_OBJECT_ID" \
    --role "Key Vault Contributor" \
    --scope "$KV_ID" >/dev/null 2>&1 || true
  echo "  Waiting 30s for RBAC propagation before writing secrets..."
  sleep 30
else
  echo "  WARNING: Could not determine current identity. If secret writes fail, manually assign 'Key Vault Contributor' on $KEY_VAULT_NAME."
fi

echo "==> Storing connection strings in Key Vault"
set_kv_secret_with_retry "$KEY_VAULT_NAME" "cosmos-connection-string" "$COSMOS_CONN"
set_kv_secret_with_retry "$KEY_VAULT_NAME" "blob-connection-string"   "$BLOB_CONN"

KV_BASE_URI="https://${KEY_VAULT_NAME}.vault.azure.net/secrets"
COSMOS_CONN_REF="@Microsoft.KeyVault(SecretUri=${KV_BASE_URI}/cosmos-connection-string/)"
BLOB_CONN_REF="@Microsoft.KeyVault(SecretUri=${KV_BASE_URI}/blob-connection-string/)"

# ---------------------------------------------------------------------------
# Function App settings
# ---------------------------------------------------------------------------

SETTINGS=(
  "AzureWebJobsStorage=$RUNTIME_CONN"
  "FUNCTIONS_WORKER_RUNTIME=dotnet-isolated"
  "APPLICATIONINSIGHTS_CONNECTION_STRING=$APP_INSIGHTS_CONN_STR"
  "Cosmos__ConnectionString=$COSMOS_CONN_REF"
  "Cosmos__DatabaseName=$COSMOS_DATABASE_NAME"
  "Cosmos__ContainerName=$COSMOS_CONTAINER_NAME"
  "Blob__ConnectionString=$BLOB_CONN_REF"
  "Blob__ContainerName=$BLOB_CONTAINER_NAME"
  "Blob__PublicBlobBaseUrl=$BLOB_BASE_URL"
  "Blob__SasExpiryMinutes=60"
  "Rag__MarkdownPath=mmel_rag.md"
  "Rag__TopChunkCount=8"
  "Ingestion__SourceDirectory="
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

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

echo "==> Configuring CORS (allow all origins)"
az functionapp cors add \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --allowed-origins "*" >/dev/null

# ---------------------------------------------------------------------------
# Write backend/local.settings.json for local development
# ---------------------------------------------------------------------------

LOCAL_SETTINGS_PATH="$BACKEND_DIR/local.settings.json"
echo "==> Writing $LOCAL_SETTINGS_PATH"
cat > "$LOCAL_SETTINGS_PATH" <<EOF
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "$RUNTIME_CONN",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "APPLICATIONINSIGHTS_CONNECTION_STRING": "$APP_INSIGHTS_CONN_STR",
    "Cosmos__ConnectionString": "$COSMOS_CONN",
    "Cosmos__DatabaseName": "$COSMOS_DATABASE_NAME",
    "Cosmos__ContainerName": "$COSMOS_CONTAINER_NAME",
    "Blob__ConnectionString": "$BLOB_CONN",
    "Blob__ContainerName": "$BLOB_CONTAINER_NAME",
    "Blob__PublicBlobBaseUrl": "$BLOB_BASE_URL",
    "Blob__SasExpiryMinutes": "60",
    "Rag__MarkdownPath": "../../../documents/mmel_rag.md",
    "Rag__TopChunkCount": "8",
    "Ingestion__SourceDirectory": "../../../documents/mmel",
    "Foundry__ApplicationBaseUrl": "$FOUNDRY_APPLICATION_BASE_URL",
    "Foundry__ApiVersion": "$FOUNDRY_API_VERSION",
    "Foundry__TokenScope": "$FOUNDRY_TOKEN_SCOPE"
  }
}
EOF

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

if [[ "$SKIP_PUBLISH" != "1" ]]; then
  echo "==> dotnet publish"
  dotnet publish "$BACKEND_DIR/backend.csproj" -c Release -o "$BACKEND_DIR/publish-deploy" --verbosity minimal

  ZIP_PATH="$BACKEND_DIR/deploy.zip"
  rm -f "$ZIP_PATH"
  (
    cd "$BACKEND_DIR/publish-deploy"
    zip -r "$ZIP_PATH" . >/dev/null
  )

  echo "==> Zip deploy to Function App"
  az functionapp deployment source config-zip \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --src "$ZIP_PATH" >/dev/null
  rm -f "$ZIP_PATH"
  rm -rf "$BACKEND_DIR/publish-deploy"

  # -------------------------------------------------------------------------
  # Retrieve function key and trigger ingest
  # -------------------------------------------------------------------------

  echo "==> Retrieving default function key"
  FUNCTION_KEY="$(az functionapp keys list \
    -g "$RESOURCE_GROUP" \
    -n "$FUNCTION_APP" \
    --query "functionKeys.default" -o tsv)"

  # Ingest is NOT triggered automatically. MMEL JSON files (with embedded base64
  # images, 2+ GB) are not bundled with the deploy package. Run ingest locally:
  #   cd backend && func start
  #   curl -X POST http://localhost:7071/api/ingest
  # Data is stored in Cosmos + Blob and used by the deployed Function App.
  if [[ "$SKIP_INGEST" == "1" ]]; then
    echo "==> SKIP_INGEST=1 set."
  fi
  echo "==> To populate data: run 'func start' locally and POST http://localhost:7071/api/ingest"
else
  echo "==> SKIP_PUBLISH=1 - infrastructure and settings configured. Run without SKIP_PUBLISH=1 to deploy code."
  FUNCTION_KEY="$(az functionapp keys list \
    -g "$RESOURCE_GROUP" \
    -n "$FUNCTION_APP" \
    --query "functionKeys.default" -o tsv 2>/dev/null || echo "")"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "========================================================"
echo "  Deploy finished."
echo "  App URL    : https://${FUNCTION_APP}.azurewebsites.net"
if [[ -n "${FUNCTION_KEY:-}" ]]; then
  echo "  Function key: $FUNCTION_KEY"
  echo ""
  echo "  Endpoints:"
  echo "    GET  https://${FUNCTION_APP}.azurewebsites.net/api/health"
  echo "    GET  https://${FUNCTION_APP}.azurewebsites.net/api/search?code=<key>&aircraft=...&q=..."
  echo "    POST https://${FUNCTION_APP}.azurewebsites.net/api/ingest?code=<key>"
  echo "    POST https://${FUNCTION_APP}.azurewebsites.net/api/advise?code=<key>"
fi
echo "  Cosmos     : $COSMOS_ACCOUNT_NAME / $COSMOS_DATABASE_NAME / $COSMOS_CONTAINER_NAME"
echo "  Blob       : $DATA_STORAGE_ACCOUNT_NAME / $BLOB_CONTAINER_NAME"
echo "  Key Vault  : $KEY_VAULT_NAME (secrets: cosmos-connection-string, blob-connection-string)"
echo "  App Insights: $APP_INSIGHTS_NAME (workspace: $LOG_ANALYTICS_WORKSPACE)"
echo "  local.settings.json written to: $LOCAL_SETTINGS_PATH"
if [[ -z "$FOUNDRY_APPLICATION_BASE_URL" ]]; then
  echo ""
  echo "  NOTE: FOUNDRY_APPLICATION_BASE_URL was not provided."
  echo "  The /api/advise endpoint will fall back to heuristic extraction until set."
  echo "  Set it with:"
  echo "    az functionapp config appsettings set -g $RESOURCE_GROUP -n $FUNCTION_APP \\"
  echo "      --settings Foundry__ApplicationBaseUrl=<url>"
fi
echo "========================================================"
