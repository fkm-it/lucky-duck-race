/**
 * checkin.js — Laman pengesahan kehadiran (telefon staf, tiada log masuk).
 * QR → checkin.html#e=<eventId>&t=<token>  (fragmen # tidak dihantar ke pelayan / log)
 * Aliran: masukkan No. Pekerja → popup maklumat staf → Sahkan Kehadiran → berjaya.
 */
import { html, mount, $ } from './util.js';
import { rpc, CloudError } from './cloud.js';

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
const initials = (n) => n.split(/\s+/).filter((w) => !/^(bin|binti|a\/l|a\/p|bt|b\.)$/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function shell(eventName, inner) {
  mount(root, html`
    <header class="ci-head">
      <div class="ci-duck" aria-hidden="true">🦆</div>
      <div class="ci-brand">LUCKY DUCK RACE</div>
      <div class="ci-event">${eventName}</div>
    </header>
    <section class="ci-card">${inner}</section>
    <footer class="ci-foot">Pengesahan kehadiran · data anda hanya digunakan untuk majlis ini</footer>`);
}

function message(eventName, icon, title, text, retry) {
  shell(eventName, html`<div class="ci-msg"><div class="ci-msg-ic">${icon}</div><h1>${title}</h1><p>${text}</p>
    ${retry ? html`<button class="btn btn-primary btn-lg btn-block" id="ci-retry">Cuba lagi</button>` : ''}</div>`);
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

function form(info, p, prefill = '', error = '') {
  shell(info.name, html`
    <h1>Sahkan kehadiran anda</h1>
    <p class="muted">Masukkan No. Pekerja untuk menyertai cabutan bertuah.</p>
    <form id="ci-form" autocomplete="off" novalidate>
      <label class="field"><span>No. Pekerja</span>
        <input id="ci-id" class="ci-input mono" inputmode="text" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="40" required value="${prefill}" placeholder="cth. 012345" aria-describedby="ci-err">
      </label>
      <p class="ci-err" id="ci-err" role="alert">${error}</p>
      <button class="btn btn-go btn-lg btn-block" type="submit" id="ci-go">Semak</button>
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
      confirmSheet(info, p, rows[0]);
    } catch (e) {
      if (e.code === 'CLOSED' || e.code === 'INVALID_QR') return main();
      form(info, p, id, e.message);
    }
  });
}

function confirmSheet(info, p, s) {
  const back = document.createElement('div');
  back.className = 'ci-sheet-back';
  mount(back, html`
    <div class="ci-sheet" role="dialog" aria-modal="true" aria-labelledby="ci-s-name">
      <div class="ci-avatar" aria-hidden="true">${initials(s.name) || '🦆'}</div>
      <div class="ci-s-name" id="ci-s-name">${s.name}</div>
      <dl class="ci-dl">
        <dt>No. Pekerja</dt><dd class="mono">${s.staff_id}</dd>
        <dt>Jabatan</dt><dd>${s.department || '—'}</dd>
      </dl>
      ${s.checked_in_at
        ? html`<div class="ci-already">✔ Kehadiran anda telah disahkan pada <b>${timeOf(s.checked_in_at)}</b>.</div>
               <button class="btn btn-primary btn-lg btn-block" data-x>Tutup</button>`
        : html`<p class="muted ci-q">Adakah ini anda?</p>
               <button class="btn btn-go btn-lg btn-block" id="ci-confirm">✔ Sahkan Kehadiran</button>
               <button class="btn btn-ghost btn-lg btn-block" data-x>Bukan saya</button>`}
    </div>`);
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-x]')) { close(); form(info, p); } });
  const btn = back.querySelector('#ci-confirm');
  if (!btn) return;
  btn.focus();
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Mengesahkan…';
    try {
      const r = (await rpc('ldr_checkin', { p_event: p.e, p_token: p.t, p_staff_id: s.staff_id }))[0];
      close();
      success(info, p, r);
    } catch (e) {
      close();
      if (e.code === 'CLOSED' || e.code === 'INVALID_QR') return main();
      form(info, p, s.staff_id, e instanceof CloudError ? e.message : 'Ralat tidak dijangka. Cuba lagi.');
    }
  });
}

function success(info, p, r) {
  shell(info.name, html`
    <div class="ci-ok">
      <div class="ci-ok-ic" aria-hidden="true">✔</div>
      <h1>Kehadiran disahkan!</h1>
      <div class="ci-ok-name">${r.name}</div>
      <div class="muted mono">${r.staff_id} · ${r.department || '—'}</div>
      <p class="ci-ok-msg">${r.already ? html`Kehadiran anda telah direkodkan lebih awal pada <b>${timeOf(r.checked_in_at)}</b>.` : html`Direkodkan pada <b>${timeOf(r.checked_in_at)}</b>.`}
        Anda kini <b>layak menyertai cabutan bertuah</b> 🦆🏁 Semoga bertuah!</p>
      <button class="btn btn-ghost btn-block" id="ci-next">Daftar staf lain</button>
    </div>`);
  if (navigator.vibrate) navigator.vibrate(80);
  $('#ci-next').addEventListener('click', () => form(info, p));
}

main();
