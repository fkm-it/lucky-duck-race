#!/usr/bin/env node
/** check.mjs — semakan statik: sintaks semua modul JS + corak berbahaya (eval, document.write, innerHTML tanpa escape). */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
const walk = (d) => fs.readdirSync(d).forEach((f) => { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); });
walk(path.join(ROOT, 'js'));
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error('✖ Sintaks: ' + path.relative(ROOT, f) + '\n' + e.stderr); }
  const src = fs.readFileSync(f, 'utf8').split('\n');
  src.forEach((line, i) => {
    const where = path.relative(ROOT, f) + ':' + (i + 1);
    if (/\beval\(|new Function\(|document\.write\(/.test(line)) { bad++; console.error('✖ Corak berbahaya ' + where); }
    const m = line.match(/\.innerHTML\s*=\s*(.+)/);
    if (m && !/^(String\(html`|String\(content\)|''|out;|'<span class="cd-num|'<div class="pr-head|'<div class="loading)/.test(m[1].trim())) {
      bad++; console.error('✖ innerHTML tanpa html``: ' + where + '  → ' + m[1].trim().slice(0, 60));
    }
  });
}
if (bad) process.exit(1);
console.log('✔ ' + files.length + ' fail JS lulus semakan');
