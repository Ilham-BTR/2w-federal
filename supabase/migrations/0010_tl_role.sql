-- ============================================================
-- Migration 0010 — Role TL (Team Leader): read-only, scoped per region
-- ============================================================
-- TL hanya MELIHAT data (MD, visit, absen) yang region MD-nya = region TL.
-- Tidak boleh create/edit/hapus apa pun.
--
-- Catatan: helper pakai SECURITY DEFINER (hindari rekursi RLS) & perbandingan
-- ::text (aman dijalankan satu skrip walau enum baru ditambah di skrip yang sama).
-- ============================================================

alter type user_role add value if not exists 'tl';

-- Helper region (security definer → tak kena RLS, tak rekursi)
create or replace function get_user_region()
returns uuid language sql security definer stable as $$
  select region_id from profiles where id = auth.uid()
$$;
create or replace function is_tl()
returns boolean language sql security definer stable as $$
  select get_user_role()::text = 'tl'
$$;
create or replace function md_region(mid uuid)
returns uuid language sql security definer stable as $$
  select region_id from profiles where id = mid
$$;

-- profiles: TL lihat profil di region-nya
drop policy if exists profiles_read_own on profiles;
create policy profiles_read_own on profiles for select
  using (auth.uid() = id or is_admin() or (is_tl() and region_id = get_user_region()));

-- visits: TL lihat visit MD di region-nya
drop policy if exists visits_md_select_own on visits;
create policy visits_md_select_own on visits for select
  using (md_id = auth.uid() or is_admin() or (is_tl() and md_region(md_id) = get_user_region()));

-- attendances: TL lihat absen MD di region-nya
drop policy if exists attendances_select on attendances;
create policy attendances_select on attendances for select
  using (md_id = auth.uid() or is_admin() or (is_tl() and md_region(md_id) = get_user_region()));

-- View absen → security_invoker agar RLS attendances+profiles tersaring sesuai
-- pemanggil (sebelumnya regular view = bypass RLS). Menutup celah lama sekaligus.
alter view attendance_details set (security_invoker = on);

-- TL tidak punya policy write apa pun → otomatis read-only.
-- Master data (region/kota/distributor/bengkel) sudah readable utk semua authenticated.
