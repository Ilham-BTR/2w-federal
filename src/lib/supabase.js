// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Mock mode kalau .env belum diset — biar app tetap jalan dengan demo data
export const MOCK_MODE = !url || !anonKey || url.includes('your-project');

// Lacak egress LIVE: hitung panggilan per-endpoint (nyaris gratis, tak baca
// body). Ukuran byte per-endpoint diukur terpisah oleh ops/egress-report.mjs;
// reqs x ukuran = egress live. Batch dikirim saat tab disembunyikan.
const egressCount = {};
const trackFetch = (input, init) => {
  try {
    const u = typeof input === 'string' ? input : input.url;
    const p = new URL(u).pathname.replace(/^\/rest\/v1\//, '').replace(/^\/functions\/v1\//, 'fn:');
    if (p && !p.startsWith('rpc/bump_egress')) egressCount[p] = (egressCount[p] || 0) + 1;
  } catch { /* url aneh → lewati */ }
  return fetch(input, init);
};

export const supabase = MOCK_MODE
  ? null
  : createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: { fetch: trackFetch },
    });

// Kirim hitungan yang terkumpul saat tab disembunyikan (satu RPC kecil/sesi).
function flushEgress() {
  const items = Object.entries(egressCount).map(([path, reqs]) => ({ path, reqs }));
  if (!items.length || !supabase) return;
  Object.keys(egressCount).forEach((k) => delete egressCount[k]);
  supabase.rpc('bump_egress', { items }).then(() => {}, () => {});
}
if (typeof document !== 'undefined' && !MOCK_MODE) {
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushEgress(); });
}

if (MOCK_MODE) {
  console.warn(
    '🟡 Supabase mock mode — app pakai data dummy.\n' +
    'Set VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY di .env.local untuk mode produksi.'
  );
}
