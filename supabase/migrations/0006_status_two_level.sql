-- ============================================================
-- Migration 0006 — Status 2-tingkat (status induk + sub_type)
-- ============================================================
-- status (induk): Pemasangan | Revisit
-- sub_type (anak, text):
--   Pemasangan → Deploy POSM New | Replace POSM Old
--   Revisit    → Maintenance | Delivery Gimmick
--
-- Mapping data lama (status 4 nilai → status 2 + sub_type):
--   Pemasangan      → Pemasangan + 'Deploy POSM New'
--   Revisit         → Revisit + 'Maintenance'
--   Maintenance     → Revisit + 'Maintenance'
--   Delivery Gimmic → Revisit + 'Delivery Gimmick'
-- ============================================================

-- 1. Tambah kolom sub_type
alter table visits add column if not exists sub_type text;

-- 2. Backfill sub_type dari status lama
update visits set sub_type = case
  when status::text = 'Pemasangan'      then 'Deploy POSM New'
  when status::text = 'Maintenance'     then 'Maintenance'
  when status::text = 'Delivery Gimmic' then 'Delivery Gimmick'
  when status::text = 'Revisit'         then 'Maintenance'
  else sub_type
end
where sub_type is null;

-- 3. Drop views yang depend ke status
drop view if exists md_monthly_performance cascade;
drop view if exists visit_details cascade;

-- 4. Recreate enum visit_status jadi 2 nilai
alter table visits alter column status drop default;
alter table visits alter column status type text;
update visits set status = 'Revisit' where status in ('Maintenance', 'Delivery Gimmic');
drop type if exists visit_status;
create type visit_status as enum ('Pemasangan', 'Revisit');
alter table visits alter column status type visit_status using status::visit_status;
alter table visits alter column status set default 'Pemasangan';

-- 5. Recreate views
create or replace view visit_details as
select v.*, p.full_name as md_name, p.email as md_email,
  b.code as bengkel_code, b.name as bengkel_name,
  k.name as kota_name, r.name as region_name, d.name as distributor_name
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id
left join distributors d on d.id = v.distributor_id;

create or replace view md_monthly_performance as
select p.id as md_id, p.full_name as md_name, p.monthly_target,
  date_trunc('month', v.visit_date)::date as month,
  count(*) as visits_actual,
  count(*) filter (where v.status = 'Pemasangan') as visits_pemasangan,
  count(*) filter (where v.status = 'Revisit')    as visits_revisit,
  count(*) filter (where v.sub_type = 'Deploy POSM New')   as sub_deploy_new,
  count(*) filter (where v.sub_type = 'Replace POSM Old')  as sub_replace_old,
  count(*) filter (where v.sub_type = 'Maintenance')       as sub_maintenance,
  count(*) filter (where v.sub_type = 'Delivery Gimmick')  as sub_gimmick,
  round(100.0 * count(*) / nullif(p.monthly_target, 0), 1) as achievement_pct
from profiles p
left join visits v on v.md_id = p.id
where p.role = 'md'
group by p.id, p.full_name, p.monthly_target, date_trunc('month', v.visit_date);
