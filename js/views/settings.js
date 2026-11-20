import { html, mount, toast, errMsg, confirmDialog, modal, download, readFileAs, $ } from '../util.js';
import * as store from '../store.js';
import * as auth from '../auth.js';
import * as sfx from '../audio.js';

export async function render(el, ctx) {
  const s = await store.getSettings();
  const pct = (v) => Math.round(v * 100);

  mount(el, html`
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Majlis & paparan</h3></div>
        <div class="form-grid">
          <label class="field span-2"><span>Nama majlis (dipapar di pentas)</span><input id="s-event" maxlength="120" value="${s.eventName}" placeholder="cth. Majlis Makan Malam Tahunan FKM 2026"></label>
          <label class="field"><span>Tarikh majlis</span><input id="s-date" type="date" value="${s.eventDate}"></label>
          <label class="field"><span>Lokasi</span><input id="s-loc" maxlength="120" value="${s.eventLocation}" placeholder="cth. Dewan Utama"></label>
          <label class="field span-2"><span>Subtajuk</span><input id="s-sub" maxlength="120" value="${s.subtitle}"></label>
          <label class="field"><span>Mod paparan</span><select id="s-mode">
            <option value="auto" ${s.renderMode === 'auto' ? 'selected' : ''}>Auto (3D jika disokong)</option>
            <option value="3d" ${s.renderMode === '3d' ? 'selected' : ''}>3D</option>
            <option value="2d" ${s.renderMode === '2d' ? 'selected' : ''}>2D (peranti lemah)</option></select></label>
          <label class="field"><span>Kualiti grafik</span><select id="s-q">
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>Tinggi (bayang, antialias)</option>
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>Rendah (laju)</option></select></label>
          <label class="field"><span>Tempoh perlumbaan (saat)</span><input id="s-dur" type="number" min="8" max="60" value="${s.raceDuration}"></label>
          <label class="field"><span>Mod pendedahan lalai</span><select id="s-rv">
            <option value="one" ${s.revealMode === 'one' ? 'selected' : ''}>Satu demi satu</option>
            <option value="finale" ${s.revealMode === 'finale' ? 'selected' : ''}>Grand Finale</option></select></label>
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
        <p class="tiny muted">Data disimpan dalam pelayar komputer ini sahaja. Gunakan akaun komputer yang dikunci dan buat sandaran selepas setiap majlis.</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Sandaran & data</h3></div>
        <div class="row-actions">
          <button class="btn btn-ghost" id="s-bak">⇩ Muat turun sandaran (.json)</button>
          <label class="btn btn-ghost">⇪ Pulihkan sandaran<input type="file" id="s-restore" accept=".json,application/json" hidden></label>
        </div>
        <div class="danger-zone">
          <h4>Zon bahaya</h4>
          <button class="btn btn-danger" id="s-reset">↺ Reset semua cabutan</button>
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
      const ok = await confirmDialog('Reset semua cabutan?', 'Semua rekod pemenang & cabutan akan DIKOSONGKAN dan semua peserta kembali LAYAK. Muat turun sandaran / eksport laporan dahulu jika perlu. Tindakan ini tidak boleh dibatalkan.', { danger: true, okLabel: 'Reset', typeToConfirm: 'RESET' });
      if (!ok) return;
      await store.resetAllDraws(); toast('Cabutan direset.', 'success'); ctx.refreshStats();
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
            try { await auth.changePassword(w.querySelector('#pw0').value, a); toast('Kata laluan ditukar.', 'success'); return true; } catch (err) { toast(errMsg(err), 'error'); return false; }
          },
        }],
      });
    }
  });
}
