#!/usr/bin/env bash
# Remove Azure resources: deletes the entire resource group created for the Function App deploy.
#
# WARNING: Deletes EVERY resource in that group. Use a dedicated RG for the Function App.
# If Cosmos or other shared services live in the same RG, do NOT use this script — remove resources individually in the portal.
#
# Usage:
#   ./scripts/remove-azure-resources.sh <resource-group> [--yes]
#
# Example:
#   ./scripts/remove-azure-resources.sh rg-mmel-advisor --yes

set -euo pipefail

RG="${1:?resource group name required}"
FORCE="0"
if [[ "${2:-}" == "--yes" ]] || [[ "${2:-}" == "-y" ]]; then
  FORCE="1"
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is not installed." >&2
  exit 1
fi

if [[ "$(az group exists --name "$RG")" != "true" ]]; then
  echo "Resource group '$RG' does not exist. Nothing to do."
  exit 0
fi

if [[ "$FORCE" != "1" ]]; then
  read -r -p "Delete resource group '$RG' and ALL resources inside it? [y/N] " ans
  if [[ ! "$ans" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "==> Deleting resource group: $RG (async)"
az group delete --name "$RG" --yes --no-wait
echo "Deletion submitted. Check: az group show -n $RG"
