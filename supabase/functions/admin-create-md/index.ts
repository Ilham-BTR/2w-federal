// supabase/functions/admin-create-md/index.ts
//
// Bulk-create akun MD/BP/Admin dari import Excel.
//
// Kenapa perlu Edge Function (bukan langsung dari client):
//   Bikin user login butuh `auth.admin.createUser()` yang HANYA bisa dengan
//   SERVICE_ROLE key. Service role TIDAK BOLEH ada di client (full DB access).
//   Jadi creation di-route lewat function ini, yang:
//     1. Verifikasi pemanggil adalah admin (cek profiles.role)
//     2. Loop create user pakai service_role
//     3. Update profile (role, region_id, monthly_target)
//
// Setup ENV di Supabase Dashboard → Edge Functions → Secrets:
//   SUPABASE_URL              (auto-injected)
//   SUPABASE_ANON_KEY         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected, tapi pastikan tersedia)
//
// Deploy:  supabase functions deploy admin-create-md

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth header" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Client dengan token caller → verify dia admin
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) return json({ error: "Invalid token" }, 401);

    const { data: profile } = await callerClient
      .from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role !== "super_admin") {
      return json({ error: "Hanya super admin yang boleh kelola akun MD" }, 403);
    }

    // 2. Parse body
    const body = await req.json();

    // 3. Admin client (service_role)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2b. Aksi RESET PASSWORD untuk 1 akun
    if (body.action === "reset") {
      const { userId, password } = body;
      if (!userId || !password) return json({ error: "userId & password wajib" }, 400);
      const { error: uErr } = await admin.auth.admin.updateUserById(userId, { password });
      if (uErr) return json({ error: uErr.message }, 400);
      await admin.from("profiles").update({ login_password: password }).eq("id", userId);
      return json({ ok: true });
    }

    // 2c. Aksi HAPUS akun (hapus auth user → profil ikut cascade)
    if (body.action === "delete") {
      const { userId } = body;
      if (!userId) return json({ error: "userId wajib" }, 400);
      const { error: dErr } = await admin.auth.admin.deleteUser(userId);
      if (dErr) return json({ error: dErr.message }, 400);
      return json({ ok: true });
    }

    const { users } = body;
    if (!Array.isArray(users) || users.length === 0) {
      return json({ error: "Body 'users' kosong" }, 400);
    }

    const result = { inserted: 0, errors: [] as Array<{ row: number; message: string }> };

    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      try {
        const pw = u.password || (Math.random().toString(36).slice(-10) + "A1!");
        // Create auth user (email confirmed langsung biar bisa login)
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: String(u.email).toLowerCase().trim(),
          password: pw,
          email_confirm: true,
          user_metadata: { full_name: u.full_name, role: u.role || "md" },
        });
        if (cErr) { result.errors.push({ row: i + 1, message: cErr.message }); continue; }

        // Trigger handle_new_user sudah bikin row profile. Update field tambahan + simpan password (agar bisa dilihat admin).
        const { error: pErr } = await admin
          .from("profiles")
          .update({
            full_name: u.full_name,
            role: u.role || "md",
            region_id: u.region_id || null,
            monthly_target: u.monthly_target ?? 30,
            login_password: pw,
          })
          .eq("id", created.user.id);
        if (pErr) { result.errors.push({ row: i + 1, message: pErr.message }); continue; }

        // TL multi-region → simpan daftar region ke tl_regions
        if (u.role === "tl" && Array.isArray(u.region_ids)) {
          await admin.from("tl_regions").delete().eq("tl_id", created.user.id);
          const ids = u.region_ids.filter(Boolean);
          if (ids.length) {
            await admin.from("tl_regions")
              .insert(ids.map((rid: string) => ({ tl_id: created.user.id, region_id: rid })));
          }
        }

        result.inserted++;
      } catch (e) {
        result.errors.push({ row: i + 1, message: (e as Error).message });
      }
    }

    return json(result);
  } catch (err) {
    console.error("admin-create-md error:", err);
    return json({ error: (err as Error).message || "Server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
