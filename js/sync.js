/**
 * sync.js — Penyegerakan awan (dalam talian + luar talian).
 *
 * Model:
 *  - IndexedDB kekal sebagai pangkalan data kerja (pantas, berfungsi tanpa internet).
 *  - Setiap perubahan pada data yang disegerak direkod dalam 'outbox' (lihat db.js) dan dihantar ke
 *    Supabase (ldr_cloud_push). Perubahan peranti lain ditarik setiap beberapa saat (ldr_cloud_pull).
 *  - Satu "Peranti Kawalan" per majlis: hanya ia boleh membuat cabutan, dan ia boleh terus bekerja
 *    walaupun luar talian (keputusan dihantar bila online semula; ia menang jika konflik).
 *  - Peranti lain: boleh mengubah data ketika dalam talian (semakan revisi di pelayan), baca sahaja
 *    ketika luar talian.
 */
import { rpc, CloudError } from './cloud.js';
import { tx, reqP, setSyncHooks, SYNCED, SETTINGS_SYNC_KEYS, NUMERIC_KEY_STORES, docKey } from './db.js';
import { randomHex } from './rng.js';

const CFG = 'cloud';
const DEVICE = 'device';
const PULL_MS = 4000;
const BATCH = 300;

export const state = { cfg: null, device: null, online: false, syncing: false, pending: 0, lastSync: null, lastError: '', sessionLost: false };
const listeners = new Set();
let timer = null;
let pushTimer = null;
let running = null;

const emit = (type, detail) => listeners.forEach((fn) => { try { fn(type, detail); } catch (_) { /* abaikan */ } });
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const kvGet = (key) => tx('settings', 'readonly', (s) => reqP(s.settings.get(key))).then((r) => (r ? r.value : null));
const kvSet = (key, value) => tx('settings', 'readwrite', (s) => reqP(s.settings.put({ key, value })), { remote: true });

export const isCloud = () => !!state.cfg;
export const isControl = () => !!(state.cfg && state.device && state.cfg.control && state.cfg.control.device === state.device.id);
export const controlName = () => (state.cfg && state.cfg.control && state.cfg.control.name) || '';

function guessDeviceName() {
  const ua = navigator.userAgent || '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Pelayar';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return (br + (os ? ' · ' + os : '')).slice(0, 80);
}

export async function device() {
  if (state.device) return state.device;
  let d = await kvGet(DEVICE);
  if (!d || !d.id) { d = { id: 'dev-' + randomHex(12), name: guessDeviceName() }; await kvSet(DEVICE, d); }
  state.device = d;
  return d;
}

export async function setDeviceName(name) {
  const d = await device();
  state.device = { ...d, name: String(name || '').trim().slice(0, 80) || d.name };
  await kvSet(DEVICE, state.device);
}

const saveCfg = async (c) => { state.cfg = c; await kvSet(CFG, c); };

/** Peraturan tulis — dipanggil oleh db.js SEBELUM sebarang perubahan pada data yang disegerak. */
function guard(store) {
  if (!state.cfg || store === 'audit') return;
  if (!isControl() && !state.online) {
    throw new Error('Peranti ini dalam mod BACA SAHAJA kerana tiada sambungan internet. Hanya Peranti Kawalan (' + (controlName() || '—') + ') boleh membuat perubahan tanpa internet.');
  }
}

setSyncHooks({
  active: () => !!state.cfg,
  guard,
  committed: () => { schedulePush(); },
});

// ----------------------------------------------------------------------------- mula / henti

export async function init() {
  await device();
  state.cfg = await kvGet(CFG);
  if (state.cfg) { state.online = navigator.onLine !== false; await countPending(); start(); }
  emit('status', state);
}

function start() {
  stop();
  timer = setInterval(() => { tick().catch(() => {}); }, PULL_MS);
  if (timer.unref) timer.unref(); /* Node (ujian) sahaja */
  tick().catch(() => {});
}

export function stop() { if (timer) { clearInterval(timer); timer = null; } }

function schedulePush() {
  countPending().then(() => emit('status', state));
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; tick({ pullToo: false }).catch(() => {}); }, 300);
  if (pushTimer.unref) pushTimer.unref();
}

async function countPending() {
  state.pending = await tx('outbox', 'readonly', (s) => reqP(s.outbox.count()));
  return state.pending;
}

/** Satu pusingan: hantar semua yang tertunggak, kemudian tarik perubahan. */
export function tick({ pullToo = true } = {}) {
  if (!state.cfg) return Promise.resolve();
  if (running) return running.then(() => (pullToo ? tick({ pullToo }) : undefined));
  running = (async () => {
    state.syncing = true; emit('status', state);
    try {
      await push();
      const stageOpen = typeof document !== 'undefined' && document.body && document.body.classList.contains('stage-open');
      if (pullToo && !stageOpen) await pull();
      state.online = true; state.lastSync = new Date(); state.lastError = ''; state.sessionLost = false;
    } catch (e) {
      if (e instanceof CloudError && e.code === 'NETWORK') state.online = false;
      else if (e instanceof CloudError && (e.code === 'SESSION' || e.code === 'FORBIDDEN')) { state.sessionLost = true; state.online = true; }
      state.lastError = e.message;
      throw e;
    } finally {
      state.syncing = false;
      await countPending().catch(() => {});
      emit('status', state);
      running = null;
    }
  })();
  return running;
}

/** Cuba segerak sepenuhnya dalam masa terhad (cth. sebelum cabutan). Tidak gagal jika luar talian. */
export async function flush(ms = 5000) {
  if (!state.cfg) return false;
  try {
    await Promise.race([tick(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
    return true;
  } catch (_) { return false; }
}

const castKey = (store, k) => (NUMERIC_KEY_STORES.has(store) && /^\d+$/.test(k) ? Number(k) : k);

// ----------------------------------------------------------------------------- hantar

async function push() {
  for (let guardLoop = 0; guardLoop < 100; guardLoop++) {
    const batch = await tx(['outbox', 'syncrev', ...SYNCED], 'readonly', async (s) => {
      const entries = await reqP(s.outbox.getAll(undefined, BATCH));
      return Promise.all(entries.map(async (e) => {
        const [value, rev] = await Promise.all([reqP(s[e.s].get(e.key)), reqP(s.syncrev.get(e.k))]);
        return { e, value, rev: rev ? rev.r : 0 };
      }));
    });
    if (!batch.length) return;
    const rows = batch.map(({ e, value, rev }) => ({ s: e.s, k: String(e.key), d: value === undefined ? null : value, x: value === undefined, b: rev }));
    const res = await rpc('ldr_cloud_push', { p_event: state.cfg.eventId, p_session: state.cfg.session, p_rows: rows }, { timeout: 30000 });
    const sent = new Map(batch.map(({ e }) => [e.k, e]));
    const changed = new Set();
    await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
      for (const a of res.applied || []) {
        const k = docKey(a.s, a.k);
        await reqP(s.syncrev.put({ k, r: a.r }));
        const cur = await reqP(s.outbox.get(k));
        if (cur && cur.t === sent.get(k).t) await reqP(s.outbox.delete(k)); // tidak diubah lagi semasa dihantar
      }
      for (const r of res.rejected || []) {
        // Data di awan lebih baharu (diubah peranti lain) → guna versi awan
        const k = docKey(r.s, r.k);
        if (r.x || !r.d) await reqP(s[r.s].delete(castKey(r.s, r.k))); else await reqP(s[r.s].put(r.d));
        await reqP(s.syncrev.put({ k, r: r.r }));
        await reqP(s.outbox.delete(k));
        changed.add(r.s);
      }
    }, { remote: true });
    if (res.rejected && res.rejected.length) emit('conflict', res.rejected.length);
    if (changed.size) emit('change', [...changed]);
    if (state.cfg.control && res.control !== isControl()) await refreshMeta();
  }
}

// ----------------------------------------------------------------------------- tarik

async function pull() {
  const changed = new Set();
  for (let guardLoop = 0; guardLoop < 200; guardLoop++) {
    const res = await rpc('ldr_cloud_pull', { p_event: state.cfg.eventId, p_session: state.cfg.session, p_since: state.cfg.since || 0, p_limit: 1000 }, { timeout: 30000 });
    const rows = res.rows || [];
    if (rows.length) {
      await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
        for (const r of rows) {
          const k = docKey(r.s, r.k);
          const local = await reqP(s.syncrev.get(k));
          if (local && local.r >= r.r) continue; // sudah ada (cth. hasil push kita sendiri)
          await reqP(s.syncrev.put({ k, r: r.r }));
          if (await reqP(s.outbox.get(k))) continue; // perubahan setempat yang belum dihantar diutamakan
          if (r.s === 'settings' && !SETTINGS_SYNC_KEYS.has(r.k)) continue;
          if (r.x || !r.d) await reqP(s[r.s].delete(castKey(r.s, r.k))); else await reqP(s[r.s].put(r.d));
          changed.add(r.s);
        }
      }, { remote: true });
      state.cfg = { ...state.cfg, since: rows[rows.length - 1].r };
    }
    await applyMeta(res.meta);
    if (!res.more) break;
  }
  await saveCfg(state.cfg);
  if (changed.size) emit('change', [...changed]);
}

async function applyMeta(meta) {
  if (!meta) return;
  const wasControl = isControl();
  state.cfg = { ...state.cfg, name: meta.name, code: meta.code || state.cfg.code, control: { device: meta.control_device, name: meta.control_name } };
  // Token QR terkini (jika ditukar di peranti lain) → paparan QR di sini kekal sah
  const att = await kvGet('attendance');
  if (att && meta.qr_token && att.eventId === state.cfg.eventId && att.token !== meta.qr_token) await kvSet('attendance', { ...att, token: meta.qr_token, eventName: meta.name || att.eventName });
  if (wasControl !== isControl()) emit('control', isControl());
}

async function refreshMeta() {
  const res = await rpc('ldr_cloud_pull', { p_event: state.cfg.eventId, p_session: state.cfg.session, p_since: 2 ** 52, p_limit: 1 });
  await applyMeta(res.meta);
  await saveCfg(state.cfg);
}

// ----------------------------------------------------------------------------- aktifkan / sertai / keluar

/** Tanda SEMUA data setempat untuk dihantar (selepas mengaktifkan majlis awan). */
async function markAllDirty() {
  await tx(['outbox', ...SYNCED], 'readwrite', async (s) => {
    let t = Date.now() * 1000;
    for (const n of SYNCED) {
      const keys = await reqP(s[n].getAllKeys());
      for (const key of keys) {
        if (n === 'settings' && !SETTINGS_SYNC_KEYS.has(key)) continue;
        await reqP(s.outbox.put({ k: docKey(n, key), s: n, key, t: t++ }));
      }
    }
  }, { remote: true });
}

/**
 * Jadikan majlis kehadiran sedia ada (att = {eventId, token, adminKey}) sebagai majlis awan.
 * Peranti ini menjadi Peranti Kawalan dan semua data setempat dimuat naik.
 */
export async function enable(att, password) {
  const d = await device();
  const res = await rpc('ldr_cloud_enable', { p_event: att.eventId, p_admin_key: att.adminKey, p_password: password, p_qr_token: att.token, p_device: d.id, p_device_name: d.name });
  await saveCfg({ eventId: res.event_id, code: res.code, session: res.session, name: res.name, since: 0, control: { device: res.control_device, name: res.control_name } });
  await markAllDirty();
  state.online = true;
  start();
  await flush(60000);
  emit('status', state);
  return state.cfg;
}

/** Sertai majlis awan: data setempat (peserta, hadiah, cabutan…) DIGANTIKAN dengan data awan. */
export async function join(code, password) {
  const d = await device();
  const res = await rpc('ldr_cloud_join', { p_code: code, p_password: password, p_device: d.id, p_device_name: d.name });
  stop();
  await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
    await reqP(s.outbox.clear());
    await reqP(s.syncrev.clear());
    for (const n of SYNCED) {
      if (n === 'settings') { for (const k of SETTINGS_SYNC_KEYS) await reqP(s.settings.delete(k)); } else await reqP(s[n].clear());
    }
  }, { remote: true });
  await saveCfg({ eventId: res.event_id, code: res.code, session: res.session, name: res.name, since: 0, control: { device: res.control_device, name: res.control_name } });
  await kvSet('attendance', { eventId: res.event_id, token: res.qr_token || '', adminKey: res.session, eventName: res.name, autoSync: true, since: null, createdAt: new Date().toISOString(), joined: true });
  state.online = true;
  await pull();
  start();
  emit('change', SYNCED);
  emit('status', state);
  return state.cfg;
}

/** Jadikan peranti ini Peranti Kawalan. */
export async function claimControl() {
  const meta = await rpc('ldr_cloud_claim', { p_event: state.cfg.eventId, p_session: state.cfg.session });
  await applyMeta(meta);
  await saveCfg(state.cfg);
  emit('status', state);
}

export async function changeCloudPassword(oldPw, newPw) {
  await rpc('ldr_cloud_set_password', { p_event: state.cfg.eventId, p_session: state.cfg.session, p_old: oldPw, p_new: newPw });
}

/** Putuskan peranti ini daripada majlis awan. Data setempat dikekalkan (jadi mod komputer ini sahaja). */
export async function leave() {
  const c = state.cfg;
  stop();
  if (c) await rpc('ldr_cloud_leave', { p_event: c.eventId, p_session: c.session }).catch(() => {});
  await tx(['outbox', 'syncrev', 'settings'], 'readwrite', async (s) => {
    await reqP(s.outbox.clear());
    await reqP(s.syncrev.clear());
    await reqP(s.settings.delete(CFG));
    const att = await reqP(s.settings.get('attendance'));
    if (att && att.value && att.value.joined) await reqP(s.settings.delete('attendance')); // kunci sesi tidak sah lagi
  }, { remote: true });
  state.cfg = null; state.pending = 0; state.online = false;
  emit('status', state);
}
