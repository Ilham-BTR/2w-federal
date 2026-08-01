-- ============================================================
-- 2W Federal MD — REGION GROUPS (Region besar di atas provinsi)
-- ============================================================
-- Hierarki baru: region_groups (7: Bali-Nusra, Jabodetabek-Banten, ...)
--   -> regions (provinsi, tabel lama — FK MD/kota tidak berubah)
--   -> kotas -> bengkels
-- ============================================================

create table if not exists region_groups (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

alter table regions add column if not exists group_id uuid references region_groups(id) on delete set null;

alter table region_groups enable row level security;
drop policy if exists region_groups_read on region_groups;
create policy region_groups_read on region_groups for select using (auth.role() = 'authenticated');
drop policy if exists region_groups_write on region_groups;
create policy region_groups_write on region_groups for all using (is_admin());

-- Seed 7 region
insert into region_groups (name) values
  ('Bali-Nusra'), ('Jabodetabek-Banten'), ('Jateng-DIY'), ('Jawa Timur'),
  ('Kalimantan'), ('Sumbagsel'), ('Sumbagut')
on conflict (name) do nothing;

-- Mapping provinsi -> region (dari db 2 W.xlsx)
update regions r set group_id = g.id
from (values
  ('Aceh', 'Sumbagut'),
  ('Bali', 'Bali-Nusra'),
  ('Banten', 'Jabodetabek-Banten'),
  ('Bengkulu', 'Sumbagsel'),
  ('Di Yogyakarta', 'Jateng-DIY'),
  ('Dki Jakarta', 'Jabodetabek-Banten'),
  ('Jambi', 'Sumbagsel'),
  ('Jawa Barat', 'Jabodetabek-Banten'),
  ('Jawa Tengah', 'Jateng-DIY'),
  ('Jawa Timur', 'Jawa Timur'),
  ('Kalimantan Barat', 'Kalimantan'),
  ('Kalimantan Selatan', 'Kalimantan'),
  ('Kalimantan Tengah', 'Kalimantan'),
  ('Kalimantan Timur', 'Kalimantan'),
  ('Kepulauan Bangka Belitung', 'Sumbagsel'),
  ('Kepulauan Riau', 'Sumbagut'),
  ('Lampung', 'Sumbagsel'),
  ('Nusa Tenggara Barat', 'Bali-Nusra'),
  ('Riau', 'Sumbagut'),
  ('Sulawesi Selatan', 'Bali-Nusra'),
  ('Sulawesi Tengah', 'Bali-Nusra'),
  ('Sulawesi Tenggara', 'Bali-Nusra'),
  ('Sumatera Selatan', 'Sumbagsel'),
  ('Sumatera Utara', 'Sumbagut')
) as m(prov, grp)
join region_groups g on g.name = m.grp
where r.name = m.prov;
