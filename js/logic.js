/**
 * logic.js — Logik tulen (tiada DOM / IndexedDB) supaya boleh diuji dalam Node.
 *   1. Normalisasi & validasi data import
 *   2. Kiraan status hadiah
 *   3. Pelan pergerakan perlumbaan (VISUAL SAHAJA — pemenang sudah ditentukan sebelum ini)
 */

// ----------------------------------------------------------------------------- 1. Import

export const FIELD_LIMITS = Object.freeze({ name: 120, staffId: 40, department: 120 });
const STAFF_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/;

/** Teks bersih: buang aksara kawalan, ruang berganda, trim. */
export function cleanText(v, max = 200) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Staff ID sentiasa TEKS. Sifar di hadapan dikekalkan (tiada penukaran nombor).
 * Nilai seperti "1.23E+5" (Excel saintifik) ditandakan tidak sah supaya pentadbir membetulkan fail.
 */
export function normalizeStaffId(v) {
  return cleanText(v, FIELD_LIMITS.staffId + 1).toUpperCase();
}

export function validateStaffId(id) {
  if (!id) return 'No. Pekerja kosong';
  if (id.length > FIELD_LIMITS.staffId) return 'No. Pekerja melebihi ' + FIELD_LIMITS.staffId + ' aksara';
  if (/^\d+(\.\d+)?E[+-]?\d+$/i.test(id)) return 'No. Pekerja dalam format saintifik Excel (cth. 1.2E+5) — tetapkan format lajur sebagai Teks';
  if (!STAFF_ID_RE.test(id)) return 'No. Pekerja mengandungi aksara tidak sah';
  return '';
}

/** Teka lajur berdasarkan nama tajuk. */
export function guessMapping(headers) {
  const norm = headers.map((h) => cleanText(h).toLowerCase());
  const find = (...keys) => {
    for (const k of keys) {
      const i = norm.findIndex((h) => h === k);
      if (i >= 0) return i;
    }
    for (const k of keys) {
      const i = norm.findIndex((h) => h.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    name: find('staff name', 'nama staf', 'nama pekerja', 'nama', 'name', 'participant'),
    staffId: find('staff id', 'no. pekerja', 'no pekerja', 'id staf', 'no staf', 'no. staf', 'staff no', 'employee id', 'id'),
    department: find('department', 'jabatan', 'unit', 'bahagian', 'dept', 'fakulti'),
  };
}

/**
 * Validasi baris import.
 * @param {Array<Array<any>>} rows  baris data (tanpa tajuk)
 * @param {{name:number, staffId:number, department:number}} map indeks lajur (-1 = tiada)
 * @param {Set<string>} existingIds Staff ID yang sudah ada dalam pangkalan data
 * @returns {{items:Array, summary:object}}
 *   items[i] = { row, name, staffId, department, status: 'ok'|'error'|'dupFile'|'exists', message }
 */
export function validateRows(rows, map, existingIds = new Set()) {
  const seen = new Map();
  const items = [];
  rows.forEach((r, i) => {
    const get = (idx) => (idx >= 0 && Array.isArray(r) ? r[idx] : '');
    const name = cleanText(get(map.name), FIELD_LIMITS.name + 1);
    const staffId = normalizeStaffId(get(map.staffId));
    const department = cleanText(get(map.department), FIELD_LIMITS.department + 1);
    if (!name && !staffId && !department) return; // baris kosong diabaikan
    const it = { row: i + 2, name, staffId, department, status: 'ok', message: '' };
    const errs = [];
    if (!name) errs.push('Nama kosong');
    else if (name.length > FIELD_LIMITS.name) errs.push('Nama terlalu panjang');
    const idErr = validateStaffId(staffId);
    if (idErr) errs.push(idErr);
    if (department.length > FIELD_LIMITS.department) errs.push('Jabatan terlalu panjang');
    if (errs.length) {
      it.status = 'error';
      it.message = errs.join('; ');
    } else if (seen.has(staffId)) {
      it.status = 'dupFile';
      it.message = 'No. Pekerja berulang dalam fail (baris ' + seen.get(staffId) + ')';
    } else if (existingIds.has(staffId)) {
      it.status = 'exists';
      it.message = 'No. Pekerja sudah wujud dalam pangkalan data';
    }
    if (staffId && !seen.has(staffId) && it.status !== 'error') seen.set(staffId, it.row);
    if (!department && it.status === 'ok') it.message = 'Jabatan kosong (dibenarkan)';
    items.push(it);
  });
  const summary = {
    total: items.length,
    ok: items.filter((x) => x.status === 'ok').length,
    error: items.filter((x) => x.status === 'error').length,
    dupFile: items.filter((x) => x.status === 'dupFile').length,
    exists: items.filter((x) => x.status === 'exists').length,
  };
  return { items, summary };
}

/** Elak "formula injection" apabila dibuka dalam Excel (CSV/XLSX). */
export function safeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ----------------------------------------------------------------------------- 2. Hadiah

export const PRIZE_CATEGORIES = Object.freeze([
  'Hadiah Utama', 'Hadiah Pertama', 'Hadiah Kedua', 'Hadiah Ketiga', 'Hadiah Sagu Hati', 'Hadiah Istimewa',
]);

/** Nama kategori versi lama (Inggeris) → Bahasa Melayu. */
export const LEGACY_CATEGORY = Object.freeze({
  'Grand Prize': 'Hadiah Utama', 'First Prize': 'Hadiah Pertama', 'Second Prize': 'Hadiah Kedua',
  'Third Prize': 'Hadiah Ketiga', 'Consolation Prize': 'Hadiah Sagu Hati', 'Special Prize': 'Hadiah Istimewa',
});

/**
 * Status setiap hadiah: berapa sudah dimenangi (rekod aktif sahaja) dan baki.
 * @returns {Array<{prize, awarded, remaining}>} disusun mengikut sequence
 */
export function prizeStatus(prizes, winners) {
  const active = winners.filter((w) => !w.revoked);
  return [...prizes]
    .sort((a, b) => (a.sequence - b.sequence) || String(a.id).localeCompare(String(b.id)))
    .map((p) => {
      const awarded = active.filter((w) => w.prizeId === p.id).length;
      return { prize: p, awarded, remaining: Math.max(0, (p.quantity | 0) - awarded) };
    });
}

export function totalWinnersRequired(prizes) {
  return prizes.reduce((s, p) => s + Math.max(0, p.quantity | 0), 0);
}

// ----------------------------------------------------------------------------- 3. Pelan perlumbaan

/** Interpolasi monotonik (Fritsch–Carlson) → kelajuan lancar, tiada undur ke belakang. */
function monotoneTangents(ys) {
  const n = ys.length;
  const h = 1 / (n - 1);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / h);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

function evalMonotone(ys, ms, u) {
  const n = ys.length;
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const h = 1 / (n - 1);
  const i = Math.min(n - 2, Math.floor(u / h));
  const t = (u - i * h) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] +
    (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
}

/**
 * Pelan pergerakan. `rand` ialah Math.random biasa (VISUAL sahaja; tidak menyentuh keputusan).
 * Pemenang (winnerRanks[i] = kedudukan 1..k, 0 = bukan pemenang) dijamin melintasi garisan
 * penamat MENGIKUT SUSUNAN, dan tiada bukan-pemenang melintasi sebelum pemenang terakhir.
 *
 * @param {number} count bilangan itik
 * @param {number[]} winnerIndices indeks itik pemenang mengikut susunan (#1 dahulu)
 * @param {{duration?:number, rand?:Function}} opt
 */
export function planRace(count, winnerIndices, opt = {}) {
  const rand = opt.rand || Math.random;
  const T = Math.max(5, opt.duration || 15); // masa pemenang #1 tiba (s)
  const k = winnerIndices.length;
  const gap = k <= 1 ? 0 : Math.min(1.1, Math.max(0.35, 7 / k));
  const lastWin = T + (k - 1) * gap;
  const K = 8; // segmen keyframe
  const rank = new Int32Array(count);
  winnerIndices.forEach((d, i) => { rank[d] = i + 1; });

  const ducks = new Array(count);
  for (let d = 0; d < count; d++) {
    const r = rank[d];
    let finish;
    const w = [];
    const decoy = !r && rand() < 0.08;
    for (let s = 0; s < K; s++) {
      let wt = 0.75 + rand() * 0.6;
      if (r) {
        // Pemenang: tidak semestinya di hadapan awal — pecutan di separuh akhir
        if (s < K / 2) wt *= 0.8 + rand() * 0.35;
        else wt *= 1.05 + rand() * 0.45;
      } else if (decoy) {
        if (s < K * 0.6) wt *= 1.35 + rand() * 0.4; // "umpan": laju awal, perlahan di akhir
        else wt *= 0.55;
      }
      w.push(wt);
    }
    if (r) finish = T + (r - 1) * gap;
    else finish = lastWin + 0.25 + rand() * (2.5 + T * 0.25);
    const sum = w.reduce((a, b) => a + b, 0);
    const ys = [0];
    let acc = 0;
    for (let s = 0; s < K; s++) { acc += w[s] / sum; ys.push(Math.min(1, acc)); }
    ys[K] = 1;
    ducks[d] = { finish, ys, ms: monotoneTangents(ys), rank: r, phase: rand() * Math.PI * 2, gait: 0.85 + rand() * 0.35 };
  }
  return { count, T, gap, lastWin, endTime: lastWin + 1.2, ducks, winners: winnerIndices.slice() };
}

/**
 * Susun atur grid itik di garisan permulaan (sama untuk 3D & 2D).
 * Itik disusun mengikut nombor itik: lorong = i % lanes, baris = floor(i / lanes).
 * Baris belakang bermula sedikit di belakang garisan — TIDAK menjejaskan keputusan (pemenang telah ditetapkan).
 */
export function computeLayout(n, trackLen = 100) {
  const lanes = Math.max(1, Math.min(n, Math.max(6, Math.ceil(Math.sqrt(n * 3))), 64));
  const rows = Math.max(1, Math.ceil(n / lanes));
  const laneW = 1.25;
  const rowGap = 1.35;
  const width = lanes * laneW;
  const pos = new Array(n);
  for (let i = 0; i < n; i++) {
    const lane = i % lanes; const row = Math.floor(i / lanes);
    pos[i] = { lane, row, z: (lane + 0.5) * laneW - width / 2, startX: -row * rowGap - 0.8 };
  }
  return { n, lanes, rows, laneW, rowGap, width, depth: rows * rowGap, trackLen, finishX: trackLen, pos };
}

/** Kemajuan 0..1 itik d pada masa t (s) sejak GO. */
export function progressAt(plan, d, t) {
  const p = plan.ducks[d];
  return evalMonotone(p.ys, p.ms, t / p.finish);
}
