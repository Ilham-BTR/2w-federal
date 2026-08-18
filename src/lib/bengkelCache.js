// src/lib/bengkelCache.js
// Cache master bengkel di perangkat (IndexedDB).
//
// Alasan: master bengkel ±6.400 baris (±0,9 MB) tapi nyaris tak pernah berubah,
// sementara app menariknya ULANG setiap kali dibuka. Itu penyumbang terbesar
// egress Supabase. Dengan cache, pembukaan berikutnya hanya menanyakan
// "ada yang berubah sejak <waktu>?" — umumnya kosong, beberapa ratus byte.
//
// Disimpan di IndexedDB, bukan localStorage: data admin (semua region) bisa
// ±4 MB mentah, mepet dengan batas 5 MB localStorage.

const DB_NAME = 'federal2w_cache';
const STORE = 'bengkels';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB tidak tersedia')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Baca cache untuk satu scope (mis. 'all' atau gabungan region id MD). */
export async function bacaCache(scope) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(scope);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }   // IndexedDB diblokir/mode privat → jalan tanpa cache
}

/** @param {{rows: any[], lastSync: string}} isi */
export async function tulisCache(scope, isi) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(isi, scope);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* gagal simpan → app tetap jalan, cuma tak hemat */ }
}

export async function hapusCache() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* noop */ }
}

/** Waktu perubahan terbaru dari sekumpulan baris — jadi penanda sinkron berikutnya. */
export function waktuTerbaru(rows) {
  let maks = '';
  for (const r of rows) {
    const t = r.updated_at || r.created_at || '';
    if (t > maks) maks = t;
  }
  return maks;
}

/** Gabungkan baris baru ke cache lama (baris dgn id sama ditimpa). */
export function gabung(lama, baru) {
  if (!baru.length) return lama;
  const peta = new Map(lama.map(r => [r.id, r]));
  baru.forEach(r => peta.set(r.id, r));
  return [...peta.values()];
}
