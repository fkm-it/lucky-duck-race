/**
 * race3d.js — Pemapar perlumbaan 3D (Three.js).
 *
 * Prestasi: SATU InstancedMesh bagi setiap bahagian itik (badan, paruh, mata, sayap kiri/kanan,
 * kaki kiri/kanan) → 7 draw call untuk 1,000+ itik. Penonton juga InstancedMesh.
 * Pemapar ini hanya MEMAPARKAN pelan; ia tidak tahu dan tidak boleh mengubah pemilihan pemenang.
 */
import * as THREE from '../vendor/three.module.min.js';
import { computeLayout, progressAt } from './logic.js';

// ----------------------------------------------------------------------------- Geometri

function merge(list) {
  const pos = []; const nor = [];
  for (const { geo, m } of list) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

const M = (x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function duckGeometries(detail) {
  const seg = detail ? 18 : 10;
  // Kepala + ekor (kuning) — jaket hitam berasingan supaya pemenang boleh bertukar jaket EMAS
  const head = merge([
    { geo: new THREE.SphereGeometry(0.33, seg, seg * 0.75 | 0), m: M(0.44, 1.12, 0) },
    { geo: new THREE.ConeGeometry(0.2, 0.42, 8), m: M(-0.62, 0.86, 0, 1, 1, 0.7, 0, 0, 1.05) },
  ]);
  const jacket = merge([
    { geo: new THREE.SphereGeometry(0.5, seg, seg * 0.75 | 0), m: M(0, 0.62, 0, 1.27, 0.9, 0.97) },
    { geo: new THREE.CylinderGeometry(0.2, 0.26, 0.16, 12), m: M(0.36, 0.92, 0) }, // kolar
  ]);
  const beak = merge([
    { geo: new THREE.SphereGeometry(0.16, 10, 8), m: M(0.8, 1.08, 0, 1.4, 0.4, 1.1) },
    { geo: new THREE.SphereGeometry(0.13, 10, 8), m: M(0.76, 0.96, 0, 1.3, 0.35, 1, 0, 0, -0.35) }, // paruh bawah (terbuka)
  ]);
  // Mohawk merah: deretan kon condong ke belakang
  const spikes = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    spikes.push({ geo: new THREE.ConeGeometry(0.075, 0.34 + Math.sin(t * Math.PI) * 0.14, 6), m: M(0.62 - t * 0.42, 1.44 + Math.sin(t * Math.PI) * 0.03 - t * 0.04, 0, 1, 1, 0.55, 0, 0, 0.5 + t * 0.35) });
  }
  const mohawk = merge(spikes);
  // Cermin mata hitam: dua kanta + bingkai
  const shades = merge([
    { geo: new THREE.BoxGeometry(0.06, 0.13, 0.17), m: M(0.71, 1.22, 0.12) },
    { geo: new THREE.BoxGeometry(0.06, 0.13, 0.17), m: M(0.71, 1.22, -0.12) },
    { geo: new THREE.BoxGeometry(0.04, 0.03, 0.62), m: M(0.68, 1.27, 0) },
  ]);
  // Lengan jaket (sayap): pangsi di bahu
  const wingL = merge([{ geo: new THREE.SphereGeometry(0.3, 10, 8), m: M(-0.2, -0.02, 0.06, 1.35, 0.55, 0.32) }]);
  const wingR = merge([{ geo: new THREE.SphereGeometry(0.3, 10, 8), m: M(-0.2, -0.02, -0.06, 1.35, 0.55, 0.32) }]);
  // Kaki + but rock hitam
  const leg = merge([
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.26, 6), m: M(0, -0.13, 0) },
    { geo: new THREE.BoxGeometry(0.34, 0.14, 0.24), m: M(0.08, -0.31, 0) },
  ]);
  // Baju-T merah di dada
  const tee = merge([{ geo: new THREE.BoxGeometry(0.06, 0.36, 0.3), m: M(0.6, 0.66, 0, 1, 1, 1, 0, 0, -0.28) }]);
  // Gitar elektrik di belakang (badan + leher)
  const guitar = merge([
    { geo: new THREE.SphereGeometry(0.22, 10, 8), m: M(-0.42, 0.62, 0, 1, 1.25, 0.32, 0, 0, 0.9) },
    { geo: new THREE.BoxGeometry(0.06, 0.62, 0.05), m: M(-0.12, 0.95, 0, 1, 1, 1, 0, 0, 0.9) },
  ]);
  return { head, jacket, beak, mohawk, shades, wingL, wingR, legL: leg, legR: leg.clone(), tee, guitar };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bannerTex(text, bg, fg, checker = false) {
  return canvasTex(1024, 192, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, bg[0]); grd.addColorStop(1, bg[1]);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    if (checker) {
      const c = 32;
      for (let y = 0; y < h; y += c) for (let x = 0; x < w; x += c) if (((x + y) / c) % 2) { g.fillStyle = '#111'; g.fillRect(x, y, c, c); } else { g.fillStyle = '#fff'; g.fillRect(x, y, c, c); }
      g.fillStyle = bg[0]; g.fillRect(w * 0.2, 14, w * 0.6, h - 28);
    }
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 8, w, 6); g.fillRect(0, h - 14, w, 6);
    g.font = '900 120px "Bebas Neue", Impact, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 28; g.fillStyle = '#fff';
    g.fillText(text, w / 2, h / 2 + 6);
  });
}

const NEON = ['#FF1E3C', '#A855F7'];

// ----------------------------------------------------------------------------- Pemapar

export class Race3D {
  /**
   * @param {HTMLElement} host
   * @param {{count:number, quality:'high'|'low'}} opt
   */
  constructor(host, opt) {
    this.host = host;
    this.n = opt.count;
    this.high = opt.quality !== 'low';
    this.layout = computeLayout(this.n, 100);
    this.plan = null;
    this.phase = 'intro';
    this.raceT = 0;
    this.clock = 0;
    this.winnerSet = new Map(); // idx → rank (yang telah melintas)
    this.highlighted = new Set();
    this.focusIdx = -1;
    this.tmp = { m: new THREE.Matrix4(), base: new THREE.Matrix4(), part: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1) };
    this._initRenderer();
    this._initScene();
    this._initDucks();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  static supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  _initRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: this.high, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.high ? 1.75 : 1));
    r.shadowMap.enabled = this.high;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.host.appendChild(r.domElement);
    r.domElement.className = 'race-canvas';
    this.renderer = r;
  }

  _initScene() {
    const L = this.layout;
    const s = new THREE.Scene();
    this.scene = s;
    s.background = canvasTex(4, 256, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#000000'); grd.addColorStop(0.55, '#120621'); grd.addColorStop(1, '#2A0A1F');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    s.fog = new THREE.Fog(0x0a0510, 70 + L.width, 220 + L.width * 2);

    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    this.camPos = new THREE.Vector3(-30, 25, 40);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camera.position.copy(this.camPos);

    s.add(new THREE.HemisphereLight(0xc9c2ff, 0x1a0010, 0.8));
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-40, 30, 60); s.add(rim);
    const sun = new THREE.DirectionalLight(0xfff0f5, 1.6);
    sun.position.set(30, 60, 25);
    sun.castShadow = this.high;
    const ext = Math.max(30, L.width * 0.7 + 10);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 200 });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    s.add(sun); s.add(sun.target);
    this.sun = sun;

    const spot = new THREE.SpotLight(0xffd54a, 0, 45, Math.PI / 8, 0.45, 1.1);
    spot.position.set(L.finishX, 18, 0);
    s.add(spot); s.add(spot.target);
    this.spot = spot;

    // Rumput
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.55, metalness: 0.3 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02; grass.receiveShadow = true;
    s.add(grass);

    // Trek berlorong warna-warni
    const x0 = -L.depth - 14; const x1 = L.finishX + 30; const len = x1 - x0;
    const lanesTex = (glow) => canvasTex(8, Math.max(64, L.lanes * 16), (g, w, h) => {
      const lh = h / L.lanes;
      g.fillStyle = glow ? '#000' : '#141018'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < L.lanes; i++) {
        if (!glow) { g.fillStyle = i % 2 ? '#17121C' : '#120F17'; g.fillRect(0, i * lh, w, lh); }
        g.fillStyle = NEON[i % 2]; g.fillRect(0, i * lh, w, Math.max(1, lh * 0.1));
      }
    });
    const track = new THREE.Mesh(new THREE.PlaneGeometry(len, L.width), new THREE.MeshStandardMaterial({
      map: lanesTex(false), emissiveMap: lanesTex(true), emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.35 }));
    track.rotation.x = -Math.PI / 2; track.position.set(x0 + len / 2, 0, 0); track.receiveShadow = true;
    s.add(track);
    // Bahu trek
    [1, -1].forEach((sd) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 0.4), new THREE.MeshStandardMaterial({ color: sd > 0 ? 0xff1e3c : 0xa855f7, emissive: sd > 0 ? 0xff1e3c : 0xa855f7, emissiveIntensity: 2.2 }));
      curb.position.set(x0 + len / 2, 0.12, sd * (L.width / 2 + 0.25));
      curb.receiveShadow = true; s.add(curb);
    });

    // Garisan mula & penamat
    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(0.35, L.width), new THREE.MeshBasicMaterial({ color: 0xa855f7 }));
    startLine.rotation.x = -Math.PI / 2; startLine.position.set(0, 0.02, 0); s.add(startLine);
    const checker = canvasTex(64, 512, (g, w, h) => {
      const c = 16;
      for (let y = 0; y < h; y += c) for (let x = 0; x < w; x += c) { g.fillStyle = ((x + y) / c) % 2 ? '#111' : '#fff'; g.fillRect(x, y, c, c); }
    });
    checker.wrapT = THREE.RepeatWrapping; checker.repeat.set(1, Math.max(1, L.width / 8));
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, L.width), new THREE.MeshBasicMaterial({ map: checker }));
    fin.rotation.x = -Math.PI / 2; fin.position.set(L.finishX + 0.7, 0.025, 0); s.add(fin);

    this._arch(0, 'START', ['#1A0B2E', '#0A0510'], '#A855F7');
    this.finishArch = this._arch(L.finishX + 0.7, 'FINISH', ['#2A0510', '#0A0205'], '#FF1E3C');

    this._stands(x0, x1);
    this._lightTowers(x0, x1);
    this._ledWall(x0, x1);
    this._lasers(x0, x1);
    this._smoke(x0, x1);
  }

  /** Dinding LED gergasi di belakang penonton — penyama bunyi beranimasi + jenama. */
  _ledWall(x0, x1) {
    const L = this.layout;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    this.ledCtx = c.getContext('2d');
    this.ledTex = new THREE.CanvasTexture(c); this.ledTex.colorSpace = THREE.SRGBColorSpace;
    const len = x1 - x0;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.9, len * 0.9 / 4), new THREE.MeshBasicMaterial({ map: this.ledTex, toneMapped: false, fog: false }));
    wall.position.set((x0 + x1) / 2, 6 + len * 0.9 / 8 + 6, -(L.width / 2 + 22));
    this.scene.add(wall);
    this.ledT = 0;
    this._drawLed(0);
  }

  _drawLed(t) {
    const g = this.ledCtx; const w = 1024; const h = 256;
    g.fillStyle = '#05030A'; g.fillRect(0, 0, w, h);
    const bars = 48; const bw = w / bars;
    const hype = this.phase === 'race' ? 1 : this.phase === 'done' ? 1.2 : 0.5;
    for (let i = 0; i < bars; i++) {
      const v = (0.25 + 0.75 * Math.abs(Math.sin(t * (2 + (i % 7) * 0.6) + i * 0.7))) * hype;
      const bh = Math.min(h, v * h * 0.9);
      const grd = g.createLinearGradient(0, h, 0, h - bh);
      grd.addColorStop(0, '#7C3AED'); grd.addColorStop(0.6, '#FF1E3C'); grd.addColorStop(1, '#FFD54A');
      g.fillStyle = grd; g.fillRect(i * bw + 2, h - bh, bw - 4, bh);
    }
    g.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2); // grid LED
    g.font = '900 120px "Bebas Neue", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#FF1E3C'; g.shadowBlur = 30; g.fillStyle = '#fff';
    g.fillText(this.phase === 'done' ? 'ROCKSTAR WINNERS!' : 'ROCK THE DRAW', w / 2, h / 2);
    g.shadowBlur = 0;
    this.ledTex.needsUpdate = true;
  }

  /** Pancaran laser dari menara pentas (silinder nipis, aditif). */
  _lasers(x0, x1) {
    const L = this.layout;
    this.lasers = [];
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true); geo.translate(0, 0.5, 0);
    const towers = [x0 + 14, (x0 + x1) / 2, x1 - 12];
    towers.forEach((x, ti) => {
      for (let k = 0; k < 3; k++) {
        const col = (ti + k) % 2 ? 0xa855f7 : 0xff1e3c;
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
        m.position.set(x, 21, -(L.width / 2 + 17));
        m.scale.set(this.high ? 1 : 1.6, 90, this.high ? 1 : 1.6);
        this.scene.add(m);
        this.lasers.push({ m, ph: ti * 1.7 + k * 2.1, sp: 0.5 + k * 0.25 });
      }
    });
    // Kon lampu sorot (aditif)
    const coneGeo = new THREE.ConeGeometry(7, 30, 24, 1, true); coneGeo.translate(0, -15, 0);
    this.spots = towers.map((x, i) => {
      const m = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xa855f7 : 0xffffff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.position.set(x, 23, -(L.width / 2 + 15));
      this.scene.add(m);
      return { m, ph: i * 2 };
    });
    // Lampu berwarna sebenar (merah & ungu) yang bergerak
    this.colorLights = [0xff1e3c, 0xa855f7].map((c) => { const l = new THREE.PointLight(c, 90, 60, 1.6); l.position.set(0, 12, 0); this.scene.add(l); return l; });
  }

  /** Asap pentas: titik lembut beraditif yang hanyut perlahan di atas trek. */
  _smoke(x0, x1) {
    const L = this.layout;
    const n = this.high ? 160 : 70;
    const pos = new Float32Array(n * 3);
    this.smokeSeed = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.random() * (x1 - x0); const z = (Math.random() - 0.5) * (L.width + 30); const y = 0.4 + Math.random() * 2.2;
      pos.set([x, y, z], i * 3); this.smokeSeed.push({ x, y, z, sp: 0.2 + Math.random() * 0.6, ph: Math.random() * 6.28 });
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tex = canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(0.5, 'rgba(255,255,255,.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
    this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 9, color: 0xc9b6ff, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.scene.add(this.smoke);
  }

  _animateShow(dt) {
    const t = this.clock;
    const L = this.layout;
    if (this.lasers) this.lasers.forEach((l) => { l.m.rotation.set(Math.sin(t * l.sp + l.ph) * 0.9 + 1.25, 0, Math.cos(t * l.sp * 0.8 + l.ph) * 0.7); });
    if (this.spots) this.spots.forEach((sp) => { sp.m.rotation.set(Math.sin(t * 0.6 + sp.ph) * 0.35 - 0.35, 0, Math.cos(t * 0.5 + sp.ph) * 0.45); });
    if (this.colorLights) {
      const cx = this.camLook ? this.camLook.x : 0;
      this.colorLights[0].position.set(cx + Math.sin(t * 0.9) * 18, 10, Math.cos(t * 0.7) * L.width * 0.5);
      this.colorLights[1].position.set(cx + Math.cos(t * 0.8) * 18, 10, Math.sin(t * 0.6) * L.width * 0.5);
    }
    if (this.smoke) {
      const a = this.smoke.geometry.attributes.position;
      for (let i = 0; i < this.smokeSeed.length; i++) {
        const sd = this.smokeSeed[i];
        a.array[i * 3] = sd.x + Math.sin(t * 0.15 * sd.sp + sd.ph) * 4;
        a.array[i * 3 + 1] = sd.y + Math.sin(t * 0.4 * sd.sp + sd.ph) * 0.4;
      }
      a.needsUpdate = true;
    }
    this.ledT += dt;
    if (this.ledT > 0.1) { this.ledT = 0; this._drawLed(t); }
  }

  _arch(x, text, bg, neon = '#FF1E3C') {
    const L = this.layout; const s = this.scene;
    const g = new THREE.Group();
    const half = L.width / 2 + 1.2;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.3, metalness: 0.8, emissive: new THREE.Color(neon), emissiveIntensity: 0.35 });
    [1, -1].forEach((sd) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 12), postMat);
      post.position.set(x, 4, sd * half); post.castShadow = this.high; g.add(post);
    });
    const span = half * 2 + 0.8;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, span), postMat);
    frame.position.set(x, 8.2, 0); g.add(frame);
    const tex = bannerTex(text, bg, neon, text === 'FINISH');
    [-1, 1].forEach((sd) => {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.2, 1.8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      face.rotation.y = sd * Math.PI / 2;
      face.position.set(x + sd * 0.26, 8.2, 0);
      g.add(face);
    });
    s.add(g);
    return g;
  }

  _stands(x0, x1) {
    const L = this.layout; const s = this.scene;
    const steps = 6; const stepH = 0.9; const stepD = 1.6;
    const standMat = new THREE.MeshStandardMaterial({ color: 0x17141f, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.4, metalness: 0.6, emissive: 0xff1e3c, emissiveIntensity: 0.25 });
    const len = x1 - x0;
    const spacing = this.high ? 0.95 : 1.4;
    const perRow = Math.floor(len / spacing);
    const total = perRow * steps; // satu sisi sahaja (sisi bertentangan kamera) supaya pandangan tidak terhalang
    const crowdGeo = new THREE.CapsuleGeometry(0.28, 0.5, 3, 8);
    const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), total);
    const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.9 }), total);
    const col = new THREE.Color();
    const SHIRTS = [0x111111, 0x1f1f1f, 0x7f1d1d, 0x111111, 0x4c1d95, 0x222222, 0xb91c1c, 0x111111, 0x6d28d9];
    const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
    this.crowdBase = [];
    let k = 0;
    [-1].forEach((sd) => {
      const zEdge = sd * (L.width / 2 + 3.5);
      for (let i = 0; i < steps; i++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, stepH * (i + 1), stepD), standMat);
        step.position.set(x0 + len / 2, (stepH * (i + 1)) / 2, zEdge + sd * i * stepD);
        step.receiveShadow = true; s.add(step);
        for (let j = 0; j < perRow; j++) {
          const x = x0 + (j + 0.5) * spacing + (Math.random() - 0.5) * 0.3;
          const y = stepH * (i + 1) + 0.55;
          const z = zEdge + sd * i * stepD;
          this.crowdBase.push({ x, y, z, ph: Math.random() * 6.28, sp: 4 + Math.random() * 5, amp: 0.05 + Math.random() * 0.15 });
          crowd.setColorAt(k, col.setHex(SHIRTS[(Math.random() * SHIRTS.length) | 0]));
          heads.setColorAt(k, col.setHex(SKIN[(Math.random() * SKIN.length) | 0]));
          k++;
        }
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, steps * stepD + 1), roofMat);
      roof.position.set(x0 + len / 2, stepH * steps + 4.5, zEdge + sd * ((steps - 1) * stepD) / 2);
      s.add(roof);
    });
    crowd.count = k; heads.count = k;
    this.crowd = crowd; this.heads = heads;
    s.add(crowd); s.add(heads);
    this.cheer = 0.3;
    this._updateCrowd(0);
  }

  _lightTowers(x0, x1) {
    const L = this.layout; const s = this.scene;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a33, metalness: 0.9, roughness: 0.3 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3 });
    [x0 + 10, (x0 + x1) / 2, x1 - 10].forEach((x) => [-1].forEach((sd) => {
      const z = sd * (L.width / 2 + 17);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 22, 8), mat);
      pole.position.set(x, 11, z); s.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 0.6), lamp);
      head.position.set(x, 22, z); head.lookAt(x, 0, 0); s.add(head);
    }));
  }

  _initDucks() {
    const n = this.n;
    const geos = duckGeometries(this.high && n <= 600);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.0, emissive: 0x8a6400, emissiveIntensity: 0.85 });
    const leather = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.35 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.45 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.12, metalness: 0.6 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.25, metalness: 0.4 });
    const mk = (geo, mat, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = shadow && this.high;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.parts = {
      head: mk(geos.head, yellow, true), jacket: mk(geos.jacket, leather, true), beak: mk(geos.beak, orange, false),
      mohawk: mk(geos.mohawk, new THREE.MeshStandardMaterial({ color: 0xff1e3c, emissive: 0x8a0010, emissiveIntensity: 0.6, roughness: 0.5 }), false),
      shades: mk(geos.shades, black, false),
      wingL: mk(geos.wingL, leather, false), wingR: mk(geos.wingR, leather, false),
      legL: mk(geos.legL, boots, true), legR: mk(geos.legR, boots, true),
      tee: mk(geos.tee, new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.8 }), false),
      guitar: mk(geos.guitar, new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.2, metalness: 0.4, emissive: 0x3a0008 }), false),
    };
    this.JACKET = new THREE.Color(0x15151a);
    const c = new THREE.Color();
    this.baseColors = [];
    for (let i = 0; i < n; i++) {
      c.setHSL(0.14 + (Math.random() - 0.5) * 0.02, 1, 0.6 + Math.random() * 0.05);
      this.baseColors.push(c.clone());
      this.parts.head.setColorAt(i, c);
      this.parts.jacket.setColorAt(i, this.JACKET); this.parts.wingL.setColorAt(i, this.JACKET); this.parts.wingR.setColorAt(i, this.JACKET);
    }
    this.x = new Float32Array(n);
    this.prevX = new Float32Array(n);
    this.gait = new Float32Array(n);
    this.phaseOff = new Float32Array(n).map(() => Math.random() * 6.28);
    for (let i = 0; i < n; i++) { this.x[i] = this.layout.pos[i].startX; this.prevX[i] = this.x[i]; }

    // Mahkota, gelang cahaya & alur sorotan untuk pemenang (dicipta bila perlu)
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.22, emissive: 0x7a5200, emissiveIntensity: 0.6 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.badges = new Map();
    this.wingPivotL = M(0.0, 0.78, 0.48);
    this.wingPivotR = M(0.0, 0.78, -0.48);
    this.hipL = M(0.02, 0.36, 0.2);
    this.hipR = M(0.02, 0.36, -0.2);
    this._writeDucks(0);
  }

  _crown() {
    const g = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.2, 16, 1, true), this.goldMat);
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), this.goldMat);
      sp.position.set(Math.cos(a) * 0.24, 0.2, Math.sin(a) * 0.24); g.add(sp);
      const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), new THREE.MeshStandardMaterial({ color: [0xef4444, 0x3b82f6, 0x22c55e][i % 3], emissive: 0x220000 }));
      jewel.position.set(Math.cos(a) * 0.25, 0.04, Math.sin(a) * 0.25); g.add(jewel);
    }
    g.scale.setScalar(1.15);
    return g;
  }

  _badge(i, withCrown) {
    let b = this.badges.get(i);
    if (b) { if (withCrown && !b.crown) { b.crown = this._crown(); this.scene.add(b.crown); } return b; }
    b = {};
    b.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 32), this.ringMat);
    b.ring.rotation.x = -Math.PI / 2;
    this.scene.add(b.ring);
    if (withCrown) {
      b.crown = this._crown(); this.scene.add(b.crown);
      b.beam = new THREE.Mesh(new THREE.ConeGeometry(1.4, 14, 24, 1, true), this.beamMat);
      this.scene.add(b.beam);
    }
    this.badges.set(i, b);
    return b;
  }

  // ----------------------------------------------------------------- API pengawal

  setPlan(plan) { this.plan = plan; }

  setPhase(p) {
    this.phase = p;
    if (p === 'race') this.cheer = 1;
    if (p === 'done') this.cheer = 1.4;
  }

  /** Tanda itik i sebagai sedang diserlahkan (pilihan admin: semasa perlumbaan). */
  highlight(i) { this.highlighted.add(i); this._badge(i, false); }

  /** Itik i (kedudukan rank) melintasi garisan penamat. */
  markWinner(i, rank) {
    this.winnerSet.set(i, rank);
    this._badge(i, true);
    const gold = new THREE.Color(0xffc83d);
    this.parts.jacket.setColorAt(i, gold); this.parts.wingL.setColorAt(i, gold); this.parts.wingR.setColorAt(i, gold);
    ['jacket', 'wingL', 'wingR'].forEach((k) => { this.parts[k].instanceColor.needsUpdate = true; });
    this.focusIdx = i;
    this.spot.intensity = 400;
  }

  focus(i) { this.focusIdx = i; }

  leaders(k = 5) {
    const idx = Array.from({ length: this.n }, (_, i) => i);
    idx.sort((a, b) => this.x[b] - this.x[a]);
    return idx.slice(0, k);
  }

  screenPos(i, yOff = 1.9) {
    const v = this.tmp.v.set(this.x[i], yOff, this.layout.pos[i].z).project(this.camera);
    if (v.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ----------------------------------------------------------------- Kemas kini

  _duckX(i, t) {
    const L = this.layout;
    const p = this.plan;
    const sx = L.pos[i].startX;
    if (!p) return sx;
    const d = p.ducks[i];
    if (t >= d.finish) return L.finishX + 4.5 * (1 - Math.exp(-(t - d.finish) * 1.1)) + 0.0;
    return sx + progressAt(p, i, t) * (L.finishX - sx);
  }

  _writeDucks(dt) {
    const { m, base, part, q, e, v, s } = this.tmp;
    const P = this.parts; const L = this.layout;
    const t = this.raceT;
    const racing = this.phase === 'race';
    const avgSpeed = this.plan ? L.finishX / this.plan.T : 7;
    for (let i = 0; i < this.n; i++) {
      const pos = L.pos[i];
      if (racing || this.phase === 'done') this.x[i] = this._duckX(i, t);
      const vx = dt > 0 ? (this.x[i] - this.prevX[i]) / dt : 0;
      this.prevX[i] = this.x[i];
      const moving = Math.min(1.4, Math.max(0, vx / avgSpeed));
      const isWin = this.winnerSet.has(i);
      const cele = this.phase === 'done' && isWin;
      this.gait[i] += dt * (moving > 0.05 ? 7 + moving * 9 : (cele ? 9 : 2.2));
      const ph = this.gait[i] + this.phaseOff[i];
      const bob = moving > 0.05 ? Math.abs(Math.sin(ph)) * 0.22 * Math.min(1, moving + 0.3) : (cele ? Math.abs(Math.sin(ph)) * 0.35 : Math.sin(ph) * 0.03 + 0.03);
      const lean = -0.14 * Math.min(1, moving);
      const sway = Math.sin(ph) * 0.07 * Math.min(1, moving + 0.2);
      e.set(sway, cele ? Math.sin(this.clock * 2 + i) * 0.4 : Math.sin(ph * 0.5) * 0.05, lean);
      q.setFromEuler(e);
      base.compose(v.set(this.x[i], bob, pos.z), q, s);
      P.head.setMatrixAt(i, base); P.jacket.setMatrixAt(i, base); P.beak.setMatrixAt(i, base); P.mohawk.setMatrixAt(i, base);
      P.shades.setMatrixAt(i, base); P.tee.setMatrixAt(i, base); P.guitar.setMatrixAt(i, base);
      const flap = (moving > 0.05 ? Math.sin(ph * 2) * 0.7 : (cele ? Math.sin(ph * 2.5) * 1.1 : Math.sin(ph) * 0.08)) + 0.15;
      part.makeRotationX(flap); m.multiplyMatrices(base, this.wingPivotL).multiply(part); P.wingL.setMatrixAt(i, m);
      part.makeRotationX(-flap); m.multiplyMatrices(base, this.wingPivotR).multiply(part); P.wingR.setMatrixAt(i, m);
      const swing = moving > 0.05 ? Math.sin(ph) * 0.85 : (cele ? Math.sin(ph) * 0.4 : 0);
      part.makeRotationZ(swing); m.multiplyMatrices(base, this.hipL).multiply(part); P.legL.setMatrixAt(i, m);
      part.makeRotationZ(-swing); m.multiplyMatrices(base, this.hipR).multiply(part); P.legR.setMatrixAt(i, m);

      const b = this.badges.get(i);
      if (b) {
        b.ring.position.set(this.x[i], 0.04, pos.z);
        b.ring.scale.setScalar(1 + Math.sin(this.clock * 4) * 0.1);
        if (b.crown) { b.crown.position.set(this.x[i] + 0.35, bob + 1.85, pos.z); b.crown.rotation.y = this.clock * 1.5; }
        if (b.beam) b.beam.position.set(this.x[i], 7, pos.z);
      }
    }
    for (const k in P) P[k].instanceMatrix.needsUpdate = true;
  }

  _updateCrowd(dt) {
    const m = this.tmp.m; const v = this.tmp.v; const q = this.tmp.q.identity(); const s = this.tmp.s;
    const amp = this.cheer;
    for (let k = 0; k < this.crowdBase.length; k++) {
      const c = this.crowdBase[k];
      const y = c.y + Math.max(0, Math.sin(this.clock * c.sp + c.ph)) * c.amp * amp * 2;
      m.compose(v.set(c.x, y, c.z), q, s); this.crowd.setMatrixAt(k, m);
      m.compose(v.set(c.x, y + 0.62, c.z), q, s); this.heads.setMatrixAt(k, m);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  _updateCamera(dt) {
    const L = this.layout;
    const W = L.width;
    const dist = Math.max(16, W * 0.75 + 8);
    const look = this.tmp.v;
    let pos; let target;
    if (this.phase === 'intro' || this.phase === 'countdown') {
      const a = this.clock * (this.phase === 'intro' ? 0.12 : 0.05);
      const cx = -L.depth / 2;
      const r = dist * (this.phase === 'intro' ? 1.15 : 0.95);
      pos = new THREE.Vector3(cx - Math.cos(a) * r * 0.9, dist * 0.55, Math.sin(a * 0.7) * r * 0.25 + r * 0.75);
      target = new THREE.Vector3(cx + 6, 0, 0);
    } else if (this.phase === 'race') {
      let lead = -Infinity; let sum = 0;
      for (let i = 0; i < this.n; i++) { if (this.x[i] > lead) lead = this.x[i]; sum += this.x[i]; }
      const mean = sum / this.n;
      const fx = Math.min(L.finishX, lead);
      const near = Math.max(0, (fx - (L.finishX - 22)) / 22); // 0 → 1 menghampiri penamat
      const lx = fx - 5 * (1 - near) - (fx - mean) * 0.25 * (1 - near);
      pos = new THREE.Vector3(lx - dist * 0.55 + near * (dist * 0.5 + 12), dist * (0.5 - near * 0.18), dist * (0.78 - near * 0.12));
      target = new THREE.Vector3(lx + 6 - near * 3, 0, 0);
    } else {
      const fi = this.focusIdx >= 0 ? this.focusIdx : 0;
      const fx = this.x[fi]; const fz = L.pos[fi].z;
      const a = this.clock * 0.25;
      pos = new THREE.Vector3(fx + 6 + Math.cos(a) * 3, 4.5, fz + 8 + Math.sin(a) * 2);
      target = new THREE.Vector3(fx, 1, fz);
    }
    const k = 1 - Math.exp(-dt * (this.phase === 'done' ? 1.4 : 2.4));
    this.camPos.lerp(pos, k);
    this.camLook.lerp(target, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Bayang mengikut kamera
    this.sun.target.position.set(this.camLook.x, 0, 0);
    this.sun.position.set(this.camLook.x + 30, 60, 25);
    if (this.focusIdx >= 0) {
      this.spot.position.set(this.x[this.focusIdx], 18, L.pos[this.focusIdx].z + 2);
      this.spot.target.position.set(this.x[this.focusIdx], 0, L.pos[this.focusIdx].z);
    }
  }

  /** Dipanggil setiap bingkai oleh pengawal. */
  frame(dt, raceT) {
    this.clock += dt;
    this.raceT = raceT;
    this._writeDucks(dt);
    if (this.high || ((this.clock * 30) | 0) % 2 === 0) this._updateCrowd(dt);
    this._updateCamera(dt);
    this._animateShow(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
    });
    if (this.scene.background && this.scene.background.dispose) this.scene.background.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

