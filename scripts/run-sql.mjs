// scripts/run-sql.mjs — jalankan file SQL ke Supabase via Management API.
// Pakai: SB_TOKEN=<token> node scripts/run-sql.mjs <path-sql> [project-ref]
import fs from 'fs';

const token = process.env.SB_TOKEN;
const file = process.argv[2];
const ref = process.argv[3] || 'azopkafxylmhrjapnadk';

if (!token) { console.error('SB_TOKEN env kosong'); process.exit(1); }
if (!file) { console.error('Path SQL kosong'); process.exit(1); }

const sql = fs.readFileSync(file, 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text);
process.exit(res.ok ? 0 : 1);
