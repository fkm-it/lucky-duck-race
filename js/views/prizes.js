import { html, mount, toast, errMsg, modal, confirmDialog, resizeImage, fmtNum, $ } from '../util.js';
import * as store from '../store.js';
import { PRIZE_CATEGORIES } from '../logic.js';

const PRESETS = [
  ['Grand Prize', 1, 1], ['First Prize', 2, 2], ['Second Prize', 3, 3], ['Third Prize', 5, 4], ['Consolation Prize', 20, 5],
];

export async function render(el, ctx) {
  const draw = async () => {
    const ps = await store.getPrizeStatus();
    const total = ps.reduce((s, x) => s + x.prize.quantity, 0);
    const awarded = ps.reduce((s, x) => s + x.awarded, 0);
    mount(el, html`
      <div class="tabs"><a class="tab" href="#/draw">Mula Cabutan</a><a class="tab on" href="#/prizes">Urus Hadiah</a></div>
      <div class="toolbar">
        <div><b>${ps.length}</b> kategori · Jumlah pemenang diperlukan <b>${fmtNum(total)}</b> · Sudah dicabut <b>${fmtNum(awarded)}</b></div>
        <div class="spacer"></div>
        ${ps.length === 0 ? html`<button class="btn btn-ghost" id="pz-preset">⚡ Guna susunan contoh</button>` : ''}
        <button class="btn btn-primary" id="pz-add">＋ Tambah hadiah</button>
      </div>
      ${ps.length ? html`<div class="prize-grid">${ps.map(({ prize: p, awarded: a, remaining }) => html`
        <article class="prize-card">
          <div class="pc-img">${p.image ? html`<img src="${p.image}" alt="">` : html`<span>🎁</span>`}<span class="pc-seq">#${p.sequence}</span></div>
          <div class="pc-body">
            <div class="pc-cat">${p.category}</div>
            <h3>${p.name}</h3>
            ${p.description ? html`<p class="muted tiny">${p.description}</p>` : ''}
            <div class="bar"><i style="width:${Math.round((a / p.quantity) * 100)}%"></i></div>
            <div class="pc-meta"><span>${a}/${p.quantity} pemenang</span><span class="${remaining ? '' : 'gold'}">${remaining ? remaining + ' baki' : 'Selesai ✔'}</span></div>
          </div>
          <div class="pc-act">
            ${remaining ? html`<a class="btn btn-go btn-sm" href="#/draw?prize=${encodeURIComponent(p.id)}">🏁 Cabut</a>` : ''}
            <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Sunting</button>
            <button class="icon-btn danger" data-del="${p.id}" title="Padam">🗑</button>
          </div>
        </article>`)}</div>` : html`<div class="empty"><div class="empty-ic">🎁</div><h3>Belum ada hadiah</h3><p class="muted">Tambah kategori hadiah (Grand, First, Second, Third, Consolation, Special) beserta bilangan pemenang.</p></div>`}`);
    return ps;
  };

  let ps = await draw();

  const editor = async (p) => {
    let image = p ? p.image : '';
    const body = html`
      <div class="form-grid">
        <label class="field"><span>Kategori *</span><select id="z-cat">${PRIZE_CATEGORIES.map((c) => html`<option ${p && p.category === c ? 'selected' : ''}>${c}</option>`)}</select></label>
        <label class="field"><span>Turutan cabutan *</span><input id="z-seq" type="number" min="1" max="999" value="${p ? p.sequence : ps.length + 1}"></label>
        <label class="field span-2"><span>Nama hadiah *</span><input id="z-name" maxlength="120" value="${p ? p.name : ''}" placeholder="cth. Smart TV 55 inci"></label>
        <label class="field"><span>Bilangan pemenang *</span><input id="z-qty" type="number" min="1" max="10000" value="${p ? p.quantity : 1}"></label>
        <label class="field"><span>Imej hadiah</span><input id="z-img" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label class="field span-2"><span>Keterangan</span><textarea id="z-desc" rows="2" maxlength="500">${p ? p.description : ''}</textarea></label>
        <div class="span-2 img-prev" id="z-prev">${image ? html`<img src="${image}" alt="">` : ''}</div>
      </div>`;
    await modal({
      title: p ? 'Sunting hadiah' : 'Tambah hadiah', body, wide: true,
      onOpen: (w) => {
        w.querySelector('#z-img').addEventListener('change', async (e) => {
          try {
            image = await resizeImage(e.target.files[0]);
            mount(w.querySelector('#z-prev'), html`<img src="${image}" alt=""><button class="btn btn-ghost btn-sm" id="z-rm">Buang imej</button>`);
            w.querySelector('#z-rm').addEventListener('click', () => { image = ''; w.querySelector('#z-prev').innerHTML = ''; });
          } catch (err) { toast(errMsg(err), 'error'); }
        });
      },
      buttons: [{ label: 'Batal', value: null }, {
        label: 'Simpan', kind: 'primary', value: true,
        validate: async (w) => {
          try {
            await store.savePrize({
              id: p ? p.id : '', category: w.querySelector('#z-cat').value, name: w.querySelector('#z-name').value,
              quantity: w.querySelector('#z-qty').value, sequence: w.querySelector('#z-seq').value,
              description: w.querySelector('#z-desc').value, image,
            });
            toast('Hadiah disimpan.', 'success');
            return true;
          } catch (err) { toast(errMsg(err), 'error'); return false; }
        },
      }],
    });
    ps = await draw();
    ctx.refreshStats();
  };

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'pz-add') return editor(null);
    if (b.id === 'pz-preset') {
      for (const [cat, q, s] of PRESETS) await store.savePrize({ category: cat, name: cat, quantity: q, sequence: s });
      toast('Susunan contoh ditambah — sunting nama & imej hadiah.', 'success');
      ps = await draw(); ctx.refreshStats(); return;
    }
    if (b.dataset.edit) return editor(ps.find((x) => x.prize.id === b.dataset.edit).prize);
    if (b.dataset.del) {
      const p = ps.find((x) => x.prize.id === b.dataset.del).prize;
      if (!(await confirmDialog('Padam hadiah?', 'Padam "' + p.name + '" (' + p.category + ')?', { danger: true, okLabel: 'Padam' }))) return;
      try { await store.deletePrize(p.id); toast('Dipadam.', 'success'); ps = await draw(); ctx.refreshStats(); } catch (err) { toast(errMsg(err), 'error', 6000); }
    }
  });
}
