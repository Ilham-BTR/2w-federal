-- ============================================================
-- 2W Federal MD — PENGECEKAN HASIL VISIT oleh Admin/AA
-- ============================================================
-- Admin menilai TIAP FOTO: 'ok' (Sesuai) / 'bad' (Tidak Sesuai),
-- lalu 1 remarks untuk keseluruhan visit.
-- check_status diturunkan dari penilaian foto: semua ok -> 'Sesuai'.
-- ============================================================

alter table visits add column if not exists photo_checks jsonb;      -- {selfie:'ok'|'bad', before:'ok'|'bad', ...}
alter table visits add column if not exists check_status text;       -- 'Sesuai' | 'Tidak Sesuai' (null = belum dicek)
alter table visits add column if not exists check_remarks text;      -- 1 catatan untuk seluruh visit
alter table visits add column if not exists checked_by uuid references profiles(id) on delete set null;
alter table visits add column if not exists checked_at timestamptz;

create index if not exists visits_check_status_idx on visits(check_status);

-- Admin/BP/Super Admin boleh meng-update visit (untuk mengisi hasil pengecekan).
-- MD tetap hanya bisa update visit miliknya sendiri.
drop policy if exists visits_md_update_own on visits;
create policy visits_md_update_own on visits for update
  using (md_id = auth.uid() or is_admin());

-- View: hasil pengecekan + nama pengecek (dipakai laporan/export)
create or replace view visit_check_details as
select v.id as visit_id, v.check_status, v.check_remarks, v.photo_checks,
       v.checked_at, p.full_name as checked_by_name, p.email as checked_by_email
from visits v
left join profiles p on p.id = v.checked_by;
