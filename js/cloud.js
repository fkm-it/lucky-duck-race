/**
 * cloud.js — Klien RPC Supabase yang ringan (fetch sahaja, tiada SDK).
 * Kunci "publishable" memang direka untuk pelayar; keselamatan dikuatkuasa oleh fungsi RPC
 * (token QR majlis / kunci admin) dan jadual berada dalam skema yang tidak didedahkan.
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
  FORBIDDEN: 'Kunci pentadbir tidak sah untuk majlis ini.',
  WEAK_SECRET: 'Rahsia majlis tidak sah.',
  BAD_INPUT: 'Data tidak sah (maksimum 5,000 baris setiap muat naik).',
};

export class CloudError extends Error {
  constructor(code, message) { super(message || MESSAGES[code] || code); this.code = code; }
}

export async function rpc(fn, args = {}, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(CLOUD.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: CLOUD.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: ctl.signal,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new CloudError('NETWORK', 'Tiada sambungan internet ke pelayan kehadiran. Semak WiFi / data dan cuba lagi.');
  } finally { clearTimeout(t); }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!res.ok) {
    const code = body && typeof body === 'object' ? String(body.message || '') : '';
    if (MESSAGES[code]) throw new CloudError(code);
    throw new CloudError('SERVER', 'Ralat pelayan (' + res.status + '). Cuba lagi sebentar.');
  }
  return body;
}

export const cloudMessage = (code) => MESSAGES[code] || code;
