<#
.SYNOPSIS
  Starts the local Azure Functions host and runs MMEL data ingestion.

.DESCRIPTION
  1. Verifies the MMEL documents directory and local.settings.json exist.
  2. Starts 'func start' in the backend directory on a chosen port.
  3. Polls the health endpoint until the host is ready (up to 3 minutes).
  4. POSTs to /api/ingest for each JSON file found (or all at once).
  5. Prints ingestion statistics and stops the host.

.PARAMETER Port
  Port for the local Functions host (default: 7071).

.PARAMETER Timeout
  Seconds to wait for the host to become ready (default: 180).

.EXAMPLE
  .\scripts\ingest-local.ps1
  .\scripts\ingest-local.ps1 -Port 7072
#>
[CmdletBinding()]
param(
    [int]    $Port    = 7071,
    [int]    $Timeout = 180,

    # Pass -NoPurge to skip clearing existing data before ingesting.
    [switch] $NoPurge
)

$ErrorActionPreference = "Stop"

$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RepoRoot "backend"
$MmelDir    = Join-Path (Join-Path $RepoRoot "documents") "mmel"
$Settings   = Join-Path $BackendDir "local.settings.json"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if (-not (Get-Command func -ErrorAction SilentlyContinue)) {
    throw "Azure Functions Core Tools (func) not found. Install from https://github.com/Azure/azure-functions-core-tools"
}

# Patch local.settings.json to use the absolute MMEL path.
# The relative path in the file (../../../documents/mmel) resolves from
# AppContext.BaseDirectory (bin/Debug/net8.0/) during local func start,
# which is one level too shallow to reach the repo root.
$settingsJson = Get-Content $Settings -Raw | ConvertFrom-Json
$settingsJson.Values.'Ingestion__SourceDirectory' = $MmelDir.ToString()
$settingsJson | ConvertTo-Json -Depth 5 | Set-Content $Settings -Encoding UTF8
Write-Host "==> Patched Ingestion__SourceDirectory -> $MmelDir"

if (-not (Test-Path $Settings)) {
    throw "local.settings.json not found at $Settings. Run .\scripts\deploy-azure.ps1 first."
}

if (-not (Test-Path $MmelDir)) {
    throw "MMEL documents directory not found: $MmelDir"
}

$jsonFiles = Get-ChildItem -Path $MmelDir -Recurse -Filter "*.json" |
    Where-Object { $_.Name -notlike "*Cover*" }

if ($jsonFiles.Count -eq 0) {
    throw "No JSON files found under $MmelDir"
}

Write-Host "==> Found $($jsonFiles.Count) MMEL JSON files under $MmelDir"

# ---------------------------------------------------------------------------
# Kill any existing process on the chosen port
# ---------------------------------------------------------------------------

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "==> Port $Port in use - killing existing process (PID $($existing.OwningProcess))..."
    Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# ---------------------------------------------------------------------------
# Start func host
# ---------------------------------------------------------------------------

Write-Host "==> Starting Azure Functions host on port $Port..."
$funcJob = Start-Job -ScriptBlock {
    param($dir, $port)
    Set-Location $dir
    func start --port $port 2>&1
} -ArgumentList $BackendDir, $Port

$baseUrl = "http://localhost:$Port/api"
$deadline = (Get-Date).AddSeconds($Timeout)
$ready = $false

Write-Host "==> Waiting for host to be ready (up to ${Timeout}s)..."
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    try {
        $resp = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 5 -ErrorAction Stop
        if ($resp.status -eq "healthy") {
            Write-Host "  Host ready. cosmos=$($resp.cosmos) blob=$($resp.blob) rag=$($resp.rag) ragChunks=$($resp.ragChunks)"
            $ready = $true
            break
        }
    }
    catch { }

    # Print any new func output to help diagnose startup issues
    $output = Receive-Job $funcJob -ErrorAction SilentlyContinue
    if ($output) { $output | Where-Object { $_ } | ForEach-Object { Write-Host "  [func] $_" } }
}

if (-not $ready) {
    Write-Host "==> Func host output so far:"
    Receive-Job $funcJob -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  [func] $_" }
    Stop-Job  $funcJob -ErrorAction SilentlyContinue
    Remove-Job $funcJob -ErrorAction SilentlyContinue
    throw "Functions host did not become healthy within ${Timeout}s."
}

# ---------------------------------------------------------------------------
# Run ingestion
# ---------------------------------------------------------------------------

$ingestUri = if ($NoPurge) { "$baseUrl/ingest" } else { "$baseUrl/ingest?purge=true" }

Write-Host ""
if ($NoPurge) {
    Write-Host "==> Running ingestion (POST $ingestUri) - existing data kept."
} else {
    Write-Host "==> Purging existing data then ingesting (POST $ingestUri)..."
}
Write-Host "    This may take several minutes - uploading MMEL items and page images."

try {
    $result = Invoke-RestMethod `
        -Uri $ingestUri `
        -Method Post `
        -TimeoutSec 3600 `
        -ErrorAction Stop

    Write-Host ""
    Write-Host "========================================================"
    Write-Host "  Ingestion complete."
    Write-Host "  Files processed : $($result.filesProcessed)"
    Write-Host "  Items upserted  : $($result.itemsUpserted)"
    Write-Host "  Images uploaded : $($result.imagesUploaded)"
    Write-Host "========================================================"
}
catch {
    Write-Host "  ERROR during ingestion: $_"
    # Print the response body if available
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body   = $reader.ReadToEnd()
        Write-Host "  Response body: $body"
    }
    Write-Host ""
    Write-Host "  Func host output:"
    Receive-Job $funcJob -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  [func] $_" }
}
finally {
    Write-Host ""
    Write-Host "==> Stopping Functions host..."
    Stop-Job  $funcJob -ErrorAction SilentlyContinue
    Remove-Job $funcJob -ErrorAction SilentlyContinue
}
