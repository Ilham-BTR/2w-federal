// ============================================================
// Backup data Supabase -> 1 file JSON (semua tabel public + akun auth).
// TANPA Docker, TANPA install: pakai Node + @supabase/supabase-js (sudah ada
// sebagai dependency app). Pakai service_role key supaya bypass RLS & baca semua.
//
// Jalankan:  node ops/backup/backup.mjs
// Jadwal:    lihat register-task.ps1 / README.md
// ============================================================
import { createClient } from '@supabase/supabase-js';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  readdirSync, statSync, unlinkSync, appendFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(__dirname, 'backup.config.json');

if (!existsSync(cfgPath)) {
  console.error('Config belum ada. Copy backup.config.example.json -> backup.config.json lalu isi.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (!cfg.supabaseUrl || !cfg.serviceRoleKey || /GANTI_/.test(cfg.serviceRoleKey)) {
  console.error('supabaseUrl / serviceRoleKey belum diisi di backup.config.json.');
  process.exit(1);
}
const keepLast = cfg.keepLast || 12;
const dumpDir = cfg.backupDir?.trim() ? cfg.backupDir : join(__dirname, 'dumps');
if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true });
const logFile = join(__dirname, 'backup.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(logFile, line + '\n');
  console.log(line);
}

const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Urutan FK-aman (parent dulu) — dipakai juga saat restore.
const TABLES = ['region_groups', 'regions', 'distributors', 'kotas', 'bengkels', 'profiles', 'visits', 'attendances', 'tl_regions'];

async function dumpTable(name) {
  const rows = [];
  const batch = 1000;
  for (let from = 0; ; from += batch) {
    const { data, error } = await supabase.from(name).select('*').range(from, from + batch - 1);
    if (error) throw new Error(`Tabel ${name}: ${error.message}`);
    rows.push(...data);
    if (data.length < batch) break;
  }
  return rows;
}

async function dumpAuthUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth users: ${error.message}`);
    const list = data?.users || [];
    users.push(...list.map((u) => ({
      id: u.id, email: u.email, phone: u.phone,
      created_at: u.created_at, email_confirmed_at: u.email_confirmed_at,
      user_metadata: u.user_metadata, app_metadata: u.app_metadata,
    })));
    if (list.length < 1000) break;
  }
  return users;
}

// Retry: mis. run 04:10 pagi (PC baru bangun, network belum siap) → coba lagi nanti.
const TRIES = 3, DELAY_MS = 5 * 60_000;

async function run() {
  log('Mulai backup...');
  const tables = {};
  const counts = {};
  for (const t of TABLES) {
    const rows = await dumpTable(t);
    tables[t] = rows;
    counts[t] = rows.length;
    log(`  ${t}: ${rows.length} baris`);
  }

  let authUsers = [];
  try {
    authUsers = await dumpAuthUsers();
    counts['auth.users'] = authUsers.length;
    log(`  auth.users: ${authUsers.length} akun`);
  } catch (e) {
    log(`  PERINGATAN: gagal ambil auth users (${e.message}) — lanjut tanpa itu.`);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const payload = {
    meta: { createdAt: new Date().toISOString(), supabaseUrl: cfg.supabaseUrl, tableOrder: TABLES, counts },
    tables,
    authUsers,
  };
  const file = join(dumpDir, `supabase_backup_${ts}.json`);
  writeFileSync(file, JSON.stringify(payload));
  const sizeMB = (statSync(file).size / (1024 * 1024)).toFixed(2);
  log(`OK: ${file} (${sizeMB} MB)`);

  // Rotasi: simpan keepLast file terbaru, sisanya hapus.
  const files = readdirSync(dumpDir)
    .filter((f) => /^supabase_backup_.*\.json$/.test(f))
    .map((f) => ({ f, t: statSync(join(dumpDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keepLast)) {
    unlinkSync(join(dumpDir, f));
    log(`Hapus backup lama: ${f}`);
  }
  log(`Selesai. File backup tersimpan: ${Math.min(files.length, keepLast)} (maks ${keepLast}).`);
}

for (let i = 1; i <= TRIES; i++) {
  try {
    await run();
    process.exit(0);
  } catch (e) {
    log(`GAGAL (percobaan ${i}/${TRIES}): ${e.message}`);
    if (i < TRIES) {
      log(`Coba lagi dalam ${DELAY_MS / 60_000} menit...`);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
}
process.exit(1);
