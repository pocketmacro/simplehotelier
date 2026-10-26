# SimpleHotelier - apply the booking-page migration (GA/redirect columns,
# availability function, public add-on inserts). Reads .env like the setup script.
#   powershell -ExecutionPolicy Bypass -File scripts/apply-booking-migration.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root '.env'))) { $root = (Get-Location).Path }
$envMap = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
  $l = $_.Trim()
  if ($l -and -not $l.StartsWith('#') -and $l.Contains('=')) { $kv = $l -split '=', 2; $envMap[$kv[0].Trim()] = $kv[1].Trim().Trim('"').Trim("'") }
}
$token = $envMap['SUPABASE_TOKEN']; $url = $envMap['NEXT_PUBLIC_SUPABASE_URL']
$ref = $null; if ($url -match 'https://([a-z0-9]+)\.supabase\.co') { $ref = $Matches[1] }
if (-not $token -or -not $ref) { Write-Host 'ABORT: .env needs SUPABASE_TOKEN + NEXT_PUBLIC_SUPABASE_URL'; exit 1 }
$sqlText = Get-Content (Join-Path $root 'supabase/migrations/20261027000000_booking.sql') -Raw -Encoding UTF8
$chunks = @($sqlText -split '(?m)^-- @@CHUNK@@.*$' | Where-Object { $_.Trim() })
try {
  $i = 0
  foreach ($sql in $chunks) {
    $i++
    $body = (@{ query = $sql } | ConvertTo-Json -Compress)
    $r = Invoke-WebRequest -Method POST -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body -TimeoutSec 90 -UseBasicParsing
    Write-Host ("Booking migration chunk {0}/{1}: OK (HTTP {2})" -f $i, $chunks.Count, [int]$r.StatusCode)
  }
} catch {
  $code = $null; if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  $msg = $_.ErrorDetails.Message; if ($msg -and $msg.Length -gt 500) { $msg = $msg.Substring(0, 500) }
  Write-Host ("Booking migration FAILED: HTTP {0} :: {1}" -f $code, $msg)
  Write-Host 'If HTTP 401: the setup token was revoked. Paste supabase/migrations/20261027000000_booking.sql into the Supabase SQL Editor instead.'
  exit 1
}
