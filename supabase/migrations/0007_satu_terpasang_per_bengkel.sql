-- ============================================================
-- 2W Federal MD — 1 BENGKEL HANYA BOLEH 1x "Spanduk Terpasang"
-- ============================================================
-- Aturan bisnis: kalau sebuah bengkel sudah berhasil dipasangi spanduk,
-- MD mana pun (termasuk MD yang sama) TIDAK boleh submit bengkel itu lagi.
-- Hasil visit selain "Spanduk Terpasang" tetap boleh berulang kali,
-- oleh MD yang sama maupun MD lain.
--
-- Dipaksakan di level DB dengan partial unique index -> aman dari race
-- condition (2 MD submit bersamaan) meski UI sudah memblokir lebih dulu.
-- ============================================================

create unique index if not exists visits_one_terpasang_per_bengkel
  on visits (bengkel_id)
  where status = 'Spanduk Terpasang';

-- View ringan: daftar bengkel yang SUDAH terpasang.
-- Hanya memuat bengkel_id (tak membocorkan MD/visit siapa pun), supaya MD bisa
-- tahu bengkel mana yang sudah selesai walau RLS visits membatasi ke datanya sendiri.
create or replace view bengkels_terpasang as
  select distinct bengkel_id from visits where status = 'Spanduk Terpasang';

grant select on bengkels_terpasang to authenticated;
