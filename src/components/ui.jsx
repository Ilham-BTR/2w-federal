// src/components/ui.jsx
// Komponen UI primitif bersama (dipakai MD & Admin) — dulu menumpuk di App.jsx.
// Langkah 3 pemecahan App.jsx. Presentational; nol perubahan perilaku.

import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, Search, Loader2, Shield, X, MapPin, AlertCircle, CalendarDays } from 'lucide-react';
import { STATUS_STYLES, HASIL_TERPASANG } from '../lib/constants';
import { getPhotoURL } from '../lib/photoStore';
import { haversineMeters, formatDistance } from '../lib/format';

export const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES[HASIL_TERPASANG];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
};

export const Section = ({ title, subtitle, children, icon: Icon }) => (
  <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 mb-4">
    <div className="flex items-center gap-3 mb-4">
      {Icon && (
        <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-600/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-blue-500" />
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold text-slate-100 tracking-wide">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

export const Field = ({ label, children, required }) => (
  <div className="mb-3">
    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
      {label} {required && <span className="text-blue-500">*</span>}
    </label>
    {children}
  </div>
);

export const Input = (props) => (
  <input
    {...props}
    className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition ${props.className || ''}`}
  />
);

export const Select = ({ children, ...props }) => (
  <div className="relative">
    <select
      {...props}
      className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 pr-9 text-sm text-slate-100 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition cursor-pointer"
    >
      {children}
    </select>
    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
  </div>
);

export const Textarea = (props) => (
  <textarea
    {...props}
    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition resize-none"
  />
);

// Dropdown dengan search box. options = [{ value, label }]
export const SearchableSelect = ({ value, onChange, options, placeholder = 'Pilih…', disabled = false, emptyText = 'Tidak ada hasil' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find(o => String(o.value) === String(value));
  // Batasi jumlah opsi yang dirender (mis. 2705 bengkel) -> render semua node
  // sekaligus bikin HP freeze saat dropdown dibuka. Cap 100; sisanya disaring via ketik.
  const OPT_CAP = 100;
  const matched = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  const filtered = matched.slice(0, OPT_CAP);
  const moreCount = matched.length - filtered.length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) { setQuery(''); setActiveIdx(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const pick = (opt) => { onChange(opt.value); setOpen(false); setQuery(''); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) pick(filtered[activeIdx]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 bg-slate-950 border rounded-lg px-3 py-2.5 text-sm text-left transition cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed border-slate-800' : 'border-slate-800 hover:border-slate-700'}
          ${open ? 'border-blue-600/50 ring-1 ring-blue-600/30' : ''}`}
      >
        <span className={`truncate ${selected ? 'text-slate-100' : 'text-slate-600'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setActiveIdx(0); }}
                onKeyDown={onKeyDown}
                placeholder="Cari…"
                className="w-full bg-slate-950 border border-slate-800 rounded-md pl-8 pr-2 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50"
              />
            </div>
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">{emptyText}</div>
            ) : filtered.map((o, i) => {
              const isSel = String(o.value) === String(value);
              const isActive = i === activeIdx;
              return (
                <button
                  key={o.value ?? `opt-${i}`}
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => pick(o)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition
                    ${isActive ? 'bg-slate-800' : ''} ${isSel ? 'text-blue-400 font-medium' : 'text-slate-200'}`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              );
            })}
            {moreCount > 0 && (
              <div className="px-3 py-2 text-[11px] text-slate-500 text-center border-t border-slate-800/60">
                +{moreCount} lagi — ketik untuk mempersempit
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const Button = ({ children, variant = 'primary', size = 'md', ...props }) => {
  const variants = {
    primary: 'bg-blue-600 hover:bg-blue-500 text-white border-blue-600 disabled:bg-blue-900/50 disabled:border-blue-900/50 disabled:cursor-not-allowed',
    secondary: 'bg-slate-950 hover:bg-slate-800 text-slate-100 border-slate-800',
    ghost: 'bg-transparent hover:bg-slate-950 text-slate-400 hover:text-slate-100 border-transparent',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base',
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-lg border transition ${variants[variant]} ${sizes[size]} ${props.className || ''}`}
    >
      {children}
    </button>
  );
};

export const formatSize = (bytes) => {
  if (!bytes) return '0KB';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};


// --- Komponen kecil bersama (badge, foto, rentang tanggal, loading) ---

export function StoredImage({ src, alt, className, onClick }) {
  const [resolved, setResolved] = useState(src?.startsWith('idb:') ? null : src);
  useEffect(() => {
    let active = true;
    if (src?.startsWith('idb:')) {
      setResolved(null);
      getPhotoURL(src.slice(4)).then(u => { if (active) setResolved(u); });
    } else {
      setResolved(src);
    }
    return () => { active = false; };
  }, [src]);

  if (!resolved) {
    return <div className={`flex items-center justify-center bg-slate-900 ${className || ''}`}><Loader2 className="w-5 h-5 text-slate-600 animate-spin" /></div>;
  }
  return <img src={resolved} alt={alt} className={className} onClick={onClick} />;
}


export function DateRangeRow({ dari, sampai, onDari, onSampai, onReset, className = '' }) {
  return (
    <div className={`flex items-center gap-2 text-xs text-slate-500 ${className}`}>
      <span className="flex items-center gap-1.5 shrink-0">
        <CalendarDays className="w-3.5 h-3.5" /><span className="hidden sm:inline">Rentang tanggal:</span>
      </span>
      <input type="date" value={dari} onChange={e => onDari(e.target.value)}
        className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-blue-600/50 [color-scheme:dark]" />
      <span className="text-slate-600 shrink-0">–</span>
      <input type="date" value={sampai} onChange={e => onSampai(e.target.value)}
        className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-blue-600/50 [color-scheme:dark]" />
      {(dari || sampai) && (
        <button onClick={onReset} className="text-blue-400 hover:text-blue-300 font-medium shrink-0">Reset</button>
      )}
    </div>
  );
}


export function OnSiteBadge({ bengkel, visit }) {
  if (visit.visit_lat == null || visit.visit_lng == null || bengkel?.lat == null || bengkel?.lng == null) return null;
  const d = haversineMeters(bengkel.lat, bengkel.lng, visit.visit_lat, visit.visit_lng);
  if (d < 100) return <span className="text-[10px] text-emerald-400 flex items-center gap-0.5" title={`${formatDistance(d)} dari bengkel`}><MapPin className="w-2.5 h-2.5" />on-site</span>;
  if (d > 500) return <span className="text-[10px] text-rose-400 flex items-center gap-0.5" title={`${formatDistance(d)} dari bengkel`}><AlertCircle className="w-2.5 h-2.5" />{formatDistance(d)}</span>;
  return null; // 100–500m: netral, tidak ditampilkan agar tidak ramai
}


export function CheckBadge({ visit }) {
  if (!visit.check_status) {
    return <span className="text-[10px] text-slate-500 flex items-center gap-0.5" title="Belum dicek admin"><Shield className="w-2.5 h-2.5" />belum dicek</span>;
  }
  const ok = visit.check_status === 'Sesuai';
  return (
    <span className={`text-[10px] flex items-center gap-0.5 ${ok ? 'text-emerald-400' : 'text-rose-400'}`} title={visit.check_remarks || visit.check_status}>
      {ok ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}{visit.check_status.toLowerCase()}
    </span>
  );
}


export function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
    </div>
  );
}

