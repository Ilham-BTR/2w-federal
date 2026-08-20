-- ============================================================
-- 2W Federal MD — DATA PIC WAJIB DI LEVEL DATABASE
-- ============================================================
-- Sampai sekarang kewajiban isi Owner/PIC cuma dijaga di tampilan, jadi MD
-- yang app-nya belum di-refresh tetap bisa mengirim visit "Berhasil Pasang"
-- dengan data kosong (bundle lama tidak mengenal field itu sama sekali).
--
-- Aturan ini menutup celah tersebut di server. Konsekuensinya disengaja:
-- app versi lama akan GAGAL submit sampai MD menutup & membuka appnya.
-- Pesannya ditulis dalam bahasa yang bisa dipahami MD di lapangan.
--
-- Hanya diperiksa saat:
--   - INSERT visit baru, atau
--   - UPDATE yang MENGUBAH status menjadi "Berhasil Pasang"
-- Visit lama (sebelum fitur ini ada) sengaja tidak diusik supaya admin tetap
-- bisa menyimpan hasil pengecekan foto & memperbaiki datanya.
-- ============================================================

create or replace function visits_wajib_data_pic()
returns trigger language plpgsql as $$
declare
  perlu_cek boolean;
begin
  perlu_cek := new.status = 'Berhasil Pasang'
               and (tg_op = 'INSERT' or old.status is distinct from new.status);

  if perlu_cek and (
       coalesce(btrim(new.owner_name), '')  = '' or
       coalesce(btrim(new.owner_phone), '') = '' or
       coalesce(btrim(new.spanduk_size), '') = ''
     ) then
    raise exception 'Nama Owner/PIC, no telp, dan ukuran spanduk wajib diisi. Kalau kolomnya tidak muncul, aplikasi Anda masih versi lama: tutup lalu buka kembali app, kemudian ulangi.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists visits_wajib_data_pic on visits;
create trigger visits_wajib_data_pic
  before insert or update on visits
  for each row execute function visits_wajib_data_pic();
