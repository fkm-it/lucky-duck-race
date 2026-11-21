/**
 * auth.js — Log masuk berpusat (Supabase Auth) + log masuk LUAR TALIAN yang selamat.
 *
 *  - Dalam talian: e-mel + kata laluan → Supabase Auth (JWT). Peranan (admin / operator / registrar)
 *    diambil daripada pangkalan data (ldr_me) — bukan daripada pelayar.
 *  - Selepas log masuk dalam talian berjaya, pengesah luar talian disimpan: PBKDF2-SHA256 (210k lelaran,
 *    garam rawak) bagi kata laluan + peranan terakhir. Tanpa internet, HANYA pengguna yang pernah log masuk
 *    di peranti ini boleh masuk semula, dengan peranan terakhir yang disahkan pelayan.
 *  - Tiada kunci service_role. Token disimpan dalam IndexedDB pelayar ini sahaja.
 */
import { get, put, tx, reqP } from './db.js';
import { authCall, authLogout, rpc, setAuthHooks, CloudError, CLOUD } from './cloud.js';

const ITER = 210000;
const SESSION_FLAG = 'ldr.session';
const SESSION_TTL = 12 * 3600 * 1000;
const S_KEY = 'authSession';     // {access_token, refresh_token, expires_at, user, profile}
const V_KEY = 'offlineAuth';     // {[email]: {salt, hash, iterations, userId, role, name, at}}
let failCount = 0;
let session = null;              // dalam memori
let refreshing = null;

const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const normEmail = (e) => String(e || '').trim().toLowerCase();

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

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Kata laluan mesti sekurang-kurangnya 8 aksara.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Kata laluan mesti mengandungi huruf dan nombor.';
  return '';
}

const kv = async (k) => { const r = await get('settings', k); return r ? r.value : null; };
const setKv = (k, v) => tx('settings', 'readwrite', (s) => reqP(s.settings.put({ key: k, value: v })), { remote: true });

// ----------------------------------------------------------------------------- token

async function saveSession(s) { session = s; await setKv(S_KEY, s); }

function absorbToken(t) {
  return {
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: t.expires_at || Math.floor(Date.now() / 1000) + (t.expires_in || 3600),
    user: { id: t.user && t.user.id, email: normEmail(t.user && t.user.email) },
  };
}

export async function refresh() {
  if (!session || !session.refresh_token) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const t = await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
        await saveSession({ ...session, ...absorbToken(t) });
        return true;
      } catch (e) {
        if (e instanceof CloudError && e.code === 'NETWORK') return false;
        return false;
      } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

/** access_token yang sah (disegarkan jika hampir tamat). null jika luar talian tanpa token sah. */
export async function token() {
  if (!session || !session.access_token) return null;
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session && session.expires_at > Date.now() / 1000 ? session.access_token : (session ? session.access_token : null);
}

setAuthHooks({ token, refresh });

// ----------------------------------------------------------------------------- keadaan

export async function init() {
  session = await kv(S_KEY);
}
export function isLoggedIn() {
  const t = parseInt(sessionStorage.getItem(SESSION_FLAG) || '0', 10);
  if (!session || !session.profile || !t || Date.now() - t > SESSION_TTL) return false;
  sessionStorage.setItem(SESSION_FLAG, String(Date.now()));
  return true;
}
export const profile = () => (session && session.profile) || null;
export const role = () => (session && session.profile && session.profile.role) || null;
export const isOfflineSession = () => !!(session && session.offline);
export const email = () => (session && session.user && session.user.email) || '';

/** Kebenaran UI ikut peranan (pelayan tetap menguatkuasa semula). */
const PERMS = {
  admin: ['*'],
  operator: ['dashboard', 'participants', 'draw', 'history', 'reports', 'settings', 'draw:run', 'winners:restore'],
  registrar: ['dashboard', 'attendance', 'participants', 'reports', 'settings', 'attendance:checkin'],
};
export function can(what) {
  const r = role();
  if (!r) return false;
  const p = PERMS[r] || [];
  return p.includes('*') || p.includes(what);
}
export const ROLE_LABEL = { admin: 'Pentadbir', operator: 'Operator Cabutan', registrar: 'Staf Pendaftaran' };

// ----------------------------------------------------------------------------- log masuk

async function storeVerifier(em, pw, prof) {
  const all = (await kv(V_KEY)) || {};
  const salt = randomHex(16);
  all[em] = { salt, hash: await derive(pw, salt, ITER), iterations: ITER, userId: prof.user_id, role: prof.role, name: prof.name, at: new Date().toISOString() };
  await setKv(V_KEY, all);
}

/** Muat semula profil (peranan & majlis aktif) dari pelayan. */
export async function refreshProfile() {
  const me = await rpc('ldr_me');
  await saveSession({ ...session, profile: me, offline: false });
  const all = (await kv(V_KEY)) || {};
  const em = email();
  if (all[em]) { all[em] = { ...all[em], role: me.role, name: me.name }; await setKv(V_KEY, all); }
  return me;
}

/**
 * Log masuk. Dalam talian → Supabase Auth. Jika tiada sambungan → pengesah luar talian
 * (hanya untuk pengguna yang pernah log masuk dalam talian di peranti ini).
 */
export async function login(emailIn, pw) {
  if (failCount >= 5) await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** (failCount - 4))));
  const em = normEmail(emailIn);
  if (!em || !pw) throw new Error('Masukkan e-mel dan kata laluan.');
  try {
    const t = await authCall('token?grant_type=password', { email: em, password: String(pw) });
    session = { ...absorbToken(t), profile: null };
    const me = await rpc('ldr_me');
    await saveSession({ ...session, profile: me, offline: false });
    if (me.role) await storeVerifier(em, String(pw), me);
    failCount = 0;
    sessionStorage.setItem(SESSION_FLAG, String(Date.now()));
    return me;
  } catch (e) {
    if (!(e instanceof CloudError && e.code === 'NETWORK')) { failCount++; throw e; }
    // ---- LUAR TALIAN
    const v = ((await kv(V_KEY)) || {})[em];
    if (!v || !v.role) throw new Error('Tiada sambungan internet. Log masuk luar talian hanya untuk pengguna yang pernah log masuk dalam talian di peranti ini.');
    const h = await derive(String(pw), v.salt, v.iterations);
    if (!safeEqual(h, v.hash)) { failCount++; throw new Error('Kata laluan salah.'); }
    failCount = 0;
    const prev = await kv(S_KEY);
    const keep = prev && prev.user && prev.user.email === em ? prev : { user: { id: v.userId, email: em } };
    const prof = { ...(keep.profile || {}), user_id: v.userId, email: em, role: v.role, name: v.name };
    await saveSession({ ...keep, profile: prof, offline: true });
    sessionStorage.setItem(SESSION_FLAG, String(Date.now()));
    return prof;
  }
}

export async function signup(emailIn, pw, name) {
  const p = passwordProblem(pw);
  if (p) throw new Error(p);
  const em = normEmail(emailIn);
  const t = await authCall('signup', { email: em, password: pw, data: { name: String(name || '').trim().slice(0, 120) } });
  if (t && t.access_token) return login(em, pw);       // pengesahan e-mel dimatikan
  return { confirmEmail: true };
}

export async function recover(emailIn) {
  await authCall('recover', { email: normEmail(emailIn) });
}

export async function bootstrapAdmin(code, name) {
  const me = await rpc('ldr_bootstrap_admin', { p_code: String(code || '').trim(), p_name: name || '' });
  await saveSession({ ...session, profile: me });
  return me;
}

export async function changePassword(oldPw, newPw) {
  const p = passwordProblem(newPw);
  if (p) throw new Error(p);
  const em = email();
  await authCall('token?grant_type=password', { email: em, password: String(oldPw) }).catch((e) => {
    throw (e instanceof CloudError && e.code === 'NETWORK') ? e : new Error('Kata laluan semasa salah.');
  });
  const tok = await token();
  const res = await fetch(CLOUD.url + '/auth/v1/user', {
    method: 'PUT', headers: { apikey: CLOUD.key, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPw }), referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new Error('Kata laluan tidak dapat ditukar (' + res.status + ').');
  if (profile() && profile().role) await storeVerifier(em, newPw, profile());
}

export async function logout() {
  sessionStorage.removeItem(SESSION_FLAG);
  if (session && session.access_token && !session.offline) authLogout(session.access_token);
  // Token dibuang; pengesah luar talian & data setempat dikekalkan
  if (session) await saveSession({ user: session.user, profile: null });
  session = null;
}
