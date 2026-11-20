import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';

const seed = async (n) => {
  const items = Array.from({ length: n }, (_, i) => ({ name: 'Staf ' + i, staffId: String(i).padStart(5, '0'), department: i % 2 ? 'IT' : 'HR' }));
  return S.importParticipants(items, 'skip', 'ujian.xlsx');
};

test('aliran penuh: import → hadiah → cabutan → buang → pulih → reset', async () => {
  const r = await seed(500);
  assert.equal(r.added, 500);
  const again = await seed(500);
  assert.equal(again.skipped, 500, 'pendua dilangkau');

  const all = await S.listParticipants();
  assert.equal(all[0].staffId, '00000', 'sifar di hadapan kekal');
  assert.equal(new Set(all.map((p) => p.duckNo)).size, 500, 'nombor itik unik');

  const grand = await S.savePrize({ category: 'Grand Prize', name: 'Kereta', quantity: 1, sequence: 1 });
  const cons = await S.savePrize({ category: 'Consolation Prize', name: 'Baucar', quantity: 10, sequence: 5 });

  const d1 = await S.executeDraw({ prizeId: cons.id, count: 10 });
  assert.equal(d1.winners.length, 10);
  assert.equal(d1.pool.length, 500);
  assert.match(d1.draw.integrity, /^[0-9a-f]{64}$/);
  let st = await S.stats();
  assert.equal(st.eligible, 490);
  assert.equal(st.winners, 10);

  await assert.rejects(S.executeDraw({ prizeId: cons.id, count: 1 }), /Baki/);

  const d2 = await S.executeDraw({ prizeId: grand.id, count: 1 });
  assert.equal(d2.pool.length, 490);
  const firstIds = new Set(d1.winners.map((w) => w.staffId));
  assert.ok(!firstIds.has(d2.winners[0].staffId), 'pemenang tidak menang dua kali');

  const d3 = await S.executeDraw({ count: 5 });
  st = await S.stats();
  assert.equal(st.eligible, 484);
  const ws = await S.listWinners();
  assert.equal(ws.length, 16);
  assert.deepEqual(ws.map((w) => w.winnerNo), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(new Set(ws.map((w) => w.staffId)).size, 16);
  assert.equal(d3.draw.prizeName, 'Cabutan Khas');

  await S.restoreWinner(ws[0].id, 'tiada di dewan');
  st = await S.stats();
  assert.equal(st.eligible, 485);
  assert.equal(st.winners, 15);
  await assert.rejects(S.restoreWinner(ws[0].id), /sudah dipulihkan/);

  // Selepas pulih, slot hadiah terbuka semula
  const ps = await S.getPrizeStatus();
  const consSt = ps.find((x) => x.prize.id === cons.id);
  assert.equal(consSt.remaining, ws[0].prizeId === cons.id ? 1 : 0);

  await assert.rejects(S.deletePrize(grand.id), /sudah mempunyai pemenang/);

  const replay = await S.drawReplayData(d1.draw.id);
  assert.equal(replay.pool.length, 500);
  assert.deepEqual(replay.winners.map((w) => w.staffId), d1.winners.map((w) => w.staffId));

  await S.resetAllDraws();
  st = await S.stats();
  assert.equal(st.eligible, 500);
  assert.equal(st.winners, 0);
  assert.equal(st.completedDraws, 0);
});

test('cabutan melebihi peserta layak ditolak', async () => {
  await assert.rejects(S.executeDraw({ count: 100000 }), /melebihi/);
  await assert.rejects(S.executeDraw({ count: 0 }), /sekurang-kurangnya/);
});

test('benarkan menang berulang (tetapan admin)', async () => {
  await S.saveSettings({ allowMultipleWins: true });
  const before = (await S.listParticipants()).length;
  const d = await S.executeDraw({ count: 3 });
  assert.equal(d.pool.length, before);
  const d2 = await S.executeDraw({ count: 3 });
  assert.equal(d2.pool.length, before, 'pemenang kekal dalam kumpulan');
  await S.saveSettings({ allowMultipleWins: false });
  await S.resetAllDraws();
});

test('tambah / sunting / Staff ID unik', async () => {
  await S.addParticipant({ name: 'Za', staffId: '007', department: 'FKM' });
  await assert.rejects(S.addParticipant({ name: 'X', staffId: '007' }), /sudah wujud/);
  await S.updateParticipant('007', { name: 'Zaki', staffId: '0070', department: 'FKM' });
  const all = await S.listParticipants();
  assert.ok(all.find((p) => p.staffId === '0070' && p.name === 'Zaki'));
  assert.ok(!all.find((p) => p.staffId === '007'));
  await assert.rejects(S.updateParticipant('0070', { name: 'Zaki', staffId: '00001' }), /sudah digunakan/);
});

test('sandaran eksport/import', async () => {
  const b = await S.exportBackup();
  const n = b.data.participants.length;
  await S.deleteAllParticipants();
  assert.equal((await S.listParticipants()).length, 0);
  await S.importBackup(JSON.parse(JSON.stringify(b)));
  assert.equal((await S.listParticipants()).length, n);
  await assert.rejects(S.importBackup({ app: 'lain' }), /tidak sah/);
});
