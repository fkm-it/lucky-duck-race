import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, pickUnique } from '../js/rng.js';
import {
  validateRows, guessMapping, normalizeStaffId, validateStaffId, planRace, progressAt,
  prizeStatus, totalWinnersRequired, toCsv, safeCell,
} from '../js/logic.js';

test('randomInt: julat & seragam (chi-square)', () => {
  const n = 7; const N = 70000; const c = new Array(n).fill(0);
  for (let i = 0; i < N; i++) { const v = randomInt(n); assert.ok(v >= 0 && v < n); c[v]++; }
  const e = N / n;
  const chi = c.reduce((s, x) => s + (x - e) ** 2 / e, 0);
  assert.ok(chi < 22.46, 'chi2=' + chi); // df=6, p=0.001
});

test('pickUnique: unik, saiz betul, had', () => {
  for (let t = 0; t < 200; t++) {
    const r = pickUnique(50, 10);
    assert.equal(r.length, 10);
    assert.equal(new Set(r).size, 10);
    r.forEach((x) => assert.ok(x >= 0 && x < 50));
  }
  assert.deepEqual(pickUnique(3, 3).sort(), [0, 1, 2]);
  assert.throws(() => pickUnique(3, 4));
  assert.throws(() => pickUnique(3, -1));
});

test('pickUnique: setiap peserta berkebarangkalian sama', () => {
  const n = 20; const k = 3; const N = 40000; const c = new Array(n).fill(0);
  for (let i = 0; i < N; i++) pickUnique(n, k).forEach((x) => c[x]++);
  const e = (N * k) / n;
  const chi = c.reduce((s, x) => s + (x - e) ** 2 / e, 0);
  assert.ok(chi < 43.82, 'chi2=' + chi); // df=19, p=0.001
});

test('Staff ID: sifar di hadapan kekal, saintifik ditolak', () => {
  assert.equal(normalizeStaffId('  000123 '), '000123');
  assert.equal(normalizeStaffId('ab-01'), 'AB-01');
  assert.equal(validateStaffId('000123'), '');
  assert.match(validateStaffId('1.23E+05'), /saintifik/);
  assert.match(validateStaffId(''), /kosong/);
  assert.match(validateStaffId('A<script>'), /tidak sah/);
});

test('guessMapping: tajuk standard & BM', () => {
  assert.deepEqual(guessMapping(['Staff Name', 'Staff ID', 'Department']), { name: 0, staffId: 1, department: 2 });
  assert.deepEqual(guessMapping(['No. Staf', 'Nama', 'Jabatan']), { name: 1, staffId: 0, department: 2 });
});

test('validateRows: kosong, pendua, wujud, ralat', () => {
  const rows = [
    ['Ali', '0001', 'IT'],
    ['Abu', '0002', ''],
    ['', '0003', 'HR'],
    ['Siti', '0001', 'IT'],
    ['Ah Kow', '0009', 'FIN'],
    ['', '', ''],
  ];
  const { items, summary } = validateRows(rows, { name: 0, staffId: 1, department: 2 }, new Set(['0009']));
  assert.equal(summary.total, 5);
  assert.equal(summary.ok, 2);
  assert.equal(summary.error, 1);
  assert.equal(summary.dupFile, 1);
  assert.equal(summary.exists, 1);
  assert.equal(items[0].staffId, '0001');
  assert.equal(items[3].status, 'dupFile');
});

test('planRace: pemenang tiba mengikut susunan, bukan-pemenang tidak sebelum pemenang terakhir', () => {
  for (let trial = 0; trial < 30; trial++) {
    const n = 300; const winners = pickUnique(n, 10);
    const plan = planRace(n, winners, { duration: 12 });
    const cross = new Array(n).fill(Infinity);
    for (let t = 0; t <= plan.endTime; t += 0.01) {
      for (let d = 0; d < n; d++) if (cross[d] === Infinity && progressAt(plan, d, t) >= 1) cross[d] = t;
    }
    for (let i = 1; i < winners.length; i++) assert.ok(cross[winners[i - 1]] <= cross[winners[i]]);
    const lastWin = Math.max(...winners.map((w) => cross[w]));
    const ws = new Set(winners);
    for (let d = 0; d < n; d++) if (!ws.has(d)) assert.ok(cross[d] > lastWin, 'bukan pemenang ' + d + ' melintasi awal');
  }
});

test('planRace: kemajuan monotonik', () => {
  const plan = planRace(50, [3, 7], { duration: 10 });
  for (let d = 0; d < 50; d++) {
    let prev = -1;
    for (let t = 0; t < plan.endTime; t += 0.05) { const p = progressAt(plan, d, t); assert.ok(p >= prev - 1e-9); prev = p; }
  }
});

test('prizeStatus & jumlah pemenang', () => {
  const prizes = [{ id: 'B', sequence: 2, quantity: 3 }, { id: 'A', sequence: 1, quantity: 1 }];
  const winners = [{ prizeId: 'B' }, { prizeId: 'B', revoked: true }, { prizeId: 'A' }];
  const s = prizeStatus(prizes, winners);
  assert.equal(s[0].prize.id, 'A');
  assert.equal(s[0].remaining, 0);
  assert.equal(s[1].awarded, 1);
  assert.equal(s[1].remaining, 2);
  assert.equal(totalWinnersRequired(prizes), 4);
});

test('CSV: formula injection dineutralkan, BOM, petikan', () => {
  assert.equal(safeCell('=1+1'), "'=1+1");
  const csv = toCsv([['a', 'b,c'], ['@x', '"q"']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('"b,c"'));
  assert.ok(csv.includes("'@x"));
  assert.ok(csv.includes('"""q"""'));
});
