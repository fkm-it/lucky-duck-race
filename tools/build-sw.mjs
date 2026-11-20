#!/usr/bin/env node
/**
 * build-sw.mjs — jana sw.js (senarai aset + versi cache berasaskan hash kandungan).
 *   node tools/build-sw.mjs          tulis sw.js
 *   node tools/build-sw.mjs --check  gagal jika sw.js tidak terkini (CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const INCLUDE = ['index.html', 'checkin.html', 'manifest.webmanifest', 'css', 'fonts', 'js', 'vendor', 'icons'];
const files = [];
const walk = (p) => {
  const abs = path.join(ROOT, p);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach((f) => walk(path.join(p, f)));
  else if (!/\.(txt|map|md)$/.test(p)) files.push(p.split(path.sep).join('/'));
};
INCLUDE.forEach(walk);
const h = crypto.createHash('sha256');
files.forEach((f) => { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); });
const version = h.digest('hex').slice(0, 12);
const tpl = fs.readFileSync(path.join(ROOT, 'tools/sw.template.js'), 'utf8');
const out = tpl.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(['./', ...files], null, 2));
const target = path.join(ROOT, 'sw.js');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (cur !== out) { console.error('✖ sw.js tidak terkini. Jalankan: npm run build:sw'); process.exit(1); }
  console.log('✔ sw.js terkini (' + version + ', ' + files.length + ' fail)');
} else {
  fs.writeFileSync(target, out);
  console.log('✔ sw.js ditulis (' + version + ', ' + files.length + ' fail)');
}
