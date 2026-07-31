-- ============================================================
-- Migration 0011 — Batasi visibilitas akun (profiles)
-- ============================================================
-- - super_admin : lihat SEMUA profil (kelola semua akun).
-- - admin / bp  : hanya lihat profil role 'md' (+ profil sendiri).
-- - tl          : hanya lihat profil role 'md' di region-nya (+ sendiri).
-- - md          : hanya profilnya sendiri.
--
-- Tujuan: admin biasa tak bisa melihat akun (apalagi password) super_admin/
-- admin/tl lain — hanya akun MD.
-- ============================================================

drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles for select using (
  auth.uid() = id
  or is_super_admin()
  or (is_admin() and role::text = 'md')
  or (is_tl() and role::text = 'md' and region_id = get_user_region())
);
