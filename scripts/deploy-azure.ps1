<#
.SYNOPSIS
  Deploys the MMEL Dispatch Advisor backend to Azure (Resource Group + Storage + Linux Consumption Function App + zip deploy).

.DESCRIPTION
  Does NOT create Cosmos DB, Foundry, or the MMEL blob storage account by default.
  After deploy, configure Application settings in the portal or with:
    az functionapp config appsettings set -g <rg> -n <app> --settings KEY=VALUE ...

.PARAMETER ResourceGroup
  Azure resource group name (created if missing).

.PARAMETER Location
  Azure region (default: eastus).

.PARAMETER FunctionAppName
  Globally unique Function App name (alphanumeric, used in *.azurewebsites.net).

.PARAMETER StorageAccountName
  Globally unique storage account for Functions runtime (3-24 chars, lowercase alphanumeric).

.PARAMETER SkipPublish
  Only create/update Azure resources; do not build or upload code.

.EXAMPLE
  .\scripts\deploy-azure.ps1 -ResourceGroup rg-mmel-advisor -FunctionAppName mmel-advisor-func-unique123 -StorageAccountName mmeladvstore123
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [string] $Location = "eastus",

    [Parameter(Mandatory = $true)]
    [string] $FunctionAppName,

    [Parameter(Mandatory = $true)]
    [string] $StorageAccountName,

    [switch] $SkipPublish
)

$ErrorActionPreference = "Stop"

function Test-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is not installed. Install from https://learn.microsoft.com/cli/azure/install-azure-cli"
    }
}

Test-AzCli

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RepoRoot "backend"

Write-Host "==> Ensuring resource group: $ResourceGroup"
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "==> Ensuring storage account: $StorageAccountName"
az storage account show --name $StorageAccountName --resource-group $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    az storage account create `
        --name $StorageAccountName `
        --location $Location `
        --resource-group $ResourceGroup `
        --sku Standard_LRS | Out-Null
}

Write-Host "==> Ensuring Function App: $FunctionAppName"
az functionapp show --name $FunctionAppName --resource-group $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    az functionapp create `
        --name $FunctionAppName `
        --resource-group $ResourceGroup `
        --storage-account $StorageAccountName `
        --consumption-plan-location $Location `
        --runtime dotnet-isolated `
        --runtime-version 8 `
        --functions-version 4 `
        --os-type Linux | Out-Null
}

Write-Host "==> Enabling system-assigned managed identity (for Foundry / future Key Vault)"
az functionapp identity assign -g $ResourceGroup -n $FunctionAppName | Out-Null

if ($SkipPublish) {
    Write-Host "SkipPublish set — done (no code upload)."
    Write-Host "Function URL will be: https://$FunctionAppName.azurewebsites.net"
    exit 0
}

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
        --src $zipPath

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Deploy finished."
Write-Host "  App:  https://$FunctionAppName.azurewebsites.net"
Write-Host "  Keys: az functionapp keys list -g $ResourceGroup -n $FunctionAppName"
Write-Host ""
Write-Host "Next: set Application settings (Cosmos, Blob, Foundry, Rag paths). See backend/README.md and backend/local.settings.json.example"
