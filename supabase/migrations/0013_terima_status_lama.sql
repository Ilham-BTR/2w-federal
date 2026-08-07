-- ============================================================
-- 2W Federal MD — KOMPATIBILITAS APP LAMA SETELAH RENAME STATUS
-- ============================================================
-- Migrasi 0012 mengganti nilai enum "Spanduk Terpasang" -> "Berhasil Pasang".
-- MD yang app-nya sudah terbuka sejak sebelum deploy masih memakai bundle
-- lama dan tetap mengirim "Spanduk Terpasang", sehingga submit visit gagal:
--   invalid input value for enum visit_status: "Spanduk Terpasang"
--
-- Nilai lama karena itu dihidupkan lagi SEBAGAI PINTU MASUK saja: PostgREST
-- butuh nilainya ada supaya cast teks->enum berhasil. Trigger di bawah lalu
-- menormalkannya ke "Berhasil Pasang" sebelum baris disimpan, jadi tidak ada
-- data yang benar-benar tersimpan dengan nama lama dan laporan tetap utuh.
--
-- Boleh dihapus setelah dipastikan semua MD memakai app versi baru.
-- ============================================================

alter type visit_status add value if not exists 'Spanduk Terpasang';

create or replace function normalize_visit_status()
returns trigger language plpgsql as $$
begin
  if new.status::text = 'Spanduk Terpasang' then
    new.status := 'Berhasil Pasang';
  end if;
  return new;
end $$;

drop trigger if exists visits_normalize_status on visits;
create trigger visits_normalize_status
  before insert or update on visits
  for each row execute function normalize_visit_status();
