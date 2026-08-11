// src/lib/storage.js
// Upload foto visit & selfie absen.
//   - MOCK_MODE  → IndexedDB (per-device, untuk demo/testing)
//   - Production → Backblaze B2 via presigned URL (edge function `get-upload-url`)
//
// Alur production (key B2 tidak pernah ke client):
//   1. invoke edge function `get-upload-url` → dapat { uploadUrl, publicUrl }
//   2. PUT file langsung ke B2 pakai uploadUrl
//   3. simpan publicUrl ke DB (di-serve langsung dari B2, atau via Cloudflare CDN kalau CDN_BASE_URL diset)

import { supabase, MOCK_MODE } from './supabase';
import { savePhoto } from './photoStore';

/**
 * Minta presigned URL ke edge function, lalu PUT file ke B2.
 * @param {string} scope - 'visit' | 'attendance'
 * @param {object} payload - field tambahan sesuai scope (visitId+photoKey, atau date+kind)
 * @param {File|Blob} file
 * @returns {Promise<string>} public URL foto
 */
// supabase-js hanya melaporkan "Edge Function returned a non-2xx status code"
// tanpa isi respons. Ambil penyebab aslinya dari error.context supaya pesan ke
// user menyebut masalahnya (sesi habis, tipe file ditolak, dsb).
async function invokeUploadUrl(body) {
  const { data, error } = await supabase.functions.invoke('get-upload-url', { body });
  if (!error) return data;

  let pesan = error.message;
  let status;
  const ctx = error.context;
  if (ctx && typeof ctx.text === 'function') {
    status = ctx.status;
    try {
      const teks = await ctx.text();
      pesan = JSON.parse(teks)?.error || JSON.parse(teks)?.message || teks || pesan;
    } catch { /* respons bukan JSON — pakai pesan bawaan */ }
  }
  const e = new Error(pesan);
  e.status = status;
  throw e;
}

// Error yang percuma diulang — masalahnya bukan di jaringan.
const fatal = (pesan) => Object.assign(new Error(pesan), { fatal: true });
const tidur = (ms) => new Promise(r => setTimeout(r, ms));

// Jeda antar percobaan. Sinyal seluler MD di lapangan sering hilang beberapa
// detik (jalur ke Cloudflare sempat tersendat), jadi jeda dinaikkan bertahap
// supaya percobaan berikutnya tidak jatuh di detik yang sama-sama buruk.
const JEDA_RETRY = [1500, 4000, 9000];

/** Satu siklus utuh: minta presigned URL lalu PUT file-nya. */
async function sekaliUpload(body, file, contentType) {
  let data;
  try {
    data = await invokeUploadUrl(body);
  } catch (e) {
    // 401 = access token kedaluwarsa (app dibiarkan terbuka lama).
    if (e.status === 401) {
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) throw fatal('Sesi login sudah habis. Logout lalu login lagi.');
      data = await invokeUploadUrl(body);        // gagal lagi → dilempar ke retry
    } else if (e.status >= 400 && e.status < 500) {
      // Ditolak server (tipe file, photoKey, visitId) — mengulang tak akan menolong.
      throw fatal(e.message);
    } else {
      throw e;
    }
  }
  if (!data?.uploadUrl) throw new Error(data?.error || 'Upload URL kosong dari server');

  // Content-Type WAJIB sama dengan yang ditandatangani edge function
  const res = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload ke storage gagal: ${res.status} ${res.statusText}`);
  return data.publicUrl;
}

/**
 * Upload dengan percobaan ulang otomatis. Presigned URL diminta ULANG tiap
 * percobaan (bukan dipakai lagi), supaya URL yang terlanjur kedaluwarsa atau
 * tanda tangan yang gagal ikut tergantikan.
 * @param {(percobaanKe:number, total:number)=>void} [onRetry] dipanggil sebelum mengulang
 */
async function presignAndPut(scope, payload, file, onRetry) {
  const contentType = file.type || 'image/jpeg';
  const body = { scope, ...payload, contentType };
  const maksimal = JEDA_RETRY.length;

  let terakhir;
  for (let percobaan = 0; percobaan <= maksimal; percobaan++) {
    if (percobaan > 0) {
      onRetry?.(percobaan, maksimal);
      await tidur(JEDA_RETRY[percobaan - 1]);
    }
    try {
      return await sekaliUpload(body, file, contentType);
    } catch (e) {
      if (e.fatal) throw e;
      terakhir = e;
      console.warn(`Upload foto gagal (percobaan ${percobaan + 1}/${maksimal + 1}):`, e.message);
    }
  }
  throw new Error(`${terakhir?.message || 'Upload gagal'} — sudah dicoba ${maksimal + 1}x. Cek sinyal lalu ketuk untuk ulangi.`);
}

/**
 * Upload satu foto.
 * @param {File|Blob} file - File hasil compression dari PhotoTile
 * @param {string} visitId - UUID visit
 * @param {string} photoKey - 'foto-in' | 'foto-out' | 'spanduk-before' | dst
 * @returns {Promise<string>} - public URL (B2/CDN) atau ref IndexedDB (mock)
 */
export async function uploadVisitPhoto(file, visitId, photoKey, onRetry) {
  if (MOCK_MODE) {
    // Mock: simpan foto ke IndexedDB (persist antar-reload), return ref 'idb:visitId/key'
    const key = `${visitId}/${photoKey}`;
    try {
      await savePhoto(key, file);
      return `idb:${key}`;
    } catch (e) {
      console.warn('Gagal simpan foto ke IndexedDB, fallback blob URL:', e);
      return URL.createObjectURL(file);
    }
  }

  // Production: upload ke storage via presigned URL (dgn retry otomatis)
  return presignAndPut('visit', { visitId, photoKey }, file, onRetry);
}

/**
 * Upload selfie absen ke B2 (path attendance/{userId}/{date}/{kind}.jpg).
 * @param {File|Blob} file - selfie hasil compression
 * @param {string} mdId
 * @param {string} date - YYYY-MM-DD
 * @param {'in'|'out'} kind
 * @returns {Promise<string>} public URL (atau ref IndexedDB di mock)
 */
export async function uploadAttendancePhoto(file, mdId, date, kind, onRetry) {
  if (MOCK_MODE) {
    const key = `attendance/${mdId}/${date}/${kind}`;
    try {
      await savePhoto(key, file);
      return `idb:${key}`;
    } catch (e) {
      return URL.createObjectURL(file);
    }
  }

  // Production: mdId diabaikan; path pakai user.id dari JWT di server
  return presignAndPut('attendance', { date, kind }, file, onRetry);
}

/**
 * Upload semua foto visit secara paralel.
 * @param {Object} photos - { in: {file, ...}, out: {file, ...}, ... }
 * @param {string} visitId - UUID visit
 * @returns {Promise<Object>} - { photo_in, photo_out, photo_spanduk_before, ... } siap di-insert ke `visits`
 */
// Map UI key → DB column name + storage path
export const VISIT_PHOTO_MAP = {
  selfie:        { col: 'photo_selfie',         path: 'selfie' },
  before:        { col: 'photo_before',         path: 'tampak-depan-before' },
  after:         { col: 'photo_after',          path: 'tampak-depan-after' },
  spandukJauh:   { col: 'photo_spanduk_jauh',   path: 'spanduk-jauh' },
  spandukSedang: { col: 'photo_spanduk_sedang', path: 'spanduk-sedang' },
  poster:        { col: 'photo_poster',         path: 'poster' },
};

/**
 * Upload 1 foto visit (dipakai untuk upload-saat-foto-diambil / eager upload).
 * @returns {Promise<{col: string, url: string}>}
 */
export async function uploadOneVisitPhoto(file, visitId, uiKey, onRetry) {
  const m = VISIT_PHOTO_MAP[uiKey];
  if (!m) throw new Error('Foto key tak dikenal: ' + uiKey);
  const url = await uploadVisitPhoto(file, visitId, m.path, onRetry);
  return { col: m.col, url };
}

export async function uploadAllVisitPhotos(photos, visitId) {
  // Foto yang sudah ter-upload duluan (punya .url) tak di-upload ulang.
  const entries = Object.entries(photos)
    .filter(([uiKey, p]) => VISIT_PHOTO_MAP[uiKey] && (p?.url || (p?.file && (p.status === 'ready' || p.status === 'uploading' || p.status === 'uploaded'))))
    .map(([uiKey, p]) => ({ ...VISIT_PHOTO_MAP[uiKey], file: p.file, url: p.url }));

  const results = await Promise.all(
    entries.map(async (e) => {
      const url = e.url || await uploadVisitPhoto(e.file, visitId, e.path);
      return [e.col, url];
    })
  );

  return Object.fromEntries(results);
}
