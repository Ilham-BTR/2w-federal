-- ============================================================
-- Migration 0014 — TL bisa cover lebih dari 1 region
-- ============================================================
-- Tabel penghubung TL → banyak region. Backward-compatible: kalau TL
-- belum punya baris di tl_regions, fallback ke profiles.region_id lama.
-- ============================================================

create table if not exists tl_regions (
  tl_id     uuid not null references profiles(id) on delete cascade,
  region_id uuid not null references regions(id)  on delete cascade,
  primary key (tl_id, region_id)
);

alter table tl_regions enable row level security;

-- Super admin kelola penuh; TL/admin boleh baca (TL hanya barisnya sendiri).
drop policy if exists tl_regions_super_manage on tl_regions;
create policy tl_regions_super_manage on tl_regions for all
  using (is_super_admin()) with check (is_super_admin());

drop policy if exists tl_regions_read on tl_regions;
create policy tl_regions_read on tl_regions for select
  using (tl_id = auth.uid() or is_super_admin() or is_admin());

-- Helper: apakah region `rid` tercakup oleh TL yang sedang login?
-- security definer → tak kena RLS, tak rekursi. Cek tl_regions ATAU fallback
-- ke profiles.region_id (agar TL lama 1-region tetap jalan).
create or replace function tl_covers_region(rid uuid)
returns boolean language sql security definer stable as $$
  select rid is not null and (
    exists (select 1 from tl_regions t where t.tl_id = auth.uid() and t.region_id = rid)
    or rid = (select region_id from profiles where id = auth.uid())
  )
$$;

-- profiles: TL lihat MD di region yang dia cover
drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles for select using (
  auth.uid() = id
  or is_super_admin()
  or (is_admin() and role::text = 'md')
  or (is_tl() and role::text = 'md' and tl_covers_region(region_id))
);

-- visits: TL lihat visit MD di region yang dia cover
drop policy if exists visits_md_select_own on visits;
create policy visits_md_select_own on visits for select
  using (md_id = auth.uid() or is_admin() or (is_tl() and tl_covers_region(md_region(md_id))));

-- attendances: TL lihat absen MD di region yang dia cover
drop policy if exists attendances_select on attendances;
create policy attendances_select on attendances for select
  using (md_id = auth.uid() or is_admin() or (is_tl() and tl_covers_region(md_region(md_id))));
