# SimpleHotelier - claim the Pinecrest tenant for your auth user.
# Run AFTER creating a user in Supabase Auth -> Users:
#   powershell -ExecutionPolicy Bypass -File scripts/claim-tenant.ps1
# Optional: -Email you@example.com to claim for a specific user (default: first user).
param([string]$Email = '')
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
$where = ''
if ($Email) { $where = "where email = '" + $Email.Replace("'", "''") + "'" }
$u = Sql "select id::text as id, coalesce(email,'(no email)') as email from auth.users $where order by created_at limit 1;"
if (-not $u.ok) { Write-Host ("User lookup failed: {0}" -f $u.text); exit 1 }
$rows = @($u.text | ConvertFrom-Json)
if ($rows.Count -eq 0) { Write-Host 'No matching auth user. Create one in Supabase Auth -> Users first.'; exit 1 }
$uid = $rows[0].id
Write-Host ("Claiming Pinecrest Cabins for: {0}" -f $rows[0].email)
$c = Sql "insert into public.tenant_members (tenant_id, user_id, role) values ('11111111-1111-1111-1111-111111111111', '$uid', 'owner') on conflict (tenant_id, user_id) do update set role='owner';"
if ($c.ok) { Write-Host 'Tenant claimed: role=owner' } else { Write-Host ("Claim failed: {0}" -f $c.text); exit 1 }
$v = Sql "select t.name as tenant, m.role from public.tenant_members m join public.tenants t on t.id = m.tenant_id where m.user_id = '$uid';"
if ($v.ok) { Write-Host ("Membership now: {0}" -f $v.text) }
Write-Host 'CLAIM DONE - you can now revoke SUPABASE_TOKEN (Account -> Access Tokens).'
