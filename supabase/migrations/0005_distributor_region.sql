-- ============================================================
-- Migration 0005 — Distributor punya Region
-- ============================================================
-- 1 distributor = 1 region. Saat MD pilih region di visit,
-- dropdown distributor difilter ke region itu. (Tidak
-- mempengaruhi pilihan bengkel — bengkel tetap dari kota.)
--
-- Kalau 1 distributor cover banyak region → buat entri terpisah
-- per region (nama boleh sama, dibedakan region_id).
-- ============================================================

alter table distributors add column if not exists region_id uuid references regions(id) on delete set null;
create index if not exists distributors_region_idx on distributors(region_id);

-- Relax unique(name) → unique(name, region_id) supaya nama distributor
-- boleh sama di region berbeda.
alter table distributors drop constraint if exists distributors_name_key;
do $$ begin
  alter table distributors add constraint distributors_name_region_key unique (name, region_id);
exception when duplicate_object then null; end $$;
