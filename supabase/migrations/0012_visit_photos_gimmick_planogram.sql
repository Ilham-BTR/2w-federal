-- ============================================================
-- Migration 0012 — Tambah foto Delivery Gimmick & Deploy Planogram
-- ============================================================
alter table visits add column if not exists photo_delivery_gimmick text;
alter table visits add column if not exists photo_deploy_planogram text;

-- View visit_details pakai v.* yang di-expand saat view dibuat (sebelum kolom
-- ini ada) -> harus DROP + CREATE ulang supaya 2 kolom foto baru ikut, kalau
-- tidak foto Delivery Gimmick & Deploy Planogram tak muncul di app.
drop view if exists visit_details;
create view visit_details as
select v.*, p.full_name as md_name, p.email as md_email,
  b.code as bengkel_code, b.name as bengkel_name,
  k.name as kota_name, r.name as region_name, d.name as distributor_name
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id
left join distributors d on d.id = v.distributor_id;
