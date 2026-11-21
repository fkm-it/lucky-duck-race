import { html, mount, toast, errMsg, confirmDialog, modal, download, readFileAs, fmtTime, fmtNum, $ } from '../util.js';
import * as store from '../store.js';
import * as auth from '../auth.js';
import * as sfx from '../audio.js';
import * as sync from '../sync.js';
import * as att from '../attendance.js';
import { rpc } from '../cloud.js';

export async function render(el, ctx) {
  const s = await store.getSettings();
  const pct = (v) => Math.round(v * 100);
  const admin = auth.role() === 'admin';
  const dis = admin ? '' : 'disabled';

  mount(el, html`
    <div class="grid-2">
      <section class="card" id="c-acct"></section>
      <section class="card" id="c-db"></section>
    </div>
    ${admin ? html`<section class="card card-flush" id="c-users"></section>` : ''}
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Majlis & paparan</h3>${admin ? '' : html`<span class="tag">Baca sahaja</span>`}</div>
        <div class="form-grid">
          <label class="field span-2"><span>Nama majlis (dipaparkan di pentas)</span><input id="s-event" maxlength="120" value="${s.eventName}" placeholder="cth. Majlis Makan Malam Tahunan FKM 2026" ${dis}></label>
          <label class="field"><span>Tarikh majlis</span><input id="s-date" type="date" value="${s.eventDate}" ${dis}></label>
          <label class="field"><span>Lokasi</span><input id="s-loc" maxlength="120" value="${s.eventLocation}" placeholder="cth. Dewan Utama" ${dis}></label>
          <label class="field span-2"><span>Subtajuk</span><input id="s-sub" maxlength="120" value="${s.subtitle}" ${dis}></label>
          <label class="field"><span>Mod paparan (peranti ini)</span><select id="s-mode">
            <option value="auto" ${s.renderMode === 'auto' ? 'selected' : ''}>Automatik (3D jika disokong)</option>
            <option value="3d" ${s.renderMode === '3d' ? 'selected' : ''}>3D</option>
            <option value="2d" ${s.renderMode === '2d' ? 'selected' : ''}>2D (komputer berprestasi rendah)</option></select></label>
          <label class="field"><span>Kualiti grafik (peranti ini)</span><select id="s-q">
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>Tinggi (bayang dan tepi licin)</option>
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Rendah (laju)</option></select></label>
          <label class="field"><span>Tempoh perlumbaan (saat)</span><input id="s-dur" type="number" min="8" max="60" value="${s.raceDuration}" ${dis}></label>
          <label class="field"><span>Mod pendedahan lalai</span><select id="s-rv" ${dis}>
            <option value="one" ${s.revealMode === 'one' ? 'selected' : ''}>Satu demi satu</option>
            <option value="finale" ${s.revealMode === 'finale' ? 'selected' : ''}>Grand Finale (serentak)</option></select></label>
          <label class="check span-2"><input type="checkbox" id="s-hl" ${s.highlightDuringRace ? 'checked' : ''} ${dis}> Serlahkan itik pemenang SEMASA perlumbaan (lalai: hanya selepas melintas garisan — lebih suspens)</label>
          <label class="check span-2"><input type="checkbox" id="s-multi" ${s.allowMultipleWins ? 'checked' : ''} ${dis}> Benarkan peserta menang lebih daripada sekali (lalai: TIDAK)</label>
        </div>
        <button class="btn btn-primary" id="s-save">Simpan tetapan</button>
      </section>

      <section class="card">
        <div class="card-head"><h3>Bunyi (peranti ini)</h3><label class="switch"><input type="checkbox" id="s-snd" ${s.soundEnabled ? 'checked' : ''}><span></span> <em id="snd-lbl">${s.soundEnabled ? 'Hidup' : 'Senyap'}</em></label></div>
        <label class="field"><span>Kelantangan utama <b id="mv">${pct(s.masterVolume)}%</b></span><input type="range" id="s-master" min="0" max="1" step="0.05" value="${s.masterVolume}"></label>
        <div class="vol-list">${sfx.CHANNELS.map(([k, label]) => html`
          <div class="vol-row"><span>${label}</span><input type="range" min="0" max="1" step="0.05" data-vol="${k}" value="${s.volumes[k]}" aria-label="${label}">
          <button class="icon-btn" data-test="${k}" title="Uji">▶</button></div>`)}</div>
        <p class="tiny muted">Bunyi disimpan dalam peranti ini dan berfungsi luar talian. Lalai: senyap.</p>
      </section>

      ${admin ? html`<section class="card">
        <div class="card-head"><h3>Sandaran & data</h3></div>
        <div class="row-actions">
          <button class="btn btn-ghost" id="s-bak">⇩ Muat turun sandaran (.json)</button>
          <label class="btn btn-ghost">⇪ Pulihkan sandaran<input type="file" id="s-restore" accept=".json,application/json" hidden></label>
        </div>
        <p class="tiny muted">Sandaran mengandungi data majlis aktif daripada salinan setempat yang terkini. Pemulihan menggantikan data majlis di pangkalan data pusat.
          Sandaran pangkalan data penuh: lihat <b>docs/OPERASI.md</b>.</p>
        <div class="danger-zone">
          <h4>Zon bahaya</h4>
          <button class="btn btn-danger" id="s-reset">↺ Set semula semua cabutan</button>
          <button class="btn btn-danger" id="s-wipe">🗑 Padam semua peserta</button>
        </div>
      </section>` : ''}
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
      try {
        const c = collect();
        await store.saveSettings(admin ? c : { renderMode: c.renderMode, quality: c.quality });
        await store.audit('TETAPAN', JSON.stringify(c)); toast('Tetapan disimpan.', 'success');
      } catch (err) { toast(errMsg(err), 'error'); }
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
              await auth.changePassword(w.querySelector('#pw0').value, a); toast('Kata laluan ditukar.', 'success'); return true; } catch (err) { toast(errMsg(err), 'error'); return false; }
          },
        }],
      });
    }
  });

  renderAccount($('#c-acct'), ctx);
  renderDb($('#c-db'), ctx);
  if (admin) renderUsers($('#c-users'));
  const off = sync.on((type) => {
    if (!document.body.contains(el)) return off();
    if (type === 'status' || type === 'control' || type === 'event') paintDb();
  });
}

// ----------------------------------------------------------------------------- Akaun & peranti

async function renderAccount(box, ctx) {
  const p = auth.profile() || {};
  const d = await sync.device();
  mount(box, html`
    <div class="card-head"><h3>Akaun & peranti</h3><span class="tag tag-gold">${auth.ROLE_LABEL[p.role] || '—'}</span></div>
    <dl class="kv">
      <dt>Nama</dt><dd>${p.name || '—'}</dd>
      <dt>E-mel</dt><dd>${p.email || auth.email()}</dd>
      <dt>Sesi</dt><dd>${auth.isOfflineSession() ? 'Luar talian (sesi tersimpan)' : 'Dalam talian'}</dd>
      <dt>Peranti ini</dt><dd>${d.name}</dd>
    </dl>
    <div class="row-actions">
      <button class="btn btn-ghost btn-sm" id="ac-name">✎ Nama saya</button>
      <button class="btn btn-ghost btn-sm" id="ac-dev">✎ Nama peranti</button>
      <button class="btn btn-ghost btn-sm" id="s-pw">🔑 Tukar kata laluan</button>
    </div>
    <p class="tiny muted">Satu akaun untuk semua pelayar dan peranti. Selepas log masuk dalam talian sekali, anda boleh log masuk di peranti ini walaupun tanpa internet.</p>`);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.id === 'ac-name') {
        const v = await modal({ title: 'Nama saya', body: html`<label class="field"><span>Nama</span><input id="nm" maxlength="120" value="${p.name || ''}"></label>`,
          buttons: [{ label: 'Cancel', value: null }, { label: 'Simpan', kind: 'primary', value: true, validate: async (w) => { try { await rpc('ldr_set_my_name', { p_name: w.querySelector('#nm').value }); return true; } catch (err) { toast(errMsg(err), 'error'); return false; } } }] });
        if (v) { await auth.refreshProfile(); toast('Nama dikemas kini.', 'success'); ctx.reload(); }
      }
      if (b.id === 'ac-dev') {
        const v = await modal({ title: 'Nama peranti', body: html`<label class="field"><span>Nama (cth. Laptop Pentas, Kaunter 2)</span><input id="dn" maxlength="80" value="${d.name}"></label>`,
          buttons: [{ label: 'Cancel', value: null }, { label: 'Simpan', kind: 'primary', value: true, validate: async (w) => { await sync.setDeviceName(w.querySelector('#dn').value); return true; } }] });
        if (v) { toast('Nama peranti disimpan.', 'success'); if (sync.isControl()) await sync.claimControl().catch(() => {}); ctx.reload(); }
      }
    } catch (err) { toast(errMsg(err), 'error'); }
  });
}

// ----------------------------------------------------------------------------- Pangkalan data pusat & majlis

function dbStatus() {
  const st = sync.state;
  const ph = sync.phase();
  const map = { online: ['tag-ok', 'ONLINE'], offline: ['tag-warn', 'OFFLINE'], syncing: ['tag-info', 'SYNCING'], complete: ['tag-ok', 'SYNC COMPLETE'], local: ['tag-warn', 'TIADA MAJLIS'] };
  const [c, l] = map[ph];
  return html`<span class="tag ${c}">● ${l}${st.pending ? ' · ' + st.pending + ' menunggu' : ''}</span>`;
}
function paintDb() {
  const b = $('#db-status'); if (b) mount(b, dbStatus());
  const i = $('#db-info'); if (i) mount(i, dbInfo());
}
function dbInfo() {
  const st = sync.state;
  const e = st.event || {};
  return html`<dl class="kv">
    <dt>Majlis aktif</dt><dd><b>${e.name || '—'}</b></dd>
    <dt>Peranti Kawalan</dt><dd>${sync.isControl() ? html`<b>★ Peranti ini</b>` : (e.control_name || 'Belum ditetapkan')}</dd>
    <dt>Segerak terakhir</dt><dd>${st.lastSync ? fmtTime(st.lastSync.toISOString()) : '—'}${st.realtime ? ' · Realtime aktif' : ''}</dd>
    ${st.lastError && !st.online ? html`<dt>Ralat</dt><dd class="muted">${st.lastError}</dd>` : ''}
  </dl>`;
}

async function renderDb(box, ctx) {
  const role = auth.role();
  const legacyAtt = role === 'admin' ? await store.getKV('attendance') : null;
  const canLink = !!(legacyAtt && legacyAtt.adminKey && sync.state.event && sync.state.event.legacy && legacyAtt.eventId === sync.state.event.event_id);
  mount(box, html`
    <div class="card-head"><h3>☁ Pangkalan data pusat</h3><span id="db-status">${dbStatus()}</span></div>
    <div id="db-info">${dbInfo()}</div>
    <p class="tiny muted">Semua pelayar dan peranti yang log masuk berkongsi data yang sama. Tanpa internet, perubahan disimpan dalam baris gilir peranti ini
      dan dihantar secara automatik bila sambungan pulih. Cabutan luar talian hanya di <b>Peranti Kawalan</b>.</p>
    <div class="row-actions">
      <button class="btn btn-ghost btn-sm" id="db-now">⟳ Segerak sekarang</button>
      ${['admin', 'operator'].includes(role) && !sync.isControl() ? html`<button class="btn btn-purple btn-sm" id="db-claim">★ Jadikan peranti ini Peranti Kawalan</button>` : ''}
      ${role === 'admin' ? html`<button class="btn btn-ghost btn-sm" id="db-events">🗂 Urus majlis</button>` : ''}
      ${sync.state.legacyLocal ? html`<button class="btn btn-gold btn-sm" id="db-legacy">⇪ Data pelayar lama…</button>` : ''}
      ${canLink ? html`<button class="btn btn-ghost btn-sm" id="db-link">🔗 Kekalkan kod QR bercetak (majlis lama)</button>` : ''}
    </div>`);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.id === 'db-now') { b.disabled = true; await sync.tick(); toast('Disegerak dengan pangkalan data pusat.', 'success'); b.disabled = false; paintDb(); }
      if (b.id === 'db-claim') {
        if (!(await confirmDialog('Jadikan peranti ini Peranti Kawalan?', 'Peranti Kawalan ialah satu-satunya peranti yang boleh membuat cabutan TANPA internet (keputusan dihantar bila online). ' + (sync.controlName() ? sync.controlName() + ' akan menjadi peranti biasa.' : ''), { okLabel: 'Ambil alih' }))) return;
        await sync.claimControl(); ctx.reload();
      }
      if (b.id === 'db-legacy') { location.reload(); }
      if (b.id === 'db-link') {
        const meta = await att.linkLegacy();
        sync.setEventMeta(meta); toast('Kod QR majlis lama kekal sah dan kini boleh dipapar di semua peranti.', 'success', 6000); ctx.reload();
      }
      if (b.id === 'db-events') await manageEvents(ctx);
    } catch (err) { toast(errMsg(err), 'error', 7000); b.disabled = false; }
  });
}

async function manageEvents(ctx) {
  const list = await rpc('ldr_events_list');
  const cur = sync.state.event && sync.state.event.event_id;
  const v = await modal({
    title: 'Urus majlis',
    body: html`<p class="muted tiny">Satu majlis aktif pada satu masa. Semua peranti menggunakan majlis aktif. Data majlis lain kekal di pangkalan data pusat.</p>
      <div class="ev-list">${list.map((e) => html`<label class="rc ev-row"><input type="radio" name="ev" value="${e.event_id}" ${e.event_id === cur ? 'checked' : ''}>
        <b>${e.name}</b><small>${fmtNum(e.participants)} peserta · ${fmtNum(e.staff)} staf · dicipta ${fmtTime(e.created_at)}${e.is_active ? ' · AKTIF' : ''}</small></label>`)}</div>
      <label class="field"><span>Atau cipta majlis baharu</span><input id="ev-new" maxlength="160" placeholder="Nama majlis baharu"></label>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Simpan', kind: 'primary', value: true, validate: (w) => {
      const nn = w.querySelector('#ev-new').value.trim();
      const sel = (w.querySelector('input[name=ev]:checked') || {}).value;
      return { nn, sel };
    } }],
  });
  if (!v || v === true) return;
  if (v.nn) {
    if (!(await confirmDialog('Cipta majlis baharu?', 'Majlis "' + v.nn + '" akan menjadi majlis AKTIF untuk semua peranti. Data majlis semasa kekal di pangkalan data pusat.', { okLabel: 'Cipta' }))) return;
    await att.createEvent(v.nn);
  } else if (v.sel && v.sel !== cur) {
    if (!(await confirmDialog('Tukar majlis aktif?', 'Semua peranti akan beralih ke majlis yang dipilih. Pastikan tiada cabutan sedang berjalan.', { okLabel: 'Tukar' }))) return;
    const meta = await rpc('ldr_event_activate', { p_event: v.sel });
    await sync.switchEvent(meta);
  } else return;
  await store.setKV('lastEvent', sync.state.event);
  toast('Majlis aktif: ' + sync.state.event.name, 'success');
  ctx.go('dashboard');
}

// ----------------------------------------------------------------------------- Pengguna & peranan (pentadbir)

async function renderUsers(box) {
  let users = [];
  try { users = await rpc('ldr_users_list'); } catch (err) {
    mount(box, html`<div class="pad"><h3>Pengguna & peranan</h3><p class="muted">${errMsg(err)}</p></div>`); return;
  }
  const me = (auth.profile() || {}).user_id;
  const pending = users.filter((u) => !u.role).length;
  mount(box, html`
    <div class="toolbar pad"><h3>Pengguna & peranan</h3>${pending ? html`<span class="tag tag-warn">${pending} menunggu kelulusan</span>` : ''}<div class="spacer"></div>
      <span class="tiny muted">Pengguna baharu mendaftar di skrin log masuk → <b>Daftar akaun baharu</b>, kemudian tetapkan peranan di sini.</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>Nama</th><th>E-mel</th><th>Peranan</th><th>Status</th><th>Log masuk terakhir</th></tr></thead>
      <tbody>${users.map((u) => html`<tr>
        <td><b>${u.name || '—'}</b>${u.user_id === me ? html` <small class="muted">(anda)</small>` : ''}</td>
        <td class="mono tiny">${u.email}</td>
        <td><select data-role="${u.user_id}" aria-label="Peranan ${u.email}">
          <option value="" ${!u.role ? 'selected' : ''}>— Menunggu —</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Pentadbir</option>
          <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Operator Cabutan</option>
          <option value="registrar" ${u.role === 'registrar' ? 'selected' : ''}>Staf Pendaftaran</option></select></td>
        <td><label class="switch"><input type="checkbox" data-active="${u.user_id}" ${u.active ? 'checked' : ''}><span></span> <em>${u.active ? 'Aktif' : 'Digantung'}</em></label></td>
        <td class="tiny">${u.last_sign_in_at ? fmtTime(u.last_sign_in_at) : '—'}</td></tr>`)}</tbody></table></div>
    <p class="tiny muted pad">Pentadbir: akses penuh. Operator Cabutan: jalankan cabutan, lihat peserta & pemenang (tidak boleh ubah data staf / hadiah).
      Staf Pendaftaran: cari staf, sahkan kehadiran, lihat rekod kehadiran.</p>`);
  box.addEventListener('change', async (e) => {
    const id = e.target.dataset.role || e.target.dataset.active;
    if (!id) return;
    const u = users.find((x) => x.user_id === id);
    try {
      const roleV = e.target.dataset.role ? (e.target.value || null) : u.role;
      const activeV = e.target.dataset.active ? e.target.checked : u.active;
      await rpc('ldr_user_set', { p_user: id, p_role: roleV, p_active: activeV });
      await store.audit('PENGGUNA_KEMASKINI', u.email + ' → ' + (roleV || 'menunggu') + (activeV ? '' : ' (digantung)'));
      toast('Pengguna dikemas kini.', 'success');
    } catch (err) { toast(errMsg(err), 'error'); }
    renderUsers(box);
  });
}
