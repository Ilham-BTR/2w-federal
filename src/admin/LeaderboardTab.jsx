// src/admin/LeaderboardTab.jsx
// Tab Leaderboard (ranking MD) — dipindah utuh dari App.jsx (langkah 5).
// Verbatim; logika & output identik. Data lewat props.

import { useState, useMemo } from 'react';
import { Trophy } from 'lucide-react';
import { DateRangeRow, Select } from '../components/ui';
import { monthLabel } from '../lib/format';
import { HASIL_TERPASANG } from '../lib/constants';

export function LeaderboardTab({ visits, mds, regions }) {
  const monthsList = useMemo(() => {
    const set = new Set(visits.map(v => v.visit_date.slice(0, 7)));
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort().reverse();
  }, [visits]);
  const [month, setMonth] = useState(monthsList[0]);
  const [metric, setMetric] = useState('visits'); // 'visits' | 'achievement'
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');

  const regionName = (id) => regions.find(r => r.id === id)?.name || '';

  const ranked = useMemo(() => {
    const rows = mds.filter(m => m.active !== false).map(m => {
      const mv = visits.filter(v => {
        if (v.md_id !== m.id) return false;
        if (dari || sampai) return (!dari || v.visit_date >= dari) && (!sampai || v.visit_date <= sampai);
        return v.visit_date.startsWith(month);
      });
      const total = mv.length;
      const target = m.monthly_target || 30;
      const achievement = target > 0 ? Math.round((total / target) * 100) : 0;
      const pemasangan = mv.filter(v => v.status === HASIL_TERPASANG).length;
      const revisit = mv.filter(v => v.status !== HASIL_TERPASANG).length;
      const activeDays = new Set(mv.map(v => v.visit_date)).size;
      return { md: m, total, target, achievement, pemasangan, revisit, activeDays };
    });
    rows.sort((a, b) => metric === 'visits'
      ? (b.total - a.total) || (b.achievement - a.achievement)
      : (b.achievement - a.achievement) || (b.total - a.total));
    return rows;
  }, [visits, mds, month, metric, dari, sampai]);

  const totalVisits = ranked.reduce((s, r) => s + r.total, 0);
  const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
  const rankRing = (i) => i === 0 ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
    : i === 1 ? 'border-slate-400/40 bg-slate-400/10 text-slate-200'
    : i === 2 ? 'border-orange-700/50 bg-orange-700/15 text-orange-300'
    : 'border-slate-800 bg-slate-900 text-slate-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />Ranking MD
          </h2>
          <p className="text-sm text-slate-500 mt-1">{ranked.length} MD · {totalVisits} visit · {(dari || sampai) ? 'rentang tanggal' : `bulan ${monthLabel(month)}`}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button onClick={() => setMetric('visits')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${metric === 'visits' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>Jumlah Visit</button>
            <button onClick={() => setMetric('achievement')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${metric === 'achievement' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>Achievement</button>
          </div>
          <div className="w-36"><Select value={month} onChange={e => setMonth(e.target.value)}>{monthsList.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select></div>
        </div>
      </div>

      <DateRangeRow className="mb-4 -mt-2"
        dari={dari} sampai={sampai} onDari={setDari} onSampai={setSampai}
        onReset={() => { setDari(''); setSampai(''); }} />

      {ranked.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">Belum ada MD aktif.</div>
      ) : (
        <div className="space-y-1.5">
          {ranked.map((r, i) => (
            <div key={r.md.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg border flex items-center justify-center text-sm font-bold shrink-0 ${rankRing(i)}`}>
                {medal(i) || (i + 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-100 truncate">{r.md.full_name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {regionName(r.md.region_id) && <>{regionName(r.md.region_id)} · </>}
                  {r.activeDays} hari aktif · <span className="text-emerald-400">{r.pemasangan} pasang</span> · <span className="text-sky-400">{r.revisit} revisit</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${r.achievement >= 80 ? 'bg-emerald-500' : r.achievement >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(r.achievement, 100)}%` }} />
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold text-slate-100 leading-none">{r.total}<span className="text-xs text-slate-500 font-normal">/{r.target}</span></div>
                <div className={`text-xs font-medium mt-0.5 ${r.achievement >= 80 ? 'text-emerald-400' : r.achievement >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{r.achievement}%</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ADMIN VIEW
// ============================================================

// ============================================================
// LAPORAN COVERAGE — rekap Region → Provinsi/Kota vs jumlah bengkel (target),
// dipecah per kategori hasil visit. Format mengikuti laporan Excel AA.
// ============================================================
