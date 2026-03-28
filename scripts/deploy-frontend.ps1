# deploy-frontend.ps1
# Rebuilds and redeploys the Vite SPA to Azure Static Web Apps
# Usage: .\scripts\deploy-frontend.ps1

param(
    [string]$ResourceGroup = "rg-mmel-dispatch-advisor",
    [string]$SwaName       = "mmel-dispatch-advisor-web",
    [string]$AppDir        = (Join-Path $PSScriptRoot "..\apps\mobile")
)

Set-Location (Join-Path $PSScriptRoot "..")

Write-Host ""
Write-Host "========================================"
Write-Host "  MMEL Dispatch Advisor - Frontend Deploy"
Write-Host "========================================"
Write-Host ""

# Step 1 - Build
Write-Host "[1/3] Building frontend..."
Push-Location $AppDir
npm run build
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) {
    Write-Host "ERROR: Build failed (exit $buildExit)"
    exit 1
}
Write-Host "      Build complete."

# Step 2 - Get deployment token
Write-Host ""
Write-Host "[2/3] Fetching deployment token..."
$DeployToken = (az staticwebapp secrets list `
    --name $SwaName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" `
    --output tsv) 2>$null | Select-Object -Last 1

if (-not $DeployToken -or $DeployToken.Trim() -eq "") {
    Write-Host "ERROR: Could not retrieve deployment token."
    Write-Host "       Make sure you are logged in: az login"
    exit 1
}
Write-Host "      Token retrieved."

# Step 3 - Deploy
Write-Host ""
Write-Host "[3/3] Deploying to Azure Static Web Apps..."
swa deploy "$AppDir\dist" --deployment-token $DeployToken --env production
$deployExit = $LASTEXITCODE
if ($deployExit -ne 0) {
    Write-Host "ERROR: swa deploy failed (exit $deployExit)"
    exit 1
}

# Print URL
$Hostname = (az staticwebapp show `
    --name $SwaName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" `
    --output tsv) 2>$null | Select-Object -Last 1

Write-Host ""
Write-Host "========================================"
Write-Host "  Deployed successfully!"
Write-Host "  URL: https://$Hostname"
Write-Host "========================================"
Write-Host ""
