<#
.SYNOPSIS
  Full Azure deployment for MMEL Dispatch Advisor backend.

.DESCRIPTION
  - Ensures Azure login (runs az login when needed)
  - Creates/updates RG, storage accounts, Function App, Cosmos DB account/database/container
  - Auto-configures Function App settings using values obtained from Azure
  - Optionally publishes code (zip deploy)
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [string] $Location = "eastus",

    [string] $SubscriptionId,

    [Parameter(Mandatory = $true)]
    [string] $FunctionAppName,

    [Parameter(Mandatory = $true)]
    [string] $RuntimeStorageAccountName,

    [string] $DataStorageAccountName,

    [Parameter(Mandatory = $true)]
    [string] $CosmosAccountName,

    [string] $CosmosDatabaseName = "mmel-dispatch",
    [string] $CosmosContainerName = "mmel-items",
    [string] $BlobContainerName = "mmel-page-images",

    [string] $FoundryApplicationBaseUrl = "",
    [string] $FoundryApiVersion = "2025-11-15-preview",
    [string] $FoundryTokenScope = "https://ai.azure.com/.default",

    [switch] $SkipPublish
)

$ErrorActionPreference = "Stop"

function Test-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is not installed. Install from https://learn.microsoft.com/cli/azure/install-azure-cli"
    }
}

function Ensure-AzLogin {
    az account show 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==> Azure CLI not logged in. Starting az login..."
        az login | Out-Null
        az account show 1>$null 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Azure login failed. Please run 'az login' manually and retry."
        }
    }
}

function Ensure-StorageAccount([string] $name) {
    az storage account show --name $name --resource-group $ResourceGroup 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        az storage account create `
            --name $name `
            --location $Location `
            --resource-group $ResourceGroup `
            --sku Standard_LRS | Out-Null
    }
}

Test-AzCli
Ensure-AzLogin

if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
    Write-Host "==> Setting active subscription: $SubscriptionId"
    az account set --subscription $SubscriptionId
}

if ([string]::IsNullOrWhiteSpace($DataStorageAccountName)) {
    $DataStorageAccountName = $RuntimeStorageAccountName
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RepoRoot "backend"

Write-Host "==> Ensuring resource group: $ResourceGroup"
az group create --name $ResourceGroup --location $Location | Out-Null

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

Write-Host "==> Ensuring Cosmos DB account: $CosmosAccountName"
az cosmosdb show --name $CosmosAccountName --resource-group $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    az cosmosdb create `
        --name $CosmosAccountName `
        --resource-group $ResourceGroup `
        --locations regionName=$Location failoverPriority=0 isZoneRedundant=False `
        --default-consistency-level Session | Out-Null
}

Write-Host "==> Ensuring Cosmos SQL database/container"
az cosmosdb sql database create `
    --account-name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --name $CosmosDatabaseName | Out-Null
az cosmosdb sql container create `
    --account-name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --database-name $CosmosDatabaseName `
    --name $CosmosContainerName `
    --partition-key-path "/aircraftNorm" | Out-Null

Write-Host "==> Ensuring Function App: $FunctionAppName"
az functionapp show --name $FunctionAppName --resource-group $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
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

Write-Host "==> Enabling system-assigned managed identity"
az functionapp identity assign -g $ResourceGroup -n $FunctionAppName | Out-Null

Write-Host "==> Resolving Azure-derived app settings"
$runtimeConn = az storage account show-connection-string `
    --resource-group $ResourceGroup `
    --name $RuntimeStorageAccountName `
    --query connectionString -o tsv

$blobConn = az storage account show-connection-string `
    --resource-group $ResourceGroup `
    --name $DataStorageAccountName `
    --query connectionString -o tsv

$cosmosConn = az cosmosdb keys list `
    --name $CosmosAccountName `
    --resource-group $ResourceGroup `
    --type connection-strings `
    --query "connectionStrings[0].connectionString" -o tsv

$blobBaseUrl = "https://$DataStorageAccountName.blob.core.windows.net/$BlobContainerName"

$settings = @(
    "AzureWebJobsStorage=$runtimeConn",
    "FUNCTIONS_WORKER_RUNTIME=dotnet-isolated",
    "Cosmos__ConnectionString=$cosmosConn",
    "Cosmos__DatabaseName=$CosmosDatabaseName",
    "Cosmos__ContainerName=$CosmosContainerName",
    "Blob__ConnectionString=$blobConn",
    "Blob__ContainerName=$BlobContainerName",
    "Blob__PublicBlobBaseUrl=$blobBaseUrl",
    "Blob__SasExpiryMinutes=60",
    "Foundry__ApiVersion=$FoundryApiVersion",
    "Foundry__TokenScope=$FoundryTokenScope"
)
if (-not [string]::IsNullOrWhiteSpace($FoundryApplicationBaseUrl)) {
    $settings += "Foundry__ApplicationBaseUrl=$FoundryApplicationBaseUrl"
}

Write-Host "==> Applying Function App configuration"
az functionapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $FunctionAppName `
    --settings $settings | Out-Null

if (-not $SkipPublish) {
    Write-Host "==> dotnet publish"
    Push-Location $BackendDir
    try {
        dotnet publish -c Release -o ./publish-deploy --verbosity minimal
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

        $publishPath = Join-Path $BackendDir "publish-deploy"
        $zipPath = Join-Path $BackendDir "deploy.zip"
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

        Write-Host "==> Creating zip for Azure"
        Compress-Archive -Path (Join-Path $publishPath "*") -DestinationPath $zipPath -Force

        Write-Host "==> Zip deploy to Function App"
        az functionapp deployment source config-zip `
            --resource-group $ResourceGroup `
            --name $FunctionAppName `
            --src $zipPath | Out-Null

        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Host "SkipPublish set — infrastructure and app settings configured."
}

Write-Host ""
Write-Host "Deploy finished."
Write-Host "  App URL: https://$FunctionAppName.azurewebsites.net"
Write-Host "  Function Keys: az functionapp keys list -g $ResourceGroup -n $FunctionAppName"
Write-Host "  Cosmos Account: $CosmosAccountName"
Write-Host "  Blob Account: $DataStorageAccountName / Container: $BlobContainerName"
