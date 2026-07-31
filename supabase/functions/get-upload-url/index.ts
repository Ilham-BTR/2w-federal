// supabase/functions/get-upload-url/index.ts
//
// Edge Function untuk generate presigned URL upload ke Backblaze B2.
//
// Flow:
//   1. Client (authenticated MD) request URL ke endpoint ini
//   2. Function validate JWT, lalu generate presigned PUT URL (15 menit valid)
//   3. Client upload file langsung ke B2 pakai URL tsb (gak lewat server)
//   4. Server return juga public URL yang dipakai serve foto (B2 langsung, atau via Cloudflare CDN kalau CDN_BASE_URL diset)
//
// Mendukung 2 scope:
//   - scope='visit'      → key visits/{userId}/{visitId}/{photoKey}.{ext}
//   - scope='attendance' → key attendance/{userId}/{date}/{kind}.{ext}   (kind: in|out)
//
// Setup ENV di Supabase Dashboard → Edge Functions → Secrets:
//   B2_KEY_ID            (Backblaze application key ID)
//   B2_APPLICATION_KEY   (Backblaze application key)
//   B2_BUCKET_NAME       (mis. federal-2w-posm-photos)
//   B2_ENDPOINT          (mis. https://s3.us-west-004.backblazeb2.com)
//   B2_REGION            (mis. us-west-004)
//   CDN_BASE_URL         (OPSIONAL — mis. https://cdn.federal-2w.id. Kalau kosong, foto di-serve langsung dari B2)

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  S3Client,
  PutObjectCommand,
} from "npm:@aws-sdk/client-s3@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_PHOTO_KEYS = [
  "tampak-depan",
  "foto-in",
  "foto-out",
  "spanduk-before",
  "spanduk-putih",
  "spanduk-after",
  "poster-before",
  "poster-putih",
  "poster-after",
  "delivery-gimmick",
  "deploy-planogram",
];

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- 1. Authenticate via JWT (Supabase auth header) ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing auth header" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: "Invalid token" }, 401);
    }

    // --- 2. Parse + validate request body ---
    const body = await req.json();
    const { scope = "visit", contentType } = body;

    if (!contentType) {
      return json({ error: "Missing required field: contentType" }, 400);
    }
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return json({ error: "Only image/jpeg, image/png, image/webp allowed" }, 400);
    }

    const ext = contentType.split("/")[1].replace("jpeg", "jpg");

    // --- 3. Build S3 key (file path inside bucket) per scope ---
    // userId selalu dari JWT → MD hanya bisa menulis di foldernya sendiri (audit + keamanan)
    let objectKey: string;

    if (scope === "visit") {
      const { visitId, photoKey } = body;
      if (!visitId || !photoKey) {
        return json({ error: "Missing required fields: visitId, photoKey" }, 400);
      }
      if (!ALLOWED_PHOTO_KEYS.includes(photoKey)) {
        return json({ error: `Invalid photoKey. Allowed: ${ALLOWED_PHOTO_KEYS.join(", ")}` }, 400);
      }
      if (!/^[0-9a-f-]{36}$/i.test(visitId)) {
        return json({ error: "Invalid visitId format" }, 400);
      }
      objectKey = `visits/${user.id}/${visitId}/${photoKey}.${ext}`;
    } else if (scope === "attendance") {
      const { date, kind } = body;
      if (!date || !kind) {
        return json({ error: "Missing required fields: date, kind" }, 400);
      }
      if (!["in", "out"].includes(kind)) {
        return json({ error: "Invalid kind. Allowed: in, out" }, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "Invalid date format (YYYY-MM-DD)" }, 400);
      }
      objectKey = `attendance/${user.id}/${date}/${kind}.${ext}`;
    } else {
      return json({ error: "Invalid scope. Allowed: visit, attendance" }, 400);
    }

    // --- 4. Generate presigned PUT URL ---
    const s3 = new S3Client({
      endpoint: Deno.env.get("B2_ENDPOINT")!,
      region: Deno.env.get("B2_REGION")!,
      credentials: {
        accessKeyId: Deno.env.get("B2_KEY_ID")!,
        secretAccessKey: Deno.env.get("B2_APPLICATION_KEY")!,
      },
      forcePathStyle: true, // required for B2
    });

    const command = new PutObjectCommand({
      Bucket: Deno.env.get("B2_BUCKET_NAME")!,
      Key: objectKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 }); // 15 min

    // Public URL: pakai Cloudflare CDN kalau CDN_BASE_URL diset (egress gratis),
    // kalau belum (mis. belum punya domain) fallback ke URL publik B2 langsung.
    // B2 path-style: {endpoint}/{bucket}/{key} — valid untuk bucket Public.
    const cdn = Deno.env.get("CDN_BASE_URL");
    const publicUrl = cdn
      ? `${cdn.replace(/\/$/, "")}/${objectKey}`
      : `${Deno.env.get("B2_ENDPOINT")!.replace(/\/$/, "")}/${Deno.env.get("B2_BUCKET_NAME")}/${objectKey}`;

    return json({ uploadUrl, publicUrl, objectKey });
  } catch (err) {
    console.error("Edge function error:", err);
    return json({ error: err.message || "Server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
