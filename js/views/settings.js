import { html, mount, toast, errMsg, confirmDialog, modal, download, readFileAs, $ } from '../util.js';
import * as store from '../store.js';
import * as auth from '../auth.js';
import * as sfx from '../audio.js';
import * as sync from '../sync.js';
import * as att from '../attendance.js';
import { fmtTime } from '../util.js';

export async function render(el, ctx) {
  const s = await store.getSettings();
  const pct = (v) => Math.round(v * 100);

  mount(el, html`
    <section class="card cloud-card" id="cloud-card"></section>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Majlis & paparan</h3></div>
        <div class="form-grid">
          <label class="field span-2"><span>Nama majlis (dipaparkan di pentas)</span><input id="s-event" maxlength="120" value="${s.eventName}" placeholder="cth. Majlis Makan Malam Tahunan FKM 2026"></label>
          <label class="field"><span>Tarikh majlis</span><input id="s-date" type="date" value="${s.eventDate}"></label>
          <label class="field"><span>Lokasi</span><input id="s-loc" maxlength="120" value="${s.eventLocation}" placeholder="cth. Dewan Utama"></label>
          <label class="field span-2"><span>Subtajuk</span><input id="s-sub" maxlength="120" value="${s.subtitle}"></label>
          <label class="field"><span>Mod paparan</span><select id="s-mode">
            <option value="auto" ${s.renderMode === 'auto' ? 'selected' : ''}>Automatik (3D jika disokong)</option>
            <option value="3d" ${s.renderMode === '3d' ? 'selected' : ''}>3D</option>
            <option value="2d" ${s.renderMode === '2d' ? 'selected' : ''}>2D (komputer berprestasi rendah)</option></select></label>
          <label class="field"><span>Kualiti grafik</span><select id="s-q">
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>Tinggi (bayang dan tepi licin)</option>
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Rendah (laju)</option></select></label>
          <label class="field"><span>Tempoh perlumbaan (saat)</span><input id="s-dur" type="number" min="8" max="60" value="${s.raceDuration}"></label>
          <label class="field"><span>Mod pendedahan lalai</span><select id="s-rv">
            <option value="one" ${s.revealMode === 'one' ? 'selected' : ''}>Satu demi satu</option>
            <option value="finale" ${s.revealMode === 'finale' ? 'selected' : ''}>Grand Finale (serentak)</option></select></label>
          <label class="check span-2"><input type="checkbox" id="s-hl" ${s.highlightDuringRace ? 'checked' : ''}> Serlahkan itik pemenang SEMASA perlumbaan (lalai: hanya selepas melintas garisan — lebih suspens)</label>
          <label class="check span-2"><input type="checkbox" id="s-multi" ${s.allowMultipleWins ? 'checked' : ''}> Benarkan peserta menang lebih daripada sekali (lalai: TIDAK)</label>
        </div>
        <button class="btn btn-primary" id="s-save">Simpan tetapan</button>
      </section>

      <section class="card">
        <div class="card-head"><h3>Bunyi</h3><label class="switch"><input type="checkbox" id="s-snd" ${s.soundEnabled ? 'checked' : ''}><span></span> <em id="snd-lbl">${s.soundEnabled ? 'Hidup' : 'Senyap'}</em></label></div>
        <label class="field"><span>Kelantangan utama <b id="mv">${pct(s.masterVolume)}%</b></span><input type="range" id="s-master" min="0" max="1" step="0.05" value="${s.masterVolume}"></label>
        <div class="vol-list">${sfx.CHANNELS.map(([k, label]) => html`
          <div class="vol-row"><span>${label}</span><input type="range" min="0" max="1" step="0.05" data-vol="${k}" value="${s.volumes[k]}" aria-label="${label}">
          <button class="icon-btn" data-test="${k}" title="Uji">▶</button></div>`)}</div>
        <p class="tiny muted">Semua bunyi disintesis secara setempat (tiada fail audio) dan berfungsi luar talian. Lalai: senyap.</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Keselamatan</h3></div>
        <button class="btn btn-ghost" id="s-pw">🔑 Tukar kata laluan pentadbir</button>
        <p class="tiny muted">${sync.isCloud() ? 'Kata laluan ini juga kata laluan majlis awan (untuk menyertai dari pelayar lain).' : 'Data disimpan dalam pelayar komputer ini sahaja. Gunakan akaun komputer yang dikunci dan buat sandaran selepas setiap majlis.'}</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Sandaran & data</h3></div>
        <div class="row-actions">
          <button class="btn btn-ghost" id="s-bak">⇩ Muat turun sandaran (.json)</button>
          <label class="btn btn-ghost">⇪ Pulihkan sandaran<input type="file" id="s-restore" accept=".json,application/json" hidden></label>
        </div>
        <div class="danger-zone">
          <h4>Zon bahaya</h4>
          <button class="btn btn-danger" id="s-reset">↺ Set semula semua cabutan</button>
          <button class="btn btn-danger" id="s-wipe">🗑 Padam semua peserta</button>
        </div>
      </section>
    </div>`);

  const collect = () => ({
    eventName: $('#s-event').value, eventDate: $('#s-date').value, eventLocation: $('#s-loc').value, subtitle: $('#s-sub').value, renderMode: $('#s-mode').value, quality: $('#s-q').value,
    raceDuration: $('#s-dur').value, revealMode: $('#s-rv').value, highlightDuringRace: $('#s-hl').checked, allowMultipleWins: $('#s-multi').checked,
  });

  const saveSound = async (patch) => { const n = await store.saveSettings(patch); sfx.configure(n); return n; };

  el.addEventListener('input', async (e) => {
    if (e.target.id === 's-master') { $('#mv').textContent = pct(+e.target.value) + '%'; await saveSound({ masterVolume: +e.target.value }); }
    if (e.target.dataset.vol) await saveSound({ volumes: { [e.target.dataset.vol]: +e.target.value } });
  });
  el.addEventListener('change', async (e) => {
    if (e.target.id === 's-snd') {
      await saveSound({ soundEnabled: e.target.checked });
      if (e.target.checked) sfx.unlock();
      store.audit('TETAPAN_BUNYI', e.target.checked ? 'hidup' : 'senyap');
      $('#snd-lbl').textContent = e.target.checked ? 'Hidup' : 'Senyap';
    }
    if (e.target.id === 's-multi' && e.target.checked) {
      const ok = await confirmDialog('Benarkan menang berulang?', 'Pemenang terdahulu akan dimasukkan semula ke dalam kumpulan cabutan. Biasanya TIDAK digunakan untuk majlis cabutan bertuah.', { okLabel: 'Ya, benarkan' });
      if (!ok) e.target.checked = false;
    }
    if (e.target.id === 's-restore' && e.target.files[0]) {
      try {
        const obj = JSON.parse(await readFileAs(e.target.files[0], 'text'));
        const ok = await confirmDialog('Pulihkan sandaran?', 'SEMUA data semasa (peserta, hadiah, pemenang, log) akan DIGANTIKAN dengan kandungan sandaran ini.', { danger: true, okLabel: 'Pulihkan', typeToConfirm: 'PULIH' });
        if (!ok) return;
        await store.importBackup(obj);
        toast('Sandaran dipulihkan.', 'success');
        ctx.go('dashboard');
      } catch (err) { toast(errMsg(err), 'error', 6000); }
      e.target.value = '';
    }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.test) { if (!(await store.getSettings()).soundEnabled) return toast('Hidupkan bunyi dahulu.', 'error'); sfx.unlock(); sfx.test(b.dataset.test); }
    if (b.id === 's-save') {
      try { await store.saveSettings(collect()); await store.audit('TETAPAN', JSON.stringify(collect())); toast('Tetapan disimpan.', 'success'); } catch (err) { toast(errMsg(err), 'error'); }
    }
    if (b.id === 's-bak') {
      const data = await store.exportBackup();
      download('lucky-duck-sandaran-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 1), 'application/json');
      store.audit('SANDARAN_EKSPORT', '');
    }
    if (b.id === 's-reset') {
      const ok = await confirmDialog('Set semula semua cabutan?', 'Semua rekod pemenang & cabutan akan DIKOSONGKAN dan semua peserta kembali LAYAK. Muat turun sandaran / eksport laporan dahulu jika perlu. Tindakan ini tidak boleh dibatalkan.', { danger: true, okLabel: 'Set semula', typeToConfirm: 'SET SEMULA' });
      if (!ok) return;
      await store.resetAllDraws(); toast('Semua cabutan telah ditetapkan semula.', 'success'); ctx.refreshStats();
    }
    if (b.id === 's-wipe') {
      const ok = await confirmDialog('Padam semua peserta?', 'Semua peserta akan dipadam. Sejarah pemenang dikekalkan.', { danger: true, okLabel: 'Padam semua', typeToConfirm: 'PADAM' });
      if (!ok) return;
      await store.deleteAllParticipants(); toast('Semua peserta dipadam.', 'success'); ctx.refreshStats();
    }
    if (b.id === 's-pw') {
      await modal({
        title: 'Tukar kata laluan',
        body: html`<label class="field"><span>Kata laluan semasa</span><input type="password" id="pw0" autocomplete="current-password"></label>
          <label class="field"><span>Kata laluan baharu</span><input type="password" id="pw1" autocomplete="new-password"></label>
          <label class="field"><span>Sahkan</span><input type="password" id="pw2" autocomplete="new-password"></label>`,
        buttons: [{ label: 'Cancel', value: null }, {
          label: 'Tukar', kind: 'primary', value: true,
          validate: async (w) => {
            const a = w.querySelector('#pw1').value;
            if (a !== w.querySelector('#pw2').value) { toast('Kata laluan baharu tidak sepadan.', 'error'); return false; }
            try {
              if (sync.isCloud()) await sync.changeCloudPassword(w.querySelector('#pw0').value, a);
              await auth.changePassword(w.querySelector('#pw0').value, a); toast('Kata laluan ditukar.', 'success'); return true; } catch (err) { toast(errMsg(err), 'error'); return false; }
          },
        }],
      });
    }
  });

  renderCloud($('#cloud-card'), ctx);
  const off = sync.on((type) => { if (type === 'status' || type === 'control') { if (!document.body.contains(el)) return off(); paintStatus(); } });
}

// ----------------------------------------------------------------------------- Penyegerakan awan

function statusLine() {
  const st = sync.state;
  if (st.sessionLost) return html`<span class="tag tag-err">● Sesi tamat — sertai semula</span>`;
  if (!st.online) return html`<span class="tag tag-warn">● Luar talian${st.pending ? ' · ' + st.pending + ' perubahan menunggu' : ''}</span>`;
  if (st.syncing || st.pending) return html`<span class="tag tag-info">⟳ Menyegerak${st.pending ? ' (' + st.pending + ')' : ''}</span>`;
  return html`<span class="tag tag-ok">● Disegerak${st.lastSync ? ' · ' + fmtTime(st.lastSync.toISOString()) : ''}</span>`;
}
function paintStatus() { const b = $('#cl-status'); if (b) mount(b, statusLine()); }

async function renderCloud(box, ctx) {
  const dev = await sync.device();
  if (!sync.isCloud()) {
    mount(box, html`
      <div class="card-head"><h3>☁ Penyegerakan awan (berbilang pelayar / laptop)</h3><span class="tag">Komputer ini sahaja</span></div>
      <p class="muted">Sekarang data cabutan disimpan dalam pelayar ini sahaja. Aktifkan penyegerakan supaya <b>semua pelayar dan laptop</b> yang log masuk
        dengan <b>kod majlis + kata laluan</b> melihat data yang sama. Sistem tetap berfungsi <b>tanpa internet</b> — perubahan dihantar bila online semula.</p>
      <div class="row-actions">
        <button class="btn btn-purple" id="cl-enable">☁ Aktifkan untuk majlis ini (komputer ini jadi Peranti Kawalan)</button>
        <button class="btn btn-ghost" id="cl-join">⇣ Sertai majlis awan sedia ada</button>
      </div>`);
  } else {
    const c = sync.state.cfg;
    const me = sync.isControl();
    mount(box, html`
      <div class="card-head"><h3>☁ Penyegerakan awan</h3><span id="cl-status">${statusLine()}</span></div>
      <div class="cloud-grid">
        <div><span class="muted tiny">Kod majlis</span><div class="cloud-code mono">${c.code}</div><span class="tiny muted">${c.name || ''}</span></div>
        <div><span class="muted tiny">Peranti ini</span><div><b>${dev.name}</b> ${me ? html`<span class="tag tag-gold">★ Peranti Kawalan</span>` : html`<span class="tag">Peranti biasa</span>`}</div>
          <span class="tiny muted">Peranti Kawalan: ${sync.controlName() || '—'}</span></div>
      </div>
      <p class="tiny muted">Log masuk di pelayar / laptop lain: Tetapan → <b>Sertai majlis awan</b> (atau skrin pertama) → masukkan kod <b>${c.code}</b> dan kata laluan pentadbir.
        ${me ? 'Peranti ini boleh membuat cabutan walaupun tanpa internet.' : 'Cabutan hanya dibuat di Peranti Kawalan. Tanpa internet, peranti ini baca sahaja.'}</p>
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" id="cl-now">⟳ Segerak sekarang</button>
        <button class="btn btn-ghost btn-sm" id="cl-name">✎ Nama peranti</button>
        ${me ? '' : html`<button class="btn btn-purple btn-sm" id="cl-claim">★ Jadikan peranti ini Peranti Kawalan</button>`}
        <button class="btn btn-ghost btn-sm link-danger" id="cl-leave">⏏ Putuskan peranti ini</button>
      </div>`);
  }
  box.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.id === 'cl-enable') return await enableFlow(ctx);
      if (b.id === 'cl-join') return await joinFlow(ctx);
      if (b.id === 'cl-now') { b.disabled = true; await sync.tick(); toast('Data disegerak.', 'success'); b.disabled = false; return; }
      if (b.id === 'cl-name') {
        const v = await modal({ title: 'Nama peranti', body: html`<label class="field"><span>Nama (cth. Laptop Pentas, Kaunter 2)</span><input id="dn" maxlength="80" value="${dev.name}"></label>`,
          buttons: [{ label: 'Cancel', value: null }, { label: 'Simpan', kind: 'primary', value: true, validate: (w) => { sync.setDeviceName(w.querySelector('#dn').value); return true; } }] });
        if (v) { toast('Nama peranti disimpan. Ia dikemas kini di pelayan bila anda menyertai semula / mengambil alih kawalan.', 'success'); renderCloud(box, ctx); }
        return;
      }
      if (b.id === 'cl-claim') {
        if (!(await confirmDialog('Jadikan peranti ini Peranti Kawalan?', 'Hanya Peranti Kawalan boleh membuat cabutan dan bekerja tanpa internet. ' + (sync.controlName() || 'Peranti lain') + ' akan menjadi peranti biasa. Pastikan laptop kawalan asal tidak sedang membuat cabutan secara luar talian.', { okLabel: 'Ambil alih' }))) return;
        await sync.flush(8000);
        await sync.claimControl(); toast('Peranti ini kini Peranti Kawalan.', 'success'); att.startAutoSync(); return renderCloud(box, ctx);
      }
      if (b.id === 'cl-leave') {
        const msg = sync.state.pending ? 'AMARAN: ' + sync.state.pending + ' perubahan belum dihantar ke awan dan akan kekal di pelayar ini sahaja. ' : '';
        if (!(await confirmDialog('Putuskan peranti ini daripada majlis awan?', msg + 'Data sedia ada kekal dalam pelayar ini, tetapi tidak lagi disegerak.', { danger: true, okLabel: 'Putuskan', typeToConfirm: 'PUTUS' }))) return;
        await sync.leave(); toast('Peranti diputuskan daripada majlis awan.'); return ctx.reload();
      }
    } catch (err) { toast(errMsg(err), 'error', 7000); b.disabled = false; }
  };
}

async function enableFlow(ctx) {
  const s = await store.getSettings();
  let cfg = await att.getConfig();
  await modal({
    title: 'Aktifkan penyegerakan awan',
    body: html`<p class="muted">Semua data dalam pelayar ini (peserta, hadiah, pemenang, log, tetapan) akan dimuat naik. Komputer ini menjadi <b>Peranti Kawalan</b>.
        Anda akan menerima <b>kod majlis</b> untuk log masuk dari pelayar lain.</p>
      ${cfg ? '' : html`<label class="field"><span>Nama majlis</span><input id="ce-name" maxlength="160" value="${s.eventName || ''}" placeholder="cth. Majlis Makan Malam Tahunan FKM 2026"></label>`}
      <label class="field"><span>Kata laluan majlis (min. 8 aksara, huruf + nombor)</span><input type="password" id="ce-pw1" autocomplete="new-password"></label>
      <label class="field"><span>Sahkan kata laluan</span><input type="password" id="ce-pw2" autocomplete="new-password"></label>
      <p class="tiny muted">Kata laluan ini juga menjadi kata laluan log masuk pentadbir di pelayar ini.</p>`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Aktifkan', kind: 'primary', value: true,
      validate: async (w) => {
        const pw = w.querySelector('#ce-pw1').value;
        const p = auth.passwordProblem(pw);
        if (p) { toast(p, 'error'); return false; }
        if (pw !== w.querySelector('#ce-pw2').value) { toast('Kata laluan tidak sepadan.', 'error'); return false; }
        const btn = w.querySelector('.modal-foot .btn-primary'); if (btn) { btn.disabled = true; btn.textContent = 'Memuat naik…'; }
        try {
          if (!cfg) cfg = await att.createEvent((w.querySelector('#ce-name') || {}).value || s.eventName);
          const c = await sync.enable(cfg, pw);
          await auth.setPassword(pw);
          await store.audit('AWAN_AKTIF', c.code);
          att.startAutoSync();
          toast('Penyegerakan awan aktif. Kod majlis: ' + c.code, 'success', 8000);
          return true;
        } catch (err) { toast(errMsg(err), 'error', 7000); if (btn) { btn.disabled = false; btn.textContent = 'Aktifkan'; } return false; }
      },
    }],
  });
  ctx.reload();
}

export async function joinFlow(ctx, { afterJoin } = {}) {
  let done = false;
  await modal({
    title: 'Sertai majlis awan',
    body: html`<p class="muted">Masukkan kod majlis (dipaparkan di Tetapan Sistem pada laptop kawalan) dan kata laluan pentadbir majlis.</p>
      <p class="alert alert-warn tiny">Data cabutan yang ada dalam pelayar ini sekarang akan <b>digantikan</b> dengan data majlis awan.</p>
      <label class="field"><span>Kod majlis</span><input id="cj-code" class="mono" maxlength="20" placeholder="RTD-XXXXXX" autocapitalize="characters" autocomplete="off"></label>
      <label class="field"><span>Kata laluan</span><input type="password" id="cj-pw" autocomplete="current-password"></label>`,
    buttons: [{ label: 'Cancel', value: null }, {
      label: 'Sertai', kind: 'primary', value: true,
      validate: async (w) => {
        const code = w.querySelector('#cj-code').value.trim();
        const pw = w.querySelector('#cj-pw').value;
        if (!code || !pw) { toast('Isi kod majlis dan kata laluan.', 'error'); return false; }
        const btn = w.querySelector('.modal-foot .btn-primary'); if (btn) { btn.disabled = true; btn.textContent = 'Memuat turun data…'; }
        try {
          const c = await sync.join(code, pw);
          await auth.setPassword(pw);
          store.invalidateSettings();
          await store.audit('AWAN_SERTAI', c.code);
          att.startAutoSync();
          toast('Berjaya menyertai majlis ' + (c.name || c.code) + '.', 'success', 6000);
          done = true;
          return true;
        } catch (err) { toast(errMsg(err), 'error', 7000); if (btn) { btn.disabled = false; btn.textContent = 'Sertai'; } return false; }
      },
    }],
  });
  if (done && afterJoin) return afterJoin();
  if (done && ctx) ctx.go('dashboard');
  return done;
}
