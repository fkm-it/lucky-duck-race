import { html, mount, toast, errMsg, download, fmtTime, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as att from '../attendance.js';
import { exportXlsx, exportCsv, printReport, WINNER_COLUMNS, PARTICIPANT_COLUMNS } from '../io.js';

const ATT_COLUMNS = [
  ['No. Pekerja', (r) => r.staff_id], ['Nama Staf', (r) => r.name], ['Jabatan', (r) => r.department],
  ['Status', (r) => (r.checked_in_at ? 'Hadir' : 'Belum hadir')],
  ['Tarikh Hadir', (r) => (r.checked_in_at ? fmtDate(r.checked_in_at) : '')],
  ['Masa Hadir', (r) => (r.checked_in_at ? fmtTime(r.checked_in_at) : '')],
  ['Kaedah', (r) => (r.checked_in_via === 'manual' ? 'Manual (kaunter)' : r.checked_in_via === 'qr' ? 'Kod QR' : '')],
];

export async function render(el) {
  const [s, cfg] = await Promise.all([store.stats(), att.getConfig()]);
  const card = (key, ic, title, desc, meta, buttons) => html`
    <article class="rep-card">
      <div class="rep-ic">${icon(ic)}</div>
      <div class="rep-body"><h3>${title}</h3><p class="muted">${desc}</p><span class="tag">${meta}</span></div>
      <div class="rep-act">${buttons.map(([f, l]) => html`<button class="btn ${f === 'pdf' ? 'btn-purple' : 'btn-ghost'} btn-sm" data-k="${key}" data-f="${f}">${l}</button>`)}</div>
    </article>`;
  mount(el, html`
    <div class="rep-grid">
      ${card('win', 'medal', 'Laporan Pemenang', 'ID cabutan, no. pemenang, nama, No. Pekerja, jabatan, kategori dan hadiah, tarikh serta masa.', s.winners + ' pemenang aktif',
        [['xlsx', 'Excel'], ['csv', 'CSV'], ['pdf', 'PDF']])}
      ${card('part', 'users', 'Senarai Peserta Cabutan', 'Semua peserta beserta nombor itik dan status (layak / pemenang).', s.total + ' peserta',
        [['xlsx', 'Excel'], ['csv', 'CSV'], ['pdf', 'PDF']])}
      ${cfg ? card('att', 'calcheck', 'Laporan Kehadiran', 'Senarai staf majlis beserta status, masa dan kaedah pengesahan kehadiran (daripada pelayan).', cfg.eventName,
        [['xlsx', 'Excel'], ['csv', 'CSV'], ['pdf', 'PDF']]) : ''}
      ${card('audit', 'shield', 'Log Audit', 'Rekod setiap tindakan: import, cabutan, pemulihan, set semula dan log masuk.', 'Tidak boleh disunting',
        [['view', 'Lihat'], ['csv', 'CSV']])}
      ${card('backup', 'database', 'Sandaran Data', 'Keseluruhan pangkalan data komputer ini (JSON) — simpan selepas setiap majlis.', 'Termasuk kunci majlis kehadiran',
        [['json', 'Muat turun']])}
    </div>`);

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const { k, f } = b.dataset;
    b.disabled = true;
    try {
      const st = await store.getSettings();
      const sub = (st.eventName ? st.eventName + ' · ' : '') + 'Dijana ' + new Date().toLocaleString('ms-MY');
      if (k === 'win') {
        const rows = await store.listWinners();
        if (f === 'xlsx') await exportXlsx('pemenang', WINNER_COLUMNS, rows, 'Pemenang');
        else if (f === 'csv') exportCsv('pemenang', WINNER_COLUMNS, rows);
        else printReport({ title: 'ROCK THE DRAW — Laporan Pemenang', subtitle: sub, columns: WINNER_COLUMNS.filter((c) => c[0] !== 'No. Itik'), rows, footer: rows.length + ' rekod' });
      } else if (k === 'part') {
        const rows = await store.listParticipants();
        if (f === 'xlsx') await exportXlsx('peserta', PARTICIPANT_COLUMNS, rows, 'Peserta');
        else if (f === 'csv') exportCsv('peserta', PARTICIPANT_COLUMNS, rows);
        else printReport({ title: 'ROCK THE DRAW — Senarai Peserta Cabutan', subtitle: sub, columns: PARTICIPANT_COLUMNS, rows, footer: rows.length + ' peserta' });
      } else if (k === 'att') {
        const rows = (await att.listStaff()).sort((a, c) => a.staff_id.localeCompare(c.staff_id));
        if (f === 'xlsx') await exportXlsx('kehadiran', ATT_COLUMNS, rows, 'Kehadiran');
        else if (f === 'csv') exportCsv('kehadiran', ATT_COLUMNS, rows);
        else {
          const n = rows.filter((r) => r.checked_in_at).length;
          printReport({ title: 'ROCK THE DRAW — Laporan Kehadiran', subtitle: sub, columns: ATT_COLUMNS, rows, footer: 'Hadir ' + n + ' / ' + rows.length + ' staf' });
        }
      } else if (k === 'audit') {
        if (f === 'view') { location.hash = '#/audit'; return; }
        const rows = await store.listAudit(5000);
        exportCsv('log-audit', [['Masa', (r) => r.at], ['Tindakan', (r) => r.action], ['Butiran', (r) => r.detail]], rows);
      } else if (k === 'backup') {
        const data = await store.exportBackup();
        download('lucky-duck-sandaran-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 1), 'application/json');
      }
      store.audit('EKSPORT', k + ':' + f);
    } catch (err) { toast(errMsg(err), 'error', 6000); } finally { b.disabled = false; }
  });
}
