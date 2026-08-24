// src/lib/format.js
// Helper format & util murni (tanpa React/state) yang dulu tersebar di App.jsx.
// Langkah 2 pemecahan App.jsx — tidak ada perubahan perilaku.

// --- Geo ---
export const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
export const formatDistance = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`;

// --- Tanggal & waktu (tampilan Indonesia) ---
// Format "2026-06" → "Juni 2026" (nilai asli tetap YYYY-MM)
const ID_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
export const monthLabel = (ym) => {
  if (!ym || !ym.includes('-')) return ym;
  const [y, m] = ym.split('-');
  return `${ID_MONTHS[Number(m) - 1] || m} ${y}`;
};

// Tanggal LOKAL (bukan UTC) agar absen tercatat di hari yang benar di Indonesia.
export const localDateStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const fmtAbsenTime = (iso) => iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';

// Durasi kerja "Xj Ym" dari timestamp masuk/pulang (null kalau belum lengkap).
export const fmtWorkDuration = (a) => {
  if (!a?.check_in_at || !a?.check_out_at) return null;
  const mins = Math.round((new Date(a.check_out_at) - new Date(a.check_in_at)) / 60000);
  if (mins < 0) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}j ${m}m` : `${h}j`) : `${m}m`;
};

// --- Excel serial (untuk export xlsx) ---
const XL_EPOCH = Date.UTC(1899, 11, 30);
export const excelDateSerial = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return Math.round((Date.UTC(y, m - 1, d) - XL_EPOCH) / 86400000);
};
// timestamp ISO (UTC) -> serial (hari + pecahan jam), ditampilkan dlm WIB (UTC+7)
export const excelDateTimeSerial = (ts) => {
  if (!ts) return '';
  const w = new Date(new Date(ts).getTime() + 7 * 3600000);
  return (Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()) - XL_EPOCH) / 86400000;
};

// Set format tampilan cell tanggal (cell type Date) -> tampil dd/mm/yyyy,
// tetap tipe DATE di Excel (bisa di-sort/filter tanggal).
export function setColDateFormat(XLSX, ws, header, fmt) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  let col = -1;
  for (let c = range.s.c; c <= range.e.c; c++) { const h = ws[XLSX.utils.encode_cell({ r: 0, c })]; if (h && String(h.v) === header) { col = c; break; } }
  if (col < 0) return;
  for (let r = 1; r <= range.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c: col })]; if (cell && (cell.t === 'd' || cell.t === 'n') && cell.v != null) cell.z = fmt; }
}
