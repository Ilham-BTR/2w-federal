// src/lib/api.js
// Data access layer untuk 2W Federal POSM Tracker.
// Semua query Supabase di-route lewat sini biar App.jsx gak penuh boilerplate.
// Mock fallback otomatis aktif kalau .env belum di-set.

import { supabase, MOCK_MODE } from './supabase';
import { uploadAllVisitPhotos, uploadAttendancePhoto } from './storage';
// Re-export untuk upload-saat-foto-diambil (eager upload) dari UI
export { uploadOneVisitPhoto, uploadAttendancePhoto } from './storage';
import { SEED_REGIONS, SEED_DISTRIBUTORS, SEED_KOTAS, SEED_BENGKELS } from './seedData';
import { clearPhotos, deletePhotosByVisit } from './photoStore';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { bacaCache, tulisCache, waktuTerbaru, gabung } from './bengkelCache';

// ============================================================
// MOCK DATA (untuk dev tanpa Supabase) — di-persist ke localStorage
// ============================================================
// Bump versi ini tiap kali seed data berubah → localStorage lama diabaikan, seed baru ke-load.
const MOCK_STORAGE_KEY = 'federal2w_mock_data_v2'; // v2: master bengkel dari db 2 W.xlsx

// State default kalau localStorage belum ada isinya — di-seed dari CSV (lihat scripts/generate-seed.mjs)
const DEFAULT_MOCK = {
  regions: SEED_REGIONS,
  kotas: SEED_KOTAS,
  distributors: SEED_DISTRIBUTORS,
  bengkels: SEED_BENGKELS,
  // Akun login default: 1 admin + 1 MD
  profiles: [
    { id: 'u1', email: 'budi@federal.id',  full_name: 'Budi Santoso',  role: 'md',          region_id: 'r1', monthly_target: 40, login_password: 'federal' },
    { id: 'u4', email: 'admin@federal.id', full_name: 'Admin Pusat',   role: 'admin',       region_id: null, monthly_target: 0,  login_password: 'federal' },
    { id: 'u5', email: 'super@federal.id', full_name: 'Super Admin',   role: 'super_admin', region_id: null, monthly_target: 0,  login_password: 'federal' },
    { id: 'u6', email: 'tl@federal.id',    full_name: 'TL Jawa Timur', role: 'tl',          region_id: 'r1', monthly_target: 0,  login_password: 'federal' },
  ],
  visits: [],
};

// Load dari localStorage; fallback ke default
function loadMockData() {
  if (typeof localStorage === 'undefined') return structuredClone(DEFAULT_MOCK);
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Pastikan semua key ada (kalau struktur lama)
      return { ...structuredClone(DEFAULT_MOCK), ...parsed };
    }
  } catch (e) { console.warn('Gagal load mock data dari localStorage:', e); }
  return structuredClone(DEFAULT_MOCK);
}

const MOCK_DATA = loadMockData();

// Simpan MOCK_DATA ke localStorage (dipanggil tiap mutasi)
function persistMock() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(MOCK_DATA));
  } catch (e) { console.warn('Gagal simpan mock data ke localStorage:', e); }
}

// Reset semua data demo ke default (panggil dari console: window.__resetMockData())
export function resetMockData() {
  Object.assign(MOCK_DATA, structuredClone(DEFAULT_MOCK));
  persistMock();
  clearPhotos();  // hapus juga foto di IndexedDB
}
if (typeof window !== 'undefined') window.__resetMockData = resetMockData;

// ============================================================
// AUTH
// ============================================================
export async function signIn(email, password) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 600));
    const profile = MOCK_DATA.profiles.find(p => p.email === email.toLowerCase());
    // Password yang diterima: password akun ini (kalau di-set) ATAU 'federal' (default demo)
    const expected = profile?.login_password || 'federal';
    if (!profile || (password !== expected && password !== 'federal')) {
      throw new Error('Email atau password salah');
    }
    localStorage.setItem('mock_user_id', profile.id);
    return profile;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const { data: profile, error: pError } = await supabase
    .from('profiles')
    .select('*, region:regions!region_id(*)')
    .eq('id', data.user.id)
    .single();
  if (pError) throw pError;

  return profile;
}

export async function signOut() {
  if (MOCK_MODE) {
    localStorage.removeItem('mock_user_id');
    return;
  }
  await supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 800));
    return { ok: true };
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password',
  });
  if (error) throw error;
  return { ok: true };
}

export async function getCurrentProfile() {
  if (MOCK_MODE) {
    const id = localStorage.getItem('mock_user_id');
    return MOCK_DATA.profiles.find(p => p.id === id) || null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, region:regions!region_id(*)')
    .eq('id', user.id)
    .single();
  return profile;
}

// ============================================================
// PASSKEY / WEBAUTHN (login biometrik server-side, tanpa simpan password)
// ============================================================

// Cek perangkat punya platform authenticator (fingerprint/Face ID) & mode produksi
export async function isPasskeySupported() {
  if (MOCK_MODE) return false;
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Daftar passkey milik user yang sedang login (untuk tampil/hapus)
export async function listPasskeys() {
  if (MOCK_MODE) return [];
  const { data, error } = await supabase
    .from('webauthn_credentials')
    .select('id, device_label, created_at, last_used_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Hapus 1 passkey milik sendiri ("Lupakan passkey")
export async function deletePasskey(id) {
  if (MOCK_MODE) return;
  const { error } = await supabase.from('webauthn_credentials').delete().eq('id', id);
  if (error) throw error;
}

// Aktifkan passkey di perangkat ini (user HARUS sudah login)
export async function enablePasskey(label) {
  if (MOCK_MODE) throw new Error('Passkey hanya tersedia di mode Supabase (produksi)');

  const { data: opts, error: e1 } = await supabase.functions.invoke('webauthn', {
    body: { action: 'reg-options' },
  });
  if (e1) throw new Error(e1.message || 'Gagal minta opsi registrasi');
  if (opts?.error) throw new Error(opts.error);

  let attResp;
  try {
    attResp = await startRegistration({ optionsJSON: opts });
  } catch (err) {
    if (err?.name === 'InvalidStateError') throw new Error('Passkey sudah terdaftar di perangkat ini.');
    if (err?.name === 'NotAllowedError') throw new Error('Pendaftaran biometrik dibatalkan.');
    throw err;
  }

  const { data: res, error: e2 } = await supabase.functions.invoke('webauthn', {
    body: { action: 'reg-verify', response: attResp, label: label || navigator.userAgent.slice(0, 80) },
  });
  if (e2) throw new Error(e2.message || 'Verifikasi gagal');
  if (res?.error) throw new Error(res.error);
  return res; // { verified: true }
}

// Login pakai passkey (discoverable — tidak perlu ketik email). Return profile.
export async function loginWithPasskey() {
  if (MOCK_MODE) throw new Error('Passkey hanya tersedia di mode Supabase (produksi)');

  const { data: opts, error: e1 } = await supabase.functions.invoke('webauthn', {
    body: { action: 'auth-options' },
  });
  if (e1) throw new Error(e1.message || 'Gagal minta opsi login');
  if (opts?.error) throw new Error(opts.error);

  let asr;
  try {
    asr = await startAuthentication({ optionsJSON: opts });
  } catch (err) {
    if (err?.name === 'NotAllowedError') throw new Error('Verifikasi biometrik dibatalkan / tidak ada passkey.');
    throw err;
  }

  const { data: res, error: e2 } = await supabase.functions.invoke('webauthn', {
    body: { action: 'auth-verify', response: asr },
  });
  if (e2) throw new Error(e2.message || 'Verifikasi gagal');
  if (res?.error) throw new Error(res.error);
  if (!res?.token_hash) throw new Error('Token sesi tidak diterima');

  // Tukar token jadi sesi Supabase asli (tanpa password)
  const { data: sess, error: e3 } = await supabase.auth.verifyOtp({
    token_hash: res.token_hash,
    type: 'magiclink',
  });
  if (e3) throw e3;

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('*, region:regions!region_id(*)')
    .eq('id', sess.user.id)
    .single();
  if (pErr) throw pErr;
  return profile;
}

// ============================================================
// MASTER DATA
// ============================================================
export async function fetchRegions() {
  if (MOCK_MODE) return [...MOCK_DATA.regions];
  const { data, error } = await supabase.from('regions').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function fetchKotas() {
  if (MOCK_MODE) return [...MOCK_DATA.kotas];
  const { data, error } = await supabase.from('kotas').select('*, region:regions!region_id(*)').order('name');
  if (error) throw error;
  return data;
}

export async function fetchDistributors() {
  if (MOCK_MODE) return [...MOCK_DATA.distributors];
  const { data, error } = await supabase.from('distributors').select('*, region:regions!region_id(*)').order('name');
  if (error) throw error;
  return data;
}

// Ambil SEMUA baris — PostgREST membatasi ~1000 baris/request, jadi paginasi
// pakai .range() sampai habis. buildQuery() harus mengembalikan query BARU tiap
// dipanggil (karena .range diterapkan ulang).
async function fetchAllPaged(buildQuery, batch = 1000) {
  const ambil = async (from) => {
    const { data, error } = await buildQuery().range(from, from + batch - 1);
    if (error) throw error;
    return data || [];
  };
  const pertama = await ambil(0);
  if (pertama.length < batch) return pertama;

  // Halaman sisanya diambil BARENGAN. Sebelumnya berurutan, dan untuk tabel
  // bengkel (7 halaman) itu menumpuk jadi ~4 detik layar loading tiap login.
  // Dikejar bertahap supaya tetap berhenti begitu ketemu halaman terakhir,
  // tanpa perlu query count lebih dulu.
  const all = [...pertama];
  const SEKALIGUS = 6;
  for (let putaran = 1; ; putaran += SEKALIGUS) {
    const hasil = await Promise.all(
      Array.from({ length: SEKALIGUS }, (_, i) => ambil((putaran + i) * batch))
    );
    hasil.forEach(h => all.push(...h));
    if (hasil.some(h => h.length < batch)) break;
  }
  return all;
}

// regionId (opsional): batasi ke bengkel di region itu saja. Dipakai MD supaya
// tak menarik SEMUA bengkel (2000+) yang bikin OOM di HP RAM kecil.
/**
 * @param {string|string[]|null} regionId - 1 region, banyak region (MD multi-area), atau null = semua
 */
export async function fetchBengkels(regionId = null) {
  const ids = (Array.isArray(regionId) ? regionId : [regionId]).filter(Boolean);
  if (MOCK_MODE) {
    const all = [...MOCK_DATA.bengkels];
    if (!ids.length) return all;
    const kotaIds = new Set(MOCK_DATA.kotas.filter(k => ids.includes(k.region_id)).map(k => k.id));
    return all.filter(b => kotaIds.has(b.kota_id));
  }
  // Kota & region TIDAK ikut di-embed: pemakainya selalu memetakan lewat
  // kota_id ke daftar kotas/regions yang di-fetch terpisah, jadi embed hanya
  // menggandakan payload di 6.000+ baris.
  // inner join kotas dipakai murni sebagai filter region, kolomnya tak dibawa
  const buatQuery = () => (ids.length
    ? supabase.from('bengkels').select('*, kotas!inner(region_id)').in('kotas.region_id', ids).order('code')
    : supabase.from('bengkels').select('*').order('code'));

  const scope = ids.length ? [...ids].sort().join(',') : 'all';
  const cache = await bacaCache(scope);

  // Belum ada cache → tarik penuh sekali, sisanya nanti cukup delta.
  if (!cache?.rows?.length || !cache.lastSync) {
    const rows = await fetchAllPaged(buatQuery);
    await tulisCache(scope, { rows, lastSync: waktuTerbaru(rows) });
    return rows;
  }

  try {
    // 1) Ambil HANYA baris yang berubah/baru sejak sinkron terakhir.
    const perubahan = await fetchAllPaged(() => buatQuery().gt('updated_at', cache.lastSync));
    const gabungan = gabung(cache.rows, perubahan);

    // 2) Bandingkan jumlah baris di server — satu-satunya cara mendeteksi
    //    bengkel yang DIHAPUS (baris hilang tak muncul di query perubahan).
    //    head:true → server balas tanpa body, cuma header jumlah.
    const qHitung = ids.length
      ? supabase.from('bengkels').select('id, kotas!inner(region_id)', { count: 'exact', head: true }).in('kotas.region_id', ids)
      : supabase.from('bengkels').select('id', { count: 'exact', head: true });
    const { count, error } = await qHitung;
    if (error) throw error;

    if (count !== gabungan.length) {
      const rows = await fetchAllPaged(buatQuery);       // cache meleset → samakan penuh
      await tulisCache(scope, { rows, lastSync: waktuTerbaru(rows) });
      return rows;
    }

    if (perubahan.length) {
      await tulisCache(scope, { rows: gabungan, lastSync: waktuTerbaru(gabungan) || cache.lastSync });
    }
    return gabungan;
  } catch (e) {
    // Apa pun yang gagal (jaringan, kolom, cache rusak) → jangan sampai MD
    // kehilangan daftar bengkel. Jatuh balik ke tarikan penuh.
    console.warn('Sinkron delta bengkel gagal, tarik penuh:', e?.message || e);
    const rows = await fetchAllPaged(buatQuery);
    await tulisCache(scope, { rows, lastSync: waktuTerbaru(rows) });
    return rows;
  }
}

/**
 * Angka rujukan bengkel master AA yang tidak diimpor ke tabel bengkels
 * (lihat migrasi 0016) — dipakai Laporan Coverage agar Total Database utuh.
 */
export async function fetchRefCounts() {
  if (MOCK_MODE) return [];
  const { data, error } = await supabase
    .from('bengkel_ref_counts')
    .select('region_id, distributor_id, workshop_class, target_status, jumlah');
  if (error) { console.warn('fetchRefCounts gagal:', error.message); return []; }
  return data || [];
}

export async function fetchMDs() {
  if (MOCK_MODE) return MOCK_DATA.profiles.filter(p => p.role === 'md');
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'md')
    .order('full_name');
  if (error) throw error;
  return data;
}

// Semua akun (untuk kelola di Master Data) — RLS: admin/super lihat semua, TL region-nya, MD miliknya.
export async function fetchAccounts() {
  if (MOCK_MODE) {
    return [...MOCK_DATA.profiles]
      .map(p => ({ ...p, region_ids: p.region_ids?.length ? p.region_ids : (p.region_id ? [p.region_id] : []) }))
      .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('role')
    .order('full_name');
  if (error) throw error;
  const profs = data || [];
  // Lampirkan daftar region untuk TL (RLS tl_regions: TL lihat sendiri, super admin semua).
  const { data: tlr } = await supabase.from('tl_regions').select('tl_id, region_id');
  const byTl = {};
  (tlr || []).forEach(r => { (byTl[r.tl_id] ||= []).push(r.region_id); });
  return profs.map(p => ({
    ...p,
    region_ids: byTl[p.id]?.length ? byTl[p.id] : (p.region_id ? [p.region_id] : []),
  }));
}

/**
 * Set daftar region yang dicover seorang TL (replace semua baris tl_regions).
 * Dipakai super admin saat edit akun TL. Create memakai edge function.
 */
/**
 * Set penanda target untuk banyak bengkel sekaligus.
 * @param {string[]} ids
 * @param {boolean} isTarget
 */
export async function setBengkelTarget(ids, isTarget) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return 0;
  if (MOCK_MODE) {
    MOCK_DATA.bengkels.forEach(b => { if (list.includes(b.id)) b.is_target = isTarget; });
    persistMock();
    return list.length;
  }
  // Dipecah agar URL filter .in() tidak kepanjangan saat ribuan bengkel dipilih.
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    const { error } = await supabase.from('bengkels')
      .update({ is_target: isTarget })
      .in('id', list.slice(i, i + CHUNK));
    if (error) throw error;
  }
  return list.length;
}

/**
 * MD mengubah notes/remarks visit MILIKNYA sendiri.
 * RLS (visits_md_update_own) memastikan MD hanya bisa mengubah barisnya sendiri.
 * @returns {Promise<string|null>} remarks yang tersimpan
 */
export async function updateVisitRemarks(visitId, remarks) {
  const value = remarks?.trim() || null;
  if (MOCK_MODE) {
    const v = MOCK_DATA.visits.find(x => x.id === visitId);
    if (v) v.remarks = value;
    persistMock();
    return value;
  }
  const { error } = await supabase.from('visits').update({ remarks: value }).eq('id', visitId);
  if (error) throw error;
  return value;
}

/**
 * Daftar id bengkel yang SUDAH berhasil dipasangi spanduk.
 * Dipakai form visit untuk memblokir submit ulang bengkel yang sama
 * (aturan: 1 bengkel hanya boleh 1x "Berhasil Pasang").
 * @returns {Promise<Set<string>>}
 */
export async function fetchTerpasangBengkelIds() {
  if (MOCK_MODE) {
    return new Set(MOCK_DATA.visits.filter(v => v.status === 'Berhasil Pasang').map(v => v.bengkel_id));
  }
  const { data, error } = await supabase.from('bengkels_terpasang').select('bengkel_id');
  if (error) { console.warn('fetchTerpasangBengkelIds gagal:', error.message); return new Set(); }
  return new Set((data || []).map(r => r.bengkel_id));
}

/**
 * Simpan hasil pengecekan visit oleh admin/AA.
 * @param {string} visitId
 * @param {Object} args - { photoChecks: {selfie:'ok'|'bad',...}, remarks, checkedBy }
 */
export async function saveVisitCheck(visitId, { photoChecks, remarks, checkedBy }) {
  const values = Object.values(photoChecks || {});
  const status = values.length === 0 ? null : (values.some(v => v === 'bad') ? 'Tidak Sesuai' : 'Sesuai');
  const patch = {
    photo_checks: photoChecks || null,
    check_status: status,
    check_remarks: remarks?.trim() || null,
    checked_by: checkedBy || null,
    checked_at: new Date().toISOString(),
  };
  if (MOCK_MODE) {
    const v = MOCK_DATA.visits.find(x => x.id === visitId);
    if (v) Object.assign(v, patch);
    persistMock();
    return patch;
  }
  const { error } = await supabase.from('visits').update(patch).eq('id', visitId);
  if (error) throw error;
  return patch;
}

// ---------------------------------------------------------------------------
// Izin edit foto visit — MD mengajukan, super admin memutuskan.
// Izin yang disetujui berlaku 24 jam dan hanya membuka slot foto 1 visit.
// ---------------------------------------------------------------------------
const IZIN_JAM = 24;
export const izinEditAktif = (req) =>
  !!req && req.status === 'approved' && !!req.expires_at && new Date(req.expires_at) > new Date();

/** MD mengajukan izin edit foto untuk 1 visit miliknya. */
export async function createEditRequest(visitId, mdId, reason) {
  const row = {
    visit_id: visitId, md_id: mdId,
    reason: reason?.trim() || null,
    status: 'pending', created_at: new Date().toISOString(),
  };
  if (MOCK_MODE) {
    MOCK_DATA.visit_edit_requests ||= [];
    if (MOCK_DATA.visit_edit_requests.some(r => r.visit_id === visitId && r.status === 'pending')) {
      throw new Error('Sudah ada permintaan yang menunggu keputusan untuk visit ini.');
    }
    const saved = { id: crypto.randomUUID(), ...row };
    MOCK_DATA.visit_edit_requests.push(saved);
    persistMock();
    return saved;
  }
  const { data, error } = await supabase.from('visit_edit_requests').insert(row).select().single();
  if (error) {
    // unique index parsial: 1 permintaan pending per visit
    if (error.code === '23505') throw new Error('Sudah ada permintaan yang menunggu keputusan untuk visit ini.');
    throw error;
  }
  return data;
}

/** Daftar permintaan. mdId diisi → hanya milik MD tsb (dipakai di halaman MD). */
export async function fetchEditRequests(mdId = null) {
  if (MOCK_MODE) {
    const all = MOCK_DATA.visit_edit_requests || [];
    return mdId ? all.filter(r => r.md_id === mdId) : all;
  }
  let q = supabase.from('visit_edit_requests').select('*').order('created_at', { ascending: false });
  if (mdId) q = q.eq('md_id', mdId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Super admin menyetujui / menolak. Disetujui → berlaku 24 jam sejak sekarang. */
export async function decideEditRequest(id, approve, deciderId) {
  const now = new Date();
  const patch = {
    status: approve ? 'approved' : 'rejected',
    decided_by: deciderId || null,
    decided_at: now.toISOString(),
    expires_at: approve ? new Date(now.getTime() + IZIN_JAM * 3600 * 1000).toISOString() : null,
  };
  if (MOCK_MODE) {
    const r = (MOCK_DATA.visit_edit_requests || []).find(x => x.id === id);
    if (r) Object.assign(r, patch);
    persistMock();
    return { ...r };
  }
  const { data, error } = await supabase.from('visit_edit_requests').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/**
 * Daftar region milik user yang sedang login (MD/TL multi-area).
 * Baca tl_regions milik sendiri — RLS mengizinkan (tl_id = auth.uid()).
 */
export async function fetchMyRegions(userId) {
  if (MOCK_MODE) {
    const p = MOCK_DATA.profiles.find(x => x.id === userId);
    return p?.region_ids?.filter(Boolean) || [];
  }
  const { data, error } = await supabase.from('tl_regions').select('region_id').eq('tl_id', userId);
  if (error) { console.warn('fetchMyRegions gagal:', error.message); return []; }
  return (data || []).map(r => r.region_id);
}

export async function setTlRegions(tlId, regionIds) {
  const ids = (regionIds || []).filter(Boolean);
  if (MOCK_MODE) {
    const p = MOCK_DATA.profiles.find(x => x.id === tlId);
    if (p) { p.region_ids = ids; p.region_id = ids[0] || null; persistMock(); }
    return;
  }
  await supabase.from('tl_regions').delete().eq('tl_id', tlId);
  if (ids.length) {
    const { error } = await supabase.from('tl_regions').insert(ids.map(rid => ({ tl_id: tlId, region_id: rid })));
    if (error) throw error;
  }
}

export async function addMaster(table, payload) {
  if (MOCK_MODE) {
    const id = 'new_' + Date.now();
    const item = { id, ...payload };
    MOCK_DATA[table].push(item);
    persistMock();
    return item;
  }
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return data;
}

/**
 * Bulk insert bengkels (untuk import dari Excel/CSV).
 * Payload sudah ter-validate di client. Insert dilakukan dalam batch agar
 * tidak hit limit body size & memberi progress feedback per chunk.
 *
 * @param {Array<Object>} rows - payload siap insert (code, name, kota_id, distributor_id, lat, lng)
 * @param {(done:number,total:number)=>void} [onProgress] - callback opsional per batch
 * @returns {Promise<{inserted:number, errors:Array<{row:number, message:string}>}>}
 */
export async function bulkAddBengkels(rows, onProgress) {
  const BATCH = 50;
  const result = { inserted: 0, errors: [] };

  if (MOCK_MODE) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        // Cek dupe by code di mock
        if (MOCK_DATA.bengkels.some(b => b.code === r.code)) {
          result.errors.push({ row: i + 1, message: `Kode ${r.code} sudah ada` });
        } else {
          MOCK_DATA.bengkels.push({ id: 'new_' + Date.now() + '_' + i, ...r });
          result.inserted++;
        }
      } catch (e) {
        result.errors.push({ row: i + 1, message: e.message });
      }
      if (onProgress && (i + 1) % BATCH === 0) onProgress(i + 1, rows.length);
    }
    persistMock();
    onProgress?.(rows.length, rows.length);
    return result;
  }

  // Supabase: insert per batch (gunakan upsert via on_conflict agar duplicate code bisa di-handle)
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('bengkels')
      .insert(chunk)
      .select('id, code');
    if (error) {
      // Kalau batch error karena 1 dupe, fall back ke per-row agar yang lain tetap insert
      for (let j = 0; j < chunk.length; j++) {
        const single = chunk[j];
        const { error: e } = await supabase.from('bengkels').insert(single).select('id').single();
        if (e) result.errors.push({ row: i + j + 1, message: e.message });
        else result.inserted++;
      }
    } else {
      result.inserted += data?.length || chunk.length;
    }
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }
  return result;
}

/**
 * Bulk insert master sederhana (regions, distributors, kotas).
 * Payload sudah ter-validate & ter-enrich di client (kotas sudah punya region_id).
 * @param {string} table - 'regions' | 'distributors' | 'kotas'
 * @param {Array<Object>} rows
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{inserted:number, errors:Array<{row:number,message:string}>}>}
 */
export async function bulkAddMaster(table, rows, onProgress) {
  const BATCH = 100;
  const result = { inserted: 0, errors: [] };

  if (MOCK_MODE) {
    for (let i = 0; i < rows.length; i++) {
      MOCK_DATA[table].push({ id: 'new_' + Date.now() + '_' + i, ...rows[i] });
      result.inserted++;
    }
    persistMock();
    onProgress?.(rows.length, rows.length);
    return result;
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from(table).insert(chunk).select('id');
    if (error) {
      // fallback per-row biar yang valid tetap masuk
      for (let j = 0; j < chunk.length; j++) {
        const { error: e } = await supabase.from(table).insert(chunk[j]).select('id').single();
        if (e) result.errors.push({ row: i + j + 1, message: e.message });
        else result.inserted++;
      }
    } else {
      result.inserted += data?.length || chunk.length;
    }
    onProgress?.(Math.min(i + BATCH, rows.length), rows.length);
  }
  return result;
}

/**
 * Bulk create akun MD.
 * MD = auth user + profile, jadi di real mode WAJIB lewat Edge Function
 * (pakai service_role untuk createUser). Di mock mode cukup push ke profiles.
 *
 * @param {Array<Object>} rows - { email, full_name, role, region_id, monthly_target, password }
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{inserted:number, errors:Array<{row:number,message:string}>}>}
 */
export async function bulkCreateMDs(rows, onProgress) {
  const result = { inserted: 0, errors: [] };

  if (MOCK_MODE) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (MOCK_DATA.profiles.some(p => p.email === r.email.toLowerCase())) {
        result.errors.push({ row: i + 1, message: `Email ${r.email} sudah ada` });
      } else {
        MOCK_DATA.profiles.push({
          id: 'new_md_' + Date.now() + '_' + i,
          email: r.email.toLowerCase(),
          full_name: r.full_name,
          role: r.role || 'md',
          region_id: r.region_id || null,
          region_ids: (['tl', 'md'].includes(r.role) && Array.isArray(r.region_ids)) ? r.region_ids.filter(Boolean) : undefined,
          monthly_target: r.monthly_target || 30,
          login_password: r.password || 'federal',  // mock: simpan password biar bisa login & terlihat admin
        });
        result.inserted++;
      }
      onProgress?.(i + 1, rows.length);
    }
    persistMock();
    return result;
  }

  // Real Supabase: panggil edge function yang pakai service_role
  const { data, error } = await supabase.functions.invoke('admin-create-md', {
    body: { users: rows },
  });
  if (error) throw new Error(`Edge function gagal: ${error.message}`);
  onProgress?.(rows.length, rows.length);
  return data || result;
}

/**
 * Hapus 1 akun MD (hanya super admin) — hapus auth user (profil ikut cascade).
 * Gagal kalau MD masih punya visit (FK restrict).
 * @param {string} userId
 */
export async function deleteMd(userId) {
  if (MOCK_MODE) {
    if (MOCK_DATA.visits.some(v => v.md_id === userId)) throw new Error('MD masih punya visit — tidak bisa dihapus');
    MOCK_DATA.profiles = MOCK_DATA.profiles.filter(p => p.id !== userId);
    persistMock();
    return { ok: true };
  }
  const { data, error } = await supabase.functions.invoke('admin-create-md', {
    body: { action: 'delete', userId },
  });
  if (error) throw new Error(`Hapus akun gagal: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data || { ok: true };
}

/**
 * Reset password 1 akun MD (hanya super admin) — update auth + simpan login_password.
 * @param {string} userId
 * @param {string} password
 */
export async function resetMdPassword(userId, password) {
  if (MOCK_MODE) {
    const p = MOCK_DATA.profiles.find(x => x.id === userId);
    if (!p) throw new Error('Akun tidak ditemukan');
    p.login_password = password;
    persistMock();
    return { ok: true };
  }
  const { data, error } = await supabase.functions.invoke('admin-create-md', {
    body: { action: 'reset', userId, password },
  });
  if (error) throw new Error(`Reset password gagal: ${error.message}`);
  if (data?.error) throw new Error(data.error);
  return data || { ok: true };
}

export async function updateMaster(table, id, patch) {
  if (MOCK_MODE) {
    const idx = MOCK_DATA[table].findIndex(x => x.id === id);
    if (idx === -1) throw new Error('Item tidak ditemukan');
    MOCK_DATA[table][idx] = { ...MOCK_DATA[table][idx], ...patch };
    persistMock();
    return MOCK_DATA[table][idx];
  }
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMaster(table, id) {
  if (MOCK_MODE) {
    MOCK_DATA[table] = MOCK_DATA[table].filter(x => x.id !== id);
    persistMock();
    return;
  }
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

// ============================================================
// VISITS
// ============================================================
export async function fetchVisits({ mdId, month } = {}) {
  if (MOCK_MODE) {
    let v = [...MOCK_DATA.visits];
    if (mdId) v = v.filter(x => x.md_id === mdId);
    if (month) v = v.filter(x => x.visit_date.startsWith(month));
    return v.sort((a, b) => b.visit_date.localeCompare(a.visit_date));
  }

  const buildQuery = () => {
    let query = supabase
      .from('visit_details')
      .select('*')
      .order('visit_date', { ascending: false });
    if (mdId) query = query.eq('md_id', mdId);
    if (month) {
      const start = month + '-01';
      const [y, m] = month.split('-');
      const lastDay = new Date(Number(y), Number(m), 0).getDate();
      const end = `${month}-${String(lastDay).padStart(2, '0')}`;
      query = query.gte('visit_date', start).lte('visit_date', end);
    }
    return query;
  };
  return fetchAllPaged(buildQuery);
}

/**
 * Ambil HANYA visit yang berubah sejak waktu tertentu.
 * Dipakai penyegaran berkala di halaman MD. Menarik ulang seluruh daftar visit
 * tiap menit menghabiskan puluhan MB egress per MD per hari, padahal yang
 * ditunggu cuma keputusan admin (hasil cek foto / izin edit) yang jarang datang.
 * @param {string} mdId
 * @param {string} sejak - ISO timestamp penyegaran terakhir
 */
export async function fetchVisitsSince(mdId, sejak) {
  if (MOCK_MODE) return [];
  let q = supabase.from('visit_details').select('*').order('visit_date', { ascending: false });
  if (mdId) q = q.eq('md_id', mdId);
  if (sejak) q = q.gt('updated_at', sejak);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Create visit: upload photos to B2, then insert row.
 * Kalau bengkel belum punya lat/lng di master, dan MD captured GPS,
 * otomatis backfill bengkels.lat/lng via RPC (idempotent).
 *
 * @param {Object} args - { mdId, bengkelId, distributorId, visitDate, picName, picPhone, status,
 *                          remarks, lat, lng, photos, backfillBengkelCoords? }
 * @returns {Promise<{ visit: Object, bengkelBackfilled: boolean }>}
 */
export async function createVisit(args) {
  // Pakai visitId dari form (kalau foto sudah di-upload duluan pakai id itu),
  // kalau tidak ada generate baru.
  const visitId = args.visitId || crypto.randomUUID();

  // 1. Upload all photos in parallel
  const photoUrls = await uploadAllVisitPhotos(args.photos, visitId);

  // 2. Insert visit row
  const payload = {
    id: visitId,
    md_id: args.mdId,
    bengkel_id: args.bengkelId,
    visit_date: args.visitDate,
    status: args.status,
    remarks: args.remarks || null,
    visit_lat: args.lat,
    visit_lng: args.lng,
    // Data PIC & survei — hanya terisi saat hasil visit "Berhasil Pasang".
    owner_name: args.ownerName?.trim() || null,
    owner_phone: args.ownerPhone?.trim() || null,
    spanduk_size: args.spandukSize || null,
    planogram_allowed: args.planogramAllowed ?? null,
    ...photoUrls,
  };

  const canBackfill = args.backfillBengkelCoords && args.lat != null && args.lng != null;

  if (MOCK_MODE) {
    MOCK_DATA.visits.unshift({ ...payload, created_at: new Date().toISOString() });
    let bengkelBackfilled = false;
    if (canBackfill) {
      const b = MOCK_DATA.bengkels.find(x => x.id === args.bengkelId);
      if (b && (b.lat == null || b.lng == null)) {
        b.lat = args.lat;
        b.lng = args.lng;
        bengkelBackfilled = true;
      }
    }
    persistMock();
    return { visit: payload, bengkelBackfilled };
  }

  const { data, error } = await supabase
    .from('visits')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  // Backfill bengkel coords (best-effort — error di sini tidak boleh gagalkan visit yang sudah saved)
  let bengkelBackfilled = false;
  if (canBackfill) {
    try {
      const { data: ok, error: bfErr } = await supabase.rpc('backfill_bengkel_coords', {
        p_bengkel_id: args.bengkelId,
        p_lat: args.lat,
        p_lng: args.lng,
      });
      if (bfErr) {
        console.warn('Backfill bengkel coords gagal:', bfErr.message);
      } else {
        bengkelBackfilled = !!ok;
      }
    } catch (e) {
      console.warn('Backfill RPC error:', e);
    }
  }

  return { visit: data, bengkelBackfilled };
}

/**
 * Hapus 1 visit beserta foto-fotonya.
 * Mock: hapus dari MOCK_DATA.visits + foto IndexedDB.
 * Produksi: hapus file di Storage (visit-photos/visits/{id}/*) lalu delete row.
 */
export async function deleteVisit(visitId) {
  if (MOCK_MODE) {
    MOCK_DATA.visits = MOCK_DATA.visits.filter(v => v.id !== visitId);
    persistMock();
    await deletePhotosByVisit(visitId);
    return;
  }

  // 1. Hapus foto di Storage (best-effort)
  try {
    const folder = `visits/${visitId}`;
    const { data: files } = await supabase.storage.from('visit-photos').list(folder);
    if (files && files.length) {
      const paths = files.map(f => `${folder}/${f.name}`);
      await supabase.storage.from('visit-photos').remove(paths);
    }
  } catch (e) {
    console.warn('Hapus foto Storage gagal (lanjut hapus row):', e);
  }

  // 2. Hapus row visit (RLS: hanya super_admin boleh delete)
  //    .select() -> verifikasi row benar-benar terhapus. Kalau RLS memblok,
  //    delete mengembalikan 0 baris TANPA error (sukses palsu) -> kita jadikan error.
  const { data, error } = await supabase.from('visits').delete().eq('id', visitId).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Visit tidak terhapus (0 baris). Pastikan login sebagai super admin — hanya super admin yang boleh menghapus.');
  }
}

// ============================================================
// ABSEN / ATTENDANCE (Masuk & Pulang) — sama dengan APK, tabel attendances
// ============================================================
function mockAtt() {
  if (!MOCK_DATA.attendances) MOCK_DATA.attendances = [];
  return MOCK_DATA.attendances;
}

// Absen MD untuk 1 tanggal (null kalau belum absen).
export async function fetchTodayAttendance(mdId, date) {
  if (MOCK_MODE) return mockAtt().find(a => a.md_id === mdId && a.date === date) || null;
  const { data, error } = await supabase
    .from('attendances')
    .select('*')
    .eq('md_id', mdId)
    .eq('date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Riwayat absen milik 1 MD (terbaru dulu). Query tabel langsung (RLS: MD lihat miliknya).
export async function fetchAttendances(mdId, limit = 60) {
  if (MOCK_MODE) return mockAtt().filter(a => a.md_id === mdId).sort((a, b) => b.date.localeCompare(a.date));
  const { data, error } = await supabase
    .from('attendances')
    .select('*')
    .eq('md_id', mdId)
    .order('date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Rekap absen semua MD (admin) untuk 1 BULAN (YYYY-MM) — view attendance_details.
export async function fetchAttendancesByMonth(month) {
  const start = month + '-01';
  const [y, m] = month.split('-');
  const lastDay = new Date(Number(y), Number(m), 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  if (MOCK_MODE) return mockAtt().filter(a => a.date >= start && a.date <= end);
  const { data, error } = await supabase
    .from('attendance_details')
    .select('*')
    .gte('date', start).lte('date', end)
    .order('date', { ascending: false })
    .order('check_in_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Rekap absen semua MD (admin) untuk RENTANG tanggal (YYYY-MM-DD .. YYYY-MM-DD).
export async function fetchAttendancesByRange(dari, sampai) {
  if (MOCK_MODE) return mockAtt().filter(a => (!dari || a.date >= dari) && (!sampai || a.date <= sampai));
  let q = supabase.from('attendance_details').select('*');
  if (dari) q = q.gte('date', dari);
  if (sampai) q = q.lte('date', sampai);
  const { data, error } = await q
    .order('date', { ascending: false })
    .order('check_in_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Hapus 1 record absen (super_admin only — di-enforce RLS attendances_admin_delete).
 * Foto selfie di B2 dibiarkan (orphan, best-effort dibersihkan terpisah).
 */
export async function deleteAttendance(id) {
  if (MOCK_MODE) {
    MOCK_DATA.attendances = mockAtt().filter(a => a.id !== id);
    persistMock();
    return;
  }
  const { data, error } = await supabase.from('attendances').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Absen tidak terhapus (0 baris). Pastikan login sebagai super admin — hanya super admin yang boleh menghapus.');
  }
}

// Rekap absen semua MD (admin) untuk 1 tanggal — view attendance_details.
export async function fetchAttendanceRecap(date) {
  if (MOCK_MODE) return mockAtt().filter(a => a.date === date);
  const { data, error } = await supabase
    .from('attendance_details')
    .select('*')
    .eq('date', date)
    .order('check_in_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Absen masuk: upload selfie, buat baris absen hari ini (upsert by md_id+date).
export async function checkIn({ mdId, date, lat, lng, photoFile, photoUrl: preUrl, note }) {
  const photoUrl = preUrl || (photoFile ? await uploadAttendancePhoto(photoFile, mdId, date, 'in') : null);
  const payload = {
    md_id: mdId, date,
    check_in_at: new Date().toISOString(),
    check_in_lat: lat, check_in_lng: lng,
    check_in_photo: photoUrl, check_in_note: note || null,
  };
  if (MOCK_MODE) {
    const row = { id: 'att_' + Date.now(), ...payload };
    mockAtt().push(row);
    persistMock();
    return row;
  }
  const { data, error } = await supabase
    .from('attendances')
    .upsert(payload, { onConflict: 'md_id,date' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Absen pulang: upload selfie, update baris hari ini.
export async function checkOut({ mdId, date, lat, lng, photoFile, photoUrl: preUrl, note }) {
  const photoUrl = preUrl || (photoFile ? await uploadAttendancePhoto(photoFile, mdId, date, 'out') : null);
  const patch = {
    check_out_at: new Date().toISOString(),
    check_out_lat: lat, check_out_lng: lng,
    check_out_photo: photoUrl, check_out_note: note || null,
  };
  if (MOCK_MODE) {
    const row = mockAtt().find(a => a.md_id === mdId && a.date === date);
    if (!row) throw new Error('Belum absen masuk hari ini');
    Object.assign(row, patch);
    persistMock();
    return row;
  }
  const { data, error } = await supabase
    .from('attendances')
    .update(patch)
    .eq('md_id', mdId)
    .eq('date', date)
    .select()
    .single();
  if (error) throw error;
  return data;
}
