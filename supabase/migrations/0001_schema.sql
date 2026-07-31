-- ============================================================
-- 2W Federal POSM Tracker — Database Schema
-- ============================================================
-- Cara pakai:
--   1. Buka Supabase Dashboard → SQL Editor
--   2. Paste seluruh isi file ini → Run
--   3. (Atau via CLI: supabase db reset)
--
-- Jika perlu reset, jalankan dulu schema_reset.sql.
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUM TYPES
-- ============================================================
do $$ begin
  create type user_role as enum ('admin', 'bp', 'md');
exception when duplicate_object then null; end $$;

do $$ begin
  create type visit_status as enum ('Pemasangan', 'Revisit', 'Maintenance', 'Delivery Gimmic');
exception when duplicate_object then null; end $$;

-- ============================================================
-- TABLE: profiles (extends auth.users)
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role user_role not null default 'md',
  region_id uuid,
  phone text,
  monthly_target int default 30,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists profiles_role_idx on profiles(role);
create index if not exists profiles_region_idx on profiles(region_id);

-- ============================================================
-- TABLE: regions
-- ============================================================
create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

-- ============================================================
-- TABLE: kotas (cities)
-- ============================================================
create table if not exists kotas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_id uuid not null references regions(id) on delete cascade,
  created_at timestamptz default now(),
  unique(name, region_id)
);

create index if not exists kotas_region_idx on kotas(region_id);

-- ============================================================
-- TABLE: distributors
-- ============================================================
create table if not exists distributors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_id uuid references regions(id) on delete set null,  -- distributor melayani 1 region
  active boolean default true,
  created_at timestamptz default now(),
  unique (name, region_id)
);

create index if not exists distributors_region_idx on distributors(region_id);

-- ============================================================
-- TABLE: bengkels (workshops)
-- ============================================================
create table if not exists bengkels (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kota_id uuid not null references kotas(id) on delete restrict,
  -- distributor TIDAK di sini — 1 bengkel bisa dilayani banyak distributor,
  -- jadi distributor dicatat per-visit (lihat visits.distributor_id)
  lat double precision,
  lng double precision,
  address text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists bengkels_kota_idx on bengkels(kota_id);
create index if not exists bengkels_code_idx on bengkels(code);

-- Add FK from profiles.region_id (deferred to avoid circular)
alter table profiles
  drop constraint if exists profiles_region_id_fkey;
alter table profiles
  add constraint profiles_region_id_fkey
  foreign key (region_id) references regions(id) on delete set null;

-- ============================================================
-- TABLE: visits — the core entity
-- ============================================================
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  md_id uuid not null references profiles(id) on delete restrict,
  bengkel_id uuid not null references bengkels(id) on delete restrict,

  visit_date date not null,
  pic_name text not null,
  pic_phone text not null,

  -- Distributor dipilih per-visit (1 bengkel bisa dicover banyak distributor)
  distributor_id uuid references distributors(id) on delete set null,

  status visit_status not null default 'Pemasangan',
  remarks text,

  -- GPS captured at submit time (may differ from bengkel master data)
  visit_lat double precision,
  visit_lng double precision,

  -- Photo URLs (set by upload edge function, served via Cloudflare CDN)
  photo_tampak_depan text,
  photo_in text,
  photo_out text,
  photo_spanduk_before text,
  photo_spanduk_after text,
  photo_poster_before text,
  photo_poster_after text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists visits_md_idx on visits(md_id);
create index if not exists visits_bengkel_idx on visits(bengkel_id);
create index if not exists visits_date_idx on visits(visit_date desc);
create index if not exists visits_status_idx on visits(status);
create index if not exists visits_distributor_idx on visits(distributor_id);
create index if not exists visits_md_date_idx on visits(md_id, visit_date desc);

-- ============================================================
-- TRIGGER: auto-update updated_at on row change
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists bengkels_set_updated_at on bengkels;
create trigger bengkels_set_updated_at
  before update on bengkels
  for each row execute function set_updated_at();

drop trigger if exists visits_set_updated_at on visits;
create trigger visits_set_updated_at
  before update on visits
  for each row execute function set_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile when a user signs up
-- ============================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'md')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- HELPER FUNCTIONS for RLS policies
-- ============================================================
create or replace function get_user_role()
returns user_role language sql security definer stable as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select get_user_role() in ('admin', 'bp')
$$;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
alter table profiles enable row level security;
alter table regions enable row level security;
alter table kotas enable row level security;
alter table distributors enable row level security;
alter table bengkels enable row level security;
alter table visits enable row level security;

-- --- profiles ---
drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles
  for select using (auth.uid() = id or is_admin());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (auth.uid() = id);

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all using (is_admin());

-- --- master data: regions, kotas, distributors, bengkels ---
-- read: all authenticated users
-- write: admin/bp only

drop policy if exists regions_read on regions;
create policy regions_read on regions for select using (auth.role() = 'authenticated');
drop policy if exists regions_write on regions;
create policy regions_write on regions for all using (is_admin());

drop policy if exists kotas_read on kotas;
create policy kotas_read on kotas for select using (auth.role() = 'authenticated');
drop policy if exists kotas_write on kotas;
create policy kotas_write on kotas for all using (is_admin());

drop policy if exists distributors_read on distributors;
create policy distributors_read on distributors for select using (auth.role() = 'authenticated');
drop policy if exists distributors_write on distributors;
create policy distributors_write on distributors for all using (is_admin());

drop policy if exists bengkels_read on bengkels;
create policy bengkels_read on bengkels for select using (auth.role() = 'authenticated');
drop policy if exists bengkels_write on bengkels;
create policy bengkels_write on bengkels for all using (is_admin());

-- --- visits ---
-- MD: can only see + create their own
-- Admin/BP: can see all
drop policy if exists visits_md_select_own on visits;
create policy visits_md_select_own on visits
  for select using (md_id = auth.uid() or is_admin());

drop policy if exists visits_md_insert_own on visits;
create policy visits_md_insert_own on visits
  for insert with check (md_id = auth.uid());

drop policy if exists visits_md_update_own on visits;
create policy visits_md_update_own on visits
  for update using (md_id = auth.uid() or is_admin());

drop policy if exists visits_admin_delete on visits;
create policy visits_admin_delete on visits
  for delete using (is_admin());

-- ============================================================
-- VIEWS for admin dashboard
-- ============================================================
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

-- Monthly performance per MD
create or replace view md_monthly_performance as
select
  p.id as md_id,
  p.full_name as md_name,
  p.monthly_target,
  date_trunc('month', v.visit_date)::date as month,
  count(*) as visits_actual,
  count(*) filter (where v.status = 'Pemasangan')      as visits_pemasangan,
  count(*) filter (where v.status = 'Revisit')         as visits_revisit,
  count(*) filter (where v.status = 'Maintenance')     as visits_maintenance,
  count(*) filter (where v.status = 'Delivery Gimmic') as visits_delivery_gimmic,
  round(100.0 * count(*) / nullif(p.monthly_target, 0), 1) as achievement_pct
from profiles p
left join visits v on v.md_id = p.id
where p.role = 'md'
group by p.id, p.full_name, p.monthly_target, date_trunc('month', v.visit_date);

-- ============================================================
-- SEED DATA
-- ============================================================
-- Master data (idempotent: ON CONFLICT DO NOTHING)
insert into regions (name) values
  ('Jabodetabek'), ('Jawa Barat'), ('Jawa Tengah'),
  ('Jawa Timur'), ('Sumatera'), ('Sulawesi')
on conflict (name) do nothing;

insert into distributors (name) values
  ('PT Sumber Pelumas'),
  ('PT Mega Lubricant'),
  ('PT Jaya Oli'),
  ('PT Pelumas Nusantara')
on conflict do nothing;

-- Kotas (depends on regions)
insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values
  ('Jakarta Pusat'), ('Jakarta Selatan'), ('Bekasi'), ('Tangerang'), ('Depok')
) as k(name) where r.name = 'Jabodetabek'
on conflict do nothing;

insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values ('Bandung'), ('Bogor'), ('Cirebon')) as k(name)
where r.name = 'Jawa Barat'
on conflict do nothing;

insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values ('Semarang'), ('Solo'), ('Yogyakarta')) as k(name)
where r.name = 'Jawa Tengah'
on conflict do nothing;

insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values ('Surabaya'), ('Malang'), ('Sidoarjo')) as k(name)
where r.name = 'Jawa Timur'
on conflict do nothing;

insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values ('Medan'), ('Palembang'), ('Padang')) as k(name)
where r.name = 'Sumatera'
on conflict do nothing;

insert into kotas (name, region_id)
select k.name, r.id from regions r
cross join lateral (values ('Makassar'), ('Manado')) as k(name)
where r.name = 'Sulawesi'
on conflict do nothing;

-- Sample bengkels (distributor TIDAK di sini — dicatat per visit)
insert into bengkels (code, name, kota_id, lat, lng) values
  ('BK001', 'Bengkel Maju Jaya', (select id from kotas where name='Jakarta Selatan' limit 1), -6.261, 106.810),
  ('BK002', 'Auto Service Prima', (select id from kotas where name='Bekasi' limit 1), -6.238, 106.992),
  ('BK003', 'Bengkel Sentosa', (select id from kotas where name='Bandung' limit 1), -6.917, 107.619),
  ('BK004', 'Mobil Sehat', (select id from kotas where name='Semarang' limit 1), -6.966, 110.417),
  ('BK005', 'Bengkel Surya', (select id from kotas where name='Surabaya' limit 1), -7.257, 112.752)
on conflict (code) do nothing;

-- ============================================================
-- DONE
-- ============================================================
-- Setelah jalanin schema ini:
-- 1. Buat user di Authentication → Users → Add User
-- 2. Edit role di table profiles (md / bp / admin)
-- 3. Set region_id untuk MD via dashboard table editor
-- ============================================================
