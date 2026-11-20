/**
 * rng.js — Pemilihan rawak SELAMAT (kriptografi) dan tanpa bias.
 *
 * - Sumber entropi: crypto.getRandomValues (CSPRNG pelayar / Node).
 * - randomInt(n) guna "rejection sampling" supaya setiap nilai 0..n-1 mempunyai
 *   kebarangkalian yang sama tepat (tiada modulo bias).
 * - pickUnique() guna Fisher–Yates separa: setiap subset bersaiz k sama berkemungkinan,
 *   dan susunan pemenang juga rawak seragam.
 *
 * Modul ini TIDAK menerima sebarang input daripada animasi, kedudukan itik atau interaksi
 * pengguna — hanya saiz kumpulan dan bilangan pemenang.
 */

const UINT32 = 0x100000000;

function cryptoObj() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('Penjana rawak selamat (crypto.getRandomValues) tidak tersedia pada pelayar ini.');
  }
  return c;
}

/** Integer rawak seragam dalam [0, n). n mesti 1..2^32. */
export function randomInt(n) {
  if (!Number.isInteger(n) || n < 1 || n > UINT32) throw new RangeError('randomInt: n tidak sah');
  if (n === 1) return 0;
  const limit = UINT32 - (UINT32 % n); // nilai >= limit ditolak → tiada bias
  const buf = new Uint32Array(1);
  const c = cryptoObj();
  for (;;) {
    c.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Pilih k indeks unik daripada 0..n-1 (susunan = susunan pemenang).
 * @returns {number[]}
 */
export function pickUnique(n, k) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('pickUnique: n tidak sah');
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError('pickUnique: k mesti antara 0 dan n');
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(n - i);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx.slice(0, k);
}

/** Hex rawak (untuk ID cabutan / garam). */
export function randomHex(bytes = 8) {
  const b = new Uint8Array(bytes);
  cryptoObj().getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex (kod integriti cabutan). */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const h = await cryptoObj().subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
}
