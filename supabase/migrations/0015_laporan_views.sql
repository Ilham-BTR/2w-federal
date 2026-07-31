-- ============================================================
-- Migration 0015 — View laporan untuk Excel (Power Query / koneksi DB langsung)
-- laporan_visit & laporan_absen: kolom rapi, nama Bahasa Indonesia, waktu WIB.
-- TIDAK di-grant ke anon/authenticated -> hanya terbaca lewat koneksi DB
-- (role postgres, mis. Excel via session pooler), bukan lewat API publik app.
-- ============================================================

-- ---------- LAPORAN VISIT ----------
-- DROP dulu: create-or-replace tak bisa ubah tipe kolom (tanggal date -> text)
drop view if exists laporan_visit;
create view laporan_visit as
select
  to_char(v.visit_date, 'DD/MM/YYYY')        as tanggal,
  to_char(v.created_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI') as waktu_submit,
  p.full_name                                as md,
  r.name                                     as region,
  k.name                                     as kota,
  b.code                                     as bengkel_kode,
  b.name                                     as bengkel_nama,
  b.address                                  as bengkel_alamat,
  d.name                                     as distributor,
  v.status                                   as status,
  v.sub_type                                 as sub_tipe,
  v.pic_name                                 as pic,
  v.pic_phone                                as no_telpon,
  v.remarks                                  as catatan,
  (
    (v.photo_tampak_depan     is not null)::int + (v.photo_in             is not null)::int +
    (v.photo_out              is not null)::int + (v.photo_spanduk_before is not null)::int +
    (v.photo_spanduk_putih    is not null)::int + (v.photo_spanduk_after  is not null)::int +
    (v.photo_poster_before    is not null)::int + (v.photo_poster_putih   is not null)::int +
    (v.photo_poster_after     is not null)::int + (v.photo_delivery_gimmick is not null)::int +
    (v.photo_deploy_planogram is not null)::int
  )                                          as jumlah_foto,
  v.visit_lat                                as gps_lat,
  v.visit_lng                                as gps_lng,
  b.lat                                      as bengkel_lat,
  b.lng                                      as bengkel_lng,
  case
    when v.visit_lat is not null and v.visit_lng is not null and b.lat is not null and b.lng is not null then
      round((6371000 * acos(greatest(-1, least(1,
        cos(radians(v.visit_lat)) * cos(radians(b.lat)) * cos(radians(b.lng) - radians(v.visit_lng))
        + sin(radians(v.visit_lat)) * sin(radians(b.lat))
      ))))::numeric)
  end                                        as jarak_ke_bengkel_m,
  v.id                                       as visit_id
from visits v
join profiles p        on p.id = v.md_id
join bengkels b        on b.id = v.bengkel_id
join kotas k           on k.id = b.kota_id
join regions r         on r.id = k.region_id
left join distributors d on d.id = v.distributor_id;

-- ---------- LAPORAN ABSEN ----------
drop view if exists laporan_absen;
create view laporan_absen as
select
  to_char(a.date, 'DD/MM/YYYY')              as tanggal,
  p.full_name                                as md,
  r.name                                     as region,
  p.email                                    as email,
  to_char(a.check_in_at  at time zone 'Asia/Jakarta', 'HH24:MI') as jam_masuk,
  to_char(a.check_out_at at time zone 'Asia/Jakarta', 'HH24:MI') as jam_pulang,
  case
    when a.check_in_at is not null and a.check_out_at is not null
      then round((extract(epoch from (a.check_out_at - a.check_in_at)) / 3600)::numeric, 2)
  end                                        as jam_kerja,
  a.check_in_lat                             as gps_masuk_lat,
  a.check_in_lng                             as gps_masuk_lng,
  a.check_out_lat                            as gps_pulang_lat,
  a.check_out_lng                            as gps_pulang_lng,
  a.check_in_note                            as catatan_masuk,
  a.check_out_note                           as catatan_pulang,
  a.id                                       as absen_id
from attendances a
join profiles p     on p.id = a.md_id
left join regions r on r.id = p.region_id;
