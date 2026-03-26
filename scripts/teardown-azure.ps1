<#
.SYNOPSIS
  Tears down all Azure resources created by deploy-azure.ps1.

.DESCRIPTION
  Deletes the resource group (which removes the Function App, Cosmos DB, storage
  accounts, Log Analytics workspace, Application Insights, and Key Vault).
  Because Azure Key Vault has mandatory soft-delete (90-day retention), the vault
  is not permanently gone after RG deletion. Use -PurgeKeyVault to permanently
  purge it immediately.

.EXAMPLE
  # Preview what will be deleted (no changes made):
  .\scripts\teardown-azure.ps1 -WhatIf

  # Full teardown with confirmation prompt:
  .\scripts\teardown-azure.ps1

  # Skip confirmation prompt:
  .\scripts\teardown-azure.ps1 -Force

  # Also purge the soft-deleted Key Vault and remove local.settings.json:
  .\scripts\teardown-azure.ps1 -Force -PurgeKeyVault -RemoveLocalSettings
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $ResourceGroup     = "rg-mmel-dispatch-advisor",
    [string] $KeyVaultName      = "mmel-dispatch-kv",
    [string] $SubscriptionId,

    # Skip the confirmation prompt.
    [switch] $Force,

    # Permanently purge the soft-deleted Key Vault after RG deletion.
    # WARNING: this is irreversible — all secrets are gone immediately.
    [switch] $PurgeKeyVault,

    # Also delete backend/local.settings.json (contains plain connection strings).
    [switch] $RemoveLocalSettings
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI (az) is not installed."
}

az account show 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "==> Azure CLI not logged in. Starting az login..."
    az login | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($SubscriptionId)) {
    Write-Host "==> Setting active subscription: $SubscriptionId"
    az account set --subscription $SubscriptionId
}

# Check the resource group exists before prompting.
az group show --name $ResourceGroup 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Resource group '$ResourceGroup' does not exist. Nothing to tear down."
    exit 0
}

Write-Host ""
Write-Host "========================================================"
Write-Host "  This will PERMANENTLY DELETE the following:"
Write-Host "    Resource group : $ResourceGroup"
Write-Host "    (includes Function App, Cosmos DB, storage accounts,"
Write-Host "     Log Analytics, Application Insights, Key Vault)"
if ($PurgeKeyVault) {
    Write-Host "    Key Vault purge: $KeyVaultName (secrets permanently gone)"
}
if ($RemoveLocalSettings) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    $localSettingsPath = Join-Path $RepoRoot "backend" "local.settings.json"
    Write-Host "    Local file     : $localSettingsPath"
}
Write-Host "========================================================"
Write-Host ""

if (-not $Force -and -not $WhatIfPreference) {
    $answer = Read-Host "Type 'yes' to confirm deletion"
    if ($answer -ne "yes") {
        Write-Host "Aborted."
        exit 0
    }
}

if ($PSCmdlet.ShouldProcess($ResourceGroup, "Delete resource group")) {
    Write-Host "==> Deleting resource group: $ResourceGroup"
    az group delete --name $ResourceGroup --yes | Out-Null
    Write-Host "  Resource group deleted."
}

if ($PurgeKeyVault -and $PSCmdlet.ShouldProcess($KeyVaultName, "Purge soft-deleted Key Vault")) {
    Write-Host "==> Purging soft-deleted Key Vault: $KeyVaultName"
    az keyvault purge --name $KeyVaultName 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Key Vault purged."
    }
    else {
        Write-Warning "  Could not purge Key Vault '$KeyVaultName'. It may already be purged or not yet soft-deleted."
    }
}

if ($RemoveLocalSettings) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
    $localSettingsPath = Join-Path $RepoRoot "backend" "local.settings.json"
    if ($PSCmdlet.ShouldProcess($localSettingsPath, "Delete local.settings.json")) {
        if (Test-Path $localSettingsPath) {
            Remove-Item $localSettingsPath -Force
            Write-Host "==> Deleted $localSettingsPath"
        }
        else {
            Write-Host "==> $localSettingsPath not found, skipping."
        }
    }
}

Write-Host ""
Write-Host "Teardown complete."
