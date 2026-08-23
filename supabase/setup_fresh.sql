-- ⚠️ FILE INI SUDAH TIDAK DIPAKAI — JANGAN DIJALANKAN
--
-- Isinya schema versi awal dan tertinggal jauh dari aplikasi: belum ada data
-- Owner/PIC, target status, workshop class, distributor, izin edit foto, dan
-- validasi wajib data PIC. Membangun database dari file ini menghasilkan
-- struktur yang tidak cocok dengan app dan submit MD akan gagal.
--
-- Sumber schema yang benar: jalankan supabase/migrations/ secara berurutan
-- dari 0001 sampai nomor tertinggi. Disimpan hanya sebagai rujukan sejarah.

-- ============================================================
-- 2W Federal MD — SETUP DATABASE (sekali jalan untuk project baru)
-- ============================================================
-- Cara pakai:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste SELURUH isi file ini → Run
--   3. Lalu jalankan supabase_seed.sql (data master) & storage_setup.sql (foto)
--
-- File ini = skema final (gabungan migration 0001..0005) + RPC backfill.
-- TIDAK ada sample data (pakai data import-mu sendiri via supabase_seed.sql).
-- ============================================================

-- EXTENSIONS
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- ENUM TYPES
do $$ begin
  create type user_role as enum ('admin', 'bp', 'md', 'super_admin', 'tl');
exception when duplicate_object then null; end $$;

do $$ begin
  create type visit_status as enum (
    'Berhasil Pasang',
    'Alamat bengkel tidak ditemukan',
    'Ditolak',
    'Bukan bengkel',
    'Owner/PIC tidak di tempat',
    'Tidak jual oli Federal'
  );
exception when duplicate_object then null; end $$;

-- TABLE: profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text not null,
  role user_role not null default 'md',
  region_id uuid,
  phone text,
  monthly_target int default 30,
  active boolean default true,
  login_password text,                 -- password MD (agar admin bisa lihat; Supabase hash password asli)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists profiles_role_idx on profiles(role);
create index if not exists profiles_region_idx on profiles(region_id);

-- TABLE: regions
create table if not exists regions (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

-- TABLE: kotas
create table if not exists kotas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_id uuid not null references regions(id) on delete cascade,
  created_at timestamptz default now(),
  unique(name, region_id)
);
create index if not exists kotas_region_idx on kotas(region_id);

-- TABLE: distributors (1 distributor = 1 region)
create table if not exists distributors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region_id uuid references regions(id) on delete set null,
  active boolean default true,
  created_at timestamptz default now(),
  unique (name, region_id)
);
create index if not exists distributors_region_idx on distributors(region_id);

-- TABLE: bengkels (distributor dicatat per-visit, bukan di sini)
create table if not exists bengkels (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  kota_id uuid not null references kotas(id) on delete restrict,
  lat double precision,
  lng double precision,
  address text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists bengkels_kota_idx on bengkels(kota_id);
create index if not exists bengkels_code_idx on bengkels(code);

-- FK profiles.region_id
alter table profiles drop constraint if exists profiles_region_id_fkey;
alter table profiles add constraint profiles_region_id_fkey
  foreign key (region_id) references regions(id) on delete set null;

-- TABLE: visits
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  md_id uuid not null references profiles(id) on delete restrict,
  bengkel_id uuid not null references bengkels(id) on delete restrict,
  visit_date date not null,
  status visit_status not null,
  remarks text,
  visit_lat double precision,
  visit_lng double precision,
  photo_selfie text,
  photo_before text,
  photo_after text,
  photo_spanduk_jauh text,
  photo_spanduk_sedang text,
  photo_poster text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists visits_md_idx on visits(md_id);
create index if not exists visits_bengkel_idx on visits(bengkel_id);
create index if not exists visits_date_idx on visits(visit_date desc);
create index if not exists visits_status_idx on visits(status);
create index if not exists visits_md_date_idx on visits(md_id, visit_date desc);

-- TRIGGER updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles for each row execute function set_updated_at();
drop trigger if exists bengkels_set_updated_at on bengkels;
create trigger bengkels_set_updated_at before update on bengkels for each row execute function set_updated_at();
drop trigger if exists visits_set_updated_at on visits;
create trigger visits_set_updated_at before update on visits for each row execute function set_updated_at();

-- TRIGGER auto-create profile saat user signup
-- PENTING: set search_path = public + schema-qualify, kalau tidak trigger gagal
-- saat dipanggil dari konteks auth ("Database error creating new user").
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'md')
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- HELPER untuk RLS
create or replace function get_user_role()
returns user_role language sql security definer stable as $$
  select role from profiles where id = auth.uid()
$$;
create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select get_user_role()::text in ('admin', 'bp', 'super_admin')
$$;
create or replace function is_super_admin()
returns boolean language sql security definer stable as $$
  select get_user_role()::text = 'super_admin'
$$;
-- TL (Team Leader): read-only, scoped per region
create or replace function get_user_region()
returns uuid language sql security definer stable as $$
  select region_id from profiles where id = auth.uid()
$$;
create or replace function is_tl()
returns boolean language sql security definer stable as $$
  select get_user_role()::text = 'tl'
$$;
create or replace function md_region(mid uuid)
returns uuid language sql security definer stable as $$
  select region_id from profiles where id = mid
$$;

-- RLS
alter table profiles enable row level security;
alter table regions enable row level security;
alter table kotas enable row level security;
alter table distributors enable row level security;
alter table bengkels enable row level security;
alter table visits enable row level security;

drop policy if exists profiles_read_own on profiles;
-- super_admin: semua profil. admin/bp: hanya md. tl: md di region-nya. md: sendiri.
create policy profiles_read_own on profiles for select using (
  auth.uid() = id
  or is_super_admin()
  or (is_admin() and role::text = 'md')
  or (is_tl() and role::text = 'md' and region_id = get_user_region())
);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update using (auth.uid() = id);
-- Kelola akun (insert/update/delete profil orang lain) hanya super_admin.
-- Admin/BP tetap BACA semua profil via profiles_read_own.
drop policy if exists profiles_admin_all on profiles;
drop policy if exists profiles_super_manage on profiles;
create policy profiles_super_manage on profiles for all using (is_super_admin());

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

drop policy if exists visits_md_select_own on visits;
create policy visits_md_select_own on visits for select using (md_id = auth.uid() or is_admin() or (is_tl() and md_region(md_id) = get_user_region()));
drop policy if exists visits_md_insert_own on visits;
create policy visits_md_insert_own on visits for insert with check (md_id = auth.uid());
drop policy if exists visits_md_update_own on visits;
create policy visits_md_update_own on visits for update using (md_id = auth.uid() or is_admin());
drop policy if exists visits_admin_delete on visits;
create policy visits_admin_delete on visits for delete using (is_super_admin());

-- VIEWS
create or replace view visit_details as
select v.*, p.full_name as md_name, p.email as md_email,
  b.code as bengkel_code, b.name as bengkel_name,
  k.name as kota_name, r.name as region_name
from visits v
join profiles p on p.id = v.md_id
join bengkels b on b.id = v.bengkel_id
join kotas k on k.id = b.kota_id
join regions r on r.id = k.region_id;

create or replace view md_monthly_performance as
select p.id as md_id, p.full_name as md_name, p.monthly_target,
  date_trunc('month', v.visit_date)::date as month,
  count(*) as visits_actual,
  count(*) filter (where v.status = 'Berhasil Pasang')  as visits_terpasang,
  count(*) filter (where v.status <> 'Berhasil Pasang') as visits_tidak_terpasang,
  round(100.0 * count(*) / nullif(p.monthly_target, 0), 1) as achievement_pct
from profiles p
left join visits v on v.md_id = p.id
where p.role = 'md'
group by p.id, p.full_name, p.monthly_target, date_trunc('month', v.visit_date);

-- RPC: backfill koordinat bengkel dari GPS MD (idempotent, security definer)
create or replace function backfill_bengkel_coords(
  p_bengkel_id uuid, p_lat double precision, p_lng double precision
)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_updated integer := 0;
begin
  if p_bengkel_id is null or p_lat is null or p_lng is null then return false; end if;
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then return false; end if;
  update bengkels set lat = p_lat, lng = p_lng, updated_at = now()
    where id = p_bengkel_id and (lat is null or lng is null);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end; $$;
grant execute on function backfill_bengkel_coords(uuid, double precision, double precision) to authenticated;

-- WEBAUTHN / PASSKEY (login biometrik server-side; password tak disimpan)
create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  credential_id text unique not null,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  device_label text,
  created_at timestamptz default now(),
  last_used_at timestamptz
);
create index if not exists webauthn_creds_user_idx on webauthn_credentials(user_id);

create table if not exists webauthn_challenges (
  key text primary key,
  user_id uuid,
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

alter table webauthn_credentials enable row level security;
alter table webauthn_challenges enable row level security;

drop policy if exists webauthn_creds_select_own on webauthn_credentials;
create policy webauthn_creds_select_own on webauthn_credentials for select using (user_id = auth.uid());
drop policy if exists webauthn_creds_delete_own on webauthn_credentials;
create policy webauthn_creds_delete_own on webauthn_credentials for delete using (user_id = auth.uid());

create or replace function cleanup_webauthn_challenges()
returns void language sql security definer set search_path = public as $$
  delete from webauthn_challenges where expires_at < now();
$$;

-- ============================================================
-- TL multi-region (tl_regions) — TL bisa cover >1 region
-- ============================================================
create table if not exists tl_regions (
  tl_id     uuid not null references profiles(id) on delete cascade,
  region_id uuid not null references regions(id)  on delete cascade,
  primary key (tl_id, region_id)
);
alter table tl_regions enable row level security;

drop policy if exists tl_regions_super_manage on tl_regions;
create policy tl_regions_super_manage on tl_regions for all
  using (is_super_admin()) with check (is_super_admin());
drop policy if exists tl_regions_read on tl_regions;
create policy tl_regions_read on tl_regions for select
  using (tl_id = auth.uid() or is_super_admin() or is_admin());

create or replace function tl_covers_region(rid uuid)
returns boolean language sql security definer stable as $$
  select rid is not null and (
    exists (select 1 from tl_regions t where t.tl_id = auth.uid() and t.region_id = rid)
    or rid = (select region_id from profiles where id = auth.uid())
  )
$$;

drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles for select using (
  auth.uid() = id
  or is_super_admin()
  or (is_admin() and role::text = 'md')
  or (is_tl() and role::text = 'md' and tl_covers_region(region_id))
);

drop policy if exists visits_md_select_own on visits;
create policy visits_md_select_own on visits for select
  using (md_id = auth.uid() or is_admin() or (is_tl() and tl_covers_region(md_region(md_id))));

-- ============================================================
-- SELESAI. Lanjut: supabase_seed.sql (data) + storage_setup.sql (foto)
--   + deploy Edge Function `webauthn` (passkey)
-- ============================================================
