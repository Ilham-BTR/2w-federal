-- ============================================================
-- 2W Federal MD — STATUS TARGET 3 KATEGORI
-- ============================================================
-- Master AA membagi bengkel jadi tiga: "Target AA" (daftar resmi),
-- "Target Tambahan" (di luar daftar AA tapi tetap digarap), dan
-- "Non Target". Kolom is_target yang cuma ya/tidak tidak cukup untuk
-- memisah dua kategori target di Laporan Coverage.
--
-- is_target TETAP dipertahankan supaya filter & tombol massal di Master
-- Data tidak berubah; nilainya diselaraskan = status <> 'Non Target'.
-- ============================================================

alter table bengkels add column if not exists target_status text;

-- Isi awal dari penandaan lama (nanti ditimpa data master AA):
update bengkels set target_status = case when is_target then 'Target AA' else 'Non Target' end
where target_status is null;

create index if not exists bengkels_target_status_idx on bengkels(target_status);
