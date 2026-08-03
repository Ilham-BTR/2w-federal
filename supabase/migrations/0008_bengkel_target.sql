-- ============================================================
-- 2W Federal MD — PENANDA BENGKEL TARGET
-- ============================================================
-- Tidak semua bengkel di master data ikut program. Kolom is_target menandai
-- bengkel mana yang dihitung sebagai TARGET di Laporan Coverage & Dashboard.
--
-- Default TRUE supaya angka laporan yang sudah berjalan tidak berubah saat
-- migrasi ini dipasang; admin tinggal mematikan bengkel yang di luar program.
-- ============================================================

alter table bengkels add column if not exists is_target boolean not null default true;

create index if not exists bengkels_is_target_idx on bengkels(is_target) where is_target;
