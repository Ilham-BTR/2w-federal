// ============================================================
// Restore data dari file backup JSON -> upsert ke Supabase.
// Pakai untuk memulihkan data yang terhapus/terubah (project yang SAMA).
// Untuk rebuild project baru dari nol, lihat README ("Pemulihan total").
//
// Contoh:
//   node ops/backup/restore.mjs ops/backup/dumps/supabase_backup_2026-07-01_02-00-00.json
//   node ops/backup/restore.mjs <file> --only=visits,attendances     (sebagian tabel)
//   node ops/backup/restore.mjs <file> --dry-run                     (lihat dulu, tak menulis)
// ============================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, 'backup.config.json'), 'utf8'));

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: node restore.mjs <path-backup.json> [--only=tabel1,tabel2] [--dry-run]');
  process.exit(1);
}
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
const dryRun = process.argv.includes('--dry-run');

// Kolom konflik (PK) per tabel — default 'id', tl_regions composite.
const CONFLICT = { tl_regions: 'tl_id,region_id' };

const payload = JSON.parse(readFileSync(file, 'utf8'));
const order = payload.meta?.tableOrder ||
  ['region_groups', 'regions', 'distributors', 'kotas', 'bengkels', 'profiles', 'visits', 'attendances', 'tl_regions'];

const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`Restore dari: ${file}`);
console.log(`Dibuat: ${payload.meta?.createdAt || '?'}${dryRun ? '  (DRY-RUN — tidak menulis)' : ''}\n`);

for (const t of order) {
  if (only && !only.includes(t)) continue;
  const rows = payload.tables?.[t] || [];
  if (!rows.length) { console.log(`- ${t}: 0 baris (lewati)`); continue; }
  if (dryRun) { console.log(`- ${t}: akan upsert ${rows.length} baris`); continue; }

  const onConflict = CONFLICT[t] || 'id';
  let done = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from(t).upsert(chunk, { onConflict });
    if (error) { console.error(`\nGAGAL ${t}: ${error.message}`); process.exit(1); }
    done += chunk.length;
    process.stdout.write(`\r- ${t}: ${done}/${rows.length}`);
  }
  console.log(`\r- ${t}: ${done}/${rows.length} OK   `);
}
console.log(`\n${dryRun ? 'Dry-run selesai.' : 'Restore selesai.'}`);
