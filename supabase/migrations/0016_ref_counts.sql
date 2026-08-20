-- ============================================================
-- 2W Federal MD — ANGKA RUJUKAN BENGKEL YANG TIDAK DIIMPOR
-- ============================================================
-- Master AA memuat 1.256 bengkel (hampir semuanya Non Target) yang sengaja
-- TIDAK dimasukkan ke tabel bengkels: menambahkannya cuma membesarkan data
-- yang diunduh MD tiap hari padahal bengkelnya tak pernah dikunjungi.
--
-- Yang disimpan cukup JUMLAHNYA, dipecah per provinsi/distributor/kelas
-- supaya Laporan Coverage tetap bisa menampilkan Total Database yang utuh
-- sesuai master AA, termasuk saat difilter per kelas atau dilihat per
-- distributor. Tidak ada identitas bengkel di sini.
-- ============================================================

create table if not exists bengkel_ref_counts (
  id              uuid primary key default gen_random_uuid(),
  region_id       uuid references regions(id) on delete cascade,
  distributor_id  uuid references distributors(id) on delete set null,
  workshop_class  text,                       -- 'IWS' | 'FOC' | null
  target_status   text not null,              -- 'Non Target' | 'Target Tambahan' | 'Target AA'
  jumlah          integer not null default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists bengkel_ref_counts_region_idx on bengkel_ref_counts(region_id);

alter table bengkel_ref_counts enable row level security;

drop policy if exists bengkel_ref_counts_read on bengkel_ref_counts;
create policy bengkel_ref_counts_read on bengkel_ref_counts for select
  using (auth.role() = 'authenticated');

drop policy if exists bengkel_ref_counts_write on bengkel_ref_counts;
create policy bengkel_ref_counts_write on bengkel_ref_counts for all using (is_admin());
