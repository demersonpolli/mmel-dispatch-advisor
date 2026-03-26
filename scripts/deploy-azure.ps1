<#
.SYNOPSIS
  Full Azure deployment for MMEL Dispatch Advisor backend.

.DESCRIPTION
  - Ensures Azure login (runs az login when needed)
  - Creates/updates RG, storage accounts, Function App, Cosmos DB account/database/container
  - Auto-configures Function App settings using values obtained from Azure
  - Configures CORS on the Function App
  - Writes backend/local.settings.json with the same settings for local development
  - Optionally publishes code (zip deploy) and triggers data ingest
  - Prints the Function App URL and function key at the end

.EXAMPLE
  # Full deploy with all defaults (no parameters needed):
  .\scripts\deploy-azure.ps1

  # Override location or specific names if needed:
  .\scripts\deploy-azure.ps1 -Location westeurope

  # Infrastructure only (skip code publish):
  .\scripts\deploy-azure.ps1 -SkipPublish

  # Infrastructure + publish, skip ingest trigger:
  .\scripts\deploy-azure.ps1 -SkipIngest
#>
[CmdletBinding()]
param(
    [string] $ResourceGroup              = "rg-mmel-dispatch-advisor",

    [string] $Location                   = "westus2",

    [string] $SubscriptionId,

    [string] $FunctionAppName            = "mmel-dispatch-advisor",

    [string] $RuntimeStorageAccountName  = "mmeldispatchstor",

    # If omitted, the runtime storage account is also used for MMEL page images.
    [string] $DataStorageAccountName,

    [string] $CosmosAccountName          = "mmel-dispatch-cosmos",

    [string] $KeyVaultName               = "mmel-dispatch-kv",

    [string] $LogAnalyticsWorkspaceName  = "mmel-dispatch-logs",
    [string] $AppInsightsName            = "mmel-dispatch-insights",

    [string] $CosmosDatabaseName = "mmel-dispatch",
    [string] $CosmosContainerName = "mmel-items",
    [string] $BlobContainerName = "mmel-page-images",

    # Foundry is optional at deploy time; set later via Azure portal or re-run the script.
    [string] $FoundryApplicationBaseUrl = "",
    [string] $FoundryApiVersion = "2025-11-15-preview",
    [string] $FoundryTokenScope = "https://ai.azure.com/.default",

    # Skip zip-deploy of the backend code (infrastructure + settings only).
    [switch] $SkipPublish,

    # Skip triggering the ingest endpoint after a successful publish.
    [switch] $SkipIngest
)

$ErrorActionPreference = "Continue"   # "Stop" turns native-command stderr into terminating errors

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Test-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is not installed. Install from https://learn.microsoft.com/cli/azure/install-azure-cli"
    }
}

function Ensure-AzLogin {
    az account show *>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==> Azure CLI not logged in. Starting az login..."
        az login | Out-Null
        az account show *>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Azure login failed. Please run 'az login' manually and retry."
        }
    }
}

function Set-KeyVaultSecretWithRetry([string] $VaultName, [string] $Name, [string] $Value) {
    # Write via ARM management plane (management.azure.com) so vault.azure.net DNS is not required.
    # Requires Key Vault Contributor on the vault resource (assigned below).
    $uri = "https://management.azure.com/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.KeyVault/vaults/$VaultName/secrets/$Name`?api-version=2022-07-01"
    $tmpBody = Join-Path $env:TEMP "mmel-kv-secret.json"
    [System.IO.File]::WriteAllText($tmpBody,
        (@{ properties = @{ value = $Value } } | ConvertTo-Json -Compress),
        [System.Text.Encoding]::UTF8)

    $maxAttempts = 5
    $delay = 20
    for ($i = 1; $i -le $maxAttempts; $i++) {
        az rest --method PUT --uri $uri --body "@$tmpBody" | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Remove-Item $tmpBody -Force -ErrorAction SilentlyContinue
            return
        }
        if ($i -lt $maxAttempts) {
            Write-Host "  Secret write failed (attempt $i/$maxAttempts), retrying in ${delay}s..."
            Start-Sleep -Seconds $delay
            $delay = [Math]::Min($delay * 2, 60)
        }
    }
    Remove-Item $tmpBody -Force -ErrorAction SilentlyContinue
    throw "Failed to store secret '$Name' in Key Vault '$VaultName' after $maxAttempts attempts."
}

function Invoke-AzCheck([scriptblock] $block) {
    # Runs an az CLI existence-check command, suppressing both stderr output and the
    # NativeCommandError PS error record that $ErrorActionPreference="Stop" would raise.
    try { & $block } catch { }
}

function Ensure-StorageAccount([string] $name) {
    Invoke-AzCheck { az storage account show --name $name --resource-group $ResourceGroup 2>&1 | Out-Null }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Creating storage account: $name"
        az storage account create `
            --name $name `
            --location $Location `
            --resource-group $ResourceGroup `
            --sku Standard_LRS | Out-Null
    }
    else {
        Write-Host "  Storage account already exists: $name"
    }
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

Test-AzCli
Ensure-AzLogin

if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
    Write-Host "==> Setting active subscription: $SubscriptionId"
    az account set --subscription $SubscriptionId
}

$subId = az account show --query id -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($subId)) { throw "Failed to retrieve subscription ID." }

Write-Host "==> Ensuring application-insights CLI extension"
az extension add --name application-insights --yes 2>&1 | Out-Null

if ([string]::IsNullOrWhiteSpace($DataStorageAccountName)) {
    $DataStorageAccountName = $RuntimeStorageAccountName
}

$RepoRoot  = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RepoRoot "backend"

# ---------------------------------------------------------------------------
# Resource group
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring resource group: $ResourceGroup ($Location)"
try { $existingRgLocation = az group show --name $ResourceGroup --query location -o tsv 2>&1 } catch { $existingRgLocation = "" }
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRgLocation)) {
    if ($existingRgLocation -ne $Location) {
        Write-Host "  WARNING: Resource group already exists in '$existingRgLocation'. Using existing location instead of '$Location'."
        $Location = $existingRgLocation
    }
    else {
        Write-Host "  Resource group already exists: $ResourceGroup ($Location)"
    }
}
else {
    az group create --name $ResourceGroup --location $Location | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create resource group '$ResourceGroup'." }
}

# ---------------------------------------------------------------------------
# Storage accounts
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring runtime storage account: $RuntimeStorageAccountName"
Ensure-StorageAccount $RuntimeStorageAccountName

Write-Host "==> Ensuring data storage account: $DataStorageAccountName"
Ensure-StorageAccount $DataStorageAccountName

Write-Host "==> Ensuring blob container: $BlobContainerName"
$dataStorageKey = az storage account keys list `
    --resource-group $ResourceGroup `
    --account-name $DataStorageAccountName `
    --query "[0].value" -o tsv
az storage container create `
    --name $BlobContainerName `
    --account-name $DataStorageAccountName `
    --account-key $dataStorageKey | Out-Null

# ---------------------------------------------------------------------------
# Cosmos DB
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring Cosmos DB account: $CosmosAccountName"
Invoke-AzCheck { az cosmosdb show --name $CosmosAccountName --resource-group $ResourceGroup 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Creating Cosmos DB account (this can take 2-3 minutes)..."
    az cosmosdb create `
        --name $CosmosAccountName `
        --resource-group $ResourceGroup `
        --locations regionName=$Location failoverPriority=0 isZoneRedundant=False `
        --default-consistency-level Session | Out-Null
}
else {
    Write-Host "  Cosmos DB account already exists: $CosmosAccountName"
}

Write-Host "==> Ensuring Cosmos SQL database: $CosmosDatabaseName"
az cosmosdb sql database create `
    --account-name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --name $CosmosDatabaseName 2>&1 | Out-Null

Write-Host "==> Ensuring Cosmos SQL container: $CosmosContainerName"
az cosmosdb sql container create `
    --account-name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --database-name $CosmosDatabaseName `
    --name $CosmosContainerName `
    --partition-key-path "/aircraftNorm" 2>&1 | Out-Null

# Apply recommended indexing policy (composite index on aircraftNorm + sequenceNorm)
$indexPolicy = @'
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
'@
$tmpIndex = Join-Path $env:TEMP "mmel-cosmos-index.json"
$indexPolicy | Set-Content -Path $tmpIndex -Encoding UTF8
Write-Host "==> Applying Cosmos container indexing policy"
az cosmosdb sql container update `
    --account-name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --database-name $CosmosDatabaseName `
    --name $CosmosContainerName `
    --idx "@$tmpIndex" | Out-Null
Remove-Item $tmpIndex -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Function App
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring Function App: $FunctionAppName"
Invoke-AzCheck { az functionapp show --name $FunctionAppName --resource-group $ResourceGroup 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Creating Function App..."
    az functionapp create `
        --name $FunctionAppName `
        --resource-group $ResourceGroup `
        --storage-account $RuntimeStorageAccountName `
        --consumption-plan-location $Location `
        --runtime dotnet-isolated `
        --runtime-version 8 `
        --functions-version 4 `
        --os-type Linux | Out-Null
}
else {
    Write-Host "  Function App already exists: $FunctionAppName"
}

Write-Host "==> Enabling system-assigned managed identity"
az functionapp identity assign -g $ResourceGroup -n $FunctionAppName | Out-Null

Write-Host "==> Assigning Storage Blob Delegator role to Function App identity"
$principalId = az functionapp identity show -g $ResourceGroup -n $FunctionAppName --query principalId -o tsv
$storageId = az storage account show --name $DataStorageAccountName --resource-group $ResourceGroup --query id -o tsv
az role assignment create `
    --assignee $principalId `
    --role "Storage Blob Delegator" `
    --scope $storageId 2>&1 | Out-Null

# ---------------------------------------------------------------------------
# Application Insights
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring Log Analytics workspace: $LogAnalyticsWorkspaceName"
Invoke-AzCheck { az monitor log-analytics workspace show --workspace-name $LogAnalyticsWorkspaceName --resource-group $ResourceGroup 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Creating Log Analytics workspace..."
    az monitor log-analytics workspace create `
        --workspace-name $LogAnalyticsWorkspaceName `
        --resource-group $ResourceGroup `
        --location $Location | Out-Null
}
else {
    Write-Host "  Log Analytics workspace already exists: $LogAnalyticsWorkspaceName"
}
$workspaceId = az monitor log-analytics workspace show `
    --workspace-name $LogAnalyticsWorkspaceName `
    --resource-group $ResourceGroup `
    --query id -o tsv

Write-Host "==> Ensuring Application Insights: $AppInsightsName"
Invoke-AzCheck { az monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Creating Application Insights..."
    az monitor app-insights component create `
        --app $AppInsightsName `
        --location $Location `
        --resource-group $ResourceGroup `
        --kind web `
        --application-type web `
        --workspace $workspaceId | Out-Null
}
else {
    Write-Host "  Application Insights already exists: $AppInsightsName"
}
$appInsightsConnStr = az monitor app-insights component show `
    --app $AppInsightsName `
    --resource-group $ResourceGroup `
    --query connectionString -o tsv

# ---------------------------------------------------------------------------
# Resolve connection strings from Azure
# ---------------------------------------------------------------------------

Write-Host "==> Resolving connection strings"

$runtimeConn = az storage account show-connection-string `
    --resource-group $ResourceGroup `
    --name $RuntimeStorageAccountName `
    --query connectionString -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runtimeConn)) { throw "Failed to retrieve runtime storage connection string." }

$blobConn = az storage account show-connection-string `
    --resource-group $ResourceGroup `
    --name $DataStorageAccountName `
    --query connectionString -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($blobConn)) { throw "Failed to retrieve blob storage connection string." }

$cosmosConn = az cosmosdb keys list `
    --name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --type connection-strings `
    --query "connectionStrings[0].connectionString" -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cosmosConn)) { throw "Failed to retrieve Cosmos DB connection string." }

$blobBaseUrl = "https://$DataStorageAccountName.blob.core.windows.net/$BlobContainerName"

# ---------------------------------------------------------------------------
# Key Vault - provision, assign roles, store secrets
# ---------------------------------------------------------------------------

Write-Host "==> Ensuring Key Vault: $KeyVaultName"
Invoke-AzCheck { az keyvault show --name $KeyVaultName --resource-group $ResourceGroup 2>&1 | Out-Null }
if ($LASTEXITCODE -ne 0) {
    # Check whether the vault exists in soft-deleted state (name reserved for 90 days)
    $softDeleted = az keyvault list-deleted --resource-type vault --query "[?name=='$KeyVaultName'].name" -o tsv 2>&1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($softDeleted)) {
        Write-Host "  Soft-deleted vault '$KeyVaultName' found - recovering..."
        az keyvault recover --name $KeyVaultName 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Failed to recover soft-deleted Key Vault '$KeyVaultName'." }
        Write-Host "  Waiting 15s for recovered vault to become available..."
        Start-Sleep -Seconds 15
    }
    else {
        Write-Host "  Creating Key Vault..."
        az keyvault create `
            --name $KeyVaultName `
            --resource-group $ResourceGroup `
            --location $Location `
            --enable-rbac-authorization true 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Failed to create Key Vault '$KeyVaultName'. Check the output above." }
    }
}
else {
    Write-Host "  Key Vault already exists: $KeyVaultName"
}

# Confirm the vault is now reachable via ARM before proceeding
$kvId = az keyvault show --name $KeyVaultName --resource-group $ResourceGroup --query id -o tsv 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kvId)) {
    throw "Key Vault '$KeyVaultName' is not reachable after create/recover. Error: $kvId"
}

# Grant the Function App managed identity read access to secrets at runtime
Write-Host "==> Assigning Key Vault Secrets User to Function App identity"
az role assignment create `
    --assignee $principalId `
    --role "Key Vault Secrets User" `
    --scope $kvId 2>&1 | Out-Null

# Grant the current deploying identity write access so the script can store secrets
Write-Host "==> Assigning Key Vault Secrets Officer to current identity"
$currentObjectId = az ad signed-in-user show --query id -o tsv 2>&1
if ($LASTEXITCODE -ne 0) { $currentObjectId = "" }
if ([string]::IsNullOrWhiteSpace($currentObjectId)) {
    $spName = az account show --query user.name -o tsv 2>&1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($spName)) {
        $currentObjectId = az ad sp show --id $spName --query id -o tsv 2>&1
        if ($LASTEXITCODE -ne 0) { $currentObjectId = "" }
    }
}
if (-not [string]::IsNullOrWhiteSpace($currentObjectId)) {
    az role assignment create `
        --assignee $currentObjectId `
        --role "Key Vault Contributor" `
        --scope $kvId 2>&1 | Out-Null
    Write-Host "  Waiting 30s for RBAC propagation before writing secrets..."
    Start-Sleep -Seconds 30
}
else {
    Write-Host "  WARNING: Could not determine current identity. If secret writes fail, manually assign 'Key Vault Contributor' on $KeyVaultName."
}

Write-Host "==> Storing connection strings in Key Vault"
Set-KeyVaultSecretWithRetry $KeyVaultName "cosmos-connection-string" $cosmosConn
Set-KeyVaultSecretWithRetry $KeyVaultName "blob-connection-string"   $blobConn

$kvBaseUri      = "https://$KeyVaultName.vault.azure.net/secrets"
$cosmosConnRef  = "@Microsoft.KeyVault(SecretUri=$kvBaseUri/cosmos-connection-string/)"
$blobConnRef    = "@Microsoft.KeyVault(SecretUri=$kvBaseUri/blob-connection-string/)"

# ---------------------------------------------------------------------------
# Function App settings
# ---------------------------------------------------------------------------

# Build the desired settings as a hashtable.
# We use az rest PUT (JSON body) instead of az functionapp config appsettings set
# because Key Vault reference values contain parentheses that CMD misparses as
# compound-command syntax when passed as CLI arguments.
$newSettings = [ordered]@{
    "AzureWebJobsStorage"                    = $runtimeConn
    "FUNCTIONS_WORKER_RUNTIME"               = "dotnet-isolated"
    "APPLICATIONINSIGHTS_CONNECTION_STRING"  = $appInsightsConnStr
    "Cosmos__ConnectionString"               = $cosmosConnRef
    "Cosmos__DatabaseName"                   = $CosmosDatabaseName
    "Cosmos__ContainerName"                  = $CosmosContainerName
    "Blob__ConnectionString"                 = $blobConnRef
    "Blob__ContainerName"                    = $BlobContainerName
    "Blob__PublicBlobBaseUrl"                = $blobBaseUrl
    "Blob__SasExpiryMinutes"                 = "60"
    "Rag__MarkdownPath"                      = "mmel_rag.md"
    "Rag__TopChunkCount"                     = "8"
    "Ingestion__SourceDirectory"             = ""
    "Foundry__ApiVersion"                    = $FoundryApiVersion
    "Foundry__TokenScope"                    = $FoundryTokenScope
}
if (-not [string]::IsNullOrWhiteSpace($FoundryApplicationBaseUrl)) {
    $newSettings["Foundry__ApplicationBaseUrl"] = $FoundryApplicationBaseUrl
}

Write-Host "==> Applying Function App configuration"
$siteUri = "/subscriptions/$subId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/sites/$FunctionAppName"

# GET current settings so we merge rather than overwrite Function App built-ins
$currentJson = az rest --method POST --uri "${siteUri}/config/appsettings/list?api-version=2022-03-01" --body '{}' -o json
$mergedSettings = @{}
$currentProps = ($currentJson | ConvertFrom-Json).properties
if ($currentProps) {
    $currentProps.PSObject.Properties | ForEach-Object { $mergedSettings[$_.Name] = $_.Value }
}
foreach ($key in $newSettings.Keys) { $mergedSettings[$key] = $newSettings[$key] }

$tmpBody = Join-Path $env:TEMP "mmel-appsettings.json"
[System.IO.File]::WriteAllText($tmpBody, (@{properties = $mergedSettings} | ConvertTo-Json -Depth 5 -Compress), [System.Text.Encoding]::UTF8)
az rest --method PUT --uri "${siteUri}/config/appsettings?api-version=2022-03-01" --body "@$tmpBody" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to apply Function App configuration." }
Remove-Item $tmpBody -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

Write-Host "==> Configuring CORS (allow all origins)"
az functionapp cors add `
    --resource-group $ResourceGroup `
    --name $FunctionAppName `
    --allowed-origins "*" | Out-Null

# ---------------------------------------------------------------------------
# Write local.settings.json for local development
# ---------------------------------------------------------------------------

$localSettings = @{
    IsEncrypted = $false
    Values      = [ordered]@{
        AzureWebJobsStorage                    = $runtimeConn
        FUNCTIONS_WORKER_RUNTIME               = "dotnet-isolated"
        "APPLICATIONINSIGHTS_CONNECTION_STRING" = $appInsightsConnStr
        "Cosmos__ConnectionString"  = $cosmosConn
        "Cosmos__DatabaseName"      = $CosmosDatabaseName
        "Cosmos__ContainerName"     = $CosmosContainerName
        "Blob__ConnectionString"    = $blobConn
        "Blob__ContainerName"       = $BlobContainerName
        "Blob__PublicBlobBaseUrl"   = $blobBaseUrl
        "Blob__SasExpiryMinutes"    = "60"
        "Rag__MarkdownPath"         = "../../../documents/mmel_rag.md"
        "Rag__TopChunkCount"        = "8"
        "Ingestion__SourceDirectory" = "../../../documents/mmel"
        "Foundry__ApplicationBaseUrl" = $FoundryApplicationBaseUrl
        "Foundry__ApiVersion"       = $FoundryApiVersion
        "Foundry__TokenScope"       = $FoundryTokenScope
    }
} | ConvertTo-Json -Depth 5

$localSettingsPath = Join-Path $BackendDir "local.settings.json"
Write-Host "==> Writing $localSettingsPath"
$localSettings | Set-Content -Path $localSettingsPath -Encoding UTF8

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

if (-not $SkipPublish) {
    Write-Host "==> dotnet publish"
    Push-Location $BackendDir
    try {
        dotnet publish -c Release -o ./publish-deploy --verbosity minimal
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

        $publishPath = Join-Path $BackendDir "publish-deploy"
        $zipPath     = Join-Path $BackendDir "deploy.zip"
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

        Write-Host "==> Creating deployment zip"
        Compress-Archive -Path (Join-Path $publishPath "*") -DestinationPath $zipPath -Force

        Write-Host "==> Zip deploy to Function App"
        az functionapp deployment source config-zip `
            --resource-group $ResourceGroup `
            --name $FunctionAppName `
            --src $zipPath | Out-Null

        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $publishPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    finally {
        Pop-Location
    }

    # -----------------------------------------------------------------------
    # Retrieve function key and trigger ingest
    # -----------------------------------------------------------------------

    Write-Host "==> Retrieving default function key"
    $functionKey = az functionapp keys list `
        -g $ResourceGroup `
        -n $FunctionAppName `
        --query "functionKeys.default" -o tsv

    # Ingest is NOT triggered automatically from here because the MMEL JSON files
    # (with embedded base64 images) are not bundled with the deploy package - they
    # are too large (2+ GB) to zip-deploy. Run ingest once locally instead:
    #
    #   cd backend
    #   func start          # local.settings.json points to ../../../documents/mmel
    #   curl -X POST http://localhost:7071/api/ingest
    #
    # The data is then stored in Azure Cosmos DB + Blob Storage and used by the
    # deployed Function App. No re-ingest is needed on subsequent code deploys.
    if ($SkipIngest) {
        Write-Host "==> SkipIngest set."
    }
    Write-Host "==> To populate data: run 'func start' locally and POST http://localhost:7071/api/ingest"
}
else {
    Write-Host "==> SkipPublish set - infrastructure and settings configured. Run without -SkipPublish to deploy code."
    $functionKey = az functionapp keys list `
        -g $ResourceGroup `
        -n $FunctionAppName `
        --query "functionKeys.default" -o tsv
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "========================================================"
Write-Host "  Deploy finished."
Write-Host "  App URL    : https://$FunctionAppName.azurewebsites.net"
if (-not [string]::IsNullOrWhiteSpace($functionKey)) {
    Write-Host "  Function key: $functionKey"
    Write-Host ""
    Write-Host "  Endpoints:"
    Write-Host "    GET  https://$FunctionAppName.azurewebsites.net/api/health"
    Write-Host "    GET  https://$FunctionAppName.azurewebsites.net/api/search?code=<key>&aircraft=...&q=..."
    Write-Host "    POST https://$FunctionAppName.azurewebsites.net/api/ingest?code=<key>"
    Write-Host "    POST https://$FunctionAppName.azurewebsites.net/api/advise?code=<key>"
}
Write-Host "  Cosmos     : $CosmosAccountName / $CosmosDatabaseName / $CosmosContainerName"
Write-Host "  Blob       : $DataStorageAccountName / $BlobContainerName"
Write-Host "  Key Vault  : $KeyVaultName (secrets: cosmos-connection-string, blob-connection-string)"
Write-Host "  App Insights: $AppInsightsName (workspace: $LogAnalyticsWorkspaceName)"
Write-Host "  local.settings.json written to: $localSettingsPath"
if ([string]::IsNullOrWhiteSpace($FoundryApplicationBaseUrl)) {
    Write-Host ""
    Write-Host "  NOTE: Foundry__ApplicationBaseUrl was not provided."
    Write-Host "  The /api/advise endpoint will fall back to heuristic extraction until set."
    Write-Host "  Set it with:"
    Write-Host "    az functionapp config appsettings set -g $ResourceGroup -n $FunctionAppName --settings Foundry__ApplicationBaseUrl=<url>"
}
Write-Host "========================================================"
