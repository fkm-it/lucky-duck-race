import { html, mount, fmtDateTime } from '../util.js';
import * as store from '../store.js';
import { exportCsv } from '../io.js';

export async function render(el) {
  const rows = await store.listAudit(2000);
  mount(el, html`
    <div class="toolbar"><span class="muted">${rows.length} entri terkini · log tidak boleh disunting dari UI</span><div class="spacer"></div>
      <button class="btn btn-ghost" id="a-exp">⇩ CSV</button></div>
    <div class="card card-flush"><div class="table-wrap"><table class="tbl tbl-sm">
      <thead><tr><th>Masa</th><th>Tindakan</th><th>Butiran</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td class="nowrap">${fmtDateTime(r.at)}</td><td><span class="tag">${r.action}</span></td><td class="tiny wrap mono">${r.detail}</td></tr>`)}</tbody>
    </table></div></div>`);
  el.querySelector('#a-exp').addEventListener('click', () =>
    exportCsv('log-audit', [['Masa', (r) => r.at], ['Tindakan', (r) => r.action], ['Butiran', (r) => r.detail]], rows));
}
