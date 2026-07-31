-- ============================================================
-- Migration 0009 — Role super_admin + simpan password MD
-- ============================================================
-- Tujuan:
--   - Tambah role 'super_admin'. Kelola akun MD (create/edit/hapus) hanya
--     untuk super_admin; admin/bp tetap bisa LIHAT semua profil + password.
--   - Tambah kolom profiles.login_password agar admin bisa MELIHAT password MD
--     (Supabase meng-hash password asli sehingga tak bisa dibaca balik).
--
-- Catatan teknis:
--   Helper RLS pakai perbandingan ::text, bukan literal enum, supaya seluruh
--   skrip aman dijalankan sekali (ALTER TYPE ADD VALUE tak boleh "dipakai"
--   sebagai enum di transaksi yang sama).
--
-- Cara pakai: paste seluruh file ini ke Supabase SQL Editor → Run.
-- Lalu jalankan TERPISAH baris promosi super admin di bagian bawah.
-- ============================================================

-- 1. Tambah nilai enum baru
alter type user_role add value if not exists 'super_admin';

-- 2. Kolom password MD (terlihat oleh admin/super_admin)
alter table profiles add column if not exists login_password text;

-- 3. Helper role
create or replace function is_admin()
returns boolean language sql security definer stable as $$
  select get_user_role()::text in ('admin', 'bp', 'super_admin')
$$;

create or replace function is_super_admin()
returns boolean language sql security definer stable as $$
  select get_user_role()::text = 'super_admin'
$$;

-- 4. Kelola (insert/update/delete) profil ORANG LAIN → hanya super_admin.
--    Admin/BP tetap BACA semua profil via policy profiles_read_own (is_admin()).
--    Tiap user tetap bisa update profilnya sendiri via profiles_update_own.
drop policy if exists profiles_admin_all on profiles;
drop policy if exists profiles_super_manage on profiles;
create policy profiles_super_manage on profiles for all using (is_super_admin());

-- ============================================================
-- PROMOSI SUPER ADMIN — jalankan TERPISAH (setelah skrip di atas selesai),
-- ganti email dengan akun super admin-mu:
--
--   update profiles set role = 'super_admin' where email = 'admin@federal.id';
-- ============================================================
