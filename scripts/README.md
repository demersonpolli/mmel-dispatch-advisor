# Deployment scripts

| Script | Purpose |
|--------|---------|
| [`deploy-azure.ps1`](deploy-azure.ps1) | Create/update RG, storage, Linux Consumption Function App, zip-deploy backend (Windows). |
| [`deploy-azure.sh`](deploy-azure.sh) | Same as above (Bash). |
| [`remove-azure-resources.ps1`](remove-azure-resources.ps1) | Delete the **whole resource group** (Windows). |
| [`remove-azure-resources.sh`](remove-azure-resources.sh) | Delete the **whole resource group** (Bash). |

**Requirements:** Azure CLI (`az`), logged-in subscription; for deploy, .NET 8 SDK.

**After deploy:** configure Function App **Application settings** (Cosmos, Blob, Foundry, `Rag__*`, `Ingestion__*`) — see [backend/README.md](../backend/README.md).
