-- ============================================================
-- 2W Federal MD — KELAS BENGKEL (AA Workshop Class)
-- ============================================================
-- Nilai dari master AA: 'IWS' | 'FOC'. Dipakai untuk memfilter & memecah
-- Laporan Coverage per kelas bengkel.
-- ============================================================

alter table bengkels add column if not exists workshop_class text;

create index if not exists bengkels_workshop_class_idx on bengkels(workshop_class);
