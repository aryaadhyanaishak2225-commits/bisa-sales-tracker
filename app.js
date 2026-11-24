'use strict';

const STORAGE_KEY = 'bisaSalesTracker.v1';
const WEIGHTS = { volume: 0.50, customers: 0.30, vas: 0.15, sai: 0.05 };
const LABELS = { volume: 'Sales Volume', customers: 'Pelanggan Baru', vas: 'Premi VAS', sai: 'Premi SAI' };
const ICONS = { volume: '↗', customers: '◎', vas: '✦', sai: '◈' };
const VINTAGES = Array.from({ length: 73 }, (_, i) => `M${i}`).concat(['M72+']);
const fmt = new Intl.NumberFormat('id-ID');
const money = n => 'Rp ' + fmt.format(Math.round(Number(n) || 0));
const compactMoney = n => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e9) return 'Rp ' + (v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
  if (Math.abs(v) >= 1e6) return 'Rp ' + (v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (Math.abs(v) >= 1e3) return 'Rp ' + (v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' rb';
  return money(v);
};
const todayISO = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const currentMonth = () => todayISO().slice(0, 7);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function defaultState() {
  return { records: [], month: currentMonth(), vintages: {}, schema: 1 };
}
function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.records)) return { ...defaultState(), ...parsed };
  } catch (err) { console.warn('Data lokal tidak dapat dibaca:', err); }
  return defaultState();
}
let state = loadState();
let editingId = null;
let deferredInstallPrompt = null;
let reportSnapshot = null;

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (err) { toast('Penyimpanan penuh atau tidak tersedia. Export backup agar data aman.'); }
}
function getVintage(month = state.month) { return state.vintages[month] || 'M1'; }
function vintageNumber(v) { return v === 'M72+' ? 73 : Number(String(v).replace('M', '')); }
function targetsFor(vintage) {
  const m = vintageNumber(vintage);
  if (!m) return { volume: 0, customers: 0, vas: 0, sai: 0 };
  let volume;
  if (m === 1) volume = 15e6;
  else if (m === 2) volume = 37.5e6;
  else if (m === 3) volume = 67.5e6;
  else if (m === 4) volume = 82.5e6;
  else if (m === 5) volume = 97.5e6;
  else if (m === 6) volume = 112.5e6;
  else if (m === 7) volume = 127.5e6;
  else if (m <= 12) volume = 150e6;
  else if (m <= 24) volume = 195e6;
  else if (m <= 36) volume = 225e6;
  else if (m <= 48) volume = 240e6;
  else if (m <= 60) volume = 255e6;
  else if (m <= 72) volume = 270e6;
  else volume = 300e6;

  let customers;
  if (m <= 3) customers = m;
  else if (m <= 6) customers = 4;
  else if (m <= 12) customers = 7;
  else if (m <= 72) customers = 10;
  else customers = 13;

  let vas;
  if (m === 1) vas = 2e6;
  else if (m === 2) vas = 3e6;
  else if (m === 3) vas = 5e6;
  else if (m === 4) vas = 7e6;
  else if (m === 5) vas = 8e6;
  else if (m === 6) vas = 9e6;
  else if (m === 7) vas = 11e6;
  else if (m <= 12) vas = 12e6;
  else if (m <= 24) vas = 16e6;
  else if (m <= 36) vas = 18e6;
  else if (m <= 48) vas = 20e6;
  else if (m <= 60) vas = 21e6;
  else if (m <= 72) vas = 23e6;
  else vas = 25e6;

  let sai;
  if (m <= 3) sai = 199000;
  else if (m <= 6) sai = 299000;
  else if (m <= 9) sai = 399000;
  else if (m <= 12) sai = 499000;
  else sai = 599000;
  return { volume, customers, vas, sai };
}
function monthRecords(month = state.month) { return state.records.filter(r => r.date.startsWith(month)); }
function totals(records) {
  return records.reduce((a, r) => {
    a.volume += Number(r.volume) || 0; a.customers += Number(r.customers) || 0;
    a.vas += Number(r.vas) || 0; a.sai += Number(r.sai) || 0; return a;
  }, { volume: 0, customers: 0, vas: 0, sai: 0 });
}
function getPerformance(records, targets) {
  const actual = totals(records);
  const components = Object.keys(WEIGHTS).map(key => {
    const target = targets[key];
    const ratio = target > 0 ? actual[key] / target : 0;
    const capped = Math.min(ratio, 1.2);
    const points = target > 0 ? capped * WEIGHTS[key] * 100 : null;
    return { key, target, actual: actual[key], ratio, points, weight: WEIGHTS[key] };
  });
  const score = components.every(c => c.points !== null) ? components.reduce((s, c) => s + c.points, 0) : null;
  return { actual, components, score };
}
function periodName(month) {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}
function shortDate(date) {
  if (!date) return '—';
  const d = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}
function dateLong(date) {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
}
function getPeriodRange(type, refDate) {
  const d = new Date(`${refDate}T12:00:00`);
  if (type === 'day') return { start: refDate, end: refDate, label: dateLong(refDate) };
  if (type === 'week') {
    const day = d.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(d); start.setDate(d.getDate() - diff);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    return { start: iso(start), end: iso(end), label: `${shortDate(iso(start))} – ${shortDate(iso(end))}` };
  }
  const y = d.getFullYear(), m = d.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const end = `${y}-${String(m + 1).padStart(2, '0')}-${new Date(y, m + 1, 0).getDate()}`;
  return { start, end, label: periodName(start.slice(0, 7)) };
}
function periodRecords(type, refDate) {
  const range = getPeriodRange(type, refDate);
  return state.records.filter(r => r.date >= range.start && r.date <= range.end).sort((a, b) => b.date.localeCompare(a.date));
}
function targetText(key, value) { return key === 'customers' ? `${fmt.format(value)} orang` : money(value); }
function actualText(key, value) { return key === 'customers' ? `${fmt.format(value)} orang` : compactMoney(value); }
function percent(value) { return `${(value * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`; }
function weightedPoints(value) { return value === null ? '—' : `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })} poin`; }

const monthPicker = document.getElementById('monthPicker');
const vintageSelect = document.getElementById('vintageSelect');
function populateVintage() {
  vintageSelect.innerHTML = VINTAGES.map(v => `<option value="${v}">${v === 'M72+' ? 'M72+ (di atas 72 bulan)' : v}</option>`).join('');
  vintageSelect.value = getVintage();
}
function updateClock() {
  const now = new Date();
  document.getElementById('liveClock').textContent = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
  document.getElementById('liveDate').textContent = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
}
function toast(message) {
  const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}
function switchPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.target === name));
  const titles = { dashboard: 'Ringkasan Penjualan', entry: 'Input Penjualan', history: 'Riwayat Penjualan', reports: 'Laporan Performa' };
  document.getElementById('pageTitle').textContent = titles[name] || 'BISA Sales Tracker';
  if (name === 'reports') renderReport();
  if (name === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderDashboard() {
  const vintage = getVintage();
  const targets = targetsFor(vintage);
  const records = monthRecords();
  const perf = getPerformance(records, targets);
  document.getElementById('monthLabel').textContent = periodName(state.month);
  document.getElementById('scoreValue').textContent = perf.score === null ? '—' : perf.score.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  const ring = document.getElementById('scoreRing');
  const angle = perf.score === null ? 0 : Math.min(perf.score / 120, 1) * 360;
  ring.style.background = `conic-gradient(#fff ${angle}deg,rgba(255,255,255,.23) ${angle}deg)`;
  document.getElementById('metricGrid').innerHTML = perf.components.map(c => {
    const ratio = c.target > 0 ? c.ratio : 0;
    const pctWidth = Math.min(ratio, 1.2) / 1.2 * 100;
    const gap = Math.max(0, c.target - c.actual);
    return `<article class="metric-card">
      <div class="metric-top"><span class="metric-icon">${ICONS[c.key]}</span><span class="metric-weight">BOBOT ${Math.round(c.weight * 100)}%</span></div>
      <div class="metric-label">${LABELS[c.key]}</div><div class="metric-value">${actualText(c.key, c.actual)}</div>
      <div class="metric-meta"><span>Target ${targetText(c.key, c.target)}</span><span>${c.target ? percent(ratio) : 'Tanpa target'}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pctWidth}%"></div></div>
      <div class="metric-bottom"><span class="attain">${c.target ? `${percent(ratio)} tercapai` : 'Target belum tersedia'}</span><span class="component-score">${c.points === null ? '—' : weightedPoints(c.points)}</span></div>
    </article>`;
  }).join('');

  document.getElementById('gapList').innerHTML = perf.components.map(c => {
    const gap = Math.max(0, c.target - c.actual);
    return `<div class="gap-row"><div class="gap-name">${LABELS[c.key]}</div><div class="gap-detail">Realisasi ${actualText(c.key, c.actual)} dari ${targetText(c.key, c.target)}</div><div class="gap-amount ${gap === 0 && c.target > 0 ? 'done' : ''}">${c.target ? (gap === 0 ? 'Target tercapai' : c.key === 'customers' ? `${fmt.format(gap)} orang lagi` : compactMoney(gap)) : '—'}</div></div>`;
  }).join('');

  const [y, m] = state.month.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  const today = todayISO();
  let remaining = 0;
  if (state.month > currentMonth()) remaining = totalDays;
  else if (state.month === currentMonth()) remaining = Math.max(1, totalDays - Number(today.slice(-2)) + 1);
  const pace = Object.keys(WEIGHTS).map(key => {
    const gap = Math.max(0, targets[key] - perf.actual[key]);
    const perDay = remaining > 0 ? gap / remaining : gap;
    return `${key === 'customers' ? fmt.format(Math.ceil(perDay)) + ' org' : compactMoney(perDay)}`;
  });
  document.getElementById('dailyPace').innerHTML = `<strong>Ritme yang dibutuhkan:</strong> ${remaining ? `rata-rata per hari kalender tersisa (${remaining} hari) — Volume ${pace[0]}, Pelanggan ${pace[1]}, VAS ${pace[2]}, SAI ${pace[3]}.` : 'Periode sudah berakhir. Gunakan rekap bulan yang berjalan untuk melihat kebutuhan harian.'}`;

  const recent = [...records].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 4);
  document.getElementById('recentList').innerHTML = recent.length ? recent.map(r => `<div class="recent-item"><div class="recent-main"><div class="recent-date">${shortDate(r.date)}</div><div class="recent-note">${escapeHTML(r.note || 'Catatan penjualan')}</div></div><div class="recent-total">${compactMoney(r.volume)}</div></div>`).join('') : '<div class="empty-state">Belum ada catatan penjualan bulan ini.<br>Mulai dengan menambahkan hasil penjualan hari ini.</div>';
  document.getElementById('entryTargetMini').innerHTML = `<div class="mini-target-title">TARGET SALES VOLUME · ${vintage}</div><div class="mini-target-value">${targets.volume ? compactMoney(targets.volume) : 'Belum tersedia'}</div><div class="mini-target-copy">Target bulanan sesuai vintage yang dipilih</div>`;
}
function updateInputPreview() {
  const value = id => Number(document.getElementById(id).value) || 0;
  document.getElementById('previewVolume').textContent = compactMoney(value('entryVolume'));
  document.getElementById('previewCustomers').textContent = `${fmt.format(value('entryCustomers'))} orang`;
  document.getElementById('previewVas').textContent = compactMoney(value('entryVas'));
  document.getElementById('previewSai').textContent = compactMoney(value('entrySai'));
}
function resetForm() {
  editingId = null;
  document.getElementById('salesForm').reset();
  document.getElementById('recordId').value = '';
  document.getElementById('entryDate').value = todayISO();
  document.getElementById('formTitle').textContent = 'Input penjualan baru';
  document.getElementById('saveRecordBtn').innerHTML = 'Simpan penjualan <span>→</span>';
  document.getElementById('cancelEditBtn').hidden = true;
  document.getElementById('formFeedback').textContent = '';
  updateInputPreview();
}
function editRecord(id) {
  const r = state.records.find(x => x.id === id); if (!r) return;
  editingId = id;
  document.getElementById('recordId').value = id;
  document.getElementById('entryDate').value = r.date;
  document.getElementById('entryVolume').value = r.volume || '';
  document.getElementById('entryCustomers').value = r.customers || '';
  document.getElementById('entryVas').value = r.vas || '';
  document.getElementById('entrySai').value = r.sai || '';
  updateInputPreview();
  document.getElementById('entryNote').value = r.note || '';
  document.getElementById('formTitle').textContent = 'Edit catatan penjualan';
  document.getElementById('saveRecordBtn').innerHTML = 'Simpan perubahan <span>→</span>';
  document.getElementById('cancelEditBtn').hidden = false;
  switchPanel('entry');
}
function submitRecord(event) {
  event.preventDefault();
  const date = document.getElementById('entryDate').value;
  const volume = Number(document.getElementById('entryVolume').value) || 0;
  const customers = Number(document.getElementById('entryCustomers').value) || 0;
  const vas = Number(document.getElementById('entryVas').value) || 0;
  const sai = Number(document.getElementById('entrySai').value) || 0;
  const note = document.getElementById('entryNote').value.trim();
  if (!date) { toast('Pilih tanggal penjualan terlebih dahulu.'); return; }
  if ([volume, customers, vas, sai].some(v => v < 0 || !Number.isFinite(v))) { toast('Nilai penjualan tidak boleh negatif.'); return; }
  if (![volume, customers, vas, sai].some(v => v > 0) && !note) { toast('Isi minimal satu hasil penjualan atau catatan.'); return; }
  const payload = { id: editingId || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`), date, volume, customers, vas, sai, note, createdAt: new Date().toISOString() };
  if (editingId) {
    const idx = state.records.findIndex(r => r.id === editingId);
    if (idx >= 0) payload.createdAt = state.records[idx].createdAt || payload.createdAt;
    state.records = state.records.map(r => r.id === editingId ? payload : r);
  } else state.records.push(payload);
  state.month = date.slice(0, 7);
  monthPicker.value = state.month;
  document.getElementById('historyMonth').value = state.month;
  saveState(); renderAll(); resetForm();
  document.getElementById('formFeedback').textContent = editingId ? 'Perubahan berhasil disimpan.' : 'Penjualan berhasil disimpan.';
  toast('Catatan penjualan tersimpan.');
  switchPanel('dashboard');
}
function deleteRecord(id) {
  if (!confirm('Hapus catatan penjualan ini? Tindakan ini tidak bisa dibatalkan.')) return;
  state.records = state.records.filter(r => r.id !== id); saveState(); renderAll(); toast('Catatan berhasil dihapus.');
}
function renderHistory() {
  const month = document.getElementById('historyMonth').value || state.month;
  const query = (document.getElementById('historySearch').value || '').toLowerCase().trim();
  let records = state.records.filter(r => r.date.startsWith(month));
  if (query) records = records.filter(r => r.date.includes(query) || (r.note || '').toLowerCase().includes(query));
  records.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  document.getElementById('recordCount').textContent = `${records.length} catatan`;
  const rowHTML = r => `<tr><td>${shortDate(r.date)}</td><td class="money">${money(r.volume)}</td><td>${fmt.format(r.customers)}</td><td class="money">${money(r.vas)}</td><td class="money">${money(r.sai)}</td><td>${escapeHTML(r.note || '—')}</td><td><button class="action-link" data-edit="${r.id}">Edit</button><button class="action-link delete" data-delete="${r.id}">Hapus</button></td></tr>`;
  document.getElementById('historyRows').innerHTML = records.map(rowHTML).join('') || '<tr><td colspan="7"><div class="empty-state">Tidak ada catatan untuk filter ini.</div></td></tr>';
  document.getElementById('mobileHistoryRows').innerHTML = records.map(r => `<article class="mobile-record"><div class="mobile-record-head"><span class="mobile-record-date">${shortDate(r.date)}</span><strong class="mobile-record-total">${compactMoney(r.volume)}</strong></div><div class="mobile-record-grid"><div><span>Pelanggan Baru</span><strong>${fmt.format(r.customers)} orang</strong></div><div><span>Premi VAS</span><strong>${compactMoney(r.vas)}</strong></div><div><span>Premi SAI</span><strong>${money(r.sai)}</strong></div><div><span>Sales Volume</span><strong>${money(r.volume)}</strong></div></div><div class="mobile-record-note">${escapeHTML(r.note || 'Tanpa catatan')}</div><div class="mobile-record-actions"><button class="action-link" data-edit="${r.id}">Edit</button><button class="action-link delete" data-delete="${r.id}">Hapus</button></div></article>`).join('') || '<div class="empty-state">Belum ada catatan di bulan ini.</div>';
}
function buildReport(type, refDate) {
  const range = getPeriodRange(type, refDate);
  const records = periodRecords(type, refDate);
  const sum = totals(records);
  const monthly = refDate.slice(0, 7);
  const targets = targetsFor(getVintage(monthly));
  const monthPerf = getPerformance(monthRecords(monthly), targets);
  return { type, refDate, range, records, sum, targets, monthPerf, month: monthly, label: type === 'day' ? 'Harian' : type === 'week' ? 'Mingguan' : 'Bulanan' };
}
function renderReport() {
  const type = document.getElementById('reportPeriod').value;
  const refDate = document.getElementById('reportDate').value || todayISO();
  reportSnapshot = buildReport(type, refDate);
  const r = reportSnapshot;
  const title = `${r.label} · ${r.range.label}`;
  const recordsHTML = r.records.length ? r.records.map(x => `<tr><td>${shortDate(x.date)}</td><td>${money(x.volume)}</td><td>${fmt.format(x.customers)}</td><td>${money(x.vas)}</td><td>${money(x.sai)}</td><td>${escapeHTML(x.note || '—')}</td></tr>`).join('') : '<tr><td colspan="6">Tidak ada transaksi pada periode ini.</td></tr>';
  document.getElementById('reportPreview').innerHTML = `
    <div class="report-preview-head"><div><div class="section-overline">BISA · SALES PERFORMANCE</div><h3>${title}</h3><div class="date-line">Vintage ${getVintage(r.month)} · Dibuat ${dateLong(todayISO())}</div></div><span class="report-period-tag">${r.records.length} transaksi</span></div>
    <div class="report-stats"><div class="report-stat"><span>Total Sales Volume</span><strong>${compactMoney(r.sum.volume)}</strong></div><div class="report-stat"><span>Pelanggan Baru</span><strong>${fmt.format(r.sum.customers)}</strong></div><div class="report-stat"><span>Premi VAS</span><strong>${compactMoney(r.sum.vas)}</strong></div><div class="report-stat"><span>Premi SAI</span><strong>${compactMoney(r.sum.sai)}</strong></div><div class="report-stat"><span>Skor Tertimbang Bulanan</span><strong>${r.monthPerf.score === null ? '—' : `${r.monthPerf.score.toLocaleString('id-ID', { maximumFractionDigits: 1 })} poin`}</strong></div></div>
    <div class="report-table-title">Pencapaian scorecard bulan ${periodName(r.month)}</div>
    <div class="report-score-grid">${r.monthPerf.components.map(c => `<div class="report-score-box"><span>${LABELS[c.key]} · ${Math.round(c.weight * 100)}%</span><strong>${c.target ? percent(c.ratio) : '—'}</strong><span>Gap: ${c.target ? (c.key === 'customers' ? `${fmt.format(Math.max(0, c.target - c.actual))} orang` : compactMoney(Math.max(0, c.target - c.actual))) : '—'}</span></div>`).join('')}</div>
    <div class="report-table-title">Detail transaksi</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tanggal</th><th>Sales Volume</th><th>Pelanggan Baru</th><th>Premi VAS</th><th>Premi SAI</th><th>Catatan</th></tr></thead><tbody>${recordsHTML}</tbody></table></div>
  `;
  document.getElementById('printArea').innerHTML = makePrintHTML(r);
}
function makePrintHTML(r) {
  const rows = r.records.map(x => `<tr><td>${shortDate(x.date)}</td><td>${money(x.volume)}</td><td>${fmt.format(x.customers)}</td><td>${money(x.vas)}</td><td>${money(x.sai)}</td><td>${escapeHTML(x.note || '—')}</td></tr>`).join('') || '<tr><td colspan="6">Tidak ada transaksi pada periode ini.</td></tr>';
  const kpis = [['Sales Volume', compactMoney(r.sum.volume)], ['Pelanggan Baru', `${fmt.format(r.sum.customers)} orang`], ['Premi VAS', compactMoney(r.sum.vas)], ['Premi SAI', compactMoney(r.sum.sai)], ['Skor Tertimbang Bulanan', r.monthPerf.score === null ? '—' : `${r.monthPerf.score.toLocaleString('id-ID', { maximumFractionDigits: 1 })} poin`]];
  return `<h1>BISA — Sales Performance Report</h1><div class="print-sub">Bisa by Home Credit · ${r.label}: ${r.range.label} · Vintage ${getVintage(r.month)} · Dicetak ${dateLong(todayISO())}</div><div class="print-kpis">${kpis.map(x => `<div><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div><h2>Pencapaian scorecard bulanan · ${periodName(r.month)}</h2><table><thead><tr><th>Komponen</th><th>Bobot</th><th>Target</th><th>Realisasi</th><th>Pencapaian</th><th>Kekurangan</th></tr></thead><tbody>${r.monthPerf.components.map(c => `<tr><td>${LABELS[c.key]}</td><td>${Math.round(c.weight * 100)}%</td><td>${targetText(c.key, c.target)}</td><td>${actualText(c.key, c.actual)}</td><td>${c.target ? percent(c.ratio) : '—'}</td><td>${c.target ? targetText(c.key, Math.max(0, c.target - c.actual)) : '—'}</td></tr>`).join('')}</tbody></table><h2>Detail transaksi (${r.records.length} catatan)</h2><table><thead><tr><th>Tanggal</th><th>Sales Volume</th><th>Pelanggan Baru</th><th>Premi VAS</th><th>Premi SAI</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table><div class="print-brand">To The Next Target · Bisa by Home Credit</div>`;
}
function exportExcel() {
  const r = reportSnapshot || buildReport('month', todayISO());
  const esc = s => escapeHTML(s).replace(/\n/g, ' ');
  const cell = (value, type = 'String', style = '') => `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="${type}">${esc(value)}</Data></Cell>`;
  const row = cells => `<Row>${cells.join('')}</Row>`;
  const summaryRows = [
    row([cell('BISA — SALES PERFORMANCE REPORT', 'String', 'Title')]),
    row([cell(`${r.label}: ${r.range.label} · Vintage ${getVintage(r.month)}`)]),
    row([cell('Komponen'), cell('Bobot'), cell('Target'), cell('Realisasi'), cell('Pencapaian'), cell('Kekurangan')]),
    ...r.monthPerf.components.map(c => row([cell(LABELS[c.key]), cell(`${Math.round(c.weight * 100)}%`), cell(c.target), cell(c.actual), cell(c.target ? percent(c.ratio) : '—'), cell(c.target ? Math.max(0, c.target - c.actual) : '—')])) ,
    row([cell('RINGKASAN PERIODE')]),
    row([cell('Total Sales Volume'), cell(r.sum.volume, 'Number')]),
    row([cell('Pelanggan Baru'), cell(r.sum.customers, 'Number')]),
    row([cell('Premi VAS'), cell(r.sum.vas, 'Number')]),
    row([cell('Premi SAI'), cell(r.sum.sai, 'Number')]),
    row([cell('Skor tertimbang bulan ini'), cell(r.monthPerf.score ?? '—')])
  ].join('');
  const detailRows = [row(['Tanggal', 'Sales Volume (Rp)', 'Pelanggan Baru', 'Premi VAS (Rp)', 'Premi SAI (Rp)', 'Catatan'].map(x => cell(x))), ...r.records.map(x => row([cell(x.date), cell(x.volume, 'Number'), cell(x.customers, 'Number'), cell(x.vas, 'Number'), cell(x.sai, 'Number'), cell(x.note || '')]))].join('');
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Title"><Font ss:Bold="1" ss:Size="14" ss:Color="#E51C36"/></Style></Styles><Worksheet ss:Name="Ringkasan"><Table>${summaryRows}</Table></Worksheet><Worksheet ss:Name="Detail Transaksi"><Table>${detailRows}</Table></Worksheet></Workbook>`;
  downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), `BISA_Laporan_${r.type}_${r.refDate}.xls`);
  toast('File Excel berhasil dibuat.');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportBackup() {
  const content = JSON.stringify({ app: 'BISA Sales Tracker', exportedAt: new Date().toISOString(), ...state }, null, 2);
  downloadBlob(new Blob([content], { type: 'application/json' }), `BISA_Backup_${todayISO()}.json`);
  toast('Backup seluruh data berhasil dibuat.');
}
function printReport() {
  if (!reportSnapshot) renderReport();
  window.print();
}
function renderAll() {
  populateVintage();
  monthPicker.value = state.month;
  renderDashboard();
  renderHistory();
  if (document.getElementById('panel-reports').classList.contains('active')) renderReport();
}

// Navigation and controls
document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => switchPanel(b.dataset.target)));
document.addEventListener('click', e => {
  const go = e.target.closest('[data-goto]'); if (go) switchPanel(go.dataset.goto);
  const edit = e.target.closest('[data-edit]'); if (edit) editRecord(edit.dataset.edit);
  const del = e.target.closest('[data-delete]'); if (del) deleteRecord(del.dataset.delete);
});
monthPicker.addEventListener('change', () => { if (!monthPicker.value) return; state.month = monthPicker.value; document.getElementById('historyMonth').value = state.month; populateVintage(); saveState(); renderDashboard(); renderHistory(); });
vintageSelect.addEventListener('change', () => { state.vintages[state.month] = vintageSelect.value; saveState(); renderDashboard(); toast(`Target vintage ${vintageSelect.value} diterapkan.`); });
document.getElementById('salesForm').addEventListener('submit', submitRecord);
['entryVolume', 'entryCustomers', 'entryVas', 'entrySai'].forEach(id => document.getElementById(id).addEventListener('input', updateInputPreview));
document.getElementById('cancelEditBtn').addEventListener('click', resetForm);
document.getElementById('historySearch').addEventListener('input', renderHistory);
document.getElementById('historyMonth').addEventListener('change', renderHistory);
document.getElementById('reportPeriod').addEventListener('change', renderReport);
document.getElementById('reportDate').addEventListener('change', renderReport);
document.getElementById('refreshReportBtn').addEventListener('click', renderReport);
document.getElementById('pdfBtn').addEventListener('click', printReport);
document.getElementById('excelBtn').addEventListener('click', exportExcel);
document.getElementById('backupBtn').addEventListener('click', exportBackup);
document.getElementById('restoreBtn').addEventListener('click', () => document.getElementById('restoreInput').click());
document.getElementById('restoreInput').addEventListener('change', async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = Array.isArray(parsed.records) ? parsed.records : null;
    if (!imported || !confirm(`Pulihkan ${imported.length} catatan dari backup? Data saat ini akan digabung dengan data backup; ID yang sama akan diperbarui.`)) return;
    const map = new Map(state.records.map(r => [r.id, r]));
    imported.forEach(r => { if (r && r.id && r.date) map.set(r.id, { id: String(r.id), date: String(r.date), volume: Math.max(0, Number(r.volume) || 0), customers: Math.max(0, Number(r.customers) || 0), vas: Math.max(0, Number(r.vas) || 0), sai: Math.max(0, Number(r.sai) || 0), note: String(r.note || ''), createdAt: r.createdAt || new Date().toISOString() }); });
    state.records = Array.from(map.values());
    if (parsed.vintages && typeof parsed.vintages === 'object') state.vintages = { ...state.vintages, ...parsed.vintages };
    if (parsed.month && /^\d{4}-\d{2}$/.test(parsed.month)) state.month = parsed.month;
    saveState(); monthPicker.value = state.month; document.getElementById('historyMonth').value = state.month; renderAll(); toast('Backup berhasil dipulihkan.');
  } catch (err) { toast('File backup tidak valid atau tidak dapat dibaca.'); }
  event.target.value = '';
});
document.getElementById('installBtn').addEventListener('click', async () => {
  if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; document.getElementById('installBtn').hidden = true; }
  else toast('Gunakan menu browser ⋮ lalu pilih “Tambahkan ke layar utama” atau “Install app”.');
});

// Initial setup
monthPicker.value = state.month;
document.getElementById('entryDate').value = todayISO();
document.getElementById('historyMonth').value = state.month;
document.getElementById('reportDate').value = todayISO();
populateVintage(); updateClock(); setInterval(updateClock, 1000);
renderAll();
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; document.getElementById('installBtn').hidden = false; });
window.addEventListener('appinstalled', () => toast('BISA Sales Tracker berhasil dipasang.'));
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err));
setTimeout(() => { document.getElementById('splash').classList.add('hide'); document.getElementById('app').classList.remove('hidden'); }, 2250);
