# PRD — 2W Federal POSM Tracker

**Product Requirements Document**

| | |
|---|---|
| **Produk** | 2W Federal POSM Tracker |
| **Versi dokumen** | 1.0 |
| **Tanggal** | 14 Juni 2026 |
| **Pemilik** | Ilham (BTR) |
| **Status** | Live / dalam pengembangan |
| **Repository** | https://github.com/Ilham-BTR/federal-2w-md |

---

## 1. Ringkasan (Executive Summary)

2W Federal POSM Tracker adalah aplikasi web (mobile-first) untuk **memantau pemasangan POSM** (Point of Sale Materials — spanduk, poster, dsb.) 2W Federal di bengkel-bengkel oleh tim **Field MD (Merchandiser)**.

Aplikasi menggantikan pelaporan manual (foto via WhatsApp + rekap Excel) dengan satu sistem terpusat: MD melapor kunjungan lengkap dengan **foto before/after + GPS** langsung dari lapangan, dan Admin/BP memantau **coverage, produktivitas, dan absensi** secara real-time lewat dashboard.

**Masalah yang diselesaikan:** sebelumnya bukti pemasangan tersebar, sulit diverifikasi (tidak ada GPS/waktu), dan rekap memakan waktu. Aplikasi ini memberi bukti yang terverifikasi + pelaporan otomatis.

---

## 2. Tujuan & Metrik Sukses

### 2.1 Tujuan Produk
1. Memberikan **bukti pemasangan POSM yang terverifikasi** (foto + GPS + timestamp).
2. Memberi Admin/BP **visibilitas real-time** atas aktivitas & coverage lapangan.
3. Mempercepat rekap & pelaporan (target: dari berjam-jam jadi instan/export Excel).
4. Mengukur **produktivitas MD** terhadap target bulanan.
5. Mencatat **kehadiran (absensi) MD** dengan bukti selfie + lokasi.

### 2.2 Metrik Sukses (KPI)
| Metrik | Target |
|---|---|
| Kunjungan MD tercatat di app vs aktual | ≥ 95% |
| Pencapaian target bulanan rata-rata MD | ≥ 80% |
| Coverage bengkel aktif yang dikunjungi / bulan | tren naik |
| Waktu rekap laporan bulanan | < 5 menit (via export) |
| Kepatuhan absen masuk + pulang | ≥ 90% hari kerja |

---

## 3. Pengguna & Peran (Roles)

| Peran | Deskripsi | Akses |
|---|---|---|
| **MD** (Merchandiser) | Petugas lapangan yang memasang POSM | Lihat & input **data miliknya sendiri** saja (visit + absen) |
| **BP** (Business Partner / Supervisor) | Pengawas wilayah | Akses penuh baca data (sama seperti admin) |
| **Admin** | Pengelola sistem | Akses penuh: kelola master data, MD, lihat semua visit & absen, export |

> Pemisahan akses ditegakkan di level database lewat **Row Level Security (RLS)**: MD secara teknis tidak bisa mengakses data MD lain.

---

## 4. Lingkup Produk (Scope)

### 4.1 Modul Utama
1. **Autentikasi** — login email/password, lupa password.
2. **Pelaporan Kunjungan (Visit)** — inti aplikasi.
3. **Absensi (Absen MD)** — masuk & pulang dengan selfie + GPS.
4. **Dashboard & Laporan Admin** — monitoring, coverage, rekap, export.
5. **Manajemen Master Data** — region, kota, distributor, bengkel, MD.

### 4.2 Di Luar Lingkup (Non-Goals) saat ini
- Aplikasi native Android/iOS (sedang dieksplorasi terpisah — port React Native).
- Modul approval/workflow multi-tahap.
- Integrasi langsung ke sistem ERP/distributor.
- Notifikasi push.

---

## 5. Kebutuhan Fungsional (Functional Requirements)

### 5.1 Autentikasi
- **FR-1.1** Login dengan email + password (Supabase Auth).
- **FR-1.2** Lupa password (reset via email).
- **FR-1.3** Profil dibuat otomatis saat user baru dibuat (role default `md`).
- **FR-1.4** (Opsional, saat ini disembunyikan via saklar `PASSKEY_ENABLED`) login Passkey/biometrik (WebAuthn).
- **FR-1.5** Mode Demo (mock data in-memory) untuk uji coba tanpa backend.

### 5.2 Pelaporan Kunjungan (Visit) — MD
- **FR-2.1** MD membuat laporan kunjungan dengan field:
  - Bengkel (pilih dari master), PIC nama & telepon.
  - Tanggal kunjungan.
  - **Distributor dipilih per-kunjungan** (1 bengkel bisa dilayani banyak distributor).
  - **Status 2 tingkat**: status induk (`Pemasangan` / `Revisit`) + sub-tipe (mis. *Deploy POSM New*, *Maintenance*, *Delivery Gimmick*).
  - Remarks/catatan.
- **FR-2.2** **Foto wajib** sesuai jenis: tampak depan, dalam (in), luar (out), spanduk before/after, poster before/after.
- **FR-2.3** Foto **dikompres di browser** sebelum upload (hemat kuota & cepat).
- **FR-2.4** **GPS otomatis** ditangkap saat submit (visit_lat/lng) — bukti lokasi pemasangan.
- **FR-2.5** MD melihat **riwayat kunjungannya** + detail (modal dengan foto & peta).
- **FR-2.6** MD melihat progres terhadap **target bulanan** pribadi.

### 5.3 Absensi (Absen MD)
- **FR-3.1** **Absen Masuk**: selfie + GPS + waktu + catatan opsional.
- **FR-3.2** **Absen Pulang**: selfie + GPS + waktu (meng-update baris hari yang sama).
- **FR-3.3** Aturan **1 baris per MD per hari** (unik md_id + tanggal).
- **FR-3.4** MD melihat **riwayat absen** miliknya.
- **FR-3.5** Tanggal mengikuti **zona waktu lokal** (bukan UTC) agar tidak salah hari.

### 5.4 Dashboard & Laporan (Admin/BP)
- **FR-4.1** **Dashboard**: ringkasan KPI (total kunjungan, pencapaian target per MD, tren).
- **FR-4.2** **Tab Visits**: tabel semua kunjungan + filter + detail foto/GPS.
- **FR-4.3** **Coverage**: cakupan bengkel yang sudah/belum dikunjungi (peta Leaflet).
- **FR-4.4** **Rekap Absen Admin**: filter per bulan & per MD, pencarian, **export Excel**.
- **FR-4.5** Export data ke **Excel (.xlsx)**.

### 5.5 Manajemen Master Data (Admin)
- **FR-5.1** CRUD **MD** (profil, region, telepon, **target bulanan**, status aktif).
- **FR-5.2** CRUD **Bengkel** (kode, nama, kota, koordinat, alamat, status aktif).
- **FR-5.3** Kelola **Region, Kota, Distributor**.
- **FR-5.4** **Import massal** dari Excel (bengkel & master data lain).

---

## 6. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| Kategori | Kebutuhan |
|---|---|
| **Platform** | Web mobile-first (dipakai dari HP MD di lapangan), juga jalan di desktop admin. |
| **Performa** | Foto dikompres sebelum upload; latency rendah (DB region Singapore). |
| **Keamanan** | RLS di semua tabel; kunci B2 hanya di server (Edge Function), tidak pernah ke client; presigned URL expire 15 menit; path foto memuat `userId` untuk audit. |
| **Biaya** | Mulai Rp 0 (free tier). Growth 50–200 MD ~Rp 500k/bln. |
| **Reliabilitas** | Foto disimpan di Backblaze B2 + CDN Cloudflare (egress gratis). |
| **Usability** | UI Bahasa Indonesia; alur input cepat untuk dipakai sambil berdiri di bengkel. |
| **Offline** | Saat ini online-required (kandidat peningkatan masa depan). |

---

## 7. Arsitektur & Stack Teknis

```
┌────────────────────────────────────────────────────────────┐
│  Frontend: React 18 + Vite 5 + Tailwind CSS                 │
│  (mobile-first PWA-style, deploy ke Cloudflare Pages)        │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴───────────┐                ┌───────────────┐
        │ Supabase (Postgres)   │                │ Backblaze B2  │
        │ - Auth (email/pass)   │   presigned    │ (foto POSM &  │
        │ - RLS tiap tabel      │◄──────────────►│  selfie absen)│
        │ - Edge Function (Deno)│   upload URL   └──────┬────────┘
        └───────────────────────┘                       │
                                              Cloudflare CDN
                                              (egress gratis)
```

**Komponen:**
- **Frontend**: React + Vite + Tailwind; peta `leaflet`/`react-leaflet`; chart `recharts`; Excel `xlsx`; kompresi `browser-image-compression`.
- **Database**: PostgreSQL (Supabase), 8 migrasi terdokumentasi.
- **Auth**: Supabase Auth (email/password; WebAuthn disiapkan tapi disembunyikan).
- **Storage foto**: Backblaze B2 ($6/TB) + Cloudflare CDN (egress gratis).
- **Backend logic**: Supabase Edge Function `get-upload-url` (generate presigned URL B2).

### 7.1 Model Data (entitas inti)
- `profiles` — user (extends auth.users): role, region, target bulanan, aktif.
- `regions` → `kotas` → `bengkels` (hierarki wilayah).
- `distributors` (per region) — dipilih per-visit.
- `visits` — **entitas inti**: MD, bengkel, tanggal, PIC, distributor, status+sub-tipe, GPS, 7 slot foto.
- `attendances` — absen: 1 baris/MD/hari (check-in & check-out: waktu, GPS, foto, catatan).

---

## 8. Alur Pengguna Utama (User Flows)

**A. MD melaporkan kunjungan**
1. Login → 2. Absen Masuk (selfie + GPS) → 3. Datang ke bengkel → 4. Buka form Visit → 5. Pilih bengkel, isi PIC, distributor, status → 6. Ambil foto before/after → 7. Submit (GPS otomatis) → 8. Lanjut bengkel berikutnya → 9. Absen Pulang.

**B. Admin memantau & merekap**
1. Login admin → 2. Dashboard (lihat KPI & pencapaian target) → 3. Coverage (peta bengkel terkover) → 4. Rekap Absen (filter bulan/MD) → 5. Export Excel untuk laporan manajemen.

---

## 9. Asumsi & Ketergantungan
- MD memiliki smartphone dengan kamera & GPS, serta koneksi data di lapangan.
- Layanan pihak ketiga (Supabase, Backblaze, Cloudflare) tersedia.
- Master data bengkel & MD dipelihara akurat oleh Admin.

---

## 10. Risiko
| Risiko | Dampak | Mitigasi |
|---|---|---|
| Sinyal lemah di lapangan | Gagal submit/upload | (Future) mode offline/antrian; kompresi foto |
| GPS palsu / mock location | Bukti tak valid | Catat lat/lng + timestamp; audit; (future) deteksi mock |
| Biaya storage naik saat skala | Biaya membengkak | B2 murah + CDN gratis; arsip foto lama |
| Ketergantungan free tier | Limit terlampaui | Path upgrade ke Supabase Pro sudah terdefinisi |

---

## 11. Roadmap Singkat (peningkatan ke depan)
- **App native (React Native/Expo)** — port aplikasi (sedang dieksplorasi).
- **Mode offline** / antrian upload saat sinyal kembali.
- **Notifikasi** pengingat absen & target.
- **Deteksi mock GPS** untuk anti-kecurangan.
- **Approval workflow** untuk verifikasi BP atas laporan MD.

---

*Dokumen ini menggambarkan kondisi produk per tanggal di atas; perbarui seiring penambahan fitur.*
