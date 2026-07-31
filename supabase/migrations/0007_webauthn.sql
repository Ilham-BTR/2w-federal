-- ============================================================
-- 0007 — WebAuthn / Passkey (login biometrik server-side)
-- ============================================================
-- Menyimpan PUBLIC KEY passkey di server. Password tidak pernah disimpan.
-- Private key tetap terkunci di hardware HP (Secure Enclave/TEE).
--
-- Dua tabel:
--   webauthn_credentials — public key + counter per perangkat per user
--   webauthn_challenges  — challenge sementara (anti-replay), dihapus saat verify
--
-- Semua tulis/verify dilakukan oleh Edge Function `webauthn` pakai service_role
-- (bypass RLS). Client hanya boleh: lihat & hapus passkey miliknya sendiri.
-- ============================================================

create table if not exists webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  credential_id text unique not null,      -- base64url
  public_key text not null,                -- base64url (COSE)
  counter bigint not null default 0,
  transports text[],
  device_label text,
  created_at timestamptz default now(),
  last_used_at timestamptz
);
create index if not exists webauthn_creds_user_idx on webauthn_credentials(user_id);

create table if not exists webauthn_challenges (
  key text primary key,                    -- challenge (base64url) = anti-replay token
  user_id uuid,                            -- diisi untuk flow registrasi; null untuk login
  expires_at timestamptz not null default (now() + interval '5 minutes')
);

-- RLS
alter table webauthn_credentials enable row level security;
alter table webauthn_challenges enable row level security;

-- Client: lihat passkey sendiri
drop policy if exists webauthn_creds_select_own on webauthn_credentials;
create policy webauthn_creds_select_own on webauthn_credentials
  for select using (user_id = auth.uid());

-- Client: hapus passkey sendiri ("Lupakan passkey")
drop policy if exists webauthn_creds_delete_own on webauthn_credentials;
create policy webauthn_creds_delete_own on webauthn_credentials
  for delete using (user_id = auth.uid());

-- Insert/update credentials & semua akses ke challenges: HANYA service_role
-- (tidak ada policy untuk authenticated/anon → diblokir; service_role bypass RLS).

-- Helper: bersihkan challenge kedaluwarsa (dipanggil dari edge function sesekali)
create or replace function cleanup_webauthn_challenges()
returns void language sql security definer set search_path = public as $$
  delete from webauthn_challenges where expires_at < now();
$$;

-- ============================================================
-- SELESAI. Lanjut: deploy Edge Function `webauthn`.
-- ============================================================
