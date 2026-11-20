import { html, mount, toast, errMsg, confirmDialog, fmtNum, $ } from '../util.js';
import * as store from '../store.js';
import { readSpreadsheet, downloadTemplate } from '../io.js';
import { guessMapping, validateRows } from '../logic.js';

const STATUS_LABEL = { ok: ['Sah', 'tag-ok'], error: ['Ralat', 'tag-err'], dupFile: ['Pendua dalam fail', 'tag-warn'], exists: ['Sudah wujud', 'tag-info'] };

export async function render(el, ctx) {
  const st = { file: null, sheets: [], sheet: 0, header: true, map: null, result: null, filter: '' };

  mount(el, html`
    <div class="steps">
      <span class="step on">1 Muat naik</span><span class="step" id="s2">2 Padankan lajur</span><span class="step" id="s3">3 Semak & sahkan</span>
    </div>
    <section class="card">
      <label class="drop" id="drop" tabindex="0">
        <input type="file" id="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden>
        <div class="drop-ic">⇪</div>
        <b>Seret fail ke sini atau klik untuk memilih</b>
        <span class="muted">Excel (.xlsx), Excel 97-2003 (.xls) atau CSV · Lajur: Staff Name, Staff ID, Department</span>
        <span class="muted tiny" id="fname"></span>
      </label>
      <div class="row-actions"><button class="btn btn-ghost btn-sm" id="tpl">⇩ Muat turun templat Excel</button>
      <span class="tiny muted">Tip: format lajur Staff ID sebagai <b>Text</b> dalam Excel supaya sifar di hadapan (cth 000123) kekal.</span></div>
    </section>
    <section id="mapper"></section>
    <section id="preview"></section>`);

  const drop = $('#drop');
  const pick = async (file) => {
    if (!file) return;
    try {
      $('#fname').textContent = 'Membaca ' + file.name + '…';
      const { sheets } = await readSpreadsheet(file);
      Object.assign(st, { file, sheets, sheet: 0, header: true });
      $('#fname').textContent = file.name + ' · ' + sheets.length + ' helaian';
      setupMap();
    } catch (e) { toast(errMsg(e), 'error', 6000); $('#fname').textContent = ''; }
  };
  $('#file').addEventListener('change', (e) => pick(e.target.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } });
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));
  $('#tpl').addEventListener('click', () => downloadTemplate().catch((e) => toast(errMsg(e), 'error')));

  const headers = () => {
    const rows = st.sheets[st.sheet].rows;
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    return Array.from({ length: width }, (_, i) => (st.header ? String(rows[0][i] || '') : '') || 'Lajur ' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ''));
  };

  function setupMap() {
    const hs = headers();
    st.map = guessMapping(st.header ? hs : []);
    if (!st.header) st.map = { name: 0, staffId: 1, department: 2 };
    drawMap();
    validate();
  }

  function drawMap() {
    const hs = headers();
    const sel = (key, label, req) => html`<label class="field"><span>${label}${req ? ' *' : ''}</span>
      <select data-map="${key}"><option value="-1">— Tiada —</option>${hs.map((h, i) => html`<option value="${i}" ${st.map[key] === i ? 'selected' : ''}>${h}</option>`)}</select></label>`;
    mount($('#mapper'), html`<div class="card">
      <div class="card-head"><h3>Padankan lajur</h3></div>
      <div class="form-grid">
        ${st.sheets.length > 1 ? html`<label class="field"><span>Helaian</span><select id="sheet">${st.sheets.map((s, i) => html`<option value="${i}" ${i === st.sheet ? 'selected' : ''}>${s.name} (${s.rows.length})</option>`)}</select></label>` : ''}
        ${sel('name', 'Staff Name', true)}${sel('staffId', 'Staff ID', true)}${sel('department', 'Department', false)}
        <label class="check"><input type="checkbox" id="hdr" ${st.header ? 'checked' : ''}> Baris pertama ialah tajuk</label>
      </div></div>`);
    $('#s2').classList.add('on');
  }

  async function validate() {
    const rows = st.sheets[st.sheet].rows.slice(st.header ? 1 : 0);
    if (st.map.name < 0 || st.map.staffId < 0) {
      mount($('#preview'), html`<div class="card"><p class="muted">Pilih lajur <b>Staff Name</b> dan <b>Staff ID</b> untuk meneruskan.</p></div>`);
      return;
    }
    st.result = validateRows(rows, st.map, await store.existingIds());
    drawPreview();
  }

  function drawPreview() {
    const { items, summary } = st.result;
    const list = st.filter ? items.filter((x) => x.status === st.filter) : items;
    const importable = summary.ok + summary.exists;
    mount($('#preview'), html`<div class="card">
      <div class="card-head"><h3>Pratonton & validasi</h3><span class="muted">${fmtNum(summary.total)} baris</span></div>
      <div class="chips">
        <button class="chip ${!st.filter ? 'on' : ''}" data-flt="">Semua ${summary.total}</button>
        <button class="chip chip-ok ${st.filter === 'ok' ? 'on' : ''}" data-flt="ok">Sah ${summary.ok}</button>
        <button class="chip chip-err ${st.filter === 'error' ? 'on' : ''}" data-flt="error">Ralat ${summary.error}</button>
        <button class="chip chip-warn ${st.filter === 'dupFile' ? 'on' : ''}" data-flt="dupFile">Pendua ${summary.dupFile}</button>
        <button class="chip chip-info ${st.filter === 'exists' ? 'on' : ''}" data-flt="exists">Sudah wujud ${summary.exists}</button>
      </div>
      <div class="table-wrap tall"><table class="tbl tbl-sm">
        <thead><tr><th>Baris</th><th>Nama</th><th>Staff ID</th><th>Jabatan</th><th>Status</th><th>Catatan</th></tr></thead>
        <tbody>${list.slice(0, 500).map((x) => html`<tr class="${x.status === 'error' ? 'row-err' : x.status === 'dupFile' ? 'row-warn' : ''}">
          <td class="mono">${x.row}</td><td>${x.name}</td><td class="mono">${x.staffId}</td><td>${x.department}</td>
          <td><span class="tag ${STATUS_LABEL[x.status][1]}">${STATUS_LABEL[x.status][0]}</span></td><td class="tiny">${x.message}</td></tr>`)}</tbody>
      </table></div>
      ${list.length > 500 ? html`<p class="tiny muted">Memaparkan 500 pertama daripada ${fmtNum(list.length)}.</p>` : ''}
      <div class="import-foot">
        ${summary.exists ? html`<label class="field inline"><span>Staff ID sedia ada:</span><select id="mode"><option value="skip">Langkau (kekalkan data semasa)</option><option value="update">Kemas kini nama & jabatan</option></select></label>` : ''}
        <div class="spacer"></div>
        <span class="muted">${summary.error + summary.dupFile ? fmtNum(summary.error + summary.dupFile) + ' baris tidak sah akan diabaikan' : 'Semua baris sah'}</span>
        <button class="btn btn-primary" id="do-import" ${importable ? '' : 'disabled'}>Sahkan import (${fmtNum(summary.ok)} baharu)</button>
      </div></div>`);
    $('#s3').classList.add('on');
  }

  el.addEventListener('change', (e) => {
    if (e.target.dataset.map) { st.map[e.target.dataset.map] = +e.target.value; validate(); }
    if (e.target.id === 'sheet') { st.sheet = +e.target.value; setupMap(); }
    if (e.target.id === 'hdr') { st.header = e.target.checked; setupMap(); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.flt !== undefined) { st.filter = b.dataset.flt; drawPreview(); }
    if (b.id === 'do-import') {
      const mode = $('#mode') ? $('#mode').value : 'skip';
      const items = st.result.items.filter((x) => x.status === 'ok' || x.status === 'exists');
      const nNew = st.result.summary.ok;
      const ok = await confirmDialog('Sahkan import', 'Import ' + nNew + ' peserta baharu' + (mode === 'update' ? ' dan kemas kini ' + st.result.summary.exists + ' sedia ada' : '') + ' ke pangkalan data?', { okLabel: 'Import' });
      if (!ok) return;
      b.disabled = true;
      try {
        const r = await store.importParticipants(items, mode, st.file.name);
        toast('Import selesai: ' + r.added + ' ditambah, ' + r.updated + ' dikemas kini, ' + r.skipped + ' dilangkau.', 'success', 5000);
        ctx.go('participants');
      } catch (err) { toast(errMsg(err), 'error', 6000); b.disabled = false; }
    }
  });
}
