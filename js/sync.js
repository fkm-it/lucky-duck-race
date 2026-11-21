/**
 * sync.js — Enjin penyegerakan: PANGKALAN DATA PUSAT (Supabase) ⇄ salinan setempat (IndexedDB).
 *
 *  - Sumber kebenaran: pangkalan data pusat (jadual luckyduck.*). IndexedDB = cache luar talian + baris gilir.
 *  - Setiap perubahan setempat direkod dalam 'outbox' (db.js) dalam transaksi yang sama → kekal selepas
 *    muat semula pelayar, dan dihantar (ldr_sync_push) sebaik sahaja ada sambungan.
 *  - Perubahan dari peranti lain ditarik (ldr_sync_pull) secara tokokan ikut 'rev'. Supabase Realtime
 *    (jadual public.ldr_pulse) memberitahu serta-merta; tinjauan berkala sebagai sandaran.
 *  - Cabutan dalam talian dibuat DI PELAYAN (ldr_draw). Luar talian: hanya Peranti Kawalan.
 *  - Kebenaran tulis ikut peranan (admin / operator / registrar) — disemak di sini DAN di pelayan.
 */
import { rpc, CloudError, CLOUD } from './cloud.js';
import { tx, reqP, setSyncHooks, SYNCED, SETTINGS_SYNC_KEYS, NUMERIC_KEY_STORES, docKey } from './db.js';
import { randomHex } from './rng.js';

const META = 'syncMeta';      // {eventId, since}
const DEVICE = 'device';
const POLL_RT = 20000;        // tinjauan bila Realtime bersambung
const POLL = 5000;            // tinjauan bila Realtime tiada
const BATCH = 300;

export const WRITE_RULES = {
  admin: null, // semua
  operator: new Set(['participants', 'draws', 'winners', 'audit']),
  registrar: new Set(['attendance', 'audit']),
};

export const state = {
  event: null, role: null, device: null,
  online: false, syncing: false, pending: 0, lastSync: null, lastError: '', complete: false,
  legacyLocal: null, realtime: false, paused: false,
};
const listeners = new Set();
let timer = null;
let pushTimer = null;
let running = null;
let ws = null;
let since = 0;
let tokenFn = async () => null;

const emit = (type, detail) => listeners.forEach((fn) => { try { fn(type, detail); } catch (_) { /* abaikan */ } });
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const kvGet = (key) => tx('settings', 'readonly', (s) => reqP(s.settings.get(key))).then((r) => (r ? r.value : null));
const kvSet = (key, value) => tx('settings', 'readwrite', (s) => reqP(s.settings.put({ key, value })), { remote: true });

export const active = () => !!(state.event && state.role);
export const isControl = () => !!(state.event && state.device && state.event.control_device === state.device.id);
export const controlName = () => (state.event && state.event.control_name) || '';
export const canWrite = (store) => !active() || store === 'audit' || state.role === 'admin' || !!(WRITE_RULES[state.role] && WRITE_RULES[state.role].has(store));

/** Fasa untuk penunjuk sambungan: online | offline | syncing | complete */
export function phase() {
  if (!active()) return 'local';
  if (!state.online) return 'offline';
  if (state.syncing || state.pending) return 'syncing';
  if (state.complete) return 'complete';
  return 'online';
}

function guessDeviceName() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
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

/** Peraturan tulis — dipanggil oleh db.js SEBELUM perubahan pada data yang disegerak. */
function guard(store) {
  if (!active() || canWrite(store)) return;
  const label = { registrar: 'Staf Pendaftaran', operator: 'Operator Cabutan' }[state.role] || state.role;
  throw new Error('Peranan anda (' + label + ') tidak dibenarkan mengubah data ini.');
}

setSyncHooks({ active: () => active() && !state.paused, guard, committed: () => schedulePush() });

// ----------------------------------------------------------------------------- mula

/** Dipanggil selepas log masuk (dalam / luar talian). token = fungsi yang memulangkan access_token. */
export async function start({ role, event, token }) {
  await device();
  tokenFn = token || tokenFn;
  state.role = role || null;
  stop();
  if (!role || !event) { state.event = event || null; emit('status', state); return; }
  const meta = (await kvGet(META)) || null;
  if (meta && meta.eventId && meta.eventId !== event.event_id) {
    // Majlis aktif bertukar → salinan setempat majlis lama dibuang (data asal kekal di pelayan)
    await wipeLocal();
  }
  state.event = event;
  const cur = (await kvGet(META)) || null;
  if (!cur || cur.eventId !== event.event_id) {
    const legacy = await localCounts();
    if (legacy.total > 0) {
      // Data pelayar ini dari versi lama (sebelum pangkalan data pusat): tunggu keputusan pengguna
      state.legacyLocal = legacy; state.paused = true;
      emit('legacy', legacy); emit('status', state);
      return;
    }
    await kvSet(META, { eventId: event.event_id, since: 0 });
  }
  since = ((await kvGet(META)) || {}).since || 0;
  state.paused = false; state.legacyLocal = null;
  state.online = typeof navigator === 'undefined' || navigator.onLine !== false;
  await countPending();
  run();
}

function run() {
  stop();
  const loop = () => {
    timer = setTimeout(async () => { await tick().catch(() => {}); if (timer) loop(); }, state.realtime ? POLL_RT : POLL);
    if (timer.unref) timer.unref();
  };
  timer = -1;
  tick().catch(() => {}).finally(() => { if (timer) loop(); });
  connectRealtime();
  emit('status', state);
}

export function stop() {
  if (timer && timer !== -1) clearTimeout(timer);
  timer = null;
  if (ws) { try { ws.onclose = null; ws.close(); } catch (_) { /* abaikan */ } ws = null; }
  state.realtime = false;
}

/** Log keluar: henti penyegerakan (data & baris gilir setempat dikekalkan untuk log masuk seterusnya). */
export function signOut() { stop(); state.role = null; emit('status', state); }

function schedulePush() {
  countPending().then(() => emit('status', state));
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; tick({ pullToo: false }).catch(() => {}); }, 250);
  if (pushTimer.unref) pushTimer.unref();
}

async function countPending() {
  state.pending = await tx('outbox', 'readonly', (s) => reqP(s.outbox.count()));
  return state.pending;
}

export function tick({ pullToo = true } = {}) {
  if (!active() || state.paused) return Promise.resolve();
  if (running) return running.then(() => (pullToo ? tick({ pullToo }) : undefined));
  running = (async () => {
    const before = state.pending;
    state.syncing = true; emit('status', state);
    try {
      await push();
      const stageOpen = typeof document !== 'undefined' && document.body && document.body.classList.contains('stage-open');
      if (pullToo && !stageOpen) await pull();
      const wasOffline = !state.online;
      state.online = true; state.lastSync = new Date(); state.lastError = '';
      if (before > 0 || wasOffline) {
        state.complete = true;
        const t = setTimeout(() => { state.complete = false; emit('status', state); }, 4000);
        if (t.unref) t.unref();
        emit('synced', before);
      }
      if (!ws) connectRealtime();
    } catch (e) {
      if (e instanceof CloudError && e.code === 'NETWORK') state.online = false;
      state.lastError = e.message;
      if (e instanceof CloudError && (e.code === 'AUTH' || e.code === 'FORBIDDEN')) emit('auth', e);
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

/** Segerak penuh dalam masa terhad (cth. sebelum cabutan). Tidak gagal jika luar talian. */
export async function flush(ms = 5000) {
  if (!active() || state.paused) return false;
  let t;
  try {
    await Promise.race([tick(), new Promise((_, no) => { t = setTimeout(() => no(new Error('timeout')), ms); if (t.unref) t.unref(); })]);
    return true;
  } catch (_) { return false; } finally { clearTimeout(t); }
}

const castKey = (store, k) => (NUMERIC_KEY_STORES.has(store) && /^\d+$/.test(k) ? Number(k) : k);

async function applyDoc(s, store, k, d, deleted) {
  if (deleted || !d) await reqP(s[store].delete(castKey(store, k)));
  else await reqP(s[store].put(d));
}

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
    const res = await rpc('ldr_sync_push', { p_event: state.event.event_id, p_device: state.device.id, p_rows: rows }, { timeout: 45000 });
    const sent = new Map(batch.map(({ e }) => [e.k, e]));
    const changed = new Set();
    const errors = [];
    await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
      for (const a of res.applied || []) {
        const k = docKey(a.s, a.k);
        await reqP(s.syncrev.put({ k, r: a.r }));
        const cur = await reqP(s.outbox.get(k));
        const same = cur && sent.get(k) && cur.t === sent.get(k).t;
        if (same) await reqP(s.outbox.delete(k));
        // Versi muktamad dari pelayan (cth. nombor itik ditetapkan semula) — hanya jika tiada perubahan setempat baharu
        if (same && a.d && !a.x) { await reqP(s[a.s].put(a.d)); changed.add(a.s); }
      }
      for (const r of res.rejected || []) {
        // Ditolak (konflik / tiada kebenaran / data tidak sah) → guna versi pelayan, buang dari baris gilir
        const k = docKey(r.s, r.k);
        await applyDoc(s, r.s, r.k, r.d, r.x || !r.d);
        if (r.r) await reqP(s.syncrev.put({ k, r: r.r }));
        await reqP(s.outbox.delete(k));
        changed.add(r.s);
        errors.push(r);
      }
    }, { remote: true });
    if (errors.length) emit('rejected', errors);
    if (changed.size) emit('change', [...changed]);
  }
}

// ----------------------------------------------------------------------------- tarik

async function pull() {
  const changed = new Set();
  for (let guardLoop = 0; guardLoop < 500; guardLoop++) {
    const res = await rpc('ldr_sync_pull', { p_event: state.event.event_id, p_since: since, p_limit: 1000 }, { timeout: 45000 });
    const rows = res.rows || [];
    if (rows.length) {
      await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
        for (const r of rows) {
          const k = docKey(r.s, r.k);
          const local = await reqP(s.syncrev.get(k));
          if (local && local.r >= r.r) continue;
          await reqP(s.syncrev.put({ k, r: r.r }));
          if (await reqP(s.outbox.get(k))) continue; // perubahan setempat yang belum dihantar diutamakan
          if (r.s === 'settings' && !SETTINGS_SYNC_KEYS.has(r.k)) continue;
          await applyDoc(s, r.s, r.k, r.d, r.x);
          changed.add(r.s);
        }
      }, { remote: true });
      since = rows[rows.length - 1].r;
      await kvSet(META, { eventId: state.event.event_id, since });
    }
    applyMeta(res.meta);
    if (!res.more) break;
  }
  if (changed.size) emit('change', [...changed]);
}

function applyMeta(meta) {
  if (!meta || !state.event || meta.event_id !== state.event.event_id) return;
  const wasControl = isControl();
  const prev = state.event;
  state.event = { ...state.event, ...meta };
  if (prev.qr_token !== meta.qr_token || prev.is_open !== meta.is_open || prev.name !== meta.name) emit('event', state.event);
  if (wasControl !== isControl()) emit('control', isControl());
}

export function setEventMeta(meta) { applyMeta(meta); emit('status', state); }

// ----------------------------------------------------------------------------- Realtime (Phoenix websocket)

let rtRef = 0;
let hb = null;
let rtRetry = 0;
let rtNext = 0;               // tidak cuba semula sebelum masa ini (backoff)
async function connectRealtime() {
  if (typeof WebSocket === 'undefined' || !active() || state.paused || ws || Date.now() < rtNext) return;
  rtNext = Date.now() + Math.min(60000, 2000 * 2 ** rtRetry);
  const token = await tokenFn();
  if (!token || ws) return;
  try {
    ws = new WebSocket(CLOUD.url.replace('https:', 'wss:') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(CLOUD.key) + '&vsn=1.0.0');
  } catch (_) { ws = null; return; }
  const sock = ws;
  const topic = 'realtime:ldr-' + state.event.event_id;
  const send = (m) => { if (sock.readyState === 1) sock.send(JSON.stringify({ ...m, ref: String(++rtRef) })); };
  sock.onopen = () => {
    rtRetry = 0; rtNext = 0;
    send({ topic, event: 'phx_join', payload: { config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'ldr_pulse', filter: 'event_id=eq.' + state.event.event_id }] }, access_token: token } });
    hb = setInterval(async () => {
      send({ topic: 'phoenix', event: 'heartbeat', payload: {} });
      const t = await tokenFn();
      if (t) send({ topic, event: 'access_token', payload: { access_token: t } });
    }, 25000);
  };
  sock.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m.event === 'phx_reply' && m.topic === topic && m.payload && m.payload.status === 'ok') { state.realtime = true; emit('status', state); }
    if (m.event === 'postgres_changes') tick().catch(() => {});
  };
  sock.onclose = () => {
    clearInterval(hb);
    if (ws === sock) ws = null;
    state.realtime = false; emit('status', state);
    if (!active()) return;
    rtRetry = Math.min(rtRetry + 1, 5);
    const t = setTimeout(() => { if (active() && !ws) connectRealtime(); }, Math.max(0, rtNext - Date.now()) + 50);
    if (t.unref) t.unref();
  };
  sock.onerror = () => { try { sock.close(); } catch (_) { /* abaikan */ } };
}

// ----------------------------------------------------------------------------- cabutan di pelayan

/** Cabutan dalam talian: pelayan memilih pemenang secara atomik. Memulangkan {draw, winners, pool}. */
export async function serverDraw({ drawId, prizeId, count, revealMode }) {
  const res = await rpc('ldr_draw', {
    p_event: state.event.event_id, p_draw_id: drawId, p_prize_id: prizeId || '', p_count: count, p_reveal: revealMode, p_device: state.device.id,
  }, { timeout: 30000 });
  // Simpan terus salinan setempat (tarikan seterusnya akan mengesahkan revisi).
  // Semua tulisan dihantar serentak (tanpa menunggu satu demi satu) — pantas walaupun pentas 3D sedang dilukis.
  await tx(['participants', 'winners', 'draws', 'syncrev'], 'readwrite', (s) => {
    const ids = new Set(res.winners.map((w) => w.staffId));
    const at = res.draw.createdAt;
    const writes = res.pool.filter((p) => ids.has(p.staffId))
      .map((p) => reqP(s.participants.put({ ...p, status: 'WINNER', winCount: (p.winCount || 0) + 1, lastWonAt: at, updatedAt: at })));
    res.winners.forEach((w) => writes.push(reqP(s.winners.put(w))));
    writes.push(reqP(s.draws.put(res.draw)));
    // Revisi pelayan → suntingan seterusnya pada rekod ini (cth. pulih pemenang) tidak dianggap konflik
    (res.revs || []).forEach((r) => writes.push(reqP(s.syncrev.put({ k: docKey(r.s, r.k), r: r.r }))));
    return Promise.all(writes);
  }, { remote: true });
  emit('change', ['participants', 'winners', 'draws']);
  tick().catch(() => {});
  return res;
}

export async function claimControl() {
  const d = await device();
  const meta = await rpc('ldr_claim_control', { p_event: state.event.event_id, p_device: d.id, p_device_name: d.name });
  applyMeta(meta);
  emit('status', state);
}

// ----------------------------------------------------------------------------- data setempat lama / tukar majlis

async function localCounts() {
  return tx(['participants', 'prizes', 'winners', 'draws'], 'readonly', async (s) => {
    const [p, z, w, d] = await Promise.all([s.participants.count(), s.prizes.count(), s.winners.count(), s.draws.count()].map(reqP));
    return { participants: p, prizes: z, winners: w, draws: d, total: p + z + w + d };
  });
}

async function wipeLocal() {
  await tx(['outbox', 'syncrev', ...SYNCED], 'readwrite', async (s) => {
    await reqP(s.outbox.clear());
    await reqP(s.syncrev.clear());
    for (const n of SYNCED) {
      if (n === 'settings') { for (const k of SETTINGS_SYNC_KEYS) await reqP(s.settings.delete(k)); } else await reqP(s[n].clear());
    }
  }, { remote: true });
  await kvSet(META, null);
  since = 0;
}

/** Data pelayar lama: 'upload' = hantar semua ke pangkalan data pusat (pentadbir); 'discard' = buang & guna data pusat. */
export async function resolveLegacy(choice) {
  if (!state.event) throw new Error('Tiada majlis aktif.');
  if (choice === 'upload') {
    if (state.role !== 'admin') throw new Error('Hanya pentadbir boleh memuat naik data pelayar ini.');
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
  } else {
    await wipeLocal();
  }
  await kvSet(META, { eventId: state.event.event_id, since: 0 });
  since = 0;
  state.legacyLocal = null; state.paused = false;
  await countPending();
  run();
  await flush(180000);
  emit('change', SYNCED);
}

/** Tukar majlis aktif (pentadbir) → salinan setempat diganti. */
export async function switchEvent(meta) {
  stop();
  await wipeLocal();
  state.event = meta;
  await kvSet(META, { eventId: meta.event_id, since: 0 });
  since = 0;
  state.paused = false; state.legacyLocal = null;
  run();
  await flush(60000);
  emit('change', SYNCED);
}
