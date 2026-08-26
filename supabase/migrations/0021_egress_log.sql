-- ============================================================
-- 2W Federal — LOG EGRESS LIVE (hitung panggilan per-endpoint)
-- ============================================================
-- Supabase pakai transfer chunked (tak ada content-length), jadi byte wire tak
-- terbaca di klien. Tapi UKURAN per-endpoint sudah diukur akurat oleh
-- ops/egress-report.mjs; yang kurang = FREKUENSI panggilan nyata di produksi.
-- Klien menghitung panggilan per path (nyaris gratis, tanpa baca body) lalu
-- mengirim batch saat tab disembunyikan. reqs x ukuran = estimasi egress live.
-- ============================================================

create table if not exists egress_log (
  day  date    not null default current_date,
  path text    not null,
  reqs integer not null default 0,
  primary key (day, path)
);
alter table egress_log enable row level security;

-- Tulis hanya lewat RPC ini (tak ada policy insert langsung). Upsert menambah.
create or replace function bump_egress(items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  for it in select value from jsonb_array_elements(items) loop
    insert into egress_log (day, path, reqs)
    values (current_date, it->>'path', greatest((it->>'reqs')::int, 0))
    on conflict (day, path) do update set reqs = egress_log.reqs + excluded.reqs;
  end loop;
end $$;
grant execute on function bump_egress(jsonb) to authenticated;

drop policy if exists egress_read on egress_log;
create policy egress_read on egress_log for select using (is_admin());
