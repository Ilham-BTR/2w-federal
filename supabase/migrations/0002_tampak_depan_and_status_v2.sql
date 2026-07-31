-- ============================================================
-- Migration 0002 — Foto Tampak Depan + Visit Status v2
-- ============================================================
-- Perubahan:
--   1. Tambah kolom `photo_tampak_depan` di tabel visits
--   2. Update enum `visit_status` jadi:
--      Pemasangan, Revisit, Maintenance, Delivery Gimmic
--      (sebelumnya: Terpasang, Pending, Rusak)
--   3. Re-create view yang depend ke enum
--
-- Mapping data lama → baru:
--   Terpasang → Pemasangan
--   Pending   → Maintenance
--   Rusak     → Maintenance
-- ============================================================

-- 1. Kolom Foto Tampak Depan ----------------------------------
alter table visits add column if not exists photo_tampak_depan text;

-- 2. Swap enum visit_status -----------------------------------
-- Drop view yang reference kolom status (akan dibuat ulang di step 3)
drop view if exists md_monthly_performance cascade;
drop view if exists visit_details cascade;

-- Pindahkan kolom sementara ke text agar bisa ganti type
alter table visits alter column status drop default;
alter table visits alter column status type text;

-- Map nilai legacy ke nilai baru
update visits set status = 'Pemasangan'  where status = 'Terpasang';
update visits set status = 'Maintenance' where status in ('Pending', 'Rusak');

-- Re-create enum
drop type if exists visit_status;
create type visit_status as enum ('Pemasangan', 'Revisit', 'Maintenance', 'Delivery Gimmic');

alter table visits alter column status type visit_status using status::visit_status;
alter table visits alter column status set default 'Pemasangan';

-- 3. Re-create views ------------------------------------------
create or replace view visit_details as
select
  v.*,
  p.full_name as md_name,
  p.email as md_email,
  b.code as bengkel_code,
  b.name as bengkel_name,
  k.name as kota_name,
  r.name as region_name,
  d.name as distributor_name
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id
left join distributors d on d.id = v.distributor_id;

create or replace view md_monthly_performance as
select
  p.id as md_id,
  p.full_name as md_name,
  p.monthly_target,
  date_trunc('month', v.visit_date)::date as month,
  count(*) as visits_actual,
  count(*) filter (where v.status = 'Pemasangan')       as visits_pemasangan,
  count(*) filter (where v.status = 'Revisit')          as visits_revisit,
  count(*) filter (where v.status = 'Maintenance')      as visits_maintenance,
  count(*) filter (where v.status = 'Delivery Gimmic')  as visits_delivery_gimmic,
  round(100.0 * count(*) / nullif(p.monthly_target, 0), 1) as achievement_pct
from profiles p
left join visits v on v.md_id = p.id
where p.role = 'md'
group by p.id, p.full_name, p.monthly_target, date_trunc('month', v.visit_date);
