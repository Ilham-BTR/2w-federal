# Backup Otomatis Database Supabase (Node — tanpa install)

Backup berkala seluruh **data** app ke file JSON di komputermu — **gratis**, menutup
kelemahan utama Supabase Free (tidak ada backup otomatis).

Dijalankan pakai **Node** (`node ops/backup/backup.mjs`) + library `@supabase/supabase-js`
yang **sudah jadi dependency app** — jadi **tanpa Docker, tanpa install PostgreSQL,
tanpa install apa pun**.

> **Schema tersimpan di Git** (`supabase/migrations/` + `supabase/setup_fresh.sql`),
> **data tersimpan di backup JSON ini**. Dua-duanya digabung = pemulihan lengkap.

## Apa yang di-backup
Semua tabel data: `regions, distributors, kotas, bengkels, profiles, visits,
attendances, tl_regions` — **plus daftar akun auth** (email + metadata) lewat
service_role key. Password login MD tetap ikut karena tersimpan di `profiles.login_password`.

## Setup (sekali)

1. **Isi konfigurasi:**
   ```powershell
   cd ops\backup
   Copy-Item backup.config.example.json backup.config.json
   ```
   Buka `backup.config.json`, isi:
   - `supabaseUrl` & `serviceRoleKey` → dari **Supabase Dashboard → Project Settings → API**.
     **Pakai `service_role` key** (yang rahasia, bukan `anon`) supaya bisa baca semua data + akun.
   - `keepLast` → berapa file backup terakhir disimpan (default 12).
   - `backupDir` (opsional) → folder Google Drive/OneDrive tersinkron untuk salinan **off-site**.

   File `backup.config.json` **sudah di-gitignore** — aman, tak akan ke-commit.

2. **Tes manual:**
   ```powershell
   node backup.mjs
   ```
   Berhasil → muncul file `dumps\supabase_backup_<tanggal>.json` + baris `OK: ... MB`
   di layar & `backup.log`, beserta jumlah baris tiap tabel.

3. **Aktifkan jadwal mingguan** (Senin 02:00):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\register-task.ps1
   ```
   Ubah hari/jam → edit baris `New-ScheduledTaskTrigger`, jalankan lagi (pakai `-Force`).

## Memulihkan data (restore)

**Kasus umum — ada data kepencet hapus / keubah, project masih ada:**
```powershell
cd ops\backup
node restore.mjs dumps\supabase_backup_<tanggal>.json            # restore semua tabel
node restore.mjs dumps\supabase_backup_<tanggal>.json --only=visits,attendances   # sebagian
node restore.mjs dumps\supabase_backup_<tanggal>.json --dry-run  # lihat dulu, tak menulis
```
Restore = **upsert by primary key** dalam urutan FK-aman (parent dulu). Baris yang
hilang dibuat lagi, baris yang ada ditimpa dengan isi backup. Aman diulang.

**Pemulihan total — project hilang/terhapus (rebuild dari nol):**
1. Buat project Supabase baru → jalankan schema: `supabase/setup_fresh.sql`
   (atau migrasi `0001`–`0014`) di SQL Editor.
2. **Buat ulang akun** dari backup: untuk tiap akun di `tables.profiles`, buat user
   via fungsi `admin-create-md` / Auth Admin API memakai `email` + `login_password`.
   > Catatan: user baru dapat **UUID baru**. Karena `profiles.id` = id auth, langkah 3
   > perlu memetakan ulang id (match by email) sebelum restore `visits/attendances`.
   > Untuk skala kecil ini paling mudah dibantu manual/skrip sekali pakai — minta bantuan
   > kalau skenario ini benar-benar terjadi.
3. Isi `backup.config.json` dengan URL+key project baru → `node restore.mjs <file>`.

## Cek & perawatan
- **Log:** `ops\backup\backup.log` (tiap run: OK/GAGAL + ukuran + jumlah baris).
- **Hasil:** `ops\backup\dumps\` — otomatis simpan `keepLast` file terbaru.
- **Status task:** `Get-ScheduledTask -TaskName "Supabase Backup Mobil1"`
- **Jalankan task sekarang:** `Start-ScheduledTask -TaskName "Supabase Backup Mobil1"`
- **Hapus jadwal:** `Unregister-ScheduledTask -TaskName "Supabase Backup Mobil1" -Confirm:$false`

## Catatan
- `backup.config.json` (berisi service_role key) + folder `dumps/` + `backup.log`
  **tidak** ikut ke Git (lihat `.gitignore`). Yang di-repo cuma script + contoh config.
- **service_role key itu sangat rahasia** (bypass semua RLS). Simpan hanya di file config
  lokal ini; jangan kirim ke siapa pun / jangan commit.
