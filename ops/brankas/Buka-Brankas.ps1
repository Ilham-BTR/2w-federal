<#
  Buka file .brankas.

  Lihat isinya saja (tidak menulis apa pun ke disk):
    .\ops\brankas\Buka-Brankas.ps1 -File <path> -HanyaLihat

  Keluarkan isinya ke sebuah folder:
    .\ops\brankas\Buka-Brankas.ps1 -File <path> -Tujuan C:\pulih

  Keluarkan HANYA ke folder kosong/baru, jangan langsung ke folder project —
  supaya .env.local yang sedang dipakai tidak tertimpa tanpa sengaja.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$File,
  [string]$Tujuan,
  [switch]$HanyaLihat,
  [securestring]$Password   # kosongkan; diisi hanya untuk pengujian otomatis
)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Brankas.psm1" -Force
# Windows PowerShell 5.1 tidak memuat pustaka ZIP sendiri — tanpa ini
# [IO.Compression.ZipArchive] tidak dikenali.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (-not (Test-Path $File)) { throw "File tidak ditemukan: $File" }
if (-not $HanyaLihat -and -not $Tujuan) { throw 'Pilih salah satu: -HanyaLihat atau -Tujuan <folder>.' }

$pw = if ($Password) { $Password } else { Read-Host 'Password brankas' -AsSecureString }
$data = Unprotect-Brankas -InFile $File -Password $pw   # gagal di sini = password salah

$mem = New-Object IO.MemoryStream(,$data)
$zip = New-Object IO.Compression.ZipArchive($mem, [IO.Compression.ZipArchiveMode]::Read)

if ($HanyaLihat) {
  Write-Host "`nIsi brankas:" -ForegroundColor Cyan
  $zip.Entries | ForEach-Object { Write-Host ("  {0,-40} {1,8:N0} byte" -f $_.FullName, $_.Length) }
  $c = $zip.GetEntry('CATATAN.txt')
  if ($c) {
    $sr = New-Object IO.StreamReader($c.Open())
    Write-Host "`n--- CATATAN.txt ---" -ForegroundColor Cyan
    Write-Host $sr.ReadToEnd(); $sr.Dispose()
  }
  Write-Host 'Password benar, file utuh. Tidak ada yang ditulis ke disk.' -ForegroundColor Green
} else {
  if (-not (Test-Path $Tujuan)) { New-Item -ItemType Directory -Path $Tujuan -Force | Out-Null }
  elseif ((Get-ChildItem $Tujuan -Force | Measure-Object).Count -gt 0) {
    throw "Folder tujuan tidak kosong: $Tujuan — pakai folder baru supaya tak ada yang tertimpa."
  }
  foreach ($e in $zip.Entries) {
    $t = Join-Path $Tujuan $e.FullName
    New-Item -ItemType Directory -Path (Split-Path $t -Parent) -Force | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $t, $true)
    Write-Host "  dipulihkan: $($e.FullName)"
  }
  Write-Host "`nSelesai di: $Tujuan" -ForegroundColor Green
  Write-Host 'Isinya rahasia dalam bentuk terbuka — hapus folder ini setelah dipakai.' -ForegroundColor Yellow
}

$zip.Dispose(); $mem.Dispose()
[Array]::Clear($data, 0, $data.Length)
