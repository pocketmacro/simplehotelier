# SimpleHotelier - apply admin/support migration and make the first auth user
# a system admin. Reads .env like the other setup scripts.
#   powershell -ExecutionPolicy Bypass -File scripts/apply-admin-migration.ps1
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
function Sql($q) {
  $body = (@{ query = $q } | ConvertTo-Json -Compress)
  try {
    $r = Invoke-WebRequest -Method POST -Uri "https://api.supabase.com/v1/projects/$ref/database/query" `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body -TimeoutSec 90 -UseBasicParsing
    return @{ ok = $true; text = $r.Content }
  } catch {
    $m = $_.ErrorDetails.Message; if ($m -and $m.Length -gt 400) { $m = $m.Substring(0, 400) }
    return @{ ok = $false; text = $m }
  }
}
$sqlText = Get-Content (Join-Path $root 'supabase/migrations/20261028000000_admin_support.sql') -Raw -Encoding UTF8
$chunks = @($sqlText -split '(?m)^-- @@CHUNK@@.*$' | Where-Object { $_.Trim() })
$i = 0
foreach ($c in $chunks) {
  $i++
  $r = Sql $c
  if ($r.ok) { Write-Host ("Admin migration chunk {0}/{1}: OK" -f $i, $chunks.Count) }
  else { Write-Host ("Admin migration chunk {0}/{1} FAILED :: {2}" -f $i, $chunks.Count, $r.text); exit 1 }
}
$u = Sql "select id::text as id, coalesce(email,'(no email)') as email from auth.users order by created_at limit 1;"
$rows = @($u.text | ConvertFrom-Json)
if ($rows.Count -gt 0) {
  $a = Sql ("insert into public.system_admins (user_id) values ('" + $rows[0].id + "') on conflict (user_id) do nothing;")
  if ($a.ok) { Write-Host ("System admin set: {0}" -f $rows[0].email) } else { Write-Host ("Set-admin failed :: {0}" -f $a.text) }
} else { Write-Host 'No auth users found to promote.' }
$v = Sql "select (select count(*) from public.system_admins) as admins, (select count(*) from public.support_cases) as cases, (select subscription_status from public.tenants limit 1) as sample_status;"
Write-Host ("Verify: {0}" -f $v.text)
Write-Host 'ADMIN SETUP DONE'
