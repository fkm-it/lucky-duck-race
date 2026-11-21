/**
 * cloud.js — Klien Supabase yang ringan (fetch sahaja, tiada SDK): RPC + Supabase Auth (GoTrue REST).
 * Kunci "publishable" memang direka untuk pelayar. Keselamatan dikuatkuasa di pelayan:
 * jadual dalam skema tidak didedahkan + RLS, dan setiap fungsi RPC menyemak pengguna (JWT) + peranan.
 * TIADA kunci service_role dalam kod hadapan.
 */
export const CLOUD = Object.freeze({
  url: 'https://ajlxptgbwxnswcmyassf.supabase.co',
  key: 'sb_publishable_zpwJNDdrsa05_-iohSYsnA_YecI9uTM',
});

const MESSAGES = {
  NOT_FOUND: 'No. pekerja tidak dijumpai dalam senarai staf majlis ini. Sila semak semula atau rujuk kaunter pendaftaran.',
  INVALID_QR: 'Kod QR tidak sah atau telah ditukar. Sila imbas semula kod QR terkini di kaunter pendaftaran.',
  CLOSED: 'Pendaftaran kehadiran telah ditutup. Sila rujuk kaunter pendaftaran.',
  RATE_LIMIT: 'Terlalu banyak cubaan. Sila tunggu 1 minit dan cuba lagi.',
  FORBIDDEN: 'Peranan akaun anda tidak dibenarkan melakukan tindakan ini.',
  AUTH: 'Sesi log masuk telah tamat. Sila log masuk semula.',
  WEAK_SECRET: 'Rahsia majlis tidak sah.',
  BAD_INPUT: 'Data tidak sah.',
  BAD_CODE: 'Kod pentadbir pertama tidak sah atau telah digunakan.',
  LAST_ADMIN: 'Mesti ada sekurang-kurangnya seorang pentadbir aktif.',
  DUPLICATE: 'Cabutan ini sudah direkodkan.',
  CONFLICT: 'Peserta telah menang di peranti lain (konflik serentak). Cabutan dibatalkan — cuba lagi.',
  NO_ELIGIBLE: 'Tiada peserta layak.',
  TOO_MANY: 'Bilangan pemenang melebihi peserta layak.',
  PRIZE_NOT_FOUND: 'Hadiah tidak dijumpai.',
  PRIZE_EXHAUSTED: 'Baki hadiah tidak mencukupi.',
  BAD_COUNT: 'Bilangan pemenang mesti sekurang-kurangnya 1.',
  SERVER: 'Ralat pelayan. Cuba lagi sebentar.',
};

export class CloudError extends Error {
  constructor(code, message, hint) { super(message || MESSAGES[code] || code); this.code = code; this.hint = hint; }
}

/* Penyedia token akses (dipasang oleh auth.js). Mengembalikan access_token atau null. */
let tokenProvider = null;
let refreshHandler = null;
export function setAuthHooks({ token, refresh }) { tokenProvider = token; refreshHandler = refresh; }

async function call(path, body, { timeout = 15000, auth = true, method = 'POST' } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const headers = { apikey: CLOUD.key, 'Content-Type': 'application/json', Accept: 'application/json' };
  const tok = auth && tokenProvider ? await tokenProvider() : null;
  if (tok) headers.Authorization = 'Bearer ' + tok;
  let res;
  try {
    res = await fetch(CLOUD.url + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal, cache: 'no-store', referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new CloudError('NETWORK', 'Tiada sambungan internet ke pelayan. Semak WiFi / data dan cuba lagi.');
  } finally { clearTimeout(t); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { res, data, hadToken: !!tok };
}

export async function rpc(fn, args = {}, opt = {}) {
  let { res, data, hadToken } = await call('/rest/v1/rpc/' + fn, args, opt);
  // JWT tamat tempoh → segarkan sekali dan cuba semula
  if (res.status === 401 && hadToken && refreshHandler && (await refreshHandler().catch(() => false))) {
    ({ res, data } = await call('/rest/v1/rpc/' + fn, args, opt));
  }
  if (!res.ok) {
    const code = data && typeof data === 'object' ? String(data.message || '') : '';
    const hint = data && typeof data === 'object' ? data.hint : undefined;
    if (res.status === 401) throw new CloudError('AUTH');
    if (MESSAGES[code]) throw new CloudError(code, undefined, hint);
    throw new CloudError('SERVER', 'Ralat pelayan (' + res.status + '). Cuba lagi sebentar.');
  }
  return data;
}

/* ---------------------------------------------------------------- Supabase Auth (GoTrue) */
const AUTH_MSG = {
  invalid_credentials: 'E-mel atau kata laluan salah.',
  email_not_confirmed: 'E-mel belum disahkan. Semak peti masuk anda dan klik pautan pengesahan.',
  user_already_exists: 'Akaun dengan e-mel ini sudah wujud. Sila log masuk.',
  weak_password: 'Kata laluan terlalu lemah.',
  over_email_send_rate_limit: 'Terlalu banyak e-mel dihantar. Cuba lagi kemudian.',
  over_request_rate_limit: 'Terlalu banyak cubaan. Tunggu sebentar.',
  signup_disabled: 'Pendaftaran akaun baharu dimatikan. Hubungi pentadbir.',
};

export async function authCall(path, body) {
  const { res, data } = await call('/auth/v1/' + path, body, { auth: false, timeout: 20000 });
  if (!res.ok) {
    const code = data && (data.error_code || data.code || data.error);
    const msg = AUTH_MSG[code] || (data && (data.msg || data.error_description || data.message)) || ('Ralat log masuk (' + res.status + ')');
    throw new CloudError(typeof code === 'string' ? code : 'AUTH_ERROR', msg);
  }
  return data;
}

export async function authLogout(accessToken) {
  try {
    await fetch(CLOUD.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: CLOUD.key, Authorization: 'Bearer ' + accessToken }, referrerPolicy: 'no-referrer' });
  } catch (_) { /* luar talian */ }
}

export const cloudMessage = (code) => MESSAGES[code] || code;
