import { html, mount, fmtNum, fmtTime, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as att from '../attendance.js';

function donut(pct) {
  const r = 52; const c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(1, pct)) * c;
  return html`<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${(pct * 100).toFixed(1)}% hadir">
    <circle cx="70" cy="70" r="${r}" fill="none" stroke="#E5E7EB" stroke-width="18"/>
    ${pct > 0 ? html`<circle cx="70" cy="70" r="${r}" fill="none" stroke="#16A34A" stroke-width="18" stroke-linecap="${pct < 1 ? 'round' : 'butt'}"
      stroke-dasharray="${on.toFixed(1)} ${(c - on).toFixed(1)}" transform="rotate(-90 70 70)"/>` : ''}
    <text x="70" y="70" text-anchor="middle" class="donut-v">${(pct * 100).toFixed(1)}%</text>
    <text x="70" y="90" text-anchor="middle" class="donut-l">Kehadiran</text>
  </svg>`;
}

export async function render(el, ctx) {
  const [s, settings, cfg, participants, winners] = await Promise.all([store.stats(), store.getSettings(), att.getConfig(), store.listParticipants(), store.listWinners()]);
  let info = null;
  if (cfg) { try { info = await att.eventInfo(); } catch (_) { /* luar talian */ } }
  const totalStaff = info && Number(info.total) ? Number(info.total) : s.total;
  const present = info && Number(info.total) ? Number(info.present) : participants.filter((p) => p.checkedInAt).length;
  const pct = totalStaff ? present / totalStaff : 0;
  const recentIn = participants.filter((p) => p.checkedInAt).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt)).slice(0, 6);
  const recentWin = winners.filter((w) => !w.revoked).slice(-6).reverse();
  const next = s.prizeStatus.find((x) => x.remaining > 0);
  const activity = [
    ...recentIn.map((p) => ({ at: p.checkedInAt, name: p.name, what: 'Kehadiran disahkan', k: 'in' })),
    ...recentWin.map((w) => ({ at: w.drawAt, name: w.name, what: 'Menang ' + w.prizeName, k: 'win' })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const evName = settings.eventName || (cfg && cfg.eventName) || 'Majlis belum dinamakan';

  mount(el, html`
    <section class="event-card">
      <div class="ev-ic">${icon('calcheck')}</div>
      <div class="ev-body">
        <h2>${evName}</h2>
        <div class="ev-meta">
          <span>${icon('clock')} Tarikh: <b>${settings.eventDate ? fmtDate(settings.eventDate) : '—'}</b></span>
          <span>${icon('pin')} Lokasi: <b>${settings.eventLocation || '—'}</b></span>
        </div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/settings">Sunting</a>
    </section>

    <section class="kpi-grid">
      <div class="kpi kpi-blue">${icon('users')}<span>Jumlah Staf</span><b>${fmtNum(totalStaff)}</b></div>
      <div class="kpi kpi-green">${icon('check')}<span>Hadir (Disahkan)</span><b>${fmtNum(present)}</b></div>
      <div class="kpi kpi-purple">${icon('idcard')}<span>Peserta Cabutan</span><b>${fmtNum(s.total)}</b></div>
      <div class="kpi kpi-gold">${icon('trophy')}<span>Jumlah Pemenang</span><b>${fmtNum(s.winners)}</b></div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>Statistik Kehadiran</h3>${cfg ? '' : html`<a class="link" href="#/attendance">Sediakan</a>`}</div>
        <div class="donut-wrap">
          ${donut(pct)}
          <ul class="legend">
            <li><i class="lg-on"></i>Hadir : <b>${fmtNum(present)}</b> (${(pct * 100).toFixed(1)}%)</li>
            <li><i class="lg-off"></i>Belum Hadir : <b>${fmtNum(Math.max(0, totalStaff - present))}</b> (${(totalStaff ? (1 - pct) * 100 : 0).toFixed(1)}%)</li>
          </ul>
        </div>
        ${!cfg ? html`<p class="tiny muted">Pendaftaran kehadiran (QR) belum disediakan — statistik berdasarkan peserta cabutan.</p>` : ''}
      </section>
      <section class="card">
        <div class="card-head"><h3>Aktiviti Terkini</h3></div>
        ${activity.length ? html`<ul class="act-list">${activity.map((a) => html`<li>
          <span class="act-t">${fmtTime(a.at).slice(0, 5)}</span>
          <span class="act-n">${a.name}</span><span class="act-w ${a.k === 'win' ? 'gold' : ''}">· ${a.what}</span></li>`)}</ul>`
          : html`<p class="muted">Belum ada aktiviti.</p>`}
        <a class="link see-all" href="#/${cfg ? 'attendance' : 'history'}">Lihat Semua ›</a>
      </section>
    </div>

    <section class="next-card">
      <div>
        <div class="eyebrow">CABUTAN SETERUSNYA</div>
        <h3>${next ? html`${next.prize.category}${next.prize.name !== next.prize.category ? ' — ' + next.prize.name : ''}` : (s.prizeCategories ? 'Semua hadiah telah dicabut 🎉' : 'Belum ada hadiah ditetapkan')}</h3>
        <p>${next ? html`${fmtNum(next.remaining)} pemenang lagi · ${fmtNum(s.eligible)} peserta layak` : html`<a href="#/prizes">Tetapkan hadiah</a>`}</p>
      </div>
      <a class="btn btn-red btn-lg" href="#/draw${next ? '?prize=' + encodeURIComponent(next.prize.id) : ''}">${icon('play')} MULA CABUTAN</a>
    </section>

    <section class="card">
      <div class="card-head"><h3>Kemajuan hadiah</h3><a href="#/prizes" class="link">Urus</a></div>
      ${s.prizeStatus.length ? html`<ul class="prog-list">
        ${s.prizeStatus.map((p) => html`<li>
          <div class="pl-top"><span><b>${p.prize.category}</b>${p.prize.name !== p.prize.category ? html` · ${p.prize.name}` : ''}</span><span class="muted">${p.awarded}/${p.prize.quantity}</span></div>
          <div class="bar"><i style="width:${Math.round((p.awarded / Math.max(1, p.prize.quantity)) * 100)}%"></i></div>
        </li>`)}</ul>` : html`<p class="muted">Belum ada hadiah.</p>`}
    </section>`);
  await ctx.refreshStats();
}
