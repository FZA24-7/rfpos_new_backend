# Updates the ONLINE (Supabase) database for the Administrator module, then shows who holds the new permissions.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File .\update-supabase.ps1
$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Paste your Supabase DATABASE_URL (with the real password). Nothing is saved' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$url = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim().Trim('"').Trim('<', '>')
if ($url -notmatch '^postgres(ql)?://') { throw 'That is not a postgresql:// URL.' }
if ($url -match '@(localhost|127\.0\.0\.1)') { throw 'That is your LOCAL database. Paste the Supabase URL.' }
$env:DATABASE_URL = $url
$init = '20261010190408_init'
$admin = '20261103120000_administrator'

Write-Host "`n0/3 Looking at what Supabase already contains (read-only)..." -ForegroundColor Cyan
$json = pnpm --silent --filter '@mafk/database' exec node scripts/db-state.mjs
if ($LASTEXITCODE -ne 0) { throw 'Could not connect. Check the URL/password (special characters must be URL-encoded).' }
$state = ($json | Select-Object -Last 1) | ConvertFrom-Json
Write-Host "   migration history: $($state.migrationsTable)   original tables: $($state.core)   administrator tables: $($state.admin)"

if (-not $state.migrationsTable -and $state.core) {
  Write-Host "`nYour Supabase database was created without Prisma's migration history. Recording the original schema as already applied (no SQL is run for this step)..." -ForegroundColor Yellow
  pnpm --filter '@mafk/database' exec prisma migrate resolve --applied $init
  if ($LASTEXITCODE -ne 0) { throw 'Could not record the baseline. Send me a screenshot.' }
  if ($state.admin) {
    pnpm --filter '@mafk/database' exec prisma migrate resolve --applied $admin
    if ($LASTEXITCODE -ne 0) { throw 'Could not record the baseline. Send me a screenshot.' }
  }
}

Write-Host "`n1/3 Applying the Administrator database changes (adds tables only)..." -ForegroundColor Cyan
pnpm db:migrate:deploy
if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Send me a screenshot of the error.' }

Write-Host "`n2/3 Adding the new permissions and giving them to owner roles..." -ForegroundColor Cyan
pnpm db:seed
if ($LASTEXITCODE -ne 0) { throw 'Seed failed. Send me a screenshot of the error.' }

Write-Host "`n3/3 Checking..." -ForegroundColor Cyan
pnpm --filter '@mafk/database' exec node scripts/check-admin.mjs
Write-Host "`nDone. Quit the desktop app completely, reopen it, sign out and sign in. The Administrator tab appears after Analytics." -ForegroundColor Green
