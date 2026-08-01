# ============================================================
# Daftarkan backup HARIAN ke Windows Task Scheduler.
# Menjalankan: node ops\backup\backup.mjs  (tiap hari 23:00).
# Jalankan SEKALI:
#   powershell -ExecutionPolicy Bypass -File .\register-task.ps1
# Backup manual kapan saja:
#   node ops\backup\backup.mjs      (atau: npm run backup)
# ============================================================
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Root "backup.mjs"

# Cari node.exe (Task Scheduler butuh path absolut, bukan dari PATH sesi ini).
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error "node.exe tidak ketemu di PATH. Install Node / buka PowerShell baru."; exit 1 }

$action  = New-ScheduledTaskAction -Execute $node -Argument "`"$Script`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At 11:00pm
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask -TaskName "Supabase Backup 2W Federal" `
  -Action $action -Trigger $trigger -Settings $settings -Force `
  -Description "Backup harian data Supabase 2W Federal (Node -> JSON) ke folder lokal, jam 23:00."

Write-Host "OK. Task 'Supabase Backup 2W Federal' terdaftar -> tiap hari 23:00."
Write-Host "Node: $node"
Write-Host "Jalankan sekarang: Start-ScheduledTask -TaskName 'Supabase Backup 2W Federal'"
