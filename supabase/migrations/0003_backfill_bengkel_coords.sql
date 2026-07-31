-- ============================================================
-- Migration 0003 — Backfill Bengkel Coords dari MD Visit
-- ============================================================
-- Pattern: MD pertama yang visit bengkel tanpa koord menjadi
-- "surveyor" yang otomatis ngeset bengkel master.lat/lng.
--
-- RLS bengkels saat ini cuma admin yang boleh UPDATE.
-- Function ini pakai SECURITY DEFINER agar MD bisa trigger
-- backfill VIA function ini saja — bukan UPDATE langsung.
--
-- Safety:
--   - Hanya update kalau lat OR lng masih NULL (idempotent)
--   - Tidak overwrite koordinat yang sudah ada
--   - Param di-validate (NOT NULL, range valid)
-- ============================================================

create or replace function backfill_bengkel_coords(
  p_bengkel_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  -- Param validation
  if p_bengkel_id is null or p_lat is null or p_lng is null then
    return false;
  end if;

  -- Lat valid range: -90 .. 90, Lng: -180 .. 180
  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return false;
  end if;

  -- Idempotent: hanya update kalau salah satu koord masih NULL
  update bengkels
    set lat = p_lat,
        lng = p_lng,
        updated_at = now()
    where id = p_bengkel_id
      and (lat is null or lng is null);

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Authenticated users (termasuk MD) boleh execute, tapi
-- function body sendiri yang validate & restrict apa yang bisa di-update.
grant execute on function backfill_bengkel_coords(uuid, double precision, double precision) to authenticated;

comment on function backfill_bengkel_coords is
  'Idempotent backfill bengkel lat/lng dari MD GPS. Hanya update kalau koord master masih NULL.';
