-- ============================================================
-- 2W Federal MD — IZIN EDIT FOTO VISIT
-- ============================================================
-- Visit yang sudah dikirim terkunci buat MD. Kalau ternyata perlu
-- diperbaiki (mis. bengkel yang tadinya tidak ketemu ternyata ketemu dan
-- spanduknya terpasang), MD mengajukan izin ke super admin. Izin yang
-- disetujui hanya membuka SLOT FOTO pada satu visit itu dan berlaku 24 jam.
-- Hasil visit, tanggal, dan bengkel tetap hanya bisa diubah super admin.
-- ============================================================

create table if not exists visit_edit_requests (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  md_id       uuid not null references profiles(id) on delete cascade,
  reason      text,
  status      text not null default 'pending',   -- pending | approved | rejected
  decided_by  uuid references profiles(id) on delete set null,
  decided_at  timestamptz,
  expires_at  timestamptz,                       -- 24 jam sejak disetujui
  created_at  timestamptz not null default now()
);

create index if not exists visit_edit_requests_visit_idx  on visit_edit_requests(visit_id);
create index if not exists visit_edit_requests_md_idx     on visit_edit_requests(md_id);
create index if not exists visit_edit_requests_status_idx on visit_edit_requests(status);

-- Satu visit hanya boleh punya 1 permintaan yang masih menunggu keputusan,
-- supaya antrean super admin tidak dipenuhi permintaan kembar.
create unique index if not exists visit_edit_requests_pending_uniq
  on visit_edit_requests(visit_id) where status = 'pending';

alter table visit_edit_requests enable row level security;

-- MD lihat permintaannya sendiri; admin lihat semua.
drop policy if exists visit_edit_requests_select on visit_edit_requests;
create policy visit_edit_requests_select on visit_edit_requests for select
  using (md_id = auth.uid() or is_admin());

-- MD hanya boleh mengajukan atas nama dirinya sendiri, untuk visit miliknya.
drop policy if exists visit_edit_requests_insert on visit_edit_requests;
create policy visit_edit_requests_insert on visit_edit_requests for insert
  with check (
    md_id = auth.uid()
    and exists (select 1 from visits v where v.id = visit_id and v.md_id = auth.uid())
  );

-- Keputusan setuju/tolak dilakukan admin (di aplikasi dibatasi super admin).
drop policy if exists visit_edit_requests_update on visit_edit_requests;
create policy visit_edit_requests_update on visit_edit_requests for update
  using (is_admin());
