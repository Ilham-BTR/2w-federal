import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import imageCompression from 'browser-image-compression';
import { VISIT_PHOTO_MAP } from './lib/storage';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, ReferenceLine, LabelList
} from 'recharts';
import {
  MapPin, Camera, Calendar, User, Building2, Check, X,
  Filter, Plus, ChevronRight, ChevronLeft, LayoutDashboard, ClipboardList,
  Map as MapIcon, Database, Target, Activity, Trash2,
  Users, Briefcase, Globe, ChevronDown, LogOut, Shield,
  Lock, Mail, Eye, EyeOff, AlertCircle, Fingerprint, Loader2,
  Navigation, Phone, FileText, Download, Search, Upload, FileSpreadsheet,
  LogIn, Clock, CalendarDays, Trophy, Power, MessageCircle, Pencil
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polyline, Circle } from 'react-leaflet';
import L from 'leaflet';

import { MOCK_MODE } from './lib/supabase';
import * as api from './lib/api';
import { getPhotoURL } from './lib/photoStore';

// Saklar fitur passkey/biometrik. Set true untuk menghidupkan kembali login biometrik.
const PASSKEY_ENABLED = false;

// Custom pin marker factory (inline SVG via divIcon — no asset path issues)
const makePinIcon = (color = '#2563eb', pulse = true) => L.divIcon({
  className: 'federal2w-marker',
  html: `
    <div style="position:relative;">
      ${pulse ? `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:32px;height:32px;background:${color};border-radius:50%;opacity:0.35;animation:m1pulse 1.5s ease-out infinite;"></div>` : ''}
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="#0a0a0a" stroke-width="1.5" stroke-linejoin="round" style="position:relative;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
        <circle cx="12" cy="10" r="3" fill="#0a0a0a" stroke="none"/>
      </svg>
    </div>
    <style>@keyframes m1pulse{0%{transform:translate(-50%,-50%) scale(0.6);opacity:0.6;}100%{transform:translate(-50%,-50%) scale(1.8);opacity:0;}}</style>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 26],
  popupAnchor: [0, -24],
});

const RED_PIN_ICON  = makePinIcon('#2563eb', true);
const BLUE_PIN_ICON = makePinIcon('#3b82f6', true);

// Tile peta. Kalau VITE_MAPBOX_TOKEN diisi → Mapbox "streets" (terang & detail);
// kalau belum → fallback ke CARTO versi TERANG (gratis, tanpa key).
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = MAPBOX_TOKEN ? '&copy; Mapbox &copy; OpenStreetMap' : '&copy; CARTO &copy; OSM';

// Kunci scroll body pakai COUNTER, bukan simpan/restore nilai lama. Pola lama
// (const prev = body.style.overflow) bocor kalau modal bertumpuk: modal terakhir
// bisa merestore 'hidden' → body ke-lock permanen → halaman terasa "freeze" /
// tombol di bawah layar tak bisa diklik sampai di-refresh. Counter ini menjamin
// body baru dibuka kembali saat SEMUA modal tertutup.
let __scrollLocks = 0;
const __lockBodyScroll = () => { __scrollLocks++; document.body.style.overflow = 'hidden'; };
const __unlockBodyScroll = () => { __scrollLocks = Math.max(0, __scrollLocks - 1); if (__scrollLocks === 0) document.body.style.overflow = ''; };

// Haversine distance (meter) between 2 lat/lng
const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const formatDistance = (m) => m < 1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`;

// Format "2026-06" → "Juni 2026" untuk tampilan (nilai asli tetap YYYY-MM)
const ID_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const monthLabel = (ym) => {
  if (!ym || !ym.includes('-')) return ym;
  const [y, m] = ym.split('-');
  return `${ID_MONTHS[Number(m) - 1] || m} ${y}`;
};

// Set format tampilan cell tanggal (kolom cell type Date) -> tampil dd/mm/yyyy
// tapi tetap tipe DATE di Excel (bisa di-sort/filter tanggal).
function setColDateFormat(XLSX, ws, header, fmt) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  let col = -1;
  for (let c = range.s.c; c <= range.e.c; c++) { const h = ws[XLSX.utils.encode_cell({ r: 0, c })]; if (h && String(h.v) === header) { col = c; break; } }
  if (col < 0) return;
  for (let r = 1; r <= range.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c: col })]; if (cell && (cell.t === 'd' || cell.t === 'n') && cell.v != null) cell.z = fmt; }
}

// Export daftar visit ke Excel (.xlsx) — XLSX di-load dinamis (lazy)
async function exportVisitsXlsx(visits, ctx, filename) {
  if (!visits || visits.length === 0) return;
  const XLSX = await import('xlsx');
  const rows = visits.map(v => visitToCSVRow(v, ctx));
  const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true });
  setColDateFormat(XLSX, ws, 'tanggal', 'dd/mm/yyyy');
  setColDateFormat(XLSX, ws, 'waktu_submit', 'dd/mm/yyyy hh:mm');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Visits');
  XLSX.writeFile(wb, filename);
}

// CSV export helper — RFC 4180 escaped (dipakai bila perlu CSV mentah)
const exportToCSV = (rows, filename) => {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
  // Prepend BOM agar Excel ID buka UTF-8 dengan benar
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Serial Excel (angka) untuk tanggal/waktu -> cell jadi tipe DATE asli di Excel
// (bisa di-sort/filter tanggal), format tampilan diatur via setColDateFormat.
// Pakai serial (bukan objek Date) supaya bebas bug timezone SheetJS (off-by-one).
const XL_EPOCH = Date.UTC(1899, 11, 30);
// "YYYY-MM-DD" -> serial hari
const excelDateSerial = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return Math.round((Date.UTC(y, m - 1, d) - XL_EPOCH) / 86400000);
};
// timestamp ISO (UTC) -> serial (hari + pecahan jam), ditampilkan dlm WIB (UTC+7)
const excelDateTimeSerial = (ts) => {
  if (!ts) return '';
  const w = new Date(new Date(ts).getTime() + 7 * 3600000);
  return (Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()) - XL_EPOCH) / 86400000;
};

// Build flat row dari visit untuk CSV export
const visitToCSVRow = (v, ctx) => {
  const b = ctx.bengkels.find(x => x.id === v.bengkel_id);
  const k = b ? ctx.kotas.find(x => x.id === b.kota_id) : null;
  const r = k ? ctx.regions.find(x => x.id === k.region_id) : null;
  const md = ctx.mds.find(x => x.id === v.md_id);
  const photoCount = PHOTO_KEYS.filter(key => v[key]).length;
  return {
    visit_id: v.id,
    tanggal: excelDateSerial(v.visit_date),
    waktu_submit: excelDateTimeSerial(v.created_at),
    md_name: md?.full_name || v.md_name || '',
    md_email: md?.email || v.md_email || '',
    region: groupOfRegion(r),
    provinsi: r?.name || v.region_name || '',
    kota: k?.name || v.kota_name || '',
    bengkel_code: b?.code || '',
    bengkel_name: b?.name || v.bengkel_name || '',
    bengkel_alamat: b?.address || '',
    hasil_visit: v.status,
    notes: v.remarks || '',
    bengkel_lat: b?.lat ?? '',
    bengkel_lng: b?.lng ?? '',
    visit_lat: v.visit_lat ?? '',
    visit_lng: v.visit_lng ?? '',
    photo_count: photoCount,
    // Link tiap foto (URL R2/CDN di produksi): selfie, before, after, spanduk jauh/sedang, poster.
    ...Object.fromEntries(PHOTO_KEYS.filter(k => !EXPORT_PHOTO_SKIP.has(k)).map(k => [
      EXPORT_PHOTO_HEADER[k] || ('link_' + k.replace(/^photo_/, '')),   // mis. link_tampak_depan, link_spanduk_biru, ...
      typeof v[k] === 'string' && v[k].startsWith('http') ? v[k] : (v[k] ? '(foto lokal/idb)' : ''),
    ])),
    // --- Hasil pengecekan admin/AA ---
    status_cek: v.check_status || 'Belum Dicek',
    foto_tidak_sesuai: v.photo_checks
      ? Object.entries(v.photo_checks).filter(([, s]) => s === 'bad').map(([col]) => PHOTO_LABELS[col] || col).join(', ')
      : '',
    dicek_oleh: (ctx.accounts || ctx.mds || []).find(a => a.id === v.checked_by)?.full_name || '',
    tanggal_cek: v.checked_at ? excelDateTimeSerial(v.checked_at) : '',
    remarks_admin: v.check_remarks || '',
    created_at: v.created_at || '',   // tetap kolom paling kanan
  };
};

// Recenter map when coords change (Leaflet map doesn't react to prop changes by default)
function RecenterMap({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) {
      map.flyTo([lat, lng], map.getZoom(), { duration: 0.6 });
    }
  }, [lat, lng, map]);
  return null;
}

// Fit bounds when 2 points exist; preserve user zoom for single-point updates (drag-friendly)
function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 2) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    } else if (points.length === 1) {
      const targetZoom = Math.max(map.getZoom(), 15);
      map.flyTo(points[0], targetZoom, { duration: 0.4 });
    }
  }, [JSON.stringify(points), map]);
  return null;
}

const BengkelMap = ({
  lat, lng, name, code,
  userLat, userLng, gpsStatus, gpsError, accuracy,
  onRefetchGPS, onUserLocationChange,
}) => {
  const hasBengkel = lat != null && lng != null;
  const hasUser = userLat != null && userLng != null;
  const userPinDraggable = false; // pin tidak bisa digeser — pakai titik long/lat GPS apa adanya

  // Empty state: bengkel ✗ AND user ✗ → tampilkan placeholder + retry GPS
  if (!hasBengkel && !hasUser) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 flex flex-col items-center justify-center gap-3 min-h-[180px]">
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          {gpsStatus === 'loading'
            ? <><Loader2 className="w-4 h-4 animate-spin" />Mengambil GPS…</>
            : gpsStatus === 'error'
              ? <><AlertCircle className="w-4 h-4 text-rose-400" /><span className="text-rose-400">{gpsError || 'GPS gagal'}</span></>
              : <><MapPin className="w-4 h-4" />Menunggu GPS…</>}
        </div>
        <p className="text-[11px] text-slate-500 text-center max-w-xs">
          Bengkel ini belum punya koordinat & GPS Anda belum aktif. Aktifkan GPS untuk capture lokasi visit.
        </p>
        {onRefetchGPS && (
          <button onClick={onRefetchGPS} type="button"
            className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-600/30 bg-blue-600/10">
            <Navigation className="w-3.5 h-3.5" />Ambil GPS
          </button>
        )}
      </div>
    );
  }

  // Compute map center & points
  const distance = (hasBengkel && hasUser) ? haversineMeters(lat, lng, userLat, userLng) : null;
  const points = [hasBengkel && [lat, lng], hasUser && [userLat, userLng]].filter(Boolean);
  const center = hasBengkel ? [lat, lng] : [userLat, userLng];

  return (
    <div className="rounded-xl overflow-hidden border border-slate-800">
      <MapContainer
        center={center}
        zoom={16}
        scrollWheelZoom={false}
        style={{ height: '220px', width: '100%' }}
      >
        <TileLayer
          attribution={TILE_ATTR}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
        />
        {/* Pin bengkel (merah) */}
        {hasBengkel && (
          <Marker position={[lat, lng]} icon={RED_PIN_ICON}>
            <Popup>
              <div className="text-xs">
                <div className="font-mono text-[10px] text-slate-400">{code}</div>
                <div className="font-semibold text-slate-100">{name}</div>
                <div className="font-mono text-[10px] text-slate-500 mt-1">{lat.toFixed(5)}, {lng.toFixed(5)}</div>
              </div>
            </Popup>
          </Marker>
        )}
        {/* Pin user (biru) + accuracy circle */}
        {hasUser && (
          <>
            <Marker
              position={[userLat, userLng]}
              icon={BLUE_PIN_ICON}
              draggable={userPinDraggable}
              eventHandlers={userPinDraggable ? {
                dragend: (e) => {
                  const pos = e.target.getLatLng();
                  onUserLocationChange(pos.lat, pos.lng);
                },
              } : undefined}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-semibold text-slate-100">Lokasi Anda{userPinDraggable && ' (drag untuk koreksi)'}</div>
                  <div className="font-mono text-[10px] text-slate-500 mt-1">{userLat.toFixed(5)}, {userLng.toFixed(5)}</div>
                  {accuracy && <div className="text-[10px] text-slate-400 mt-0.5">Akurasi ±{Math.round(accuracy)} m</div>}
                </div>
              </Popup>
            </Marker>
            {accuracy && accuracy < 500 && !userPinDraggable && (
              <Circle center={[userLat, userLng]} radius={accuracy} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 1 }} />
            )}
            {hasBengkel && (
              <Polyline positions={[[lat, lng], [userLat, userLng]]} pathOptions={{ color: '#71717a', weight: 2, dashArray: '6 4' }} />
            )}
          </>
        )}
        <FitBounds points={points} />
      </MapContainer>

      {/* Status Bar */}
      <div className="bg-slate-950 border-t border-slate-800 divide-y divide-slate-800/60">
        {hasBengkel && (
          <div className="px-3 py-2 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />Bengkel
            </span>
            <span className="font-mono text-slate-300">{lat.toFixed(5)}, {lng.toFixed(5)}</span>
          </div>
        )}
        <div className="px-3 py-2 flex items-center justify-between text-xs gap-2">
          <span className="text-slate-400 flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${hasUser ? 'bg-blue-500' : 'bg-slate-700'}`} />
            {userPinDraggable ? 'Lokasi Visit (drag pin)' : 'Lokasi Saya'}
          </span>
          {gpsStatus === 'loading' && (
            <span className="flex items-center gap-1.5 text-slate-500"><Loader2 className="w-3 h-3 animate-spin" />Mengambil GPS…</span>
          )}
          {gpsStatus === 'error' && (
            <span className="text-rose-400 flex items-center gap-1.5"><AlertCircle className="w-3 h-3" />{gpsError || 'GPS gagal'}</span>
          )}
          {hasUser && (
            <span className="font-mono text-slate-300">{userLat.toFixed(5)}, {userLng.toFixed(5)}</span>
          )}
          {onRefetchGPS && (
            <button onClick={onRefetchGPS} type="button"
              className="ml-2 text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
              <Navigation className="w-3 h-3" />{hasUser ? 'Ulang' : 'Ambil GPS'}
            </button>
          )}
        </div>
        {distance != null && (
          <div className={`px-3 py-2 flex items-center justify-between text-xs font-medium ${distance < 100 ? 'bg-emerald-600/10 text-emerald-400' : distance < 500 ? 'bg-amber-600/10 text-amber-400' : 'bg-rose-600/10 text-rose-400'}`}>
            <span className="flex items-center gap-1.5">
              <Navigation className="w-3 h-3" />Jarak ke bengkel
            </span>
            <span className="font-mono">{formatDistance(distance)} {distance < 100 ? '· Di lokasi ✓' : distance < 500 ? '· Dekat' : '· Jauh dari bengkel'}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// BENGKEL PICKER MAP — Admin pick lat/lng via click/drag
// ============================================================

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

const INDONESIA_CENTER = { lat: -2.5, lng: 118 };
const JAKARTA_CENTER   = { lat: -6.2, lng: 106.85 };

const BengkelPickerMap = ({ lat, lng, onChange }) => {
  const hasPin = lat != null && lng != null;
  const center = hasPin ? [lat, lng] : [JAKARTA_CENTER.lat, JAKARTA_CENTER.lng];
  const zoom = hasPin ? 16 : 11;

  // Local string state untuk input manual (biar bisa ketik "-6." tanpa langsung di-commit)
  const [latText, setLatText] = useState(lat != null ? String(lat) : '');
  const [lngText, setLngText] = useState(lng != null ? String(lng) : '');

  // Sync dari props kalau berubah dari luar (klik map / drag / GPS)
  useEffect(() => { setLatText(lat != null ? String(lat) : ''); }, [lat]);
  useEffect(() => { setLngText(lng != null ? String(lng) : ''); }, [lng]);

  const useMyGPS = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => onChange(pos.coords.latitude, pos.coords.longitude),
      (err) => alert('Gagal ambil GPS: ' + (err.message || 'unknown')),
      { timeout: 20000, enableHighAccuracy: true }
    );
  };

  // Commit nilai input ke parent kalau valid. Mendukung paste "lat, lng" sekaligus.
  const commitLat = (raw) => {
    if (raw.trim() === '') return;  // kosong → jangan jadikan 0 (pakai tombol Hapus koordinat utk reset)
    // Deteksi paste "−6.25, 107.26" → split
    if (raw.includes(',')) {
      const [a, b] = raw.split(',').map(s => s.trim());
      const la = Number(a), ln = Number(b);
      if (!Number.isNaN(la) && !Number.isNaN(ln)) { onChange(la, ln); return; }
    }
    const la = Number(raw);
    if (!Number.isNaN(la) && la >= -90 && la <= 90 && lngText.trim() !== '') {
      const ln = Number(lngText);
      if (!Number.isNaN(ln)) onChange(la, ln);
    }
  };
  const commitLng = (raw) => {
    if (raw.trim() === '') return;  // kosong → jangan jadikan 0
    const ln = Number(raw);
    if (!Number.isNaN(ln) && ln >= -180 && ln <= 180 && latText.trim() !== '') {
      const la = Number(latText);
      if (!Number.isNaN(la)) onChange(la, ln);
    }
  };

  const latInvalid = latText.trim() !== '' && (Number.isNaN(Number(latText)) || Number(latText) < -90 || Number(latText) > 90);
  const lngInvalid = lngText.trim() !== '' && (Number.isNaN(Number(lngText)) || Number(lngText) < -180 || Number(lngText) > 180);

  return (
    <div className="rounded-xl overflow-hidden border border-slate-800">
      <div className="bg-slate-950 px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">Klik map, geser pin, atau ketik koordinat</span>
        <button type="button" onClick={useMyGPS}
          className="text-[11px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1">
          <Navigation className="w-3 h-3" />Pakai GPS Saya
        </button>
      </div>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={true}
        style={{ height: '260px', width: '100%', cursor: 'crosshair' }}
      >
        <TileLayer
          attribution={TILE_ATTR}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={19}
        />
        <MapClickHandler onPick={onChange} />
        {hasPin && (
          <Marker
            position={[lat, lng]}
            icon={RED_PIN_ICON}
            draggable={true}
            eventHandlers={{
              dragend: (e) => {
                const pos = e.target.getLatLng();
                onChange(pos.lat, pos.lng);
              },
            }}
          />
        )}
        {hasPin && <RecenterMap lat={lat} lng={lng} />}
      </MapContainer>
      {/* Input manual lat/lng */}
      <div className="bg-slate-950 px-3 py-2.5 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 flex items-center gap-1.5 text-xs shrink-0"><MapPin className="w-3 h-3 text-blue-500" />Lat / Lng</span>
          <div className="flex-1 grid grid-cols-2 gap-2">
            <input
              type="text" inputMode="decimal" placeholder="-6.251787"
              value={latText}
              onChange={e => { setLatText(e.target.value); commitLat(e.target.value); }}
              className={`w-full bg-slate-900 border rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none transition ${latInvalid ? 'border-rose-600/50' : 'border-slate-800 focus:border-blue-600/50'}`}
            />
            <input
              type="text" inputMode="decimal" placeholder="107.268440"
              value={lngText}
              onChange={e => { setLngText(e.target.value); commitLng(e.target.value); }}
              className={`w-full bg-slate-900 border rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none transition ${lngInvalid ? 'border-rose-600/50' : 'border-slate-800 focus:border-blue-600/50'}`}
            />
          </div>
        </div>
        {(latInvalid || lngInvalid) && (
          <p className="text-[10px] text-rose-400 mt-1.5">Lat harus -90..90, Lng harus -180..180</p>
        )}
        <p className="text-[10px] text-slate-600 mt-1.5">💡 Bisa paste "lat, lng" dari Google Maps langsung ke kolom Lat</p>
      </div>
    </div>
  );
};

// ============================================================
// VISIT DETAIL MODAL — Admin view individual visit
// ============================================================

// Foto bisa berupa: URL http (Supabase/B2), ref 'idb:...' (mock IndexedDB), atau 'mock' (seed lama)
const isPlaceholderPhoto = (url) => !url || url === 'mock';

// Render foto yang otomatis resolve ref IndexedDB → blob URL
function StoredImage({ src, alt, className, onClick }) {
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

const PHOTO_LABELS = {
  photo_selfie:         'Selfie Depan Bengkel',
  photo_before:         'Tampak Depan (Before)',
  photo_after:          'Tampak Depan (After)',
  photo_spanduk_jauh:   'Spanduk Jarak Jauh',
  photo_spanduk_sedang: 'Spanduk Jarak Sedang',
  photo_poster:         'Foto Poster',
};
const PHOTO_KEYS = Object.keys(PHOTO_LABELS);
const EXPORT_PHOTO_SKIP = new Set();
const EXPORT_PHOTO_HEADER = {
  photo_selfie:         'link_selfie',
  photo_before:         'link_before',
  photo_after:          'link_after',
  photo_spanduk_jauh:   'link_spanduk_jauh',
  photo_spanduk_sedang: 'link_spanduk_sedang',
  photo_poster:         'link_poster',
};
// Kolom DB foto -> UI key (uploadOneVisitPhoto butuh UI key, mis. 'tampakDepan')
const PHOTO_COL_TO_UIKEY = Object.fromEntries(
  Object.entries(VISIT_PHOTO_MAP).map(([uiKey, m]) => [m.col, uiKey])
);
// Warna ikon kartu KPI -> class LITERAL. Tailwind hanya generate class yang
// muncul utuh di source; `text-${x}-500` dinamis TIDAK ke-generate (mis. sky/amber
// jadi tak berwarna). Simpan literal di sini supaya semua warna kartu benar muncul.
const KPI_ICON_COLOR = {
  red: 'text-blue-500', emerald: 'text-emerald-500', sky: 'text-sky-500',
  blue: 'text-blue-500', amber: 'text-amber-500', rose: 'text-rose-500',
};

function VisitDetailModal({ visit, bengkel, kota, distributor, md, onClose, onDeleted, canEdit = false, onUpdated, bengkels = [], distributors = [], canCheck = false, checkerId = null }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);
  // Pengecekan admin/AA: tiap foto dinilai Sesuai/Tidak, 1 remarks untuk seluruh visit.
  const [checks, setChecks] = useState(() => visit.photo_checks || {});
  const [checkRemarks, setCheckRemarks] = useState(visit.check_remarks || '');
  const [savingCheck, setSavingCheck] = useState(false);
  const [checkSaved, setCheckSaved] = useState(false);
  const setCheck = (col, val) => { setChecks(c => ({ ...c, [col]: c[col] === val ? undefined : val })); setCheckSaved(false); };
  useBackDismiss(true, onClose);                                  // back -> tutup modal detail
  useBackDismiss(lightboxIdx != null, () => setLightboxIdx(null)); // back -> tutup foto fullscreen dulu

  // Ganti foto (admin) — upload foto baru ke R2 lalu update kolom visit.
  const [photoOverrides, setPhotoOverrides] = useState({}); // col -> url baru
  const [replacingCol, setReplacingCol] = useState(null);
  const replaceFileRef = useRef(null);
  const pendingColRef = useRef(null);
  const pickReplace = (col) => { pendingColRef.current = col; replaceFileRef.current?.click(); };
  const onReplaceFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const col = pendingColRef.current;
    if (!file || !col) return;
    const uiKey = PHOTO_COL_TO_UIKEY[col];
    if (!uiKey) { alert('Slot foto tak dikenal.'); return; }
    setReplacingCol(col);
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.2, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' });
      const { url } = await api.uploadOneVisitPhoto(compressed, visit.id, uiKey);
      await api.updateMaster('visits', visit.id, { [col]: url });
      setPhotoOverrides(o => ({ ...o, [col]: url }));
      onUpdated?.();
    } catch (err) {
      alert('Gagal ganti foto: ' + (err?.message || err));
    } finally {
      setReplacingCol(null);
    }
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteVisit(visit.id);
      onDeleted?.(visit.id);
      onClose();
    } catch (err) {
      alert('Gagal hapus visit: ' + err.message);
      setDeleting(false);
    }
  };

  // Kunci scroll body selama modal kebuka — biar background gak ikut scroll
  useEffect(() => {
    __lockBodyScroll();
    return __unlockBodyScroll;
  }, []);

  // Esc handler
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (lightboxIdx != null) setLightboxIdx(null);
        else onClose();
      }
      if (lightboxIdx != null) {
        if (e.key === 'ArrowRight') setLightboxIdx(i => (i + 1) % availablePhotos.length);
        if (e.key === 'ArrowLeft') setLightboxIdx(i => (i - 1 + availablePhotos.length) % availablePhotos.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Edit data visit (super admin) — ubah field yang diisi MD.
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);
  const setF = (patch) => setForm(f => ({ ...f, ...patch }));
  // timestamptz (UTC) -> nilai datetime-local (waktu browser/WIB)
  const toDTLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const startEdit = () => {
    setForm({
      visit_date: visit.visit_date || '',
      created_at: toDTLocal(visit.created_at),
      status: visit.status || HASIL_TERPASANG,
      bengkel_id: visit.bengkel_id || '',
      remarks: visit.remarks || '',
    });
    setEditMode(true);
  };
  const saveEdit = async () => {
    if (!form.visit_date || !form.bengkel_id) { alert('Tanggal & bengkel wajib diisi.'); return; }
    setSaving(true);
    try {
      await api.updateMaster('visits', visit.id, {
        visit_date: form.visit_date,
        created_at: form.created_at ? new Date(form.created_at).toISOString() : visit.created_at,
        status: form.status,
        bengkel_id: form.bengkel_id,
        remarks: form.remarks?.trim() || null,
      });
      onUpdated?.();
      setEditMode(false);
    } catch (e) {
      alert('Gagal simpan perubahan: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const availablePhotos = PHOTO_KEYS
    .filter(k => photoOverrides[k] ?? visit[k])
    .map(k => ({ key: k, label: PHOTO_LABELS[k], url: photoOverrides[k] ?? visit[k] }));

  const isMockPhoto = isPlaceholderPhoto;
  const hasBengkelCoord = bengkel?.lat != null && bengkel?.lng != null;
  const hasVisitCoord = visit.visit_lat != null && visit.visit_lng != null;
  const distance = (hasBengkelCoord && hasVisitCoord)
    ? haversineMeters(bengkel.lat, bengkel.lng, visit.visit_lat, visit.visit_lng)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto"
         onClick={onClose}>
      <div className="w-full max-w-3xl my-8 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 sticky top-0 bg-slate-950 z-10">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{bengkel?.code || '—'}</div>
            <div className="flex items-center gap-2 shrink-0">
              {canEdit && !editMode && (
                <button onClick={startEdit} title="Edit data visit"
                  className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white text-xs font-medium flex items-center gap-1.5 transition">
                  <Pencil className="w-3.5 h-3.5" />Edit
                </button>
              )}
              <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <h2 className="font-display font-bold text-lg text-slate-100 break-words leading-snug mt-0.5">{bengkel?.name || visit.bengkel_name || '—'}</h2>
          <div className="mt-1.5"><StatusBadge status={visit.status} /></div>
        </div>

        <div className="p-5 space-y-5">
          {/* Edit form (super admin) */}
          {editMode && form && (
            <div className="bg-amber-950/20 border border-amber-700/40 rounded-xl p-4 space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-2">
                <Pencil className="w-3.5 h-3.5" />Edit Data Visit
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-slate-400">Tanggal Visit</span>
                  <Input type="date" value={form.visit_date} onChange={e => setF({ visit_date: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Waktu Submit (Dibuat)</span>
                  <Input type="datetime-local" value={form.created_at} onChange={e => setF({ created_at: e.target.value })} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] text-slate-400">Hasil Visit</span>
                  <Select value={form.status} onChange={e => setF({ status: e.target.value })}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </label>
                <div className="sm:col-span-2">
                  <span className="text-[11px] text-slate-400">Bengkel</span>
                  <SearchableSelect value={form.bengkel_id} onChange={v => setF({ bengkel_id: v })}
                    options={bengkels.map(b => ({ value: b.id, label: `${b.code} - ${b.name}` }))} placeholder="Pilih bengkel…" />
                </div>
                <label className="block sm:col-span-2">
                  <span className="text-[11px] text-slate-400">Remarks</span>
                  <textarea value={form.remarks} onChange={e => setF({ remarks: e.target.value })} rows={2}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setEditMode(false)} disabled={saving}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 transition disabled:opacity-60">Batal</button>
                <button onClick={saveEdit} disabled={saving || !form.visit_date || !form.bengkel_id}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition disabled:opacity-60 flex items-center gap-1.5">
                  {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menyimpan…</> : <><Check className="w-3.5 h-3.5" />Simpan Perubahan</>}
                </button>
              </div>
            </div>
          )}

          {!editMode && (<>
          {/* Quick info grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <InfoCell icon={Calendar} label="Tanggal Visit" value={`${visit.visit_date}${visit.created_at ? ` · ${fmtAbsenTime(visit.created_at)}` : ''}`} />
            <InfoCell icon={User} label="MD Petugas" value={md?.full_name || visit.md_name || '—'} />
            <InfoCell icon={MapPin} label="Kota" value={kota?.name || visit.kota_name || '—'} />
          </div>

          {bengkel?.address && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Alamat Bengkel</div>
                <p className="text-sm text-slate-300 leading-snug break-words">{bengkel.address}</p>
              </div>
            </div>
          )}

          </>)}

          {/* Map */}
          {(hasBengkelCoord || hasVisitCoord) && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-2">
                <Navigation className="w-3 h-3" />Lokasi
              </div>
              <div className="rounded-xl overflow-hidden border border-slate-800">
                <MapContainer
                  center={hasBengkelCoord ? [bengkel.lat, bengkel.lng] : [visit.visit_lat, visit.visit_lng]}
                  zoom={16}
                  scrollWheelZoom={false}
                  style={{ height: '240px', width: '100%' }}
                >
                  <TileLayer
                    attribution={TILE_ATTR}
                    url={TILE_URL}
                    subdomains="abcd"
                    maxZoom={19}
                  />
                  {hasBengkelCoord && (
                    <Marker position={[bengkel.lat, bengkel.lng]} icon={RED_PIN_ICON}>
                      <Popup><div className="text-xs"><div className="font-semibold">{bengkel.name}</div><div className="font-mono text-[10px] text-slate-500">{bengkel.lat.toFixed(5)}, {bengkel.lng.toFixed(5)}</div><a href={`https://www.google.com/maps?q=${bengkel.lat},${bengkel.lng}`} target="_blank" rel="noreferrer" className="text-sky-600 underline">Buka di Google Maps →</a></div></Popup>
                    </Marker>
                  )}
                  {hasVisitCoord && (
                    <Marker position={[visit.visit_lat, visit.visit_lng]} icon={BLUE_PIN_ICON}>
                      <Popup><div className="text-xs"><div className="font-semibold">Lokasi MD saat visit</div><div className="font-mono text-[10px] text-slate-500">{visit.visit_lat.toFixed(5)}, {visit.visit_lng.toFixed(5)}</div><a href={`https://www.google.com/maps?q=${visit.visit_lat},${visit.visit_lng}`} target="_blank" rel="noreferrer" className="text-sky-600 underline">Buka di Google Maps →</a></div></Popup>
                    </Marker>
                  )}
                  {hasBengkelCoord && hasVisitCoord && (
                    <Polyline positions={[[bengkel.lat, bengkel.lng], [visit.visit_lat, visit.visit_lng]]}
                              pathOptions={{ color: '#71717a', weight: 2, dashArray: '6 4' }} />
                  )}
                  <FitBounds points={[
                    hasBengkelCoord && [bengkel.lat, bengkel.lng],
                    hasVisitCoord && [visit.visit_lat, visit.visit_lng],
                  ].filter(Boolean)} />
                </MapContainer>
                <div className="bg-slate-950 border-t border-slate-800 divide-y divide-slate-800/60 text-xs">
                  {hasBengkelCoord && (
                    <div className="px-3 py-2 flex justify-between">
                      <span className="text-slate-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Bengkel</span>
                      <a href={`https://www.google.com/maps?q=${bengkel.lat},${bengkel.lng}`} target="_blank" rel="noreferrer" className="font-mono text-sky-400 hover:text-sky-300 inline-flex items-center gap-1" title="Buka di Google Maps">{bengkel.lat.toFixed(5)}, {bengkel.lng.toFixed(5)}<MapPin className="w-3 h-3" /></a>
                    </div>
                  )}
                  {hasVisitCoord && (
                    <div className="px-3 py-2 flex justify-between">
                      <span className="text-slate-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />MD saat visit</span>
                      <a href={`https://www.google.com/maps?q=${visit.visit_lat},${visit.visit_lng}`} target="_blank" rel="noreferrer" className="font-mono text-sky-400 hover:text-sky-300 inline-flex items-center gap-1" title="Buka di Google Maps">{visit.visit_lat.toFixed(5)}, {visit.visit_lng.toFixed(5)}<MapPin className="w-3 h-3" /></a>
                    </div>
                  )}
                  {distance != null && (
                    <div className={`px-3 py-2 flex justify-between font-medium ${distance < 100 ? 'bg-emerald-600/10 text-emerald-400' : distance < 500 ? 'bg-amber-600/10 text-amber-400' : 'bg-rose-600/10 text-rose-400'}`}>
                      <span className="flex items-center gap-1.5"><Navigation className="w-3 h-3" />Jarak MD ↔ Bengkel</span>
                      <span className="font-mono">{formatDistance(distance)} {distance < 100 ? '· On-site ✓' : distance < 500 ? '· Dekat' : '· Jauh'}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Photo gallery */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-2 flex-wrap">
              <Camera className="w-3 h-3" />Dokumentasi Foto ({availablePhotos.length}/{PHOTO_KEYS.length})
              {canEdit && <span className="normal-case tracking-normal font-normal text-slate-600">· tap "Ganti" untuk perbaiki foto</span>}
            </div>
            {canEdit && <input ref={replaceFileRef} type="file" accept="image/*" className="hidden" onChange={onReplaceFile} />}
            {availablePhotos.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-8 bg-slate-950 border border-slate-800 rounded-xl">Tidak ada foto</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {availablePhotos.map((p, i) => (
                  <div key={p.key}
                    className="relative rounded-xl overflow-hidden border border-slate-800 hover:border-blue-600/50 transition group bg-slate-950">
                    <button onClick={() => setLightboxIdx(i)} className="relative block w-full aspect-[4/3]">
                      {isMockPhoto(p.url) ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                          <Camera className="w-5 h-5 mb-1" />
                          <span className="text-[9px] uppercase tracking-wider">No Foto</span>
                        </div>
                      ) : (
                        <StoredImage src={p.url} alt={p.label} className="absolute inset-0 w-full h-full object-cover" />
                      )}
                    </button>
                    <div className="bg-slate-950 border-t border-slate-800 px-2.5 py-2">
                      <div className="text-[11px] font-medium text-slate-200 leading-snug">{p.label}</div>
                      {canCheck ? (
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                          <button onClick={() => setCheck(p.key, 'ok')}
                            className={`py-1.5 rounded-md text-[11px] font-semibold border transition flex items-center justify-center gap-1 ${
                              checks[p.key] === 'ok' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-emerald-400'
                            }`}><Check className="w-3 h-3" />Sesuai</button>
                          <button onClick={() => setCheck(p.key, 'bad')}
                            className={`py-1.5 rounded-md text-[11px] font-semibold border transition flex items-center justify-center gap-1 ${
                              checks[p.key] === 'bad' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-rose-400'
                            }`}><X className="w-3 h-3" />Tidak</button>
                        </div>
                      ) : visit.photo_checks?.[p.key] && (
                        <div className={`mt-1.5 text-[10px] font-semibold flex items-center gap-1 ${visit.photo_checks[p.key] === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {visit.photo_checks[p.key] === 'ok' ? <><Check className="w-3 h-3" />Sesuai</> : <><X className="w-3 h-3" />Tidak Sesuai</>}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <button onClick={() => pickReplace(p.key)} disabled={replacingCol === p.key}
                        className="absolute top-1 right-1 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 hover:bg-blue-600 text-white text-[9px] font-medium backdrop-blur-sm transition disabled:opacity-60"
                        title="Ganti foto ini">
                        {replacingCol === p.key ? 'Uploading…' : <><Camera className="w-3 h-3" />Ganti</>}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Panel pengecekan admin/AA */}
          {canCheck && availablePhotos.length > 0 && (() => {
            const vals = availablePhotos.map(p => checks[p.key]);
            const belum = vals.filter(v => !v).length;
            const adaTidak = vals.some(v => v === 'bad');
            const statusPreview = belum > 0 ? null : (adaTidak ? 'Tidak Sesuai' : 'Sesuai');
            const simpan = async () => {
              setSavingCheck(true);
              try {
                const clean = {};
                availablePhotos.forEach(p => { if (checks[p.key]) clean[p.key] = checks[p.key]; });
                await api.saveVisitCheck(visit.id, { photoChecks: clean, remarks: checkRemarks, checkedBy: checkerId });
                setCheckSaved(true);
                onUpdated?.();
              } catch (e) { alert('Gagal simpan pengecekan: ' + (e?.message || e)); }
              finally { setSavingCheck(false); }
            };
            return (
              <div className="bg-blue-950/20 border border-blue-700/40 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wider text-blue-400 font-semibold flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5" />Pengecekan Admin
                  </div>
                  <button onClick={() => { const all = {}; availablePhotos.forEach(p => { all[p.key] = 'ok'; }); setChecks(all); setCheckSaved(false); }}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600/15 border border-emerald-600/30 text-emerald-300 hover:bg-emerald-600/25 transition flex items-center gap-1">
                    <Check className="w-3 h-3" />Tandai semua Sesuai
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Status:</span>
                  {statusPreview
                    ? <span className={`px-2 py-0.5 rounded-full font-semibold ${statusPreview === 'Sesuai' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'}`}>{statusPreview}</span>
                    : <span className="text-amber-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{belum} foto belum dinilai</span>}
                </div>

                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Remarks pengecekan (1 catatan untuk bengkel ini)</div>
                  <Textarea rows={3} placeholder="Mis. foto spanduk terlalu jauh, minta MD ambil ulang dari ±3 meter…"
                    value={checkRemarks} onChange={e => { setCheckRemarks(e.target.value); setCheckSaved(false); }} />
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-[11px] text-slate-500">
                    {visit.checked_at ? `Terakhir dicek: ${new Date(visit.checked_at).toLocaleString('id-ID')}` : 'Belum pernah dicek'}
                  </div>
                  <div className="flex items-center gap-2">
                    {checkSaved && <span className="text-[11px] text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Tersimpan</span>}
                    <button onClick={simpan} disabled={savingCheck || belum > 0}
                      className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition disabled:opacity-50 flex items-center gap-1.5">
                      {savingCheck ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menyimpan…</> : <><Check className="w-3.5 h-3.5" />Simpan Pengecekan</>}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Hasil pengecekan (tampilan read-only — MD & admin lain) */}
          {!canCheck && visit.check_status && (
            <div className={`rounded-xl p-4 border ${visit.check_status === 'Sesuai' ? 'bg-emerald-950/20 border-emerald-700/40' : 'bg-rose-950/20 border-rose-700/40'}`}>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                <Shield className="w-3 h-3" />Hasil Pengecekan Admin
              </div>
              <div className={`text-sm font-semibold ${visit.check_status === 'Sesuai' ? 'text-emerald-400' : 'text-rose-400'}`}>{visit.check_status}</div>
              {visit.check_remarks && <p className="text-sm text-slate-300 whitespace-pre-wrap mt-1.5">{visit.check_remarks}</p>}
              {visit.checked_at && <div className="text-[11px] text-slate-500 mt-2">Dicek {new Date(visit.checked_at).toLocaleString('id-ID')}</div>}
            </div>
          )}

          {/* Remarks */}
          {!editMode && visit.remarks && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1.5">
                <FileText className="w-3 h-3" />Notes dari MD
              </div>
              <p className="text-sm text-slate-300 whitespace-pre-wrap">{visit.remarks}</p>
            </div>
          )}

          {/* Meta footer */}
          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Visit ID: <span className="font-mono text-slate-400">{visit.id?.slice(0, 8)}…</span></span>
            {visit.created_at && <span>Dibuat: {new Date(visit.created_at).toLocaleString('id-ID')}</span>}
          </div>

          {/* Danger zone: hapus visit */}
          {onDeleted && (
            <div className="pt-3 mt-1 border-t border-slate-800/50">
              {!confirmDelete ? (
                <button onClick={() => setConfirmDelete(true)}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 transition">
                  <Trash2 className="w-3.5 h-3.5" />Hapus Visit ini
                </button>
              ) : (
                <div className="flex items-center gap-2 p-2.5 bg-rose-600/10 border border-rose-600/30 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-xs text-rose-300 flex-1">Hapus visit + semua fotonya? Tidak bisa dibatalkan.</span>
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>Batal</Button>
                  <button onClick={handleDelete} disabled={deleting}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1.5 disabled:opacity-60">
                    {deleting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menghapus…</> : <><Trash2 className="w-3.5 h-3.5" />Ya, Hapus</>}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox — via portal ke body: ancestor modal punya backdrop-blur yang
          membuat position:fixed menempel ke modal (ikut scroll), bukan ke layar. */}
      {lightboxIdx != null && availablePhotos[lightboxIdx] && createPortal(
        <div className="fixed inset-0 z-[2000] bg-black flex items-center justify-center"
             onClick={() => setLightboxIdx(null)}>
          <button onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx - 1 + availablePhotos.length) % availablePhotos.length); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-100 flex items-center justify-center">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setLightboxIdx((lightboxIdx + 1) % availablePhotos.length); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-100 flex items-center justify-center">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute right-4 top-4 w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-100 flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
          <div className="w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {isMockPhoto(availablePhotos[lightboxIdx].url) ? (
              <div className="w-96 h-96 bg-slate-950 border border-slate-800 rounded-xl flex flex-col items-center justify-center text-slate-500">
                <Camera className="w-16 h-16 mb-2" />
                <span className="text-xs uppercase tracking-wider">Tidak ada foto</span>
              </div>
            ) : (
              <StoredImage src={availablePhotos[lightboxIdx].url} alt={availablePhotos[lightboxIdx].label}
                   className="max-w-full max-h-full w-auto h-auto object-contain" />
            )}
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-950/90 backdrop-blur px-4 py-2 rounded-full text-sm text-slate-200 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <span className="font-semibold">{availablePhotos[lightboxIdx].label}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400 font-mono">{lightboxIdx + 1} / {availablePhotos.length}</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

const InfoCell = ({ icon: Icon, label, value }) => (
  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1.5">
      <Icon className="w-3 h-3" />{label}
    </div>
    <div className="text-sm text-slate-100 font-medium truncate">{value}</div>
  </div>
);

// ============================================================
// UI PRIMITIVES
// ============================================================

// Hierarki wilayah: REGION (7 grup besar) -> Provinsi (tabel regions) -> Kota -> Bengkel.
// Mapping statis dari master db 2 W.xlsx (kolom Region per provinsi).
const REGION_GROUP_OF = {
  'Aceh': 'Sumbagut', 'Bali': 'Bali-Nusra', 'Banten': 'Jabodetabek-Banten',
  'Bengkulu': 'Sumbagsel', 'Di Yogyakarta': 'Jateng-DIY', 'Dki Jakarta': 'Jabodetabek-Banten',
  'Jambi': 'Sumbagsel', 'Jawa Barat': 'Jabodetabek-Banten', 'Jawa Tengah': 'Jateng-DIY',
  'Jawa Timur': 'Jawa Timur', 'Kalimantan Barat': 'Kalimantan', 'Kalimantan Selatan': 'Kalimantan',
  'Kalimantan Tengah': 'Kalimantan', 'Kalimantan Timur': 'Kalimantan',
  'Kepulauan Bangka Belitung': 'Sumbagsel', 'Kepulauan Riau': 'Sumbagut', 'Lampung': 'Sumbagsel',
  'Nusa Tenggara Barat': 'Bali-Nusra', 'Riau': 'Sumbagut', 'Sulawesi Selatan': 'Bali-Nusra',
  'Sulawesi Tengah': 'Bali-Nusra', 'Sulawesi Tenggara': 'Bali-Nusra',
  'Sumatera Selatan': 'Sumbagsel', 'Sumatera Utara': 'Sumbagut',
};
const groupOfRegion = (r) => REGION_GROUP_OF[r?.name] || 'Lainnya';

// Hasil visit 2W Federal — 1 tingkat. "Spanduk Terpasang" membuka foto lanjutan (after/spanduk/poster).
const HASIL_TERPASANG = 'Spanduk Terpasang';
const STATUS_OPTIONS = [
  HASIL_TERPASANG,
  'Alamat bengkel tidak ditemukan',
  'Ditolak',
  'Bukan bengkel',
  'Owner/PIC tidak di tempat',
  'Tidak jual oli Federal',
];
const STATUS_STYLES = {
  [HASIL_TERPASANG]:                { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  'Alamat bengkel tidak ditemukan': { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30',   dot: 'bg-amber-400' },
  'Ditolak':                        { bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30',    dot: 'bg-rose-400' },
  'Bukan bengkel':                  { bg: 'bg-slate-500/10',    text: 'text-slate-400',    border: 'border-slate-500/30',    dot: 'bg-slate-400' },
  'Owner/PIC tidak di tempat':      { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/30',     dot: 'bg-sky-400' },
  'Tidak jual oli Federal':         { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/30',  dot: 'bg-orange-400' },
};

const StatusBadge = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES[HASIL_TERPASANG];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
};

const Section = ({ title, subtitle, children, icon: Icon }) => (
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

const Field = ({ label, children, required }) => (
  <div className="mb-3">
    <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
      {label} {required && <span className="text-blue-500">*</span>}
    </label>
    {children}
  </div>
);

const Input = (props) => (
  <input
    {...props}
    className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition ${props.className || ''}`}
  />
);

const Select = ({ children, ...props }) => (
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

const Textarea = (props) => (
  <textarea
    {...props}
    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition resize-none"
  />
);

// Dropdown dengan search box. options = [{ value, label }]
const SearchableSelect = ({ value, onChange, options, placeholder = 'Pilih…', disabled = false, emptyText = 'Tidak ada hasil' }) => {
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

const Button = ({ children, variant = 'primary', size = 'md', ...props }) => {
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

const formatSize = (bytes) => {
  if (!bytes) return '0KB';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
};

// ============================================================
// PHOTO TILE
// ============================================================

const PhotoTile = ({ label, photo, onChange, required, example, hint }) => {
  const inputRef = useRef(null);
  const [showExample, setShowExample] = useState(false);

  const handleSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // JANGAN decode foto original untuk preview — di HP RAM kecil, decode foto
    // kamera 12-48MP bisa makan ratusan MB -> app force close. Cukup tampilkan
    // overlay "Compressing", preview diisi versi kompres (kecil) setelah selesai.
    onChange({ status: 'compressing', preview: null, file: null, originalSize: file.size, compressedSize: 0 });

    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.2, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg',
      });
      const compressedPreview = URL.createObjectURL(compressed);
      onChange({ status: 'ready', preview: compressedPreview, file: compressed, originalSize: file.size, compressedSize: compressed.size });
    } catch (err) {
      console.error('Compression failed:', err);
      onChange({ status: 'error', preview: null, error: err.message });
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (photo?.preview) URL.revokeObjectURL(photo.preview);
    onChange(null);
  };

  const hasPhoto = !!photo;

  return (
    <div className="relative group">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 font-medium">
        {label}{required && <span className="text-blue-500 ml-0.5">*</span>}
      </div>
      <button
        type="button"
        onClick={() => { if (!hasPhoto) setShowExample(true); else inputRef.current?.click(); }}
        className={`relative w-full aspect-square rounded-xl border-2 overflow-hidden transition ${
          hasPhoto ? 'border-emerald-600/40 border-solid' : 'border-slate-800 border-dashed bg-slate-950 hover:border-blue-600/40 hover:bg-blue-600/5'
        }`}
      >
        {hasPhoto ? (
          <>
            {photo.preview && <img src={photo.preview} alt={label} className="absolute inset-0 w-full h-full object-cover" />}
            {photo.status === 'compressing' && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
                <span className="text-[9px] text-white mt-1.5 font-medium uppercase tracking-wider">Compressing…</span>
              </div>
            )}
            {photo.status === 'uploading' && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center shadow-lg" title="Mengupload…">
                <Loader2 className="w-3 h-3 text-slate-900 animate-spin" />
              </div>
            )}
            {(photo.status === 'ready' || photo.status === 'uploaded') && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                <Check className="w-3 h-3 text-slate-900" strokeWidth={3} />
              </div>
            )}
            {photo.status === 'error' && (
              <div className="absolute inset-0 bg-rose-600/10 flex flex-col items-center justify-center gap-1">
                <AlertCircle className="w-5 h-5 text-rose-400" />
                <span className="text-[9px] text-rose-300 font-medium">Failed</span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-600 group-hover:text-blue-500 transition">
            <Camera className="w-6 h-6" />
            <span className="text-[10px] font-medium">Upload</span>
          </div>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleSelect} className="hidden" />
      {!hasPhoto && (
        <p className="text-[9px] text-slate-600 mt-1 text-center">{example ? 'Ketuk untuk lihat contoh' : 'Ketuk untuk mulai'}</p>
      )}
      {showExample && (
        <div className="fixed inset-0 z-[2000] bg-black/90 flex flex-col items-center justify-center p-4" onClick={() => setShowExample(false)}>
          <div className="text-white text-sm font-semibold mb-1">{example ? 'Contoh Foto' : 'Panduan Foto'}: {label}</div>
          <p className="text-amber-300 text-xs mb-3 text-center px-4 max-w-md">{hint || 'Pastikan foto terlihat jelas, POSM terpasang di mana'}</p>
          {example && (
            <img src={example} alt={`Contoh ${label}`} className="max-w-full max-h-[62vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          )}
          <div className="flex gap-2.5 mt-5" onClick={e => e.stopPropagation()}>
            <button type="button" onClick={() => setShowExample(false)}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium border border-slate-700 transition">Tutup</button>
            <button type="button" onClick={() => { setShowExample(false); inputRef.current?.click(); }}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold flex items-center gap-2 transition"><Camera className="w-4 h-4" />Ambil Foto</button>
          </div>
        </div>
      )}
      {hasPhoto && photo.status !== 'compressing' && (
        <button type="button" onClick={handleClear} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800/50 hover:bg-rose-600 border border-slate-700 flex items-center justify-center opacity-0 group-hover:opacity-100 transition z-10">
          <X className="w-3 h-3 text-slate-100" />
        </button>
      )}
    </div>
  );
};

// ============================================================
// LOGIN SCREEN
// ============================================================

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.isPasskeySupported().then(ok => { if (!cancelled) setBioSupported(ok); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    setError(''); setLoading(true);
    try {
      const profile = await api.signIn(email, password);
      onLogin(profile);
    } catch (err) {
      setError(err.message || 'Login gagal');
      setLoading(false);
    }
  };

  // Login pakai passkey (biometrik) — discoverable, tidak perlu ketik email
  const handlePasskeyLogin = async () => {
    setError(''); setBioBusy(true);
    try {
      const profile = await api.loginWithPasskey();
      onLogin(profile);
    } catch (err) {
      setError(err.message || 'Login passkey gagal');
      setBioBusy(false);
    }
  };

  if (forgotOpen) return <ForgotPasswordScreen onBack={() => setForgotOpen(false)} />;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-slate-950" />
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(37,99,235,0.25), transparent 40%), radial-gradient(circle at 80% 80%, rgba(37,99,235,0.15), transparent 50%)' }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
      </div>

      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="absolute inset-0 bg-blue-600 rounded-2xl blur-2xl opacity-30" />
            <img src="/aa-logo.png" alt="AA" className="relative h-24 w-auto drop-shadow-2xl" />
          </div>
          <div className="flex items-center gap-2">
            <img src="/federal-logo.png" alt="2W Federal" className="h-6 w-auto" />
            <h1 className="font-display font-bold text-2xl text-slate-100 tracking-tight">2W Federal POSM</h1>
          </div>
          <p className="text-xs text-slate-500 uppercase tracking-[0.2em] mt-1">MD Field Operations</p>
        </div>

        <div className="bg-slate-950 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="mb-5">
            <h2 className="font-display font-bold text-lg text-slate-100">Selamat datang kembali</h2>
            <p className="text-sm text-slate-500 mt-1">Sign in untuk lanjut tracking visit</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-400">{error}</p>
            </div>
          )}

          <Field label="Email" required>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input type="email" placeholder="nama@federal.id" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoComplete="email"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition" />
            </div>
          </Field>

          <Field label="Password" required>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input type={showPw ? 'text' : 'password'} placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoComplete="current-password"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between mb-5 mt-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div onClick={() => setRemember(!remember)} className={`w-4 h-4 rounded border flex items-center justify-center transition ${remember ? 'bg-blue-600 border-blue-600' : 'bg-slate-950 border-slate-700 group-hover:border-slate-700'}`}>
                {remember && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
              <span className="text-xs text-slate-400">Ingat saya</span>
            </label>
            <button onClick={() => setForgotOpen(true)} className="text-xs text-blue-500 hover:text-blue-400 transition">Lupa password?</button>
          </div>

          <Button variant="primary" size="lg" className="w-full" onClick={handleSubmit} disabled={loading || !email || !password}>
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Memverifikasi…</> : <>Sign In<ChevronRight className="w-4 h-4" /></>}
          </Button>

          {PASSKEY_ENABLED && bioSupported && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={bioBusy || loading}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-400 hover:text-slate-200 transition disabled:opacity-50 disabled:cursor-not-allowed">
                {bioBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                Masuk dengan biometrik / passkey
              </button>
              <p className="text-center text-[10px] text-slate-600 mt-1.5">
                Aktifkan dulu dari dalam app setelah login pertama.
              </p>
            </div>
          )}
        </div>

        {MOCK_MODE && (
          <div className="mt-5 p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="flex items-start gap-2 text-[11px] text-slate-500">
              <Shield className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
              <div>
                <div className="text-amber-400 font-medium mb-0.5">🟡 Mode Demo (Mock Data)</div>
                <span className="text-slate-400 font-medium">MD:</span> <span className="font-mono text-slate-400">budi@federal.id</span> / <span className="font-mono text-slate-400">federal</span><br/>
                <span className="text-slate-400 font-medium">Admin:</span> <span className="font-mono text-slate-400">admin@federal.id</span> / <span className="font-mono text-slate-400">federal</span>
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-slate-600 mt-6">© 2026 Federal Oil Indonesia · Powered by ExxonMobil</p>
      </div>
    </div>
  );
}

// ============================================================
// FORGOT PASSWORD
// ============================================================

function ForgotPasswordScreen({ onBack }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError(''); setLoading(true);
    try {
      await api.sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-slate-950">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="mb-4 text-sm text-slate-400 hover:text-slate-100 transition flex items-center gap-1.5">
          <ChevronRight className="w-4 h-4 rotate-180" /> Kembali ke login
        </button>

        <div className="bg-slate-950 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-2xl">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-600/100/10 border border-emerald-500/30 mx-auto flex items-center justify-center mb-4">
                <Mail className="w-6 h-6 text-emerald-500" />
              </div>
              <h2 className="font-display font-bold text-lg text-slate-100 mb-2">Email terkirim</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Cek inbox <span className="text-slate-100 font-medium">{email}</span> untuk link reset password. Link berlaku 1 jam.
              </p>
              <Button variant="secondary" className="w-full mt-5" onClick={onBack}>Kembali ke Login</Button>
            </div>
          ) : (
            <>
              <h2 className="font-display font-bold text-lg text-slate-100 mb-2">Lupa Password?</h2>
              <p className="text-sm text-slate-500 mb-5">Masukkan email terdaftar — kami akan kirim link untuk reset password.</p>

              {error && (
                <div className="mb-4 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-400">{error}</p>
                </div>
              )}

              <Field label="Email" required>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@federal.id"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-10 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50 focus:ring-1 focus:ring-blue-600/30 transition" />
                </div>
              </Field>

              <Button variant="primary" size="lg" className="w-full mt-2" onClick={handleSubmit} disabled={loading || !email}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Mengirim…</> : <>Kirim Link Reset<ChevronRight className="w-4 h-4" /></>}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MD VIEW — Form & History
// ============================================================

// Kelola passkey: lihat perangkat terdaftar, tambah passkey di HP ini, hapus perangkat
function PasskeyManagerModal({ onClose }) {
  useBackDismiss(true, onClose);
  const [items, setItems] = useState(null); // null = loading
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  const reload = async () => {
    try {
      const list = await api.listPasskeys();
      setItems(list);
    } catch (err) {
      setError(err.message || 'Gagal memuat passkey');
      setItems([]);
    }
  };

  useEffect(() => {
    api.isPasskeySupported().then(setSupported);
    reload();
    __lockBodyScroll();
    return __unlockBodyScroll;
  }, []);

  const fmt = (s) => s ? new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const shortLabel = (lbl) => {
    if (!lbl) return 'Perangkat';
    if (/iphone|ipad/i.test(lbl)) return 'iPhone / iPad';
    if (/android/i.test(lbl)) return 'Android';
    if (/macintosh|mac os/i.test(lbl)) return 'Mac';
    if (/windows/i.test(lbl)) return 'Windows';
    return lbl.slice(0, 40);
  };

  const handleAdd = async () => {
    setBusy(true); setError(''); setOkMsg('');
    try {
      await api.enablePasskey();
      setOkMsg('Passkey baru ditambahkan.');
      localStorage.setItem(PK_DISMISS_KEY, '1');
      await reload();
    } catch (err) {
      setError(err.message || 'Gagal menambah passkey');
    }
    setBusy(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('Hapus passkey perangkat ini? Login biometrik di perangkat tsb tidak akan berfungsi lagi.')) return;
    setBusy(true); setError(''); setOkMsg('');
    try {
      await api.deletePasskey(id);
      await reload();
    } catch (err) {
      setError(err.message || 'Gagal menghapus passkey');
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Fingerprint className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-slate-100 font-display">Kelola Passkey</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500">
            Passkey = login biometrik tanpa password. Tiap perangkat punya passkey sendiri; password tidak pernah disimpan.
          </p>

          {error && (
            <div className="p-2.5 bg-rose-600/10 border border-rose-600/30 rounded-lg text-xs text-rose-400 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}
            </div>
          )}
          {okMsg && (
            <div className="p-2.5 bg-emerald-600/10 border border-emerald-600/30 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 shrink-0" />{okMsg}
            </div>
          )}

          {/* Daftar perangkat */}
          {items === null ? (
            <div className="flex items-center justify-center py-8 text-slate-500 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />Memuat…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-500">Belum ada passkey terdaftar.</div>
          ) : (
            <div className="space-y-2">
              {items.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <Fingerprint className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">{shortLabel(p.device_label)}</div>
                    <div className="text-[10px] text-slate-500">Dibuat {fmt(p.created_at)} · Dipakai {fmt(p.last_used_at)}</div>
                  </div>
                  <button onClick={() => handleDelete(p.id)} disabled={busy}
                    className="w-8 h-8 rounded-md hover:bg-rose-600/10 hover:text-rose-400 text-slate-500 flex items-center justify-center transition disabled:opacity-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Tambah passkey di perangkat ini */}
          {supported ? (
            <Button variant="primary" onClick={handleAdd} disabled={busy} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Tambah passkey di perangkat ini
            </Button>
          ) : (
            <p className="text-[11px] text-slate-600 text-center">
              Perangkat ini tidak mendukung biometrik / passkey (atau bukan HTTPS).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Popup ringkasan target — muncul sekali tiap MD login
function MDWelcomeModal({ currentMD, visits, onClose, onGoProgress }) {
  useBackDismiss(true, onClose);
  const todayStr = localDateStr();
  const month = todayStr.slice(0, 7);
  const [yy, mm] = month.split('-').map(Number);
  const lastDay = new Date(yy, mm, 0).getDate();
  const todayDay = Number(todayStr.slice(8, 10));
  const daysLeft = Math.max(lastDay - todayDay + 1, 0); // termasuk hari ini

  const monthVisits = visits.filter(v => v.visit_date.startsWith(month));
  const monthlyTarget = currentMD.monthly_target || 30;
  const done = monthVisits.length;
  const achievement = monthlyTarget > 0 ? Math.round((done / monthlyTarget) * 100) : 0;
  const sisaTarget = Math.max(monthlyTarget - done, 0);
  const todayCount = visits.filter(v => v.visit_date === todayStr).length;
  const perDayNeeded = daysLeft > 0 ? Math.ceil(sisaTarget / daysLeft) : sisaTarget;
  const tercapai = sisaTarget === 0;

  const tglLabel = new Date(todayStr).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  useEffect(() => {
    __lockBodyScroll();
    return __unlockBodyScroll;
  }, []);

  return (
    <div className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_0.2s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-blue-600/20 to-slate-900 border-b border-slate-800">
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-full hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
          <div className="text-xs text-slate-400 uppercase tracking-wider">{tglLabel}</div>
          <h2 className="text-xl font-bold text-slate-100 font-display mt-1">Halo, {currentMD.full_name.split(' ')[0]} 👋</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {tercapai
              ? 'Target bulan ini sudah tercapai. Mantap! 🎉'
              : `Sisa ${daysLeft} hari untuk kejar target bulan ini.`}
          </p>
        </div>

        {/* Stat grid */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-slate-100">{daysLeft}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Sisa Hari</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-slate-100">{done}<span className="text-sm text-slate-500">/{monthlyTarget}</span></div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Visit</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
              <div className={`text-2xl font-bold ${achievement >= 80 ? 'text-emerald-400' : achievement >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{achievement}%</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">Achievement</div>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="h-2.5 bg-slate-800/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${achievement >= 80 ? 'bg-emerald-500' : achievement >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${Math.min(achievement, 100)}%` }}
              />
            </div>
          </div>

          {/* Yang belum terlaksana */}
          {tercapai ? (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-600/10 border border-emerald-600/20">
              <Check className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="text-sm text-emerald-300">Semua target sudah terpenuhi. Visit tambahan dihitung sebagai bonus.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-sm text-slate-400 flex items-center gap-2"><Target className="w-4 h-4 text-amber-400" />Belum terlaksana</span>
                <span className="text-sm font-semibold text-slate-100">{sisaTarget} visit</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-sm text-slate-400 flex items-center gap-2"><Activity className="w-4 h-4 text-blue-400" />Perlu per hari</span>
                <span className="text-sm font-semibold text-slate-100">±{perDayNeeded} visit/hari</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-sm text-slate-400 flex items-center gap-2"><Check className="w-4 h-4 text-sky-400" />Visit hari ini</span>
                <span className="text-sm font-semibold text-slate-100">{todayCount}</span>
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={onGoProgress} className="flex-1">
              <LayoutDashboard className="w-4 h-4" />Lihat Progres
            </Button>
            <Button variant="primary" onClick={onClose} className="flex-1">
              <ClipboardList className="w-4 h-4" />Mulai Visit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Banner ajakan aktifkan passkey (muncul setelah login, hilang setelah enroll/ditutup)
const PK_DISMISS_KEY = 'federal2w_pk_dismissed';
function PasskeyEnrollBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!PASSKEY_ENABLED) return;
    if (localStorage.getItem(PK_DISMISS_KEY) === '1') return;
    api.isPasskeySupported().then(ok => { if (!cancelled && ok) setShow(true); });
    return () => { cancelled = true; };
  }, []);

  if (!show) return null;

  const dismiss = () => { localStorage.setItem(PK_DISMISS_KEY, '1'); setShow(false); };

  const enroll = async () => {
    setBusy(true); setMsg('');
    try {
      await api.enablePasskey();
      localStorage.setItem(PK_DISMISS_KEY, '1');
      setMsg('ok');
      setTimeout(() => setShow(false), 1500);
    } catch (err) {
      setMsg(err.message || 'Gagal mengaktifkan passkey');
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-blue-600/30 bg-blue-600/10 p-3.5">
      <div className="flex items-start gap-3">
        <Fingerprint className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-100">Login lebih cepat dengan biometrik</div>
          <div className="text-xs text-slate-400 mt-0.5">
            Aktifkan passkey di HP ini supaya lain kali cukup sidik jari / Face ID — tanpa ketik password.
          </div>
          {msg === 'ok'
            ? <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Passkey aktif! Lain kali tinggal pakai biometrik.</div>
            : msg
              ? <div className="text-xs text-rose-400 mt-2">{msg}</div>
              : null}
          <div className="flex gap-2 mt-2.5">
            <Button variant="primary" size="sm" onClick={enroll} disabled={busy}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fingerprint className="w-3.5 h-3.5" />}
              Aktifkan
            </Button>
            <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy}>Nanti saja</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ABSEN MD (Masuk & Pulang) — selfie + GPS + catatan. Tabel attendances.
// ============================================================
const fmtAbsenTime = (iso) => iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
// Durasi kerja "Xj Ym" dari timestamp masuk/pulang (null kalau belum lengkap).
const fmtWorkDuration = (a) => {
  if (!a?.check_in_at || !a?.check_out_at) return null;
  const mins = Math.round((new Date(a.check_out_at) - new Date(a.check_in_at)) / 60000);
  if (mins < 0) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}j ${m}m` : `${h}j`) : `${m}m`;
};
// Tanggal LOKAL (bukan UTC) agar absen tercatat di hari yang benar di Indonesia.
const localDateStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function AbsenTab({ currentMD }) {
  const todayStr = localDateStr();
  const [att, setAtt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null); // null | 'in' | 'out'
  const [view, setView] = useState('today'); // today | history

  const load = async () => {
    setLoading(true);
    try { setAtt(await api.fetchTodayAttendance(currentMD.id, todayStr)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) return <Loading />;
  const checkedIn = !!att?.check_in_at;
  const checkedOut = !!att?.check_out_at;
  const dateLabel = new Date(todayStr).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const StatusRow = ({ icon: Icon, label, time, photo, done }) => (
    <div className="flex items-center gap-3">
      {photo ? <StoredImage src={photo} alt={label} className="w-11 h-11 rounded-lg object-cover" />
        : <div className="w-11 h-11 rounded-lg bg-slate-800 flex items-center justify-center"><Icon className="w-4 h-4 text-slate-500" /></div>}
      <div className="flex-1">
        <div className="text-sm font-semibold text-slate-100">{label}</div>
        <div className="flex items-center gap-1 text-xs mt-0.5"><Clock className={`w-3 h-3 ${done ? 'text-emerald-400' : 'text-slate-600'}`} />
          <span className={done ? 'text-emerald-400' : 'text-slate-500'}>{done ? `Pukul ${fmtAbsenTime(time)}` : 'Belum'}</span></div>
      </div>
      {done && <Check className="w-5 h-5 text-emerald-400" />}
    </div>
  );

  return (
    <div>
      <div className="flex gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-4">
        <button onClick={() => setView('today')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${view === 'today' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>Hari Ini</button>
        <button onClick={() => setView('history')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${view === 'history' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>Riwayat</button>
      </div>

      {view === 'history' ? <AbsenHistory currentMD={currentMD} /> : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="w-4 h-4 text-blue-400" /><span className="text-sm font-medium text-slate-200">{dateLabel}</span>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-4 space-y-3">
            <StatusRow icon={LogIn} label="Absen Masuk" time={att?.check_in_at} photo={att?.check_in_photo} done={checkedIn} />
            {checkedIn && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-800 text-emerald-400 text-xs font-medium">
                <Check className="w-4 h-4" /> Absen hari ini selesai. Terima kasih! 🎉
              </div>
            )}
          </div>

          {!checkedIn && (
            mode === 'in'
              ? <AbsenForm kind="in" currentMD={currentMD} todayStr={todayStr} onCancel={() => setMode(null)} onDone={() => { setMode(null); load(); }} />
              : <Button variant="primary" size="lg" className="w-full" onClick={() => setMode('in')}><LogIn className="w-4 h-4" />Absen Masuk</Button>
          )}
        </>
      )}
    </div>
  );
}

// Riwayat absen milik MD sendiri (tanggal, jam masuk/pulang, jam kerja, foto).
function AbsenHistory({ currentMD }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  useBackDismiss(!!lightbox, () => setLightbox(null)); // back -> tutup foto absen
  const [month, setMonth] = useState('all');
  const [search, setSearch] = useState('');
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');

  useEffect(() => {
    let on = true;
    api.fetchAttendances(currentMD.id).then(d => { if (on) { setRows(d); setLoading(false); } }).catch(e => { console.error(e); setLoading(false); });
    return () => { on = false; };
  }, [currentMD.id]);

  const availableMonths = useMemo(() => [...new Set(rows.map(a => a.date.slice(0, 7)))].sort().reverse(), [rows]);

  if (loading) return <Loading />;
  if (rows.length === 0) return <div className="text-center py-12 text-slate-500 text-sm">Belum ada riwayat absen.</div>;

  const dLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const filtered = rows.filter(a => {
    if (dari || sampai) {
      if (dari && a.date < dari) return false;
      if (sampai && a.date > sampai) return false;
    } else if (month !== 'all' && !a.date.startsWith(month)) return false;
    if (search.trim() && !`${a.date} ${a.check_in_note || ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="relative col-span-2 sm:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari catatan / tanggal…"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
          </div>
          <Select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="all">Semua Bulan</option>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </div>
        <DateRangeRow dari={dari} sampai={sampai} onDari={setDari} onSampai={setSampai} onReset={() => { setDari(''); setSampai(''); }} />
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">Tidak ada absen di bulan ini.</div>
      ) : filtered.map(a => {
        return (
          <div key={a.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-100">{dLabel(a.date)}</span>
            </div>
            <div className="flex items-center gap-2.5">
              {a.check_in_photo ? <StoredImage src={a.check_in_photo} alt="Masuk" className="w-10 h-10 rounded-lg object-cover cursor-pointer" onClick={() => setLightbox(a.check_in_photo)} />
                : <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center"><LogIn className="w-4 h-4 text-slate-500" /></div>}
              <div><div className="text-[11px] text-slate-500">Masuk</div><div className={`text-sm font-semibold ${a.check_in_at ? 'text-emerald-400' : 'text-slate-500'}`}>{a.check_in_at ? fmtAbsenTime(a.check_in_at) : 'Belum'}</div></div>
            </div>
            {a.check_in_note && <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-800">{a.check_in_note}</p>}
          </div>
        );
      })}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <StoredImage src={lightbox} alt="selfie" className="max-w-full max-h-full object-contain" />
          <button className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
}

function AbsenForm({ kind, currentMD, todayStr, onCancel, onDone }) {
  const [selfie, setSelfie] = useState(null); // {status, preview, file}
  const [gps, setGps] = useState({ status: 'idle', lat: null, lng: null, accuracy: null, error: null });
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const fetchGPS = () => {
    if (!navigator.geolocation) { setGps({ status: 'error', error: 'GPS tidak didukung browser' }); return; }
    setGps(g => ({ ...g, status: 'loading', error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ status: 'ready', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, error: null }),
      (err) => setGps({ status: 'error', error: err.code === 1 ? 'Izin GPS ditolak' : 'GPS gagal' }),
      { timeout: 20000, enableHighAccuracy: true, maximumAge: 60000 }
    );
  };
  useEffect(() => { fetchGPS(); /* eslint-disable-next-line */ }, []);

  const handleSelfie = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    // Jangan decode foto original (boros RAM di HP lama) — overlay saja saat kompres.
    setSelfie({ status: 'compressing', preview: null, file: null });
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.2, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' });
      const cPreview = URL.createObjectURL(compressed);
      setSelfie({ status: 'uploading', preview: cPreview, file: compressed });
      // Upload-saat-diambil: selfie langsung naik ke storage (path attendance/{userId}/{date}/{kind})
      api.uploadAttendancePhoto(compressed, currentMD.id, todayStr, kind)
        .then(url => setSelfie(s => (s?.file === compressed ? { ...s, status: 'uploaded', url } : s)))
        .catch(err => setSelfie(s => (s?.file === compressed ? { ...s, status: 'error', error: err.message } : s)));
    } catch (err) { setSelfie({ status: 'error', preview: null, error: err.message }); }
  };

  const selfieReady = ['ready', 'uploading', 'uploaded'].includes(selfie?.status);
  const ready = selfieReady && gps.status === 'ready' && !submitting;
  const title = kind === 'in' ? 'Absen Masuk' : 'Absen Pulang';

  const submit = async () => {
    if (!ready) return;
    setSubmitting(true); setError('');
    try {
      const args = { mdId: currentMD.id, date: todayStr, lat: gps.lat, lng: gps.lng,
        photoUrl: selfie.url, photoFile: selfie.file, note: note.trim() };
      if (kind === 'in') await api.checkIn(args); else await api.checkOut(args);
      onDone();
    } catch (e) { setError(e.message || 'Gagal menyimpan absen'); setSubmitting(false); }
  };

  return (
    <Section title={title} subtitle="Selfie + lokasi wajib · catatan opsional" icon={kind === 'in' ? LogIn : LogOut}>
      {error && <div className="mb-3 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2"><AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" /><p className="text-xs text-rose-400">{error}</p></div>}

      <Field label="Selfie" required>
        <input ref={inputRef} type="file" accept="image/*" capture="user" onChange={handleSelfie} className="hidden" />
        <button type="button" onClick={() => inputRef.current?.click()}
          className={`relative w-40 h-40 rounded-xl border-2 overflow-hidden transition ${selfie ? 'border-emerald-600/40 border-solid' : 'border-slate-800 border-dashed bg-slate-950 hover:border-blue-600/40'}`}>
          {selfie ? <>
            {selfie.preview && <img src={selfie.preview} alt="selfie" className="absolute inset-0 w-full h-full object-cover" />}
            {selfie.status === 'compressing' && <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>}
            {selfie.status === 'uploading' && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center" title="Mengupload…"><Loader2 className="w-3 h-3 text-slate-900 animate-spin" /></div>}
            {(selfie.status === 'ready' || selfie.status === 'uploaded') && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><Check className="w-3 h-3 text-slate-900" strokeWidth={3} /></div>}
            {selfie.status === 'error' && <div className="absolute inset-0 bg-rose-600/30 flex items-center justify-center"><span className="text-[10px] text-rose-100 font-semibold">Gagal upload — ketuk ulangi</span></div>}
          </> : <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-600"><Camera className="w-6 h-6" /><span className="text-[10px] font-medium">Ambil Selfie</span></div>}
        </button>
      </Field>

      <Field label="Lokasi" required>
        <div className="flex items-center gap-2.5 bg-slate-950 border border-slate-800 rounded-lg p-3">
          <MapPin className={`w-4 h-4 shrink-0 ${gps.status === 'ready' ? 'text-emerald-400' : gps.status === 'error' ? 'text-rose-400' : 'text-slate-500'}`} />
          <div className="flex-1 text-xs">
            {gps.status === 'loading' ? <span className="text-slate-400">Mengambil lokasi…</span>
              : gps.status === 'ready' ? <span className="text-slate-300">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}{gps.accuracy ? `  ±${Math.round(gps.accuracy)}m` : ''}</span>
              : gps.status === 'error' ? <span className="text-rose-400">{gps.error}</span>
              : <span className="text-slate-500">GPS belum ditangkap</span>}
          </div>
          <button type="button" onClick={fetchGPS} className="text-slate-500 hover:text-slate-300"><Navigation className="w-4 h-4" /></button>
        </div>
        {gps.status === 'ready' && (
          <div className="mt-2 rounded-lg overflow-hidden border border-slate-800">
            <MapContainer center={[gps.lat, gps.lng]} zoom={16} scrollWheelZoom={false} style={{ height: '170px', width: '100%' }}>
              <TileLayer attribution={TILE_ATTR} url={TILE_URL} subdomains="abcd" maxZoom={19} />
              <Marker position={[gps.lat, gps.lng]} icon={BLUE_PIN_ICON} />
              <RecenterMap lat={gps.lat} lng={gps.lng} />
            </MapContainer>
            <a href={`https://www.google.com/maps?q=${gps.lat},${gps.lng}`} target="_blank" rel="noreferrer"
              className="block bg-slate-950 border-t border-slate-800 px-3 py-1.5 text-[11px] text-sky-400 hover:text-sky-300">Buka di Google Maps →</a>
          </div>
        )}
      </Field>

      <Field label="Catatan">
        <Textarea rows={2} placeholder="Opsional — mis. mulai dari kota X" value={note} onChange={e => setNote(e.target.value)} />
      </Field>

      <div className="flex gap-2 mt-2">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>Batal</Button>
        <Button variant="primary" className="flex-1" onClick={submit} disabled={!ready}>
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan…</> : <><Check className="w-4 h-4" />Konfirmasi {title}</>}
        </Button>
      </div>
    </Section>
  );
}

// Rekap absen semua MD untuk admin (per tanggal)
// Baris filter rentang tanggal (Dari–Sampai + Reset) — dipakai di beberapa tab admin
function DateRangeRow({ dari, sampai, onDari, onSampai, onReset, className = '' }) {
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

function AdminAbsenTab({ mds, allowedMdIds, isSuperAdmin, regions = [] }) {
  const monthsList = useMemo(() => {
    const arr = []; const now = new Date();
    for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    return arr;
  }, []);
  const [month, setMonth] = useState(monthsList[0]);
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');
  const [mdId, setMdId] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const [detail, setDetail] = useState(null);
  const [deleting, setDeleting] = useState(false);
  // Area/region MD (dari nama) untuk ditampilkan di samping nama
  const mdById = useMemo(() => new Map(mds.map(m => [m.id, m])), [mds]);
  const regionById = useMemo(() => new Map((regions || []).map(r => [r.id, r])), [regions]);
  const areaOf = (mdId) => { const m = mdById.get(mdId); return m?.region?.name || regionById.get(m?.region_id)?.name || ''; };
  useBackDismiss(!!detail, () => setDetail(null));    // back -> tutup detail absen
  useBackDismiss(!!lightbox, () => setLightbox(null)); // back -> tutup foto (di atas detail)

  const handleDeleteAbsen = async (id) => {
    if (!confirm('Hapus record absen ini (foto + GPS)? Tidak bisa dibatalkan.')) return;
    setDeleting(true);
    try {
      await api.deleteAttendance(id);
      setRows(prev => prev.filter(r => r.id !== id));
      setDetail(null);
    } catch (e) {
      alert('Gagal menghapus: ' + (e?.message || e));
    } finally {
      setDeleting(false);
    }
  };

  // Muat ulang data absen sesuai filter aktif (dipakai setelah edit)
  const reload = async () => {
    const d = (dari || sampai) ? await api.fetchAttendancesByRange(dari, sampai) : await api.fetchAttendancesByMonth(month);
    setRows(d);
    return d;
  };

  // Edit absen (super admin) — jam, catatan, foto, kosongkan sesi
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eform, setEform] = useState(null);
  const [replacingKind, setReplacingKind] = useState(null);
  const absenFileRef = useRef(null);
  const pendingKindRef = useRef(null);
  const setEF = (patch) => setEform(f => ({ ...f, ...patch }));
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  useEffect(() => { setEditMode(false); }, [detail?.id]); // reset saat ganti/tutup record
  const startEditAbsen = () => {
    setEform({
      check_in_at: toLocalInput(detail.check_in_at), check_in_note: detail.check_in_note || '', check_in_photo: detail.check_in_photo || null, check_in_lat: detail.check_in_lat, check_in_lng: detail.check_in_lng,
      check_out_at: toLocalInput(detail.check_out_at), check_out_note: detail.check_out_note || '', check_out_photo: detail.check_out_photo || null, check_out_lat: detail.check_out_lat, check_out_lng: detail.check_out_lng,
    });
    setEditMode(true);
  };
  const clearSession = (kind) => {
    if (!confirm(`Kosongkan sesi Absen ${kind === 'in' ? 'Masuk' : 'Pulang'}? (jam, foto, lokasi, catatan sesi ini dihapus saat disimpan)`)) return;
    if (kind === 'in') setEF({ check_in_at: '', check_in_note: '', check_in_photo: null, check_in_lat: null, check_in_lng: null });
    else setEF({ check_out_at: '', check_out_note: '', check_out_photo: null, check_out_lat: null, check_out_lng: null });
  };
  const pickReplaceAbsen = (kind) => { pendingKindRef.current = kind; absenFileRef.current?.click(); };
  const onReplaceAbsenFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    const kind = pendingKindRef.current;
    if (!file || !kind) return;
    setReplacingKind(kind);
    try {
      const compressed = await imageCompression(file, { maxSizeMB: 0.2, maxWidthOrHeight: 1024, useWebWorker: true, fileType: 'image/jpeg' });
      const url = await api.uploadAttendancePhoto(compressed, detail.md_id, detail.date, kind);
      setEF(kind === 'in' ? { check_in_photo: url } : { check_out_photo: url });
    } catch (err) { alert('Gagal ganti foto: ' + (err?.message || err)); }
    finally { setReplacingKind(null); }
  };
  const saveAbsen = async () => {
    setSaving(true);
    try {
      const iso = (v) => v ? new Date(v).toISOString() : null;
      await api.updateMaster('attendances', detail.id, {
        check_in_at: iso(eform.check_in_at), check_in_note: eform.check_in_note?.trim() || null, check_in_photo: eform.check_in_photo || null, check_in_lat: eform.check_in_lat, check_in_lng: eform.check_in_lng,
        check_out_at: iso(eform.check_out_at), check_out_note: eform.check_out_note?.trim() || null, check_out_photo: eform.check_out_photo || null, check_out_lat: eform.check_out_lat, check_out_lng: eform.check_out_lng,
      });
      const fresh = await reload();
      setDetail(fresh.find(r => r.id === detail.id) || null);
      setEditMode(false);
    } catch (err) { alert('Gagal simpan absen: ' + (err?.message || err)); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    let on = true; setLoading(true);
    // Rentang tanggal (kalau diisi) meng-override dropdown bulan
    const p = (dari || sampai) ? api.fetchAttendancesByRange(dari, sampai) : api.fetchAttendancesByMonth(month);
    p.then(d => { if (on) { setRows(d); setLoading(false); } })
      .catch(e => { console.error(e); if (on) { setRows([]); setLoading(false); } });
    return () => { on = false; };
  }, [month, dari, sampai]);

  const filteredRows = rows.filter(a => {
    if (allowedMdIds && !allowedMdIds.has(a.md_id)) return false;  // scope TL per region
    if (mdId !== 'all' && a.md_id !== mdId) return false;
    if (search.trim() && !`${a.md_name || ''} ${a.md_email || ''}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });
  // Batasi render (mis. saat pilih "Semua Bulan") biar HP tak freeze
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [month, dari, sampai, mdId, search]);

  const exportExcel = async () => {
    if (filteredRows.length === 0) return;
    const XLSX = await import('xlsx');
    const data = filteredRows.map(a => ({
      Tanggal: excelDateSerial(a.date),
      'Nama MD': a.md_name || '',
      Region: areaOf(a.md_id),
      Email: a.md_email || '',
      'Jam Masuk': a.check_in_at ? fmtAbsenTime(a.check_in_at) : '',
      'GPS Masuk': a.check_in_lat != null ? `${a.check_in_lat}, ${a.check_in_lng}` : '',
      'Foto Masuk': typeof a.check_in_photo === 'string' && a.check_in_photo.startsWith('http') ? a.check_in_photo : (a.check_in_photo ? '(foto lokal/idb)' : ''),
      'Catatan Masuk': a.check_in_note || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data, { cellDates: true });
    setColDateFormat(XLSX, ws, 'Tanggal', 'dd/mm/yyyy');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Absen');
    XLSX.writeFile(wb, `absen_${(dari || sampai) ? `${dari || 'awal'}_sd_${sampai || 'akhir'}` : month}.xlsx`);
  };
  const dLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Rekap Absen</h2>
          <p className="text-sm text-slate-500 mt-1">{filteredRows.length} absen · {(dari || sampai) ? 'rentang tanggal' : `bulan ${monthLabel(month)}`}</p>
        </div>
        <Button variant="secondary" onClick={exportExcel} disabled={filteredRows.length === 0}><Download className="w-4 h-4" />Export Excel ({filteredRows.length})</Button>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-5 grid grid-cols-2 md:grid-cols-3 gap-2">
        <div className="col-span-2 md:col-span-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama MD…"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
        </div>
        <Select value={month} onChange={e => setMonth(e.target.value)}>
          {monthsList.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Select value={mdId} onChange={e => setMdId(e.target.value)}>
          <option value="all">Semua MD</option>
          {mds.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
      </div>

      <DateRangeRow className="mb-5 -mt-2"
        dari={dari} sampai={sampai} onDari={setDari} onSampai={setSampai}
        onReset={() => { setDari(''); setSampai(''); }} />

      {loading ? <Loading /> : filteredRows.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm"><Users className="w-6 h-6 mx-auto mb-2 text-slate-600" />{search || mdId !== 'all' ? 'Tidak ada absen sesuai filter.' : 'Belum ada absen di bulan ini.'}</div>
      ) : (
        <div className="space-y-3">
          {filteredRows.slice(0, visibleCount).map(a => (
            <div key={a.id} onClick={() => setDetail(a)}
              className="bg-slate-950 border border-slate-800 rounded-xl p-4 cursor-pointer hover:border-slate-700 transition">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-bold text-slate-100 truncate">{a.md_name || a.md_email || '—'}</div>
                    {areaOf(a.md_id) && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 shrink-0 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{areaOf(a.md_id)}</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">{dLabel(a.date)}</div>
                </div>
                <div className="flex items-center gap-3 sm:gap-4 ml-auto">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-slate-800/60 flex items-center justify-center shrink-0"><LogIn className="w-4 h-4 text-slate-400" /></div>
                    <div><div className="text-[11px] text-slate-500">Masuk</div><div className={`text-sm font-semibold ${a.check_in_at ? 'text-emerald-400' : 'text-slate-500'}`}>{a.check_in_at ? fmtAbsenTime(a.check_in_at) : 'Belum'}</div></div>
                  </div>
                </div>
              </div>
              {a.check_in_note && <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-800">{a.check_in_note}</p>}
            </div>
          ))}
          {filteredRows.length > visibleCount && (
            <button onClick={() => setVisibleCount(c => c + 100)}
              className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sm text-slate-300 transition">
              Tampilkan lebih banyak · {filteredRows.length - visibleCount} lagi (dari {filteredRows.length})
            </button>
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl lg:max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-800 sticky top-0 bg-slate-950">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-base font-bold text-slate-100 truncate">{detail.md_name || detail.md_email || '—'}</div>
                  {areaOf(detail.md_id) && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300 shrink-0 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />{areaOf(detail.md_id)}</span>}
                </div>
                <div className="text-xs text-slate-500 truncate">{dLabel(detail.date)}{detail.md_email ? ` · ${detail.md_email}` : ''}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isSuperAdmin && !editMode && (
                  <button onClick={startEditAbsen} title="Edit absen"
                    className="h-8 px-3 rounded-lg bg-slate-800 hover:bg-amber-600 text-slate-200 hover:text-white text-xs font-medium flex items-center gap-1.5 transition">
                    <Pencil className="w-3.5 h-3.5" />Edit
                  </button>
                )}
                <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-100"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[{ k: 'in', icon: LogIn, label: 'Absen Masuk', time: detail.check_in_at, photo: detail.check_in_photo, lat: detail.check_in_lat, lng: detail.check_in_lng, note: detail.check_in_note }].map(s => (
                <div key={s.k} className="bg-slate-900/40 border border-slate-800 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2"><s.icon className="w-4 h-4 text-slate-400" /><span className="text-sm font-semibold text-slate-200">{s.label}</span></div>
                    {editMode && (
                      <button onClick={() => clearSession(s.k)} className="text-[11px] text-rose-300 hover:text-rose-200 flex items-center gap-1"><Trash2 className="w-3 h-3" />Kosongkan</button>
                    )}
                  </div>
                  <div className="relative mb-3">
                    {(editMode ? eform[`check_${s.k}_photo`] : s.photo)
                      ? <StoredImage src={editMode ? eform[`check_${s.k}_photo`] : s.photo} alt={s.label} className="w-full h-56 rounded-lg object-cover cursor-pointer" onClick={() => { if (!editMode) setLightbox(s.photo); }} />
                      : <div className="w-full h-56 rounded-lg bg-slate-800 flex items-center justify-center text-slate-600 text-xs">Tidak ada foto</div>}
                    {editMode && (
                      <button onClick={() => pickReplaceAbsen(s.k)} disabled={replacingKind === s.k}
                        className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md bg-black/70 hover:bg-blue-600 text-white text-[10px] font-medium backdrop-blur-sm transition disabled:opacity-60">
                        {replacingKind === s.k ? 'Uploading…' : <><Camera className="w-3 h-3" />Ganti</>}
                      </button>
                    )}
                  </div>
                  {editMode ? (
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] text-slate-500 mb-0.5">Jam</div>
                        <Input type="datetime-local" value={eform[`check_${s.k}_at`]} onChange={e => setEF({ [`check_${s.k}_at`]: e.target.value })} />
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 mb-0.5">Catatan</div>
                        <Input value={eform[`check_${s.k}_note`]} onChange={e => setEF({ [`check_${s.k}_note`]: e.target.value })} placeholder="—" />
                      </div>
                    </div>
                  ) : (<>
                    <div className="text-[11px] text-slate-500">Jam</div>
                    <div className={`text-sm font-semibold mb-2 ${s.time ? 'text-emerald-400' : 'text-slate-500'}`}>{s.time ? fmtAbsenTime(s.time) : 'Belum'}</div>
                    <div className="text-[11px] text-slate-500">Lokasi</div>
                    {s.lat != null && s.lng != null
                      ? <a href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"><MapPin className="w-3.5 h-3.5" />{Number(s.lat).toFixed(5)}, {Number(s.lng).toFixed(5)}</a>
                      : <div className="text-sm text-slate-500">—</div>}
                    {s.note && <><div className="text-[11px] text-slate-500 mt-2">Catatan</div><div className="text-sm text-slate-300">{s.note}</div></>}
                  </>)}
                </div>
              ))}
            </div>
            {(() => {
              const inP = (detail.check_in_lat != null && detail.check_in_lng != null) ? [detail.check_in_lat, detail.check_in_lng] : null;
              const outP = (detail.check_out_lat != null && detail.check_out_lng != null) ? [detail.check_out_lat, detail.check_out_lng] : null;
              if (!inP && !outP) return null;
              return (
                <div className="px-4 pb-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-2"><Navigation className="w-3 h-3" />Lokasi di Peta</div>
                  <div className="rounded-xl overflow-hidden border border-slate-800">
                    <MapContainer center={inP || outP} zoom={16} scrollWheelZoom={false} style={{ height: '220px', width: '100%' }}>
                      <TileLayer attribution={TILE_ATTR} url={TILE_URL} subdomains="abcd" maxZoom={19} />
                      {inP && <Marker position={inP} icon={BLUE_PIN_ICON}><Popup><div className="text-xs"><div className="font-semibold">Absen Masuk</div><div className="font-mono text-[10px] text-slate-500">{inP[0].toFixed(5)}, {inP[1].toFixed(5)}</div><a href={`https://www.google.com/maps?q=${inP[0]},${inP[1]}`} target="_blank" rel="noreferrer" className="text-sky-600 underline">Buka di Google Maps →</a></div></Popup></Marker>}
                      {outP && <Marker position={outP} icon={RED_PIN_ICON}><Popup><div className="text-xs"><div className="font-semibold">Absen Pulang</div><div className="font-mono text-[10px] text-slate-500">{outP[0].toFixed(5)}, {outP[1].toFixed(5)}</div><a href={`https://www.google.com/maps?q=${outP[0]},${outP[1]}`} target="_blank" rel="noreferrer" className="text-sky-600 underline">Buka di Google Maps →</a></div></Popup></Marker>}
                      {inP && outP && <Polyline positions={[inP, outP]} pathOptions={{ color: '#71717a', weight: 2, dashArray: '6 4' }} />}
                      <FitBounds points={[inP, outP].filter(Boolean)} />
                    </MapContainer>
                    <div className="bg-slate-950 border-t border-slate-800 px-3 py-2 flex items-center gap-4 text-[11px] text-slate-500">
                      {inP && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Masuk</span>}
                      {outP && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500" />Pulang</span>}
                    </div>
                  </div>
                </div>
              );
            })()}
            {isSuperAdmin && (
              <div className="p-4 pt-0 space-y-2">
                <input ref={absenFileRef} type="file" accept="image/*" className="hidden" onChange={onReplaceAbsenFile} />
                {editMode ? (
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditMode(false)} disabled={saving}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700 transition disabled:opacity-60">Batal</button>
                    <button onClick={saveAbsen} disabled={saving}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition disabled:opacity-60 flex items-center gap-1.5">
                      {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Menyimpan…</> : <><Check className="w-3.5 h-3.5" />Simpan Perubahan</>}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => handleDeleteAbsen(detail.id)} disabled={deleting}
                    className="w-full flex items-center justify-center gap-2 text-sm text-rose-300 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-600/30 rounded-lg py-2.5 disabled:opacity-50">
                    {deleting ? <><Loader2 className="w-4 h-4 animate-spin" />Menghapus…</> : <><Trash2 className="w-4 h-4" />Hapus Absen ini</>}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <StoredImage src={lightbox} alt="selfie" className="max-w-full max-h-full object-contain" />
          <button className="absolute top-4 right-4 text-white"><X className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
}

// Tombol mengambang Chat Admin → WhatsApp (untuk MD)
function WhatsAppCS({ name }) {
  const [open, setOpen] = useState(false);
  const phone = '6289508933544'; // 0895-0893-3544 (Indonesia)
  const msg = encodeURIComponent(`Halo Admin 2W Federal POSM, saya ${name || 'MD'}. Saya mau tanya / ada kendala:`);
  const waUrl = `https://wa.me/${phone}?text=${msg}`;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-64 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-[#25D366] px-4 py-3 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-white" />
            <div className="text-white text-sm font-semibold">Admin 2W Federal POSM</div>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-300 mb-3">Ada kendala atau pertanyaan? Chat Admin kami langsung via WhatsApp.</p>
            <a href={waUrl} target="_blank" rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold rounded-xl py-2.5 transition">
              <MessageCircle className="w-4 h-4" />Chat Sekarang
            </a>
            <p className="text-[11px] text-slate-500 text-center mt-2">0815-5300-6168</p>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} title="Chat Admin WhatsApp"
        className="w-14 h-14 rounded-full bg-[#25D366] hover:bg-[#1ebe5d] shadow-lg shadow-emerald-900/40 flex items-center justify-center transition active:scale-95">
        {open ? <X className="w-6 h-6 text-white" /> : <MessageCircle className="w-7 h-7 text-white" />}
      </button>
    </div>
  );
}

// Sambungkan tombol "kembali" HP ke navigasi tab. App ini SPA (pindah tab cuma
// ganti state, URL tak berubah) -> tanpa ini, back HP keluar dari app / error.
// Dengan ini: back -> tab sebelumnya; di tab awal, back sekali lagi keluar wajar.
function useTabBackButton(tab, setTab) {
  const skipPush = useRef(false);
  useEffect(() => {
    if (!window.history.state || window.history.state.tab == null) {
      window.history.replaceState({ tab }, '');
    }
    const onPop = (e) => {
      const target = e.state?.tab;
      if (target != null) { skipPush.current = true; setTab(target); }
      // target null -> sudah di baseline, biarkan browser keluar app (wajar).
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (skipPush.current) { skipPush.current = false; return; }
    if (window.history.state?.tab !== tab) window.history.pushState({ tab }, '');
  }, [tab]);
}

// Tekan "kembali" HP saat popup terbuka -> TUTUP popup TERATAS dulu (bukan pindah
// tab). Pakai 1 stack global + 1 listener supaya back cuma menutup 1 popup, bukan
// semua sekaligus (kasus popup bertumpuk, mis. detail visit -> foto fullscreen).
const __modalStack = [];
let __ignoreNextPop = false;
let __modalListenerReady = false;
function __ensureModalListener() {
  if (__modalListenerReady) return;
  __modalListenerReady = true;
  window.addEventListener('popstate', () => {
    if (__ignoreNextPop) { __ignoreNextPop = false; return; } // dipicu tutup via UI
    const top = __modalStack[__modalStack.length - 1];
    if (top) { top.poppedByBack = true; __modalStack.pop(); top.onClose(); }
  });
}
function useBackDismiss(isOpen, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    __ensureModalListener();
    const entry = { poppedByBack: false, onClose: () => onCloseRef.current?.() };
    __modalStack.push(entry);
    window.history.pushState({ modal: true }, '');
    return () => {
      const i = __modalStack.indexOf(entry);
      if (i !== -1) __modalStack.splice(i, 1);
      if (!entry.poppedByBack) { __ignoreNextPop = true; window.history.back(); } // tutup via UI -> buang entri
    };
  }, [isOpen]);
}

function MDView({ currentMD, refreshKey, welcome, onWelcomeClose }) {
  const [tab, setTab] = useState('new');
  useTabBackButton(tab, setTab);
  const [visits, setVisits] = useState([]);
  const [bengkels, setBengkels] = useState([]);
  const [regions, setRegions] = useState([]);
  const [kotas, setKotas] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRegionIds, setMyRegionIds] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        // Area MD bisa >1 (tl_regions). WAJIB diambil dulu — kalau hanya pakai
        // region_id tunggal, bengkel di provinsi keduanya tak pernah ter-load.
        const mine = await api.fetchMyRegions(currentMD.id).catch(() => []);
        const ids = mine?.length ? mine : (currentMD.region_id ? [currentMD.region_id] : []);
        setMyRegionIds(ids);
        const [v, b, r, k, d] = await Promise.all([
          api.fetchVisits({ mdId: currentMD.id }),
          api.fetchBengkels(ids.length ? ids : null),   // bengkel di semua area MD
          api.fetchRegions(),
          api.fetchKotas(),
          api.fetchDistributors(),
        ]);
        setVisits(v); setBengkels(b); setRegions(r); setKotas(k); setDistributors(d);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [currentMD.id, refreshKey]);

  const reloadVisits = async () => {
    const v = await api.fetchVisits({ mdId: currentMD.id });
    setVisits(v);
  };

  if (loading) return <Loading />;

  return (
    <div className="max-w-2xl mx-auto">
      <PasskeyEnrollBanner />
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-5 sm:flex">
        {[
          { id: 'absen', label: 'Absen', icon: CalendarDays },
          { id: 'new', label: 'Visit Baru', icon: ClipboardList },
          { id: 'history', label: `History (${visits.length})`, icon: Activity },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm whitespace-nowrap ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <t.icon className="w-4 h-4 shrink-0" /><span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'absen' && <AbsenTab currentMD={currentMD} />}
      {tab === 'new' && <VisitForm currentMD={currentMD} bengkels={bengkels} regions={regions} kotas={kotas} distributors={distributors} myRegionIds={myRegionIds} onSubmitted={() => { reloadVisits(); setTab('history'); }} onNeedAbsen={() => setTab('absen')} />}
      {tab === 'history' && <VisitHistory visits={visits} bengkels={bengkels} kotas={kotas} distributors={distributors} currentMD={currentMD} />}
      <WhatsAppCS name={currentMD.full_name} />
    </div>
  );
}

// Dashboard MD — progres target bulanan + tracking per hari
function MDDashboard({ currentMD, visits, bengkels, kotas }) {
  const todayStr = localDateStr();

  const availableMonths = useMemo(() => {
    const set = new Set(visits.map(v => v.visit_date.slice(0, 7)));
    set.add(todayStr.slice(0, 7)); // selalu sertakan bulan ini
    return [...set].sort().reverse();
  }, [visits, todayStr]);

  const [month, setMonth] = useState(todayStr.slice(0, 7));

  const monthVisits = useMemo(
    () => visits.filter(v => v.visit_date.startsWith(month)),
    [visits, month]
  );

  const monthlyTarget = currentMD.monthly_target || 30;
  const totalThisMonth = monthVisits.length;
  const achievement = monthlyTarget > 0 ? Math.round((totalThisMonth / monthlyTarget) * 100) : 0;
  const sisaTarget = Math.max(monthlyTarget - totalThisMonth, 0);
  const pemasangan = monthVisits.filter(v => v.status === HASIL_TERPASANG).length;
  const revisit = monthVisits.filter(v => v.status !== HASIL_TERPASANG).length;

  // Hitung jumlah hari dalam bulan terpilih
  const [yy, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();

  // Target harian ≈ target bulanan dibagi 26 hari kerja (mis. 178/26 ≈ 7)
  const dailyTarget = Math.max(1, Math.round(monthlyTarget / 26));

  // Data per hari
  const dailyData = useMemo(() => {
    const counts = {};
    monthVisits.forEach(v => {
      const d = Number(v.visit_date.slice(8, 10));
      counts[d] = (counts[d] || 0) + 1;
    });
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      return { day: String(day), Visit: counts[day] || 0 };
    });
  }, [monthVisits, daysInMonth]);

  const isCurrentMonth = month === todayStr.slice(0, 7);
  const todayCount = isCurrentMonth ? (dailyData[Number(todayStr.slice(8, 10)) - 1]?.Visit || 0) : 0;
  const activeDays = dailyData.filter(d => d.Visit > 0).length;
  const bestDay = dailyData.reduce((b, d) => (d.Visit > b.Visit ? d : b), { day: '-', Visit: 0 });
  const avgPerActiveDay = activeDays > 0 ? (totalThisMonth / activeDays).toFixed(1) : '0';

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Progres Target</h2>
          <p className="text-sm text-slate-500 mt-1">{currentMD.full_name} · tracking visit per hari</p>
        </div>
        <div className="w-40">
          <Select value={month} onChange={e => setMonth(e.target.value)}>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Visit Bulan Ini', value: totalThisMonth, sub: `dari ${monthlyTarget} target`, icon: Activity, color: 'red' },
          { label: 'Achievement', value: `${achievement}%`, sub: 'pencapaian target', icon: Target, color: 'emerald' },
          { label: isCurrentMonth ? 'Visit Hari Ini' : 'Hari Aktif', value: isCurrentMonth ? todayCount : activeDays, sub: isCurrentMonth ? `target ${dailyTarget}/hari` : 'hari ada visit', icon: Check, color: 'sky' },
          { label: 'Sisa Target', value: sisaTarget, sub: sisaTarget === 0 ? 'target tercapai 🎉' : 'visit lagi', icon: ClipboardList, color: 'amber' },
        ].map((k, i) => (
          <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{k.label}</span>
              <k.icon className={`w-4 h-4 ${KPI_ICON_COLOR[k.color] || 'text-slate-400'}`} />
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-0.5">{k.value}</div>
            <div className="text-xs text-slate-500">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Progress bar bulanan */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 mb-5">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-slate-400">Pencapaian bulan {monthLabel(month)}</span>
          <span className="font-semibold text-slate-100">{totalThisMonth}<span className="text-slate-500">/{monthlyTarget}</span></span>
        </div>
        <div className="h-2.5 bg-slate-800/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${achievement >= 80 ? 'bg-emerald-500' : achievement >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
            style={{ width: `${Math.min(achievement, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
          <span>Terpasang: <span className="text-emerald-400 font-medium">{pemasangan}</span> · Lainnya: <span className="text-sky-400 font-medium">{revisit}</span></span>
          <span>{achievement}%</span>
        </div>
      </div>

      {/* Chart per hari */}
      <Section title="Visit per Hari" subtitle={`${monthLabel(month)} · target ${dailyTarget}/hari (garis putus)`} icon={Activity}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData} margin={{ top: 10, right: 10, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="day" stroke="#71717a" tick={{ fontSize: 10 }} interval={daysInMonth > 20 ? 2 : 0} />
              <YAxis stroke="#71717a" tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#e4e4e7' }}
                itemStyle={{ color: '#e4e4e7' }}
                cursor={{ fill: 'rgba(239,68,68,0.05)' }}
                labelFormatter={(d) => `Tanggal ${d}`}
              />
              <ReferenceLine y={dailyTarget} stroke="#a1a1aa" strokeDasharray="4 4" />
              <Bar dataKey="Visit" radius={[4, 4, 0, 0]}>
                {dailyData.map((d, i) => (
                  <Cell key={i} fill={d.Visit >= dailyTarget ? '#10b981' : d.Visit > 0 ? '#2563eb' : '#3f3f46'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-slate-100">{activeDays}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Hari Aktif</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-slate-100">{avgPerActiveDay}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Rata2 / Hari</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-slate-100">{bestDay.Visit > 0 ? `${bestDay.Visit}` : '0'}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Terbanyak {bestDay.Visit > 0 ? `(tgl ${bestDay.day})` : ''}</div>
          </div>
        </div>
      </Section>

      {monthVisits.length === 0 && (
        <div className="text-center text-slate-500 text-sm py-8">
          Belum ada visit di bulan ini. Mulai dari tab <span className="text-blue-400 font-medium">Visit Baru</span>.
        </div>
      )}
    </div>
  );
}

function VisitForm({ currentMD, bengkels, regions, kotas, distributors, onSubmitted, onNeedAbsen, myRegionIds: initialRegionIds }) {
  const DRAFT_KEY = `visitDraft:${currentMD.id}`;
  const emptyPhotos = { selfie: null, before: null, after: null, spandukJauh: null, spandukSedang: null, poster: null };
  const makeDefaultForm = () => ({
    group: '',
    regionId: currentMD.region_id || '',
    kotaId: '',
    bengkelId: '',
    date: localDateStr(),
    status: '', remarks: '',
    photos: { ...emptyPhotos },
  });
  // Tanpa draft: form selalu mulai FRESH (draft lama di localStorage ikut dibersihkan).
  const [form, setForm] = useState(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
    return makeDefaultForm();
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [backfilled, setBackfilled] = useState(false);
  const [error, setError] = useState('');
  // Lock sinkron — cegah dobel submit dari double-tap cepat (sebelum state submitting ke-render)
  const submitLock = useRef(false);
  // ID visit dibuat di awal supaya tiap foto bisa di-upload duluan (eager) ke path-nya.
  const [visitId] = useState(() => crypto.randomUUID());
  // Bengkel yang SUDAH terpasang (oleh MD mana pun) — tak boleh disubmit lagi.
  const [terpasangIds, setTerpasangIds] = useState(() => new Set());
  useEffect(() => {
    api.fetchTerpasangBengkelIds().then(setTerpasangIds).catch(() => {});
  }, [currentMD.id]);

  // MD WAJIB absen masuk dulu sebelum boleh mengisi visit hari ini.
  const [checkedInToday, setCheckedInToday] = useState(null);   // null = masih dicek
  useEffect(() => {
    const today = localDateStr();   // tanggal LOKAL — samakan dengan modul absen
    api.fetchTodayAttendance(currentMD.id, today)
      .then(a => setCheckedInToday(!!a?.check_in_at))
      .catch(() => setCheckedInToday(true));   // gagal cek → jangan blokir (fail-open)
  }, [currentMD.id]);

  // GPS user state — di-capture saat bengkel dipilih
  const [gps, setGps] = useState({ status: 'idle', lat: null, lng: null, accuracy: null, error: null });

  const filteredKotas = kotas.filter(k => k.region_id === form.regionId);
  const filteredBengkels = bengkels.filter(b => !form.kotaId || b.kota_id === form.kotaId);
  // Area MD bisa >1 (tabel tl_regions dipakai juga untuk MD). Fallback: region_id tunggal.
  // Area dikirim dari MDView (sudah dipakai untuk memuat bengkel) — fetch ulang
  // hanya bila belum tersedia, supaya daftar bengkel & area selalu sinkron.
  const [myRegionIds, setMyRegionIds] = useState(initialRegionIds?.length ? initialRegionIds : null);
  useEffect(() => {
    if (initialRegionIds?.length) { setMyRegionIds(initialRegionIds); return; }
    api.fetchMyRegions(currentMD.id)
      .then(ids => setMyRegionIds(ids?.length ? ids : (currentMD.region_id ? [currentMD.region_id] : [])))
      .catch(() => setMyRegionIds(currentMD.region_id ? [currentMD.region_id] : []));
  }, [currentMD.id, initialRegionIds]);
  const allowedRegionIds = myRegionIds || (currentMD.region_id ? [currentMD.region_id] : []);
  const multiArea = allowedRegionIds.length > 1;
  const areaNames = allowedRegionIds.map(id => regions.find(r => r.id === id)?.name).filter(Boolean);
  // Terkunci hanya kalau tepat 1 area; multi-area -> pilih dari daftar areanya sendiri.
  const regionLocked = allowedRegionIds.length === 1;
  // Cascade Region (7 grup) -> Provinsi: opsi provinsi dibatasi area MD (kalau ada).
  const selectableProvinsi = allowedRegionIds.length ? regions.filter(r => allowedRegionIds.includes(r.id)) : regions;
  const groupOptions = [...new Set(selectableProvinsi.map(groupOfRegion))].sort();
  const selectedProvinsi = regions.find(r => r.id === form.regionId);
  const groupSel = selectedProvinsi ? groupOfRegion(selectedProvinsi) : form.group;
  const provinsiOptions = selectableProvinsi.filter(r => !groupSel || groupOfRegion(r) === groupSel);
  const selectedBengkel = bengkels.find(b => b.id === form.bengkelId);

  // Fetch GPS user
  const fetchGPS = (attempt = 0) => {
    if (!navigator.geolocation) {
      setGps({ status: 'error', lat: null, lng: null, accuracy: null, error: 'GPS tidak didukung browser' });
      return;
    }
    setGps(g => ({ ...g, status: 'loading', error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({
        status: 'ready',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        error: null,
      }),
      (err) => {
        // code 1 = izin ditolak (tak bisa re-prompt otomatis -> arahkan ke setelan).
        // code 2/3 = posisi tak tersedia / timeout -> otomatis minta lagi s/d 3x.
        if (err.code !== 1 && attempt < 2) {
          setTimeout(() => fetchGPS(attempt + 1), 1200);
          return;
        }
        const msg = err.code === 1
          ? 'Izin lokasi ditolak. Aktifkan izin Lokasi untuk situs ini di setelan browser/HP, lalu tekan "Ambil GPS lagi".'
          : err.code === 2 ? 'Posisi tidak tersedia — pastikan GPS/Lokasi HP menyala, lalu coba lagi.'
          : 'GPS timeout — coba lagi di area terbuka.';
        setGps({ status: 'error', lat: null, lng: null, accuracy: null, error: msg });
      },
      { timeout: 20000, enableHighAccuracy: true, maximumAge: attempt === 0 ? 60000 : 0 }
    );
  };

  // Trigger GPS saat bengkel dipilih. (Distributor TIDAK auto-set lagi —
  // dipilih bebas oleh MD per visit, karena 1 bengkel bisa dicover banyak distributor.)
  useEffect(() => {
    if (selectedBengkel) {
      fetchGPS();
    }
  }, [form.bengkelId]);


  // Upload-saat-foto-diambil: begitu foto selesai dikompres → langsung upload
  // ke storage (latar belakang). Saat submit tinggal pakai URL-nya → instan.
  const setPhoto = (key, val) => {
    if (val?.status === 'ready' && val.file && !val.url) {
      setForm(f => ({ ...f, photos: { ...f.photos, [key]: { ...val, status: 'uploading' } } }));
      api.uploadOneVisitPhoto(val.file, visitId, key)
        .then(({ url }) => setForm(f => {
          const cur = f.photos[key];
          if (!cur || cur.file !== val.file) return f;   // sudah diganti/dihapus
          return { ...f, photos: { ...f.photos, [key]: { ...cur, status: 'uploaded', url } } };
        }))
        .catch(err => setForm(f => {
          const cur = f.photos[key];
          if (!cur || cur.file !== val.file) return f;
          return { ...f, photos: { ...f.photos, [key]: { ...cur, status: 'error', error: err.message } } };
        }));
    } else {
      setForm(f => ({ ...f, photos: { ...f.photos, [key]: val } }));
    }
  };
  const PRESENT = ['ready', 'uploading', 'uploaded'];
  const photoCount = Object.values(form.photos).filter(p => PRESENT.includes(p?.status)).length;
  const anyCompressing = Object.values(form.photos).some(p => p?.status === 'compressing');
  const anyUploading = Object.values(form.photos).some(p => p?.status === 'uploading');

  // Foto wajib dasar: selfie + tampak depan before. Kalau hasil "Spanduk Terpasang" →
  // wajib tambah after + spanduk jauh/sedang. Poster OPSIONAL.
  const terpasang = form.status === HASIL_TERPASANG;
  const requiredPhotos = ['selfie', 'before'];
  if (terpasang) requiredPhotos.push('after', 'spandukJauh', 'spandukSedang');
  const hasAllRequiredPhotos = requiredPhotos.every(k => PRESENT.includes(form.photos[k]?.status));
  // Jarak GPS user ↔ bengkel (kalau dua-duanya ada). Bengkel tanpa koordinat →
  // null → tidak diblokir (mis. visit pertama yang justru mengisi koordinatnya).
  const gpsDistance = (gps.status === 'ready' && selectedBengkel?.lat != null && selectedBengkel?.lng != null)
    ? haversineMeters(selectedBengkel.lat, selectedBengkel.lng, gps.lat, gps.lng)
    : null;
  const GEOFENCE_RADIUS = 150; // meter — MD wajib dalam radius ini dari titik bengkel
  const gpsFar = gpsDistance != null && gpsDistance > GEOFENCE_RADIUS; // terlalu jauh → blokir

  // Bengkel terpilih sudah pernah terpasang → kunci submit.
  const bengkelSudahTerpasang = !!form.bengkelId && terpasangIds.has(form.bengkelId);
  const canSubmit = checkedInToday !== false && form.bengkelId && !bengkelSudahTerpasang && form.status && hasAllRequiredPhotos && !anyCompressing && gps.status === 'ready' && !gpsFar && !submitting;

  const handleSubmit = async () => {
    if (submitLock.current || !canSubmit) return;  // guard sinkron, gak nunggu re-render
    submitLock.current = true;
    setSubmitting(true); setError('');

    try {
      // GPS sudah ditangkap saat bengkel dipilih (state gps). Fallback ke bengkel coord kalau gagal.
      const lat = gps.status === 'ready' ? gps.lat : selectedBengkel?.lat;
      const lng = gps.status === 'ready' ? gps.lng : selectedBengkel?.lng;

      // Kalau bengkel belum punya koord di master, request backfill ke api
      const bengkelLacksCoords = selectedBengkel?.lat == null || selectedBengkel?.lng == null;

      const { bengkelBackfilled } = await api.createVisit({
        visitId,
        mdId: currentMD.id,
        bengkelId: form.bengkelId,
        visitDate: form.date,
        status: form.status,
        remarks: form.remarks,
        lat, lng,
        photos: form.photos,
        backfillBengkelCoords: bengkelLacksCoords,
      });

      setSubmitted(true);
      setBackfilled(bengkelBackfilled);
      setTimeout(() => { setSubmitted(false); setBackfilled(false); onSubmitted(); }, 2000);
    } catch (err) {
      console.error(err);
      // 23505 = unique violation -> bengkel keburu di-submit MD lain (race).
      const duplikat = err?.code === '23505' || /visits_one_terpasang_per_bengkel|duplicate key/i.test(err?.message || '');
      if (duplikat) {
        setError('Bengkel ini baru saja dilaporkan terpasang oleh MD lain. Visit tidak disimpan — silakan pilih bengkel lain.');
        setTerpasangIds(s => new Set(s).add(form.bengkelId));
      } else {
        setError(err.message || 'Gagal menyimpan visit');
      }
      setSubmitting(false);
      submitLock.current = false;  // error → boleh coba lagi
    }
  };

  // Gate: belum absen masuk hari ini → form visit tidak ditampilkan.
  if (checkedInToday === false) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <div className="w-14 h-14 rounded-2xl bg-blue-600/10 flex items-center justify-center mx-auto mb-4">
          <CalendarDays className="w-7 h-7 text-blue-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-100 mb-1">Absen Masuk dulu</h3>
        <p className="text-sm text-slate-500 mb-5 max-w-xs mx-auto">
          Kamu belum absen masuk hari ini. Lakukan <span className="text-slate-300">Absen Masuk</span> dulu sebelum mengisi visit.
        </p>
        <Button onClick={onNeedAbsen}><LogIn className="w-4 h-4" />Absen Masuk Sekarang</Button>
      </div>
    );
  }

  return (
    <>
      {submitted && (
        <div className="mb-4 p-4 bg-emerald-600/10 border border-emerald-600/30 rounded-xl flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-600/100 flex items-center justify-center shrink-0">
            <Check className="w-5 h-5 text-slate-900" strokeWidth={3} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-400">Visit berhasil disimpan</p>
            <p className="text-xs text-emerald-400">Foto sudah diupload ke storage…</p>
            {backfilled && (
              <div className="mt-2 p-2 bg-sky-600/10 border border-sky-600/30 rounded-lg flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-sky-400">
                  Koordinat bengkel di master data otomatis ter-update dari GPS Anda. Visit berikutnya akan langsung pakai koord ini.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-400">{error}</p>
        </div>
      )}

      <Section title="Info MD & Bengkel" subtitle="Pilih bengkel target visit" icon={Building2}>
        <div className="grid grid-cols-2 gap-3 mb-1">
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Nama MD</div>
            <div className="text-sm text-slate-100 font-medium truncate">{currentMD.full_name}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Area</div>
            <div className="text-sm text-slate-100 font-medium truncate">
              {areaNames.length ? areaNames.join(', ') : (regions.find(r => r.id === form.regionId)?.name || '—')}
            </div>
          </div>
        </div>
        <Field label="Region" required>
          <SearchableSelect
            value={groupSel}
            onChange={(val) => setForm({ ...form, group: val, regionId: '', kotaId: '', bengkelId: '' })}
            options={groupOptions.map(g => ({ value: g, label: g }))}
            placeholder="Pilih region…"
            disabled={regionLocked}
          />
        </Field>
        <Field label="Provinsi" required>
          <SearchableSelect
            value={form.regionId}
            onChange={(val) => setForm({ ...form, regionId: val, kotaId: '', bengkelId: '' })}
            options={provinsiOptions.map(r => ({ value: r.id, label: r.name }))}
            placeholder="Pilih provinsi…"
            disabled={regionLocked || !groupSel}
            emptyText="Tidak ada provinsi di region ini"
          />
          {multiArea && <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Kamu meng-cover {allowedRegionIds.length} provinsi — pilih provinsi bengkel yang dikunjungi.</p>}
          {!regionLocked && !multiArea && <p className="text-[11px] text-amber-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Area kamu belum diset admin. Pilih manual dulu.</p>}
        </Field>
        <Field label="Kota" required>
          <SearchableSelect
            value={form.kotaId}
            onChange={(val) => setForm({ ...form, kotaId: val, bengkelId: '' })}
            options={filteredKotas.map(k => ({ value: k.id, label: k.name }))}
            placeholder="Pilih kota…"
            disabled={!form.regionId}
            emptyText="Tidak ada kota di provinsi ini"
          />
        </Field>
        <Field label="Kode - Nama Bengkel" required>
          <SearchableSelect
            value={form.bengkelId}
            onChange={(val) => setForm({ ...form, bengkelId: val })}
            options={filteredBengkels.map(b => ({
              value: b.id,
              label: `${b.code} - ${b.name}${terpasangIds.has(b.id) ? '  ✓ sudah terpasang' : ''}`,
            }))}
            placeholder="Pilih bengkel…"
            disabled={!form.kotaId}
            emptyText="Belum ada bengkel di kota ini"
          />
          {form.kotaId && filteredBengkels.length === 0 && (
            <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" />
              Belum ada bengkel terdaftar di kota ini.
            </p>
          )}
          {bengkelSudahTerpasang && (
            <div className="mt-2 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-300">
                <span className="font-semibold">Bengkel ini sudah terpasang spanduk.</span>{' '}
                Tidak bisa disubmit lagi — silakan pilih bengkel lain yang belum terpasang.
              </div>
            </div>
          )}
          {selectedBengkel?.address && (
            <div className="mt-2 p-2.5 bg-slate-950 border border-slate-800 rounded-lg flex items-start gap-2">
              <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Alamat Bengkel</div>
                <p className="text-xs text-slate-300 leading-snug">{selectedBengkel.address}</p>
              </div>
            </div>
          )}
        </Field>

        {selectedBengkel && (
          <div className="mt-3">
            <BengkelMap
              lat={selectedBengkel.lat}
              lng={selectedBengkel.lng}
              name={selectedBengkel.name}
              code={selectedBengkel.code}
              userLat={gps.lat}
              userLng={gps.lng}
              accuracy={gps.accuracy}
              gpsStatus={gps.status}
              gpsError={gps.error}
              onRefetchGPS={fetchGPS}
              onUserLocationChange={(lat, lng) => setGps(g => ({ ...g, status: 'ready', lat, lng, accuracy: null, error: null }))}
            />
          </div>
        )}
      </Section>

      <Section title="Detail Kunjungan" icon={Calendar}>
        <Field label="Tanggal Visit">
          <Input type="date" value={form.date} readOnly disabled tabIndex={-1}
            className="opacity-80 cursor-not-allowed" />
          <p className="text-[10px] text-slate-500 mt-1">Otomatis hari ini · tidak bisa diubah</p>
        </Field>
      </Section>

      <Section title="Hasil Visit" icon={Check}>
        <Field label="Hasil Visit" required>
          <Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="">— Pilih hasil visit —</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          {!form.status && (
            <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" />Pilih hasil visit.
            </p>
          )}
        </Field>

        {terpasang && (
          <p className="text-[11px] text-emerald-400 -mt-1 mb-2">Spanduk Terpasang — lengkapi foto After, Spanduk & Poster di bagian Dokumentasi Foto di bawah.</p>
        )}
        {form.status && !terpasang && (
          <p className="text-[11px] text-slate-500 -mt-1 mb-2">Hasil visit bukan "Spanduk Terpasang" — cukup foto selfie & tampak depan (before), lalu isi notes jika ada.</p>
        )}
      </Section>

      <Section title="Dokumentasi Foto" subtitle={`${photoCount} / ${requiredPhotos.length} foto wajib`} icon={Camera}>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Selfie</div>
        <div className="grid grid-cols-3 gap-3">
          <PhotoTile label="Selfie Depan Bengkel" required hint="Selfie dengan latar bengkel terlihat" photo={form.photos.selfie} onChange={v => setPhoto('selfie', v)} />
        </div>

        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-5 mb-2 pt-4 border-t border-slate-800">Tampak Depan Bengkel</div>
        <div className="grid grid-cols-3 gap-3">
          <PhotoTile label="Tampak Depan Full (Before)" required hint="Sebelum pemasangan" photo={form.photos.before} onChange={v => setPhoto('before', v)} />
          {terpasang && (
            <PhotoTile label="Tampak Depan (After)" required hint="Setelah pemasangan" photo={form.photos.after} onChange={v => setPhoto('after', v)} />
          )}
        </div>

        {terpasang && (<>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-5 mb-2 pt-4 border-t border-slate-800">Spanduk</div>
          <div className="grid grid-cols-3 gap-3">
            <PhotoTile label="Spanduk Jarak Jauh" required photo={form.photos.spandukJauh} onChange={v => setPhoto('spandukJauh', v)} />
            <PhotoTile label="Spanduk Jarak Sedang" required photo={form.photos.spandukSedang} onChange={v => setPhoto('spandukSedang', v)} />
          </div>

          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mt-5 mb-2 pt-4 border-t border-slate-800">Poster (opsional)</div>
          <div className="grid grid-cols-3 gap-3">
            <PhotoTile label="Foto Poster" hint="Opsional — isi jika ada poster" photo={form.photos.poster} onChange={v => setPhoto('poster', v)} />
          </div>
        </>)}
      </Section>

      <Section title="Notes" icon={FileText}>
        <Field label="Notes (tulis jika ada)">
          <Textarea rows={3} placeholder="Catatan tambahan…" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
        </Field>
      </Section>

      {gpsFar && (
        <div className="mb-3 p-3 bg-rose-600/10 border border-rose-600/30 rounded-lg flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-300">
            <span className="font-semibold">Bengkel yang Anda pilih salah — mohon periksa kembali, atau hubungi admin.</span>
          </p>
        </div>
      )}

      {form.bengkelId && gps.status !== 'ready' && (
        <div className="mb-3 p-3 bg-amber-600/10 border border-amber-600/30 rounded-lg flex items-start gap-2.5">
          <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-300">
              <span className="font-semibold">{gps.status === 'loading' ? 'Mengambil lokasi GPS…' : 'GPS belum aktif.'}</span>{' '}
              {gps.status === 'error' ? (gps.error || 'Visit tidak bisa disimpan tanpa lokasi.') : 'Visit tidak bisa disimpan tanpa lokasi.'}
            </p>
            {gps.status !== 'loading' && (
              <button type="button" onClick={() => fetchGPS()}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition">
                <Navigation className="w-3.5 h-3.5" />Ambil GPS lagi
              </button>
            )}
          </div>
        </div>
      )}

      <Button variant="primary" size="lg" className="w-full" onClick={handleSubmit} disabled={!canSubmit}>
        {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan & upload foto…</> : <>Simpan Visit <ChevronRight className="w-4 h-4" /></>}
      </Button>
    </>
  );
}

function VisitHistory({ visits, bengkels, kotas, distributors, currentMD }) {
  const [detailId, setDetailId] = useState(null);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('all');
  const [status, setStatus] = useState('all');
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');
  const [visibleCount, setVisibleCount] = useState(50); // batasi render biar HP tak freeze
  const bengkelById = useMemo(() => new Map(bengkels.map(b => [b.id, b])), [bengkels]);
  const kotaById = useMemo(() => new Map(kotas.map(k => [k.id, k])), [kotas]);
  const distById = useMemo(() => new Map(distributors.map(d => [d.id, d])), [distributors]);
  const findBengkel = (id) => bengkelById.get(id);
  const findKota = (id) => kotaById.get(id);
  const findDist = (id) => distById.get(id);

  useEffect(() => { setVisibleCount(50); }, [search, month, status, dari, sampai]);
  const availableMonths = useMemo(() => [...new Set(visits.map(v => v.visit_date.slice(0, 7)))].sort().reverse(), [visits]);
  const filtered = visits.filter(v => {
    if (dari || sampai) {
      if (dari && v.visit_date < dari) return false;
      if (sampai && v.visit_date > sampai) return false;
    } else if (month !== 'all' && !v.visit_date.startsWith(month)) return false;
    if (status !== 'all' && v.status !== status) return false;
    if (search.trim()) {
      const b = findBengkel(v.bengkel_id);
      const hay = `${b?.code || ''} ${b?.name || v.bengkel_name || ''} ${v.status || ''}`.toLowerCase();
      if (!hay.includes(search.trim().toLowerCase())) return false;
    }
    return true;
  });

  if (visits.length === 0) {
    return <div className="text-center py-12 text-slate-500 text-sm">Belum ada visit tercatat.</div>;
  }

  return (
    <div>
      <div className="space-y-2 mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari bengkel / PIC…"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="all">Semua Bulan</option>
            {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </Select>
          <Select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">Semua Hasil</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <DateRangeRow dari={dari} sampai={sampai} onDari={setDari} onSampai={setSampai} onReset={() => { setDari(''); setSampai(''); }} />
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">Tidak ada visit sesuai filter.</div>
      ) : (
      <div className="space-y-3">
      {filtered.slice(0, visibleCount).map(v => {
        const b = findBengkel(v.bengkel_id);
        const k = b ? findKota(b.kota_id) : null;
        const d = findDist(v.distributor_id);
        const photoCount = PHOTO_KEYS.filter(key => v[key]).length;
        return (
          <div key={v.id} onClick={() => setDetailId(v.id)}
            className="bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition cursor-pointer">
            <div className="mb-2 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{b?.code || '—'}</div>
                <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
              </div>
              <h4 className="text-sm font-semibold text-slate-100 break-words leading-snug">{b?.name || v.bengkel_name || '—'}</h4>
              <div className="text-xs text-slate-500 mt-0.5">{k?.name || v.kota_name || '—'}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <StatusBadge status={v.status} />
                <CheckBadge visit={v} />
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 pt-2 border-t border-slate-800 mt-2">
              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{v.visit_date}{v.created_at ? ` · ${fmtAbsenTime(v.created_at)}` : ''}</span>
              <span className="flex items-center gap-1"><Camera className="w-3 h-3" />{photoCount} foto</span>
            </div>
            {v.check_status === 'Tidak Sesuai' && v.check_remarks && (
              <p className="text-[11px] text-rose-300 mt-2 pt-2 border-t border-slate-800">
                <span className="font-semibold">Catatan admin:</span> {v.check_remarks}
              </p>
            )}
          </div>
        );
      })}
      {filtered.length > visibleCount && (
        <button onClick={() => setVisibleCount(c => c + 100)}
          className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sm text-slate-300 transition">
          Tampilkan lebih banyak · {filtered.length - visibleCount} lagi (dari {filtered.length})
        </button>
      )}
      </div>
      )}

      {(() => {
        const dv = detailId ? visits.find(x => x.id === detailId) : null;
        if (!dv) return null;
        const b = findBengkel(dv.bengkel_id);
        return (
          <VisitDetailModal
            visit={dv}
            bengkel={b}
            kota={b ? findKota(b.kota_id) : null}
            distributor={findDist(dv.distributor_id)}
            md={currentMD}
            onClose={() => setDetailId(null)}
          />
        );
      })()}
    </div>
  );
}

// ============================================================
// LEADERBOARD — ranking produktivitas MD (pakai data yang sudah ada)
// ============================================================
function LeaderboardTab({ visits, mds, regions }) {
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
function LaporanTab({ visits, bengkels, kotas, regions, accounts = [] }) {
  const [level, setLevel] = useState('provinsi');   // provinsi | kota
  const [month, setMonth] = useState('all');
  const [dari, setDari] = useState('');
  const [sampai, setSampai] = useState('');

  const availableMonths = useMemo(
    () => [...new Set(visits.map(v => v.visit_date.slice(0, 7)))].sort().reverse(), [visits]);

  const kotaById = useMemo(() => new Map(kotas.map(k => [k.id, k])), [kotas]);
  const regionById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);
  const bengkelById = useMemo(() => new Map(bengkels.map(b => [b.id, b])), [bengkels]);

  const fVisits = useMemo(() => visits.filter(v => {
    if (dari || sampai) {
      if (dari && v.visit_date < dari) return false;
      if (sampai && v.visit_date > sampai) return false;
    } else if (month !== 'all' && !v.visit_date.startsWith(month)) return false;
    return true;
  }), [visits, month, dari, sampai]);

  // Kolom kategori (selain Visited & Terpasang yang tampil khusus)
  const CATS = STATUS_OPTIONS.filter(s => s !== HASIL_TERPASANG);
  // Nama kolom mengikuti laporan Excel AA
  const SHORT = {
    'Alamat bengkel tidak ditemukan': 'Address Not Found',
    'Ditolak': 'Decline',
    'Bukan bengkel': 'Not Bengkel',
    'Owner/PIC tidak di tempat': 'Closed',
    'Tidak jual oli Federal': 'Not Selling Federal',
  };

  // Agregasi: kunci = provinsi(region_id) atau kota(kota_id)
  const { groups, grand } = useMemo(() => {
    const blank = () => ({ target: 0, visited: 0, terpasang: 0, spanduk: 0, poster: 0, cats: Object.fromEntries(CATS.map(c => [c, 0])) });
    const rows = new Map();   // key -> {name, groupName, ...counts}

    const keyOf = (kota) => level === 'kota' ? kota?.id : kota?.region_id;
    const nameOf = (kota) => {
      if (level === 'kota') return kota?.name || '—';
      return regionById.get(kota?.region_id)?.name || '—';
    };
    const ensure = (kota) => {
      const key = keyOf(kota);
      if (!key) return null;
      if (!rows.has(key)) {
        rows.set(key, { key, name: nameOf(kota), regionId: kota?.region_id, group: groupOfRegion(regionById.get(kota?.region_id)), ...blank() });
      }
      return rows.get(key);
    };

    // Target = jumlah bengkel terdata
    bengkels.forEach(b => {
      const row = ensure(kotaById.get(b.kota_id));
      if (row) row.target++;
    });
    // Realisasi
    fVisits.forEach(v => {
      const b = bengkelById.get(v.bengkel_id);
      const row = ensure(kotaById.get(b?.kota_id));
      if (!row) return;
      row.visited++;
      if (v.status === HASIL_TERPASANG) {
        row.terpasang++;
        if (v.photo_spanduk_jauh || v.photo_spanduk_sedang) row.spanduk++;   // bukti spanduk ada
        if (v.photo_poster) row.poster++;                                     // poster ikut terpasang
      } else if (row.cats[v.status] != null) row.cats[v.status]++;
    });

    // Kelompokkan per region + subtotal
    const byGroup = {};
    [...rows.values()].forEach(r => { (byGroup[r.group] ||= []).push(r); });
    const groups = Object.entries(byGroup)
      .map(([group, items]) => {
        items.sort((a, b) => a.name.localeCompare(b.name));
        const sub = { ...blank(), cats: Object.fromEntries(CATS.map(c => [c, 0])) };
        items.forEach(r => {
          sub.target += r.target; sub.visited += r.visited; sub.terpasang += r.terpasang;
          sub.spanduk += r.spanduk; sub.poster += r.poster;
          CATS.forEach(c => { sub.cats[c] += r.cats[c]; });
        });
        return { group, items, sub };
      })
      .sort((a, b) => a.group.localeCompare(b.group));

    const grand = { ...blank(), cats: Object.fromEntries(CATS.map(c => [c, 0])) };
    groups.forEach(g => {
      grand.target += g.sub.target; grand.visited += g.sub.visited; grand.terpasang += g.sub.terpasang;
      grand.spanduk += g.sub.spanduk; grand.poster += g.sub.poster;
      CATS.forEach(c => { grand.cats[c] += g.sub.cats[c]; });
    });
    return { groups, grand };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fVisits, bengkels, kotaById, regionById, bengkelById, level]);

  const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const cell = (n, t) => `${n} (${pct(n, t)}%)`;

  // MD yang meng-cover tiap provinsi (area MD = provinsi, bisa >1 via tl_regions)
  const mdByRegion = useMemo(() => {
    const m = {};
    (accounts || []).filter(a => a.role === 'md' && a.active !== false).forEach(a => {
      const ids = a.region_ids?.length ? a.region_ids : (a.region_id ? [a.region_id] : []);
      ids.forEach(rid => { (m[rid] ||= []).push(a.full_name); });
    });
    Object.values(m).forEach(list => list.sort((x, y) => x.localeCompare(y)));
    return m;
  }, [accounts]);
  const mdNamesOf = (regionId) => mdByRegion[regionId] || [];
  const mdNamesOfGroup = (group) => {
    const names = new Set();
    regions.filter(r => groupOfRegion(r) === group).forEach(r => mdNamesOf(r.id).forEach(n => names.add(n)));
    return [...names].sort((a, b) => a.localeCompare(b));
  };

  // Definisi kolom angka — dipakai header, baris, subtotal, grand total & export.
  const NUM_COLS = [
    { key: 'target',    label: '# Workshop',     get: r => r.target,    raw: true, color: 'text-slate-300' },
    { key: 'visited',   label: 'Visited',        get: r => r.visited,   color: 'text-sky-300' },
    { key: 'terpasang', label: 'Success Deploy', get: r => r.terpasang, color: 'text-emerald-400' },
    { key: 'spanduk',   label: 'Spanduk',        get: r => r.spanduk,   color: 'text-emerald-300' },
    { key: 'poster',    label: 'Poster',         get: r => r.poster,    color: 'text-emerald-300' },
    ...CATS.map(c => ({ key: c, label: SHORT[c] || c, get: r => r.cats[c], cat: true })),
  ];
  const ALL_COLS = [...NUM_COLS, { key: 'mdcover', label: 'MD Cover' }];
  const [hiddenCols, setHiddenCols] = useState([]);
  const show = (k) => !hiddenCols.includes(k);
  const toggleCol = (k) => setHiddenCols(h => (h.includes(k) ? h.filter(x => x !== k) : [...h, k]));
  const visibleNumCols = NUM_COLS.filter(c => show(c.key));

  const exportLaporan = async () => {
    // xlsx-js-style = SheetJS + dukungan style (SheetJS CE mengabaikan style).
    const XLSX = await import('xlsx-js-style');

    // ---------- Sheet 1: Laporan Coverage (berformat) ----------
    const headers = ['Region (AA)', level === 'kota' ? 'Kota (AA)' : 'Provinsi (AA)',
      ...visibleNumCols.map(c => c.label), ...(show('mdcover') ? ['MD Cover'] : [])];
    const aoa = [headers];
    const kinds = ['head'];                       // jenis tiap baris untuk styling
    groups.forEach(g => {
      g.items.forEach((r, i) => {
        aoa.push([i === 0 ? g.group : '', r.name,
          ...visibleNumCols.map(c => (c.raw ? c.get(r) : cell(c.get(r), r.target))),
          ...(show('mdcover') ? [mdNamesOf(r.regionId).join(', ')] : [])]);
        kinds.push('data');
      });
      aoa.push([`${g.group} TOTAL`, '',
        ...visibleNumCols.map(c => (c.raw ? c.get(g.sub) : cell(c.get(g.sub), g.sub.target))),
        ...(show('mdcover') ? [`${mdNamesOfGroup(g.group).length} MD`] : [])]);
      kinds.push('sub');
    });
    aoa.push(['GRAND TOTAL', '',
      ...visibleNumCols.map(c => (c.raw ? c.get(grand) : cell(c.get(grand), grand.target))),
      ...(show('mdcover') ? [`${new Set(Object.values(mdByRegion).flat()).size} MD`] : [])]);
    kinds.push('grand');

    const BORDER = { style: 'thin', color: { rgb: 'FFB4C6E7' } };
    const borders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    const styleFor = (kind, colIdx) => {
      const align = { vertical: 'center', wrapText: true, horizontal: colIdx <= 1 ? 'left' : 'center' };
      if (kind === 'head') return { font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 }, fill: { fgColor: { rgb: 'FF1F4E79' } }, alignment: { ...align, horizontal: 'center' }, border: borders };
      if (kind === 'sub') return { font: { bold: true, color: { rgb: 'FF1F4E79' } }, fill: { fgColor: { rgb: 'FFBDD7EE' } }, alignment: align, border: borders };
      if (kind === 'grand') return { font: { bold: true, color: { rgb: 'FF1F4E79' } }, fill: { fgColor: { rgb: 'FF9DC3E6' } }, alignment: align, border: borders };
      return { alignment: align, border: borders };
    };
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    aoa.forEach((row, ri) => row.forEach((_, ci) => {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[ref]) ws[ref].s = styleFor(kinds[ri], ci);
    }));
    ws['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 22 : i === 1 ? 26 : (h === 'MD Cover' ? 40 : Math.max(12, h.length + 3)) }));
    ws['!rows'] = [{ hpt: 32 }];                 // header lebih tinggi (teks wrap)
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }) };

    // ---------- Sheet 2: Raw Data (semua visit sesuai filter) ----------
    const ctx = { bengkels, kotas, regions, mds: (accounts || []).filter(a => a.role === 'md'), accounts };
    const raw = fVisits.map(v => visitToCSVRow(v, ctx));
    const ws2 = XLSX.utils.json_to_sheet(raw.length ? raw : [{ info: 'Tidak ada visit pada filter ini' }], { cellDates: true });
    if (raw.length) {
      const cols = Object.keys(raw[0]);
      setColDateFormat(XLSX, ws2, 'tanggal', 'dd/mm/yyyy');
      setColDateFormat(XLSX, ws2, 'waktu_submit', 'dd/mm/yyyy hh:mm');
      setColDateFormat(XLSX, ws2, 'tanggal_cek', 'dd/mm/yyyy hh:mm');
      cols.forEach((_, ci) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: ci });
        if (ws2[ref]) ws2[ref].s = { font: { bold: true, color: { rgb: 'FFFFFFFF' } }, fill: { fgColor: { rgb: 'FF1F4E79' } }, alignment: { horizontal: 'center', wrapText: true }, border: borders };
      });
      ws2['!cols'] = cols.map(c => ({ wch: Math.min(38, Math.max(12, c.length + 4)) }));
      ws2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }) };
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan Coverage');
    XLSX.utils.book_append_sheet(wb, ws2, 'Raw Data');
    XLSX.writeFile(wb, `laporan_coverage_${month === 'all' ? 'semua' : month}.xlsx`);
  };

  const Th = ({ children, className = '' }) => (
    <th className={`px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold text-slate-300 whitespace-nowrap ${className}`}>{children}</th>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Laporan Coverage</h2>
          <p className="text-sm text-slate-500 mt-1">Realisasi vs jumlah bengkel terdata · {grand.visited} visit</p>
        </div>
        <Button variant="secondary" onClick={exportLaporan} disabled={grand.target === 0}>
          <Download className="w-4 h-4" />Export Excel
        </Button>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 grid grid-cols-2 md:grid-cols-3 gap-2">
        <Select value={level} onChange={e => setLevel(e.target.value)}>
          <option value="provinsi">Rincian per Provinsi</option>
          <option value="kota">Rincian per Kota</option>
        </Select>
        <Select value={month} onChange={e => setMonth(e.target.value)}>
          <option value="all">Semua Bulan</option>
          {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
      </div>
      <DateRangeRow className="mb-4 -mt-1" dari={dari} sampai={sampai} onDari={setDari} onSampai={setSampai}
        onReset={() => { setDari(''); setSampai(''); }} />

      {/* Filter kolom — klik untuk tampil/sembunyikan */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">Tampilkan Kolom</div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_COLS.map(c => (
            <button key={c.key} onClick={() => toggleCol(c.key)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
                show(c.key) ? 'bg-blue-600/15 border-blue-600/40 text-blue-200' : 'bg-slate-900 border-slate-800 text-slate-500 line-through'
              }`}>{c.label}</button>
          ))}
          {hiddenCols.length > 0 && (
            <button onClick={() => setHiddenCols([])} className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Tampilkan semua</button>
          )}
        </div>
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-blue-950/40 border-b border-slate-800">
              <tr>
                <Th className="text-left">Region (AA)</Th>
                <Th className="text-left">{level === 'kota' ? 'Kota (AA)' : 'Provinsi (AA)'}</Th>
                {visibleNumCols.map(c => <Th key={c.key} className="text-right" title={c.key}>{c.label}</Th>)}
                {show('mdcover') && <Th className="text-left">MD Cover</Th>}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <React.Fragment key={g.group}>
                  {g.items.map((r, i) => (
                    <tr key={r.key} className="border-b border-slate-800/60 hover:bg-slate-900/40">
                      <td className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-400 whitespace-nowrap">
                        {i === 0 ? g.group : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-xs text-slate-200 whitespace-nowrap">{r.name}</td>
                      {visibleNumCols.map(c => {
                        const n = c.get(r);
                        const color = c.raw ? 'text-slate-300' : (c.cat ? (n > 0 ? 'text-amber-300' : 'text-slate-600') : c.color);
                        return (
                          <td key={c.key} className={`px-2.5 py-1.5 text-xs text-right font-mono whitespace-nowrap ${color}`}>
                            {c.raw ? n : cell(n, r.target)}
                          </td>
                        );
                      })}
                      {show('mdcover') && (
                        <td className="px-2.5 py-1.5 text-[11px] text-slate-400 max-w-[260px]" title={mdNamesOf(r.regionId).join(', ')}>
                          {mdNamesOf(r.regionId).length
                            ? <span className="line-clamp-2">{mdNamesOf(r.regionId).join(', ')}</span>
                            : <span className="text-slate-600">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="bg-blue-900/25 border-b-2 border-slate-800 font-semibold">
                    <td className="px-2.5 py-1.5 text-[11px] text-blue-200 whitespace-nowrap">{g.group} TOTAL</td>
                    <td />
                    {visibleNumCols.map(c => (
                      <td key={c.key} className={`px-2.5 py-1.5 text-xs text-right font-mono whitespace-nowrap ${c.raw ? 'text-slate-100' : c.cat ? 'text-amber-200' : c.color}`}>
                        {c.raw ? c.get(g.sub) : cell(c.get(g.sub), g.sub.target)}
                      </td>
                    ))}
                    {show('mdcover') && (
                      <td className="px-2.5 py-1.5 text-[11px] text-blue-200 whitespace-nowrap" title={mdNamesOfGroup(g.group).join(', ')}>
                        {mdNamesOfGroup(g.group).length} MD
                      </td>
                    )}
                  </tr>
                </React.Fragment>
              ))}
              <tr className="bg-slate-800/60 font-bold">
                <td className="px-2.5 py-2 text-[11px] text-slate-100 whitespace-nowrap">GRAND TOTAL</td>
                <td />
                {visibleNumCols.map(c => (
                  <td key={c.key} className={`px-2.5 py-2 text-xs text-right font-mono whitespace-nowrap ${c.raw ? 'text-slate-100' : c.cat ? 'text-amber-200' : c.color}`}>
                    {c.raw ? c.get(grand) : cell(c.get(grand), grand.target)}
                  </td>
                ))}
                {show('mdcover') && (
                  <td className="px-2.5 py-2 text-[11px] text-slate-200 whitespace-nowrap">
                    {new Set(Object.values(mdByRegion).flat()).size} MD
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Persentase dihitung terhadap jumlah bengkel terdata (# Bengkel) di baris tersebut.</p>
    </div>
  );
}

function AdminView({ profile }) {
  const isSuperAdmin = profile?.role === 'super_admin';
  const [tab, setTab] = useState('dashboard');
  useTabBackButton(tab, setTab);
  const [visits, setVisits] = useState([]);
  const [mds, setMds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bengkels, setBengkels] = useState([]);
  const [regions, setRegions] = useState([]);
  const [kotas, setKotas] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailVisitId, setDetailVisitId] = useState(null);

  // silent=true → refresh data tanpa memunculkan layar Loading (cegah remount &
  // pindah section di Master Data setiap habis update).
  const loadAll = (silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([
      api.fetchVisits(), api.fetchAccounts(), api.fetchBengkels(),
      api.fetchRegions(), api.fetchKotas(), api.fetchDistributors(),
    ]).then(([v, acc, b, r, k, d]) => {
      setVisits(v); setAccounts(acc); setMds(acc.filter(a => a.role === 'md'));
      setBengkels(b); setRegions(r); setKotas(k); setDistributors(d);
      setLoading(false);
    }).catch(err => { console.error(err); setLoading(false); });
  };

  useEffect(() => { loadAll(); }, []);

  if (loading) return <Loading />;

  // Scoping region untuk TL (read-only). Di produksi RLS sudah menyaring; ini untuk mock + konsistensi UI.
  const isTL = profile?.role === 'tl';
  // Region yang dicover TL (bisa >1). Ambil dari akun TL sendiri: region_ids
  // (dari tl_regions) dgn fallback region_id lama. Non-TL → tak ada scoping.
  const selfAcc = accounts.find(a => a.id === profile?.id);
  const tlRegionSet = isTL
    ? new Set(selfAcc?.region_ids?.length ? selfAcc.region_ids : (profile?.region_id ? [profile.region_id] : []))
    : null;
  const inTlScope = (rid) => !isTL || (rid != null && tlRegionSet.has(rid));
  const sMds = isTL ? mds.filter(m => inTlScope(m.region_id)) : mds;        // semua MD (termasuk nonaktif) → utk kelola akun
  const activeMds = sMds.filter(m => m.active !== false);                   // hanya MD aktif → data di tab
  const visibleMdIds = new Set(activeMds.map(m => m.id));
  const allowedMdIds = visibleMdIds;                                        // absen: tampil hanya MD aktif (+scope TL)
  const sVisits = visits.filter(v => visibleMdIds.has(v.md_id));            // visit hanya dari MD aktif (+scope TL)
  // Daftar akun: super_admin lihat semua; admin/bp hanya MD; TL hanya MD region-nya.
  const sAccounts = isSuperAdmin ? accounts : accounts.filter(a => a.role === 'md' && inTlScope(a.region_id));
  const canManageMaster = !isTL;
  // Role bp = admin viewer: semua tab KECUALI Master Data
  const showMaster = profile?.role !== 'bp';

  const openDetail = (id) => setDetailVisitId(id);
  const detailVisit = detailVisitId ? sVisits.find(v => v.id === detailVisitId) : null;
  const detailBengkel = detailVisit ? bengkels.find(b => b.id === detailVisit.bengkel_id) : null;
  const detailKota = detailBengkel ? kotas.find(k => k.id === detailBengkel.kota_id) : null;
  const detailDistributor = detailVisit ? distributors.find(d => d.id === detailVisit.distributor_id) : null;
  const detailMD = detailVisit ? sMds.find(m => m.id === detailVisit.md_id) : null;

  return (
    <div className="max-w-[1800px] mx-auto">
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 border border-slate-800 rounded-xl mb-5 sm:flex">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'laporan', label: 'Laporan', icon: Target },
          { id: 'visits', label: 'Visits', icon: ClipboardList },
          { id: 'absen', label: 'Absen', icon: CalendarDays },
          { id: 'coverage', label: 'Coverage Map', icon: MapIcon },
          { id: 'master', label: 'Master Data', icon: Database },
        ].filter(t => t.id !== 'master' || showMaster).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-lg text-[11px] font-medium transition sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm whitespace-nowrap ${tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <t.icon className="w-4 h-4 shrink-0" /><span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab visits={sVisits} mds={activeMds} onOpenVisit={openDetail} bengkels={bengkels} kotas={kotas} distributors={distributors} regions={regions} accounts={accounts} />}
      {tab === 'laporan' && <LaporanTab visits={sVisits} bengkels={bengkels} kotas={kotas} regions={regions} accounts={accounts} />}
      {tab === 'visits' && <VisitsTab visits={sVisits} mds={activeMds} bengkels={bengkels} kotas={kotas} distributors={distributors} regions={regions} onOpenVisit={openDetail} accounts={accounts} />}
      {tab === 'absen' && <AdminAbsenTab mds={activeMds} allowedMdIds={allowedMdIds} isSuperAdmin={isSuperAdmin} regions={regions} />}
      {tab === 'coverage' &&<CoverageTab visits={sVisits} mds={activeMds} bengkels={bengkels} kotas={kotas} regions={regions} distributors={distributors} onOpenVisit={openDetail} />}
      {tab === 'master' && showMaster && <MasterTab regions={regions} kotas={kotas} distributors={distributors} bengkels={bengkels} mds={sMds} accounts={sAccounts} onChange={() => loadAll(true)} isSuperAdmin={isSuperAdmin} canManageMaster={canManageMaster} />}

      {detailVisit && (
        <VisitDetailModal
          visit={detailVisit}
          bengkel={detailBengkel}
          kota={detailKota}
          distributor={detailDistributor}
          md={detailMD}
          onClose={() => setDetailVisitId(null)}
          onDeleted={isSuperAdmin ? () => { setDetailVisitId(null); loadAll(); } : undefined}
          canEdit={isSuperAdmin}
          canCheck={!isTL}
          checkerId={profile?.id}
          onUpdated={() => loadAll(true)}
          bengkels={bengkels}
          distributors={distributors}
        />
      )}
    </div>
  );
}

// ============================================================
// VISITS TAB — list dengan filter & sort, klik buka detail
// ============================================================

// Badge on-site: hitung jarak visit_lat/lng ↔ koordinat bengkel (dari data yang ada)
function OnSiteBadge({ bengkel, visit }) {
  if (visit.visit_lat == null || visit.visit_lng == null || bengkel?.lat == null || bengkel?.lng == null) return null;
  const d = haversineMeters(bengkel.lat, bengkel.lng, visit.visit_lat, visit.visit_lng);
  if (d < 100) return <span className="text-[10px] text-emerald-400 flex items-center gap-0.5" title={`${formatDistance(d)} dari bengkel`}><MapPin className="w-2.5 h-2.5" />on-site</span>;
  if (d > 500) return <span className="text-[10px] text-rose-400 flex items-center gap-0.5" title={`${formatDistance(d)} dari bengkel`}><AlertCircle className="w-2.5 h-2.5" />{formatDistance(d)}</span>;
  return null; // 100–500m: netral, tidak ditampilkan agar tidak ramai
}

// Badge status pengecekan admin — dipakai di daftar visit (admin) & history MD.
function CheckBadge({ visit }) {
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

function VisitsTab({ visits, mds, bengkels, kotas, distributors, regions, onOpenVisit, accounts = [] }) {
  const [filters, setFilters] = useState({
    search: '',
    mdId: 'all',
    regionId: 'all',
    distributorId: 'all',
    status: 'all',
    check: 'all',
    month: 'all',
    dari: '',
    sampai: '',
  });
  // Batasi jumlah baris yang di-render (hindari ribuan node DOM = freeze di HP)
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => { setVisibleCount(50); }, [filters]);

  // Index Map (O(1)) — hindari .find per-visit (O(n*m)) yang bikin HP freeze
  // saat visit/bengkel banyak.
  const bengkelById = useMemo(() => new Map(bengkels.map(b => [b.id, b])), [bengkels]);
  const kotaById = useMemo(() => new Map(kotas.map(k => [k.id, k])), [kotas]);
  const regionById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);
  const mdById = useMemo(() => new Map(mds.map(m => [m.id, m])), [mds]);
  const findBengkel = (id) => bengkelById.get(id);
  const findKota = (id) => kotaById.get(id);
  const findRegion = (id) => regionById.get(id);
  const findMD = (id) => mdById.get(id);

  // Build filtered list
  const filtered = useMemo(() => {
    return visits.filter(v => {
      const b = findBengkel(v.bengkel_id);
      const k = b ? findKota(b.kota_id) : null;
      const md = findMD(v.md_id);

      if (filters.mdId !== 'all' && v.md_id !== filters.mdId) return false;
      if (filters.regionId !== 'all' && k?.region_id !== filters.regionId) return false;
      if (filters.distributorId !== 'all' && v.distributor_id !== filters.distributorId) return false;
      if (filters.status !== 'all' && v.status !== filters.status) return false;
      if (filters.check === 'belum' && v.check_status) return false;
      if (filters.check !== 'all' && filters.check !== 'belum' && v.check_status !== filters.check) return false;
      if (filters.month !== 'all' && !v.visit_date.startsWith(filters.month)) return false;
      if (filters.dari && v.visit_date < filters.dari) return false;
      if (filters.sampai && v.visit_date > filters.sampai) return false;

      if (filters.search.trim()) {
        const q = filters.search.toLowerCase();
        const haystack = `${b?.code || ''} ${b?.name || v.bengkel_name || ''} ${md?.full_name || v.md_name || ''} ${v.status || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.visit_date.localeCompare(a.visit_date) || (b.created_at || '').localeCompare(a.created_at || ''));
  }, [visits, filters, bengkels, kotas, mds]);

  const availableMonths = useMemo(() => {
    const set = new Set(visits.map(v => v.visit_date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [visits]);

  const handleExport = async () => {
    const ctx = { bengkels, kotas, regions, distributors, mds, accounts };
    await exportVisitsXlsx(filtered, ctx, `visits_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Daftar Visit</h2>
          <p className="text-sm text-slate-500 mt-1">{filtered.length} dari {visits.length} visit · klik untuk lihat detail</p>
        </div>
        <Button variant="secondary" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4" />Export Excel ({filtered.length})
        </Button>
      </div>

      {/* Filter bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="col-span-2 md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })}
            placeholder="Cari kode/nama bengkel, MD, PIC…"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
        </div>
        <Select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
          <option value="all">Semua Bulan</option>
          {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Select value={filters.mdId} onChange={e => setFilters({ ...filters, mdId: e.target.value })}>
          <option value="all">Semua MD</option>
          {mds.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
        <Select value={filters.regionId} onChange={e => setFilters({ ...filters, regionId: e.target.value })}>
          <option value="all">Semua Provinsi</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={filters.distributorId} onChange={e => setFilters({ ...filters, distributorId: e.target.value })}>
          <option value="all">Semua Distributor</option>
          {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="all">Semua Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={filters.check} onChange={e => setFilters({ ...filters, check: e.target.value })}>
          <option value="all">Semua Pengecekan</option>
          <option value="belum">Belum Dicek</option>
          <option value="Sesuai">Sudah Dicek · Sesuai</option>
          <option value="Tidak Sesuai">Sudah Dicek · Tidak Sesuai</option>
        </Select>
      </div>

      {/* Filter rentang tanggal custom */}
      <DateRangeRow className="mb-4 -mt-1"
        dari={filters.dari} sampai={filters.sampai}
        onDari={v => setFilters({ ...filters, dari: v })}
        onSampai={v => setFilters({ ...filters, sampai: v })}
        onReset={() => setFilters({ ...filters, dari: '', sampai: '' })} />

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm bg-slate-900/30 border border-slate-800 rounded-xl">
          Tidak ada visit yang sesuai filter.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.slice(0, visibleCount).map(v => {
            const b = findBengkel(v.bengkel_id);
            const k = b ? findKota(b.kota_id) : null;
            const r = k ? findRegion(k.region_id) : null;
            const md = findMD(v.md_id);
            const photoCount = PHOTO_KEYS.filter(key => v[key]).length;
            return (
              <button key={v.id} onClick={() => onOpenVisit(v.id)}
                className="w-full text-left bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-2 transition group flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono shrink-0">{b?.code || '—'}</span>
                    <span className="text-sm font-semibold text-slate-100 truncate">{b?.name || v.bengkel_name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5 truncate">
                    <Calendar className="w-3 h-3 shrink-0" /><span>{v.visit_date}{v.created_at ? ` · ${fmtAbsenTime(v.created_at)}` : ''}</span>
                    <span className="text-slate-700">·</span>
                    <User className="w-3 h-3 shrink-0" /><span className="truncate">{md?.full_name || v.md_name || '—'}</span>
                    <span className="text-slate-700 hidden sm:inline">·</span>
                    <MapPin className="w-3 h-3 shrink-0 hidden sm:inline" /><span className="truncate hidden sm:inline">{k?.name || '—'}</span>
                    <span className="text-slate-700">·</span>
                    <Camera className="w-3 h-3 shrink-0" /><span className="shrink-0">{photoCount}/{PHOTO_KEYS.length}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={v.status} />
                  <div className="flex items-center gap-1">
                    <CheckBadge visit={v} />
                    <OnSiteBadge bengkel={b} visit={v} />
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-300 transition shrink-0" />
              </button>
            );
          })}
          {filtered.length > visibleCount && (
            <button onClick={() => setVisibleCount(c => c + 100)}
              className="w-full mt-2 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-sm text-slate-300 transition">
              Tampilkan lebih banyak · {filtered.length - visibleCount} lagi (dari {filtered.length})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DashboardTab({ visits, mds, bengkels, kotas, regions, distributors, onOpenVisit, accounts = [] }) {
  const [filters, setFilters] = useState({ month: 'all', mdId: 'all', regionId: 'all', distributorId: 'all', dari: '', sampai: '' });

  const availableMonths = useMemo(() => {
    const set = new Set(visits.map(v => v.visit_date.slice(0, 7)));
    const arr = [...set].sort().reverse();
    return arr.length ? arr : [new Date().toISOString().slice(0, 7)];
  }, [visits]);

  // Default month ke yang terbaru
  useEffect(() => {
    if (filters.month === 'all' && availableMonths.length > 0) {
      setFilters(f => ({ ...f, month: availableMonths[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableMonths.join(',')]);

  // Index Map (O(1)) — hindari .find per-visit (O(n*m)) yang bikin HP freeze.
  const bengkelById = useMemo(() => new Map(bengkels.map(b => [b.id, b])), [bengkels]);
  const kotaById = useMemo(() => new Map(kotas.map(k => [k.id, k])), [kotas]);

  // Apply filters
  const filteredVisits = useMemo(() => {
    const needRegion = filters.regionId !== 'all';
    return visits.filter(v => {
      if (filters.dari || filters.sampai) {
        if (filters.dari && v.visit_date < filters.dari) return false;
        if (filters.sampai && v.visit_date > filters.sampai) return false;
      } else if (filters.month !== 'all' && !v.visit_date.startsWith(filters.month)) return false;
      if (filters.mdId !== 'all' && v.md_id !== filters.mdId) return false;
      if (needRegion) {
        const b = bengkelById.get(v.bengkel_id);
        const k = b ? kotaById.get(b.kota_id) : null;
        if (k?.region_id !== filters.regionId) return false;
      }
      if (filters.distributorId !== 'all' && v.distributor_id !== filters.distributorId) return false;
      return true;
    });
  }, [visits, filters, bengkelById, kotaById]);

  // MDs yang relevan dengan filter (region/distributor)
  const relevantMDs = useMemo(() => {
    if (filters.regionId === 'all') return mds;
    return mds.filter(m => m.region_id === filters.regionId);
  }, [mds, filters.regionId]);

  // Nama depan yang tak unik (mis. 2 "Muhammad") → tambah kata berikutnya
  // agar di chart/ranking tidak terlihat seperti duplikat.
  const regionName = (id) => regions.find(r => r.id === id)?.name || '';
  // Agregasi per REGION (bukan per MD — 99 MD tak terbaca di grafik).
  // Region sebuah visit dilihat dari bengkel -> kota -> region.
  const kotaRegion = useMemo(() => Object.fromEntries(kotas.map(k => [k.id, k.region_id])), [kotas]);
  const bengkelRegion = useMemo(() => Object.fromEntries(bengkels.map(b => [b.id, kotaRegion[b.kota_id]])), [bengkels, kotaRegion]);
  const chartData = useMemo(() => {
    const byRegion = {};
    filteredVisits.forEach(v => {
      const rid = bengkelRegion[v.bengkel_id];
      if (!rid) return;
      const o = (byRegion[rid] ||= { Actual: 0, terpasang: 0 });
      o.Actual++;
      if (v.status === HASIL_TERPASANG) o.terpasang++;
    });
    // Target = jumlah bengkel terdata (database) per provinsi
    const dbCount = {};
    bengkels.forEach(b => {
      const rid = kotaRegion[b.kota_id];
      if (rid) dbCount[rid] = (dbCount[rid] || 0) + 1;
    });
    return regions
      .map(r => ({
        id: r.id, name: r.name, region: r.name, group: groupOfRegion(r),
        Actual: byRegion[r.id]?.Actual || 0, terpasang: byRegion[r.id]?.terpasang || 0,
        Target: dbCount[r.id] || 0,
      }))
      .sort((a, b) => (b.Actual - a.Actual) || a.name.localeCompare(b.name));
  }, [filteredVisits, regions, bengkels, kotaRegion, bengkelRegion]);
  // Agregasi level REGION (7 grup besar) untuk grafik
  const groupChartData = useMemo(() => {
    const byGroup = {};
    chartData.forEach(p => {
      const o = (byGroup[p.group] ||= { name: p.group, region: p.group, Actual: 0, terpasang: 0, Target: 0 });
      o.Actual += p.Actual; o.terpasang += p.terpasang; o.Target += p.Target;
    });
    return Object.values(byGroup).sort((a, b) => (b.Actual - a.Actual) || a.name.localeCompare(b.name));
  }, [chartData]);

  const totalVisits = filteredVisits.length;
  // Hitung per kategori hasil visit
  const countStatus = (s) => filteredVisits.filter(v => v.status === s).length;
  // MD yang benar-benar ada visit di filter ini (bukan sekadar jumlah MD terdaftar)
  const activeMdCount = new Set(filteredVisits.map(v => v.md_id)).size;

  // Label sumbu-X: nama region (miring biar muat)
  const renderMdTick = ({ x, y, payload }) => (
    <g transform={`translate(${x},${y}) rotate(-40)`}>
      <text x={0} y={0} dy={4} textAnchor="end" fill="#ffffff" fontSize={10} fontWeight={600}>{payload.value}</text>
    </g>
  );

  // Warna batang per region (7 grup)
  const REGION_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#f87171'];
  const regionNames = [...new Set(chartData.map(d => d.group).filter(Boolean))].sort();
  const regionColor = Object.fromEntries(regionNames.map((n, i) => [n, REGION_COLORS[i % REGION_COLORS.length]]));
  const colorForRegion = (r) => regionColor[r] || '#71717a';

  const handleExport = async () => {
    const ctx = { bengkels, kotas, regions, distributors, mds, accounts };
    const fname = `visits_${filters.month}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await exportVisitsXlsx(filteredVisits, ctx, fname);
  };

  // Recent 5 visits dari filter
  const recentVisits = useMemo(() => [...filteredVisits]
    .sort((a, b) => (b.created_at || b.visit_date).localeCompare(a.created_at || a.visit_date))
    .slice(0, 5), [filteredVisits]);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1">Performa tracking POSM · {filteredVisits.length} visit ter-filter</p>
        </div>
        <Button variant="secondary" onClick={handleExport} disabled={filteredVisits.length === 0}>
          <Download className="w-4 h-4" />Export Excel ({filteredVisits.length})
        </Button>
      </div>

      {/* Filter bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-5 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
          <option value="all">Semua Bulan</option>
          {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Select value={filters.mdId} onChange={e => setFilters({ ...filters, mdId: e.target.value })}>
          <option value="all">Semua MD</option>
          {mds.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
        <Select value={filters.regionId} onChange={e => setFilters({ ...filters, regionId: e.target.value })}>
          <option value="all">Semua Provinsi</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={filters.distributorId} onChange={e => setFilters({ ...filters, distributorId: e.target.value })}>
          <option value="all">Semua Distributor</option>
          {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </div>

      <DateRangeRow className="mb-5 -mt-1"
        dari={filters.dari} sampai={filters.sampai}
        onDari={v => setFilters({ ...filters, dari: v })} onSampai={v => setFilters({ ...filters, sampai: v })}
        onReset={() => setFilters({ ...filters, dari: '', sampai: '' })} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total Visit', value: totalVisits, sub: 'kunjungan tercatat', icon: Activity, color: 'red' },
          { label: 'Spanduk Terpasang', value: countStatus(HASIL_TERPASANG), sub: 'berhasil terpasang', icon: Check, color: 'emerald' },
          { label: 'Alamat Tidak Ditemukan', value: countStatus('Alamat bengkel tidak ditemukan'), sub: 'bengkel tak ketemu', icon: MapPin, color: 'amber' },
          { label: 'Ditolak', value: countStatus('Ditolak'), sub: 'pemasangan ditolak', icon: X, color: 'rose' },
          { label: 'Bukan Bengkel', value: countStatus('Bukan bengkel'), sub: 'data tidak sesuai', icon: Building2, color: 'blue' },
          { label: 'Owner/PIC Tidak di Tempat', value: countStatus('Owner/PIC tidak di tempat'), sub: 'belum diizinkan', icon: User, color: 'sky' },
          { label: 'Tidak Jual Oli Federal', value: countStatus('Tidak jual oli Federal'), sub: 'bukan penjual Federal', icon: AlertCircle, color: 'red' },
          { label: 'MD Aktif', value: activeMdCount, sub: `dari ${relevantMDs.length} MD · ada visit`, icon: Users, color: 'amber' },
        ].map((k, i) => (
          <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">{k.label}</span>
              <k.icon className={`w-4 h-4 ${KPI_ICON_COLOR[k.color] || 'text-slate-400'}`} />
            </div>
            <div className="text-2xl font-bold text-slate-100 mb-0.5">{k.value}</div>
            <div className="text-xs text-slate-500">{k.sub}</div>
          </div>
        ))}
      </div>

      <Section title="Visit per Region" subtitle={`Jumlah visit — ${filters.month === 'all' ? 'semua bulan' : monthLabel(filters.month)}`} icon={Activity}>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            {/* SATU sumbu Y untuk kedua batang — kalau dipisah, target 1994 & visit 1
                tampak sama tinggi (menyesatkan). Skala sama = perbandingan jujur. */}
            <ComposedChart data={groupChartData} margin={{ top: 28, right: 16, bottom: 10, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" stroke="#71717a" interval={0} height={80} tick={renderMdTick} />
              <YAxis stroke="#71717a" tick={{ fontSize: 11 }} width={56} />
              <Tooltip contentStyle={{ background: '#09090b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '12px' }} labelStyle={{ color: '#e4e4e7' }} itemStyle={{ color: '#e4e4e7' }} cursor={{ fill: 'rgba(239,68,68,0.05)' }} />
              {/* Batang Target (kiri, biru) berdampingan dengan batang Visit (kanan, hijau) */}
              <Bar dataKey="Target" name="Target" fill="#2563eb" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="Target" position="top" fill="#93c5fd" fontSize={10} fontWeight={600} />
              </Bar>
              <Bar dataKey="Actual" name="Visit" radius={[4, 4, 0, 0]} minPointSize={2}>
                {groupChartData.map((d, i) => <Cell key={i} fill={colorForRegion(d.region)} />)}
                <LabelList dataKey="Actual" position="top" fill="#ffffff" fontSize={10} fontWeight={600} />
              </Bar>
              {/* Seri tak terlihat — hanya supaya angka Terpasang ikut muncul di tooltip */}
              <Line dataKey="terpasang" name="Berhasil Terpasang" stroke="#10b981" strokeOpacity={0} dot={false} activeDot={false} legendType="none" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1.5 mt-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600" />Target (jumlah bengkel terdata)</span>
          <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />Visit tercatat</span>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Rincian per Provinsi (visit / target database)</div>
          {chartData.map((r, i) => {
            const pct = r.Target > 0 ? Math.round((r.Actual / r.Target) * 100) : 0;
            return (
              <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="w-6 h-6 rounded-full bg-slate-800/50 flex items-center justify-center text-[10px] font-mono text-slate-400">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate">{r.name}
                    <span className="ml-2 text-[10px] font-normal text-slate-500">· {r.group}</span>
                  </div>
                  <div className="h-1 bg-slate-800/50 rounded-full mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-100">{r.Actual}<span className="text-slate-500">/{r.Target}</span></div>
                  <div className="text-[10px] text-slate-500">{pct}% · <span className="text-emerald-400">{r.terpasang} terpasang</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Recent visits — quick link ke detail */}
      {recentVisits.length > 0 && (
        <Section title="Visit Terbaru" subtitle="Klik untuk lihat detail · 5 terbaru sesuai filter" icon={ClipboardList}>
          <div className="space-y-1.5">
            {recentVisits.map(v => {
              const b = bengkels.find(x => x.id === v.bengkel_id);
              const md = mds.find(m => m.id === v.md_id);
              const photoCount = PHOTO_KEYS.filter(key => v[key]).length;
              return (
                <button key={v.id} onClick={() => onOpenVisit?.(v.id)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition group">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{b?.code || '—'} · {v.visit_date}</div>
                    <div className="text-sm font-semibold text-slate-100 truncate">{b?.name || v.bengkel_name || '—'}</div>
                    <div className="text-xs text-slate-500 truncate">{md?.full_name || v.md_name || '—'} · {photoCount}/{PHOTO_KEYS.length} foto</div>
                  </div>
                  <StatusBadge status={v.status} />
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-blue-300 transition" />
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

const MD_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];

// Fit map ke semua titik visit
function FitToVisits({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo(points[0], 13, { duration: 0.6 });
    } else {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [JSON.stringify(points), map]);
  return null;
}

// Icon marker lokasi bengkel — kotak abu-abu, dibedakan dari titik visit (bulat warna MD)
const BENGKEL_ICON = L.divIcon({
  className: 'coverage-bengkel',
  html: `<div style="width:11px;height:11px;border-radius:50%;background:#0a0a0a;border:1.5px solid #f4f4f5;opacity:0.95;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>`,
  iconSize: [11, 11],
  iconAnchor: [5.5, 5.5],
});
const BENGKEL_CAP = 2000; // batas render biar peta tak freeze

function CoverageTab({ visits, mds, bengkels, kotas, regions, distributors, onOpenVisit }) {
  const [filters, setFilters] = useState({ mdId: 'all', regionId: 'all', group: 'all', distributorId: 'all', month: 'all', dari: '', sampai: '' });
  const [showBengkels, setShowBengkels] = useState(false);
  const regionById = useMemo(() => new Map(regions.map(r => [r.id, r])), [regions]);

  // Index Map (O(1)) — hindari .find per-visit (O(n*m)) yang bikin HP freeze.
  const bengkelById = useMemo(() => new Map(bengkels.map(b => [b.id, b])), [bengkels]);
  const kotaById = useMemo(() => new Map(kotas.map(k => [k.id, k])), [kotas]);

  // Enrich visits with bengkel lat/lng if not stored on visit
  const enriched = useMemo(() => visits.map(v => {
    const b = bengkelById.get(v.bengkel_id);
    return {
      ...v,
      visit_lat: v.visit_lat ?? b?.lat,
      visit_lng: v.visit_lng ?? b?.lng,
      _bengkel: b,
      _kota: b ? kotaById.get(b.kota_id) : null,
    };
  }), [visits, bengkelById, kotaById]);

  const filtered = useMemo(() => enriched.filter(v => {
    if (!v.visit_lat || !v.visit_lng) return false;
    if (filters.dari || filters.sampai) {
      if (filters.dari && v.visit_date < filters.dari) return false;
      if (filters.sampai && v.visit_date > filters.sampai) return false;
    } else if (filters.month !== 'all' && !v.visit_date.startsWith(filters.month)) return false;
    if (filters.mdId !== 'all' && v.md_id !== filters.mdId) return false;
    if (filters.regionId !== 'all' && v._kota?.region_id !== filters.regionId) return false;
    if (filters.group !== 'all' && groupOfRegion(regionById.get(v._kota?.region_id)) !== filters.group) return false;
    if (filters.distributorId !== 'all' && v.distributor_id !== filters.distributorId) return false;
    return true;
  }), [enriched, filters, regionById]);

  const availableMonths = useMemo(() => {
    const set = new Set(visits.map(v => v.visit_date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [visits]);

  const points = filtered.map(v => [v.visit_lat, v.visit_lng]);

  // Group visits by location (round to 5 decimal ≈ 1m) untuk deteksi visit di titik sama
  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach(v => {
      const key = `${v.visit_lat.toFixed(5)},${v.visit_lng.toFixed(5)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    });
    return [...map.values()];
  }, [filtered]);

  // Lokasi bengkel dari DB (kolom lat/lng). Respect filter Region. Cap biar tak freeze.
  const bengkelMarkers = useMemo(() => {
    if (!showBengkels) return [];
    let list = bengkels.filter(b => b.lat != null && b.lng != null);
    if (filters.regionId !== 'all') list = list.filter(b => kotaById.get(b.kota_id)?.region_id === filters.regionId);
    return list;
  }, [showBengkels, bengkels, filters.regionId, kotaById]);
  const bengkelShown = bengkelMarkers.slice(0, BENGKEL_CAP);

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Coverage Map</h2>
          <p className="text-sm text-slate-500 mt-1">
            {filtered.length} titik visit di {grouped.length} lokasi unik
            {showBengkels && <> · <span className="text-sky-400">{bengkelMarkers.length} lokasi bengkel</span>{bengkelMarkers.length > BENGKEL_CAP && ` (tampil ${BENGKEL_CAP}, filter Region untuk lihat semua)`}</>}
          </p>
        </div>
        <button type="button" onClick={() => setShowBengkels(v => !v)}
          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition ${showBengkels ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-slate-800 hover:border-slate-700 text-slate-300'}`}>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: showBengkels ? '#0a0a0a' : 'transparent', border: '1.5px solid #f4f4f5' }} />
          {showBengkels ? 'Sembunyikan lokasi bengkel' : 'Tampilkan lokasi bengkel'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Select value={filters.month} onChange={e => setFilters({ ...filters, month: e.target.value })}>
          <option value="all">Semua Bulan</option>
          {availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </Select>
        <Select value={filters.mdId} onChange={e => setFilters({ ...filters, mdId: e.target.value })}>
          <option value="all">Semua MD</option>
          {mds.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
        </Select>
        <Select value={filters.regionId} onChange={e => setFilters({ ...filters, regionId: e.target.value })}>
          <option value="all">Semua Provinsi</option>
          {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select value={filters.distributorId} onChange={e => setFilters({ ...filters, distributorId: e.target.value })}>
          <option value="all">Semua Distributor</option>
          {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </div>

      <DateRangeRow className="mb-4 -mt-1"
        dari={filters.dari} sampai={filters.sampai}
        onDari={v => setFilters({ ...filters, dari: v })} onSampai={v => setFilters({ ...filters, sampai: v })}
        onReset={() => setFilters({ ...filters, dari: '', sampai: '' })} />

      <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="relative">
          {filtered.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center text-slate-500 gap-2 text-sm">
              <MapPin className="w-6 h-6" />
              Tidak ada visit dengan koordinat sesuai filter
            </div>
          ) : (
            <MapContainer
              center={points[0]}
              zoom={11}
              scrollWheelZoom={true}
              style={{ height: '480px', width: '100%' }}
            >
              <TileLayer
                attribution={TILE_ATTR}
                url={TILE_URL}
                subdomains="abcd"
                maxZoom={19}
              />
              {grouped.map((vs, gi) => {
                const [lat, lng] = [vs[0].visit_lat, vs[0].visit_lng];
                const isStacked = vs.length > 1;
                // Pick color dari first visit di stack
                const mdIdx = mds.findIndex(m => m.id === vs[0].md_id);
                const color = MD_COLORS[mdIdx % MD_COLORS.length] || '#2563eb';

                const icon = isStacked
                  ? L.divIcon({
                      className: 'coverage-cluster',
                      html: `<div style="background:${color};color:#0a0a0a;font-weight:bold;font-size:11px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #0a0a0a;box-shadow:0 0 10px rgba(0,0,0,0.5);">${vs.length}</div>`,
                      iconSize: [28, 28],
                      iconAnchor: [14, 14],
                    })
                  : L.divIcon({
                      className: 'coverage-pin',
                      html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #0a0a0a;box-shadow:0 0 8px ${color}80;"></div>`,
                      iconSize: [14, 14],
                      iconAnchor: [7, 7],
                    });

                return (
                  <Marker key={gi} position={[lat, lng]} icon={icon}>
                    <Popup maxWidth={280}>
                      <div className="text-xs space-y-1 max-h-48 overflow-y-auto">
                        <div className="font-semibold text-slate-100 text-sm mb-2">{vs.length} visit di titik ini</div>
                        {vs.slice(0, 5).map(v => (
                          <button key={v.id} onClick={() => onOpenVisit?.(v.id)}
                            className="block w-full text-left p-2 rounded bg-slate-800/50 hover:bg-slate-700 transition">
                            <div className="font-mono text-[9px] text-slate-500">{v._bengkel?.code} · {v.visit_date}</div>
                            <div className="text-xs text-slate-100 truncate">{v._bengkel?.name}</div>
                            <div className="text-[10px] text-slate-400">{v.md_name || mds.find(m => m.id === v.md_id)?.full_name} · {v.status}</div>
                          </button>
                        ))}
                        {vs.length > 5 && <div className="text-[10px] text-slate-500 text-center pt-1">+{vs.length - 5} lagi</div>}
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
              {bengkelShown.map(b => (
                <Marker key={'bengkel-' + b.id} position={[b.lat, b.lng]} icon={BENGKEL_ICON}>
                  <Popup maxWidth={240}>
                    <div className="text-xs space-y-0.5">
                      <div className="font-mono text-[9px] text-slate-500">{b.code}</div>
                      <div className="text-xs text-slate-100">{b.name}</div>
                      <div className="text-[10px] text-sky-500 mt-1">Lokasi bengkel · {b.lat.toFixed(5)}, {b.lng.toFixed(5)}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
              <FitToVisits points={points} />
            </MapContainer>
          )}
        </div>

        {/* Legend per Region (7 grup) — klik untuk filter provinsi-provinsi di region itu */}
        <div className="border-t border-slate-800 p-4 flex flex-wrap gap-3">
          {(() => {
            const MD_COLORS_R = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee'];
            const groups = [...new Set(regions.map(groupOfRegion))].sort();
            return groups.map((g, i) => {
              const count = enriched.filter(v => v.visit_lat && v.visit_lng && groupOfRegion(regionById.get(v._kota?.region_id)) === g).length;
              const active = filters.group === g;
              return (
                <button key={g}
                  onClick={() => setFilters(f => ({ ...f, group: active ? 'all' : g }))}
                  className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg transition border ${
                    active ? 'border-blue-600/40 bg-blue-600/10' : 'border-slate-800 hover:border-slate-700'
                  }`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: MD_COLORS_R[i % MD_COLORS_R.length] }} />
                  <span className="text-slate-300">{g}</span>
                  <span className="text-slate-500 font-mono">{count}</span>
                </button>
              );
            });
          })()}
        </div>
      </div>
    </div>
  );
}

// Sub-form Bengkel: add atau edit (kalau `initial` di-pass)
// Distributor TIDAK di sini — dicatat per-visit (1 bengkel bisa dicover banyak distributor)
function BengkelForm({ kotas, regions, bengkels = [], onSave, initial, onCancel }) {
  const isEdit = !!initial;
  // Region cuma untuk memfilter dropdown Kota (TIDAK disimpan ke bengkel — diturunkan dari kota)
  const initialRegionId = initial?.kota_id
    ? (kotas.find(k => k.id === initial.kota_id)?.region_id || '')
    : '';
  const [form, setForm] = useState({
    region_id: initialRegionId,
    code: initial?.code || '',
    name: initial?.name || '',
    kota_id: initial?.kota_id || '',
    address: initial?.address || '',
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
  });
  const [saving, setSaving] = useState(false);

  const filteredKotas = kotas.filter(k => k.region_id === form.region_id);
  // Cek kode yang sudah dipakai bengkel lain — INFO saja (boleh sama, mis. beberapa cabang)
  const codeNorm = form.code.trim().toUpperCase();
  const dupNames = codeNorm ? bengkels.filter(b => (b.code || '').toUpperCase() === codeNorm && b.id !== initial?.id).map(b => b.name) : [];
  const dupCode = dupNames.length > 0;
  const canSave = form.code.trim() && form.name.trim() && form.kota_id && !saving;  // lat/lng opsional

  const handlePick = (lat, lng) => setForm(f => ({ ...f, lat, lng }));

  // Kota disimpan di dalam field name (konvensi data lama: "Nama - Kota").
  // Bengkel baru: auto-tambah " - {Kota}" ke nama; guard agar tak dobel kalau sudah diketik.
  const kotaNameSel = kotas.find(k => k.id === form.kota_id)?.name || '';
  const composedName = (() => {
    const base = form.name.trim();
    if (isEdit || !kotaNameSel || !base) return base;
    const suffix = ` - ${kotaNameSel}`;
    return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : base + suffix;
  })();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        code: form.code.trim().toUpperCase(),
        name: composedName,
        kota_id: form.kota_id,
        address: form.address.trim() || null,
        lat: form.lat,
        lng: form.lng,
      });
      if (!isEdit) {
        // reset form (pertahankan region biar gampang input banyak bengkel di region sama)
        setForm(f => ({ region_id: f.region_id, code: '', name: '', kota_id: '', address: '', lat: null, lng: null }));
      }
    } catch (err) {
      alert('Gagal simpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`mb-5 p-4 bg-slate-950 border rounded-xl ${isEdit ? 'border-amber-600/40' : 'border-slate-800'}`}>
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {isEdit ? <>
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-amber-300">Edit Bengkel · {initial.code}</span>
          </> : <>
            <Plus className="w-3.5 h-3.5" />Tambah Bengkel Baru
          </>}
        </span>
        {onCancel && (
          <button onClick={onCancel} className="text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-100 border border-slate-700 hover:border-rose-600 transition shrink-0">
            <X className="w-3 h-3" />Batal
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Kode" required>
          <Input placeholder="BK006" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
            className={dupCode ? 'border-amber-600/50' : ''} />
          {dupCode && <p className="text-[11px] text-amber-400 mt-1 flex items-start gap-1"><AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />Kode "{codeNorm}" juga dipakai: {dupNames.join(', ')}. Abaikan kalau ini cabang berbeda; ganti kalau salah ketik.</p>}
        </Field>
        <Field label="Nama Bengkel" required>
          <Input placeholder="Bengkel ..." value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          {!isEdit && form.name.trim() && (
            kotaNameSel
              ? <p className="text-[11px] text-emerald-400/90 mt-1">Tersimpan: <span className="font-medium">{composedName}</span></p>
              : <p className="text-[11px] text-slate-500 mt-1">Pilih kota → otomatis jadi "{form.name.trim()} - Kota"</p>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Region" required>
          <Select value={form.region_id} onChange={e => setForm({ ...form, region_id: e.target.value, kota_id: '' })}>
            <option value="">Pilih region…</option>
            {(regions || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </Field>
        <Field label="Kota" required>
          <Select value={form.kota_id} onChange={e => setForm({ ...form, kota_id: e.target.value })} disabled={!form.region_id}>
            <option value="">{form.region_id ? 'Pilih kota…' : 'Pilih region dulu'}</option>
            {filteredKotas.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Alamat (opsional)">
        <Textarea rows={2} placeholder="Jl. ... No. ... (opsional)" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      </Field>

      <Field label="Lokasi (opsional — klik / drag pin)">
        <BengkelPickerMap lat={form.lat} lng={form.lng} onChange={handlePick} />
        {(form.lat != null || form.lng != null) && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => setForm(f => ({ ...f, lat: null, lng: null }))}
              className="text-xs font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-100 border border-slate-700 hover:border-rose-600 transition">
              <MapPin className="w-3.5 h-3.5" />Reset Koordinat
            </button>
            <span className="text-[11px] text-slate-500">
              Lat/Lng dikosongkan setelah Simpan — terisi ulang otomatis dari GPS visit MD berikutnya.
            </span>
          </div>
        )}
      </Field>

      <div className="flex gap-2 mt-3">
        <Button variant="primary" onClick={handleSave} disabled={!canSave} className="flex-1">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan…</> : <><Check className="w-4 h-4" />{isEdit ? 'Update Bengkel' : 'Simpan Bengkel'}</>}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
        )}
      </div>
    </div>
  );
}

// Sub-form akun MD: buat baru atau edit (kalau `initial` di-pass)
function MDForm({ regions, onSave, initial, onCancel }) {
  const isEdit = !!initial;
  const ROLES = ['md', 'tl', 'bp', 'admin', 'super_admin'];
  const [form, setForm] = useState({
    email: initial?.email || '',
    full_name: initial?.full_name || '',
    role: initial?.role || 'md',
    region_id: initial?.region_id || '',
    region_ids: initial?.region_ids || (initial?.region_id ? [initial.region_id] : []),
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const emailInvalid = !isEdit && form.email.trim() !== '' && !emailOk;
  const canSave = (isEdit || emailOk) && form.full_name.trim() && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const multiRegion = form.role === 'tl' || form.role === 'md';
      const region_ids = multiRegion ? form.region_ids.filter(Boolean) : [];
      const base = {
        full_name: form.full_name.trim(),
        role: form.role || 'md',
        region_id: multiRegion ? (region_ids[0] || null) : (form.region_id || null),
        region_ids,
      };
      if (isEdit) {
        // patch — email tidak diubah (identitas auth). password hanya kalau diisi.
        await onSave(form.password.trim() ? { ...base, password: form.password.trim() } : base);
      } else {
        await onSave({ ...base, email: form.email.trim().toLowerCase(), password: form.password.trim() || undefined });
        setForm({ email: '', full_name: '', role: 'md', region_id: '', region_ids: [], password: '' });
      }
    } catch (err) {
      alert('Gagal: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`mb-5 p-4 bg-slate-950 border rounded-xl ${isEdit ? 'border-amber-600/40' : 'border-slate-800'}`}>
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {isEdit
            ? <><Activity className="w-3.5 h-3.5 text-amber-400" /><span className="text-amber-300">Edit Akun · {initial.full_name}</span></>
            : <><Plus className="w-3.5 h-3.5" />Buat Akun MD Baru</>}
        </span>
        {onCancel && (
          <button onClick={onCancel} className="text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600 text-slate-100 border border-slate-700 hover:border-rose-600 transition shrink-0">
            <X className="w-3 h-3" />Batal
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Email" required>
          <Input type="email" placeholder="nama@federal.id" value={form.email}
            disabled={isEdit}
            onChange={e => setForm({ ...form, email: e.target.value })}
            className={`${emailInvalid ? 'border-rose-600/50' : ''} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`} />
        </Field>
        <Field label="Nama Lengkap" required>
          <Input placeholder="Mis. Budi Santoso" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES.map(r => <option key={r} value={r}>{r === 'md' ? 'MD (Merchandiser)' : r === 'tl' ? 'TL (Team Leader)' : r === 'bp' ? 'BP (Supervisor)' : r === 'super_admin' ? 'Super Admin' : 'Admin'}</option>)}
          </Select>
        </Field>
        <Field label={(form.role === 'tl' || form.role === 'md') ? 'Area / Region (boleh >1)' : 'Region (wilayah kerja)'}>
          {(form.role === 'tl' || form.role === 'md') ? (
            <>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 space-y-1">
                {(regions || []).map(r => {
                  const on = form.region_ids.includes(r.id);
                  return (
                    <label key={r.id} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer hover:text-white">
                      <input type="checkbox" checked={on} className="accent-blue-600"
                        onChange={() => setForm(f => ({ ...f, region_ids: on ? f.region_ids.filter(x => x !== r.id) : [...f.region_ids, r.id] }))} />
                      {r.name}
                    </label>
                  );
                })}
                {(regions || []).length === 0 && <div className="text-xs text-slate-500">Belum ada region.</div>}
              </div>
              {form.region_ids.length === 0
                ? <p className="text-[11px] text-amber-400 mt-1.5 flex items-center gap-1.5"><AlertCircle className="w-3 h-3" />{form.role === 'tl' ? 'TL wajib minimal 1 region — tanpa ini, TL tak melihat data apa pun.' : 'Pilih minimal 1 area supaya daftar bengkel MD terkunci ke wilayahnya.'}</p>
                : <p className="text-[11px] text-slate-500 mt-1.5">{form.region_ids.length} area dipilih.</p>}
            </>
          ) : (
            <Select value={form.region_id} onChange={e => setForm({ ...form, region_id: e.target.value })}>
              <option value="">— Tidak di-set —</option>
              {(regions || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={isEdit ? 'Reset Password (opsional)' : 'Password (opsional)'}>
          <div className="relative">
            <Input type={showPw ? 'text' : 'password'} placeholder={isEdit ? 'Kosong = tidak diubah' : 'Kosong = auto-generate'} value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} className="pr-9" />
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
      </div>
      {emailInvalid && <p className="text-[11px] text-rose-400 mb-2">Format email tidak valid</p>}
      {!isEdit && <p className="text-[11px] text-slate-500 mb-3">💡 Password kosong → digenerate otomatis, MD set sendiri via "Lupa password" di login.</p>}
      {isEdit && !MOCK_MODE && <p className="text-[11px] text-amber-400 mb-3">⚠ Reset password di mode produksi perlu Edge Function. Untuk sekarang ubah via Supabase atau "Lupa password".</p>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={handleSave} disabled={!canSave} className="flex-1">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan…</> : <><Check className="w-4 h-4" />{isEdit ? 'Update Akun' : 'Buat Akun MD'}</>}
        </Button>
        {onCancel && <Button variant="secondary" onClick={onCancel}>Batal</Button>}
      </div>
    </div>
  );
}

// ============================================================
// BENGKEL IMPORT — Upload Excel/CSV → preview → bulk insert
// ============================================================

// Normalisasi header column dari Excel
const COLUMN_ALIASES = {
  code: ['code', 'kode', 'kode bengkel', 'kode_bengkel'],
  name: ['name', 'nama', 'nama bengkel', 'nama_bengkel', 'bengkel'],
  kota: ['kota', 'city', 'nama kota', 'nama_kota'],
  region: ['region', 'nama region', 'wilayah'],
  lat: ['lat', 'latitude', 'lintang'],
  lng: ['lng', 'lon', 'long', 'longitude', 'bujur'],
  address: ['address', 'alamat'],
};

// Match raw header ke field kanonik
const normalizeColumn = (header) => {
  const h = String(header || '').trim().toLowerCase();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  return null;
};

// Validate & enrich satu row dari Excel
const validateBengkelRow = (raw, ctx, existingCodes) => {
  const errors = [];
  const code = String(raw.code || '').trim().toUpperCase();
  const name = String(raw.name || '').trim();
  const kotaName = String(raw.kota || '').trim().toLowerCase();
  const regionName = String(raw.region || '').trim().toLowerCase();
  const latRaw = raw.lat, lngRaw = raw.lng;

  if (!code) errors.push('Kode kosong');
  if (!name) errors.push('Nama kosong');
  if (!kotaName) errors.push('Kota kosong');

  // Lookup region (opsional, tapi mendisambiguasi kota dengan nama sama)
  let region = null;
  if (regionName) {
    region = ctx.regions.find(r => r.name.toLowerCase() === regionName);
    if (!region) errors.push(`Region "${raw.region}" tidak ditemukan`);
  }

  // Cari kota: kalau region di-isi, match nama + region; kalau tidak, by nama saja
  const kotaMatches = ctx.kotas.filter(k => k.name.toLowerCase() === kotaName);
  let kota = null;
  if (kotaName) {
    if (region) {
      kota = kotaMatches.find(k => k.region_id === region.id);
      if (!kota && kotaMatches.length > 0) errors.push(`Kota "${raw.kota}" tidak ada di region "${raw.region}"`);
      else if (!kota) errors.push(`Kota "${raw.kota}" tidak ditemukan`);
    } else {
      if (kotaMatches.length > 1) errors.push(`Kota "${raw.kota}" ada di >1 region — isi kolom region untuk memperjelas`);
      else if (kotaMatches.length === 1) kota = kotaMatches[0];
      else errors.push(`Kota "${raw.kota}" tidak ditemukan`);
    }
  }

  let lat = null, lng = null;
  if (latRaw !== undefined && latRaw !== '' && latRaw !== null) {
    const n = Number(latRaw);
    if (Number.isNaN(n) || n < -90 || n > 90) errors.push(`Lat invalid: ${latRaw}`);
    else lat = n;
  }
  if (lngRaw !== undefined && lngRaw !== '' && lngRaw !== null) {
    const n = Number(lngRaw);
    if (Number.isNaN(n) || n < -180 || n > 180) errors.push(`Lng invalid: ${lngRaw}`);
    else lng = n;
  }

  // Duplicate check (vs existing bengkels + dalam batch yang sedang di-import)
  if (code && existingCodes.has(code)) errors.push(`Kode ${code} sudah terdaftar (duplikat)`);

  const payload = errors.length === 0 ? {
    code, name,
    kota_id: kota?.id,
    lat, lng,
    address: raw.address ? String(raw.address).trim() : null,
  } : null;

  return { ok: errors.length === 0, errors, payload, raw };
};

// Download CSV template dengan 2 contoh baris
const downloadBengkelTemplate = (kotas, regions) => {
  const sampleKota = kotas[0]?.name || 'Jakarta Selatan';
  const sampleRegion = regions?.[0]?.name || 'Jabodetabek';
  const rows = [
    ['code', 'name', 'kota', 'region', 'lat', 'lng', 'address'],
    ['BK101', 'Bengkel Contoh Satu', sampleKota, sampleRegion, '-6.2615', '106.8106', 'Jl. Contoh No. 1'],
    ['BK102', 'Bengkel Contoh Dua', sampleKota, sampleRegion, '', '', ''],
  ];
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bengkel-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

function BengkelImportModal({ kotas, regions, bengkels, onClose, onImported }) {
  const [step, setStep] = useState('upload'); // upload | preview | importing | done
  const [filename, setFilename] = useState('');
  const [rawRows, setRawRows] = useState([]);     // raw parse dengan column normalized
  const [validated, setValidated] = useState([]); // [{ok, errors, payload, raw}]
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (data.length === 0) {
        alert('Sheet kosong atau tidak ada data');
        return;
      }
      // Map columns lewat alias
      const rawHeaders = Object.keys(data[0]);
      const colMap = {};
      rawHeaders.forEach(h => {
        const norm = normalizeColumn(h);
        if (norm) colMap[h] = norm;
      });
      // Build normalized rows
      const rows = data.map(row => {
        const out = {};
        for (const [raw, norm] of Object.entries(colMap)) out[norm] = row[raw];
        return out;
      });
      // Validate
      const existingCodes = new Set(bengkels.map(b => b.code));
      const seenInBatch = new Set();
      const validatedRows = rows.map(r => {
        const code = String(r.code || '').trim().toUpperCase();
        // Mark intra-batch duplicate
        const isDupInBatch = code && seenInBatch.has(code);
        if (code) seenInBatch.add(code);

        const res = validateBengkelRow(r, { kotas, regions }, existingCodes);
        if (isDupInBatch) {
          res.ok = false;
          res.errors.push(`Kode ${code} duplikat di file ini`);
        }
        return res;
      });
      setRawRows(rows);
      setValidated(validatedRows);
      setStep('preview');
    } catch (e) {
      alert('Gagal parse file: ' + e.message);
    }
  };

  const handleImport = async () => {
    const validPayloads = validated.filter(v => v.ok).map(v => v.payload);
    if (validPayloads.length === 0) return;
    setStep('importing');
    setProgress({ done: 0, total: validPayloads.length });
    try {
      const r = await api.bulkAddBengkels(validPayloads, (done, total) => setProgress({ done, total }));
      setResult(r);
      setStep('done');
    } catch (e) {
      alert('Gagal import: ' + e.message);
      setStep('preview');
    }
  };

  const handleFinish = () => {
    onImported?.();
    onClose();
  };

  const validCount = validated.filter(v => v.ok).length;
  const invalidCount = validated.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-4xl my-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h2 className="font-display font-bold text-lg text-slate-100">Import Bengkel dari Excel</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {/* STEP: UPLOAD */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
                <p className="font-semibold text-slate-200 text-sm">📋 Petunjuk file Excel / CSV</p>
                <p>Header kolom yang dikenali (case-insensitive, urutan bebas):</p>
                <ul className="ml-4 space-y-0.5 list-disc">
                  <li><span className="font-mono text-slate-300">code</span> / kode <span className="text-blue-400">*</span></li>
                  <li><span className="font-mono text-slate-300">name</span> / nama / bengkel <span className="text-blue-400">*</span></li>
                  <li><span className="font-mono text-slate-300">kota</span> / city <span className="text-blue-400">*</span> — harus match nama kota di master</li>
                  <li><span className="font-mono text-slate-300">region</span> / wilayah — opsional, tapi <span className="text-amber-400">wajib kalau ada kota bernama sama di &gt;1 region</span></li>
                  <li><span className="font-mono text-slate-300">lat</span> / latitude — opsional, range -90 .. 90</li>
                  <li><span className="font-mono text-slate-300">lng</span> / longitude — opsional, range -180 .. 180</li>
                  <li><span className="font-mono text-slate-300">address</span> / alamat — opsional</li>
                </ul>
                <p className="text-amber-400">⚠ Kota & region di-lookup by name. Pastikan sudah ada di Master Data sebelum import. (Distributor dicatat saat visit, bukan di bengkel.)</p>
                <button
                  onClick={() => downloadBengkelTemplate(kotas, regions)}
                  className="mt-2 text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 text-xs font-medium">
                  <Download className="w-3.5 h-3.5" />Download template CSV
                </button>
              </div>

              <button onClick={() => inputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-700 hover:border-blue-600/40 hover:bg-blue-600/5 rounded-xl py-12 flex flex-col items-center gap-3 transition cursor-pointer">
                <Upload className="w-10 h-10 text-slate-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-200">Klik untuk pilih file</p>
                  <p className="text-xs text-slate-500 mt-0.5">Mendukung .xlsx, .xls, .csv</p>
                </div>
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={e => handleFile(e.target.files?.[0])} className="hidden" />
            </div>
          )}

          {/* STEP: PREVIEW */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center gap-3 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300 font-medium">{filename}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-500">{validated.length} baris</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <Check className="w-3.5 h-3.5" />{validCount} valid
                  </span>
                  {invalidCount > 0 && (
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <AlertCircle className="w-3.5 h-3.5" />{invalidCount} error
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-96 overflow-auto bg-slate-950 border border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800">
                    <tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="px-2 py-2 w-8">#</th>
                      <th className="px-2 py-2 w-6"></th>
                      <th className="px-2 py-2">Code</th>
                      <th className="px-2 py-2">Nama</th>
                      <th className="px-2 py-2">Kota</th>
                      <th className="px-2 py-2">Region</th>
                      <th className="px-2 py-2">Lat/Lng</th>
                      <th className="px-2 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validated.map((v, i) => (
                      <tr key={i} className={`border-b border-slate-800/50 ${v.ok ? '' : 'bg-rose-600/5'}`}>
                        <td className="px-2 py-1.5 text-slate-500 font-mono">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          {v.ok
                            ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                            : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-300">{v.raw.code || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-200 max-w-[180px] truncate">{v.raw.name || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-400 max-w-[120px] truncate">{v.raw.kota || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-400 max-w-[120px] truncate">{v.raw.region || '—'}</td>
                        <td className="px-2 py-1.5 font-mono text-slate-500">
                          {v.raw.lat && v.raw.lng ? `${Number(v.raw.lat).toFixed(3)},${Number(v.raw.lng).toFixed(3)}` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-rose-400 text-[11px]">
                          {v.errors.join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setStep('upload'); setValidated([]); setRawRows([]); }}>
                  <ChevronLeft className="w-4 h-4" />Pilih file lain
                </Button>
                <Button variant="primary" onClick={handleImport} disabled={validCount === 0} className="flex-1">
                  <Upload className="w-4 h-4" />Import {validCount} Bengkel
                </Button>
              </div>
            </div>
          )}

          {/* STEP: IMPORTING */}
          {step === 'importing' && (
            <div className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-100">Mengimport bengkel…</p>
                <p className="text-xs text-slate-500 mt-1">{progress.done} / {progress.total} baris</p>
              </div>
              <div className="w-full max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%` }} />
              </div>
            </div>
          )}

          {/* STEP: DONE */}
          {step === 'done' && result && (
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check className="w-7 h-7 text-slate-900" strokeWidth={3} />
              </div>
              <div className="text-center">
                <h3 className="font-display font-bold text-lg text-slate-100">Import selesai</h3>
                <p className="text-sm text-emerald-400 mt-1">{result.inserted} bengkel berhasil di-tambah</p>
                {result.errors.length > 0 && (
                  <p className="text-xs text-rose-400 mt-1">{result.errors.length} gagal (lihat error log di console)</p>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="w-full max-h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-rose-400 space-y-1">
                  {result.errors.map((e, i) => (
                    <div key={i}>Row {e.row}: {e.message}</div>
                  ))}
                </div>
              )}
              <Button variant="primary" onClick={handleFinish}>
                <Check className="w-4 h-4" />Selesai
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MASTER IMPORT — generic config-driven (regions/distributors/kotas/mds)
// ============================================================

const VALID_ROLES = ['md', 'bp', 'admin'];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: cari alias kolom
const pickCol = (row, aliases) => {
  for (const key of Object.keys(row)) {
    if (aliases.includes(key.trim().toLowerCase())) return row[key];
  }
  return undefined;
};

// Config per section yang bisa di-import
const MASTER_IMPORT_CFG = {
  regions: {
    label: 'Region',
    template: [['name'], ['Kalimantan'], ['Bali & Nusa Tenggara']],
    preview: [{ key: 'name', label: 'Nama Region' }],
    parseRow: (row) => ({ name: String(pickCol(row, ['name', 'nama', 'region', 'nama region']) || '').trim() }),
    validate: (p, ctx, seen, existing) => {
      const errs = [];
      if (!p.name) errs.push('Nama kosong');
      const key = p.name.toLowerCase();
      if (p.name && existing.has(key)) errs.push(`Region "${p.name}" sudah ada`);
      if (p.name && seen.has(key)) errs.push('Duplikat di file ini');
      return errs;
    },
    keyOf: (p) => p.name.toLowerCase(),
    existingKeys: (ctx) => new Set(ctx.regions.map(r => r.name.toLowerCase())),
    payload: (p) => ({ name: p.name }),
    importer: (rows, onP) => api.bulkAddMaster('regions', rows, onP),
  },

  distributors: {
    label: 'Distributor',
    template: [['name', 'region'], ['PT Pelumas Jaya', 'Jabodetabek'], ['CV Oli Makmur', 'Jawa Barat']],
    preview: [{ key: 'name', label: 'Nama Distributor' }, { key: 'region', label: 'Region' }],
    parseRow: (row) => ({
      name: String(pickCol(row, ['name', 'nama', 'distributor', 'nama distributor']) || '').trim(),
      region: String(pickCol(row, ['region', 'nama region', 'wilayah']) || '').trim(),
    }),
    validate: (p, ctx, seen, existing) => {
      const errs = [];
      if (!p.name) errs.push('Nama kosong');
      if (!p.region) errs.push('Region kosong');
      const reg = ctx.regions.find(r => r.name.toLowerCase() === p.region.toLowerCase());
      if (p.region && !reg) errs.push(`Region "${p.region}" tidak ditemukan`);
      p._region_id = reg?.id;
      const key = `${p.name.toLowerCase()}|${p.region.toLowerCase()}`;
      if (p.name && p.region && existing.has(key)) errs.push(`Distributor "${p.name}" di region ini sudah ada`);
      if (p.name && p.region && seen.has(key)) errs.push('Duplikat di file ini');
      return errs;
    },
    keyOf: (p) => `${p.name.toLowerCase()}|${p.region.toLowerCase()}`,
    existingKeys: (ctx) => {
      const regById = Object.fromEntries(ctx.regions.map(r => [r.id, r.name.toLowerCase()]));
      return new Set(ctx.distributors.map(d => `${d.name.toLowerCase()}|${regById[d.region_id] || ''}`));
    },
    payload: (p) => ({ name: p.name, region_id: p._region_id }),
    importer: (rows, onP) => api.bulkAddMaster('distributors', rows, onP),
  },

  kotas: {
    label: 'Kota',
    template: [['name', 'region'], ['Cikarang', 'Jabodetabek'], ['Karawang', 'Jawa Barat']],
    preview: [{ key: 'name', label: 'Nama Kota' }, { key: 'region', label: 'Region' }],
    parseRow: (row) => ({
      name: String(pickCol(row, ['name', 'nama', 'kota', 'nama kota']) || '').trim(),
      region: String(pickCol(row, ['region', 'nama region', 'wilayah']) || '').trim(),
    }),
    validate: (p, ctx, seen, existing) => {
      const errs = [];
      if (!p.name) errs.push('Nama kota kosong');
      if (!p.region) errs.push('Region kosong');
      const reg = ctx.regions.find(r => r.name.toLowerCase() === p.region.toLowerCase());
      if (p.region && !reg) errs.push(`Region "${p.region}" tidak ditemukan`);
      p._region_id = reg?.id;
      const key = `${p.name.toLowerCase()}|${p.region.toLowerCase()}`;
      if (p.name && p.region && existing.has(key)) errs.push('Kota di region ini sudah ada');
      if (p.name && p.region && seen.has(key)) errs.push('Duplikat di file ini');
      return errs;
    },
    keyOf: (p) => `${p.name.toLowerCase()}|${p.region.toLowerCase()}`,
    existingKeys: (ctx) => {
      const regById = Object.fromEntries(ctx.regions.map(r => [r.id, r.name.toLowerCase()]));
      return new Set(ctx.kotas.map(k => `${k.name.toLowerCase()}|${regById[k.region_id] || ''}`));
    },
    payload: (p) => ({ name: p.name, region_id: p._region_id }),
    importer: (rows, onP) => api.bulkAddMaster('kotas', rows, onP),
  },

  mds: {
    label: 'Akun MD',
    template: [
      ['email', 'full_name', 'role', 'region', 'password'],
      ['dewi@federal.id', 'Dewi Anjani', 'md', 'Jawa Barat', 'federal123'],
      ['eko@federal.id', 'Eko Prasetyo', 'md', 'Jawa Barat', ''],
    ],
    preview: [
      { key: 'email', label: 'Email' },
      { key: 'full_name', label: 'Nama' },
      { key: 'role', label: 'Role' },
      { key: 'region', label: 'Region' },
    ],
    parseRow: (row) => ({
      email: String(pickCol(row, ['email', 'e-mail']) || '').trim(),
      full_name: String(pickCol(row, ['full_name', 'name', 'nama', 'nama lengkap']) || '').trim(),
      role: String(pickCol(row, ['role', 'peran']) || 'md').trim().toLowerCase(),
      region: String(pickCol(row, ['region', 'wilayah']) || '').trim(),
      password: String(pickCol(row, ['password', 'pwd', 'sandi']) || '').trim(),
    }),
    validate: (p, ctx, seen, existing) => {
      const errs = [];
      if (!p.email) errs.push('Email kosong');
      else if (!emailRe.test(p.email)) errs.push('Format email invalid');
      if (!p.full_name) errs.push('Nama kosong');
      if (p.role && !VALID_ROLES.includes(p.role)) errs.push(`Role "${p.role}" invalid (md/bp/admin)`);
      if (p.region) {
        const reg = ctx.regions.find(r => r.name.toLowerCase() === p.region.toLowerCase());
        if (!reg) errs.push(`Region "${p.region}" tidak ditemukan`);
        p._region_id = reg?.id;
      }
      const key = p.email.toLowerCase();
      if (p.email && existing.has(key)) errs.push(`Email ${p.email} sudah terdaftar`);
      if (p.email && seen.has(key)) errs.push('Duplikat email di file ini');
      return errs;
    },
    keyOf: (p) => p.email.toLowerCase(),
    existingKeys: (ctx) => new Set(ctx.mds.map(m => m.email.toLowerCase())),
    payload: (p) => ({
      email: p.email.toLowerCase(),
      full_name: p.full_name,
      role: p.role || 'md',
      region_id: p._region_id || null,
      password: p.password || undefined,
    }),
    importer: (rows, onP) => api.bulkCreateMDs(rows, onP),
  },
};

// Download template CSV generic
const downloadMasterTemplate = (section) => {
  const cfg = MASTER_IMPORT_CFG[section];
  if (!cfg) return;
  const csv = cfg.template.map(r => r.map(c => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${section}-template.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

function MasterImportModal({ section, ctx, onClose, onImported }) {
  const cfg = MASTER_IMPORT_CFG[section];
  const [step, setStep] = useState('upload');
  const [filename, setFilename] = useState('');
  const [validated, setValidated] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (data.length === 0) { alert('Sheet kosong'); return; }

      const existing = cfg.existingKeys(ctx);
      const seen = new Set();
      const rows = data.map(raw => {
        const parsed = cfg.parseRow(raw);
        const errs = cfg.validate(parsed, ctx, seen, existing);
        const key = cfg.keyOf(parsed);
        if (key) seen.add(key);
        return { ok: errs.length === 0, errors: errs, parsed, payload: errs.length === 0 ? cfg.payload(parsed) : null };
      });
      setValidated(rows);
      setStep('preview');
    } catch (e) {
      alert('Gagal parse file: ' + e.message);
    }
  };

  const handleImport = async () => {
    const payloads = validated.filter(v => v.ok).map(v => v.payload);
    if (payloads.length === 0) return;
    setStep('importing');
    setProgress({ done: 0, total: payloads.length });
    try {
      const r = await cfg.importer(payloads, (done, total) => setProgress({ done, total }));
      setResult(r);
      setStep('done');
    } catch (e) {
      alert('Gagal import: ' + e.message);
      setStep('preview');
    }
  };

  const validCount = validated.filter(v => v.ok).length;
  const invalidCount = validated.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-3xl my-8 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
            <h2 className="font-display font-bold text-lg text-slate-100">Import {cfg.label} dari Excel</h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {step === 'upload' && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
                <p className="font-semibold text-slate-200 text-sm">📋 Kolom yang dikenali</p>
                <p className="font-mono text-slate-300">{cfg.template[0].join(', ')}</p>
                {(section === 'kotas' || section === 'distributors') && <p className="text-amber-400">⚠ Region di-lookup by nama. Pastikan region sudah ada di Master Data.</p>}
                {section === 'mds' && (
                  <>
                    <p className="text-amber-400">⚠ role: md / bp / admin (default md). region di-lookup by nama.</p>
                    <p className="text-amber-400">⚠ password kosong → digenerate random (MD reset via "Lupa password").</p>
                    {!MOCK_MODE && <p className="text-rose-400">⚠ Butuh Edge Function <span className="font-mono">admin-create-md</span> ter-deploy (lihat catatan).</p>}
                  </>
                )}
                <button onClick={() => downloadMasterTemplate(section)}
                  className="mt-2 text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 text-xs font-medium">
                  <Download className="w-3.5 h-3.5" />Download template CSV
                </button>
              </div>
              <button onClick={() => inputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-700 hover:border-blue-600/40 hover:bg-blue-600/5 rounded-xl py-12 flex flex-col items-center gap-3 transition">
                <Upload className="w-10 h-10 text-slate-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-200">Klik untuk pilih file</p>
                  <p className="text-xs text-slate-500 mt-0.5">.xlsx, .xls, .csv</p>
                </div>
              </button>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => handleFile(e.target.files?.[0])} className="hidden" />
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center gap-3 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300 font-medium">{filename}</span>
                  <span className="text-slate-500">· {validated.length} baris</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-emerald-400"><Check className="w-3.5 h-3.5" />{validCount} valid</span>
                  {invalidCount > 0 && <span className="flex items-center gap-1.5 text-rose-400"><AlertCircle className="w-3.5 h-3.5" />{invalidCount} error</span>}
                </div>
              </div>
              <div className="max-h-96 overflow-auto bg-slate-950 border border-slate-800 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-900 border-b border-slate-800">
                    <tr className="text-left text-slate-500 uppercase tracking-wider">
                      <th className="px-2 py-2 w-8">#</th>
                      <th className="px-2 py-2 w-6"></th>
                      {cfg.preview.map(c => <th key={c.key} className="px-2 py-2">{c.label}</th>)}
                      <th className="px-2 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validated.map((v, i) => (
                      <tr key={i} className={`border-b border-slate-800/50 ${v.ok ? '' : 'bg-rose-600/5'}`}>
                        <td className="px-2 py-1.5 text-slate-500 font-mono">{i + 1}</td>
                        <td className="px-2 py-1.5">{v.ok ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}</td>
                        {cfg.preview.map(c => (
                          <td key={c.key} className="px-2 py-1.5 text-slate-200 max-w-[160px] truncate">{String(v.parsed[c.key] ?? '') || '—'}</td>
                        ))}
                        <td className="px-2 py-1.5 text-rose-400 text-[11px]">{v.errors.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setStep('upload'); setValidated([]); }}>
                  <ChevronLeft className="w-4 h-4" />Pilih file lain
                </Button>
                <Button variant="primary" onClick={handleImport} disabled={validCount === 0} className="flex-1">
                  <Upload className="w-4 h-4" />Import {validCount} {cfg.label}
                </Button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-sm font-semibold text-slate-100">Mengimport {cfg.label}…</p>
              <p className="text-xs text-slate-500">{progress.done} / {progress.total}</p>
              <div className="w-full max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%` }} />
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="py-8 flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center">
                <Check className="w-7 h-7 text-slate-900" strokeWidth={3} />
              </div>
              <div className="text-center">
                <h3 className="font-display font-bold text-lg text-slate-100">Import selesai</h3>
                <p className="text-sm text-emerald-400 mt-1">{result.inserted} {cfg.label} berhasil di-tambah</p>
                {result.errors?.length > 0 && <p className="text-xs text-rose-400 mt-1">{result.errors.length} gagal</p>}
              </div>
              {result.errors?.length > 0 && (
                <div className="w-full max-h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-rose-400 space-y-1">
                  {result.errors.map((e, i) => <div key={i}>Row {e.row}: {e.message}</div>)}
                </div>
              )}
              <Button variant="primary" onClick={() => { onImported?.(); onClose(); }}>
                <Check className="w-4 h-4" />Selesai
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Tampilkan email + password MD (reveal). Terlihat oleh admin & super_admin.
function MdCredential({ email, password }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2.5 text-[11px] text-slate-500 mt-0.5 min-w-0">
      <span className="flex items-center gap-1 min-w-0 truncate"><Mail className="w-3 h-3 shrink-0" />{email}</span>
      {password ? (
        <span className="flex items-center gap-1 shrink-0">
          <Lock className="w-3 h-3" />
          <span className="font-mono text-slate-400">{show ? password : '••••••••'}</span>
          <button type="button" onClick={(e) => { e.stopPropagation(); setShow(s => !s); }} className="text-slate-500 hover:text-slate-200" title={show ? 'Sembunyikan' : 'Lihat password'}>
            {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
        </span>
      ) : <span className="text-slate-600 italic shrink-0">— password tak tersimpan</span>}
    </div>
  );
}

// Modal detail akun MD (semua admin bisa lihat)
function MdDetailModal({ md, regionName, onClose }) {
  useBackDismiss(true, onClose);
  const [showPw, setShowPw] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!md) return null;
  const rows = [
    ['Nama Lengkap', md.full_name || '—'],
    ['Email', md.email || '—'],
    ['Role', md.role || '—'],
    [(['tl', 'md'].includes(md.role) && md.region_ids?.length > 1) ? 'Area (cover)' : 'Region',
      (['tl', 'md'].includes(md.role) && md.region_ids?.length)
        ? md.region_ids.map(regionName).filter(Boolean).join(', ')
        : (regionName(md.region_id) || '—')],
    ['Dibuat', md.created_at ? new Date(md.created_at).toLocaleString('id-ID') : '—'],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-pop-in" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-lg text-slate-100">Detail Akun MD</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-slate-500 shrink-0">{k}</span>
              <span className="text-slate-100 font-medium text-right break-all">{v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 text-sm pt-2.5 border-t border-slate-800">
            <span className="text-slate-500 shrink-0">Password</span>
            <span className="flex items-center gap-2">
              {md.login_password ? (
                <>
                  <span className="font-mono text-slate-100">{showPw ? md.login_password : '••••••••'}</span>
                  <button onClick={() => setShowPw(s => !s)} className="text-slate-500 hover:text-slate-200">{showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </>
              ) : <span className="text-slate-600 italic">tak tersimpan</span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MasterTab({ regions, kotas, distributors, bengkels, mds, accounts = [], onChange, isSuperAdmin, canManageMaster = true }) {
  const [section, setSection] = useState('distributors');
  const [newItem, setNewItem] = useState('');
  const [newItemRegion, setNewItemRegion] = useState('');  // region untuk add kota/distributor
  const [search, setSearch] = useState('');
  const [editingBengkelId, setEditingBengkelId] = useState(null);
  const [editingMDId, setEditingMDId] = useState(null);
  const [detailMDId, setDetailMDId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);          // bengkel import
  const [masterImportOpen, setMasterImportOpen] = useState(false); // regions/distributors/kotas/mds import
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // bulk-select (kota & bengkel)
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [addOpen, setAddOpen] = useState(false); // form tambah (bengkel/akun) tertutup default
  const [formClosing, setFormClosing] = useState(false); // utk animasi tutup modal form
  const closeForm = () => {
    setFormClosing(true);
    setTimeout(() => { setEditingBengkelId(null); setEditingMDId(null); setAddOpen(false); setFormClosing(false); }, 180);
  };
  const [pageSize, setPageSize] = useState(25);  // 10/25/50/100 atau 'all'
  const [page, setPage] = useState(1);
  const [filterRegion, setFilterRegion] = useState(''); // filter list bengkel
  const [filterKota, setFilterKota] = useState('');

  // back HP -> tutup form popup (Tambah/Edit Bengkel/Akun) dgn animasi, bukan pindah tab
  useBackDismiss(!!(editingBengkelId || editingMDId || addOpen), closeForm);

  const editingBengkel = editingBengkelId ? bengkels.find(b => b.id === editingBengkelId) : null;
  const editingMD = editingMDId ? mds.find(m => m.id === editingMDId) : null;
  const regionName = (id) => regions.find(r => r.id === id)?.name;

  const sections = [
    { id: 'distributors', label: 'Distributor', icon: Briefcase, items: distributors, getName: d => d.name },
    { id: 'regions', label: 'Provinsi', icon: Globe, items: regions, getName: r => r.name },
    { id: 'kotas', label: 'Kota', icon: MapPin, items: kotas, getName: k => k.name },
    { id: 'bengkels', label: 'Bengkel', icon: Building2, items: bengkels, getName: b => `${b.code} - ${b.name}` },
    { id: 'mds', label: 'Akun', icon: Users, items: accounts, getName: m => `${m.full_name} (${m.email})` },
  ];

  const current = sections.find(s => s.id === section);
  // Section yang butuh pilih region saat tambah manual
  const needsRegion = section === 'kotas' || section === 'distributors';

  // Daftar ter-filter oleh search (pakai nama tampilan + email/kode bila ada)
  // Bisa cari beberapa data sekaligus — pisahkan dengan koma / titik koma / baris baru.
  // Item cocok kalau mengandung SALAH SATU kata kunci (OR).
  const searchTerms = search.trim().toLowerCase().split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
  const kotaRegionOf = (kotaId) => kotas.find(k => k.id === kotaId)?.region_id;
  const filteredItems = current.items.filter(it => {
    // Filter region/kota (khusus list bengkel)
    if (section === 'bengkels') {
      if (filterRegion && kotaRegionOf(it.kota_id) !== filterRegion) return false;
      if (filterKota && it.kota_id !== filterKota) return false;
    }
    if (searchTerms.length) {
      const hay = `${current.getName(it)} ${it.email || ''} ${it.code || ''} ${it.role || ''}`.toLowerCase();
      if (!searchTerms.some(t => hay.includes(t))) return false;
    }
    return true;
  });

  // Paginasi: tampilkan 10/25/50/100 atau semua
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = pageSize === 'all' ? 0 : (safePage - 1) * pageSize;
  const pagedItems = pageSize === 'all' ? filteredItems : filteredItems.slice(startIndex, startIndex + pageSize);

  // Reset edit mode, modal & search kalau pindah section
  useEffect(() => { setEditingBengkelId(null); setEditingMDId(null); setDetailMDId(null); setImportOpen(false); setMasterImportOpen(false); setNewItem(''); setNewItemRegion(''); setSearch(''); setSelectedIds(new Set()); setAddOpen(false); setPage(1); setFilterRegion(''); setFilterKota(''); }, [section]);

  // Kunci scroll background saat modal form/detail terbuka
  useEffect(() => {
    const open = addOpen || !!editingBengkelId || !!editingMDId || !!detailMDId;
    if (!open) return;
    __lockBodyScroll();
    return __unlockBodyScroll;
  }, [addOpen, editingBengkelId, editingMDId, detailMDId]);

  const handleAdd = async () => {
    if (!newItem.trim()) return;
    if (needsRegion && !newItemRegion) { alert('Pilih region dulu'); return; }
    try {
      const payload = needsRegion
        ? { name: newItem.trim(), region_id: newItemRegion }
        : { name: newItem.trim() };

      await api.addMaster(section, payload);
      await onChange();
      setNewItem('');
    } catch (err) {
      alert('Gagal: ' + err.message);
    }
  };

  const handleAddBengkel = async (payload) => {
    await api.addMaster('bengkels', payload);
    await onChange();
  };

  const handleAddMD = async (payload) => {
    const r = await api.bulkCreateMDs([payload]);
    if (r.errors?.length) throw new Error(r.errors[0].message);
    await onChange();
  };

  const handleUpdateMD = async (patch) => {
    const { password, region_ids, ...rest } = patch;
    await api.updateMaster('profiles', editingMDId, rest);
    // Sinkronkan multi-region MD/TL (dikosongkan untuk role lain)
    await api.setTlRegions(editingMDId, ['tl', 'md'].includes(rest.role) ? region_ids : []);
    if (password) await api.resetMdPassword(editingMDId, password);  // update auth + login_password
    await onChange();
    setEditingMDId(null);
  };

  const handleUpdateBengkel = async (payload) => {
    await api.updateMaster('bengkels', editingBengkelId, payload);
    await onChange();
    setEditingBengkelId(null);
  };

  // Reset koordinat 1 bengkel — dipakai kalau lat/lng salah (mis. ke-backfill dari
  // GPS MD di lokasi keliru) sehingga geofence memblokir visit yang sebenarnya sah.
  const [resettingId, setResettingId] = useState(null);
  const handleResetKoordinat = async (item) => {
    if (!confirm(`Reset koordinat "${item.name}"?\n\nLat/Lng dikosongkan dan akan terisi ulang otomatis dari GPS MD saat visit berikutnya.`)) return;
    setResettingId(item.id);
    try {
      await api.updateMaster('bengkels', item.id, { lat: null, lng: null });
      await onChange();
    } catch (err) {
      alert('Gagal reset koordinat: ' + err.message);
    } finally {
      setResettingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Hapus item ini?')) return;
    try {
      await api.deleteMaster(section, id);
      await onChange();
    } catch (err) {
      alert('Gagal: ' + err.message);
    }
  };

  // Bulk-select aktif untuk Kota & Bengkel
  const bulkEnabled = canManageMaster && (section === 'kotas' || section === 'bengkels');
  const toggleSelect = (id) => setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(it => selectedIds.has(it.id));
  const toggleSelectAll = () => setSelectedIds(allFilteredSelected ? new Set() : new Set(filteredItems.map(it => it.id)));
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!confirm(`Hapus ${ids.length} ${current.label.toLowerCase()} terpilih? Tidak bisa dibatalkan.`)) return;
    setBulkDeleting(true);
    const errors = [];
    for (const id of ids) {
      try { await api.deleteMaster(section, id); }
      catch (e) { errors.push(e.message || String(e)); }
    }
    setBulkDeleting(false);
    setSelectedIds(new Set());
    await onChange();
    if (errors.length) alert(`${ids.length - errors.length} terhapus, ${errors.length} gagal.\nContoh: ${errors[0]}`);
  };

  // Export section aktif (sesuai filter) ke Excel
  const handleExportXlsx = async () => {
    if (filteredItems.length === 0) return;
    const XLSX = await import('xlsx');
    let rows;
    if (section === 'bengkels') {
      rows = filteredItems.map(b => {
        const k = kotas.find(x => x.id === b.kota_id);
        return { Kode: b.code, 'Nama Bengkel': b.name, Kota: k?.name || '', Region: regionName(k?.region_id) || '', Alamat: b.address || '', Lat: b.lat ?? '', Lng: b.lng ?? '' };
      });
    } else if (section === 'kotas') {
      rows = filteredItems.map(k => ({ Kota: k.name, Region: regionName(k.region_id) || '' }));
    } else if (section === 'distributors') {
      rows = filteredItems.map(d => ({ Distributor: d.name, Region: regionName(d.region_id) || '' }));
    } else if (section === 'regions') {
      rows = filteredItems.map(r => ({ Region: r.name }));
    } else if (section === 'mds') {
      rows = filteredItems.map(m => ({ Nama: m.full_name, Email: m.email, Role: m.role, Region: regionName(m.region_id) || '', Aktif: m.active === false ? 'Tidak' : 'Ya' }));
    } else {
      rows = filteredItems.map(it => ({ Nama: current.getName(it) }));
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, current.label);
    XLSX.writeFile(wb, `${section}_${localDateStr()}.xlsx`);
  };

  const handleDeleteMD = async (id, name) => {
    if (!confirm(`Hapus akun MD "${name}"? Tidak bisa dibatalkan.\n(Akan gagal jika MD masih punya visit tercatat.)`)) return;
    try {
      await api.deleteMd(id);
      await onChange();
    } catch (err) {
      alert('Gagal hapus akun: ' + err.message);
    }
  };

  // Aktif/nonaktif akun (MD & TL). Nonaktif → datanya tidak muncul di tab lain.
  const handleToggleActive = async (item) => {
    const nowActive = item.active === false; // jadi true kalau sekarang nonaktif
    const label = item.role === 'tl' ? 'TL' : 'MD';
    if (!confirm(`${nowActive ? 'Aktifkan' : 'Nonaktifkan'} akun ${label} "${item.full_name}"?` +
      (nowActive ? '' : '\nData (visit/absen) akun ini akan disembunyikan dari Dashboard, Ranking, Visits, Absen & Coverage.'))) return;
    try {
      await api.updateMaster('profiles', item.id, { active: nowActive });
      await onChange();
    } catch (err) {
      alert('Gagal ubah status: ' + err.message);
    }
  };

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-slate-100 tracking-tight font-display">Master Data</h2>
        <p className="text-sm text-slate-500 mt-1">Kelola distributor, provinsi, kota, bengkel & akun</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-2 h-fit">
          {sections.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${section === s.id ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20' : 'text-slate-400 hover:bg-slate-950 hover:text-slate-100 border border-transparent'}`}>
              <s.icon className="w-4 h-4" />{s.label}
              <span className="ml-auto text-[10px] font-mono text-slate-600">{s.items.length}</span>
            </button>
          ))}
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
          {/* Form: 3 mode — simple input / bengkel form (add or edit) / MD info */}
          {section === 'bengkels' && canManageMaster && (
            <>
              {!editingBengkel && (
                <div className="mb-3 flex flex-wrap gap-2 justify-end">
                  {!addOpen && <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus className="w-3.5 h-3.5" />Tambah Bengkel</Button>}
                  <Button variant="secondary" size="sm" onClick={handleExportXlsx} disabled={filteredItems.length === 0}>
                    <Download className="w-3.5 h-3.5" />Export Excel ({filteredItems.length})
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                    <FileSpreadsheet className="w-3.5 h-3.5" />Import Excel
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => downloadBengkelTemplate(kotas, regions)}>
                    <Download className="w-3.5 h-3.5" />Template CSV
                  </Button>
                </div>
              )}
              {(editingBengkel || addOpen) && (
                <div className={`fixed inset-0 z-[1500] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto ${formClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
                >
                  <div className={`w-full max-w-2xl my-auto ${formClosing ? 'animate-pop-out' : 'animate-pop-in'}`}>
                    {editingBengkel ? (
                      <BengkelForm key={editingBengkel.id} kotas={kotas} regions={regions} bengkels={bengkels}
                        initial={editingBengkel} onSave={handleUpdateBengkel} onCancel={closeForm} />
                    ) : (
                      <BengkelForm kotas={kotas} regions={regions} bengkels={bengkels} onSave={handleAddBengkel} onCancel={closeForm} />
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {section !== 'mds' && section !== 'bengkels' && canManageMaster && (
            <>
              <div className="mb-3 flex flex-wrap gap-2 justify-end">
                  <Button variant="secondary" size="sm" onClick={handleExportXlsx} disabled={filteredItems.length === 0}>
                    <Download className="w-3.5 h-3.5" />Export Excel ({filteredItems.length})
                  </Button>
                <Button variant="secondary" size="sm" onClick={() => setMasterImportOpen(true)}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />Import Excel
                </Button>
                <Button variant="secondary" size="sm" onClick={() => downloadMasterTemplate(section)}>
                  <Download className="w-3.5 h-3.5" />Template CSV
                </Button>
              </div>
              <div className="flex flex-col gap-2 mb-4 sm:flex-row">
                <Input placeholder={`Tambah ${current.label.toLowerCase()}…`} value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()} />
                {needsRegion && (
                  <div className="w-full shrink-0 sm:w-44">
                    <Select value={newItemRegion} onChange={e => setNewItemRegion(e.target.value)}>
                      <option value="">Pilih region…</option>
                      {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </div>
                )}
                <Button onClick={handleAdd} variant="primary" className="shrink-0"><Plus className="w-4 h-4" />Tambah</Button>
              </div>
            </>
          )}

          {section === 'mds' && isSuperAdmin && (
            <>
              {!editingMD && (
                <div className="mb-3 flex flex-wrap gap-2 justify-end">
                  {!addOpen && <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus className="w-3.5 h-3.5" />Tambah Akun</Button>}
                  <Button variant="secondary" size="sm" onClick={handleExportXlsx} disabled={filteredItems.length === 0}>
                    <Download className="w-3.5 h-3.5" />Export Excel ({filteredItems.length})
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setMasterImportOpen(true)}>
                    <FileSpreadsheet className="w-3.5 h-3.5" />Import Excel
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => downloadMasterTemplate('mds')}>
                    <Download className="w-3.5 h-3.5" />Template CSV
                  </Button>
                </div>
              )}
              {(editingMD || addOpen) && (
                <div className={`fixed inset-0 z-[1500] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto ${formClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
                >
                  <div className={`w-full max-w-2xl my-auto ${formClosing ? 'animate-pop-out' : 'animate-pop-in'}`}>
                    {editingMD ? (
                      <MDForm key={editingMD.id} regions={regions} initial={editingMD} onSave={handleUpdateMD} onCancel={closeForm} />
                    ) : (
                      <MDForm regions={regions} onSave={handleAddMD} onCancel={closeForm} />
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {section === 'bengkels' && current.items.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <Select value={filterRegion} onChange={e => { setFilterRegion(e.target.value); setFilterKota(''); setPage(1); }}>
                <option value="">Semua Region</option>
                {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <Select value={filterKota} onChange={e => { setFilterKota(e.target.value); setPage(1); }}>
                <option value="">Semua Kota</option>
                {kotas.filter(k => !filterRegion || k.region_id === filterRegion).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Select>
            </div>
          )}

          {current.items.length > 0 && (
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder={`Cari ${current.label.toLowerCase()}… (banyak: pisahkan dengan koma)`}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-16 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-600/50" />
              {search && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{filteredItems.length}/{current.items.length}</span>}
            </div>
          )}

          {bulkEnabled && filteredItems.length > 0 && (
            <div className="flex items-center justify-between gap-2 mb-2 px-1">
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} className="accent-blue-600" />
                Pilih semua ({filteredItems.length})
              </label>
              {selectedIds.size > 0 && (
                <button onClick={handleBulkDelete} disabled={bulkDeleting}
                  className="flex items-center gap-1.5 text-xs text-rose-300 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-600/30 rounded-lg px-3 py-1.5 disabled:opacity-50">
                  {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Hapus terpilih ({selectedIds.size})
                </button>
              )}
            </div>
          )}

          {filteredItems.length > 0 && (
            <div className="flex items-center justify-between gap-2 mb-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <span>Tampilkan</span>
                <select value={pageSize} onChange={e => { setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPage(1); }}
                  className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200 focus:outline-none focus:border-blue-600/50">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="all">Semua</option>
                </select>
                <span>dari {filteredItems.length}</span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                    className="px-2 py-1 rounded-md border border-slate-800 hover:border-slate-600 disabled:opacity-40">‹</button>
                  <span className="px-1">Hal {safePage}/{totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                    className="px-2 py-1 rounded-md border border-slate-800 hover:border-slate-600 disabled:opacity-40">›</button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {current.items.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">Belum ada data.</div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">Tidak ada hasil untuk "{search}".</div>
            ) : pagedItems.map((item, i) => (
              <div key={item.id}
                onClick={section === 'mds' ? () => setDetailMDId(item.id) : undefined}
                className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-950 border transition group ${section === 'mds' ? 'cursor-pointer' : ''} ${
                  (editingBengkelId === item.id || editingMDId === item.id) ? 'border-amber-600/40 ring-1 ring-amber-600/20' : 'border-slate-800 hover:border-slate-700'
                }`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {bulkEnabled && (
                    <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                      className="accent-blue-600 shrink-0" />
                  )}
                  <span className="text-[10px] font-mono text-slate-600 w-7">{String(startIndex + i + 1).padStart(2, '0')}</span>
                  {section === 'mds' ? (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm truncate ${item.active === false ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{current.getName(item)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-medium shrink-0 ${item.role === 'super_admin' ? 'bg-fuchsia-600/10 text-fuchsia-400' : item.role === 'admin' ? 'bg-rose-600/10 text-rose-400' : item.role === 'tl' ? 'bg-teal-600/10 text-teal-400' : item.role === 'bp' ? 'bg-amber-600/10 text-amber-400' : 'bg-sky-600/10 text-sky-400'}`}>
                          {item.role}{item.region_id ? ` · ${regionName(item.region_id) || ''}` : ''}
                        </span>
                        {item.active === false && <span className="text-[10px] px-1.5 py-0.5 rounded uppercase font-medium shrink-0 bg-slate-700/40 text-slate-400">Nonaktif</span>}
                      </div>
                      <MdCredential email={item.email} password={item.login_password} />
                    </div>
                  ) : (
                    <>
                      <span className="text-sm text-slate-200 truncate">{current.getName(item)}</span>
                      {section === 'bengkels' && (
                        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded ${item.lat != null && item.lng != null ? 'bg-emerald-600/10 text-emerald-400' : 'bg-slate-800/50 text-slate-500'}`}>
                          {item.lat != null && item.lng != null ? `${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}` : 'no-gps'}
                        </span>
                      )}
                      {(section === 'distributors' || section === 'kotas') && (
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${item.region_id ? 'bg-sky-600/10 text-sky-400' : 'bg-slate-800/50 text-slate-500'}`}>
                          {item.region?.name || regionName(item.region_id) || 'no-region'}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {section === 'mds' && (
                    <>
                      <button onClick={() => setDetailMDId(item.id)} title="Detail akun"
                        className="w-7 h-7 rounded-md hover:bg-sky-600/10 hover:text-sky-400 text-slate-500 flex items-center justify-center">
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                      {isSuperAdmin && (item.role === 'md' || item.role === 'tl') && (
                        <button onClick={() => handleToggleActive(item)} title={item.active === false ? 'Aktifkan akun' : 'Nonaktifkan akun'}
                          className={`w-7 h-7 rounded-md flex items-center justify-center ${item.active === false ? 'text-slate-500 hover:bg-emerald-600/10 hover:text-emerald-400' : 'text-emerald-400 hover:bg-rose-600/10 hover:text-rose-400'}`}>
                          <Power className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button onClick={() => setEditingMDId(item.id)} title="Edit akun"
                          className="w-7 h-7 rounded-md hover:bg-amber-600/10 hover:text-amber-400 text-slate-500 flex items-center justify-center">
                          <Activity className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button onClick={() => handleDeleteMD(item.id, current.getName(item))} title="Hapus akun"
                          className="w-7 h-7 rounded-md hover:bg-rose-600/10 hover:text-rose-400 text-slate-500 flex items-center justify-center">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                  {section === 'bengkels' && canManageMaster && (item.lat != null || item.lng != null) && (
                    <button onClick={() => handleResetKoordinat(item)}
                      disabled={resettingId === item.id}
                      className="opacity-0 group-hover:opacity-100 transition w-7 h-7 rounded-md hover:bg-sky-600/10 hover:text-sky-400 text-slate-500 flex items-center justify-center disabled:opacity-100"
                      title="Reset koordinat (lat/lng) — akan terisi ulang otomatis dari GPS visit MD berikutnya">
                      {resettingId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  {section === 'bengkels' && canManageMaster && (
                    <button onClick={() => setEditingBengkelId(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition w-7 h-7 rounded-md hover:bg-amber-600/10 hover:text-amber-400 text-slate-500 flex items-center justify-center"
                      title="Edit bengkel">
                      <Activity className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {section !== 'mds' && canManageMaster && (
                    <button onClick={() => handleDelete(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition w-7 h-7 rounded-md hover:bg-rose-600/10 hover:text-rose-400 text-slate-500 flex items-center justify-center"
                      title="Hapus">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {importOpen && (
        <BengkelImportModal
          kotas={kotas}
          regions={regions}
          bengkels={bengkels}
          onClose={() => setImportOpen(false)}
          onImported={onChange}
        />
      )}

      {masterImportOpen && (
        <MasterImportModal
          section={section}
          ctx={{ regions, kotas, distributors, mds }}
          onClose={() => setMasterImportOpen(false)}
          onImported={onChange}
        />
      )}

      {detailMDId && (
        <MdDetailModal
          md={mds.find(m => m.id === detailMDId)}
          regionName={regionName}
          onClose={() => setDetailMDId(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// SHARED
// ============================================================

function Loading() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
    </div>
  );
}

// ============================================================
// ROOT APP
// ============================================================

export default function App() {
  const [profile, setProfile] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [welcome, setWelcome] = useState(false); // popup ringkasan saat MD baru login
  const [passkeyOpen, setPasskeyOpen] = useState(false);

  useEffect(() => {
    api.getCurrentProfile().then(p => {
      setProfile(p);
      if (p?.role === 'md') setWelcome(true); // tampilkan ringkasan tiap buka app (sesi di-restore)
      setBootstrapping(false);
    });
  }, []);

  const handleLogin = (p) => {
    setProfile(p);
    if (p?.role === 'md') setWelcome(true);
  };
  const handleLogout = async () => {
    await api.signOut();
    setProfile(null);
    setWelcome(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Archivo:wght@500;600;700;800;900&display=swap');
        h1, h2, h3, .font-display { font-family: 'Archivo', sans-serif; letter-spacing: -0.02em; }
      `}</style>

      {bootstrapping ? <Loading /> :
       !profile ? <LoginScreen onLogin={handleLogin} /> :
       <>
        <header className="sticky top-0 z-40 backdrop-blur-xl bg-slate-950/80 border-b border-slate-800">
          <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/aa-logo.png" alt="AA" className="h-9 w-auto shrink-0" />
              <img src="/federal-logo.png" alt="2W Federal" className="h-6 w-auto shrink-0" />
              <div className="min-w-0">
                <div className="font-display font-bold text-sm text-slate-100 leading-tight">2W Federal POSM</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">{profile.role === 'md' ? 'MD Field Operations' : 'Admin Console'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="hidden sm:flex items-center gap-2 text-slate-400">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-[10px] font-bold text-white">
                  {profile.full_name.charAt(0)}
                </div>
                <span>{profile.full_name}</span>
              </div>
              {PASSKEY_ENABLED && !MOCK_MODE && (
                <button onClick={() => setPasskeyOpen(true)} title="Kelola passkey"
                  className="text-slate-500 hover:text-slate-200 transition flex items-center gap-1 px-2 py-1">
                  <Fingerprint className="w-3.5 h-3.5" /><span className="hidden sm:inline">Passkey</span>
                </button>
              )}
              <button onClick={handleLogout} className="text-slate-500 hover:text-rose-400 transition flex items-center gap-1 px-2 py-1">
                <LogOut className="w-3.5 h-3.5" /><span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
          {MOCK_MODE && (
            <div className="bg-amber-600/10 border-t border-amber-600/20 px-4 py-1.5 text-center text-[11px] text-amber-400">
              🟡 Mode Demo (Mock Data) — set .env.local untuk pakai Supabase
            </div>
          )}
        </header>

        {passkeyOpen && <PasskeyManagerModal onClose={() => setPasskeyOpen(false)} />}

        <main className="px-4 py-6">
          {profile.role === 'md'
            ? <MDView currentMD={profile} welcome={welcome} onWelcomeClose={() => setWelcome(false)} />
            : <AdminView profile={profile} />}
        </main>

        <footer className="border-t border-slate-800 py-6 mt-8">
          <div className="max-w-6xl mx-auto px-4 text-center text-xs text-slate-600">
            2W Federal POSM · v1.0
          </div>
        </footer>
       </>
      }
    </div>
  );
}
