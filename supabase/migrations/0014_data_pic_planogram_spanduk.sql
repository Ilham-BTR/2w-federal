-- ============================================================
-- 2W Federal MD — TAMBAHAN FORM: DATA PIC, PLANOGRAM, UKURAN SPANDUK
-- ============================================================
-- Semua kolom di bawah diisi MD saat hasil visit "Berhasil Pasang".
-- Sengaja disimpan di VISITS (bukan bengkels): yang ditemui MD bisa berbeda
-- tiap kunjungan, jadi ini catatan siapa yang ditemui saat itu.
-- ============================================================

alter table visits add column if not exists owner_name  text;   -- nama Owner/PIC yang ditemui
alter table visits add column if not exists owner_phone text;   -- no telp Owner/PIC
alter table visits add column if not exists spanduk_size text;  -- rekomendasi ukuran spanduk

-- Planogram: null = tidak ditanyakan (hasil visit selain Berhasil Pasang)
alter table visits add column if not exists planogram_allowed boolean;

-- Foto tambahan
alter table visits add column if not exists photo_selfie_pic        text;  -- selfie MD bersama Owner/PIC
alter table visits add column if not exists photo_planogram_before  text;
alter table visits add column if not exists photo_planogram_after   text;

-- View visit_details memakai `select *` yang membekukan daftar kolom saat
-- dibuat, jadi harus dibuat ulang supaya kolom baru ikut terbaca aplikasi.
-- Definisi disalin PERSIS dari migrasi 0006 (termasuk checked_by_name) —
-- yang berubah hanya kolom baru yang ikut terbawa oleh `v.*`.
drop view if exists visit_details;

create view visit_details as
select v.*, p.full_name as md_name, p.email as md_email,
  b.code as bengkel_code, b.name as bengkel_name,
  k.name as kota_name, r.name as region_name,
  c.full_name as checked_by_name
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id
left join profiles c on c.id = v.checked_by;
