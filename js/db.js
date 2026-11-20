/**
 * db.js — Pembalut IndexedDB berasaskan Promise.
 * Semua operasi cabutan berlaku dalam SATU transaksi readwrite (atomik): sama ada semua
 * rekod pemenang/peserta/audit disimpan, atau tiada langsung.
 */

export const DB_NAME = 'lucky-duck-race';
export const DB_VERSION = 2;

/* Stor yang disegerak ke awan, dan kunci tetapan yang turut disegerak (selebihnya kekal setempat: auth, sesi, kunci). */
export const SYNCED = ['participants', 'prizes', 'draws', 'winners', 'audit', 'settings'];
export const SETTINGS_SYNC_KEYS = new Set(['app', 'duckSeq', 'winnerSeq']);
export const NUMERIC_KEY_STORES = new Set(['winners', 'audit']);

let dbPromise = null;

function upgrade(db, t, oldVersion) {
  if (!db.objectStoreNames.contains('participants')) {
    const s = db.createObjectStore('participants', { keyPath: 'staffId' }); // Staff ID = TEKS unik
    s.createIndex('status', 'status');
    s.createIndex('department', 'department');
    s.createIndex('duckNo', 'duckNo');
  } else if (oldVersion < 2) {
    /* v2: nombor itik tidak lagi unik di peringkat DB (dua peranti boleh menambah serentak; Peranti Kawalan menomborkan semula) */
    const s = t.objectStore('participants');
    if (s.indexNames.contains('duckNo')) s.deleteIndex('duckNo');
    s.createIndex('duckNo', 'duckNo');
  }
  if (!db.objectStoreNames.contains('prizes')) {
    const s = db.createObjectStore('prizes', { keyPath: 'id' });
    s.createIndex('sequence', 'sequence');
  }
  if (!db.objectStoreNames.contains('draws')) {
    const s = db.createObjectStore('draws', { keyPath: 'id' });
    s.createIndex('createdAt', 'createdAt');
  }
  if (!db.objectStoreNames.contains('winners')) {
    const s = db.createObjectStore('winners', { keyPath: 'id', autoIncrement: true });
    s.createIndex('drawId', 'drawId');
    s.createIndex('staffId', 'staffId');
    s.createIndex('prizeId', 'prizeId');
  }
  if (!db.objectStoreNames.contains('audit')) {
    const s = db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
    s.createIndex('at', 'at');
  }
  if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
  /* v2: penyegerakan awan */
  if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'k' });
  if (!db.objectStoreNames.contains('syncrev')) db.createObjectStore('syncrev', { keyPath: 'k' });
}

export const docKey = (store, key) => store + '\u0001' + String(key);

/* Cangkuk penyegerakan (dipasang oleh sync.js apabila majlis awan aktif). */
let hooks = null;
export function setSyncHooks(h) { hooks = h; }
let stampSeq = 0;
const stamp = () => Date.now() * 1000 + (stampSeq = (stampSeq + 1) % 1000);

const syncable = (name, key) => SYNCED.includes(name) && (name !== 'settings' || SETTINGS_SYNC_KEYS.has(key));

/** Balut object store: setiap put/add/delete/clear pada data yang disegerak direkod dalam 'outbox' (transaksi sama). */
function wrapStore(name, real, outbox, state) {
  const mark = (key) => { if (syncable(name, key)) { state.dirty = true; outbox.put({ k: docKey(name, key), s: name, key, t: stamp() }); } };
  const keyIn = (v) => (v && typeof v === 'object' ? v[real.keyPath] : undefined);
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'put' || prop === 'add') {
        return (value, key) => {
          const k0 = key !== undefined ? key : keyIn(value);
          if (name !== 'settings' || SETTINGS_SYNC_KEYS.has(k0)) hooks.guard(name, k0);
          const req = key === undefined ? target[prop](value) : target[prop](value, key);
          req.addEventListener('success', () => mark(req.result));
          return req;
        };
      }
      if (prop === 'delete') {
        return (key) => {
          if (syncable(name, key)) hooks.guard(name, key);
          const req = target.delete(key);
          req.addEventListener('success', () => mark(key));
          return req;
        };
      }
      if (prop === 'clear') {
        return () => {
          if (name !== 'settings') hooks.guard(name);
          const kreq = target.getAllKeys();
          kreq.addEventListener('success', () => kreq.result.forEach(mark));
          return target.clear();
        };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB tidak disokong pelayar ini.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => upgrade(req.result, req.transaction, ev.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Pangkalan data disekat oleh tab lain. Tutup tab lain dan cuba lagi.'));
  });
  return dbPromise;
}

export const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Jalankan fn(stores, tx) dalam satu transaksi. Promise selesai hanya selepas transaksi COMMIT.
 * fn boleh memulangkan nilai (atau promise yang diselesaikan oleh permintaan IDB dalam tx yang sama).
 */
export async function tx(storeNames, mode, fn, { remote = false } = {}) {
  const db = await openDb();
  const names = [].concat(storeNames);
  const track = mode === 'readwrite' && !remote && hooks && hooks.active() && names.some((n) => SYNCED.includes(n));
  return new Promise((resolve, reject) => {
    const t = db.transaction(track && !names.includes('outbox') ? names.concat('outbox') : names, mode);
    const stores = {};
    const st = { dirty: false };
    const outbox = track ? t.objectStore('outbox') : null;
    names.forEach((n) => { stores[n] = track && SYNCED.includes(n) ? wrapStore(n, t.objectStore(n), outbox, st) : t.objectStore(n); });
    let result;
    let failed = null;
    t.oncomplete = () => {
      if (failed) return reject(failed);
      if (st.dirty && hooks) { try { hooks.committed(); } catch (_) { /* abaikan */ } }
      resolve(result);
    };
    t.onerror = () => reject(t.error || failed);
    t.onabort = () => reject(failed || t.error || new Error('Transaksi dibatalkan'));
    Promise.resolve()
      .then(() => fn(stores, t))
      .then((r) => { result = r; })
      .catch((e) => { failed = e; try { t.abort(); } catch (_) { /* sudah tamat */ } });
  });
}

export const getAll = (store, indexName, query) =>
  tx(store, 'readonly', (s) => reqP(indexName ? s[store].index(indexName).getAll(query) : s[store].getAll(query)));

export const get = (store, key) => tx(store, 'readonly', (s) => reqP(s[store].get(key)));
export const put = (store, value) => tx(store, 'readwrite', (s) => reqP(s[store].put(value)));
export const del = (store, key) => tx(store, 'readwrite', (s) => reqP(s[store].delete(key)));
export const count = (store, indexName, query) =>
  tx(store, 'readonly', (s) => reqP(indexName ? s[store].index(indexName).count(query) : s[store].count(query)));
