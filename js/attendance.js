/**
 * attendance.js — Servis kehadiran (pangkalan data pusat).
 *
 * Senarai staf & rekod kehadiran berada dalam pangkalan data pusat (jadual staff / attendance) dan disalin
 * ke IndexedDB setiap peranti (stor 'staff' / 'attendance') supaya boleh dicari & direkod LUAR TALIAN.
 * Kehadiran (QR telefon, kaunter, atau luar talian selepas disegerak) → peserta cabutan dicipta DI PELAYAN
 * secara atomik (satu kehadiran & satu kelayakan bagi setiap No. Pekerja).
 */
import { rpc } from './cloud.js';
import { randomHex } from './rng.js';
import { tx, reqP, getAll } from './db.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { cleanText, normalizeStaffId, validateStaffId, FIELD_LIMITS } from './logic.js';

/** Konfigurasi majlis aktif (dari pangkalan data pusat). null jika tiada majlis / tiada token QR. */
export async function getConfig() {
  const e = sync.state.event;
  if (!e) return null;
  return { eventId: e.event_id, token: e.qr_token || '', eventName: e.name, isOpen: e.is_open !== false, legacy: !!e.legacy };
}

export function checkinUrl(cfg) {
  const u = new URL('checkin.html', location.href);
  u.hash = 'e=' + encodeURIComponent(cfg.eventId) + '&t=' + encodeURIComponent(cfg.token);
  return u.toString();
}

/** Cipta majlis baharu (pentadbir, dalam talian) dan jadikan aktif. */
export async function createEvent(name) {
  const token = randomHex(16);
  const eventName = String(name || '').trim().slice(0, 160) || 'Majlis Rock The Draw';
  const meta = await rpc('ldr_event_create', { p_name: eventName, p_token: token });
  await sync.switchEvent(meta);
  await store.audit('MAJLIS_CIPTA', eventName);
  return getConfig();
}

/** Statistik kehadiran daripada salinan setempat (berfungsi luar talian). */
export async function eventInfo() {
  const [staff, att] = await Promise.all([count('staff'), count('attendance')]);
  const e = sync.state.event || {};
  return { name: e.name, is_open: e.is_open !== false, total: staff, present: att };
}
const count = (n) => tx(n, 'readonly', (s) => reqP(s[n].count()));

export async function setOpen(open) {
  const meta = await rpc('ldr_event_update', { p_event: sync.state.event.event_id, p_is_open: !!open });
  sync.setEventMeta(meta);
  await store.audit('KEHADIRAN_' + (open ? 'BUKA' : 'TUTUP'), '');
}

export async function rename(name) {
  const meta = await rpc('ldr_event_update', { p_event: sync.state.event.event_id, p_name: name });
  sync.setEventMeta(meta);
}

/** Tukar token QR — QR lama/bercetak tidak lagi sah. */
export async function rotateToken() {
  const meta = await rpc('ldr_event_update', { p_event: sync.state.event.event_id, p_new_token: randomHex(16) });
  sync.setEventMeta(meta);
  await store.audit('KEHADIRAN_TUKAR_QR', '');
}

/** Muat naik / kemas kini senarai staf (pentadbir). Kehadiran sedia ada dikekalkan. */
export async function uploadStaff(items, onProgress) {
  const now = new Date().toISOString();
  const rows = items.map((it) => {
    const staffId = normalizeStaffId(it.staffId);
    if (validateStaffId(staffId)) return null;
    return { staffId, name: cleanText(it.name, FIELD_LIMITS.name) || staffId, department: cleanText(it.department, FIELD_LIMITS.department), updatedAt: now };
  }).filter(Boolean);
  for (let i = 0; i < rows.length; i += 500) {
    await tx(['staff'], 'readwrite', async (s) => { for (const r of rows.slice(i, i + 500)) await reqP(s.staff.put(r)); });
    if (onProgress) onProgress(Math.min(i + 500, rows.length), rows.length);
  }
  await store.audit('STAF_MUAT_NAIK', rows.length + ' staf');
  await sync.flush(120000);
  return rows.length;
}

/** Senarai staf + kehadiran (salinan setempat). */
export async function listStaff() {
  const [staff, att] = await Promise.all([getAll('staff'), getAll('attendance')]);
  const map = new Map(att.map((a) => [a.staffId, a]));
  return staff.map((s) => {
    const a = map.get(s.staffId);
    return { staff_id: s.staffId, name: s.name, department: s.department || '', checked_in_at: a ? a.checkedInAt : null, checked_in_via: a ? a.via : null, pending: false };
  });
}

export async function deleteAllStaff() {
  await tx(['staff', 'attendance'], 'readwrite', async (s) => { await reqP(s.attendance.clear()); await reqP(s.staff.clear()); });
  await store.audit('STAF_PADAM_SEMUA', '');
}

/**
 * Sahkan / batal kehadiran di kaunter (pentadbir / staf pendaftaran). Berfungsi LUAR TALIAN:
 * rekod disimpan dalam baris gilir dan dihantar bila online; pelayan menolak pendua secara atomik.
 */
export async function setCheckin(staffId, present) {
  const sid = normalizeStaffId(staffId);
  await tx(['staff', 'attendance', 'audit'], 'readwrite', async (s) => {
    const st = await reqP(s.staff.get(sid));
    if (!st) throw new Error('No. Pekerja ' + sid + ' tiada dalam senarai staf.');
    if (present) {
      if (await reqP(s.attendance.get(sid))) return;
      await reqP(s.attendance.put({ staffId: sid, checkedInAt: new Date().toISOString(), via: sync.state.online ? 'manual' : 'offline', device: sync.state.device && sync.state.device.name }));
    } else {
      await reqP(s.attendance.delete(sid));
    }
  });
  await store.audit(present ? 'KEHADIRAN_SAH' : 'KEHADIRAN_BATAL', sid);
}

export async function syncNow() { await sync.tick(); return { added: [], removed: 0 }; }

/** Pemberitahuan apabila peserta baharu tiba dari pelayan (kehadiran QR). */
export function onSync(fn) {
  let known = null;
  return sync.on(async (type, detail) => {
    if (type !== 'change' || !detail.includes('participants')) return;
    const ps = await store.listParticipants();
    if (known) {
      const added = ps.filter((p) => !known.has(p.staffId));
      if (added.length) fn({ added, removed: 0 });
    }
    known = new Set(ps.map((p) => p.staffId));
  });
}

/** Sambung majlis versi lama (kunci admin laptop disimpan dalam pelayar) → QR bercetak kekal sah. */
export async function linkLegacy() {
  const old = await store.getKV('attendance');
  if (!old || !old.adminKey || !old.token) return null;
  const meta = await rpc('ldr_event_link_legacy', { p_event: old.eventId, p_admin_key: old.adminKey, p_token: old.token });
  return meta;
}

// ---------------------------------------------------------------------------- QR
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
