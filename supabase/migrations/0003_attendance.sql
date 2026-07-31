-- ============================================================
-- 2W Federal MD — ABSEN / ATTENDANCE (Masuk & Pulang)
-- ============================================================
-- Cara pakai: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- 1 baris per MD per hari. Absen masuk membuat baris; absen pulang meng-update.
-- Selfie disimpan di bucket `visit-photos` (path attendance/...), reuse policy.
-- ============================================================

create table if not exists attendances (
  id uuid primary key default gen_random_uuid(),
  md_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  -- Absen masuk
  check_in_at timestamptz,
  check_in_lat double precision,
  check_in_lng double precision,
  check_in_photo text,
  check_in_note text,
  -- Absen pulang
  check_out_at timestamptz,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_photo text,
  check_out_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (md_id, date)
);
create index if not exists attendances_md_idx on attendances(md_id);
create index if not exists attendances_date_idx on attendances(date desc);
create index if not exists attendances_md_date_idx on attendances(md_id, date desc);

-- updated_at otomatis (fungsi set_updated_at sudah ada dari setup_fresh.sql)
drop trigger if exists attendances_set_updated_at on attendances;
create trigger attendances_set_updated_at before update on attendances
  for each row execute function set_updated_at();

-- RLS
alter table attendances enable row level security;

-- MD lihat absennya sendiri; admin/bp lihat semua
drop policy if exists attendances_select on attendances;
create policy attendances_select on attendances for select
  using (md_id = auth.uid() or is_admin());

-- MD hanya boleh absen untuk dirinya sendiri
drop policy if exists attendances_insert_own on attendances;
create policy attendances_insert_own on attendances for insert
  with check (md_id = auth.uid());

drop policy if exists attendances_update_own on attendances;
create policy attendances_update_own on attendances for update
  using (md_id = auth.uid() or is_admin());

drop policy if exists attendances_admin_delete on attendances;
create policy attendances_admin_delete on attendances for delete
  using (is_admin());

-- View untuk admin (gabung nama MD) — dipakai modul Admin nanti
create or replace view attendance_details as
select a.*, p.full_name as md_name, p.email as md_email,
  case when a.check_in_at is not null and a.check_out_at is not null
    then round(extract(epoch from (a.check_out_at - a.check_in_at)) / 3600.0, 2)
  end as work_hours
from attendances a
join profiles p on p.id = a.md_id;

-- ============================================================
-- SELESAI. Selfie absen reuse bucket visit-photos (sudah ada policy upload).
-- ============================================================
