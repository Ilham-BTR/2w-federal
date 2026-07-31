-- ============================================================
-- 2W Federal MD — Setup Supabase Storage untuk foto visit
-- ============================================================
-- Paste & Run di SQL Editor SETELAH setup_fresh.sql.
-- Bikin bucket publik `visit-photos` + policy upload untuk user login.
-- ============================================================

-- 1. Buat bucket publik (read foto via public URL)
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', true)
on conflict (id) do update set public = true;

-- 2. Policies di storage.objects untuk bucket ini
--    - Siapa pun boleh BACA (bucket publik, untuk tampil foto di app)
--    - User login (authenticated) boleh UPLOAD/UPDATE/DELETE foto

drop policy if exists "visit_photos_public_read" on storage.objects;
create policy "visit_photos_public_read" on storage.objects
  for select using (bucket_id = 'visit-photos');

drop policy if exists "visit_photos_auth_insert" on storage.objects;
create policy "visit_photos_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'visit-photos');

drop policy if exists "visit_photos_auth_update" on storage.objects;
create policy "visit_photos_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'visit-photos');

drop policy if exists "visit_photos_auth_delete" on storage.objects;
create policy "visit_photos_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'visit-photos');

-- ============================================================
-- SELESAI. Foto akan tersimpan di bucket visit-photos.
-- ============================================================
