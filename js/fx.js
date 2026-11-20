/**
 * fx.js — Konfeti & bunga api pada kanvas 2D lapisan atas (ringan, berfungsi dengan mod 3D atau 2D).
 */
const COLORS = ['#FFD23F', '#FF6B6B', '#4ECDC4', '#5B8CFF', '#B38CFF', '#FF9F1C', '#2EC4B6', '#FFFFFF'];

export class Fx {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.parts = [];
    this.rockets = [];
    this.running = false;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.c.width = this.c.clientWidth * dpr;
    this.c.height = this.c.clientHeight * dpr;
  }

  confetti(count = 220, originX = 0.5) {
    const W = this.c.width; const H = this.c.height;
    for (let i = 0; i < count; i++) {
      this.parts.push({
        kind: 'conf', x: W * (originX + (Math.random() - 0.5) * 0.9), y: -20 - Math.random() * H * 0.4,
        vx: (Math.random() - 0.5) * 4 * this.dpr, vy: (2 + Math.random() * 4) * this.dpr,
        w: (6 + Math.random() * 8) * this.dpr, h: (8 + Math.random() * 10) * this.dpr,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, color: COLORS[(Math.random() * COLORS.length) | 0], life: 1, decay: 0.0025 + Math.random() * 0.003,
      });
    }
    this.start();
  }

  firework(x = Math.random(), y = 0.15 + Math.random() * 0.3) {
    const W = this.c.width; const H = this.c.height;
    this.rockets.push({ x: W * x, y: H, tx: W * x, ty: H * y, vy: -H / 55, color: COLORS[(Math.random() * COLORS.length) | 0] });
    this.start();
  }

  explode(x, y, color) {
    const n = 70 + ((Math.random() * 40) | 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2; const s = (2 + Math.random() * 5) * this.dpr;
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color: Math.random() < 0.3 ? '#FFFFFF' : color, life: 1, decay: 0.012 + Math.random() * 0.012, size: (1.6 + Math.random() * 2) * this.dpr });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.step();
      if (this.parts.length || this.rockets.length) requestAnimationFrame(loop);
      else { this.running = false; this.g.clearRect(0, 0, this.c.width, this.c.height); }
    };
    requestAnimationFrame(loop);
  }

  step() {
    const g = this.g; const H = this.c.height;
    g.clearRect(0, 0, this.c.width, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.y += r.vy;
      g.fillStyle = r.color;
      g.beginPath(); g.arc(r.x, r.y, 3 * this.dpr, 0, 6.28); g.fill();
      if (r.y <= r.ty) { this.explode(r.x, r.y, r.color); this.rockets.splice(i, 1); }
    }
    g.globalCompositeOperation = 'source-over';
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= p.decay;
      if (p.life <= 0 || p.y > H + 40) { this.parts.splice(i, 1); continue; }
      if (p.kind === 'conf') {
        p.x += p.vx + Math.sin(p.rot) * 0.6; p.y += p.vy; p.rot += p.vr; p.vx *= 0.99;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.globalAlpha = Math.min(1, p.life * 2);
        g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
        g.restore();
      } else {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06 * this.dpr; p.vx *= 0.98; p.vy *= 0.98;
        g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.28); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  clear() { this.parts = []; this.rockets = []; }

  destroy() { this.running = false; this.clear(); window.removeEventListener('resize', this.resize); }
}
