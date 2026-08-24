-- ============================================================
-- 2W Federal — KOLOM RINGKAS FOTO DI visit_details
-- ============================================================
-- Setelah URL foto tak lagi ikut di tarikan daftar, dua agregasi in-memory
-- yang dulu membaca kolom foto jadi ikut kehilangan sumbernya:
--   - Laporan Banner/Poster: cek photo_spanduk_*/photo_poster ada atau tidak
--   - Notifikasi MD "foto tidak sesuai": hitung photo_checks bernilai 'bad'
-- Ketiga kolom ringkas ini menggantikannya dengan beberapa byte, bukan URL.
-- CREATE OR REPLACE menambah kolom di akhir — aman, tak mengubah yang lain.
-- ============================================================

create or replace view visit_details as
select v.id, v.md_id, v.bengkel_id, v.visit_date, v.status, v.remarks,
  v.visit_lat, v.visit_lng,
  v.photo_selfie, v.photo_before, v.photo_after,
  v.photo_spanduk_jauh, v.photo_spanduk_sedang, v.photo_poster,
  v.created_at, v.updated_at, v.photo_checks, v.check_status, v.check_remarks,
  v.checked_by, v.checked_at, v.owner_name, v.owner_phone, v.spanduk_size,
  v.planogram_allowed, v.photo_selfie_pic, v.photo_planogram_before, v.photo_planogram_after,
  p.full_name as md_name, p.email as md_email,
  b.code as bengkel_code, b.name as bengkel_name,
  k.name as kota_name, r.name as region_name,
  c.full_name as checked_by_name,
  (
    (v.photo_selfie is not null)::int + (v.photo_before is not null)::int +
    (v.photo_after is not null)::int + (v.photo_selfie_pic is not null)::int +
    (v.photo_spanduk_jauh is not null)::int + (v.photo_spanduk_sedang is not null)::int +
    (v.photo_poster is not null)::int + (v.photo_planogram_before is not null)::int +
    (v.photo_planogram_after is not null)::int
  ) as photo_count,
  (v.photo_spanduk_jauh is not null or v.photo_spanduk_sedang is not null) as has_spanduk,
  (v.photo_poster is not null) as has_poster,
  (select count(*) from jsonb_each_text(coalesce(v.photo_checks, '{}'::jsonb)) where value = 'bad')::int as bad_photo_count
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id
left join profiles c on c.id = v.checked_by;
