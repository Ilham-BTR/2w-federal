// scripts/generate-seed.mjs
// Baca 4 CSV master data → bangun relasi FK → tulis src/lib/seedData.js
// Jalankan: node scripts/generate-seed.mjs
//
// CSV sumber (ubah path kalau perlu):
import fs from 'fs';
import path from 'path';

// CSV hasil konversi "db 2 W.xlsx" (master bengkel 2W Federal).
// Regenerate CSV-nya dari Excel dulu bila master berubah.
const CSV_DIR = 'C:/Users/Ilham_PC/AppData/Local/Temp/claude/D--Phyton-KC-Data-App-2W-Federal/9ca8710a-bef9-42b2-8b5d-e104f0353001/scratchpad/seed-csv';
const FILES = {
  regions:      path.join(CSV_DIR, 'regions.csv'),
  distributors: path.join(CSV_DIR, 'distributors.csv'),
  kotas:        path.join(CSV_DIR, 'kotas.csv'),
  bengkels:     path.join(CSV_DIR, 'bengkels.csv'),
};
const OUT = path.resolve('src/lib/seedData.js');

// --- CSV parser sederhana (deteksi delimiter , atau ;) ---
function parseCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const delim = lines[0].includes(';') ? ';' : ',';
  const splitLine = (line) => line.split(delim).map(c => c.trim());
  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  const rows = lines.slice(1).map(line => {
    const cells = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

const read = (f) => parseCSV(fs.readFileSync(f, 'utf8'));
const norm = (s) => String(s || '').trim().toLowerCase();

// ============================================================
// 1. REGIONS
// ============================================================
const regionsCsv = read(FILES.regions);
const regions = [];
const regionByName = new Map(); // nameNorm → region obj
let rIdx = 0;
const ensureRegion = (name) => {
  const key = norm(name);
  if (!key) return null;
  if (regionByName.has(key)) return regionByName.get(key);
  const obj = { id: 'r' + (++rIdx), name: String(name).trim() };
  regions.push(obj);
  regionByName.set(key, obj);
  return obj;
};
regionsCsv.rows.forEach(row => ensureRegion(row.name));

// ============================================================
// 2. DISTRIBUTORS (name, region)
// ============================================================
const distributorsCsv = read(FILES.distributors);
const distributors = [];
const distSeen = new Set();
let dIdx = 0;
distributorsCsv.rows.forEach(row => {
  const name = String(row.name || '').trim();
  if (!name) return;
  const reg = ensureRegion(row.region);
  const key = `${norm(name)}|${reg?.id || ''}`;
  if (distSeen.has(key)) return;
  distSeen.add(key);
  distributors.push({ id: 'd' + (++dIdx), name, region_id: reg?.id || null });
});

// ============================================================
// 3. KOTAS (name, region)
// ============================================================
const kotasCsv = read(FILES.kotas);
const kotas = [];
const kotaByKey = new Map(); // `${nameNorm}|${regionId}` → kota obj
let kIdx = 0;
const ensureKota = (name, regionObj) => {
  const nm = String(name || '').trim();
  if (!nm || !regionObj) return null;
  const key = `${norm(nm)}|${regionObj.id}`;
  if (kotaByKey.has(key)) return kotaByKey.get(key);
  const obj = { id: 'k' + (++kIdx), name: nm, region_id: regionObj.id };
  kotas.push(obj);
  kotaByKey.set(key, obj);
  return obj;
};
kotasCsv.rows.forEach(row => {
  const reg = ensureRegion(row.region);
  ensureKota(row.name, reg);
});

// ============================================================
// 4. BENGKELS (code, name, kota, region, lat, lng, address)
// ============================================================
const bengkelsCsv = read(FILES.bengkels);
const bengkels = [];
const codeSeen = new Set();
let bIdx = 0;
let autoKota = 0;
const report = { noKotaMatch: 0, dupCode: 0 };

bengkelsCsv.rows.forEach(row => {
  const code = String(row.code || '').trim().toUpperCase();
  const name = String(row.name || '').trim();
  if (!code || !name) return;

  const reg = ensureRegion(row.region);
  // kota match by name+region; kalau gak ada, auto-create
  let kota = null;
  if (reg) {
    const key = `${norm(row.kota)}|${reg.id}`;
    kota = kotaByKey.get(key);
    if (!kota) {
      kota = ensureKota(row.kota, reg);
      autoKota++;
    }
  }
  if (!kota) { report.noKotaMatch++; return; }

  let useCode = code;
  if (codeSeen.has(code)) { report.dupCode++; useCode = `${code}-${bIdx + 1}`; }
  codeSeen.add(useCode);

  const lat = row.lat !== '' && row.lat != null && !Number.isNaN(Number(row.lat)) ? Number(row.lat) : null;
  const lng = row.lng !== '' && row.lng != null && !Number.isNaN(Number(row.lng)) ? Number(row.lng) : null;

  bengkels.push({
    id: 'b' + (++bIdx),
    code: useCode,
    name,
    kota_id: kota.id,
    lat, lng,
    address: row.address ? String(row.address).trim() : null,
  });
});

// ============================================================
// WRITE seedData.js
// ============================================================
const banner = `// AUTO-GENERATED oleh scripts/generate-seed.mjs — JANGAN edit manual.
// Sumber: regions/distributors/kotas/bengkel CSV.
// Regenerate: node scripts/generate-seed.mjs
`;
const out = banner +
  `export const SEED_REGIONS = ${JSON.stringify(regions)};\n` +
  `export const SEED_DISTRIBUTORS = ${JSON.stringify(distributors)};\n` +
  `export const SEED_KOTAS = ${JSON.stringify(kotas)};\n` +
  `export const SEED_BENGKELS = ${JSON.stringify(bengkels)};\n`;

fs.writeFileSync(OUT, out, 'utf8');

// ============================================================
// WRITE supabase_seed.sql (untuk import data ke Supabase asli)
// Pakai INSERT ... SELECT dengan lookup nama (gak hardcode UUID)
// ============================================================
const SQL_OUT = path.resolve('supabase/supabase_seed.sql');
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sqlNum = (n) => (n == null || n === '' ? 'null' : Number(n));

// chunk helper biar VALUES list gak kepanjangan
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

let sql = `-- AUTO-GENERATED supabase_seed.sql — data master 2W Federal MD
-- Jalankan di Supabase SQL Editor SETELAH setup_fresh.sql.
-- Pakai INSERT ... SELECT (lookup by nama), aman dijalankan ulang (on conflict do nothing).
set statement_timeout = 0;

-- REGIONS
insert into regions (name) values
${regions.map(r => `  (${sqlStr(r.name)})`).join(',\n')}
on conflict (name) do nothing;

-- DISTRIBUTORS (lookup region by nama)
insert into distributors (name, region_id)
select v.name, r.id
from (values
${distributors.map(d => {
  const reg = regions.find(x => x.id === d.region_id);
  return `  (${sqlStr(d.name)}, ${sqlStr(reg ? reg.name : '')})`;
}).join(',\n')}
) as v(name, region)
join regions r on r.name = v.region
on conflict do nothing;

-- KOTAS (lookup region by nama)
insert into kotas (name, region_id)
select v.name, r.id
from (values
${kotas.map(k => {
  const reg = regions.find(x => x.id === k.region_id);
  return `  (${sqlStr(k.name)}, ${sqlStr(reg ? reg.name : '')})`;
}).join(',\n')}
) as v(name, region)
join regions r on r.name = v.region
on conflict do nothing;

`;

// BENGKELS — chunked (lookup kota by name+region)
const regionById = Object.fromEntries(regions.map(r => [r.id, r.name]));
const kotaById = Object.fromEntries(kotas.map(k => [k.id, k]));
const bengkelChunks = chunk(bengkels, 500);
bengkelChunks.forEach((grp, gi) => {
  sql += `-- BENGKELS chunk ${gi + 1}/${bengkelChunks.length}\n`;
  sql += `insert into bengkels (code, name, kota_id, lat, lng, address)\n`;
  sql += `select v.code, v.name, k.id, v.lat, v.lng, nullif(v.address,'')\n`;
  sql += `from (values\n`;
  sql += grp.map(b => {
    const k = kotaById[b.kota_id];
    const regName = k ? regionById[k.region_id] : '';
    return `  (${sqlStr(b.code)}, ${sqlStr(b.name)}, ${sqlStr(k ? k.name : '')}, ${sqlStr(regName)}, ${sqlNum(b.lat)}::double precision, ${sqlNum(b.lng)}::double precision, ${sqlStr(b.address || '')})`;
  }).join(',\n');
  sql += `\n) as v(code, name, kota, region, lat, lng, address)\n`;
  sql += `join regions r on r.name = v.region\n`;
  sql += `join kotas k on k.name = v.kota and k.region_id = r.id\n`;
  sql += `on conflict (code) do nothing;\n\n`;
});

fs.writeFileSync(SQL_OUT, sql, 'utf8');

console.log('✅ seedData.js generated:');
console.log(`   regions      : ${regions.length}`);
console.log(`   distributors : ${distributors.length}`);
console.log(`   kotas        : ${kotas.length} (auto-created dari bengkel: ${autoKota})`);
console.log(`   bengkels     : ${bengkels.length}`);
console.log(`   skipped (no kota): ${report.noKotaMatch}, dup code fixed: ${report.dupCode}`);
console.log(`   seedData.js       : ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log(`   supabase_seed.sql : ${(fs.statSync(SQL_OUT).size / 1024).toFixed(0)} KB`);
