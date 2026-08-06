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

async function presignAndPut(scope, payload, file) {
  const contentType = file.type || 'image/jpeg';
  const body = { scope, ...payload, contentType };

  let data;
  try {
    data = await invokeUploadUrl(body);
  } catch (e) {
    // 401 = access token kedaluwarsa (halaman dibiarkan terbuka lama).
    // Refresh sesi lalu coba sekali lagi sebelum menyerah.
    if (e.status !== 401) throw new Error(`Gagal minta upload URL: ${e.message}`);
    const { error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) throw new Error('Sesi login sudah habis. Logout lalu login lagi, baru ulangi ganti foto.');
    try {
      data = await invokeUploadUrl(body);
    } catch (e2) {
      throw new Error(e2.status === 401
        ? 'Sesi login sudah habis. Logout lalu login lagi, baru ulangi ganti foto.'
        : `Gagal minta upload URL: ${e2.message}`);
    }
  }
  if (!data?.uploadUrl) throw new Error(data?.error || 'Upload URL kosong dari server');

  // Content-Type WAJIB sama dengan yang ditandatangani edge function
  const res = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload ke B2 gagal: ${res.status} ${res.statusText}`);

  return data.publicUrl;
}

/**
 * Upload satu foto.
 * @param {File|Blob} file - File hasil compression dari PhotoTile
 * @param {string} visitId - UUID visit
 * @param {string} photoKey - 'foto-in' | 'foto-out' | 'spanduk-before' | dst
 * @returns {Promise<string>} - public URL (B2/CDN) atau ref IndexedDB (mock)
 */
export async function uploadVisitPhoto(file, visitId, photoKey) {
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

  // Production: upload ke Backblaze B2 via presigned URL
  return presignAndPut('visit', { visitId, photoKey }, file);
}

/**
 * Upload selfie absen ke B2 (path attendance/{userId}/{date}/{kind}.jpg).
 * @param {File|Blob} file - selfie hasil compression
 * @param {string} mdId
 * @param {string} date - YYYY-MM-DD
 * @param {'in'|'out'} kind
 * @returns {Promise<string>} public URL (atau ref IndexedDB di mock)
 */
export async function uploadAttendancePhoto(file, mdId, date, kind) {
  if (MOCK_MODE) {
    const key = `attendance/${mdId}/${date}/${kind}`;
    try {
      await savePhoto(key, file);
      return `idb:${key}`;
    } catch (e) {
      return URL.createObjectURL(file);
    }
  }

  // Production: upload ke Backblaze B2 (mdId diabaikan; path pakai user.id dari JWT di server)
  return presignAndPut('attendance', { date, kind }, file);
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
export async function uploadOneVisitPhoto(file, visitId, uiKey) {
  const m = VISIT_PHOTO_MAP[uiKey];
  if (!m) throw new Error('Foto key tak dikenal: ' + uiKey);
  const url = await uploadVisitPhoto(file, visitId, m.path);
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
