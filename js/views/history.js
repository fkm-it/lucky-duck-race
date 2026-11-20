import { html, mount, toast, errMsg, modal, fmtNum, fmtDate, fmtTime, debounce, $ } from '../util.js';
import * as store from '../store.js';
import { exportXlsx, exportCsv, printReport, WINNER_COLUMNS } from '../io.js';
import { openStage } from '../race.js';

export async function render(el, ctx) {
  let winners = await store.listWinners();
  let draws = await store.listDraws();
  const st = { q: '', drawId: '', prize: '', showRevoked: true, tab: 'winners' };

  mount(el, html`
    <div class="tabs" role="tablist">
      <button class="tab on" data-tab="winners" role="tab">Pemenang</button>
      <button class="tab" data-tab="draws" role="tab">Rekod cabutan</button>
    </div>
    <div class="toolbar">
      <input type="search" id="h-q" placeholder="Cari nama / Staff ID…" aria-label="Cari">
      <select id="h-prize" aria-label="Hadiah"></select>
      <select id="h-draw" aria-label="Cabutan"></select>
      <label class="check"><input type="checkbox" id="h-rev" checked> Papar yang dipulihkan</label>
      <div class="spacer"></div>
      <button class="btn btn-ghost" data-exp="xlsx">⇩ Excel</button>
      <button class="btn btn-ghost" data-exp="csv">⇩ CSV</button>
      <button class="btn btn-primary" data-exp="pdf">🖨 Laporan PDF</button>
    </div>
    <div id="h-body"></div>`);

  const fillFilters = () => {
    const prizes = [...new Set(winners.map((w) => w.prizeName))];
    mount($('#h-prize'), html`<option value="">Semua hadiah</option>${prizes.map((p) => html`<option ${p === st.prize ? 'selected' : ''}>${p}</option>`)}`);
    mount($('#h-draw'), html`<option value="">Semua cabutan</option>${draws.map((d) => html`<option value="${d.id}" ${d.id === st.drawId ? 'selected' : ''}>${d.id} · ${d.prizeName}</option>`)}`);
  };

  const filtered = () => {
    const q = st.q.toLowerCase();
    return winners.filter((w) => (st.showRevoked || !w.revoked) && (!st.drawId || w.drawId === st.drawId) && (!st.prize || w.prizeName === st.prize) &&
      (!q || w.name.toLowerCase().includes(q) || w.staffId.toLowerCase().includes(q)));
  };

  const drawBody = () => {
    if (st.tab === 'draws') {
      mount($('#h-body'), html`<div class="card card-flush"><div class="table-wrap"><table class="tbl">
        <thead><tr><th>Draw ID</th><th>Tarikh & masa</th><th>Hadiah</th><th>Pemenang</th><th>Layak</th><th>Mod</th><th>Status</th><th>Kod integriti (SHA-256)</th><th></th></tr></thead>
        <tbody>${draws.length ? [...draws].reverse().map((d) => html`<tr>
          <td class="mono">${d.id}</td><td>${fmtDate(d.createdAt)}<br><small class="muted">${fmtTime(d.createdAt)}</small></td>
          <td><b>${d.prizeCategory}</b><br><small>${d.prizeName}</small></td><td>${d.count}</td><td>${fmtNum(d.poolSize)}</td>
          <td>${d.revealMode === 'finale' ? 'Grand Finale' : 'Satu demi satu'}</td>
          <td>${d.status === 'REVEALED' ? html`<span class="tag tag-ok">Didedahkan</span>` : html`<span class="tag tag-warn">Disimpan</span>`}</td>
          <td class="mono tiny wrap">${d.integrity}</td>
          <td><button class="btn btn-ghost btn-sm" data-replay="${d.id}">▶ Main semula</button></td></tr>`) : html`<tr><td colspan="9" class="empty-cell">Belum ada cabutan.</td></tr>`}</tbody></table></div></div>
        <p class="tiny muted">Kod integriti = SHA-256(Draw ID | garam | senarai Staff ID layak | senarai Staff ID pemenang). Ia membuktikan senarai pemenang tidak diubah selepas cabutan.</p>`);
      return;
    }
    const rows = filtered();
    mount($('#h-body'), html`<div class="card card-flush"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>No.</th><th>Nama</th><th>Staff ID</th><th>Jabatan</th><th>Hadiah</th><th>Itik</th><th>Tarikh / masa</th><th>Draw ID</th><th></th></tr></thead>
      <tbody>${rows.length ? rows.map((w) => html`<tr class="${w.revoked ? 'row-dim' : ''}">
        <td class="mono"><b>#${w.winnerNo}</b></td><td><b>${w.name}</b></td><td class="mono">${w.staffId}</td><td>${w.department || '—'}</td>
        <td><span class="tag tag-gold">${w.prizeCategory} #${w.prizeNumber}</span><br><small>${w.prizeName}</small></td>
        <td class="mono">#${w.duckNo}</td><td>${fmtDate(w.drawAt)}<br><small class="muted">${fmtTime(w.drawAt)}</small></td><td class="mono tiny">${w.drawId}</td>
        <td>${w.revoked ? html`<span class="tag">Dipulihkan</span>` : html`<button class="btn btn-ghost btn-sm" data-restore="${w.id}" title="Kembalikan kelayakan">↺ Pulihkan</button>`}</td></tr>`)
        : html`<tr><td colspan="9" class="empty-cell">Tiada rekod pemenang.</td></tr>`}</tbody></table></div></div>
      <p class="muted tiny">${fmtNum(rows.length)} rekod</p>`);
  };

  const reload = async () => { winners = await store.listWinners(); draws = await store.listDraws(); fillFilters(); drawBody(); ctx.refreshStats(); };

  el.addEventListener('input', debounce((e) => { if (e.target.id === 'h-q') { st.q = e.target.value.trim(); drawBody(); } }, 150));
  el.addEventListener('change', (e) => {
    if (e.target.id === 'h-prize') st.prize = e.target.value;
    if (e.target.id === 'h-draw') st.drawId = e.target.value;
    if (e.target.id === 'h-rev') st.showRevoked = e.target.checked;
    drawBody();
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      st.tab = b.dataset.tab;
      el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t === b));
      return drawBody();
    }
    if (b.dataset.exp) {
      const rows = filtered();
      try {
        if (b.dataset.exp === 'xlsx') await exportXlsx('pemenang', WINNER_COLUMNS, rows, 'Winners');
        else if (b.dataset.exp === 'csv') exportCsv('pemenang', WINNER_COLUMNS, rows);
        else {
          const s = await store.getSettings();
          printReport({
            title: 'LUCKY DUCK RACE — Laporan Pemenang', subtitle: (s.eventName ? s.eventName + ' · ' : '') + 'Dijana ' + new Date().toLocaleString('ms-MY'),
            columns: WINNER_COLUMNS.filter((c) => !['Duck Number'].includes(c[0])), rows,
            footer: rows.length + ' rekod · ' + draws.length + ' cabutan · Pemilihan rawak kriptografi (Web Crypto API).',
          });
        }
        store.audit('EKSPORT_PEMENANG', b.dataset.exp + ' (' + rows.length + ')');
      } catch (err) { toast(errMsg(err), 'error'); }
      return;
    }
    if (b.dataset.restore) {
      const w = winners.find((x) => String(x.id) === b.dataset.restore);
      const reason = await modal({
        title: 'Pulihkan kelayakan pemenang?',
        body: html`<p><b>${w.name}</b> (${w.staffId}) — ${w.prizeName} #${w.prizeNumber}</p>
          <p class="muted">Peserta akan kembali LAYAK untuk cabutan seterusnya dan slot hadiah ini dibuka semula. Rekod asal dikekalkan dalam sejarah dengan tanda "Dipulihkan".</p>
          <label class="field"><span>Sebab (wajib)</span><input id="rs" maxlength="200" placeholder="cth. Pemenang tiada di dewan"></label>`,
        buttons: [{ label: 'Batal', value: null }, {
          label: 'Pulihkan', kind: 'danger', value: true,
          validate: (wrap) => { const v = wrap.querySelector('#rs').value.trim(); if (!v) { toast('Nyatakan sebab.', 'error'); return false; } return { reason: v }; },
        }],
      });
      if (!reason) return;
      try { await store.restoreWinner(w.id, reason.reason); toast('Kelayakan dipulihkan.', 'success'); reload(); } catch (err) { toast(errMsg(err), 'error'); }
      return;
    }
    if (b.dataset.replay) {
      try {
        const data = await store.drawReplayData(b.dataset.replay);
        await openStage({ replay: data });
        reload();
      } catch (err) { toast(errMsg(err), 'error'); }
    }
  });

  fillFilters();
  drawBody();
}
