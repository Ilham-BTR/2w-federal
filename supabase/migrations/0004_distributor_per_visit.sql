-- ============================================================
-- Migration 0004 — Distributor pindah dari Bengkel ke Visit
-- ============================================================
-- Alasan: 1 bengkel bisa dilayani > 1 distributor. Distributor
-- bukan properti tetap bengkel, melainkan dicatat per kunjungan
-- (MD pilih distributor saat visit).
--
-- Perubahan:
--   1. Tambah kolom visits.distributor_id
--   2. Backfill: isi visits.distributor_id dari distributor bengkel
--      yang lama (biar data historis gak hilang)
--   3. Drop kolom bengkels.distributor_id
--   4. Re-create view visit_details (distributor dari visit)
-- ============================================================

-- 1. Kolom distributor di visits
alter table visits add column if not exists distributor_id uuid references distributors(id) on delete set null;
create index if not exists visits_distributor_idx on visits(distributor_id);

-- 2. Backfill dari bengkel (sebelum kolom bengkel di-drop)
update visits v
  set distributor_id = b.distributor_id
  from bengkels b
  where v.bengkel_id = b.id
    and v.distributor_id is null
    and b.distributor_id is not null;

-- 3. Drop distributor dari bengkels
drop index if exists bengkels_distributor_idx;
alter table bengkels drop column if exists distributor_id;

-- 4. Re-create view: distributor sekarang dari visits, bukan bengkels
drop view if exists md_monthly_performance cascade;
drop view if exists visit_details cascade;

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
left join distributors d on d.id = v.distributor_id;   -- ← dari visit, bukan bengkel

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
