/**
 * auth.js — Kata laluan pentadbir (PBKDF2-SHA256, 210k lelaran, garam rawak).
 * Nota: aplikasi ini berjalan sepenuhnya di pelayar (tiada pelayan). Log masuk melindungi
 * dashboard daripada akses kasual pada komputer majlis; ia bukan pengganti kawalan akses peranti.
 */
import { get, put } from './db.js';
import { randomHex } from './rng.js';
import { audit } from './store.js';

const ITER = 210000;
const SESSION_KEY = 'ldr.session';
const SESSION_TTL = 8 * 3600 * 1000;
let failCount = 0;

const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');

async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hasAdmin() {
  return !!(await get('settings', 'auth'));
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Kata laluan mesti sekurang-kurangnya 8 aksara.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Kata laluan mesti mengandungi huruf dan nombor.';
  return '';
}

export async function setPassword(pw) {
  const p = passwordProblem(pw);
  if (p) throw new Error(p);
  const salt = randomHex(16);
  const hash = await derive(pw, salt, ITER);
  await put('settings', { key: 'auth', value: { salt, hash, iterations: ITER, updatedAt: new Date().toISOString() } });
  startSession();
}

export async function login(pw) {
  if (failCount >= 5) await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** (failCount - 4))));
  const rec = await get('settings', 'auth');
  if (!rec) throw new Error('Pentadbir belum disediakan.');
  const h = await derive(String(pw || ''), rec.value.salt, rec.value.iterations);
  if (!safeEqual(h, rec.value.hash)) {
    failCount++;
    await audit('LOG_MASUK_GAGAL', 'Percubaan ke-' + failCount);
    throw new Error('Kata laluan salah.');
  }
  failCount = 0;
  startSession();
  await audit('LOG_MASUK', '');
}

export async function changePassword(oldPw, newPw) {
  const rec = await get('settings', 'auth');
  const h = await derive(String(oldPw || ''), rec.value.salt, rec.value.iterations);
  if (!safeEqual(h, rec.value.hash)) throw new Error('Kata laluan semasa salah.');
  await setPassword(newPw);
  await audit('TUKAR_KATA_LALUAN', '');
}

function startSession() {
  sessionStorage.setItem(SESSION_KEY, String(Date.now()));
}

export function isLoggedIn() {
  const t = parseInt(sessionStorage.getItem(SESSION_KEY) || '0', 10);
  if (!t || Date.now() - t > SESSION_TTL) return false;
  sessionStorage.setItem(SESSION_KEY, String(Date.now())); // gelongsor
  return true;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
