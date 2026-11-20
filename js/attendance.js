/**
 * attendance.js — Servis kehadiran di laptop admin.
 * Majlis dalam talian (Supabase) menyimpan SENARAI STAF; staf mengesahkan kehadiran melalui QR
 * (checkin.html). Laptop menyegerak setiap 5 saat: staf yang hadir → automatik jadi peserta cabutan.
 */
import { rpc } from './cloud.js';
import { randomHex } from './rng.js';
import * as store from './store.js';

const KEY = 'attendance';
let timer = null;
let syncing = false;
const listeners = new Set();
export const state = { lastSync: null, lastError: '', lastAdded: [] };

export const getConfig = () => store.getKV(KEY);
const saveConfig = (c) => store.setKV(KEY, c);

export function checkinUrl(cfg) {
  const u = new URL('checkin.html', location.href);
  u.hash = 'e=' + encodeURIComponent(cfg.eventId) + '&t=' + encodeURIComponent(cfg.token);
  return u.toString();
}

export async function createEvent(name) {
  const token = randomHex(16);
  const adminKey = randomHex(24);
  const eventName = String(name || '').trim().slice(0, 160) || 'Majlis Lucky Duck Race';
  const eventId = await rpc('ldr_create_event', { p_name: eventName, p_token: token, p_admin_key: adminKey });
  const cfg = { eventId, token, adminKey, eventName, autoSync: true, since: null, createdAt: new Date().toISOString() };
  await saveConfig(cfg);
  await store.audit('KEHADIRAN_MAJLIS_CIPTA', eventName + ' (' + eventId + ')');
  return cfg;
}

const admin = (cfg) => ({ p_event: cfg.eventId, p_admin_key: cfg.adminKey });

export async function eventInfo() {
  const cfg = await getConfig();
  const rows = await rpc('ldr_admin_event', admin(cfg));
  return rows && rows[0];
}

export async function setOpen(open) {
  const cfg = await getConfig();
  await rpc('ldr_admin_update_event', { ...admin(cfg), p_is_open: !!open });
  await store.audit('KEHADIRAN_' + (open ? 'BUKA' : 'TUTUP'), '');
}

export async function rename(name) {
  const cfg = await getConfig();
  await rpc('ldr_admin_update_event', { ...admin(cfg), p_name: name });
  await saveConfig({ ...cfg, eventName: name });
}

/** Tukar token QR — QR lama/bercetak tidak lagi sah. */
export async function rotateToken() {
  const cfg = await getConfig();
  const token = randomHex(16);
  await rpc('ldr_admin_update_event', { ...admin(cfg), p_new_token: token });
  await saveConfig({ ...cfg, token });
  await store.audit('KEHADIRAN_QR_TUKAR', '');
  return token;
}

export async function setAutoSync(on) {
  const cfg = await getConfig();
  await saveConfig({ ...cfg, autoSync: !!on });
}

/** Muat naik senarai staf (upsert; status kehadiran dikekalkan). */
export async function uploadStaff(items, onProgress) {
  const cfg = await getConfig();
  if (!cfg) throw new Error('Majlis dalam talian belum disediakan.');
  let n = 0;
  for (let i = 0; i < items.length; i += 1000) {
    const chunk = items.slice(i, i + 1000).map((x) => ({ staff_id: x.staffId, name: x.name, department: x.department || '' }));
    n += await rpc('ldr_admin_upsert_staff', { ...admin(cfg), p_rows: chunk }, { timeout: 30000 });
    if (onProgress) onProgress(Math.min(items.length, i + 1000), items.length);
  }
  await store.audit('KEHADIRAN_SENARAI_STAF', n + ' staf dimuat naik');
  return n;
}

export async function listStaff() {
  const cfg = await getConfig();
  return rpc('ldr_admin_list', { ...admin(cfg), p_since: null }, { timeout: 30000 });
}

export async function deleteAllStaff() {
  const cfg = await getConfig();
  const n = await rpc('ldr_admin_delete_staff', { ...admin(cfg), p_staff_ids: null });
  await store.audit('KEHADIRAN_SENARAI_PADAM', n + ' staf');
  return n;
}

/** Sahkan / batal kehadiran secara manual (kaunter), kemudian segerak serta-merta. */
export async function setCheckin(staffId, present) {
  const cfg = await getConfig();
  await rpc('ldr_admin_set_checkin', { ...admin(cfg), p_staff_id: staffId, p_present: !!present });
  await store.audit(present ? 'KEHADIRAN_MANUAL' : 'KEHADIRAN_BATAL', staffId);
  return syncNow();
}

export async function disconnect() {
  stopAutoSync();
  const cfg = await getConfig();
  await store.setKV(KEY, null);
  await store.audit('KEHADIRAN_PUTUS', cfg ? cfg.eventName + ' (' + cfg.eventId + ')' : '');
}

/** Ambil perubahan sejak penyegerakan terakhir → kemas kini peserta setempat. */
export async function syncNow() {
  if (syncing) return { added: [], removed: 0 };
  const cfg = await getConfig();
  if (!cfg) return { added: [], removed: 0 };
  syncing = true;
  try {
    // tolak 5s sebagai margin jam / transaksi serentak (operasi idempoten)
    const since = cfg.since ? new Date(new Date(cfg.since).getTime() - 5000).toISOString() : null;
    const rows = await rpc('ldr_admin_list', { ...admin(cfg), p_since: since }, { timeout: 30000 });
    const res = await store.syncAttendees(rows || []);
    if (rows && rows.length) {
      const max = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cfg.since || '');
      const latest = await getConfig();
      if (latest && latest.eventId === cfg.eventId) await saveConfig({ ...latest, since: max });
    }
    state.lastSync = new Date();
    state.lastError = '';
    state.lastAdded = res.added;
    listeners.forEach((fn) => { try { fn(res); } catch (_) { /* abaikan */ } });
    return res;
  } catch (e) {
    state.lastError = e.message;
    throw e;
  } finally { syncing = false; }
}

export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function startAutoSync() {
  stopAutoSync();
  const tick = async () => {
    const cfg = await getConfig().catch(() => null);
    if (cfg && cfg.autoSync && !document.body.classList.contains('stage-open') && navigator.onLine !== false) {
      await syncNow().catch(() => {});
    }
  };
  timer = setInterval(tick, 5000);
  tick();
}

export function stopAutoSync() { if (timer) { clearInterval(timer); timer = null; } }

// ----------------------------------------------------------------------------- QR

let qrP = null;
function loadQR() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  if (qrP) return qrP;
  qrP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js';
    s.onload = () => resolve(globalThis.qrcode);
    s.onerror = () => { qrP = null; reject(new Error('Gagal memuat penjana QR.')); };
    document.head.appendChild(s);
  });
  return qrP;
}

/** SVG kod QR (dijana setempat, tiada perkhidmatan luar). */
export async function qrSvg(text) {
  const qrcode = await loadQR();
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}
