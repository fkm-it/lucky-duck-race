/**
 * store.js — Lapisan servis domain: peserta, hadiah, cabutan, pemenang, audit, tetapan.
 * Semua peraturan perniagaan kritikal (pemenang unik, buang daripada kumpulan layak,
 * pemulihan, reset) dikuatkuasa di sini dalam transaksi IndexedDB.
 */
import { tx, reqP, getAll, get, put, count, openDb } from './db.js';
import { pickUnique, randomHex, sha256Hex } from './rng.js';
import { cleanText, normalizeStaffId, validateStaffId, FIELD_LIMITS, prizeStatus } from './logic.js';

export const STATUS = Object.freeze({ ELIGIBLE: 'ELIGIBLE', WINNER: 'WINNER' });

// ----------------------------------------------------------------------------- Tetapan

export const DEFAULT_SETTINGS = Object.freeze({
  eventName: '',
  subtitle: 'LET THE LUCK RACE BEGIN!',
  renderMode: 'auto', // auto | 3d | 2d
  quality: 'high', // high | low
  raceDuration: 15,
  revealMode: 'one', // one | finale
  highlightDuringRace: false,
  allowMultipleWins: false,
  soundEnabled: false, // WAJIB lalai: senyap sehingga admin hidupkan
  masterVolume: 0.8,
  volumes: { countdown: 0.8, horn: 0.8, running: 0.4, music: 0.35, victory: 0.9, applause: 0.7, fireworks: 0.6 },
});

let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const rec = await get('settings', 'app');
  const v = rec ? rec.value : {};
  settingsCache = { ...DEFAULT_SETTINGS, ...v, volumes: { ...DEFAULT_SETTINGS.volumes, ...(v.volumes || {}) } };
  return settingsCache;
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, volumes: { ...cur.volumes, ...(patch.volumes || {}) } };
  next.raceDuration = Math.min(60, Math.max(8, Number(next.raceDuration) || 15));
  next.eventName = cleanText(next.eventName, 120);
  next.subtitle = cleanText(next.subtitle, 120) || DEFAULT_SETTINGS.subtitle;
  await put('settings', { key: 'app', value: next });
  settingsCache = next;
  return next;
}

// ----------------------------------------------------------------------------- Audit

function auditRec(action, detail) {
  return { at: new Date().toISOString(), action, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
}

export async function audit(action, detail = '') {
  await tx('audit', 'readwrite', (s) => reqP(s.audit.add(auditRec(action, detail))));
}

export async function listAudit(limit = 500) {
  const all = await getAll('audit');
  return all.reverse().slice(0, limit);
}

// ----------------------------------------------------------------------------- Peserta

export async function listParticipants() {
  const all = await getAll('participants');
  return all.sort((a, b) => a.duckNo - b.duckNo);
}

export const listEligible = async () => (await getAll('participants', 'status', STATUS.ELIGIBLE)).sort((a, b) => a.duckNo - b.duckNo);

export async function existingIds() {
  const keys = await tx('participants', 'readonly', (s) => reqP(s.participants.getAllKeys()));
  return new Set(keys);
}

async function nextDuckNoIn(stores) {
  const rec = await reqP(stores.settings.get('duckSeq'));
  return rec ? rec.value : 1;
}

function sanitizeParticipant(p) {
  const name = cleanText(p.name, FIELD_LIMITS.name);
  const staffId = normalizeStaffId(p.staffId);
  const department = cleanText(p.department, FIELD_LIMITS.department);
  if (!name) throw new Error('Nama peserta wajib diisi.');
  const e = validateStaffId(staffId);
  if (e) throw new Error(e);
  return { name, staffId, department };
}

export async function addParticipant(p) {
  const clean = sanitizeParticipant(p);
  const now = new Date().toISOString();
  await tx(['participants', 'settings', 'audit'], 'readwrite', async (s) => {
    const exists = await reqP(s.participants.get(clean.staffId));
    if (exists) throw new Error('Staff ID ' + clean.staffId + ' sudah wujud.');
    const no = await nextDuckNoIn(s);
    await reqP(s.participants.add({ ...clean, duckNo: no, status: STATUS.ELIGIBLE, winCount: 0, createdAt: now, updatedAt: now }));
    await reqP(s.settings.put({ key: 'duckSeq', value: no + 1 }));
    await reqP(s.audit.add(auditRec('PESERTA_TAMBAH', clean.staffId + ' — ' + clean.name)));
  });
}

export async function updateParticipant(originalId, p) {
  const clean = sanitizeParticipant(p);
  await tx(['participants', 'audit'], 'readwrite', async (s) => {
    const cur = await reqP(s.participants.get(originalId));
    if (!cur) throw new Error('Peserta tidak dijumpai.');
    if (clean.staffId !== originalId) {
      const clash = await reqP(s.participants.get(clean.staffId));
      if (clash) throw new Error('Staff ID ' + clean.staffId + ' sudah digunakan.');
      await reqP(s.participants.delete(originalId));
    }
    await reqP(s.participants.put({ ...cur, ...clean, updatedAt: new Date().toISOString() }));
    await reqP(s.audit.add(auditRec('PESERTA_SUNTING', originalId + (clean.staffId !== originalId ? ' → ' + clean.staffId : ''))));
  });
}

export async function deleteParticipants(ids) {
  await tx(['participants', 'audit'], 'readwrite', async (s) => {
    for (const id of ids) await reqP(s.participants.delete(id));
    await reqP(s.audit.add(auditRec('PESERTA_PADAM', ids.length + ' rekod: ' + ids.slice(0, 20).join(', ') + (ids.length > 20 ? '…' : ''))));
  });
}

/**
 * Import pukal. items = baris yang sudah divalidasi (status ok / exists).
 * mode: 'skip' (abaikan Staff ID sedia ada) | 'update' (kemas kini nama/jabatan sahaja — status menang dikekalkan)
 */
export async function importParticipants(items, mode = 'skip', fileName = '') {
  const now = new Date().toISOString();
  return tx(['participants', 'settings', 'audit'], 'readwrite', async (s) => {
    let no = await nextDuckNoIn(s);
    let added = 0; let updated = 0; let skipped = 0;
    for (const it of items) {
      const clean = sanitizeParticipant(it);
      const cur = await reqP(s.participants.get(clean.staffId));
      if (cur) {
        if (mode === 'update') {
          await reqP(s.participants.put({ ...cur, name: clean.name, department: clean.department, updatedAt: now }));
          updated++;
        } else skipped++;
        continue;
      }
      await reqP(s.participants.add({ ...clean, duckNo: no++, status: STATUS.ELIGIBLE, winCount: 0, createdAt: now, updatedAt: now }));
      added++;
    }
    await reqP(s.settings.put({ key: 'duckSeq', value: no }));
    await reqP(s.audit.add(auditRec('IMPORT', { fail: fileName, ditambah: added, dikemaskini: updated, dilangkau: skipped })));
    return { added, updated, skipped };
  });
}

// ----------------------------------------------------------------------------- Hadiah

export const listPrizes = async () => (await getAll('prizes')).sort((a, b) => (a.sequence - b.sequence) || a.id.localeCompare(b.id));

export async function savePrize(p) {
  const rec = {
    id: p.id || 'PRZ-' + randomHex(4).toUpperCase(),
    category: cleanText(p.category, 60) || 'Special Prize',
    name: cleanText(p.name, 120),
    description: cleanText(p.description, 500),
    quantity: Math.max(1, Math.min(10000, parseInt(p.quantity, 10) || 1)),
    sequence: Math.max(1, Math.min(999, parseInt(p.sequence, 10) || 1)),
    image: typeof p.image === 'string' && p.image.startsWith('data:image/') ? p.image : '',
    updatedAt: new Date().toISOString(),
  };
  if (!rec.name) throw new Error('Nama hadiah wajib diisi.');
  const winners = await getAll('winners', 'prizeId', rec.id);
  const active = winners.filter((w) => !w.revoked).length;
  if (rec.quantity < active) throw new Error('Bilangan pemenang tidak boleh kurang daripada ' + active + ' (sudah dicabut).');
  await put('prizes', rec);
  await audit(p.id ? 'HADIAH_SUNTING' : 'HADIAH_TAMBAH', rec.category + ' — ' + rec.name + ' ×' + rec.quantity);
  return rec;
}

export async function deletePrize(id) {
  const winners = await getAll('winners', 'prizeId', id);
  if (winners.some((w) => !w.revoked)) throw new Error('Hadiah ini sudah mempunyai pemenang. Pulihkan pemenang dahulu atau reset cabutan.');
  await tx(['prizes', 'audit'], 'readwrite', async (s) => {
    await reqP(s.prizes.delete(id));
    await reqP(s.audit.add(auditRec('HADIAH_PADAM', id)));
  });
}

export async function getPrizeStatus() {
  const [prizes, winners] = await Promise.all([listPrizes(), getAll('winners')]);
  return prizeStatus(prizes, winners);
}

// ----------------------------------------------------------------------------- Cabutan

export const listWinners = async () => (await getAll('winners')).sort((a, b) => a.winnerNo - b.winnerNo);
export const listDraws = async () => (await getAll('draws')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
export const getDraw = (id) => get('draws', id);

/** Kumpulan layak untuk cabutan (dipaparkan sebelum perlumbaan). */
export async function eligiblePool() {
  const st = await getSettings();
  if (st.allowMultipleWins) return listParticipants();
  return listEligible();
}

function drawId() {
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return 'DRW-' + ymd + '-' + randomHex(3).toUpperCase();
}

/**
 * CABUTAN — fungsi paling kritikal.
 * 1. (Kunci antara tab) navigator.locks
 * 2. Dalam SATU transaksi: baca kumpulan layak semasa, pilih secara rawak kriptografi,
 *    sahkan semula status, tanda WINNER, simpan rekod pemenang + cabutan + audit.
 * 3. Selepas commit: kira kod integriti SHA-256 dan simpan.
 *
 * @param {{prizeId?:string, count:number, revealMode:string}} opt
 * @returns {Promise<{draw, winners, pool}>}
 */
export async function executeDraw(opt) {
  const run = () => executeDrawInner(opt);
  if (globalThis.navigator && navigator.locks && navigator.locks.request) {
    return navigator.locks.request('lucky-duck-draw', run);
  }
  return run();
}

async function executeDrawInner({ prizeId = '', count: wanted, revealMode = 'one' }) {
  const st = await getSettings();
  const k = parseInt(wanted, 10);
  if (!Number.isInteger(k) || k < 1) throw new Error('Bilangan pemenang mesti sekurang-kurangnya 1.');
  const now = new Date();
  const id = drawId();
  const salt = randomHex(16);

  const result = await tx(['participants', 'winners', 'draws', 'prizes', 'audit', 'settings'], 'readwrite', async (s) => {
    let prize = null;
    if (prizeId) {
      prize = await reqP(s.prizes.get(prizeId));
      if (!prize) throw new Error('Hadiah tidak dijumpai.');
    }
    const all = await reqP(s.participants.getAll());
    const pool = (st.allowMultipleWins ? all : all.filter((p) => p.status === STATUS.ELIGIBLE)).sort((a, b) => a.duckNo - b.duckNo);
    if (pool.length === 0) throw new Error('Tiada peserta layak.');
    if (k > pool.length) throw new Error('Bilangan pemenang (' + k + ') melebihi peserta layak (' + pool.length + ').');

    const allWinners = await reqP(s.winners.getAll());
    let prizeNoStart = 1;
    if (prize) {
      const awarded = allWinners.filter((w) => w.prizeId === prize.id && !w.revoked).length;
      if (awarded + k > prize.quantity) throw new Error('Baki hadiah ' + prize.name + ' hanya ' + (prize.quantity - awarded) + '.');
      prizeNoStart = awarded + 1;
    }
    const seqRec = await reqP(s.settings.get('winnerSeq'));
    let winnerNo = seqRec ? seqRec.value : 1;

    // ---- PEMILIHAN RAWAK (crypto) — sebelum animasi, bebas daripada visual
    const picked = pickUnique(pool.length, k);

    const iso = now.toISOString();
    // Data dibaca dalam transaksi yang SAMA (terpencil), jadi status di bawah ialah status terkini.
    // Semua tulisan dihantar serentak (tanpa menunggu satu demi satu) → pantas walaupun 100+ pemenang.
    const byId = new Map(all.map((p) => [p.staffId, p]));
    for (const i of picked) {
      const p = byId.get(pool[i].staffId);
      if (!st.allowMultipleWins && p.status !== STATUS.ELIGIBLE) throw new Error('Peserta ' + p.staffId + ' sudah menang (konflik serentak). Cabutan dibatalkan.');
    }
    const winners = [];
    const writes = [];
    for (let i = 0; i < picked.length; i++) {
      const fresh = byId.get(pool[picked[i]].staffId);
      writes.push(reqP(s.participants.put({ ...fresh, status: STATUS.WINNER, winCount: (fresh.winCount || 0) + 1, lastWonAt: iso, updatedAt: iso })));
      const w = {
        drawId: id, winnerNo: winnerNo++, rankInDraw: i + 1,
        prizeId: prize ? prize.id : '', prizeCategory: prize ? prize.category : 'Cabutan Khas', prizeName: prize ? prize.name : 'Cabutan Khas',
        prizeNumber: prizeNoStart + i,
        staffId: fresh.staffId, name: fresh.name, department: fresh.department, duckNo: fresh.duckNo,
        drawAt: iso, revoked: false,
      };
      writes.push(reqP(s.winners.add(w)).then((key) => { w.id = key; }));
      winners.push(w);
    }
    writes.push(reqP(s.settings.put({ key: 'winnerSeq', value: winnerNo })));
    const draw = {
      id, createdAt: iso, prizeId: prize ? prize.id : '', prizeCategory: prize ? prize.category : 'Cabutan Khas',
      prizeName: prize ? prize.name : 'Cabutan Khas', count: k, poolSize: pool.length,
      poolIds: pool.map((p) => p.staffId), winnerIds: winners.map((w) => w.staffId),
      revealMode, status: 'COMMITTED', salt, allowMultipleWins: !!st.allowMultipleWins, integrity: '',
    };
    writes.push(reqP(s.draws.add(draw)));
    writes.push(reqP(s.audit.add(auditRec('CABUTAN', { id, hadiah: draw.prizeName, pemenang: k, layak: pool.length, staff: draw.winnerIds }))));
    await Promise.all(writes);
    return { draw, winners, pool };
  });

  // Kod integriti: SHA-256(id | salt | senarai layak | senarai pemenang). Boleh disemak semula daripada laporan.
  const integrity = await sha256Hex([result.draw.id, result.draw.salt, result.draw.poolIds.join(','), result.draw.winnerIds.join(',')].join('|'));
  result.draw.integrity = integrity;
  await tx('draws', 'readwrite', async (s) => {
    const d = await reqP(s.draws.get(result.draw.id));
    if (d) await reqP(s.draws.put({ ...d, integrity }));
  });
  return result;
}

export async function markDrawRevealed(id) {
  await tx(['draws'], 'readwrite', async (s) => {
    const d = await reqP(s.draws.get(id));
    if (d && d.status !== 'REVEALED') await reqP(s.draws.put({ ...d, status: 'REVEALED', revealedAt: new Date().toISOString() }));
  });
}

/** Data untuk main semula perlumbaan cabutan yang sudah dibuat (keputusan sama — tiada pemilihan baharu). */
export async function drawReplayData(id) {
  const d = await get('draws', id);
  if (!d) throw new Error('Cabutan tidak dijumpai.');
  const [winnersAll, participants] = await Promise.all([getAll('winners', 'drawId', id), getAll('participants')]);
  const map = new Map(participants.map((p) => [p.staffId, p]));
  const winners = winnersAll.sort((a, b) => a.rankInDraw - b.rankInDraw);
  const pool = d.poolIds.map((sid, i) => map.get(sid) || { staffId: sid, name: '(dipadam)', department: '', duckNo: 100000 + i });
  return { draw: d, winners, pool };
}

/** Pulihkan kelayakan pemenang (rekod sejarah dikekalkan dengan tanda 'revoked'). */
export async function restoreWinner(winnerId, reason = '') {
  await tx(['winners', 'participants', 'audit'], 'readwrite', async (s) => {
    const w = await reqP(s.winners.get(winnerId));
    if (!w) throw new Error('Rekod pemenang tidak dijumpai.');
    if (w.revoked) throw new Error('Rekod ini sudah dipulihkan.');
    const iso = new Date().toISOString();
    await reqP(s.winners.put({ ...w, revoked: true, revokedAt: iso, revokeReason: cleanText(reason, 200) }));
    const p = await reqP(s.participants.get(w.staffId));
    if (p) {
      const others = (await reqP(s.winners.index('staffId').getAll(w.staffId))).filter((x) => x.id !== w.id && !x.revoked);
      await reqP(s.participants.put({ ...p, status: others.length ? STATUS.WINNER : STATUS.ELIGIBLE, winCount: others.length, updatedAt: iso }));
    }
    await reqP(s.audit.add(auditRec('PEMENANG_PULIH', w.staffId + ' (' + w.prizeName + ' #' + w.prizeNumber + ') ' + cleanText(reason, 200))));
  });
}

/** Reset semua keputusan: kosongkan sejarah pemenang & cabutan, semua peserta kembali layak. */
export async function resetAllDraws() {
  await tx(['winners', 'draws', 'participants', 'settings', 'audit'], 'readwrite', async (s) => {
    const n = await reqP(s.winners.count());
    await reqP(s.winners.clear());
    await reqP(s.draws.clear());
    const all = await reqP(s.participants.getAll());
    const iso = new Date().toISOString();
    for (const p of all) {
      if (p.status !== STATUS.ELIGIBLE || p.winCount) await reqP(s.participants.put({ ...p, status: STATUS.ELIGIBLE, winCount: 0, updatedAt: iso }));
    }
    await reqP(s.settings.put({ key: 'winnerSeq', value: 1 }));
    await reqP(s.audit.add(auditRec('RESET_CABUTAN', n + ' rekod pemenang dikosongkan')));
  });
}

export async function deleteAllParticipants() {
  await tx(['participants', 'audit'], 'readwrite', async (s) => {
    const n = await reqP(s.participants.count());
    await reqP(s.participants.clear());
    await reqP(s.audit.add(auditRec('PESERTA_PADAM_SEMUA', n + ' rekod')));
  });
}

// ----------------------------------------------------------------------------- Statistik

export async function stats() {
  const [participants, prizes, winners, draws] = await Promise.all([getAll('participants'), listPrizes(), getAll('winners'), getAll('draws')]);
  const eligible = participants.filter((p) => p.status === STATUS.ELIGIBLE).length;
  const activeWinners = winners.filter((w) => !w.revoked);
  const depts = new Map();
  participants.forEach((p) => {
    const k = p.department || '(Tiada jabatan)';
    const d = depts.get(k) || { total: 0, winners: 0 };
    d.total++;
    if (p.status === STATUS.WINNER) d.winners++;
    depts.set(k, d);
  });
  const ps = prizeStatus(prizes, winners);
  return {
    total: participants.length,
    eligible,
    winners: activeWinners.length,
    remaining: eligible,
    totalPrizes: prizes.reduce((s, p) => s + p.quantity, 0),
    prizeCategories: prizes.length,
    prizesRemaining: ps.reduce((s, x) => s + x.remaining, 0),
    completedDraws: draws.length,
    departments: [...depts.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    prizeStatus: ps,
  };
}

// ----------------------------------------------------------------------------- Sandaran

const BACKUP_STORES = ['participants', 'prizes', 'draws', 'winners', 'audit', 'settings'];

export async function exportBackup() {
  const out = { app: 'lucky-duck-race', version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const n of BACKUP_STORES) {
    const rows = await getAll(n);
    out.data[n] = n === 'settings' ? rows.filter((r) => r.key !== 'auth') : rows; // kata laluan TIDAK dieksport
  }
  return out;
}

export async function importBackup(obj) {
  if (!obj || obj.app !== 'lucky-duck-race' || !obj.data) throw new Error('Fail sandaran tidak sah.');
  for (const n of BACKUP_STORES) if (!Array.isArray(obj.data[n] || [])) throw new Error('Fail sandaran rosak (' + n + ').');
  await tx(BACKUP_STORES, 'readwrite', async (s) => {
    const auth = await reqP(s.settings.get('auth'));
    for (const n of BACKUP_STORES) {
      await reqP(s[n].clear());
      for (const r of obj.data[n] || []) {
        if (n === 'settings' && r.key === 'auth') continue;
        if (n === 'participants') {
          const e = validateStaffId(String(r.staffId || ''));
          if (e) throw new Error('Sandaran: ' + e + ' (' + r.staffId + ')');
        }
        await reqP(s[n].put(r));
      }
    }
    if (auth) await reqP(s.settings.put(auth));
    await reqP(s.audit.add(auditRec('SANDARAN_PULIH', 'Dipulihkan daripada sandaran ' + (obj.exportedAt || ''))));
  });
  settingsCache = null;
}

export { openDb, count };
