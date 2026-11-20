/**
 * race.js — Pengawal pentas perlumbaan (skrin penuh): pra-perlumbaan → kiraan detik → perlumbaan →
 * pemenang melintas → pengumuman (satu demi satu / grand finale).
 *
 * KEADILAN: pemenang dipilih oleh store.executeDraw() (crypto, dalam transaksi) SEBAIK SAHAJA admin
 * menekan MULA dan SEBELUM kiraan detik. Animasi kemudian dijana untuk MEMAPARKAN keputusan itu.
 */
import { html, esc, mount, toast, errMsg, confirmDialog, fmtNum } from './util.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { planRace } from './logic.js';
import { Fx } from './fx.js';
import { Race2D } from './race2d.js';
import { icon } from './icons.js';

let Race3DClass = null;
async function rendererFor(mode, host, count, quality) {
  if (mode !== '2d') {
    try {
      if (!Race3DClass) Race3DClass = (await import('./race3d.js')).Race3D;
      if (Race3DClass.supported()) return new Race3DClass(host, { count, quality });
    } catch (e) {
      console.warn('3D tidak tersedia, guna 2D', e);
      host.innerHTML = '';
    }
  }
  return new Race2D(host, { count, quality });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {Array} o.pool peserta layak (pratonton)
 * @param {object|null} o.prize hadiah (null = cabutan khas)
 * @param {number} o.count bilangan pemenang
 * @param {'one'|'finale'} o.revealMode
 * @param {{draw, winners, pool}=} o.replay main semula cabutan sedia ada
 * @returns {Promise<boolean>} selesai apabila pentas ditutup (true jika cabutan berlaku)
 */
export async function openStage(o) {
  const st = await store.getSettings();
  sfx.configure(st);
  const root = document.getElementById('stage');
  const replay = o.replay || null;
  const prizeLabel = replay ? replay.draw.prizeName : (o.prize ? o.prize.name : 'Cabutan Khas');
  const prizeCat = replay ? replay.draw.prizeCategory : (o.prize ? o.prize.category : 'Special Draw');
  const count = replay ? replay.winners.length : o.count;
  let pool = replay ? replay.pool : o.pool;
  const revealMode = (replay ? replay.draw.revealMode : o.revealMode) || 'one';

  mount(root, html`
    <div class="stage-render" id="stg-render"></div>
    <canvas class="stage-fx" id="stg-fx"></canvas>
    <div class="stage-labels" id="stg-labels" aria-hidden="true"></div>
    <header class="stage-top">
      <div class="stage-title">
        <img class="st-logo" src="icons/logo.svg" alt="Lucky Duck Race">
        <div class="st-ribbon">CABUTAN BERTUAH</div>
        ${st.eventName ? html`<div class="brand-event">${st.eventName}</div>` : ''}
      </div>
    </header>
    <aside class="leaderboard" id="stg-lead" hidden>
      <div class="lb-title">PENDAHULU</div><ol id="stg-lead-list"></ol>
    </aside>
    <div class="countdown" id="stg-count" aria-live="assertive"></div>
    <div class="stage-hint" id="stg-hint">
      ${replay ? html`<b>MAIN SEMULA</b> · Keputusan cabutan ${replay.draw.id} (tiada pemilihan baharu)` : html`Semua itik di garisan permulaan. Pemenang dipilih secara rawak (kriptografi) sebaik <b>MULA CABUTAN</b> ditekan.`}
    </div>
    <div class="finish-strip" id="stg-strip"></div>
    <div class="hud">
      <div class="hud-cell">${icon('users')}<div><span>Peserta Aktif</span><b>${fmtNum(pool.length)}</b></div></div>
      <div class="hud-cell">${icon('trophy')}<div><span>Bil. Pemenang</span><b>${fmtNum(count)}</b></div></div>
      <div class="hud-cell hud-prize"><div><span>Kategori Hadiah</span><b>${prizeCat}${prizeLabel !== prizeCat ? ' — ' + prizeLabel : ''}</b></div></div>
      <button class="hud-go" id="stg-start">${icon('play')} MULA CABUTAN</button>
      <div class="hud-tools">
        <button class="sbtn" id="stg-fs" title="Skrin penuh (F)">${icon('expand')}</button>
        <button class="sbtn" id="stg-snd" title="Bunyi (M)">${icon(st.soundEnabled ? 'sound' : 'mute')}</button>
        <button class="sbtn" id="stg-close" title="Tutup (Esc)">${icon('x')}</button>
      </div>
    </div>
    <div class="announce" id="stg-ann" hidden></div>
    <div class="integrity" id="stg-int"></div>
  `);
  root.hidden = false;
  document.body.classList.add('stage-open');

  const renderHost = root.querySelector('#stg-render');
  const fx = new Fx(root.querySelector('#stg-fx'));
  let r = await rendererFor(st.renderMode, renderHost, pool.length, st.quality);

  const state = { phase: 'intro', t: 0, plan: null, winners: [], winIdx: [], crossed: 0, draw: null, closed: false, busy: false };
  let last = performance.now();
  let lbTimer = 0;
  let raf = 0;
  const labelsEl = root.querySelector('#stg-labels');
  const leadList = root.querySelector('#stg-lead-list');

  const loop = (now) => {
    if (state.closed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.phase === 'race') {
      // Masa perlumbaan ikut jam sebenar → tamat tepat pada masanya walaupun FPS rendah
      state.t = Math.max(state.t, (now - state.raceStart) / 1000);
      // Pemenang melintasi garisan mengikut susunan pelan
      while (state.crossed < state.winIdx.length && state.t >= state.plan.ducks[state.winIdx[state.crossed]].finish) {
        const d = state.winIdx[state.crossed];
        state.crossed++;
        r.markWinner(d, state.crossed);
        onCross(d, state.crossed);
      }
      if (state.t >= state.plan.endTime) finishRace();
    }
    r.frame(dt, state.t);
    lbTimer += dt;
    if (lbTimer > 0.25 && state.phase === 'race') { lbTimer = 0; updateLeaderboard(); }
    updateLabels();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  function updateLeaderboard() {
    const lead = r.leaders(5);
    leadList.innerHTML = String(html`${lead.map((d) => html`<li><span class="lb-duck">🦆 ${pool[d].duckNo}</span></li>`)}`);
  }

  function updateLabels() {
    const show = [];
    if (state.phase === 'race') r.leaders(3).forEach((d) => show.push([d, false]));
    state.winIdx.slice(0, state.crossed).slice(-12).forEach((d) => show.push([d, true]));
    const seen = new Set();
    let out = '';
    for (const [d, win] of show) {
      if (seen.has(d)) continue; seen.add(d);
      const p = r.screenPos(d);
      if (!p) continue;
      out += '<div class="dl ' + (win ? 'dl-win' : '') + '" style="transform:translate(' + p.x.toFixed(0) + 'px,' + p.y.toFixed(0) + 'px)">' +
        (win ? '👑 ' : '') + '#' + esc(pool[d].duckNo) + '</div>';
    }
    labelsEl.innerHTML = out;
  }

  function onCross(d, rank) {
    const strip = root.querySelector('#stg-strip');
    const chip = document.createElement('div');
    chip.className = 'fs-chip';
    chip.textContent = '#' + rank + ' · 🦆 ' + pool[d].duckNo;
    strip.appendChild(chip);
    if (rank === 1) { sfx.victory(); fx.confetti(120, 0.7); }
    else sfx.quack();
  }

  async function start() {
    if (state.busy || state.phase !== 'intro') return;
    state.busy = true;
    sfx.unlock();
    const btn = root.querySelector('#stg-start');
    btn.disabled = true;
    try {
      let result = replay;
      if (!replay) {
        result = await store.executeDraw({ prizeId: o.prize ? o.prize.id : '', count: o.count, revealMode });
        toast('Pemenang telah dipilih & disimpan. Perlumbaan bermula!', 'success');
      }
      state.draw = result.draw;
      state.winners = result.winners;
      // Pastikan susunan itik = kumpulan sebenar ketika cabutan
      const samePool = result.pool.length === pool.length && result.pool.every((p, i) => p.staffId === pool[i].staffId);
      if (!samePool) {
        pool = result.pool;
        r.dispose();
        r = await rendererFor(st.renderMode, renderHost, pool.length, st.quality);
      }
      const at = new Map(pool.map((p, i) => [p.staffId, i]));
      state.winIdx = result.winners.map((w) => at.get(w.staffId));
      state.plan = planRace(pool.length, state.winIdx, { duration: st.raceDuration });
      r.setPlan(state.plan);
      if (st.highlightDuringRace) state.winIdx.forEach((d) => r.highlight(d));
      root.querySelector('#stg-int').textContent = 'Cabutan ' + result.draw.id + ' · Kod integriti ' + (result.draw.integrity || '').slice(0, 16) + '…';
      root.querySelector('#stg-hint').hidden = true;
      btn.hidden = true;
      await countdown();
      if (state.closed) return;
      state.raceStart = performance.now();
      state.phase = 'race';
      r.setPhase('race');
      root.querySelector('#stg-lead').hidden = false;
      sfx.horn(); sfx.startMusic(); sfx.startRunning();
    } catch (e) {
      toast(errMsg(e), 'error', 6000);
      btn.disabled = false;
    } finally { state.busy = false; }
  }

  async function countdown() {
    state.phase = 'countdown';
    r.setPhase('countdown');
    const el = root.querySelector('#stg-count');
    for (const n of ['3', '2', '1']) {
      if (state.closed) return;
      el.innerHTML = '<span class="cd-num">' + n + '</span>';
      sfx.countdownBeep();
      await sleep(1000);
    }
    el.innerHTML = '<span class="cd-num cd-go">GO!</span>';
    setTimeout(() => { el.innerHTML = ''; }, 900);
  }

  async function finishRace() {
    state.phase = 'done';
    r.setPhase('done');
    sfx.stopRunning(); sfx.stopMusic();
    sfx.applause(3);
    root.querySelector('#stg-lead').hidden = true;
    await sleep(1200);
    if (state.closed) return;
    if (revealMode === 'one') await revealOneByOne();
    await showGallery();
  }

  function waitNext(btnSel) {
    return new Promise((resolve) => {
      const ann = root.querySelector('#stg-ann');
      const b = ann.querySelector(btnSel);
      const go = () => { document.removeEventListener('keydown', onKey, true); resolve(); };
      const onKey = (e) => {
        if (['Space', 'Enter', 'ArrowRight', 'PageDown'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); go(); }
      };
      document.addEventListener('keydown', onKey, true);
      if (b) b.addEventListener('click', go, { once: true });
      state.nextResolver = go;
    });
  }

  const ribbon = (sub) => html`
    <div class="tahniah">
      <div class="th-trophy" aria-hidden="true">🏆</div>
      <div class="th-ribbon"><span>TAHNIAH!</span></div>
      <div class="th-sub">${sub}</div>
    </div>`;

  function winnerCard(w) {
    return html`
      <div class="win-card win-card-big">
        <div class="wc-no">PEMENANG #${w.winnerNo} · ${w.prizeName === w.prizeCategory ? w.prizeCategory : w.prizeCategory + ' — ' + w.prizeName} #${w.prizeNumber}</div>
        <div class="wc-name">${w.name}</div>
        <div class="wc-meta"><span>No. Pekerja: <b>${w.staffId}</b></span><span>${w.department || '—'}</span></div>
        <div class="wc-duck">🦆 Itik #${w.duckNo}</div>
      </div>`;
  }

  function winnerTable(list) {
    const per = list.length > 24 ? Math.ceil(list.length / 3) : list.length > 10 ? Math.ceil(list.length / 2) : list.length;
    const cols = [];
    for (let i = 0; i < list.length; i += per) cols.push(list.slice(i, i + per));
    return html`<div class="wt-wrap wt-c${cols.length}">${cols.map((c, ci) => html`
      <table class="win-table">
        <thead><tr><th>Bil.</th><th>No. Pekerja</th><th>Nama</th><th>Jabatan</th></tr></thead>
        <tbody>${c.map((w, i) => html`<tr><td><span class="wt-no">${ci * per + i + 1}</span></td><td class="mono">${w.staffId}</td><td class="wt-name">${w.name}</td><td>${w.department || '—'}</td></tr>`)}</tbody>
      </table>`)}</div>`;
  }

  async function revealOneByOne() {
    const ann = root.querySelector('#stg-ann');
    const list = state.winners;
    for (let i = 0; i < list.length; i++) {
      if (state.closed) return;
      const w = list[i];
      r.focus(state.winIdx[i]);
      ann.hidden = false;
      ann.className = 'announce ann-suspense';
      mount(ann, html`<div class="suspense"><div class="sus-label">${w.prizeCategory}</div><div class="sus-num">Pemenang ${i + 1} / ${list.length}</div><div class="sus-duck">🦆 #${w.duckNo}</div><div class="sus-dots"><span></span><span></span><span></span></div></div>`);
      sfx.drumroll(1.5);
      await sleep(1700);
      if (state.closed) return;
      ann.className = 'announce ann-reveal';
      mount(ann, html`
        ${ribbon('PEMENANG CABUTAN BERTUAH')}
        ${winnerCard(w)}
        <button class="hud-go ann-next" id="ann-next">${i < list.length - 1 ? 'Pemenang seterusnya ▶' : 'Lihat semua pemenang ▶'}</button>`);
      sfx.victory(); sfx.firework(); sfx.applause(2.5);
      fx.confetti(200); fx.firework(0.2); setTimeout(() => fx.firework(0.8), 350); setTimeout(() => fx.firework(0.5, 0.12), 700);
      await waitNext('#ann-next');
    }
  }

  async function showGallery() {
    if (state.closed) return;
    const ann = root.querySelector('#stg-ann');
    ann.hidden = false;
    const n = state.winners.length;
    ann.className = 'announce ann-gallery' + (n > 10 ? ' g-many' : '');
    mount(ann, html`
      ${ribbon('PEMENANG CABUTAN BERTUAH')}
      <div class="gallery-prize">${prizeCat}${prizeLabel !== prizeCat ? ' — ' + prizeLabel : ''}</div>
      ${winnerTable(state.winners)}
      <div class="ann-actions"><button class="hud-go" id="ann-done">${icon('check')} Selesai</button></div>`);
    sfx.victory(); sfx.applause(4);
    fx.confetti(320);
    for (let i = 0; i < 6; i++) setTimeout(() => { fx.firework(); sfx.firework(); }, i * 450);
    if (state.draw) await store.markDrawRevealed(state.draw.id);
    ann.querySelector('#ann-done').addEventListener('click', () => close(true));
  }

  let resolveClose;
  const closed = new Promise((res) => { resolveClose = res; });

  async function close(force = false) {
    if (state.closed) return;
    if (!force && (state.phase === 'countdown' || state.phase === 'race')) {
      const ok = await confirmDialog('Tutup perlumbaan?', 'Pemenang SUDAH dipilih dan disimpan. Menutup sekarang hanya menghentikan animasi; anda boleh main semula daripada Sejarah Pemenang.', { okLabel: 'Tutup' });
      if (!ok) return;
    }
    state.closed = true;
    cancelAnimationFrame(raf);
    sfx.stopAll();
    document.removeEventListener('keydown', onKey);
    if (state.nextResolver) state.nextResolver();
    fx.destroy();
    r.dispose();
    root.innerHTML = '';
    root.hidden = true;
    document.body.classList.remove('stage-open');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    resolveClose(!!state.draw);
  }

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.requestFullscreen && root.requestFullscreen().catch(() => toast('Skrin penuh tidak dibenarkan oleh pelayar.', 'error'));
  }

  async function toggleSound() {
    const cur = await store.getSettings();
    const next = await store.saveSettings({ soundEnabled: !cur.soundEnabled });
    sfx.configure(next);
    mount(root.querySelector('#stg-snd'), icon(next.soundEnabled ? 'sound' : 'mute'));
    if (next.soundEnabled) { sfx.unlock(); if (state.phase === 'race') { sfx.startMusic(); sfx.startRunning(); } }
    toast(next.soundEnabled ? 'Bunyi dihidupkan' : 'Bunyi dimatikan');
  }

  function onKey(e) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (document.querySelector('.modal-back')) return;
    if (e.code === 'Space' && state.phase === 'intro') { e.preventDefault(); start(); }
    else if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'm' || e.key === 'M') toggleSound();
    else if (e.key === 'Escape' && !document.fullscreenElement) close();
  }
  document.addEventListener('keydown', onKey);
  root.querySelector('#stg-start').addEventListener('click', start);
  root.querySelector('#stg-fs').addEventListener('click', toggleFs);
  root.querySelector('#stg-snd').addEventListener('click', toggleSound);
  root.querySelector('#stg-close').addEventListener('click', () => close());

  return closed;
}
