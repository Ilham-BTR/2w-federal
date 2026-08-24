// src/lib/constants.js
// Konstanta domain 2W Federal — data murni yang dulu menumpuk di App.jsx.
// Dipisah supaya App.jsx (file besar) lebih ringan; tidak ada perubahan perilaku.

import { VISIT_PHOTO_MAP } from './storage';

// Setelan kompresi foto sebelum upload (browser-image-compression).
export const FOTO_KOMPRES = {
  maxSizeMB: 0.8,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  fileType: 'image/jpeg',
  initialQuality: 0.85,
};

// Kolom foto DB -> label yang ditampilkan ke user.
export const PHOTO_LABELS = {
  photo_selfie:            'Selfie Depan Bengkel',
  photo_before:            'Tampak Depan (Before)',
  photo_after:             'Tampak Depan (After)',
  photo_selfie_pic:        'Selfie dengan Owner/PIC',
  photo_spanduk_jauh:      'Spanduk Jarak Jauh',
  photo_spanduk_sedang:    'Spanduk Jarak Sedang',
  photo_poster:            'Foto Poster',
  photo_planogram_before:  'Rack Display Oil / Planogram (Before)',
  photo_planogram_after:   'Rack Display Oil / Planogram (After)',
};
export const PHOTO_KEYS = Object.keys(PHOTO_LABELS);

// Contoh foto acuan dari AA — ditampilkan sebelum MD memotret slot tersebut.
// File ada di public/contoh (sudah dikecilkan), key = uiKey di form visit.
export const CONTOH_FOTO = {
  selfie:          '/contoh/selfie.jpg',
  before:          '/contoh/tampak-depan-before.jpg',
  after:           '/contoh/tampak-depan-after.jpg',
  spandukJauh:     '/contoh/spanduk-jauh.jpg',
  spandukSedang:   '/contoh/spanduk-sedang.jpg',
  poster:          '/contoh/poster.jpg',
  planogramAfter:  '/contoh/planogram-after.jpg',
};

// Pilihan rekomendasi ukuran spanduk (diisi MD saat berhasil pasang).
export const UKURAN_SPANDUK = [
  '2x1 meter', '2x0.6 meter', '2x0.8 meter',
  '3x1 meter', '3x0.6 meter', '3x0.8 meter',
  '6x1 meter', '9x1 meter',
];

export const EXPORT_PHOTO_SKIP = new Set();
export const EXPORT_PHOTO_HEADER = {
  photo_selfie:            'link_selfie',
  photo_before:            'link_before',
  photo_after:             'link_after',
  photo_selfie_pic:        'link_selfie_pic',
  photo_spanduk_jauh:      'link_spanduk_jauh',
  photo_spanduk_sedang:    'link_spanduk_sedang',
  photo_poster:            'link_poster',
  photo_planogram_before:  'link_planogram_before',
  photo_planogram_after:   'link_planogram_after',
};

// Kolom DB foto -> UI key (uploadOneVisitPhoto butuh UI key, mis. 'tampakDepan')
export const PHOTO_COL_TO_UIKEY = Object.fromEntries(
  Object.entries(VISIT_PHOTO_MAP).map(([uiKey, m]) => [m.col, uiKey])
);

// Warna ikon kartu KPI -> class LITERAL. Tailwind hanya generate class yang
// muncul utuh di source; `text-${x}-500` dinamis TIDAK ke-generate. Simpan
// literal di sini supaya semua warna kartu benar muncul.
export const KPI_ICON_COLOR = {
  red: 'text-blue-500', emerald: 'text-emerald-500', sky: 'text-sky-500',
  blue: 'text-blue-500', amber: 'text-amber-500', rose: 'text-rose-500',
};

// Hierarki wilayah: REGION (grup besar) -> Provinsi -> Kota -> Bengkel.
// Mapping statis dari master db 2 W.xlsx (kolom Region per provinsi).
export const REGION_GROUP_OF = {
  'Aceh': 'Sumbagut', 'Bali': 'Bali-Nusra', 'Banten': 'Jabodetabek-Banten',
  'Bengkulu': 'Sumbagsel', 'Di Yogyakarta': 'Jateng-DIY', 'Dki Jakarta': 'Jabodetabek-Banten',
  'Jambi': 'Sumbagsel', 'Jawa Barat': 'Jabodetabek-Banten', 'Jawa Tengah': 'Jateng-DIY',
  'Jawa Timur': 'Jawa Timur', 'Kalimantan Barat': 'Kalimantan', 'Kalimantan Selatan': 'Kalimantan',
  'Kalimantan Tengah': 'Kalimantan', 'Kalimantan Timur': 'Kalimantan',
  'Kepulauan Bangka Belitung': 'Sumbagsel', 'Kepulauan Riau': 'Sumbagut', 'Lampung': 'Sumbagsel',
  'Nusa Tenggara Barat': 'Bali-Nusra', 'Nusa Tenggara Timur': 'Bali-Nusra',
  'Gorontalo': 'Sulawesi', 'Sulawesi Barat': 'Sulawesi', 'Sulawesi Utara': 'Sulawesi',
  'Kalimantan Utara': 'Kalimantan',
  'Riau': 'Sumbagut', 'Sulawesi Selatan': 'Sulawesi',
  'Sulawesi Tengah': 'Sulawesi', 'Sulawesi Tenggara': 'Sulawesi',
  'Sumatera Selatan': 'Sumbagsel', 'Sumatera Utara': 'Sumbagut',
};
export const groupOfRegion = (r) => REGION_GROUP_OF[r?.name] || 'Lainnya';

// Hasil visit 2W Federal. "Berhasil Pasang" membuka foto lanjutan.
// Nilai ini = label enum visit_status di database (lihat migrasi 0012).
export const HASIL_TERPASANG = 'Berhasil Pasang';
export const STATUS_OPTIONS = [
  HASIL_TERPASANG,
  'Alamat bengkel tidak ditemukan',
  'Ditolak',
  'Bukan bengkel',
  'Owner/PIC tidak di tempat',
];
export const STATUS_STYLES = {
  [HASIL_TERPASANG]:                { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  'Alamat bengkel tidak ditemukan': { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   dot: 'bg-amber-400' },
  'Ditolak':                        { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30',    dot: 'bg-rose-400' },
  'Bukan bengkel':                  { bg: 'bg-slate-500/10',    text: 'text-slate-400',    border: 'border-slate-500/30',    dot: 'bg-slate-400' },
  'Owner/PIC tidak di tempat':      { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/30',     dot: 'bg-sky-400' },
  'Tidak jual oli Federal':         { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/30',  dot: 'bg-orange-400' },
};

// Alias header Excel -> field kanonik saat impor master bengkel.
export const COLUMN_ALIASES = {
  code: ['code', 'kode', 'kode bengkel', 'kode_bengkel'],
  name: ['name', 'nama', 'nama bengkel', 'nama_bengkel', 'bengkel'],
  kota: ['kota', 'city', 'nama kota', 'nama_kota'],
  region: ['region', 'nama region', 'wilayah'],
  lat: ['lat', 'latitude', 'lintang'],
  lng: ['lng', 'lon', 'long', 'longitude', 'bujur'],
  address: ['address', 'alamat'],
};
