-- ============================================================
-- 2W Federal — HAPUS WEBAUTHN / PASSKEY
-- ============================================================
-- Login biometrik/passkey dibuang: fiturnya tidak pernah dipakai di
-- produksi (kedua tabel 0 baris) dan sudah dimatikan di UI lewat flag.
-- Menghapusnya menyederhanakan basis kode sekaligus rencana migrasi auth.
-- Aman dijalankan berkali-kali (IF EXISTS).
-- ============================================================

drop function if exists cleanup_webauthn_challenges();
drop table if exists webauthn_challenges;
drop table if exists webauthn_credentials;
