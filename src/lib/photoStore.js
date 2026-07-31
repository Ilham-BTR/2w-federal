// src/lib/photoStore.js
// Simpan foto visit di IndexedDB (mock mode) — kapasitas besar, persist antar-reload.
// Per-device (sama seperti localStorage): foto cuma ada di HP/browser yang dipakai.

const DB_NAME = 'federal2w_photos';
const STORE = 'photos';
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

// Simpan blob foto dengan key (mis. "visitId/photo_in")
export async function savePhoto(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPhotoBlob(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Cache object URL biar gak bikin ulang tiap render
const urlCache = new Map();

// key → object URL (siap dipakai <img src>). null kalau gak ada.
export async function getPhotoURL(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  try {
    const blob = await getPhotoBlob(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    return url;
  } catch (e) {
    console.warn('getPhotoURL gagal:', e);
    return null;
  }
}

// Hapus semua foto milik 1 visit (key prefix "visitId/")
export async function deletePhotosByVisit(visitId) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (String(cursor.key).startsWith(visitId + '/')) cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('deletePhotosByVisit gagal:', e); }
  // bersihkan cache URL
  urlCache.forEach((url, key) => {
    if (key.startsWith(visitId + '/')) { URL.revokeObjectURL(url); urlCache.delete(key); }
  });
}

// Hapus semua foto (dipanggil dari resetMockData)
export async function clearPhotos() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('clearPhotos gagal:', e); }
  urlCache.forEach(url => URL.revokeObjectURL(url));
  urlCache.clear();
}
