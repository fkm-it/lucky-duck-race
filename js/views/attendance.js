import { html, raw, mount, toast, errMsg, confirmDialog, debounce, fmtNum, fmtTime, $ } from '../util.js';
import * as store from '../store.js';
import * as att from '../attendance.js';
import * as sync from '../sync.js';
import { icon } from '../icons.js';

const PAGE = 50;

export async function render(el, ctx) {
  const cfg = await att.getConfig();
  if (!cfg) return renderSetup(el, ctx);

  const st = { q: '', f: '', page: 0, rows: [], info: null, err: '' };
  mount(el, html`
    <div class="att-grid">
      <section class="card att-status">
        <div class="card-head"><h3>${cfg.eventName}</h3><span id="a-pill"></span></div>
        <div class="stat-grid stat-grid-4" id="a-stats"></div>
        <div class="row-actions">
          <label class="switch"><input type="checkbox" id="a-open"><span></span> <em id="a-open-l">Pendaftaran dibuka</em></label>
          <label class="switch"><input type="checkbox" id="a-auto" ${cfg.autoSync ? 'checked' : ''}><span></span> <em>Masukkan terus ke senarai peserta cabutan</em></label>
          <div class="spacer"></div>
          <button class="btn btn-ghost btn-sm" id="a-sync">⟳ Kemas kini sekarang</button>
        </div>
        <p class="tiny muted" id="a-sync-info"></p>
      </section>
      <section class="card att-qr">
        <div class="card-head"><h3>Kod QR pendaftaran</h3></div>
        <div class="qr-box" id="a-qr"></div>
        <div class="row-actions">
          <button class="btn btn-purple btn-sm" id="a-qr-full">${icon('expand')} Papar di meja pendaftaran</button>
          <button class="btn btn-ghost btn-sm" id="a-qr-print">${icon('print')} Cetak poster</button>
          <button class="btn btn-ghost btn-sm" id="a-copy">⧉ Salin pautan</button>
          <a class="btn btn-ghost btn-sm" id="a-open-link" target="_blank" rel="noopener">↗ Buka</a>
        </div>
        <button class="btn btn-ghost btn-sm link-danger" id="a-rotate">↻ Tukar kod QR (QR lama tidak sah)</button>
      </section>
    </div>

    <section class="card card-flush">
      <div class="toolbar pad">
        <input type="search" id="a-q" placeholder="Cari nama / No. pekerja…" aria-label="Cari">
        <select id="a-f" aria-label="Status"><option value="">Semua staf</option><option value="in">Hadir</option><option value="out">Belum hadir</option></select>
        <div class="spacer"></div>
        <a class="btn btn-purple btn-sm" href="#/staff?target=attendance">${icon('upload')} Muat naik senarai staf</a>
      </div>
      <div class="table-wrap"><table class="tbl" id="a-tbl"></table></div>
      <div class="pager pad" id="a-pager"></div>
    </section>

    <div class="danger-zone">
      <h4>Zon bahaya</h4>
      <button class="btn btn-danger btn-sm" id="a-wipe">🗑 Padam senarai staf dalam talian</button>
      ${sync.isCloud() ? '' : html`<button class="btn btn-danger btn-sm" id="a-disc">⏏ Putuskan sambungan majlis ini (mulakan majlis baharu)</button>`}
    </div>`);

  const url = att.checkinUrl(cfg);
  $('#a-open-link').href = url;
  att.qrSvg(url).then((svg) => mount($('#a-qr'), html`${raw(svg)}<div class="qr-url mono tiny">${url.replace(/#.*/, '#…')}</div>`)).catch((e) => toast(errMsg(e), 'error'));

  const drawStats = async () => {
    const local = await store.stats();
    const present = st.rows.filter((r) => r.checked_in_at).length;
    const total = st.rows.length;
    mount($('#a-stats'), html`
      <div class="stat"><span>Senarai staf</span><b>${fmtNum(total)}</b></div>
      <div class="stat stat-ok"><span>Hadir</span><b>${fmtNum(present)}</b></div>
      <div class="stat"><span>Belum hadir</span><b>${fmtNum(total - present)}</b></div>
      <div class="stat stat-gold"><span>Peserta cabutan</span><b>${fmtNum(local.total)}</b></div>`);
    const open = st.info ? st.info.is_open : true;
    $('#a-open').checked = open;
    $('#a-open-l').textContent = open ? 'Pendaftaran dibuka' : 'Pendaftaran ditutup';
    mount($('#a-pill'), st.err ? html`<span class="tag tag-err">● Luar talian</span>` : open ? html`<span class="tag tag-ok">● Dibuka</span>` : html`<span class="tag tag-warn">● Ditutup</span>`);
    const s = att.state;
    $('#a-sync-info').textContent = st.err ? 'Ralat: ' + st.err : (s.lastSync ? 'Kali terakhir dikemas kini ' + fmtTime(s.lastSync.toISOString()) + ' · dikemas kini secara automatik setiap 5 saat' : '');
  };

  const filtered = () => {
    const q = st.q.toLowerCase();
    return st.rows
      .filter((r) => (!st.f || (st.f === 'in' ? r.checked_in_at : !r.checked_in_at)) && (!q || r.name.toLowerCase().includes(q) || r.staff_id.toLowerCase().includes(q)))
      .sort((a, b) => (b.checked_in_at || '').localeCompare(a.checked_in_at || '') || a.name.localeCompare(b.name));
  };

  const drawTable = () => {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    const slice = rows.slice(st.page * PAGE, st.page * PAGE + PAGE);
    mount($('#a-tbl'), html`<thead><tr><th>No. Pekerja</th><th>Nama</th><th>Jabatan</th><th>Kehadiran</th><th></th></tr></thead>
      <tbody>${slice.length ? slice.map((r) => html`<tr>
        <td class="mono">${r.staff_id}</td><td><b>${r.name}</b></td><td>${r.department || '—'}</td>
        <td>${r.checked_in_at ? html`<span class="tag tag-ok">✔ Hadir ${fmtTime(r.checked_in_at)}</span> <small class="muted">${r.checked_in_via === 'manual' ? 'manual' : 'QR'}</small>` : html`<span class="tag">Belum</span>`}</td>
        <td class="row-act">${r.checked_in_at
          ? html`<button class="btn btn-ghost btn-sm" data-out="${r.staff_id}">Cancel</button>`
          : html`<button class="btn btn-go btn-sm" data-in="${r.staff_id}">✔ Sahkan</button>`}</td></tr>`)
        : html`<tr><td colspan="5" class="empty-cell">${st.rows.length ? 'Tiada padanan.' : html`Belum ada senarai staf. <a href="#/staff?target=attendance">Muat naik Excel</a>.`}</td></tr>`}</tbody>`);
    mount($('#a-pager'), html`<span class="muted">${fmtNum(rows.length)} staf</span><div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" data-pg="-1" ${st.page === 0 ? 'disabled' : ''}>‹</button><span>${st.page + 1} / ${pages}</span>
      <button class="btn btn-ghost btn-sm" data-pg="1" ${st.page >= pages - 1 ? 'disabled' : ''}>›</button>`);
  };

  const refresh = async () => {
    try {
      const [rows, info] = await Promise.all([att.listStaff(), att.eventInfo()]);
      st.rows = rows || []; st.info = info; st.err = '';
    } catch (e) { st.err = errMsg(e); }
    if (!el.isConnected) return;
    drawStats(); drawTable(); ctx.refreshStats();
  };

  await refresh();
  const timer = setInterval(() => { if (!el.isConnected) clearInterval(timer); else refresh(); }, 5000);
  const off = att.onSync((res) => {
    if (!el.isConnected) { off(); return; }
    res.added.forEach((p) => toast('✔ ' + p.name + ' hadir — itik #' + p.duckNo, 'success'));
  });

  el.addEventListener('input', debounce((e) => { if (e.target.id === 'a-q') { st.q = e.target.value.trim(); st.page = 0; drawTable(); } }, 150));
  el.addEventListener('change', async (e) => {
    if (e.target.id === 'a-f') { st.f = e.target.value; st.page = 0; drawTable(); }
    if (e.target.id === 'a-open') {
      try { await att.setOpen(e.target.checked); toast(e.target.checked ? 'Pendaftaran dibuka.' : 'Pendaftaran ditutup.', 'success'); } catch (err) { toast(errMsg(err), 'error'); }
      refresh();
    }
    if (e.target.id === 'a-auto') { await att.setAutoSync(e.target.checked); toast(e.target.checked ? 'Staf yang hadir akan dimasukkan terus sebagai peserta cabutan.' : 'Staf yang hadir TIDAK lagi dimasukkan secara automatik sebagai peserta.'); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pg) { st.page += +b.dataset.pg; return drawTable(); }
    try {
      if (b.dataset.in || b.dataset.out) {
        const id = b.dataset.in || b.dataset.out;
        const r = st.rows.find((x) => x.staff_id === id);
        if (b.dataset.out && !(await confirmDialog('Batal kehadiran?', r.name + ' (' + id + ') akan ditanda belum hadir dan dibuang daripada peserta cabutan (jika belum menang).', { danger: true, okLabel: 'Batal kehadiran' }))) return;
        b.disabled = true;
        await att.setCheckin(id, !!b.dataset.in);
        toast(b.dataset.in ? 'Kehadiran disahkan.' : 'Kehadiran dibatalkan.', 'success');
        return refresh();
      }
      if (b.id === 'a-sync' && sync.isCloud() && !sync.isControl()) { await sync.tick(); toast('Data disegerak dengan awan. Peserta baharu dimasukkan oleh Peranti Kawalan (' + sync.controlName() + ').', 'success'); b.disabled = false; return refresh(); }
      if (b.id === 'a-sync') { const r = await att.syncNow(); toast('Kemas kini selesai: ' + r.added.length + ' peserta ditambah, ' + r.removed + ' dibuang.', 'success'); return refresh(); }
      if (b.id === 'a-copy') { await navigator.clipboard.writeText(url); return toast('Pautan disalin.', 'success'); }
      if (b.id === 'a-qr-full') return showQrFullscreen(cfg, url);
      if (b.id === 'a-qr-print') return printQr(cfg, url);
      if (b.id === 'a-rotate') {
        if (!(await confirmDialog('Tukar kod QR?', 'Kod QR lama (termasuk yang telah dicetak / dikongsi) TIDAK lagi sah. Gunakan jika kod QR tersebar di luar majlis.', { danger: true, okLabel: 'Tukar' }))) return;
        await att.rotateToken(); toast('Kod QR baharu dijana.', 'success'); clearInterval(timer); return ctx.reload();
      }
      if (b.id === 'a-wipe') {
        if (!(await confirmDialog('Padam senarai staf dalam talian?', 'Semua staf & rekod kehadiran majlis ini di pelayan akan dipadam. Peserta cabutan di komputer ini TIDAK terjejas.', { danger: true, okLabel: 'Padam', typeToConfirm: 'PADAM' }))) return;
        await att.deleteAllStaff(); toast('Senarai staf dipadam.', 'success'); return refresh();
      }
      if (b.id === 'a-disc') {
        if (!(await confirmDialog('Putuskan sambungan majlis ini?', 'Komputer ini tidak lagi menerima data kehadiran majlis "' + cfg.eventName + '". Data di pelayan kekal. Anda boleh mencipta majlis baharu selepas ini.', { danger: true, okLabel: 'Putuskan', typeToConfirm: 'PUTUS' }))) return;
        clearInterval(timer);
        await att.disconnect(); toast('Sambungan majlis diputuskan.'); return ctx.go('dashboard');
      }
    } catch (err) { toast(errMsg(err), 'error', 6000); b.disabled = false; }
  });
}

async function renderSetup(el, ctx) {
  const s = await store.getSettings();
  mount(el, html`
    <section class="card setup-card">
      <img class="setup-mascot" src="icons/duck-main.webp" alt="">
      <h2>Pendaftaran kehadiran dengan kod QR</h2>
      <ol class="setup-steps">
        <li>Muat naik <b>senarai semua staf</b> (No. Pekerja, Nama, Jabatan) ke pelayan kehadiran.</li>
        <li>Paparkan / cetak <b>kod QR</b> di meja pendaftaran.</li>
        <li>Staf imbas QR dengan telefon → masukkan <b>No. Pekerja</b> → maklumat dipaparkan → tekan <b>Sahkan Kehadiran</b>.</li>
        <li>Komputer ini mengemas kini senarai setiap 5 saat: staf yang hadir <b>dimasukkan secara automatik sebagai peserta cabutan</b> (beserta nombor itik).</li>
      </ol>
      <label class="field"><span>Nama majlis</span><input id="s-name" maxlength="160" value="${s.eventName || ''}" placeholder="cth. Majlis Makan Malam Tahunan FKM 2026"></label>
      <button class="btn btn-go btn-lg" id="s-create">Cipta majlis dalam talian</button>
      <p class="tiny muted">Sambungan internet diperlukan semasa pendaftaran. Perlumbaan dan cabutan tetap berjalan di komputer ini (boleh luar talian).
        Untuk guna majlis yang sama di pelayar / laptop lain, aktifkan <b>Penyegerakan awan</b> di <a href="#/settings">Tetapan Sistem</a>.</p>
    </section>`);
  $('#s-create').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await att.createEvent($('#s-name').value);
      toast('Majlis dalam talian dicipta. Seterusnya: muat naik senarai staf.', 'success', 5000);
      att.startAutoSync();
      ctx.go('staff?target=attendance');
    } catch (err) { toast(errMsg(err), 'error', 6000); e.target.disabled = false; }
  });
}

export function showQrFullscreen(cfg, url) {
  const wrap = document.createElement('div');
  wrap.className = 'qr-full';
  att.qrSvg(url).then((svg) => {
    mount(wrap, html`
      <div class="standee">
        <img class="sd-logo" src="icons/logo.svg" alt="Rock The Draw">
        <div class="sd-head">Pendaftaran Kehadiran Staf</div>
        <div class="sd-event">${cfg.eventName}</div>
        <div class="sd-code">${raw(svg)}</div>
        <div class="sd-cta">Sila imbas kod QR ini<br>untuk mengesahkan kehadiran</div>
        <div class="sd-count" id="qf-count"></div>
        <div class="sd-check" aria-hidden="true"></div>
        <img class="sd-mascot" src="icons/duck-main.webp" alt="">
      </div>
      <button class="sbtn qf-close" aria-label="Tutup">✕</button>`);
    document.body.appendChild(wrap);
    if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {});
    const upd = async () => {
      if (!wrap.isConnected) return;
      try { const i = await att.eventInfo(); const c = wrap.querySelector('#qf-count'); if (c && i) c.textContent = fmtNum(i.present) + ' / ' + fmtNum(i.total) + ' staf telah hadir'; } catch (_) { /* luar talian */ }
    };
    upd();
    const t = setInterval(() => (wrap.isConnected ? upd() : clearInterval(t)), 5000);
    const close = () => {
      clearInterval(t);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      wrap.remove();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onFs = () => { if (!document.fullscreenElement) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    wrap.querySelector('.qf-close').addEventListener('click', close);
  });
}

async function printQr(cfg, url) {
  const svg = await att.qrSvg(url);
  const root = document.getElementById('print-root');
  mount(root, html`<div class="qr-poster standee">
    <img class="sd-logo" src="icons/logo.svg" alt="Rock The Draw">
    <div class="sd-head">Pendaftaran Kehadiran Staf</div>
    <div class="sd-event">${cfg.eventName}</div>
    <div class="sd-code">${raw(svg)}</div>
    <div class="sd-cta">Sila imbas kod QR ini<br>untuk mengesahkan kehadiran</div>
    <ol class="qp-steps"><li>Imbas kod QR dengan kamera telefon</li><li>Masukkan No. Pekerja</li><li>Semak maklumat &amp; tekan <b>Sahkan Kehadiran</b></li></ol>
    <div class="sd-check" aria-hidden="true"></div>
    <img class="sd-mascot" src="icons/duck-main.webp" alt="">
  </div>`);
  document.body.classList.add('printing', 'printing-poster');
  const done = () => { document.body.classList.remove('printing', 'printing-poster'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 1500); }, 80);
}

