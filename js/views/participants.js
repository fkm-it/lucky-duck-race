import { html, mount, toast, errMsg, modal, confirmDialog, debounce, fmtNum, $ } from '../util.js';
import * as store from '../store.js';
import { exportXlsx, exportCsv, PARTICIPANT_COLUMNS } from '../io.js';

const PAGE = 50;

export async function render(el, ctx) {
  let all = await store.listParticipants();
  const state = { q: '', dept: '', status: '', page: 0, sel: new Set() };

  const depts = () => [...new Set(all.map((p) => p.department).filter(Boolean))].sort();

  mount(el, html`
    <div class="toolbar">
      <input type="search" id="p-q" placeholder="Cari nama atau Staff ID…" aria-label="Cari">
      <select id="p-dept" aria-label="Jabatan"></select>
      <select id="p-status" aria-label="Status">
        <option value="">Semua peserta</option><option value="ELIGIBLE">Layak sahaja</option><option value="WINNER">Pemenang sahaja</option>
      </select>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="p-add">＋ Tambah</button>
      <div class="dropdown">
        <button class="btn btn-ghost" id="p-exp">⇩ Eksport</button>
        <div class="menu" hidden id="p-exp-menu"><button data-f="xlsx">Excel (.xlsx)</button><button data-f="csv">CSV</button></div>
      </div>
    </div>
    <div class="bulkbar" id="p-bulk" hidden><span id="p-bulk-n"></span><button class="btn btn-danger btn-sm" id="p-bulk-del">Padam dipilih</button></div>
    <div class="card card-flush"><div class="table-wrap"><table class="tbl" id="p-tbl"></table></div></div>
    <div class="pager" id="p-pager"></div>`);

  const fillDept = () => {
    const cur = state.dept;
    mount($('#p-dept'), html`<option value="">Semua jabatan</option>${depts().map((d) => html`<option ${d === cur ? 'selected' : ''}>${d}</option>`)}`);
  };

  const filtered = () => {
    const q = state.q.toLowerCase();
    return all.filter((p) => (!state.dept || p.department === state.dept) && (!state.status || p.status === state.status) &&
      (!q || p.name.toLowerCase().includes(q) || p.staffId.toLowerCase().includes(q) || String(p.duckNo) === q));
  };

  const draw = () => {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * PAGE, state.page * PAGE + PAGE);
    mount($('#p-tbl'), html`
      <thead><tr><th class="w-chk"><input type="checkbox" id="p-all" aria-label="Pilih semua"></th><th>Itik</th><th>Nama</th><th>Staff ID</th><th>Jabatan</th><th>Status</th><th class="w-act"></th></tr></thead>
      <tbody>${slice.length ? slice.map((p) => html`<tr>
        <td><input type="checkbox" data-sel="${p.staffId}" ${state.sel.has(p.staffId) ? 'checked' : ''} aria-label="Pilih"></td>
        <td class="mono">#${p.duckNo}</td><td><b>${p.name}</b></td><td class="mono">${p.staffId}</td><td>${p.department || html`<span class="muted">—</span>`}</td>
        <td>${p.status === 'WINNER' ? html`<span class="tag tag-gold">🏆 Pemenang${p.winCount > 1 ? ' ×' + p.winCount : ''}</span>` : html`<span class="tag tag-ok">Layak</span>`}</td>
        <td class="row-act"><button class="icon-btn" data-edit="${p.staffId}" title="Sunting">✎</button><button class="icon-btn danger" data-del="${p.staffId}" title="Padam">🗑</button></td>
      </tr>`) : html`<tr><td colspan="7" class="empty-cell">Tiada peserta. <a href="#/import">Import Excel</a> atau tambah secara manual.</td></tr>`}</tbody>`);
    mount($('#p-pager'), html`<span class="muted">${fmtNum(rows.length)} rekod${rows.length !== all.length ? ' (ditapis daripada ' + fmtNum(all.length) + ')' : ''}</span>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" data-pg="-1" ${state.page === 0 ? 'disabled' : ''}>‹ Sebelum</button>
      <span>Halaman ${state.page + 1} / ${pages}</span>
      <button class="btn btn-ghost btn-sm" data-pg="1" ${state.page >= pages - 1 ? 'disabled' : ''}>Seterus ›</button>`);
    $('#p-bulk').hidden = state.sel.size === 0;
    $('#p-bulk-n').textContent = state.sel.size + ' dipilih';
  };

  const reload = async () => { all = await store.listParticipants(); fillDept(); draw(); ctx.refreshStats(); };

  const form = (p = {}) => html`
    <label class="field"><span>Nama staf *</span><input id="f-name" value="${p.name || ''}" maxlength="120" required></label>
    <label class="field"><span>Staff ID * <small class="muted">(teks — sifar di hadapan dikekalkan)</small></span><input id="f-id" value="${p.staffId || ''}" maxlength="40" required class="mono"></label>
    <label class="field"><span>Jabatan</span><input id="f-dept" value="${p.department || ''}" maxlength="120" list="dept-list"><datalist id="dept-list">${depts().map((d) => html`<option value="${d}">`)}</datalist></label>`;

  const edit = async (p) => {
    await modal({
      title: p ? 'Sunting peserta' : 'Tambah peserta', body: form(p || {}),
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Simpan', kind: 'primary', value: true,
        validate: async (w) => {
          const v = { name: w.querySelector('#f-name').value, staffId: w.querySelector('#f-id').value, department: w.querySelector('#f-dept').value };
          try {
            if (p) await store.updateParticipant(p.staffId, v); else await store.addParticipant(v);
            toast('Disimpan.', 'success');
            return true;
          } catch (e) { toast(errMsg(e), 'error'); return false; }
        },
      }],
    });
    reload();
  };

  el.addEventListener('input', debounce((e) => { if (e.target.id === 'p-q') { state.q = e.target.value.trim(); state.page = 0; draw(); } }, 150));
  el.addEventListener('change', (e) => {
    if (e.target.id === 'p-dept') { state.dept = e.target.value; state.page = 0; draw(); }
    if (e.target.id === 'p-status') { state.status = e.target.value; state.page = 0; draw(); }
    if (e.target.dataset.sel) { e.target.checked ? state.sel.add(e.target.dataset.sel) : state.sel.delete(e.target.dataset.sel); draw(); }
    if (e.target.id === 'p-all') {
      const rows = filtered().slice(state.page * PAGE, state.page * PAGE + PAGE);
      rows.forEach((p) => (e.target.checked ? state.sel.add(p.staffId) : state.sel.delete(p.staffId)));
      draw();
    }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'p-add') return edit(null);
    if (t.dataset.edit) return edit(all.find((p) => p.staffId === t.dataset.edit));
    if (t.dataset.pg) { state.page += +t.dataset.pg; return draw(); }
    if (t.id === 'p-exp') { $('#p-exp-menu').hidden = !$('#p-exp-menu').hidden; return; }
    if (t.dataset.f) {
      $('#p-exp-menu').hidden = true;
      const rows = filtered();
      try {
        if (t.dataset.f === 'xlsx') await exportXlsx('peserta', PARTICIPANT_COLUMNS, rows, 'Participants');
        else exportCsv('peserta', PARTICIPANT_COLUMNS, rows);
        store.audit('EKSPORT_PESERTA', t.dataset.f + ' (' + rows.length + ')');
      } catch (err) { toast(errMsg(err), 'error'); }
      return;
    }
    const delIds = t.dataset.del ? [t.dataset.del] : (t.id === 'p-bulk-del' ? [...state.sel] : null);
    if (delIds) {
      const winners = all.filter((p) => delIds.includes(p.staffId) && p.status === 'WINNER').length;
      const ok = await confirmDialog('Padam peserta?', 'Padam ' + delIds.length + ' peserta secara kekal.' + (winners ? ' ' + winners + ' daripadanya pemenang — rekod sejarah pemenang tetap dikekalkan.' : ''), { danger: true, okLabel: 'Padam' });
      if (!ok) return;
      try { await store.deleteParticipants(delIds); delIds.forEach((id) => state.sel.delete(id)); toast('Dipadam.', 'success'); reload(); } catch (err) { toast(errMsg(err), 'error'); }
    }
  });

  fillDept();
  draw();
}
