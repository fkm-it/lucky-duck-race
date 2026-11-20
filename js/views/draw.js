import { html, mount, toast, errMsg, fmtNum, $ } from '../util.js';
import * as store from '../store.js';
import { openStage } from '../race.js';
import { icon } from '../icons.js';

export async function render(el, ctx) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const [ps, settings, pool] = await Promise.all([store.getPrizeStatus(), store.getSettings(), store.eligiblePool()]);
  const open = ps.filter((x) => x.remaining > 0);
  const st = {
    prizeId: params.get('prize') || (open[0] ? open[0].prize.id : ''),
    reveal: settings.revealMode,
  };
  if (st.prizeId && !open.find((x) => x.prize.id === st.prizeId)) st.prizeId = open[0] ? open[0].prize.id : '';

  const cur = () => ps.find((x) => x.prize.id === st.prizeId);
  const maxFor = () => Math.min(pool.length, cur() ? cur().remaining : pool.length);

  mount(el, html`
    <div class="tabs"><a class="tab on" href="#/draw">Mula Cabutan</a><a class="tab" href="#/prizes">Urus Hadiah</a></div>
    <div class="grid-2 draw-grid">
      <section class="card">
        <div class="card-head"><h3>Konfigurasi cabutan</h3></div>
        <div class="form-grid">
          <label class="field span-2"><span>Kategori hadiah</span>
            <select id="d-prize">
              ${open.map((x) => html`<option value="${x.prize.id}" ${x.prize.id === st.prizeId ? 'selected' : ''}>#${x.prize.sequence} ${x.prize.category} — ${x.prize.name} (baki ${x.remaining})</option>`)}
              <option value="" ${!st.prizeId ? 'selected' : ''}>Cabutan khas (tanpa kategori hadiah)</option>
            </select>
          </label>
          <label class="field"><span>Bilangan pemenang</span><input type="number" id="d-count" min="1" value="${Math.max(1, maxFor())}"></label>
          <div class="field"><span>Peserta layak</span><div class="big-num">${fmtNum(pool.length)} 🦆</div></div>
          <fieldset class="field span-2 radio-cards"><legend>Mod pendedahan pemenang</legend>
            <label class="rc"><input type="radio" name="rv" value="one" ${st.reveal === 'one' ? 'checked' : ''}><b>A · Satu demi satu</b><small>Setiap pemenang diumumkan dengan jeda dramatik.</small></label>
            <label class="rc"><input type="radio" name="rv" value="finale" ${st.reveal === 'finale' ? 'checked' : ''}><b>B · Grand Finale</b><small>Semua pemenang didedahkan serentak selepas perlumbaan.</small></label>
          </fieldset>
        </div>
        <div id="d-warn"></div>
        <button class="btn btn-red btn-lg btn-block" id="d-open" ${pool.length ? '' : 'disabled'}>${icon('play')} MULA CABUTAN — buka pentas perlumbaan</button>
        <p class="tiny muted">Pemenang dipilih secara rawak kriptografi (Web Crypto) sebaik anda menekan <b>MULA</b> pada pentas, disimpan serta-merta,
          dan dibuang daripada kumpulan layak${settings.allowMultipleWins ? html` — <b>KECUALI</b>: tetapan "benarkan menang berulang" sedang AKTIF` : ''}. Animasi hanya memaparkan keputusan tersebut.</p>
      </section>
      <section class="card">
        <div class="card-head"><h3>Senarai semak majlis</h3></div>
        <ul class="checklist">
          <li class="${pool.length ? 'ok' : ''}">Peserta diimport (${fmtNum(pool.length)} layak)</li>
          <li class="${ps.length ? 'ok' : ''}">Hadiah ditetapkan (${ps.length} kategori)</li>
          <li class="${settings.soundEnabled ? 'ok' : ''}">Bunyi ${settings.soundEnabled ? 'dihidupkan' : 'dimatikan'} — <a href="#/settings">ubah</a></li>
          <li class="ok">Mod paparan: ${settings.renderMode === '2d' ? '2D' : '3D'} · kualiti ${settings.quality === 'low' ? 'rendah' : 'tinggi'}</li>
          <li class="ok">Tempoh perlumbaan ±${settings.raceDuration}s</li>
        </ul>
        <p class="tiny muted">Pintasan pada pentas: <kbd>Space</kbd> mula / seterusnya · <kbd>F</kbd> skrin penuh · <kbd>M</kbd> bunyi · <kbd>Esc</kbd> tutup.</p>
      </section>
    </div>`);

  const warn = () => {
    const n = parseInt($('#d-count').value, 10);
    const max = maxFor();
    let msg = '';
    if (!pool.length) msg = 'Tiada peserta layak. Import peserta atau pulihkan pemenang.';
    else if (!Number.isInteger(n) || n < 1) msg = 'Bilangan pemenang mesti sekurang-kurangnya 1.';
    else if (n > max) msg = 'Maksimum ' + max + (cur() ? ' (baki hadiah / peserta layak).' : ' (peserta layak).');
    mount($('#d-warn'), msg ? html`<div class="alert alert-err">${msg}</div>` : '');
    $('#d-open').disabled = !!msg;
    return !msg;
  };
  warn();

  el.addEventListener('change', (e) => {
    if (e.target.id === 'd-prize') { st.prizeId = e.target.value; $('#d-count').value = Math.max(1, maxFor()); }
    if (e.target.name === 'rv') st.reveal = e.target.value;
    warn();
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'd-count') warn(); });
  $('#d-open').addEventListener('click', async () => {
    if (!warn()) return;
    try {
      const fresh = await store.eligiblePool();
      const c = cur();
      const drew = await openStage({ pool: fresh, prize: c ? c.prize : null, count: parseInt($('#d-count').value, 10), revealMode: st.reveal });
      if (drew) ctx.go('history'); else ctx.refreshStats();
    } catch (e) { toast(errMsg(e), 'error', 6000); }
  });
}
