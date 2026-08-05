-- ============================================================
-- 2W Federal MD — DISTRIBUTOR PER BENGKEL
-- ============================================================
-- Sumber: kolom "Order Approver" di master AA. Dipakai untuk Laporan
-- Coverage versi per-distributor (visit sendiri tidak menyimpan distributor;
-- distributor diturunkan dari bengkel yang dikunjungi).
-- ============================================================

alter table bengkels add column if not exists distributor_id uuid
  references distributors(id) on delete set null;

create index if not exists bengkels_distributor_idx on bengkels(distributor_id);
