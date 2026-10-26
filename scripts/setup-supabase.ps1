# SimpleHotelier — one-time Supabase setup via Management API.
# Reads secrets from .env (never prints them). Run from workspace root:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-supabase.ps1
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root '.env'))) { $root = (Get-Location).Path }

# ---- load .env (values stay in variables, never echoed) ----
$envMap = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
  $l = $_.Trim()
  if ($l -and -not $l.StartsWith('#') -and $l.Contains('=')) {
    $kv = $l -split '=', 2
    $envMap[$kv[0].Trim()] = $kv[1].Trim().Trim('"').Trim("'")
  }
}
$token = $envMap['SUPABASE_TOKEN']
$url   = $envMap['NEXT_PUBLIC_SUPABASE_URL']
$anon  = $envMap['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
if (-not $token -or -not $url -or -not $anon) { Write-Host 'SETUP ABORT: .env must contain SUPABASE_TOKEN, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'; exit 1 }
if ($token.StartsWith('sbp_')) { Write-Host 'Token type: personal access token (ok)' } else { Write-Host 'Token type: unrecognized prefix (will try anyway)' }
$ref = $null
if ($url -match 'https://([a-z0-9]+)\.supabase\.co') { $ref = $Matches[1] }
if (-not $ref) { Write-Host 'SETUP ABORT: could not derive project ref from URL'; exit 1 }
Write-Host ("Project ref: " + $ref)

$api = 'https://api.supabase.com/v1'
function Mgmt($method, $path, $bodyObj) {
  $headers = @{ Authorization = "Bearer $token" }
  $params = @{ Method = $method; Uri = ($api + $path); Headers = $headers; TimeoutSec = 120; UseBasicParsing = $true }
  if ($bodyObj) { $params['ContentType'] = 'application/json'; $params['Body'] = ($bodyObj | ConvertTo-Json -Depth 4 -Compress) }
  try {
    $r = Invoke-WebRequest @params
    return @{ ok = $true; status = [int]$r.StatusCode; text = $r.Content }
  } catch {
    $code = $null; $txt = $_.ErrorDetails.Message
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if (-not $txt -and $_.Exception.Response) {
      try {
        $s = $_.Exception.Response.GetResponseStream()
        if ($s.CanSeek) { $s.Position = 0 }
        $sr = New-Object IO.StreamReader($s); $txt = $sr.ReadToEnd()
      } catch {}
    }
    if (-not $txt) { $txt = $_.Exception.Message }
    return @{ ok = $false; status = $code; text = $txt }
  }
}
function RunSql($label, $sql) {
  $r = Mgmt 'POST' "/projects/$ref/database/query" @{ query = $sql }
  if ($r.ok) { Write-Host ("SQL [{0}]: OK (HTTP {1})" -f $label, $r.status) }
  else {
    $short = $r.text; if ($short.Length -gt 400) { $short = $short.Substring(0, 400) }
    Write-Host ("SQL [{0}]: HTTP {1} -- {2}" -f $label, $r.status, $short)
  }
  return $r
}

# ---- 1. reachability ----
$proj = Mgmt 'GET' "/projects/$ref" $null
if ($proj.ok) {
  try { $pj = $proj.text | ConvertFrom-Json; Write-Host ("Project: {0} | status: {1} | region: {2}" -f $pj.name, $pj.status, $pj.region) } catch { Write-Host 'Project: reachable' }
} else {
  Write-Host ("Project check failed: HTTP {0}. Check SUPABASE_TOKEN / project ref." -f $proj.status); exit 1
}

# ---- 2. migration + seed (chunked: the API rejects very large single queries) ----
function RunSqlFile($label, $path) {
  $text = Get-Content $path -Raw -Encoding UTF8
  $chunks = @($text -split '(?m)^-- @@CHUNK@@.*$' | Where-Object { $_.Trim() })
  $i = 0
  foreach ($c in $chunks) {
    $i++
    $r = RunSql ("{0} {1}/{2}" -f $label, $i, $chunks.Count) $c
    if (-not $r.ok) { Write-Host ("ABORT in {0} chunk {1} - fix and re-run" -f $label, $i); exit 1 }
  }
}
RunSqlFile 'migration' (Join-Path $root 'supabase/migrations/20261026000000_init.sql')
RunSqlFile 'seed' (Join-Path $root 'supabase/seed.sql')

# ---- 3. verify + claim tenant for first auth user (if any) ----
$check = RunSql 'verify-counts' "select (select count(*) from public.tenants) as tenants, (select count(*) from public.rooms) as rooms, (select count(*) from public.reservations) as reservations, (select count(*) from pg_constraint where conname like '%exclude%' or contype='x') as exclusion_constraints;"
$users = Mgmt 'POST' "/projects/$ref/database/query" @{ query = "select id::text as id, coalesce(email,'(no email)') as email from auth.users order by created_at limit 5;" }
if ($users.ok) {
  try {
    $rows = $users.text | ConvertFrom-Json
    if ($rows.Count -gt 0) {
      $uid = $rows[0].id; $em = $rows[0].email
      Write-Host ("Auth user found: {0} (claiming Pinecrest for this user)" -f $em)
      $null = RunSql 'claim-tenant' "insert into public.tenant_members (tenant_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', '$uid', 'owner') on conflict (tenant_id, user_id) do update set role='owner';"
    } else {
      Write-Host 'No auth users yet: create one in Auth -> Users, then re-run this script to claim the tenant.'
    }
  } catch { Write-Host 'Auth user check: could not parse response (continuing)' }
}

# ---- 4. write frontend config (anon/publishable key only) ----
$cfg = "// SimpleHotelier - browser config (auto-written by scripts/setup-supabase.ps1).`n// The publishable key is safe to ship; RLS protects data. Never add service keys here.`nwindow.SH_CONFIG = {`n  SUPABASE_URL: `"$url`",`n  SUPABASE_ANON_KEY: `"$anon`",`n  TENANT_SLUG: `"pinecrest`"`n};`n"
[IO.File]::WriteAllText((Join-Path $root 'js/config.js'), $cfg, (New-Object Text.UTF8Encoding($false)))
Write-Host 'js/config.js written (URL + publishable key, tenant slug: pinecrest)'

# ---- 5. verify public REST reads with the publishable key ----
try {
  $h = @{ apikey = $anon; Authorization = "Bearer $anon" }
  $t = Invoke-RestMethod -Uri ($url + '/rest/v1/tenants?slug=eq.pinecrest&select=name,slug') -Headers $h -TimeoutSec 60
  $rm = Invoke-RestMethod -Uri ($url + '/rest/v1/rooms?select=code&order=sort_order.asc') -Headers $h -TimeoutSec 60
  Write-Host ("REST check: tenant='{0}' rooms visible={1}" -f $t[0].name, $rm.Count)
} catch { Write-Host ("REST check failed: {0}" -f $_.Exception.Message) }

Write-Host 'SETUP DONE'
