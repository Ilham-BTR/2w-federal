# 2W Federal POSM Tracker

Aplikasi web full-stack untuk tracking pemasangan POSM (Point of Sale Materials) 2W Federal oleh Field MD.

**Stack:**
- Frontend: React 18 + Vite 5 + Tailwind CSS
- Database: PostgreSQL via Supabase
- Auth: Supabase Auth (email/password)
- Photo Storage: **Object storage S3-compatible** (presigned upload via Edge Function). Produksi pakai **Cloudflare R2** (cepat dari Indonesia, egress gratis lewat domain sendiri); **Backblaze B2 / AWS S3 / MinIO** juga jalan tanpa ubah kode.
- Maps: **Leaflet** + tile CARTO light (gratis, tanpa token) — opsional upgrade ke **Mapbox** via `VITE_MAPBOX_TOKEN`
- Backend Logic: Supabase Edge Functions (Deno) — `get-upload-url`, `admin-create-md`, `webauthn`

> **Alur foto:** client → Edge Function `get-upload-url` (validasi JWT, generate presigned PUT URL) → client PUT file langsung ke storage → URL publik foto disimpan di DB.
> Kunci storage **tidak pernah** sampai ke browser. Saat domain + CDN siap, cukup set secret `CDN_BASE_URL` (lihat Step 2.4) — tanpa ubah kode.

> ♻️ **Pakai sebagai template:** repo ini dirancang generik. Untuk app serupa, fork repo → ganti branding/label di `src/App.jsx` → buat project Supabase baru & jalankan `supabase/setup_fresh.sql` → buat bucket storage baru → isi `.env.local` → deploy. Semua langkah ada di **Full Stack Setup** di bawah. Tidak ada credential yang ter-commit (semua di `.env.local` + Supabase secrets, sudah di-gitignore).

---

## 🚀 Quick Start (Mock Mode — tanpa setup backend)

Cara tercepat untuk lihat app dulu, tanpa setup database:

```bash
npm install
npm run dev
```

Browser akan buka di `http://localhost:5173`. App jalan dengan **mock data** in-memory (foto disimpan di IndexedDB browser).

**Demo credentials:**
- MD: `budi@federal.id` / `federal`
- MD: `andi@federal.id` / `federal`
- Admin: `admin@federal.id` / `federal`

⚠️ Data hanya tersimpan di browser ini. Untuk persistent storage multi-device, lanjut ke setup full stack di bawah.

---

## 🏗️ Full Stack Setup (Production)

Empat langkah: (1) Supabase database, (2) Backblaze B2 + Edge Function, (3) konfigurasi frontend, (4) deploy.

### Step 1: Setup Supabase (database + auth)

1. **Daftar gratis di [supabase.com](https://supabase.com)** → New Project
   - Region: **Southeast Asia (Singapore)** untuk latency terbaik
   - Database password: simpan baik-baik
   - Tunggu ~2 menit project siap

2. **Jalankan schema database:**
   - Dashboard → SQL Editor → New Query
   - Copy seluruh isi `supabase/setup_fresh.sql` → paste → Run
   - Cek di Table Editor: harus ada tabel `profiles`, `regions`, `kotas`, `distributors`, `bengkels`, `visits`, `attendances`

3. **Buat user pertama (admin):**
   - Authentication → Users → Add User → Create new user
   - Email: `admin@federal.id`, password bebas (min 6 karakter)
   - Profile row dibuat otomatis oleh trigger `handle_new_user`. Buka Table Editor → `profiles` → set `role` = `admin`.

4. **Ambil API credentials:**
   - Settings → API → copy `Project URL` dan `anon public key`

> Foto **tidak** lagi disimpan di Supabase Storage — jadi `supabase/storage_setup.sql` tidak perlu dijalankan. Lihat Step 2.

### Step 2: Setup Object Storage + Edge Function (storage foto)

Storage-nya **S3-compatible**, jadi bisa pilih: **Cloudflare R2** (rekomendasi — upload cepat dari Indonesia, egress gratis lewat custom domain), **Backblaze B2**, **AWS S3**, atau **MinIO**. Edge Function `get-upload-url` pakai S3 API + secret bernama `B2_*` apa pun providernya — **kode tidak berubah**.

<details>
<summary><b>Opsi A — Cloudflare R2 (rekomendasi)</b></summary>

1. Cloudflare Dashboard → R2 → Create bucket (mis. `federal-2w-posm-photos`, location **APAC**).
2. R2 → Manage R2 API Tokens → Create → **Object Read & Write**, scope ke bucket itu → simpan **Access Key ID** & **Secret**.
3. Set CORS bucket (allowedOrigins = `http://localhost:5173` + domain produksi; methods PUT/GET/HEAD). Bisa via `wrangler r2 bucket cors put` atau dashboard.
4. (Opsional) Custom domain untuk serving publik → set `CDN_BASE_URL` (Step 2.4). r2.dev publik bisa dimatikan.
5. Lanjut ke "Deploy Edge Function + secrets" di bawah dengan nilai R2:
   - `B2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `B2_REGION=auto`
   - `B2_KEY_ID`=Access Key ID, `B2_APPLICATION_KEY`=Secret, `B2_BUCKET_NAME`=nama bucket
</details>

<details>
<summary><b>Opsi B — Backblaze B2</b></summary>

1. **Buat bucket B2:**
   - Daftar [backblaze.com](https://www.backblaze.com) → B2 Cloud Storage (10GB free, tanpa kartu kredit)
   - Buckets → Create a Bucket → Name unik (mis. `federal-2w-posm-photos`) → Files: **Public**
   - Catat **endpoint** & **region** dari info bucket (mis. `s3.us-west-004.backblazeb2.com`, region `us-west-004`)
   - App Keys → Add a New Application Key → akses hanya bucket itu, **Read and Write** → simpan `keyID` & `applicationKey` (muncul SEKALI)

2. **Set CORS bucket** (wajib agar browser bisa PUT langsung ke B2). Paling mudah via [B2 CLI](https://www.backblaze.com/docs/cloud-storage-command-line-tools):
   ```bash
   b2 update-bucket --cors-rules '[
     {
       "corsRuleName": "federal2wUpload",
       "allowedOrigins": ["http://localhost:5173", "https://your-app-domain.com"],
       "allowedOperations": ["s3_put", "s3_get", "s3_head"],
       "allowedHeaders": ["*"],
       "exposeHeaders": ["etag"],
       "maxAgeSeconds": 3600
     }
   ]' federal-2w-posm-photos allPublic
   ```
   Ganti `https://your-app-domain.com` dengan domain produksi app (boleh tambah lebih dari satu origin).
</details>

**2.3 — Deploy Edge Function + set secrets** (sama untuk R2 maupun B2):
```bash
npm install -g supabase
supabase login
supabase link --project-ref <PROJECT_REF>        # PROJECT_REF ada di URL dashboard

supabase functions deploy get-upload-url
# Nilai di bawah contoh Backblaze B2; untuk R2 pakai nilai dari Opsi A
supabase secrets set \
  B2_KEY_ID=<keyID / R2 Access Key ID> \
  B2_APPLICATION_KEY=<applicationKey / R2 Secret> \
  B2_BUCKET_NAME=federal-2w-posm-photos \
  B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com \
  B2_REGION=us-west-004
```
> `CDN_BASE_URL` **sengaja belum diset** → foto di-serve langsung dari storage. Lihat 2.4 untuk mengaktifkan CDN/custom domain nanti.

**2.4 — (OPSIONAL — nanti, saat sudah punya domain) CDN / custom domain = egress gratis:**
- **R2:** R2 bucket → Settings → Custom Domain → arahkan ke subdomain (mis. `img.domain-anda.com`).
- **B2:** tambahkan domain ke Cloudflare → DNS → CNAME `cdn` → target host B2 (mis. `f004.backblazeb2.com`), **Proxy ON**.
- Lalu: `supabase secrets set CDN_BASE_URL=https://img.domain-anda.com`
- Foto **baru** otomatis pakai URL CDN — **tidak perlu ubah kode atau re-deploy frontend**.

### Step 3: Konfigurasi Frontend

1. **Copy template environment:**
   ```bash
   cp .env.example .env.local
   ```

2. **Edit `.env.local`:**
   ```env
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key-dari-step-1>
   ```
   > Tidak perlu var B2/CDN di client — URL foto datang dari Edge Function.

3. **Run:**
   ```bash
   npm run dev
   ```

Banner kuning "Mode Demo" harusnya hilang — tandanya sudah production mode.

### Step 4: Deploy Frontend (Cloudflare Pages / Vercel)

App ini static build (Vite), bisa di-deploy ke mana saja. Contoh Cloudflare Pages:

1. Push code ke GitHub
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
3. Build settings: Framework **Vite**, Build command `npm run build`, Output directory `dist`
4. Environment variables → tambah `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`
5. Deploy → app live (gratis, unlimited bandwidth)

> Repo juga punya `vercel.json` — deploy ke Vercel sama mudahnya: import repo, set 2 env var di atas.
> Fitur opsional `admin-create-md` & `webauthn` (passkey) juga Edge Function — deploy bila dipakai: `supabase functions deploy admin-create-md webauthn`.

---

## 📁 Struktur Project

```
federal-2w-posm/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── .env.example
│
├── src/
│   ├── main.jsx
│   ├── App.jsx                # Semua UI components
│   ├── index.css
│   └── lib/
│       ├── supabase.js        # Supabase client singleton + MOCK_MODE
│       ├── api.js             # Data access layer (CRUD + auth)
│       ├── storage.js         # Upload foto → B2 via presigned URL (mock: IndexedDB)
│       ├── photoStore.js      # Helper IndexedDB untuk mock mode
│       └── seedData.js        # Seed bengkel untuk mock mode
│
└── supabase/
    ├── config.toml
    ├── setup_fresh.sql        # Schema lengkap (jalankan sekali di project baru)
    ├── storage_setup.sql      # (Tidak dipakai lagi — peninggalan jalur Supabase Storage)
    ├── supabase_seed.sql      # Seed data opsional
    ├── migrations/            # Riwayat perubahan schema per langkah (0001..0014)
    └── functions/
        ├── get-upload-url/    # Edge Function: presigned PUT URL ke storage S3 (foto visit & absen)
        ├── admin-create-md/   # Edge Function: admin bikin akun MD
        └── webauthn/          # Edge Function: passkey (default disembunyikan)
```

---

## 💰 Estimasi Biaya Bulanan

| Tahap | Setup | Biaya/bulan |
|-------|-------|-------------|
| Demo / Dev | Mock mode, no backend | **Rp 0** |
| Start | Supabase Free + B2 Free (10GB) | **Rp 0** |
| Growth (50-200 MD) | Supabase Pro ($25) + B2 ($6/TB) + egress B2 ($0,01/GB tanpa CDN) | **~Rp 450k** |
| Scale (200+ MD) | Supabase + B2 + **Cloudflare CDN (egress gratis)** | **~Rp 500k** |

> Foto ~1,4 MB/kunjungan (7 foto terkompres). Storage B2 sangat murah ($0,006/GB); biaya utama saat skala besar adalah **egress** — itulah kenapa Cloudflare CDN (egress gratis via Bandwidth Alliance) layak dipasang begitu punya domain.

---

## 🔐 Security Notes

- **Kunci B2 tidak pernah ke client** — hanya di Edge Function secrets. Browser cuma menerima presigned PUT URL (berlaku 15 menit).
- **Row Level Security aktif di semua tabel:**
  - MD hanya bisa lihat visit & absen miliknya sendiri
  - Admin/BP bisa lihat & kelola semua data
- Path foto di B2 memuat `userId` (`visits/{userId}/...`, `attendance/{userId}/...`) — Edge Function memaksa `userId` dari JWT, jadi MD tak bisa menulis di folder MD lain.
- Bucket B2 Public hanya untuk **baca** foto. Bila pasang Cloudflare, aktifkan Hotlink Protection agar URL foto tak bisa di-leech.
- `anon key` aman dipakai di client — keamanan ditegakkan oleh RLS + validasi Edge Function.

---

## 🧪 Testing

```bash
# Run dev server
npm run dev

# Build production bundle
npm run build

# Preview production build locally
npm run preview

# Test edge function get-upload-url lokal (perlu secrets B2 di .env)
supabase functions serve get-upload-url --env-file .env.local
```

---

## ❓ Troubleshooting

**Banner "Mode Demo" tidak hilang setelah set .env.local**
→ Restart dev server (`Ctrl+C` lalu `npm run dev`). Vite hanya baca env saat startup.

**Login gagal: "Invalid email or password"**
→ Pastikan user sudah dibuat di Supabase Authentication. Profile row dibuat otomatis oleh trigger `handle_new_user`.

**Upload foto gagal: "Gagal minta upload URL"**
→ Edge Function `get-upload-url` belum ter-deploy atau secret B2 belum di-set. Cek Supabase Dashboard → Edge Functions → get-upload-url → Logs.

**Upload foto gagal: error CORS di console browser**
→ CORS bucket B2 belum benar. Pastikan origin app (mis. `http://localhost:5173`) ada di `allowedOrigins` (Step 2.2).

**Upload OK tapi foto tidak muncul**
→ Pastikan bucket B2 bertanda **Public**. Coba buka public URL foto langsung di browser. Kalau pakai Cloudflare, cek DNS/Proxy sudah benar.

**RLS error: "new row violates row-level security policy"**
→ Kemungkinan profile user belum dibuat. Cek table `profiles` apakah row untuk user tsb ada.
