import { html, mount, fmtNum, fmtDateTime } from '../util.js';
import * as store from '../store.js';

export async function render(el, ctx) {
  const [s, winners, draws] = await Promise.all([store.stats(), store.listWinners(), store.listDraws()]);
  const next = s.prizeStatus.find((x) => x.remaining > 0);
  const recent = winners.filter((w) => !w.revoked).slice(-8).reverse();
  const maxDept = Math.max(1, ...s.departments.map((d) => d.total));
  const required = s.totalPrizes;

  mount(el, html`
    <section class="hero-card">
      <div>
        <div class="eyebrow">LET THE LUCK RACE BEGIN!</div>
        <h2>${next ? html`Seterusnya: <span class="hl">${next.prize.category}</span> — ${next.prize.name}` : (s.prizeCategories ? 'Semua hadiah telah dicabut 🎉' : 'Mulakan dengan import peserta & tetapkan hadiah')}</h2>
        <p class="muted">${next ? html`${fmtNum(next.remaining)} daripada ${fmtNum(next.prize.quantity)} pemenang lagi · ${fmtNum(s.eligible)} peserta layak` : html`${fmtNum(s.total)} peserta berdaftar`}</p>
      </div>
      <div class="hero-actions">
        ${s.total === 0 ? html`<a class="btn btn-primary" href="#/import">⇪ Import Excel</a>` : ''}
        ${s.prizeCategories === 0 ? html`<a class="btn btn-ghost" href="#/prizes">🎁 Tetapkan hadiah</a>` : ''}
        <a class="btn btn-go" href="#/draw${next ? '?prize=' + encodeURIComponent(next.prize.id) : ''}">🏁 Buka Perlumbaan</a>
      </div>
    </section>

    <section class="stat-grid">
      ${[
        ['Jumlah Peserta', s.total, ''],
        ['Peserta Layak', s.eligible, 'ok'],
        ['Jumlah Pemenang', s.winners, 'gold'],
        ['Baki Peserta', s.remaining, ''],
        ['Jumlah Hadiah', required, ''],
        ['Cabutan Selesai', s.completedDraws, ''],
      ].map(([l, v, k]) => html`<div class="stat ${k ? 'stat-' + k : ''}"><span>${l}</span><b>${fmtNum(v)}</b></div>`)}
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Kemajuan hadiah</h3><a href="#/prizes" class="link">Urus</a></div>
        ${s.prizeStatus.length ? html`<ul class="prog-list">
          ${s.prizeStatus.map((p) => html`<li>
            <div class="pl-top"><span><b>${p.prize.category}</b>${p.prize.name !== p.prize.category ? html` · ${p.prize.name}` : ''}</span><span class="muted">${p.awarded}/${p.prize.quantity}</span></div>
            <div class="bar"><i style="width:${Math.round((p.awarded / Math.max(1, p.prize.quantity)) * 100)}%"></i></div>
          </li>`)}
        </ul>` : html`<p class="muted">Belum ada hadiah.</p>`}
        <p class="tiny muted">Jumlah pemenang diperlukan: <b>${fmtNum(required)}</b></p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Pemenang terkini</h3><a href="#/history" class="link">Semua</a></div>
        ${recent.length ? html`<ul class="win-list">${recent.map((w) => html`<li>
          <span class="wl-no">#${w.winnerNo}</span>
          <div><b>${w.name}</b><small>${w.staffId} · ${w.department || '—'}</small></div>
          <span class="tag tag-gold">${w.prizeName}</span></li>`)}</ul>` : html`<p class="muted">Belum ada pemenang.</p>`}
        ${draws.length ? html`<p class="tiny muted">Cabutan terakhir: ${fmtDateTime(draws[draws.length - 1].createdAt)}</p>` : ''}
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>Peserta mengikut jabatan</h3><span class="muted tiny">${s.departments.length} jabatan</span></div>
      ${s.departments.length ? html`<ul class="dept-list">${s.departments.slice(0, 20).map((d) => html`<li>
        <span class="dl-name">${d.name}</span>
        <div class="bar"><i style="width:${Math.round((d.total / maxDept) * 100)}%"></i><em style="width:${Math.round((d.winners / maxDept) * 100)}%"></em></div>
        <span class="dl-val">${d.total}${d.winners ? html` <small class="gold">(${d.winners} 🏆)</small>` : ''}</span></li>`)}</ul>` : html`<p class="muted">Tiada data.</p>`}
    </section>`);
  await ctx.refreshStats();
}
