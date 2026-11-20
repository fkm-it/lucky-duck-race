/**
 * checkin.js — Laman pengesahan kehadiran (telefon staf, tiada log masuk).
 * QR → checkin.html#e=<eventId>&t=<token>  (fragmen # tidak dihantar ke pelayan / log)
 * Aliran: masukkan No. Pekerja → semak maklumat → Sahkan Kehadiran → berjaya.
 */
import { html, mount, $ } from './util.js';
import { rpc, CloudError } from './cloud.js';
import { icon } from './icons.js';

const root = document.getElementById('ci');
const SS = 'ldr.ci';

function readParams() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  let e = h.get('e'); let t = h.get('t');
  if (e && t) { sessionStorage.setItem(SS, JSON.stringify({ e, t })); history.replaceState(null, '', location.pathname); }
  else { try { ({ e, t } = JSON.parse(sessionStorage.getItem(SS) || '{}')); } catch (_) { /* tiada */ } }
  if (!/^[0-9a-f-]{36}$/i.test(e || '') || !/^[0-9a-f]{24,64}$/i.test(t || '')) return null;
  return { e, t };
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' });

function shell(eventName, inner) {
  mount(root, html`
    <header class="ci-head">
      <img class="ci-logo" src="icons/logo.svg" alt="Lucky Duck Race">
      ${eventName ? html`<div class="ci-event">${eventName}</div>` : ''}
    </header>
    <section class="ci-card">${inner}</section>
    <footer class="ci-foot">Pengesahan kehadiran · data anda hanya digunakan untuk majlis ini</footer>`);
}

function message(eventName, emoji, title, text, retry) {
  shell(eventName, html`<div class="ci-msg"><div class="ci-msg-ic">${emoji}</div><h1 class="ci-title">${title}</h1><p class="ci-sub">${text}</p>
    ${retry ? html`<button class="btn btn-purple btn-lg btn-block" id="ci-retry">Cuba lagi</button>` : ''}</div>`);
  if (retry) $('#ci-retry').addEventListener('click', retry);
}

async function main() {
  const p = readParams();
  if (!p) return message('', '📷', 'Imbas kod QR', 'Sila imbas kod QR di kaunter pendaftaran majlis untuk mengesahkan kehadiran.');
  let info;
  try {
    const rows = await rpc('ldr_event_info', { p_event: p.e, p_token: p.t });
    info = rows && rows[0];
  } catch (e) {
    return message('', e.code === 'INVALID_QR' ? '⚠️' : '📶', e.code === 'INVALID_QR' ? 'Kod QR tidak sah' : 'Tiada sambungan', e.message, e.code === 'INVALID_QR' ? null : main);
  }
  if (!info.is_open) return message(info.name, '⏸️', 'Pendaftaran ditutup', 'Pendaftaran kehadiran untuk majlis ini telah ditutup. Sila rujuk kaunter pendaftaran.', main);
  form(info, p);
}

const heading = () => html`
  <div class="ci-title-ic">${icon('calcheck')}</div>
  <h1 class="ci-title">Pengesahan Kehadiran Staf</h1>`;

function form(info, p, prefill = '', error = '') {
  shell(info.name, html`
    ${heading()}
    <p class="ci-sub">Sila masukkan <b>No. Pekerja</b> anda</p>
    <form id="ci-form" autocomplete="off" novalidate>
      <label class="ci-inwrap"><span class="sr-only">No. Pekerja</span>${icon('user')}
        <input id="ci-id" class="ci-input" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="40" required value="${prefill}" placeholder="cth: 123456" aria-describedby="ci-err">
      </label>
      <p class="ci-err" id="ci-err" role="alert">${error}</p>
      <button class="btn btn-purple btn-lg btn-block" type="submit" id="ci-go">Semak</button>
    </form>`);
  const input = $('#ci-id');
  input.focus();
  $('#ci-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = input.value.trim();
    if (!id) { $('#ci-err').textContent = 'Sila masukkan No. Pekerja.'; return; }
    const btn = $('#ci-go');
    btn.disabled = true; btn.textContent = 'Menyemak…';
    try {
      const rows = await rpc('ldr_lookup', { p_event: p.e, p_token: p.t, p_staff_id: id });
      review(info, p, rows[0]);
    } catch (e) {
      if (e.code === 'CLOSED' || e.code === 'INVALID_QR') return main();
      form(info, p, id, e.message);
    }
  });
}

function review(info, p, s) {
  shell(info.name, html`
    ${heading()}
    <div class="ci-profile">
      <div class="ci-avatar" aria-hidden="true">${icon('user')}</div>
      <dl class="ci-dl">
        <dt>No. Pekerja</dt><dd class="mono">${s.staff_id}</dd>
        <dt>Nama</dt><dd>${s.name}</dd>
        <dt>Jabatan</dt><dd>${s.department || '—'}</dd>
        <dt>Status</dt><dd>${s.checked_in_at ? html`<span class="pill pill-ok">Telah Disahkan</span>` : html`<span class="pill pill-warn">Belum Disahkan</span>`}</dd>
      </dl>
    </div>
    ${s.checked_in_at
      ? html`<div class="ci-already">✔ Kehadiran anda telah disahkan pada <b>${timeOf(s.checked_in_at)}</b>.</div>
             <button class="btn btn-grey btn-lg btn-block" data-x>Kembali</button>`
      : html`<p class="ci-q">Adakah maklumat ini betul?</p>
             <div class="ci-actions">
               <button class="btn btn-grey btn-lg" data-x>Batal</button>
               <button class="btn btn-go btn-lg" id="ci-confirm">${icon('check')} Sahkan Kehadiran</button>
             </div>`}`);
  root.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => form(info, p)));
  const btn = $('#ci-confirm');
  if (!btn) return;
  btn.focus();
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Mengesahkan…';
    try {
      const r = (await rpc('ldr_checkin', { p_event: p.e, p_token: p.t, p_staff_id: s.staff_id }))[0];
      success(info, p, r);
    } catch (e) {
      if (e.code === 'CLOSED' || e.code === 'INVALID_QR') return main();
      form(info, p, s.staff_id, e instanceof CloudError ? e.message : 'Ralat tidak dijangka. Cuba lagi.');
    }
  });
}

function success(info, p, r) {
  shell(info.name, html`
    <div class="ci-ok">
      <div class="ci-ok-ic" aria-hidden="true">${icon('check')}</div>
      <h1>Kehadiran Disahkan!</h1>
      <div class="ci-ok-thanks">Terima kasih,</div>
      <div class="ci-ok-name">${r.name}</div>
      <p class="ci-ok-msg">${r.already ? html`Kehadiran anda telah direkodkan pada <b>${timeOf(r.checked_in_at)}</b>. ` : ''}Anda telah didaftarkan sebagai peserta <b>Cabutan Bertuah</b> Lucky Duck Race.</p>
      <img class="ci-ok-mascot" src="icons/mascot.svg" alt="">
      <button class="btn btn-ghost btn-block" id="ci-next">Daftar staf lain</button>
    </div>`);
  if (navigator.vibrate) navigator.vibrate(80);
  $('#ci-next').addEventListener('click', () => form(info, p));
}

main();
