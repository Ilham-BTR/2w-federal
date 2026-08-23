# ops/brankas/Brankas.psm1
# Enkripsi/dekripsi berkas kredensial dengan AES-256.
#
# Rancangan (sengaja sederhana supaya masih bisa dibuka bertahun-tahun lagi
# hanya dengan Windows bawaan, tanpa perlu memasang 7-Zip/gpg):
#   kunci   : PBKDF2-SHA256, 200.000 putaran, salt acak 16 byte
#   isi     : AES-256-CBC, IV acak 16 byte
#   keutuhan: HMAC-SHA256 dihitung SETELAH enkripsi (encrypt-then-MAC),
#             jadi file yang rusak atau diubah ketahuan sebelum didekripsi
#   susunan : "BRK1" | salt(16) | iv(16) | ciphertext | hmac(32)
#
# Password tidak pernah tersimpan di mana pun — hanya ada di memori saat jalan.

$MAGIC = [byte[]][char[]]'BRK1'

function Get-BrankasKeys([securestring]$Password, [byte[]]$Salt) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  try { $teks = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes(
    $teks, $Salt, 200000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { @{ Enc = $kdf.GetBytes(32); Mac = $kdf.GetBytes(32) } } finally { $kdf.Dispose() }
}

function Protect-Brankas {
  param([Parameter(Mandatory)][byte[]]$Data,
        [Parameter(Mandatory)][securestring]$Password,
        [Parameter(Mandatory)][string]$OutFile)

  $salt = New-Object byte[] 16; $iv = New-Object byte[] 16
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($salt); $rng.GetBytes($iv)

  $k = Get-BrankasKeys $Password $salt
  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256; $aes.Key = $k.Enc; $aes.IV = $iv
  $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
  try { $cipher = $aes.CreateEncryptor().TransformFinalBlock($Data, 0, $Data.Length) }
  finally { $aes.Dispose() }

  $hmac = New-Object Security.Cryptography.HMACSHA256(,$k.Mac)
  $tag = $hmac.ComputeHash($($MAGIC + $salt + $iv + $cipher))
  [IO.File]::WriteAllBytes($OutFile, $($MAGIC + $salt + $iv + $cipher + $tag))
}

function Unprotect-Brankas {
  param([Parameter(Mandatory)][string]$InFile,
        [Parameter(Mandatory)][securestring]$Password)

  $raw = [IO.File]::ReadAllBytes($InFile)
  if ($raw.Length -lt 68) { throw 'File brankas rusak (terlalu pendek).' }
  if ([Text.Encoding]::ASCII.GetString($raw[0..3]) -ne 'BRK1') { throw 'Ini bukan file brankas.' }

  $salt = $raw[4..19]; $iv = $raw[20..35]
  $cipher = $raw[36..($raw.Length-33)]
  $tag = $raw[($raw.Length-32)..($raw.Length-1)]

  $k = Get-BrankasKeys $Password $salt
  $hmac = New-Object Security.Cryptography.HMACSHA256(,$k.Mac)
  $harap = $hmac.ComputeHash($($MAGIC + $salt + $iv + $cipher))
  # Bandingkan tanpa berhenti di byte pertama yang beda (hindari timing attack)
  $beda = 0; for ($i=0; $i -lt 32; $i++) { $beda = $beda -bor ($harap[$i] -bxor $tag[$i]) }
  if ($beda -ne 0) { throw 'Password salah, atau file sudah berubah/rusak.' }

  $aes = [Security.Cryptography.Aes]::Create()
  $aes.KeySize = 256; $aes.Key = $k.Enc; $aes.IV = $iv
  $aes.Mode = 'CBC'; $aes.Padding = 'PKCS7'
  try { $aes.CreateDecryptor().TransformFinalBlock($cipher, 0, $cipher.Length) }
  finally { $aes.Dispose() }
}

Export-ModuleMember -Function Protect-Brankas, Unprotect-Brankas
