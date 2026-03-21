<#
.SYNOPSIS
  Removes Azure resources created for the MMEL Dispatch Advisor backend deploy script.

.DESCRIPTION
  Deletes the entire resource group (Function App, its storage account, and anything else in that group).

  IMPORTANT: If Cosmos DB or other shared services are in the same resource group, they will be deleted too.
  Use a dedicated resource group for this Function App stack.

.PARAMETER ResourceGroup
  Resource group to delete.

.PARAMETER Force
  Skip confirmation prompt.

.EXAMPLE
  .\scripts\remove-azure-resources.ps1 -ResourceGroup rg-mmel-advisor -Force
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,

    [switch] $Force
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Azure CLI (az) is not installed."
}

$rgExists = az group exists --name $ResourceGroup
if ($rgExists -ne "true") {
    Write-Host "Resource group '$ResourceGroup' does not exist. Nothing to do."
    exit 0
}

if (-not $Force) {
    $confirm = Read-Host "Delete resource group '$ResourceGroup' and ALL resources inside it? [y/N]"
    if ($confirm -notmatch '^[yY]') {
        Write-Host "Aborted."
        exit 1
    }
}

Write-Host "==> Deleting resource group: $ResourceGroup (async)"
az group delete --name $ResourceGroup --yes --no-wait
Write-Host "Deletion submitted. Check portal or: az group show -n $ResourceGroup"
