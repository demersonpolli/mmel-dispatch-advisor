$base = "https://mmel-dispatch-advisor.azurewebsites.net"
$key  = "-A_3Hyz3levCKKm79CoD0mRY8PPX8kJ_XfruYm61t-ODAzFuHyUNBQ=="
$h    = @{ "x-functions-key" = $key; "Content-Type" = "application/json" }

$queries = @(
    @{ aircraft="A-220";       query="A220 hydraulic system failure" },
    @{ aircraft="A-320";       query="A320 hydraulic green circuit inoperative" },
    @{ aircraft="ATR-42";      query="ATR-42 engine start failure" },
    @{ aircraft="ATR-72";      query="ATR-72 autopilot inoperative" },
    @{ aircraft="B-737";       query="B737 hydraulic system B inoperative" },
    @{ aircraft="B-737 MAX";   query="B737 MAX flight management computer failure" },
    @{ aircraft="B-747-400";   query="B747-400 engine anti-ice inoperative" },
    @{ aircraft="B-777";       query="B777 hydraulic right system failure" },
    @{ aircraft="EMB-135-145"; query="EMB-145 pitot heat inoperative" }
)

Write-Host ("{0,-14} {1,8} {2,10}  Status" -f "Aircraft","Items","ReportLen")
Write-Host ("-" * 45)

foreach ($q in $queries) {
    try {
        $bodyObj = @{ query = $q.query }
        $bodyStr = $bodyObj | ConvertTo-Json
        $r = Invoke-RestMethod -Uri "$base/api/advise" -Method Post -Headers $h -Body $bodyStr -TimeoutSec 120
        $status = if ($r.items.Count -gt 0 -and $r.report.Length -gt 0) { "PASS" } else { "WARN - 0 items" }
        Write-Host ("{0,-14} {1,8} {2,10}  {3}" -f $q.aircraft, $r.items.Count, $r.report.Length, $status)
    } catch {
        Write-Host ("{0,-14}   ERROR: {1}" -f $q.aircraft, $_.Exception.Message)
    }
}
