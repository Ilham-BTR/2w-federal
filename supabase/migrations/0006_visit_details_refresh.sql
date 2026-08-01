-- ============================================================
-- Refresh view visit_details agar memuat kolom pengecekan.
-- ============================================================
-- View dibuat dengan `select v.*` SEBELUM kolom check_* ada. Di PostgreSQL
-- daftar kolom view dibekukan saat dibuat, jadi kolom baru tidak ikut muncul
-- (app membaca visit_details -> status pengecekan selalu tampak kosong).
-- CREATE OR REPLACE tidak cukup karena kolom baru menyisip di tengah -> DROP dulu.
-- ============================================================

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
