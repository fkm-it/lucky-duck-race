/**
 * util.js — Pembantu UI. SEMUA HTML dinamik melalui html`` (auto-escape) untuk elak XSS.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"'`]/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** Templat HTML selamat. Nilai di-escape kecuali dibalut raw() atau hasil html`` lain. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += val(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function mount(el, content) { el.innerHTML = String(content); }

export const fmtNum = (n) => Number(n || 0).toLocaleString('ms-MY');
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export const fmtDateTime = (iso) => (iso ? fmtDate(iso) + ', ' + fmtTime(iso) : '');

// ----------------------------------------------------------------------------- Toast

export function toast(msg, type = 'info', ms = 3200) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function errMsg(e) { return (e && e.message) || String(e); }

// ----------------------------------------------------------------------------- Modal

/**
 * Buka modal. body = html``. Pulangkan {el, close, done(promise)}.
 * buttons: [{label, value, kind:'primary'|'danger'|'ghost'}]
 */
export function modal({ title, body, buttons = [{ label: 'Tutup', value: null, kind: 'ghost' }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-back';
    wrap.innerHTML = String(html`
      <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mdl-t">
        <div class="modal-head"><h3 id="mdl-t">${title}</h3><button class="icon-btn" data-x aria-label="Tutup">✕</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${buttons.map((b, i) => html`<button class="btn btn-${b.kind || 'ghost'}" data-i="${i}">${b.label}</button>`)}</div>
      </div>`);
    document.body.appendChild(wrap);
    const prevFocus = document.activeElement;
    const close = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap || e.target.closest('[data-x]')) return close(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const def = buttons[+b.dataset.i];
      if (def.validate) {
        const ok = await def.validate(wrap);
        if (ok === false) return;
        return close(ok === true ? def.value : ok);
      }
      close(def.value);
    });
    const first = wrap.querySelector('input,select,textarea') || wrap.querySelector('.modal-foot .btn-primary,.modal-foot .btn-danger');
    if (first) setTimeout(() => first.focus(), 30);
    if (onOpen) onOpen(wrap, close);
  });
}

export function confirmDialog(title, message, { danger = false, okLabel = 'Teruskan', typeToConfirm = '' } = {}) {
  const body = html`<p class="confirm-msg">${message}</p>
    ${typeToConfirm ? html`<label class="field"><span>Taip <b>${typeToConfirm}</b> untuk mengesahkan</span><input id="cf-type" autocomplete="off"></label>` : ''}`;
  return modal({
    title, body,
    buttons: [
      { label: 'Batal', value: false, kind: 'ghost' },
      {
        label: okLabel, value: true, kind: danger ? 'danger' : 'primary',
        validate: typeToConfirm ? (w) => {
          const v = w.querySelector('#cf-type').value.trim();
          if (v !== typeToConfirm) { toast('Teks pengesahan tidak sepadan.', 'error'); return false; }
          return true;
        } : undefined,
      },
    ],
  }).then((v) => v === true);
}

// ----------------------------------------------------------------------------- Fail

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function readFileAs(file, as = 'arrayBuffer') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'text') r.readAsText(file);
    else if (as === 'dataURL') r.readAsDataURL(file);
    else r.readAsArrayBuffer(file);
  });
}

/** Kecilkan imej hadiah (maks 640px, JPEG/PNG) → dataURL. */
export async function resizeImage(file, max = 640) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error('Format imej tidak disokong (PNG/JPG/WEBP).');
  if (file.size > 15 * 1024 * 1024) throw new Error('Imej terlalu besar (maks 15MB).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imej tidak dapat dibaca.')); i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
