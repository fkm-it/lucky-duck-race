/**
 * db.js — Pembalut IndexedDB berasaskan Promise.
 * Semua operasi cabutan berlaku dalam SATU transaksi readwrite (atomik): sama ada semua
 * rekod pemenang/peserta/audit disimpan, atau tiada langsung.
 */

export const DB_NAME = 'lucky-duck-race';
export const DB_VERSION = 1;

let dbPromise = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains('participants')) {
    const s = db.createObjectStore('participants', { keyPath: 'staffId' }); // Staff ID = TEKS unik
    s.createIndex('status', 'status');
    s.createIndex('department', 'department');
    s.createIndex('duckNo', 'duckNo', { unique: true });
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
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB tidak disokong pelayar ini.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result);
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
export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = {};
    [].concat(storeNames).forEach((n) => { stores[n] = t.objectStore(n); });
    let result;
    let failed = null;
    t.oncomplete = () => (failed ? reject(failed) : resolve(result));
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
