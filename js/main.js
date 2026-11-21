/**
 * main.js — Kerangka aplikasi: Paparan Utama (awam), log masuk, panel admin (hash router).
 */
import { html, mount, toast, errMsg, $, fmtNum } from './util.js';
import { icon } from './icons.js';
import { concertBg } from './theme.js';
import * as auth from './auth.js';
import * as store from './store.js';
import * as sfx from './audio.js';
import { openDb } from './db.js';
import * as att from './attendance.js';
import * as sync from './sync.js';

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
  document.title = "Rock The Draw — Let's Rock. Let's Win!";
  const s = await store.getSettings();
  const tiles = [
    ['dashboard', 'monitor', 'Dashboard Pentadbir'], ['staff', 'idcard', 'Data Staf'], ['attendance', 'calcheck', 'Kehadiran'],
    ['participants', 'users', 'Peserta Cabutan'], ['history', 'trophy', 'Pemenang'], ['settings', 'settings', 'Tetapan'],
  ];
  mount(app, html`
    <div class="home">
      ${concertBg()}
      <header class="home-hero">
        <div class="home-poster"><img src="icons/rockstar-duck.webp" alt="Maskot rasmi Rockstar Duck"></div>
        <div class="home-brand">
          <img class="home-logo" src="icons/logo.svg" alt="Rock The Draw">
          <div class="home-slogan">LET'S ROCK. LET'S WIN!</div>
          <div class="home-tag">Sistem Pendaftaran Kehadiran &amp; Cabutan Bertuah</div>
          ${s.eventName ? html`<div class="home-event">${icon('flag')} ${s.eventName}</div>` : ''}
        </div>
      </header>
      <div class="home-ctas">
        <button class="home-cta cta-purple" data-go="checkin">
          <span class="cta-ic">${icon('scan')}</span>
          <span class="cta-t"><b>Pendaftaran Kehadiran Staf</b><small>(Imbas Kod QR)</small></span>
          <span class="cta-arr">${icon('arrow')}</span>
        </button>
        <button class="home-cta cta-red" data-go="draw">
          <span class="cta-ic cta-trophy">🤘</span>
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

async function showAuth(mode = 'login') {
  const signup = mode === 'signup';
  mount(app, html`
    <div class="auth-wrap">
      ${concertBg()}
      <form class="auth-card" id="auth-form" autocomplete="on">
        <img class="auth-logo" src="icons/logo.svg" alt="Rock The Draw">
        <img class="auth-mascot" src="icons/duck-main.webp" alt="">
        <h2>${signup ? 'Daftar akaun baharu' : 'Log Masuk'}</h2>
        <p class="muted">${signup ? 'Akaun baharu perlu diluluskan oleh pentadbir sebelum boleh digunakan.' : 'Satu akaun untuk semua pelayar, komputer dan telefon.'}</p>
        ${signup ? html`<label class="field field-ic"><span>Nama</span>${icon('users')}<input id="au-name" maxlength="120" autocomplete="name" required></label>` : ''}
        <label class="field field-ic"><span>E-mel</span>${icon('idcard')}<input type="email" id="au-email" required autocomplete="username" inputmode="email"></label>
        <label class="field field-ic"><span>Kata laluan</span>${icon('lock')}<input type="password" id="pw1" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
        ${signup ? html`<label class="field field-ic"><span>Sahkan kata laluan</span>${icon('lock')}<input type="password" id="pw2" required minlength="8" autocomplete="new-password"></label>` : ''}
        <button class="btn btn-purple btn-lg btn-block" type="submit">${signup ? 'Daftar' : 'Log masuk'}</button>
        <div class="auth-links">
          ${signup ? html`<a href="#" id="au-to-login">Sudah ada akaun? Log masuk</a>`
            : html`<a href="#" id="au-to-signup">Daftar akaun baharu</a><a href="#" id="au-forgot">Lupa kata laluan?</a>`}
        </div>
        <p class="tiny muted auth-note">${navigator.onLine === false ? '● Luar talian: hanya pengguna yang pernah log masuk di peranti ini boleh masuk.' : ''}</p>
        <a href="#/home" class="auth-back" id="auth-back">← Kembali ke Paparan Utama</a>
      </form>
    </div>`);
  (signup ? $('#au-name') : $('#au-email')).focus();
  const last = await store.getKV('lastEmail');
  if (last && !signup) { $('#au-email').value = last; $('#pw1').focus(); }
  $('#auth-back').addEventListener('click', (e) => { e.preventDefault(); pendingRoute = ''; if (location.hash === '#/home') showHome(); else location.hash = '#/home'; });
  app.querySelector('.auth-links').addEventListener('click', async (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.id === 'au-to-signup') return showAuth('signup');
    if (a.id === 'au-to-login') return showAuth('login');
    if (a.id === 'au-forgot') {
      const em = $('#au-email').value.trim();
      if (!em) return toast('Masukkan e-mel anda dahulu.', 'error');
      try { await auth.recover(em); toast('Jika akaun wujud, pautan set semula kata laluan telah dihantar ke ' + em + '.', 'success', 7000); } catch (err) { toast(errMsg(err), 'error'); }
    }
  });
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const em = $('#au-email').value;
      const pw = $('#pw1').value;
      if (signup) {
        if (pw !== $('#pw2').value) throw new Error('Kata laluan tidak sepadan.');
        const r = await auth.signup(em, pw, $('#au-name').value);
        if (r && r.confirmEmail) { toast('Akaun didaftarkan. Semak e-mel anda untuk mengesahkan akaun, kemudian log masuk.', 'success', 9000); return showAuth('login'); }
      } else {
        await auth.login(em, pw);
      }
      await store.setKV('lastEmail', String(em).trim().toLowerCase());
      store.audit('LOG_MASUK', auth.isOfflineSession() ? 'luar talian' : '').catch(() => {});
      const r = pendingRoute || (routeId() && routeId() !== 'home' ? routeId() : 'dashboard');
      pendingRoute = '';
      await start();
      if (location.hash === '#/' + r) route(); else location.hash = '#/' + r;
    } catch (err) {
      toast(errMsg(err), 'error', 6000);
      btn.disabled = false;
    }
  });
}

/** Akaun belum ada peranan → menunggu kelulusan (atau kod pentadbir pertama jika tiada pentadbir). */
function showPending() {
  const p = auth.profile() || {};
  mount(app, html`
    <div class="auth-wrap">
      ${concertBg()}
      <div class="auth-card">
        <img class="auth-logo" src="icons/logo.svg" alt="Rock The Draw">
        <h2>Akaun menunggu kelulusan</h2>
        <p class="muted">Akaun <b>${p.email || ''}</b> telah didaftarkan. Minta pentadbir menetapkan peranan anda
          (Pentadbir, Operator Cabutan atau Staf Pendaftaran) di <b>Tetapan Sistem → Pengguna &amp; Peranan</b>.</p>
        ${p.admins === 0 ? html`<form id="boot-form" class="boot-form">
          <p class="alert alert-warn tiny">Belum ada pentadbir. Jika anda pemilik sistem, masukkan <b>kod pentadbir pertama</b>.</p>
          <label class="field"><span>Nama anda</span><input id="bt-name" maxlength="120" value="${p.name || ''}"></label>
          <label class="field"><span>Kod pentadbir pertama</span><input id="bt-code" class="mono" autocomplete="off" required></label>
          <button class="btn btn-purple btn-block" type="submit">Jadikan saya pentadbir</button>
        </form>` : ''}
        <div class="row-actions"><button class="btn btn-ghost" id="pd-check">⟳ Semak semula</button><button class="btn btn-ghost" id="pd-out">Log keluar</button></div>
      </div>
    </div>`);
  $('#pd-check').addEventListener('click', async () => { try { await auth.refreshProfile(); await start(); route(); } catch (err) { toast(errMsg(err), 'error'); } });
  $('#pd-out').addEventListener('click', async () => { await auth.logout(); location.hash = '#/home'; showHome(); });
  const f = $('#boot-form');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await auth.bootstrapAdmin($('#bt-code').value, $('#bt-name').value); toast('Anda kini pentadbir.', 'success'); await start(); location.hash = '#/settings'; route(); }
    catch (err) { toast(errMsg(err), 'error', 6000); }
  });
}

// ----------------------------------------------------------------------------- Shell admin

function shell() {
  mount(app, html`
    <div class="shell">
      <aside class="side" id="side">
        <a class="side-brand" href="#/home" title="Paparan Utama"><img src="icons/logo.svg" alt="Rock The Draw"><small>Panel Pentadbir</small></a>
        <nav class="side-nav" aria-label="Navigasi utama">
          ${ROUTES.filter((r) => r.nav && auth.can(r.id)).map((r) => html`<a href="#/${r.id}" data-r="${r.id}">${icon(r.icon)}<span>${r.label}</span></a>`)}
        </nav>
        <div class="side-foot">
          <div class="side-user tiny" id="side-user"></div>
          <div class="tiny" id="net-status"></div>
          <button class="side-logout" id="btn-lock">${icon('logout')}<span>Log Keluar</span></button>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn only-mobile" id="btn-menu" aria-label="Menu">${icon('menu')}</button>
          <h1 id="page-title">Dashboard</h1>
          <span class="net-pill" id="net-pill" role="status" aria-live="polite"></span>
          <div class="topstats" id="topstats"></div>
        </header>
        <main class="content" id="view" tabindex="-1"></main>
      </div>
    </div>`);
  $('#btn-lock').addEventListener('click', async () => {
    const pend = sync.state.pending;
    await store.audit('LOG_KELUAR', '').catch(() => {});
    if (pend) toast(pend + ' rekod belum disegerak — akan dihantar selepas anda log masuk semula di peranti ini.', 'info', 7000);
    sync.signOut(); await auth.logout(); location.hash = '#/home';
  });
  const p = auth.profile() || {};
  mount($('#side-user'), html`<b>${p.name || p.email || ''}</b><span>${auth.ROLE_LABEL[p.role] || ''}${auth.isOfflineSession() ? ' · luar talian' : ''}</span>`);
  $('#btn-menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  window.addEventListener('online', paintNet); window.addEventListener('offline', paintNet); paintNet();
}

const PHASE = {
  online: ['ONLINE', 'Disambung ke pangkalan data pusat', 'net-ok'],
  offline: ['OFFLINE', 'Bekerja dengan data setempat yang disegerak', 'net-warn'],
  syncing: ['SYNCING', 'Menyegerak rekod tertunggak', 'net-info'],
  complete: ['SYNC COMPLETE', 'Semua rekod berjaya disegerak', 'net-ok'],
  local: ['TIADA MAJLIS', 'Tiada majlis aktif', 'net-warn'],
};
function paintNet() {
  const el = $('#net-status');
  if (!el) return;
  const st = sync.state;
  const ph = sync.phase();
  const [label, desc, cls] = PHASE[ph];
  const pend = st.pending ? ' · ' + st.pending + ' rekod menunggu' : '';
  el.className = 'tiny net-status ' + cls;
  el.textContent = '● ' + label + ' — ' + desc + pend + (sync.isControl() ? ' · ★ Peranti Kawalan' : '');
  const pill = $('#net-pill');
  if (pill) { pill.className = 'net-pill ' + cls; pill.textContent = '● ' + label + (st.pending ? ' (' + st.pending + ')' : ''); pill.title = desc + pend; }
}

/** Data berubah dari peranti lain → muat semula paparan jika selamat (tiada borang / modal / pentas aktif). */
let changeTimer = null;
function onRemoteChange(stores) {
  if (stores.includes('settings')) { store.invalidateSettings(); store.getSettings().then((s) => sfx.configure(s)).catch(() => {}); }
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    if (!auth.isLoggedIn() || !$('#view')) return;
    ctx.refreshStats().catch(() => {});
    const busy = document.body.classList.contains('stage-open') || document.querySelector('.modal-back')
      || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName));
    const live = ['dashboard', 'participants', 'history', 'reports', 'audit', 'draw', 'prizes', 'attendance'];
    if (!busy && live.includes(routeId() || 'dashboard')) route();
  }, 400);
}

let syncHooked = false;
let renderSeq = 0;
async function route() {
  const id = routeId();
  if (id === 'home' || (!id && !auth.isLoggedIn())) return showHome();
  if (!auth.isLoggedIn()) { pendingRoute = id; return showAuth(); }
  if (!auth.role()) return showPending();
  if (!$('#view')) shell();
  let r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  if (!auth.can(r.navAs || r.id) && !auth.can(r.id)) r = ROUTES[0];
  const navId = r.navAs || r.id;
  document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === navId));
  $('#side').classList.remove('open');
  $('#page-title').textContent = r.title;
  document.title = r.title + ' · Rock The Draw';
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

let legacyAsked = false;
function shellReset() { const v = $('.shell'); if (v) v.remove(); }
async function start() {
  sfx.configure(await store.getSettings());
  if (!syncHooked) {
    syncHooked = true;
    att.onSync((res) => {
      ctx.refreshStats().catch(() => {});
      if (routeId() === 'attendance') res.added.slice(0, 5).forEach((p) => toast('✔ ' + p.name + ' hadir — itik #' + p.duckNo, 'success'));
    });
    sync.on((type, detail) => {
      if (type === 'status' || type === 'control') paintNet();
      if (type === 'change') onRemoteChange(detail);
      if (type === 'rejected') {
        const n = detail.length; const conf = detail.filter((r) => r.e === 'CONFLICT').length;
        toast(n + ' perubahan tidak diterima pelayan' + (conf ? ' (' + conf + ' konflik: data telah diubah di peranti lain)' : '') + '. Paparan dikemas kini dengan data pusat.', 'error', 8000);
      }
      if (type === 'synced' && detail) toast('✔ SYNC COMPLETE — ' + detail + ' rekod disegerak ke pangkalan data pusat.', 'success', 5000);
      if (type === 'control') toast(sync.isControl() ? 'Peranti ini kini Peranti Kawalan.' : 'Peranti Kawalan kini ' + sync.controlName() + '.', 'info', 6000);
      if (type === 'auth') toast('Sesi log masuk tamat atau peranan berubah. Sila log keluar dan log masuk semula untuk menyegerak.', 'error', 8000);
      if (type === 'legacy') askLegacy(detail);
    });
    window.addEventListener('online', () => sync.tick().catch(() => {}));
    // Profil & majlis aktif disemak semula setiap minit (peranan ditukar / majlis aktif ditukar oleh pentadbir)
    setInterval(async () => {
      if (!auth.isLoggedIn() || auth.isOfflineSession() || !sync.state.online) return;
      const before = auth.profile() || {};
      try {
        const me = await auth.refreshProfile();
        if (me.role !== before.role) { toast('Peranan akaun anda telah dikemas kini.', 'info'); await start(); shellReset(); return route(); }
        if (me.event && (!sync.state.event || me.event.event_id !== sync.state.event.event_id)) {
          toast('Pentadbir menukar majlis aktif kepada "' + me.event.name + '".', 'info', 6000);
          await store.setKV('lastEvent', me.event);
          await sync.switchEvent(me.event);
          route();
        }
      } catch (_) { /* luar talian */ }
    }, 60000);
  }
  if (!auth.isOfflineSession()) { try { await auth.refreshProfile(); } catch (_) { /* luar talian */ } }
  const p = auth.profile() || {};
  let ev = p.event || null;
  if (ev) await store.setKV('lastEvent', ev); else if (auth.isOfflineSession()) ev = await store.getKV('lastEvent');
  await sync.start({ role: p.role, event: ev, token: auth.token });
}

/** Data dalam pelayar ini dari versi lama (sebelum pangkalan data pusat). */
async function askLegacy(c) {
  if (legacyAsked) return;
  legacyAsked = true;
  const { modal } = await import('./util.js');
  const isAdmin = auth.role() === 'admin';
  const v = await modal({
    title: 'Data dalam pelayar ini',
    body: html`<p>Pelayar ini menyimpan data daripada versi lama (sebelum pangkalan data pusat):</p>
      <ul><li><b>${fmtNum(c.participants)}</b> peserta</li><li><b>${fmtNum(c.prizes)}</b> hadiah</li><li><b>${fmtNum(c.winners)}</b> rekod pemenang · ${fmtNum(c.draws)} cabutan</li></ul>
      <p>${isAdmin ? html`Pilih <b>Muat naik</b> untuk memindahkan data ini ke pangkalan data pusat majlis <b>${(sync.state.event || {}).name || ''}</b> supaya semua pelayar melihat data yang sama.
        Rekod yang sudah wujud di pangkalan data pusat <b>tidak ditimpa</b>.` : 'Hanya pentadbir boleh memuat naik data ini. Anda boleh menggunakan data pusat (data lama pelayar ini dibuang dari pelayar ini sahaja).'}</p>
      <p class="tiny muted">Disyorkan: muat turun sandaran dahulu (Tetapan Sistem → Sandaran) sebelum memilih.</p>`,
    buttons: [
      { label: 'Kemudian', value: null },
      { label: 'Guna data pusat sahaja', value: 'discard' },
      ...(isAdmin ? [{ label: '⇪ Muat naik ke pangkalan data pusat', kind: 'primary', value: 'upload' }] : []),
    ],
  });
  if (!v) { legacyAsked = false; return; }
  try {
    toast(v === 'upload' ? 'Memuat naik data ke pangkalan data pusat…' : 'Menggunakan data pusat…', 'info', 4000);
    await sync.resolveLegacy(v);
    await store.audit(v === 'upload' ? 'MIGRASI_MUAT_NAIK' : 'MIGRASI_BUANG_SETEMPAT', JSON.stringify(c));
    toast(v === 'upload' ? 'Data berjaya dipindahkan ke pangkalan data pusat.' : 'Kini menggunakan data pusat.', 'success', 6000);
    route();
  } catch (err) { legacyAsked = false; toast(errMsg(err), 'error', 8000); }
}

/** Pautan dari e-mel Supabase Auth (#access_token=…&type=recovery|signup|invite). */
async function handleAuthRedirect() {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)access_token=/.test(h)) return false;
  const q = new URLSearchParams(h);
  const type = q.get('type');
  const token = q.get('access_token');
  history.replaceState(null, '', location.pathname + '#/home');
  if (type !== 'recovery' && type !== 'invite') { toast('E-mel anda telah disahkan. Sila log masuk.', 'success', 7000); route(); return true; }
  mount(app, html`
    <div class="auth-wrap">${concertBg()}
      <form class="auth-card" id="rc-form">
        <img class="auth-logo" src="icons/logo.svg" alt="Rock The Draw">
        <h2>Tetapkan kata laluan baharu</h2>
        <label class="field field-ic"><span>Kata laluan baharu</span>${icon('lock')}<input type="password" id="rc1" required minlength="8" autocomplete="new-password"></label>
        <label class="field field-ic"><span>Sahkan</span>${icon('lock')}<input type="password" id="rc2" required minlength="8" autocomplete="new-password"></label>
        <button class="btn btn-purple btn-lg btn-block" type="submit">Simpan</button>
      </form>
    </div>`);
  $('#rc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const pw = $('#rc1').value;
      if (pw !== $('#rc2').value) throw new Error('Kata laluan tidak sepadan.');
      const p = auth.passwordProblem(pw); if (p) throw new Error(p);
      const { CLOUD } = await import('./cloud.js');
      const res = await fetch(CLOUD.url + '/auth/v1/user', { method: 'PUT', headers: { apikey: CLOUD.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }), referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error('Pautan telah tamat tempoh. Minta pautan baharu melalui "Lupa kata laluan?".');
      toast('Kata laluan disimpan. Sila log masuk.', 'success', 6000);
      location.hash = '#/dashboard';
    } catch (err) { toast(errMsg(err), 'error', 7000); }
  });
  return true;
}

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    await openDb();
    await auth.init();
    await sync.device();
    if (!auth.isLoggedIn()) sync.state.event = await store.getKV('lastEvent'); // QR di Paparan Utama
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
    if (await handleAuthRedirect()) return;
    if (auth.isLoggedIn()) await start();
    route();
  } catch (e) {
    mount(app, html`<div class="empty"><h3>Aplikasi tidak dapat dimulakan</h3><p>${errMsg(e)}</p><p class="muted">Pastikan pelayar moden (Chrome/Edge/Firefox/Safari) dan mod peribadi (incognito) tidak menyekat storan.</p></div>`);
  }
})();
