// supabase/functions/webauthn/index.ts
//
// Passkey / WebAuthn server-side untuk 2W Federal POSM.
// Password TIDAK pernah disimpan. Server hanya simpan PUBLIC KEY.
//
// Empat action (lewat body.action):
//   reg-options   — (butuh login) buat options registrasi passkey
//   reg-verify    — (butuh login) verifikasi attestation, simpan public key
//   auth-options  — (publik) buat challenge login (discoverable / passkey)
//   auth-verify   — (publik) verifikasi assertion → mint sesi via magic-link token
//
// Origin & RP ID diturunkan otomatis dari header Origin (jadi jalan di
// domain Vercel mana pun + localhost, tanpa env tambahan).
//
// ENV (auto-injected): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Deploy:  supabase functions deploy webauthn

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@13";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// base64url <-> bytes
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64url(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Ambil challenge (base64url) dari clientDataJSON di dalam response
function challengeFromResponse(response: any): string {
  const cdj = response?.response?.clientDataJSON;
  if (!cdj) throw new Error("clientDataJSON kosong");
  const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(cdj)));
  return data.challenge as string; // base64url
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const origin = req.headers.get("origin") || "";
    if (!origin) return json({ error: "Origin header tidak ada" }, 400);
    const rpID = new URL(origin).hostname;
    const expectedOrigin = origin;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const action = body.action as string;

    // Bersihkan challenge kedaluwarsa (best-effort)
    admin.rpc("cleanup_webauthn_challenges").then(() => {}, () => {});

    // ── Flow yang butuh login (registrasi passkey) ──
    if (action === "reg-options" || action === "reg-verify") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Harus login dulu" }, 401);
      const caller = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await caller.auth.getUser();
      if (authErr || !user) return json({ error: "Token tidak valid" }, 401);

      if (action === "reg-options") {
        const { data: creds } = await admin
          .from("webauthn_credentials")
          .select("credential_id, transports")
          .eq("user_id", user.id);

        const options = await generateRegistrationOptions({
          rpName: "2W Federal POSM",
          rpID,
          userID: new TextEncoder().encode(user.id),
          userName: user.email ?? user.id,
          attestationType: "none",
          excludeCredentials: (creds ?? []).map((c) => ({
            id: c.credential_id,
            transports: c.transports ?? undefined,
          })),
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
            authenticatorAttachment: "platform",
          },
        });

        await admin.from("webauthn_challenges").upsert({ key: options.challenge, user_id: user.id });
        return json(options);
      }

      // reg-verify
      const response = body.response;
      const challenge = challengeFromResponse(response);
      const { data: ch } = await admin
        .from("webauthn_challenges").select("*")
        .eq("key", challenge).gte("expires_at", new Date().toISOString()).maybeSingle();
      if (!ch) return json({ error: "Challenge tidak valid / kedaluwarsa" }, 400);
      await admin.from("webauthn_challenges").delete().eq("key", challenge);

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: "Verifikasi passkey gagal" }, 400);
      }

      const cred = verification.registrationInfo.credential; // { id, publicKey, counter, transports }
      const { error: insErr } = await admin.from("webauthn_credentials").insert({
        user_id: user.id,
        credential_id: cred.id,
        public_key: bytesToB64url(cred.publicKey),
        counter: cred.counter ?? 0,
        transports: cred.transports ?? null,
        device_label: body.label ?? null,
      });
      if (insErr) return json({ error: insErr.message }, 500);
      return json({ verified: true });
    }

    // ── Login passkey (publik, tanpa password) ──
    if (action === "auth-options") {
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        allowCredentials: [], // discoverable → browser tampilkan pilihan passkey
      });
      await admin.from("webauthn_challenges").upsert({ key: options.challenge, user_id: null });
      return json(options);
    }

    if (action === "auth-verify") {
      const response = body.response;
      const challenge = challengeFromResponse(response);
      const { data: ch } = await admin
        .from("webauthn_challenges").select("*")
        .eq("key", challenge).gte("expires_at", new Date().toISOString()).maybeSingle();
      if (!ch) return json({ error: "Challenge tidak valid / kedaluwarsa" }, 400);
      await admin.from("webauthn_challenges").delete().eq("key", challenge);

      const credId = response.id as string; // base64url
      const { data: credRow } = await admin
        .from("webauthn_credentials")
        .select("*, profiles!inner(email)")
        .eq("credential_id", credId)
        .maybeSingle();
      if (!credRow) return json({ error: "Passkey tidak dikenali di server" }, 400);

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credRow.credential_id,
          publicKey: b64urlToBytes(credRow.public_key),
          counter: Number(credRow.counter),
          transports: credRow.transports ?? undefined,
        },
      });
      if (!verification.verified) return json({ error: "Verifikasi passkey gagal" }, 400);

      await admin.from("webauthn_credentials")
        .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
        .eq("id", credRow.id);

      // Mint sesi tanpa password: generate magic-link token, client tukar via verifyOtp
      const email = (credRow as any).profiles.email as string;
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (linkErr || !link?.properties?.hashed_token) {
        return json({ error: linkErr?.message || "Gagal membuat sesi" }, 500);
      }
      return json({ token_hash: link.properties.hashed_token });
    }

    return json({ error: "Action tidak dikenali" }, 400);
  } catch (err) {
    console.error("webauthn error:", err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});
