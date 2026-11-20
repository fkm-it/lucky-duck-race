/**
 * io.js — Baca Excel/CSV (SheetJS, dimuat bila perlu) dan eksport XLSX / CSV / PDF (cetak).
 */
import { readFileAs, download, esc, fmtDate, fmtTime } from './util.js';
import { toCsv, safeCell } from './logic.js';

let xlsxP = null;
export function loadXLSX() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (xlsxP) return xlsxP;
  xlsxP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.full.min.js';
    s.onload = () => resolve(globalThis.XLSX);
    s.onerror = () => { xlsxP = null; reject(new Error('Gagal memuat pustaka Excel.')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}

const MAX_FILE = 20 * 1024 * 1024;

/**
 * Baca fail → { sheets: [{name, rows: any[][]}] }
 * Semua sel dibaca sebagai TEKS terformat (raw:false) supaya Staff ID "000123" kekal.
 */
export async function readSpreadsheet(file) {
  if (!file) throw new Error('Tiada fail dipilih.');
  if (file.size > MAX_FILE) throw new Error('Fail melebihi 20MB.');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['xlsx', 'xls', 'csv'].includes(ext)) throw new Error('Format tidak disokong. Gunakan .xlsx, .xls atau .csv');
  const XLSX = await loadXLSX();
  let wb;
  if (ext === 'csv') {
    let text = await readFileAs(file, 'text');
    text = text.replace(/^﻿/, '');
    wb = XLSX.read(text, { type: 'string', raw: true, cellDates: false }); // raw: semua kekal teks
  } else {
    const buf = await readFileAs(file, 'arrayBuffer');
    wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true, cellText: true, sheetRows: 100001 });
  }
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    return { name, rows };
  }).filter((s) => s.rows.length);
  if (!sheets.length) throw new Error('Fail tidak mengandungi data.');
  return { sheets };
}

// ----------------------------------------------------------------------------- Eksport

export const WINNER_COLUMNS = [
  ['ID Cabutan', (w) => w.drawId],
  ['No. Pemenang', (w) => w.winnerNo],
  ['No. Itik', (w) => w.duckNo],
  ['Nama Peserta', (w) => w.name],
  ['No. Pekerja', (w) => w.staffId],
  ['Jabatan', (w) => w.department],
  ['Kategori Hadiah', (w) => w.prizeCategory],
  ['Nama Hadiah', (w) => w.prizeName],
  ['No. Hadiah', (w) => w.prizeNumber],
  ['Tarikh Cabutan', (w) => fmtDate(w.drawAt)],
  ['Masa Cabutan', (w) => fmtTime(w.drawAt)],
  ['Status', (w) => (w.revoked ? 'Dipulihkan (layak semula)' : 'Pemenang')],
];

export const PARTICIPANT_COLUMNS = [
  ['No. Itik', (p) => p.duckNo],
  ['Nama Staf', (p) => p.name],
  ['No. Pekerja', (p) => p.staffId],
  ['Jabatan', (p) => p.department],
  ['Status', (p) => (p.status === 'WINNER' ? 'Pemenang' : 'Layak')],
  ['Bil. Kemenangan', (p) => p.winCount || 0],
];

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export async function exportXlsx(name, columns, rows, sheetName = 'Data') {
  const XLSX = await loadXLSX();
  const aoa = [columns.map((c) => c[0])].concat(rows.map((r) => columns.map((c) => {
    const v = c[1](r);
    return typeof v === 'number' ? v : safeCell(v);
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // No. Pekerja sebagai TEKS (format '@') supaya sifar di hadapan kekal apabila dibuka
  const sidCol = columns.findIndex((c) => c[0] === 'No. Pekerja');
  if (sidCol >= 0) {
    for (let r = 1; r < aoa.length; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: sidCol });
      if (ws[ref]) { ws[ref].t = 's'; ws[ref].z = '@'; }
    }
  }
  ws['!cols'] = columns.map((c, i) => ({ wch: Math.min(40, Math.max(c[0].length, ...aoa.slice(1, 200).map((r) => String(r[i]).length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(name + '-' + stamp() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export function exportCsv(name, columns, rows) {
  const csv = toCsv([columns.map((c) => c[0])].concat(rows.map((r) => columns.map((c) => c[1](r)))));
  download(name + '-' + stamp() + '.csv', csv, 'text/csv;charset=utf-8');
}

/** Laporan boleh cetak → pengguna pilih "Save as PDF". */
export function printReport({ title, subtitle, columns, rows, footer = '' }) {
  const root = document.getElementById('print-root');
  const head = columns.map((c) => '<th>' + esc(c[0]) + '</th>').join('');
  const body = rows.map((r) => '<tr>' + columns.map((c) => '<td>' + esc(c[1](r)) + '</td>').join('') + '</tr>').join('');
  root.innerHTML = '<div class="pr-head"><div class="pr-logo">🤘</div><div><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + '</p></div></div>' +
    '<table class="pr-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>' +
    '<p class="pr-foot">' + esc(footer) + '</p>';
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
}

/** Templat import untuk dimuat turun (No. Pekerja diformat sebagai Teks). */
export async function downloadTemplate() {
  const XLSX = await loadXLSX();
  const aoa = [['Nama Staf', 'No. Pekerja', 'Jabatan'], ['Ahmad bin Ali', '000123', 'Unit IT'], ['Siti Aminah binti Yusof', '000456', 'Kewangan']];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (let r = 1; r < aoa.length; r++) { const ref = 'B' + (r + 1); ws[ref].t = 's'; ws[ref].z = '@'; }
  ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Senarai Staf');
  download('templat-peserta-lucky-duck.xlsx', new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]));
}
