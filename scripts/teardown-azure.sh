#!/usr/bin/env bash
# Tears down all Azure resources created by deploy-azure.sh.
#
# Deletes the resource group (which removes the Function App, Cosmos DB, storage
# accounts, Log Analytics workspace, Application Insights, and Key Vault).
# Because Azure Key Vault has mandatory soft-delete (90-day retention), the vault
# is not permanently gone after RG deletion. Set PURGE_KEY_VAULT=1 to permanently
# purge it immediately.
#
# Usage:
#   chmod +x scripts/teardown-azure.sh
#   ./scripts/teardown-azure.sh                        # prompts for confirmation
#   FORCE=1 ./scripts/teardown-azure.sh               # skip confirmation
#   PURGE_KEY_VAULT=1 ./scripts/teardown-azure.sh     # also purge soft-deleted KV
#   REMOVE_LOCAL_SETTINGS=1 ./scripts/teardown-azure.sh  # also delete local.settings.json
#
# Overridable env vars (must match the values used at deploy time):
#   RESOURCE_GROUP    (default: rg-mmel-dispatch-advisor)
#   KEY_VAULT_NAME    (default: mmel-dispatch-kv)
#   SUBSCRIPTION_ID
#   FORCE=1
#   PURGE_KEY_VAULT=1
#   REMOVE_LOCAL_SETTINGS=1

set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-mmel-dispatch-advisor}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-mmel-dispatch-kv}"
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
FORCE="${FORCE:-0}"
PURGE_KEY_VAULT="${PURGE_KEY_VAULT:-0}"
REMOVE_LOCAL_SETTINGS="${REMOVE_LOCAL_SETTINGS:-0}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_SETTINGS_PATH="$REPO_ROOT/backend/local.settings.json"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

if ! command -v az >/dev/null 2>&1; then
  echo "ERROR: Azure CLI (az) is not installed." >&2
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

# Check the resource group exists before prompting.
if ! az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group '$RESOURCE_GROUP' does not exist. Nothing to tear down."
  exit 0
fi

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

echo ""
echo "========================================================"
echo "  This will PERMANENTLY DELETE the following:"
echo "    Resource group : $RESOURCE_GROUP"
echo "    (includes Function App, Cosmos DB, storage accounts,"
echo "     Log Analytics, Application Insights, Key Vault)"
if [[ "$PURGE_KEY_VAULT" == "1" ]]; then
  echo "    Key Vault purge: $KEY_VAULT_NAME (secrets permanently gone)"
fi
if [[ "$REMOVE_LOCAL_SETTINGS" == "1" ]]; then
  echo "    Local file     : $LOCAL_SETTINGS_PATH"
fi
echo "========================================================"
echo ""

if [[ "$FORCE" != "1" ]]; then
  read -r -p "Type 'yes' to confirm deletion: " answer
  if [[ "$answer" != "yes" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Delete resource group
# ---------------------------------------------------------------------------

echo "==> Deleting resource group: $RESOURCE_GROUP"
az group delete --name "$RESOURCE_GROUP" --yes
echo "  Resource group deleted."

# ---------------------------------------------------------------------------
# Purge soft-deleted Key Vault (optional)
# ---------------------------------------------------------------------------

if [[ "$PURGE_KEY_VAULT" == "1" ]]; then
  echo "==> Purging soft-deleted Key Vault: $KEY_VAULT_NAME"
  if az keyvault purge --name "$KEY_VAULT_NAME" >/dev/null 2>&1; then
    echo "  Key Vault purged."
  else
    echo "  WARNING: Could not purge Key Vault '$KEY_VAULT_NAME'. It may already be purged or not yet soft-deleted."
  fi
fi

# ---------------------------------------------------------------------------
# Remove local.settings.json (optional)
# ---------------------------------------------------------------------------

if [[ "$REMOVE_LOCAL_SETTINGS" == "1" ]]; then
  if [[ -f "$LOCAL_SETTINGS_PATH" ]]; then
    rm -f "$LOCAL_SETTINGS_PATH"
    echo "==> Deleted $LOCAL_SETTINGS_PATH"
  else
    echo "==> $LOCAL_SETTINGS_PATH not found, skipping."
  fi
fi

echo ""
echo "Teardown complete."
