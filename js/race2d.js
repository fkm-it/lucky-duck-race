/**
 * race2d.js — Mod animasi 2D (kanvas) untuk peranti berprestasi rendah / tiada WebGL.
 * API sama dengan Race3D supaya pengawal perlumbaan tidak perlu tahu mod yang digunakan.
 */
import { computeLayout, progressAt } from './logic.js';


export class Race2D {
  constructor(host, opt) {
    this.host = host;
    this.n = opt.count;
    this.layout = computeLayout(this.n, 100);
    this.plan = null;
    this.phase = 'intro';
    this.raceT = 0;
    this.clock = 0;
    this.winnerSet = new Map();
    this.highlighted = new Set();
    this.focusIdx = -1;
    this.x = new Float32Array(this.n);
    this.gait = new Float32Array(this.n).map(() => Math.random() * 6.28);
    for (let i = 0; i < this.n; i++) this.x[i] = this.layout.pos[i].startX;
    this.viewX = -this.layout.depth / 2;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'race-canvas';
    host.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = this.host.clientWidth || window.innerWidth;
    this.h = this.host.clientHeight || window.innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
  }

  setPlan(plan) { this.plan = plan; }
  setPhase(p) { this.phase = p; }
  highlight(i) { this.highlighted.add(i); }
  markWinner(i, rank) { this.winnerSet.set(i, rank); this.focusIdx = i; }
  focus(i) { this.focusIdx = i; }

  leaders(k = 5) {
    const idx = Array.from({ length: this.n }, (_, i) => i);
    idx.sort((a, b) => this.x[b] - this.x[a]);
    return idx.slice(0, k);
  }

  _geom() {
    const L = this.layout;
    const top = this.h * 0.2; const bottom = this.h * 0.94;
    const laneH = (bottom - top) / L.lanes;
    const ppu = Math.max(laneH / L.laneW, this.w / 60); // piksel per unit
    return { top, bottom, laneH, ppu };
  }

  screenPos(i) {
    const { top, laneH, ppu } = this._geom();
    const L = this.layout;
    return { x: (this.x[i] - this.viewX) * ppu + this.w * 0.5, y: top + (L.pos[i].lane + 0.5) * laneH - Math.max(10, laneH * 0.6) };
  }

  _duckX(i, t) {
    const L = this.layout; const sx = L.pos[i].startX;
    if (!this.plan) return sx;
    const d = this.plan.ducks[i];
    if (t >= d.finish) return L.finishX + 4.5 * (1 - Math.exp(-(t - d.finish) * 1.1));
    return sx + progressAt(this.plan, i, t) * (L.finishX - sx);
  }

  frame(dt, raceT) {
    this.clock += dt; this.raceT = raceT;
    const L = this.layout; const g = this.g; const dpr = this.dpr;
    if (this.phase === 'race' || this.phase === 'done') for (let i = 0; i < this.n; i++) this.x[i] = this._duckX(i, raceT);
    let lead = -Infinity;
    for (let i = 0; i < this.n; i++) if (this.x[i] > lead) lead = this.x[i];
    const { top, bottom, laneH, ppu } = this._geom();
    let tx;
    if (this.phase === 'race') tx = Math.min(L.finishX - 6, lead - 10);
    else if (this.phase === 'done') tx = L.finishX - 4;
    else tx = -L.depth / 2 + 8;
    this.viewX += (tx - this.viewX) * (1 - Math.exp(-dt * 3));
    const X = (x) => ((x - this.viewX) * ppu + this.w * 0.5) * dpr;

    g.setTransform(1, 0, 0, 1, 0, 0);
    // Latar konsert: dinding LED + penonton bersiluet + lampu telefon
    const sky = g.createLinearGradient(0, 0, 0, top * dpr);
    sky.addColorStop(0, '#05030A'); sky.addColorStop(1, '#1A0B2E');
    g.fillStyle = sky; g.fillRect(0, 0, this.canvas.width, top * dpr);
    const bars = 40; const bw = this.canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const v = 0.3 + 0.7 * Math.abs(Math.sin(this.clock * (2 + (i % 5) * 0.7) + i));
      g.fillStyle = i % 2 ? 'rgba(255,30,60,.35)' : 'rgba(168,85,247,.35)';
      g.fillRect(i * bw + 2, top * dpr * (1 - v * 0.8), bw - 4, top * dpr * v * 0.8);
    }
    for (let k = 0; k < 90; k++) {
      const cx = ((k * 23 - this.viewX * ppu * 0.4) % (this.w + 40) + this.w + 40) % (this.w + 40) - 20;
      const jump = Math.max(0, Math.sin(this.clock * 7 + k)) * (this.phase === 'race' ? 6 : 2);
      const cy = top * 0.82 - jump;
      g.fillStyle = '#0A0A0F'; g.beginPath(); g.arc(cx * dpr, cy * dpr, 7 * dpr, 0, 6.28); g.fill();
      g.beginPath(); g.arc(cx * dpr, (cy - 10) * dpr, 5 * dpr, 0, 6.28); g.fill();
      if (k % 4 === 0) { g.fillStyle = '#FFF7D6'; g.beginPath(); g.arc((cx + 6) * dpr, (cy - 18) * dpr, 1.6 * dpr, 0, 6.28); g.fill(); }
    }
    g.fillStyle = '#0B0B10'; g.fillRect(0, top * dpr - 6 * dpr, this.canvas.width, (bottom - top) * dpr + 12 * dpr);
    // Lorong gelap + garisan neon
    for (let l = 0; l < L.lanes; l++) {
      g.fillStyle = l % 2 ? '#17121C' : '#120F17';
      g.fillRect(0, (top + l * laneH) * dpr, this.canvas.width, laneH * dpr);
      g.fillStyle = l % 2 ? '#A855F7' : '#FF1E3C';
      g.shadowColor = g.fillStyle; g.shadowBlur = 8 * dpr;
      g.fillRect(0, (top + l * laneH) * dpr, this.canvas.width, Math.max(1, dpr * 1.5));
      g.shadowBlur = 0;
    }
    // Garisan
    g.fillStyle = '#A855F7'; g.fillRect(X(0) - 2 * dpr, top * dpr, 4 * dpr, (bottom - top) * dpr);
    const cs = Math.max(4, laneH / 2) * dpr;
    for (let y = top * dpr, k = 0; y < bottom * dpr; y += cs, k++) {
      g.fillStyle = k % 2 ? '#111' : '#FFF'; g.fillRect(X(L.finishX), y, cs, cs);
      g.fillStyle = k % 2 ? '#FFF' : '#111'; g.fillRect(X(L.finishX) + cs, y, cs, cs);
    }
    g.font = `${26 * dpr}px "Bebas Neue", Impact, sans-serif`; g.textAlign = 'center';
    g.shadowColor = '#FF1E3C'; g.shadowBlur = 14 * dpr;
    g.fillStyle = '#fff'; g.fillText('START', X(0), (top - 10) * dpr); g.fillText('FINISH', X(L.finishX) + cs, (top - 10) * dpr);
    g.shadowBlur = 0;

    // Itik
    const r = Math.max(3, Math.min(laneH * 0.42, 22));
    for (let i = 0; i < this.n; i++) {
      const sx = X(this.x[i]);
      if (sx < -40 * dpr || sx > this.canvas.width + 40 * dpr) continue;
      const moving = this.phase === 'race' && this.x[i] < L.finishX + 4;
      this.gait[i] += dt * (moving ? 14 : 3);
      const bob = moving ? Math.abs(Math.sin(this.gait[i])) * r * 0.35 : 0;
      const cy = (top + (L.pos[i].lane + 0.5) * laneH) * dpr - bob * dpr;
      const win = this.winnerSet.has(i);
      const rr = r * dpr;
      if (win || this.highlighted.has(i)) {
        g.fillStyle = 'rgba(255,215,0,.45)'; g.beginPath(); g.arc(sx, cy, rr * 1.7, 0, 6.28); g.fill();
      }
      // jaket kulit (emas untuk pemenang), kepala kuning, mohawk merah, cermin mata hitam
      g.fillStyle = win ? '#F5C842' : '#15151A';
      g.beginPath(); g.ellipse(sx, cy, rr * 1.15, rr * 0.85, 0, 0, 6.28); g.fill();
      g.fillStyle = '#FFD72E';
      g.beginPath(); g.arc(sx + rr * 0.75, cy - rr * 0.65, rr * 0.55, 0, 6.28); g.fill();
      g.fillStyle = '#FF1E3C';
      g.beginPath(); g.moveTo(sx + rr * 0.35, cy - rr * 1.05); g.lineTo(sx + rr * 0.55, cy - rr * 1.55); g.lineTo(sx + rr * 0.75, cy - rr * 1.12); g.lineTo(sx + rr * 0.95, cy - rr * 1.5); g.lineTo(sx + rr * 1.05, cy - rr * 1.0); g.fill();
      g.fillStyle = '#FF8C1A'; g.beginPath(); g.moveTo(sx + rr * 1.2, cy - rr * 0.75); g.lineTo(sx + rr * 1.75, cy - rr * 0.55); g.lineTo(sx + rr * 1.2, cy - rr * 0.4); g.fill();
      if (r > 4) { g.fillStyle = '#000'; g.fillRect(sx + rr * 0.72, cy - rr * 0.9, rr * 0.5, rr * 0.2); }
      if (win && r > 4) { g.font = `${rr * 1.2}px system-ui`; g.fillText('👑', sx + rr * 0.7, cy - rr * 1.3); }
    }
  }

  dispose() { window.removeEventListener('resize', this.resize); this.canvas.remove(); }
}
