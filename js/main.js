/**
 * main.js — Kerangka aplikasi: Paparan Utama (awam), log masuk, panel admin (hash router).
 */
import { html, mount, toast, errMsg, $, fmtNum } from './util.js';
import { icon } from './icons.js';
import * as auth from './auth.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { openDb } from './db.js';
import * as att from './attendance.js';

/* nav: dipapar di sidebar. Laluan tanpa nav = alias / halaman dalaman. */
const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', title: 'Dashboard Acara', nav: true, load: () => import('./views/dashboard.js') },
  { id: 'staff', label: 'Data Staf', icon: 'idcard', title: 'Data Staf', nav: true, load: () => import('./views/import.js') },
  { id: 'attendance', label: 'Pendaftaran Kehadiran', icon: 'calcheck', title: 'Pendaftaran Kehadiran', nav: true, load: () => import('./views/attendance.js') },
  { id: 'participants', label: 'Peserta Cabutan', icon: 'users', title: 'Peserta Cabutan', nav: true, load: () => import('./views/participants.js') },
  { id: 'draw', label: 'Cabutan Bertuah', icon: 'trophy', title: 'Cabutan Bertuah', nav: true, load: () => import('./views/draw.js') },
  { id: 'history', label: 'Rekod Pemenang', icon: 'medal', title: 'Rekod Pemenang', nav: true, load: () => import('./views/history.js') },
  { id: 'reports', label: 'Laporan & Eksport', icon: 'report', title: 'Laporan & Eksport', nav: true, load: () => import('./views/reports.js') },
  { id: 'settings', label: 'Tetapan Sistem', icon: 'settings', title: 'Tetapan Sistem', nav: true, load: () => import('./views/settings.js') },
  { id: 'import', label: 'Data Staf', icon: 'idcard', title: 'Data Staf', navAs: 'staff', load: () => import('./views/import.js') },
  { id: 'prizes', label: 'Hadiah', icon: 'gift', title: 'Urus Hadiah', navAs: 'draw', load: () => import('./views/prizes.js') },
  { id: 'audit', label: 'Log Audit', icon: 'list', title: 'Log Audit', navAs: 'reports', load: () => import('./views/audit.js') },
];

const app = document.getElementById('app');
let pendingRoute = '';

const ctx = {
  go(r) { if (location.hash === '#/' + r) route(); else location.hash = '#/' + r; },
  reload() { return route(); },
  async refreshStats() {
    const s = await store.stats();
    const box = $('#topstats');
    if (!box) return s;
    mount(box, html`
      <div class="ts"><span>Peserta</span><b>${fmtNum(s.total)}</b></div>
      <div class="ts ts-ok"><span>Layak</span><b>${fmtNum(s.eligible)}</b></div>
      <div class="ts ts-gold"><span>Pemenang</span><b>${fmtNum(s.winners)}</b></div>`);
    return s;
  },
};

const routeId = () => (location.hash.replace(/^#\/?/, '') || '').split('?')[0];

// ----------------------------------------------------------------------------- Paparan Utama (awam)

async function showHome() {
  document.title = 'Lucky Duck Race — Sistem Pendaftaran Kehadiran & Cabutan Bertuah';
  const s = await store.getSettings();
  const tiles = [
    ['dashboard', 'monitor', 'Dashboard Pentadbir'], ['staff', 'idcard', 'Data Staf'], ['attendance', 'calcheck', 'Kehadiran'],
    ['participants', 'users', 'Peserta Cabutan'], ['history', 'trophy', 'Pemenang'], ['settings', 'settings', 'Tetapan'],
  ];
  mount(app, html`
    <div class="home">
      <div class="home-stage" aria-hidden="true"><i></i><i></i><i></i></div>
      <header class="home-hero">
        <img class="home-mascot" src="icons/mascot.svg" alt="">
        <div class="home-brand">
          <img class="home-logo" src="icons/logo.svg" alt="Lucky Duck Race">
          <div class="home-tag">Sistem Pendaftaran Kehadiran &amp; Cabutan Bertuah</div>
          ${s.eventName ? html`<div class="home-event">${s.eventName}</div>` : ''}
        </div>
      </header>
      <div class="home-ctas">
        <button class="home-cta cta-blue" data-go="checkin">
          <span class="cta-ic">${icon('scan')}</span>
          <span class="cta-t"><b>Pendaftaran Kehadiran Staf</b><small>(Imbas Kod QR)</small></span>
          <span class="cta-arr">${icon('arrow')}</span>
        </button>
        <button class="home-cta cta-gold" data-go="draw">
          <span class="cta-ic cta-trophy">🏆</span>
          <span class="cta-t"><b>Cabutan Bertuah</b><small>(Lucky Draw)</small></span>
          <span class="cta-arr">${icon('arrow')}</span>
        </button>
      </div>
      <nav class="home-nav" aria-label="Menu pentadbir">
        ${tiles.map(([r, ic, l]) => html`<button data-go="${r}">${icon(ic)}<span>${l}</span></button>`)}
      </nav>
    </div>`);
  app.querySelector('.home').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const r = b.dataset.go;
    if (r === 'checkin') {
      const cfg = await att.getConfig();
      if (cfg) { const { showQrFullscreen } = await import('./views/attendance.js'); return showQrFullscreen(cfg, att.checkinUrl(cfg)); }
      toast('Pendaftaran kehadiran belum disediakan. Sila log masuk sebagai pentadbir untuk menyediakannya.');
      return requireLogin('attendance');
    }
    requireLogin(r);
  });
}

function requireLogin(r) {
  if (auth.isLoggedIn()) return ctx.go(r);
  pendingRoute = r;
  showAuth();
}

// ----------------------------------------------------------------------------- Log masuk

async function showAuth() {
  const first = !(await auth.hasAdmin());
  mount(app, html`
    <div class="auth-wrap">
      <form class="auth-card" id="auth-form" autocomplete="off">
        <img class="auth-logo" src="icons/logo.svg" alt="Lucky Duck Race">
        <img class="auth-mascot" src="icons/mascot.svg" alt="">
        <h2>${first ? 'Sediakan akaun pentadbir' : 'Log Masuk Panel Pentadbir'}</h2>
        <p class="muted">${first ? 'Tetapkan kata laluan pentadbir untuk komputer ini (sekurang-kurangnya 8 aksara, mengandungi huruf dan nombor).' : 'Masukkan kata laluan pentadbir.'}</p>
        <label class="field field-ic"><span>Kata laluan</span>${icon('lock')}<input type="password" id="pw1" required minlength="8" autocomplete="${first ? 'new-password' : 'current-password'}"></label>
        ${first ? html`<label class="field field-ic"><span>Sahkan kata laluan</span>${icon('lock')}<input type="password" id="pw2" required minlength="8" autocomplete="new-password"></label>` : ''}
        <button class="btn btn-purple btn-lg btn-block" type="submit">${first ? 'Simpan & masuk' : 'Masuk'}</button>
        <a href="#/home" class="auth-back" id="auth-back">← Kembali ke Paparan Utama</a>
      </form>
    </div>`);
  $('#pw1').focus();
  $('#auth-back').addEventListener('click', (e) => { e.preventDefault(); pendingRoute = ''; if (location.hash === '#/home') showHome(); else location.hash = '#/home'; });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const pw = $('#pw1').value;
      if (first) {
        if (pw !== $('#pw2').value) throw new Error('Kata laluan tidak sepadan.');
        await auth.setPassword(pw);
        await store.audit('PENTADBIR_DICIPTA', '');
      } else await auth.login(pw);
      const r = pendingRoute || (routeId() && routeId() !== 'home' ? routeId() : 'dashboard');
      pendingRoute = '';
      await start();
      ctx.go(r);
    } catch (err) {
      toast(errMsg(err), 'error');
      btn.disabled = false;
    }
  });
}

// ----------------------------------------------------------------------------- Shell admin

function shell() {
  mount(app, html`
    <div class="shell">
      <aside class="side" id="side">
        <a class="side-brand" href="#/home" title="Paparan Utama"><img src="icons/logo.svg" alt="Lucky Duck Race"><small>Panel Pentadbir</small></a>
        <nav class="side-nav" aria-label="Navigasi utama">
          ${ROUTES.filter((r) => r.nav).map((r) => html`<a href="#/${r.id}" data-r="${r.id}">${icon(r.icon)}<span>${r.label}</span></a>`)}
        </nav>
        <div class="side-foot">
          <div class="tiny" id="net-status"></div>
          <button class="side-logout" id="btn-lock">${icon('logout')}<span>Log Keluar</span></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn only-mobile" id="btn-menu" aria-label="Menu">${icon('menu')}</button>
          <h1 id="page-title">Dashboard</h1>
          <div class="topstats" id="topstats"></div>
        </header>
        <main class="content" id="view" tabindex="-1"></main>
      </div>
    </div>`);
  $('#btn-lock').addEventListener('click', () => { att.stopAutoSync(); auth.logout(); store.audit('LOG_KELUAR', ''); location.hash = '#/home'; });
  $('#btn-menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  const net = () => { const el = $('#net-status'); if (el) el.textContent = navigator.onLine ? '● Dalam talian' : '● Luar talian (data setempat)'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

let syncHooked = false;
let renderSeq = 0;
async function route() {
  const id = routeId();
  if (id === 'home' || (!id && !auth.isLoggedIn())) return showHome();
  if (!auth.isLoggedIn()) { pendingRoute = id; return showAuth(); }
  if (!$('#view')) shell();
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  const navId = r.navAs || r.id;
  document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === navId));
  $('#side').classList.remove('open');
  $('#page-title').textContent = r.title;
  document.title = r.title + ' · Lucky Duck Race';
  // Elemen baharu setiap paparan → pendengar acara lama tidak bertindih
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  const seq = ++renderSeq;
  view.innerHTML = '<div class="loading">Memuatkan…</div>';
  try {
    const mod = await r.load();
    if (seq !== renderSeq) return;
    await mod.render(view, ctx);
    view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    mount(view, html`<div class="empty"><h3>Ralat</h3><p>${errMsg(e)}</p></div>`);
  }
  ctx.refreshStats().catch(() => {});
}

async function start() {
  sfx.configure(await store.getSettings());
  if (!syncHooked) { syncHooked = true; att.onSync((res) => { if (res.added.length || res.removed) ctx.refreshStats().catch(() => {}); }); }
  if (await att.getConfig()) att.startAutoSync();
}

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    await openDb();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
      // Versi baharu dideploy → muat semula sekali supaya tiada campuran fail lama/baharu (kecuali semasa perlumbaan)
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded || document.body.classList.contains('stage-open')) return;
        reloaded = true;
        location.reload();
      });
    }
    if (auth.isLoggedIn()) await start();
    route();
  } catch (e) {
    mount(app, html`<div class="empty"><h3>Aplikasi tidak dapat dimulakan</h3><p>${errMsg(e)}</p><p class="muted">Pastikan pelayar moden (Chrome/Edge/Firefox/Safari) dan mod peribadi (incognito) tidak menyekat storan.</p></div>`);
  }
})();
