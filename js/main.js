/**
 * main.js — Kerangka aplikasi: log masuk, navigasi (hash router), statistik langsung.
 */
import { html, mount, toast, errMsg, $, fmtNum } from './util.js';
import * as auth from './auth.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { openDb } from './db.js';

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: '◧', load: () => import('./views/dashboard.js') },
  { id: 'participants', label: 'Peserta', icon: '👥', load: () => import('./views/participants.js') },
  { id: 'import', label: 'Import Excel', icon: '⇪', load: () => import('./views/import.js') },
  { id: 'prizes', label: 'Hadiah', icon: '🎁', load: () => import('./views/prizes.js') },
  { id: 'draw', label: 'Mula Perlumbaan', icon: '🏁', load: () => import('./views/draw.js'), cta: true },
  { id: 'history', label: 'Sejarah Pemenang', icon: '🏆', load: () => import('./views/history.js') },
  { id: 'audit', label: 'Log Audit', icon: '🧾', load: () => import('./views/audit.js') },
  { id: 'settings', label: 'Tetapan', icon: '⚙', load: () => import('./views/settings.js') },
];

const app = document.getElementById('app');

const ctx = {
  go(route) { location.hash = '#/' + route; },
  async refreshStats() {
    const s = await store.stats();
    const box = $('#topstats');
    if (!box) return s;
    mount(box, html`
      <div class="ts"><span>Peserta</span><b>${fmtNum(s.total)}</b></div>
      <div class="ts ts-ok"><span>Layak</span><b>${fmtNum(s.eligible)}</b></div>
      <div class="ts ts-gold"><span>Pemenang</span><b>${fmtNum(s.winners)}</b></div>
      <div class="ts"><span>Baki hadiah</span><b>${fmtNum(s.prizesRemaining)}</b></div>`);
    return s;
  },
};

// ----------------------------------------------------------------------------- Auth

async function showAuth() {
  const first = !(await auth.hasAdmin());
  mount(app, html`
    <div class="auth-wrap">
      <div class="auth-hero">
        <div class="auth-duck">🦆</div>
        <h1>LUCKY DUCK RACE</h1>
        <p>LET THE LUCK RACE BEGIN!</p>
      </div>
      <form class="auth-card" id="auth-form" autocomplete="off">
        <h2>${first ? 'Sediakan akaun pentadbir' : 'Log masuk pentadbir'}</h2>
        <p class="muted">${first ? 'Tetapkan kata laluan pentadbir untuk komputer ini (min. 8 aksara, huruf & nombor).' : 'Masukkan kata laluan pentadbir.'}</p>
        <label class="field"><span>Kata laluan</span><input type="password" id="pw1" required minlength="8" autocomplete="${first ? 'new-password' : 'current-password'}"></label>
        ${first ? html`<label class="field"><span>Sahkan kata laluan</span><input type="password" id="pw2" required minlength="8" autocomplete="new-password"></label>` : ''}
        <button class="btn btn-primary btn-block" type="submit">${first ? 'Simpan & masuk' : 'Masuk'}</button>
        <p class="tiny muted">Data disimpan setempat dalam pelayar ini (IndexedDB) dan berfungsi tanpa internet.</p>
      </form>
    </div>`);
  $('#pw1').focus();
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
      start();
    } catch (err) {
      toast(errMsg(err), 'error');
      btn.disabled = false;
    }
  });
}

// ----------------------------------------------------------------------------- Shell

function shell() {
  mount(app, html`
    <div class="shell">
      <aside class="side" id="side">
        <div class="side-brand"><span class="sb-duck">🦆</span><div><b>Lucky Duck Race</b><small>Panel Pentadbir</small></div></div>
        <nav class="side-nav" aria-label="Navigasi utama">
          ${ROUTES.map((r) => html`<a href="#/${r.id}" data-r="${r.id}" class="${r.cta ? 'nav-cta' : ''}"><span class="ni" aria-hidden="true">${r.icon}</span>${r.label}</a>`)}
        </nav>
        <div class="side-foot">
          <button class="btn btn-ghost btn-sm btn-block" id="btn-lock">🔒 Kunci</button>
          <div class="tiny muted" id="net-status"></div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn only-mobile" id="btn-menu" aria-label="Menu">☰</button>
          <h1 id="page-title">Dashboard</h1>
          <div class="topstats" id="topstats"></div>
        </header>
        <main class="content" id="view" tabindex="-1"></main>
      </div>
    </div>`);
  $('#btn-lock').addEventListener('click', () => { auth.logout(); store.audit('LOG_KELUAR', ''); showAuth(); });
  $('#btn-menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  const net = () => { const el = $('#net-status'); if (el) el.textContent = navigator.onLine ? '● Dalam talian' : '● Luar talian (data setempat)'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

let renderSeq = 0;
async function route() {
  if (!auth.isLoggedIn()) return showAuth();
  if (!$('#view')) shell();
  const id = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r.id));
  $('#side').classList.remove('open');
  $('#page-title').textContent = r.label;
  document.title = r.label + ' · Lucky Duck Race';
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
  route();
}

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    await openDb();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    }
    if (auth.isLoggedIn()) start(); else showAuth();
  } catch (e) {
    mount(app, html`<div class="empty"><h3>Aplikasi tidak dapat dimulakan</h3><p>${errMsg(e)}</p><p class="muted">Pastikan pelayar moden (Chrome/Edge/Firefox/Safari) dan mod peribadi (incognito) tidak menyekat storan.</p></div>`);
  }
})();
