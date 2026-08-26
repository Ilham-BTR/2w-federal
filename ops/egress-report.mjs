// ops/egress-report.mjs
// Lacak egress: ukur ukuran WIRE (ter-gzip, seperti browser) tiap query yang
// dipakai app, urutkan, proyeksikan ke bulanan. Untuk cari lever berikutnya &
// menangkap regresi (query gemuk yang tak sengaja masuk).
//
// Pakai:  node ops/egress-report.mjs
// Butuh:  ops/backup/backup.config.json (supabaseUrl + serviceRoleKey) — sudah ada.
//
// Angka proyeksi pakai asumsi di ASUMSI; ubah sesuai kenyataan. "cached" =
// sudah di-cache/delta di app, jadi biaya nyata mendekati nol setelah muat awal.

import { readFileSync } from 'fs';
import https from 'https';

const ASUMSI = { md: 100, bukaPerHari: 5, hariKerja: 26 };

const cfg = JSON.parse(readFileSync(new URL('./backup/backup.config.json', import.meta.url)));
const BASE = cfg.supabaseUrl.replace(/\/$/, '');
const KEY = cfg.serviceRoleKey;

const KOL_VISIT = 'id,md_id,bengkel_id,visit_date,status,check_status,owner_name,bengkel_code,bengkel_name,kota_name,region_name,photo_count,has_spanduk,has_poster,bad_photo_count';

// Query nyata app. perOpen=true → dikali (md × buka × hari). cached → biaya nyata ~0.
const QUERIES = [
  { label: 'Daftar visit (semua) — admin', path: `/rest/v1/visit_details?select=${KOL_VISIT}`, perOpen: false, cached: 'delta' },
  { label: 'Daftar bengkel (semua) — admin', path: '/rest/v1/bengkels?select=*', perOpen: false, cached: 'IndexedDB+delta' },
  { label: 'bengkels_terpasang (anti dobel)', path: '/rest/v1/bengkels_terpasang?select=bengkel_id', perOpen: true, cached: 'localStorage 30m' },
  { label: 'kotas (statis)', path: '/rest/v1/kotas?select=*,region:regions!region_id(*)', perOpen: true, cached: 'localStorage 24j' },
  { label: 'distributors (statis)', path: '/rest/v1/distributors?select=*,region:regions!region_id(*)', perOpen: true, cached: 'localStorage 24j' },
  { label: 'regions (statis)', path: '/rest/v1/regions?select=*', perOpen: true, cached: 'localStorage 24j' },
  { label: 'accounts/profiles — admin', path: '/rest/v1/profiles?select=*', perOpen: false, cached: '-' },
];

// Ukuran wire = jumlah byte respons ter-gzip (tanpa decompress), = egress asli.
function wireBytes(path) {
  return new Promise((resolve, reject) => {
    https.get(BASE + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Encoding': 'gzip' } }, (r) => {
      if (r.statusCode >= 400) { r.resume(); return resolve(null); } // tabel/kolom tak ada → lewati
      let n = 0;
      r.on('data', (c) => { n += c.length; });
      r.on('end', () => resolve(n));
      r.on('error', reject);
    }).on('error', reject);
  });
}

const kb = (b) => (b / 1024).toFixed(1);
const mb = (b) => (b / 1024 / 1024).toFixed(1);

const rows = [];
for (const q of QUERIES) {
  const bytes = await wireBytes(q.path);
  if (bytes == null) continue;
  const perBulan = q.perOpen ? bytes * ASUMSI.md * ASUMSI.bukaPerHari * ASUMSI.hariKerja : bytes * ASUMSI.md; // one-time: sekali per perangkat
  rows.push({ ...q, bytes, perBulan });
}
rows.sort((a, b) => b.perBulan - a.perBulan);

console.log(`\nEGRESS per query (gzip, wire) — asumsi ${ASUMSI.md} MD x ${ASUMSI.bukaPerHari} buka x ${ASUMSI.hariKerja} hari\n`);
console.log('  ' + 'query'.padEnd(38) + 'ukuran'.padStart(9) + '  proyeksi/bln'.padStart(14) + '   cache');
console.log('  ' + '-'.repeat(78));
let totalMentah = 0;
for (const r of rows) {
  totalMentah += r.perBulan;
  const proy = r.perBulan > 1024 * 1024 ? mb(r.perBulan) + ' MB' : kb(r.perBulan) + ' KB';
  console.log('  ' + r.label.padEnd(38) + (kb(r.bytes) + ' KB').padStart(9) + proy.padStart(14) + '   ' + (r.cached || '-'));
}
console.log('  ' + '-'.repeat(78));
console.log('  ' + 'TOTAL bila TANPA cache'.padEnd(38) + ''.padStart(9) + (mb(totalMentah) + ' MB').padStart(14));
console.log('  (kolom cache = sudah dihemat di app; biaya nyata mendekati nol setelah muat awal)\n');
