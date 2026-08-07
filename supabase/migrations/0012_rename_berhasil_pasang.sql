-- ============================================================
-- 2W Federal MD — "Spanduk Terpasang" -> "Berhasil Pasang"
-- ============================================================
-- Permintaan AA: istilahnya diganti karena bengkel bisa saja berhasil
-- dikunjungi & dipasangi POSM tanpa spanduk.
--
-- status adalah enum `visit_status`, jadi cukup RENAME VALUE: seluruh baris
-- visits ikut berganti tanpa UPDATE, dan index parsial `visits_one_terpasang_
-- per_bengkel` maupun view `bengkels_terpasang` tetap valid karena keduanya
-- menyimpan referensi ke nilai enum (OID), bukan teksnya.
--
-- Dibungkus pengecekan supaya aman dijalankan ulang, dan supaya database yang
-- dibuat dari setup_fresh.sql versi baru (sudah bernama "Berhasil Pasang")
-- tidak gagal saat migrasi ini ikut dijalankan.
-- ============================================================

do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'visit_status' and e.enumlabel = 'Spanduk Terpasang'
  ) then
    alter type visit_status rename value 'Spanduk Terpasang' to 'Berhasil Pasang';
  end if;
end $$;
