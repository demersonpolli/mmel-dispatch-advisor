$base = "https://mmel-dispatch-advisor.azurewebsites.net"
$key  = "-A_3Hyz3levCKKm79CoD0mRY8PPX8kJ_XfruYm61t-ODAzFuHyUNBQ=="
$h    = @{ "x-functions-key" = $key; "Content-Type" = "application/json" }

$tests = @(
    "A220-100 hydraulic system failure",
    "ATR42 engine start failure",
    "Boeing B-737 hydraulic system B inoperative",
    "B-747-400 engine anti-ice inoperative",
    "EMB-135 pitot heat inoperative"
)

foreach ($q in $tests) {
    $body = @{ query = $q } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Uri "$base/api/advise" -Method Post -Headers $h -Body $body -TimeoutSec 60
        Write-Host "Query  : $q"
        Write-Host "Items  : $($r.items.Count)"
        Write-Host "Notes  : $($r.retrievalNotes)"
        Write-Host "Report snippet: $($r.report.Substring(0,[Math]::Min(150,$r.report.Length)))"
        Write-Host "---"
    } catch {
        Write-Host "ERROR for '$q': $_"
        Write-Host "---"
    }
}
