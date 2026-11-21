/* Ujian v4: pangkalan data pusat (pelayan palsu meniru fungsi SQL ldr_*) + Supabase Auth + luar talian. */
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// ---------------------------------------------------------------- persekitaran pelayar minimum
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
const ss = new Map();
globalThis.sessionStorage = { getItem: (k) => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: (k) => ss.delete(k) };
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ---------------------------------------------------------------- pelayan palsu
const S = { offline: false, rev: 0, users: new Map(), tokens: new Map(), events: new Map(), docs: new Map(), tomb: new Map(), calls: [] };
const K = (ev, s, k) => ev + '|' + s + '|' + k;
const ROLE_W = { operator: ['participants', 'draws', 'winners', 'audit'], registrar: ['attendance', 'audit'] };
function addUser(email, password, role, name = '') { const id = 'u-' + email; S.users.set(email, { id, email, password, role, name, active: true }); return id; }
function issue(u) { const t = 'tok-' + Math.random().toString(36).slice(2); S.tokens.set(t, u.email); return { access_token: t, refresh_token: 'r' + t, expires_in: 3600, user: { id: u.id, email: u.email } }; }
const userBy = (tok) => S.users.get(S.tokens.get(tok));
function put(ev, s, k, d) {
  if (s === 'participants') {
    let n = d.duckNo;
    const others = [...S.docs.entries()].filter(([kk]) => kk.startsWith(ev + '|participants|') && !kk.endsWith('|' + k));
    if (!n || others.some(([, x]) => x.d.duckNo === n)) {
      n = Math.max(S.events.get(ev).duckSeq, 1 + Math.max(0, ...others.map(([, x]) => x.d.duckNo || 0)));
      d = { ...d, duckNo: n };
    }
    S.events.get(ev).duckSeq = Math.max(S.events.get(ev).duckSeq, n + 1);
  }
  const r = ++S.rev;
  S.docs.set(K(ev, s, k), { s, k, r, d: { ...d } });
  S.tomb.delete(K(ev, s, k));
  if (s === 'attendance' && !S.docs.has(K(ev, 'participants', k))) {
    const st = S.docs.get(K(ev, 'staff', k));
    put(ev, 'participants', k, { staffId: k, name: st ? st.d.name : k, department: st ? st.d.department : '', status: 'ELIGIBLE', winCount: 0, source: 'attendance', checkedInAt: d.checkedInAt, createdAt: new Date().toISOString() });
  }
  return S.docs.get(K(ev, s, k));
}
function del(ev, s, k) {
  S.docs.delete(K(ev, s, k));
  S.tomb.set(K(ev, s, k), { s, k, r: ++S.rev, x: true });
  if (s === 'attendance') { const p = S.docs.get(K(ev, 'participants', k)); if (p && p.d.source === 'attendance' && p.d.status === 'ELIGIBLE') del(ev, 'participants', k); }
}
const meta = (ev) => { const e = S.events.get(ev); return { event_id: ev, name: e.name, is_open: true, is_active: e.active, qr_token: e.token, control_device: e.ctl || null, control_name: e.ctlName || null }; };
function need(u, ...roles) { if (!u) throw { message: 'AUTH', status: 401 }; if (!u.role || !roles.includes(u.role)) throw { message: 'FORBIDDEN' }; return u.role; }
const RPC = {
  ldr_me: (a, u) => { const ev = [...S.events.entries()].find(([, e]) => e.active); return { user_id: u.id, email: u.email, name: u.name, role: u.role, active: true, admins: 1, event: u.role && ev ? meta(ev[0]) : null }; },
  ldr_sync_pull: (a, u) => {
    need(u, 'admin', 'operator', 'registrar');
    const rows = [...S.docs.entries(), ...S.tomb.entries()].filter(([kk, x]) => kk.startsWith(a.p_event + '|') && x.r > a.p_since)
      .map(([, x]) => ({ s: x.s, k: x.k, r: x.r, d: x.x ? null : x.d, x: !!x.x })).sort((p, q) => p.r - q.r).slice(0, a.p_limit);
    return { rows, more: rows.length >= a.p_limit, meta: meta(a.p_event) };
  },
  ldr_sync_push: (a, u) => {
    const role = need(u, 'admin', 'operator', 'registrar');
    const e = S.events.get(a.p_event);
    const ctl = ['admin', 'operator'].includes(role) && e.ctl === a.p_device;
    const applied = []; const rejected = [];
    for (const r of a.p_rows) {
      const cur = S.docs.get(K(a.p_event, r.s, r.k));
      if (!(role === 'admin' || (ROLE_W[role] || []).includes(r.s))) { rejected.push({ s: r.s, k: r.k, r: cur && cur.r, d: cur ? cur.d : null, x: !cur, e: 'FORBIDDEN' }); continue; }
      if (cur && !ctl && r.s !== 'attendance' && cur.r > (r.b || 0)) { rejected.push({ s: r.s, k: r.k, r: cur.r, d: cur.d, x: false, e: 'CONFLICT' }); continue; }
      if (r.x) { if (cur) del(a.p_event, r.s, r.k); applied.push({ s: r.s, k: r.k, r: S.rev, x: true }); continue; }
      if (r.s === 'attendance') {
        if (!S.docs.has(K(a.p_event, 'staff', r.k))) { rejected.push({ s: r.s, k: r.k, r: null, d: null, x: true, e: 'NOT_FOUND' }); continue; }
        const x = cur || put(a.p_event, 'attendance', r.k, r.d);
        applied.push({ s: r.s, k: r.k, r: x.r, d: x.d }); continue;
      }
      const x = put(a.p_event, r.s, r.k, r.d);
      applied.push({ s: r.s, k: r.k, r: x.r, d: x.d });
    }
    return { applied, rejected, control: ctl, role };
  },
  ldr_draw: (a, u) => {
    need(u, 'admin', 'operator');
    const ev = a.p_event;
    const pool = [...S.docs.values()].filter((x) => x.s === 'participants' && x.d.status === 'ELIGIBLE').map((x) => x.d).sort((p, q) => p.duckNo - q.duckNo);
    if (!pool.length) throw { message: 'NO_ELIGIBLE' };
    if (a.p_count > pool.length) throw { message: 'TOO_MANY', hint: String(pool.length) };
    const prize = a.p_prize_id ? S.docs.get(K(ev, 'prizes', a.p_prize_id)).d : null;
    if (prize) {
      const awarded = [...S.docs.values()].filter((x) => x.s === 'winners' && x.d.prizeId === prize.id && !x.d.revoked).length;
      if (awarded + a.p_count > prize.quantity) throw { message: 'PRIZE_EXHAUSTED', hint: String(prize.quantity - awarded) };
    }
    const idx = pool.map((_, i) => i);
    for (let i = 0; i < a.p_count; i++) { const j = i + Math.floor(Math.random() * (pool.length - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const revs = [];
    const winners = idx.slice(0, a.p_count).map((i, n) => {
      const p = pool[i];
      revs.push({ s: 'participants', k: p.staffId, r: put(ev, 'participants', p.staffId, { ...p, status: 'WINNER', winCount: (p.winCount || 0) + 1 }).r });
      const w = { id: 'W-' + a.p_draw_id + '-' + (n + 1), drawId: a.p_draw_id, staffId: p.staffId, name: p.name, duckNo: p.duckNo, prizeId: a.p_prize_id, prizeName: prize ? prize.name : 'Cabutan Khas', rankInDraw: n + 1, winnerNo: n + 1, revoked: false };
      revs.push({ s: 'winners', k: w.id, r: put(ev, 'winners', w.id, w).r });
      return w;
    });
    const draw = { id: a.p_draw_id, createdAt: new Date().toISOString(), prizeId: a.p_prize_id, poolIds: pool.map((p) => p.staffId), winnerIds: winners.map((w) => w.staffId), count: a.p_count, poolSize: pool.length, integrity: 'x'.repeat(64), mode: 'online', status: 'COMMITTED' };
    revs.push({ s: 'draws', k: draw.id, r: put(ev, 'draws', draw.id, draw).r });
    return { draw, winners, pool, prize, revs };
  },
  ldr_claim_control: (a, u) => { need(u, 'admin', 'operator'); const e = S.events.get(a.p_event); e.ctl = a.p_device; e.ctlName = a.p_device_name; return meta(a.p_event); },
};
const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, opt) => {
  S.calls.push(url);
  if (S.offline) throw new TypeError('Failed to fetch');
  const body = opt.body ? JSON.parse(opt.body) : {};
  if (url.includes('/auth/v1/token?grant_type=password')) {
    const u = S.users.get(body.email);
    if (!u || u.password !== body.password) return reply(400, { error_code: 'invalid_credentials' });
    return reply(200, issue(u));
  }
  if (url.includes('/auth/v1/token?grant_type=refresh_token')) { const u = userBy(body.refresh_token.slice(1)); return u ? reply(200, issue(u)) : reply(400, {}); }
  if (url.includes('/auth/v1/logout')) return reply(204, {});
  const fn = url.split('/rpc/')[1];
  const tok = (opt.headers.Authorization || '').replace('Bearer ', '');
  try { return reply(200, RPC[fn](body, userBy(tok))); } catch (e) { return reply(e.status || 400, { message: e.message, hint: e.hint }); }
};

// ---------------------------------------------------------------- data awal pelayan
const EV = 'ev-1';
S.events.set(EV, { name: 'Majlis Ujian', active: true, token: 'q'.repeat(32), duckSeq: 1 });
addUser('admin@fkm.my', 'Admin1234', 'admin', 'Za');
addUser('reg@fkm.my', 'Daftar1234', 'registrar', 'Kaunter');
addUser('baru@fkm.my', 'Baru12345', null);

const store = await import('../js/store.js');
const sync = await import('../js/sync.js');
const auth = await import('../js/auth.js');
const att = await import('../js/attendance.js');
const db = await import('../js/db.js');
await db.openDb();
await auth.init();

async function signIn(email, pw) {
  await auth.login(email, pw);
  const p = auth.profile();
  if (p.event) await store.setKV('lastEvent', p.event);
  await sync.start({ role: p.role, event: p.event || (await store.getKV('lastEvent')), token: auth.token });
}
const items = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ name: 'Staf ' + (i + from), staffId: String(i + from).padStart(5, '0'), department: 'IT' }));
const serverCount = (s) => [...S.docs.values()].filter((x) => x.s === s).length;

test('data pelayar lama → pentadbir muat naik ke pangkalan data pusat', async () => {
  await store.importParticipants(items(30), 'skip', 'lama.xlsx');              // data versi lama (setempat sahaja)
  await store.savePrize({ category: 'Hadiah Utama', name: 'TV', quantity: 1, sequence: 1 });
  let legacy = null;
  const off = sync.on((t, d) => { if (t === 'legacy') legacy = d; });
  await signIn('admin@fkm.my', 'Admin1234');
  off();
  assert.equal(auth.role(), 'admin');
  assert.ok(legacy && legacy.participants === 30, 'data lama dikesan, penyegerakan dijeda');
  assert.equal(serverCount('participants'), 0, 'tiada apa dihantar sebelum keputusan');
  await sync.resolveLegacy('upload');
  assert.equal(serverCount('participants'), 30);
  assert.equal(serverCount('prizes'), 1);
  assert.equal(sync.state.pending, 0);
});

test('perubahan dari peranti lain (pusat) ditarik; jumlah sama', async () => {
  put(EV, 'participants', '99999', { staffId: '99999', name: 'Dari Edge', department: 'HR', status: 'ELIGIBLE', winCount: 0, duckNo: 31 });
  put(EV, 'staff', '77777', { staffId: '77777', name: 'Staf QR', department: 'Pentadbiran' });
  put(EV, 'attendance', '77777', { staffId: '77777', checkedInAt: new Date().toISOString(), via: 'qr' });   // telefon imbas QR → pelayan cipta peserta
  await sync.tick();
  const st = await store.stats();
  assert.equal(st.total, serverCount('participants'));
  assert.equal(st.total, 32);
  assert.ok((await store.listParticipants()).some((p) => p.staffId === '77777' && p.source === 'attendance'));
});

test('cabutan DALAM TALIAN dibuat di pelayan; pemenang disimpan berpusat & dibuang daripada kumpulan layak', async () => {
  const prizes = await store.listPrizes();
  const r = await store.executeDraw({ prizeId: prizes[0].id, count: 1 });
  assert.equal(r.draw.mode, 'online');
  assert.ok(S.calls.some((u) => u.endsWith('/rpc/ldr_draw')));
  const w = r.winners[0];
  assert.equal(S.docs.get(K(EV, 'participants', w.staffId)).d.status, 'WINNER');
  assert.equal((await store.listParticipants()).find((p) => p.staffId === w.staffId).status, 'WINNER');
  await assert.rejects(store.executeDraw({ prizeId: prizes[0].id, count: 1 }), /Baki hadiah/);
  // pulih pemenang sejurus selepas cabutan pelayan (tanpa tarikan) → bukan konflik
  await store.restoreWinner(w.id, 'ujian');
  await sync.tick();
  assert.equal(S.docs.get(K(EV, 'participants', w.staffId)).d.status, 'ELIGIBLE');
  assert.equal(S.docs.get(K(EV, 'winners', w.id)).d.revoked, true);
});

test('LUAR TALIAN: cabutan hanya di Peranti Kawalan; baris gilir kekal & disegerak tanpa pendua', async () => {
  S.offline = true;
  await sync.tick().catch(() => {});
  assert.equal(sync.phase(), 'offline');
  await assert.rejects(store.executeDraw({ count: 2 }), /Peranti Kawalan/);
  S.offline = false;
  await sync.claimControl();
  assert.ok(sync.isControl());
  S.offline = true;
  const r = await store.executeDraw({ count: 2 });
  assert.equal(r.draw.mode, 'offline');
  await sync.tick().catch(() => {});
  assert.ok(sync.state.pending >= 5, 'rekod menunggu: ' + sync.state.pending);
  const ob = await db.tx('outbox', 'readonly', (s) => db.reqP(s.outbox.count()));
  assert.equal(ob, sync.state.pending, 'baris gilir tersimpan dalam IndexedDB (kekal selepas muat semula)');
  S.offline = false;
  await sync.tick();
  assert.equal(sync.state.pending, 0);
  for (const w of r.winners) assert.equal(S.docs.get(K(EV, 'participants', w.staffId)).d.status, 'WINNER');
  await sync.tick();
  assert.equal(serverCount('winners'), 3, 'tiada pendua pemenang');
});

test('peranan Staf Pendaftaran: kehadiran luar talian → pelayan cipta peserta; tidak boleh ubah hadiah / cabut', async () => {
  sync.signOut(); await auth.logout();
  put(EV, 'staff', '55555', { staffId: '55555', name: 'Aminah', department: 'HEP' });
  await signIn('reg@fkm.my', 'Daftar1234');
  assert.equal(auth.role(), 'registrar');
  assert.equal(auth.can('draw'), false);
  await sync.tick();
  await assert.rejects(store.savePrize({ category: 'Sagu Hati', name: 'Baucar', quantity: 5, sequence: 9 }), /tidak dibenarkan/);
  await assert.rejects(store.executeDraw({ count: 1 }), /Pentadbir atau Operator/);
  S.offline = true;
  await sync.tick().catch(() => {});
  await att.setCheckin('55555', true);
  await att.setCheckin('55555', true); // dua kali → tiada pendua
  assert.ok(sync.state.pending >= 1);
  S.offline = false;
  await sync.tick(); await sync.tick();
  assert.equal([...S.docs.values()].filter((x) => x.s === 'attendance' && x.k === '55555').length, 1);
  assert.ok((await store.listParticipants()).some((p) => p.staffId === '55555'), 'peserta dicipta oleh pelayan & ditarik');
});

test('log masuk LUAR TALIAN: hanya pengguna yang pernah log masuk di peranti ini', async () => {
  sync.signOut(); await auth.logout();
  S.offline = true;
  await assert.rejects(auth.login('reg@fkm.my', 'salah999'), /salah/);
  await assert.rejects(auth.login('baru@fkm.my', 'Baru12345'), /pernah log masuk/);
  const p = await auth.login('reg@fkm.my', 'Daftar1234');
  assert.equal(p.role, 'registrar');
  assert.ok(auth.isOfflineSession());
  assert.ok(auth.isLoggedIn());
  S.offline = false;
});

test('akaun baharu tanpa peranan tidak nampak majlis / data', async () => {
  sync.signOut(); await auth.logout();
  const me = await auth.login('baru@fkm.my', 'Baru12345');
  assert.equal(me.role, null);
  assert.equal(me.event, null);
  assert.throws(() => RPC.ldr_sync_pull({ p_event: EV, p_since: 0, p_limit: 10 }, S.users.get('baru@fkm.my')), (e) => e.message === 'FORBIDDEN');
});

test('konflik: peranti biasa mengubah rekod yang telah berubah di pusat → versi pusat dikekalkan', async () => {
  sync.signOut(); await auth.logout();
  await signIn('admin@fkm.my', 'Admin1234');
  S.events.get(EV).ctl = 'dev-lain';
  await sync.tick();
  assert.equal(sync.isControl(), false);
  const cur = S.docs.get(K(EV, 'participants', '00001'));
  put(EV, 'participants', '00001', { ...cur.d, name: 'Nama Pusat' });
  await store.updateParticipant('00001', { staffId: '00001', name: 'Nama Setempat', department: 'IT' });
  let rej = null; const off = sync.on((t, d) => { if (t === 'rejected') rej = d; });
  await sync.tick(); off();
  assert.equal(rej && rej[0].e, 'CONFLICT');
  assert.equal((await store.listParticipants()).find((p) => p.staffId === '00001').name, 'Nama Pusat');
});

test.after(() => sync.stop());
