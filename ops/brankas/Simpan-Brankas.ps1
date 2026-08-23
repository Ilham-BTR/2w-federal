<#
  Kumpulkan berkas kredensial 2W Federal jadi SATU file terenkripsi di OneDrive.

  Pakai:  .\ops\brankas\Simpan-Brankas.ps1
  Lalu ketik password (tidak tampil di layar, tidak tersimpan di mana pun).

  Berkas terbuka TIDAK PERNAH ditulis ke disk — semua dirakit di memori,
  yang mendarat di OneDrive hanya file terenkripsi.

  Mau menambah rahasia lain (mis. kunci R2/B2 yang disalin dari dashboard)?
  Taruh filenya di ops/brankas/tambahan/ — isinya ikut terbawa. Folder itu
  diabaikan git supaya tidak pernah naik ke repo.
#>
[CmdletBinding()]
param(
  [string]$TujuanFolder = "$env:USERPROFILE\OneDrive\Backup App\Backup-2W Federal",
  # Biasanya dikosongkan supaya diminta lewat prompt. Diisi hanya untuk
  # pengujian otomatis — Read-Host -AsSecureString membaca langsung dari
  # konsol, jadi tak bisa disuapi lewat pipe.
  [securestring]$Password
)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Brankas.psm1" -Force
# Windows PowerShell 5.1 tidak memuat pustaka ZIP sendiri — tanpa ini
# [IO.Compression.ZipArchive] tidak dikenali.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$akar = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Berkas yang dicari. Yang tidak ada dilewati tanpa menggagalkan proses.
$daftar = @(
  '.env.local'
  '.supabase-db-password.txt'
  '.admin-credentials.txt'
  'ops/backup/backup.config.json'
  'wrangler.toml'
)

$catatan = @"
BRANKAS KREDENSIAL — 2W Federal POSM Tracker
Dibuat: $(Get-Date -Format 'yyyy-MM-dd HH:mm')

CARA MEMBUKA
  1. Ambil repo:  git clone https://github.com/Ilham-BTR/2w-federal.git
  2. Jalankan  :  .\ops\brankas\Buka-Brankas.ps1 -File <file .brankas ini>
  3. Masukkan password yang dipakai saat menyimpan.

AKUN INDUK (ini yang paling penting — kunci di bawah bisa dibuat ulang,
akses akun tidak)
  Supabase & Cloudflare : ilhambhatara97@gmail.com
  Organisasi Supabase   : Activate Asia
  Project Cloudflare    : 2w-federal (Pages) + bucket R2 federal-2w-posm-photos

YANG TIDAK ADA DI SINI — harus disalin manual dari dashboard
  Secret Edge Function get-upload-url (Supabase → Edge Functions → Secrets):
    B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION, CDN_BASE_URL
  Simpan salinannya di ops/brankas/tambahan/ lalu jalankan ulang skrip ini.

MEMBANGUN ULANG DARI NOL
  1. Jalankan supabase/migrations/ berurutan dari 0001 (JANGAN setup_fresh.sql)
  2. Pulihkan data       : node ops/backup/restore.mjs <file backup .json>
  3. Isi ulang .env.local dari brankas ini, lalu: npm install && npm run build
  4. Deploy              : npx wrangler pages deploy dist --project-name=2w-federal
"@

# Rakit ZIP di memori
$mem = New-Object IO.MemoryStream
$zip = New-Object IO.Compression.ZipArchive($mem, [IO.Compression.ZipArchiveMode]::Create, $true)
$masuk = @()

function Tambah($namaDiZip, [byte[]]$isi) {
  $e = $zip.CreateEntry($namaDiZip)
  $s = $e.Open(); try { $s.Write($isi, 0, $isi.Length) } finally { $s.Dispose() }
}

Tambah 'CATATAN.txt' ([Text.Encoding]::UTF8.GetBytes($catatan))

foreach ($rel in $daftar) {
  $p = Join-Path $akar $rel
  if (Test-Path $p) { Tambah $rel ([IO.File]::ReadAllBytes($p)); $masuk += $rel }
  else { Write-Host "  dilewati (tidak ada): $rel" -ForegroundColor DarkGray }
}

$extra = Join-Path $PSScriptRoot 'tambahan'
if (Test-Path $extra) {
  Get-ChildItem $extra -File -Recurse | ForEach-Object {
    $n = 'tambahan/' + $_.FullName.Substring($extra.Length).TrimStart('\','/').Replace('\','/')
    Tambah $n ([IO.File]::ReadAllBytes($_.FullName)); $masuk += $n
  }
}

$zip.Dispose()
$data = $mem.ToArray(); $mem.Dispose()

if ($masuk.Count -eq 0) { throw 'Tidak ada berkas kredensial yang ditemukan.' }
Write-Host "`nMasuk brankas ($($masuk.Count) berkas):" -ForegroundColor Cyan
$masuk | ForEach-Object { Write-Host "  - $_" }

if ($Password) {
  $p1 = $Password
  $c1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
} else {
  Write-Host "`nPassword ini TIDAK bisa dipulihkan kalau lupa. Simpan di password manager." -ForegroundColor Yellow
  $p1 = Read-Host 'Password brankas' -AsSecureString
  $p2 = Read-Host 'Ulangi password'  -AsSecureString
  $c1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
  $c2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
  if ($c1 -ne $c2) { throw 'Password tidak sama. Tidak ada yang disimpan.' }
  $c2 = $null
}
if ($c1.Length -lt 12) { throw 'Password minimal 12 karakter. Tidak ada yang disimpan.' }
$c1 = $null

if (-not (Test-Path $TujuanFolder)) { New-Item -ItemType Directory -Path $TujuanFolder -Force | Out-Null }
$out = Join-Path $TujuanFolder ('kredensial-2w-federal_' + (Get-Date -Format 'yyyy-MM-dd') + '.brankas')
Protect-Brankas -Data $data -Password $p1 -OutFile $out

# Bersihkan salinan terbuka dari memori proses ini
[Array]::Clear($data, 0, $data.Length)

Write-Host "`nTersimpan: $out" -ForegroundColor Green
Write-Host ("Ukuran   : {0:N1} KB" -f ((Get-Item $out).Length / 1KB))
Write-Host "`nUji buka sekarang juga supaya yakin passwordnya benar:" -ForegroundColor Cyan
Write-Host "  .\ops\brankas\Buka-Brankas.ps1 -File `"$out`" -HanyaLihat"
