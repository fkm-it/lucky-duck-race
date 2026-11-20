/* Ujian penyegerakan awan: pelayan palsu (meniru fungsi RPC ldr_cloud_*) + fake-indexeddb. */
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- pelayan palsu
const srv = { rev: 0, docs: new Map(), sessions: new Map(), event: null, offline: false, calls: [] };
let seq = 0;
const handlers = {
  ldr_create_event: (a) => { srv.event = { id: 'ev-1', name: a.p_name, token: a.p_token, admin: a.p_admin_key }; return srv.event.id; },
  ldr_cloud_enable: (a) => {
    if (a.p_admin_key !== srv.event.admin) throw { message: 'FORBIDDEN' };
    Object.assign(srv.event, { code: 'RTD-TEST01', pw: a.p_password, control_device: a.p_device, control_name: a.p_device_name });
    const s = 'S' + (++seq); srv.sessions.set(s, a.p_device);
    return meta({ session: s });
  },
  ldr_cloud_join: (a) => {
    if (a.p_code.toUpperCase() !== srv.event.code || a.p_password !== srv.event.pw) throw { message: 'BAD_LOGIN' };
    const s = 'S' + (++seq); srv.sessions.set(s, a.p_device);
    return meta({ session: s });
  },
  ldr_cloud_push: (a) => {
    const dev = sess(a);
    const ctl = srv.event.control_device === dev;
    const applied = []; const rejected = [];
    for (const r of a.p_rows) {
      const k = r.s + '|' + r.k;
      const cur = srv.docs.get(k);
      if (cur && !ctl && cur.r > (r.b || 0)) { rejected.push({ s: r.s, k: r.k, r: cur.r, d: cur.d, x: cur.x }); continue; }
      const rev = ++srv.rev;
      srv.docs.set(k, { s: r.s, k: r.k, r: rev, d: r.x ? null : r.d, x: !!r.x });
      applied.push({ s: r.s, k: r.k, r: rev });
    }
    return { applied, rejected, control: ctl };
  },
  ldr_cloud_pull: (a) => {
    sess(a);
    const rows = [...srv.docs.values()].filter((d) => d.r > (a.p_since || 0)).sort((x, y) => x.r - y.r).slice(0, a.p_limit);
    return { rows, more: rows.length >= a.p_limit, meta: meta({}) };
  },
  ldr_cloud_claim: (a) => { srv.event.control_device = sess(a); srv.event.control_name = 'B'; return meta({}); },
  ldr_cloud_leave: () => null,
};
function sess(a) { const d = srv.sessions.get(a.p_session); if (!d) throw { message: 'SESSION' }; return d; }
function meta(extra) {
  const e = srv.event;
  return { event_id: e.id, name: e.name, code: e.code, qr_token: e.token, control_device: e.control_device, control_name: e.control_name, ...extra };
}
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
globalThis.fetch = async (url, opt) => {
  const fn = url.split('/rpc/')[1];
  srv.calls.push(fn);
  if (srv.offline) throw new TypeError('Failed to fetch');
  const args = JSON.parse(opt.body);
  try {
    const out = handlers[fn](args);
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  } catch (e) {
    return { ok: false, status: 400, text: async () => JSON.stringify({ message: e.message }) };
  }
};

const S = await import('../js/store.js');
const sync = await import('../js/sync.js');
const att = await import('../js/attendance.js');
const db = await import('../js/db.js');

const items = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ name: 'Staf ' + (i + from), staffId: String(i + from).padStart(5, '0'), department: 'IT' }));

test('aktifkan → semua data setempat dimuat naik; perubahan baharu dihantar', async () => {
  await sync.init();
  await S.importParticipants(items(50), 'skip', 'a.xlsx');
  await S.savePrize({ category: 'Hadiah Utama', name: 'TV', quantity: 2, sequence: 1 });
  await S.saveSettings({ eventName: 'Majlis Ujian', soundEnabled: true });
  const cfg = await att.createEvent('Majlis Ujian');
  const c = await sync.enable(cfg, 'Rahsia123');
  assert.equal(c.code, 'RTD-TEST01');
  assert.ok(sync.isControl(), 'peranti yang mengaktifkan = Peranti Kawalan');
  await sync.tick();
  assert.equal(sync.state.pending, 0, 'outbox kosong');
  const parts = [...srv.docs.values()].filter((d) => d.s === 'participants');
  assert.equal(parts.length, 50);
  assert.ok(srv.docs.get('settings|app'), 'tetapan dikongsi dimuat naik');
  assert.ok(!srv.docs.get('settings|auth') && !srv.docs.get('settings|cloud') && !srv.docs.get('settings|appLocal'), 'rahsia / tetapan peranti TIDAK dimuat naik');
  assert.ok(!('soundEnabled' in srv.docs.get('settings|app').d), 'tetapan bunyi khusus peranti, tidak dikongsi');

  // Cabutan oleh Peranti Kawalan → pemenang & status disegerak
  const prizes = await S.listPrizes();
  const d = await S.executeDraw({ prizeId: prizes[0].id, count: 2 });
  await sync.tick();
  const w = [...srv.docs.values()].filter((x) => x.s === 'winners');
  assert.equal(w.length, 2);
  assert.equal(srv.docs.get('participants|' + d.winners[0].staffId).d.status, 'WINNER');
  assert.ok(srv.docs.get('draws|' + d.draw.id).d.integrity, 'kod integriti turut disegerak');
});

test('luar talian: Peranti Kawalan masih boleh cabut; perubahan dihantar bila online', async () => {
  srv.offline = true;
  await sync.tick().catch(() => {});
  assert.equal(sync.state.online, false);
  const d = await S.executeDraw({ count: 3 });
  await sync.tick().catch(() => {});
  assert.ok(sync.state.pending >= 7, 'perubahan menunggu dalam outbox');
  srv.offline = false;
  await sync.tick();
  assert.equal(sync.state.pending, 0);
  for (const x of d.winners) assert.equal(srv.docs.get('participants|' + x.staffId).d.status, 'WINNER');
});

test('perubahan dari peranti lain ditarik; konflik ditolak untuk peranti biasa', async () => {
  // Peranti lain menambah peserta (disimulasi terus di pelayan)
  srv.docs.set('participants|99999', { s: 'participants', k: '99999', r: ++srv.rev, d: { staffId: '99999', name: 'Dari Brave', department: 'HR', duckNo: 9999, status: 'ELIGIBLE', winCount: 0, createdAt: new Date().toISOString() }, x: false });
  await sync.tick();
  const p = (await S.listParticipants()).find((x) => x.staffId === '99999');
  assert.equal(p && p.name, 'Dari Brave');

  // Serah kawalan kepada peranti lain → peranti ini jadi peranti biasa
  srv.event.control_device = 'dev-lain'; srv.event.control_name = 'Laptop B';
  await sync.tick();
  assert.equal(sync.isControl(), false);
  await assert.rejects(S.executeDraw({ count: 1 }), /Peranti Kawalan/);

  // Peranti biasa ubah rekod yang telah berubah di awan → ditolak, versi awan dipulihkan
  srv.docs.set('participants|00001', { ...srv.docs.get('participants|00001'), r: ++srv.rev, d: { ...srv.docs.get('participants|00001').d, name: 'Nama Awan' } });
  const s0 = sync.state.cfg.since;
  sync.state.cfg = { ...sync.state.cfg, since: s0 }; // belum ditarik
  await S.updateParticipant('00001', { staffId: '00001', name: 'Nama Setempat', department: 'IT' });
  await sync.tick();
  const p1 = (await S.listParticipants()).find((x) => x.staffId === '00001');
  assert.equal(p1.name, 'Nama Awan', 'versi awan menang bagi peranti biasa');

  // Peranti biasa + luar talian = baca sahaja (log audit masih dibenarkan)
  srv.offline = true;
  await sync.tick().catch(() => {});
  await assert.rejects(S.savePrize({ category: 'Sagu Hati', name: 'Baucar', quantity: 5, sequence: 9 }), /BACA SAHAJA/);
  await S.audit('UJIAN', 'audit dibenarkan');
  srv.offline = false;
});

test('sertai dari pelayar lain: data setempat diganti dengan data awan', async () => {
  srv.event.control_device = sync.state.device.id; // kembalikan kawalan
  const before = await S.stats();
  await sync.leave();
  assert.equal(sync.isCloud(), false);
  await S.importParticipants(items(5, 70000), 'skip', 'lain.xlsx'); // data lain dalam pelayar
  await assert.rejects(sync.join('RTD-TEST01', 'salah123'), /salah/);
  await sync.join('rtd-test01', 'Rahsia123');
  const after = await S.stats();
  assert.equal(after.total, before.total, 'jumlah peserta sama seperti awan');
  assert.equal(after.winners, before.winners, 'pemenang sama');
  assert.ok(!(await S.listParticipants()).some((p) => p.staffId === '70000'), 'data setempat lama dibuang');
  const a = await S.getKV('attendance');
  assert.equal(a.eventId, 'ev-1');
  assert.equal(a.token, srv.event.token, 'token QR diambil dari awan → QR boleh dipapar di pelayar ini');
});

test('nombor itik berganda dinomborkan semula oleh Peranti Kawalan', async () => {
  await S.addParticipant({ staffId: 'X1', name: 'Satu', department: '' });
  const p = (await S.listParticipants()).find((x) => x.staffId === 'X1');
  await db.put('participants', { ...p, staffId: 'X2', name: 'Dua', createdAt: new Date(Date.now() + 1000).toISOString() });
  const moved = await S.fixDuckNumbers();
  assert.equal(moved, 1);
  const all = await S.listParticipants();
  assert.equal(new Set(all.map((x) => x.duckNo)).size, all.length);
});

test.after(() => sync.stop());
