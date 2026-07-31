-- ============================================================
-- Migration 0013 — Hanya super_admin yang boleh hapus visit & absen
-- ============================================================
-- Sebelumnya is_admin() (admin biasa + super_admin) bisa delete.
-- Sekarang dipersempit ke is_super_admin() saja.
-- ============================================================

drop policy if exists visits_admin_delete on visits;
create policy visits_admin_delete on visits for delete using (is_super_admin());

drop policy if exists attendances_admin_delete on attendances;
create policy attendances_admin_delete on attendances for delete using (is_super_admin());
