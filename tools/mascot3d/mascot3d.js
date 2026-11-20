/**
 * mascot3d.js — Model 3D Rockstar Duck (Three.js) untuk menjana imej maskot PNG lutsinar.
 * Digunakan oleh tools/render-mascots.py (pelayar tanpa kepala). Bukan sebahagian aplikasi.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SIZE = 1024;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

// ---------------------------------------------------------------- lampu konsert
const key = new THREE.DirectionalLight(0xfff3e0, 2.6); key.position.set(6, 9, 10); scene.add(key);
const fill = new THREE.DirectionalLight(0xc7d2fe, 0.7); fill.position.set(-6, 3, 8); scene.add(fill);
const rimR = new THREE.DirectionalLight(0xff1e3c, 3.2); rimR.position.set(-8, 5, -6); scene.add(rimR);
const rimP = new THREE.DirectionalLight(0xa855f7, 3.0); rimP.position.set(8, 6, -7); scene.add(rimP);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a1030, 0.35));

// ---------------------------------------------------------------- bahan
const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const MAT = {
  yellow: new THREE.MeshPhysicalMaterial({ color: 0xffbf00, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.4 }),
  orange: new THREE.MeshPhysicalMaterial({ color: 0xff8a1c, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  mouth: new THREE.MeshStandardMaterial({ color: 0x8b0f1d, roughness: 0.6 }),
  tongue: new THREE.MeshPhysicalMaterial({ color: 0xff6b7a, roughness: 0.35, clearcoat: 0.5 }),
  leather: new THREE.MeshPhysicalMaterial({ color: 0x141418, roughness: 0.32, metalness: 0.15, clearcoat: 0.85, clearcoatRoughness: 0.28 }),
  leather2: new THREE.MeshPhysicalMaterial({ color: 0x0c0c10, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
  frame: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0d, roughness: 0.25, clearcoat: 0.9 }),
  red: new THREE.MeshPhysicalMaterial({ color: 0xc8001c, roughness: 0.5, clearcoat: 0.3 }),
  shirt: new THREE.MeshStandardMaterial({ color: 0xa3122a, roughness: 0.85 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 1, roughness: 0.18 }),
  sole: new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.8 }),
  gold: new THREE.MeshPhysicalMaterial({ color: 0xf2c230, metalness: 1, roughness: 0.16, clearcoat: 0.6 }),
  neck: new THREE.MeshStandardMaterial({ color: 0x3b2416, roughness: 0.55 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.4 }),
};
MAT.sunburst = new THREE.MeshPhysicalMaterial({
  map: canvasTex(512, 512, (g, w, h) => {
    const r = g.createRadialGradient(w * 0.55, h * 0.55, 20, w * 0.5, h * 0.5, w * 0.6);
    r.addColorStop(0, '#FFB347'); r.addColorStop(0.35, '#F2461E'); r.addColorStop(0.75, '#9B0F1A'); r.addColorStop(1, '#2A0306');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05,
});

// ---------------------------------------------------------------- pembantu
const UP = new THREE.Vector3(0, 1, 0);
function mesh(geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz); return m;
}
const sph = (r, seg = 48) => new THREE.SphereGeometry(r, seg, seg * 0.75 | 0);
/** Kapsul antara dua titik (lengan/kaki). */
function limb(a, b, r, mat) {
  const A = new THREE.Vector3(...a); const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 12, 24), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return m;
}
function extrude(shape, depth, mat, bevel = 0.04) {
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 24 }), mat);
}
function studsArc(g, pts, r = 0.055) { pts.forEach((p) => g.add(mesh(sph(r, 16), MAT.silver, ...p))); }

// ---------------------------------------------------------------- bahagian
function buildHead() {
  const g = new THREE.Group();
  g.add(mesh(sph(1.05, 64), MAT.yellow, 0, 0, 0, 1, 0.97, 1));
  // paruh terbuka (menjerit rock)
  g.add(mesh(sph(0.5), MAT.orange, 1.08, -0.22, 0, 1.45, 0.42, 1.15, 0, 0, 0.12));
  g.add(mesh(sph(0.45), MAT.orange, 0.98, -0.62, 0, 1.3, 0.38, 1.05, 0, 0, -0.32));
  g.add(mesh(sph(0.36), MAT.mouth, 0.98, -0.42, 0, 1.2, 0.5, 0.95));
  g.add(mesh(sph(0.26), MAT.tongue, 1.1, -0.55, 0, 1.15, 0.32, 0.9, 0, 0, -0.2));
  // cermin mata hitam
  [0.42, -0.42].forEach((z) => {
    const lens = mesh(new RoundedBoxGeometry(0.18, 0.56, 0.78, 6, 0.1), MAT.lens, 0.92, 0.26, z * 1.02, 1, 1, 1, 0, z > 0 ? -0.42 : 0.42, -0.08);
    g.add(lens);
  });
  g.add(mesh(new RoundedBoxGeometry(0.1, 0.08, 0.32, 3, 0.03), MAT.frame, 1.04, 0.38, 0));
  g.add(mesh(new RoundedBoxGeometry(0.1, 0.07, 2.1, 3, 0.03), MAT.frame, 0.86, 0.48, 0, 1, 1, 1, 0, 0, -0.08));
  [0.9, -0.9].forEach((z) => g.add(mesh(new RoundedBoxGeometry(1.0, 0.07, 0.07, 2, 0.03), MAT.frame, 0.25, 0.42, z, 1, 1, 1, 0, 0, -0.05)));
  // kilauan pada kanta
  [0.42, -0.42].forEach((z) => g.add(mesh(new THREE.PlaneGeometry(0.18, 0.06), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }), 1.02, 0.42, z * 1.02 + (z > 0 ? -0.12 : 0.12), 1, 1, 1, 0, Math.PI / 2, -0.5)));
  // mohawk: deretan duri rambut merah
  const rnd = mulberry(7);
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const ang = Math.PI * (0.22 + t * 0.7); // dari depan-atas ke belakang
    const base = new THREE.Vector3(Math.cos(ang) * 0.95, Math.sin(ang) * 0.95, (rnd() - 0.5) * 0.28);
    const len = 0.55 + Math.sin(t * Math.PI) * 0.75 + rnd() * 0.25;
    const dir = base.clone().normalize().add(new THREE.Vector3(-0.35, 0.15, (rnd() - 0.5) * 0.25)).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1 + rnd() * 0.05, len, 10), MAT.red);
    cone.position.copy(base.clone().add(dir.clone().multiplyScalar(len / 2 - 0.08)));
    cone.quaternion.setFromUnitVectors(UP, dir);
    g.add(cone);
  }
  return g;
}

function boltShape(s = 1) {
  const sh = new THREE.Shape();
  [[0.1, 0.55], [-0.2, 0.0], [0.0, 0.0], [-0.14, -0.55], [0.26, 0.1], [0.05, 0.1], [0.22, 0.55]].forEach(([x, y], i) => (i ? sh.lineTo(x * s, y * s) : sh.moveTo(x * s, y * s)));
  sh.closePath();
  return sh;
}

function buildTorso() {
  const g = new THREE.Group();
  // baju-T merah (kelihatan di bukaan jaket) + kilat putih
  g.add(mesh(sph(1.0), MAT.shirt, 0.22, 0.12, 0, 1.08, 1.12, 0.8));
  const bolt = extrude(boltShape(0.9), 0.04, MAT.white, 0.015);
  bolt.position.set(1.06, 0.12, 0.0); bolt.rotation.set(0, Math.PI / 2, 0); g.add(bolt);
  // jaket kulit (dua sisi, bukaan di depan)
  [1, -1].forEach((sd) => {
    const half = mesh(new THREE.SphereGeometry(1.05, 64, 48, sd > 0 ? 0.25 : Math.PI + 0.0, Math.PI - 0.25, 0, Math.PI), MAT.leather, 0, 0, 0, 1.2, 1.18, 1.08, 0, sd > 0 ? 0 : 0, 0);
    half.rotation.y = sd > 0 ? -Math.PI / 2 + 0.0 : -Math.PI / 2;
    g.add(half);
  });
  // lapel
  [1, -1].forEach((sd) => {
    const sh = new THREE.Shape(); sh.moveTo(0, 0.75); sh.lineTo(0.42 * sd, 0.55); sh.lineTo(0.18 * sd, -0.35); sh.lineTo(0, -0.1); sh.closePath();
    const l = extrude(sh, 0.06, MAT.leather2, 0.03);
    l.position.set(1.12, 0.3, 0.32 * sd); l.rotation.set(0, Math.PI / 2 + 0.55 * sd, 0); g.add(l);
  });
  // kolar & stud
  g.add(mesh(new THREE.TorusGeometry(0.62, 0.13, 16, 48, Math.PI * 1.35), MAT.leather2, 0.05, 1.08, 0, 1, 1, 1, Math.PI / 2, 0, Math.PI * 0.82));
  const studs = [];
  for (let i = 0; i < 9; i++) { const a = -1.1 + i * 0.275; studs.push([Math.cos(a) * 0.7 + 0.05, 1.22, Math.sin(a) * 0.72]); }
  studsArc(g, studs, 0.06);
  for (let i = 0; i < 6; i++) { studs.length = 0; }
  // zip & rantai
  for (let i = 0; i < 7; i++) g.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.1), MAT.silver, 1.18 - i * 0.02, 0.3 - i * 0.14, 0.42));
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    g.add(mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 16), MAT.silver, 0.85 - t * 0.6, -0.95 - Math.sin(t * Math.PI) * 0.22, 0.75 - t * 0.2, 1, 1, 1, i % 2 ? Math.PI / 2 : 0, 0.4, 0));
  }
  return g;
}

function buildLegs(stride = 0) {
  const g = new THREE.Group();
  // seluar pendek kulit
  g.add(mesh(sph(0.95), MAT.leather2, 0, 0, 0, 1.05, 0.55, 1.0));
  [1, -1].forEach((sd, i) => {
    const swing = stride * (i ? -1 : 1);
    const hip = [0.0 + swing * 0.1, -0.2, 0.45 * sd];
    const ankle = [0.0 + swing * 0.75, -1.1 + Math.abs(swing) * 0.12, 0.5 * sd];
    g.add(limb(hip, ankle, 0.22, MAT.yellow));
    // but rock
    const boot = new THREE.Group();
    boot.add(mesh(new RoundedBoxGeometry(1.0, 0.55, 0.62, 6, 0.2), MAT.leather, 0.18, 0, 0));
    boot.add(mesh(new RoundedBoxGeometry(0.62, 0.55, 0.56, 6, 0.18), MAT.leather, -0.02, 0.38, 0));
    boot.add(mesh(new RoundedBoxGeometry(1.08, 0.16, 0.68, 4, 0.06), MAT.sole, 0.2, -0.3, 0));
    boot.add(mesh(new THREE.BoxGeometry(0.66, 0.07, 0.6), MAT.black, -0.02, 0.48, 0));
    boot.add(mesh(new RoundedBoxGeometry(0.2, 0.12, 0.05, 2, 0.02), MAT.silver, -0.02, 0.48, 0.31 * sd));
    studsArc(boot, [[0.32, 0.12, 0.32 * sd], [0.48, 0.1, 0.3 * sd], [0.16, 0.14, 0.33 * sd]], 0.045);
    boot.position.set(ankle[0] + 0.1, ankle[1] - 0.32, ankle[2]);
    boot.rotation.z = -swing * 0.5;
    g.add(boot);
  });
  return g;
}

function hand(kind = 'fist') {
  const g = new THREE.Group();
  g.add(mesh(sph(0.3), MAT.yellow, 0, 0, 0, 1, 1.05, 0.9));
  if (kind === 'horns') {
    g.add(limb([0, 0.15, 0.14], [0.05, 0.78, 0.42], 0.085, MAT.yellow));
    g.add(limb([0, 0.15, -0.14], [0.0, 0.74, -0.42], 0.085, MAT.yellow));
  }
  if (kind === 'thumb') g.add(limb([0.05, 0.15, 0.0], [0.02, 0.72, 0.0], 0.1, MAT.yellow));
  return g;
}

function arm(shoulder, elbow, wrist, handKind, wristAng = 0) {
  const g = new THREE.Group();
  g.add(limb(shoulder, elbow, 0.27, MAT.leather));
  g.add(limb(elbow, wrist, 0.25, MAT.leather));
  const wb = mesh(new THREE.TorusGeometry(0.26, 0.09, 12, 32), MAT.black, ...wrist);
  wb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...wrist).sub(new THREE.Vector3(...elbow)).normalize());
  g.add(wb);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = mesh(sph(0.045, 12), MAT.silver);
    s.position.set(Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0); wb.add(s);
  }
  const h = hand(handKind);
  const dir = new THREE.Vector3(...wrist).sub(new THREE.Vector3(...elbow)).normalize();
  h.position.set(...wrist).add(dir.clone().multiplyScalar(0.3));
  h.quaternion.setFromUnitVectors(UP, dir);
  h.rotateY(wristAng);
  g.add(h);
  return g;
}

function guitar() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.9, 0.1);
  s.bezierCurveTo(-1.0, 0.75, -0.35, 0.95, -0.05, 0.6);
  s.bezierCurveTo(0.1, 0.9, 0.55, 0.95, 0.5, 0.45);
  s.bezierCurveTo(0.45, 0.2, 0.25, 0.15, 0.3, -0.05);
  s.bezierCurveTo(0.6, -0.15, 0.6, -0.75, 0.1, -0.8);
  s.bezierCurveTo(-0.35, -0.85, -0.6, -0.6, -0.65, -0.45);
  s.bezierCurveTo(-0.85, -0.45, -0.85, -0.1, -0.9, 0.1);
  const body = extrude(s, 0.2, MAT.sunburst, 0.06); body.position.z = -0.1; g.add(body);
  // pickguard, pickup, bridge, tombol
  g.add(mesh(new RoundedBoxGeometry(0.12, 0.42, 0.06, 2, 0.02), MAT.black, -0.25, 0.0, 0.17));
  g.add(mesh(new RoundedBoxGeometry(0.12, 0.42, 0.06, 2, 0.02), MAT.black, -0.02, 0.0, 0.17));
  g.add(mesh(new RoundedBoxGeometry(0.14, 0.34, 0.07, 2, 0.02), MAT.silver, -0.55, 0.0, 0.17));
  [[-0.35, -0.5], [-0.12, -0.6], [0.1, -0.55]].forEach(([x, y]) => g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), MAT.silver, x, y, 0.17, 1, 1, 1, Math.PI / 2, 0, 0)));
  // leher & kepala
  const neckTex = canvasTex(64, 512, (c, w, h) => { c.fillStyle = '#2B1A10'; c.fillRect(0, 0, w, h); for (let i = 1; i < 22; i++) { c.fillStyle = '#D9D9D9'; c.fillRect(0, (i / 22) * h, w, 3); } [5, 9, 13, 17].forEach((k) => { c.fillStyle = '#F5F5F5'; c.beginPath(); c.arc(w / 2, ((k + 0.5) / 22) * h, 4, 0, 6.28); c.fill(); }); });
  neckTex.rotation = Math.PI / 2; neckTex.center.set(0.5, 0.5);
  g.add(mesh(new THREE.BoxGeometry(2.1, 0.2, 0.08), new THREE.MeshStandardMaterial({ map: neckTex, roughness: 0.5 }), 1.4, 0.0, 0.1));
  const head = new THREE.Shape(); head.moveTo(0, -0.12); head.lineTo(0.55, -0.2); head.lineTo(0.62, 0.18); head.lineTo(0, 0.12); head.closePath();
  const hs = extrude(head, 0.06, MAT.red, 0.02); hs.position.set(2.42, 0, 0.06); g.add(hs);
  for (let i = 0; i < 3; i++) { g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), MAT.silver, 2.55 + i * 0.15, 0.22, 0.1)); g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 10), MAT.silver, 2.55 + i * 0.15, -0.24, 0.1)); }
  // tali
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6), MAT.silver, 0.85, 0.0 - 0.05 + i * 0.02, 0.15, 1, 1, 1, 0, 0, Math.PI / 2));
  return g;
}

function trophy() {
  const g = new THREE.Group();
  const pts = [[0, 0], [0.5, 0], [0.5, 0.12], [0.18, 0.2], [0.12, 0.55], [0.18, 0.62], [0.55, 0.8], [0.72, 1.3], [0.74, 1.62], [0.7, 1.64], [0.62, 1.4], [0.5, 1.0], [0.0, 0.8]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 64), MAT.gold));
  [1, -1].forEach((sd) => g.add(mesh(new THREE.TorusGeometry(0.3, 0.06, 16, 32, Math.PI * 1.2), MAT.gold, 0.72 * sd, 1.25, 0, 1, 1, 1, 0, 0, sd > 0 ? -Math.PI * 0.6 : Math.PI * 0.4)));
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2; const r = i % 2 ? 0.1 : 0.24; const x = Math.cos(a) * r; const y = Math.sin(a) * r; i ? star.lineTo(x, y) : star.moveTo(x, y); }
  const st = extrude(star, 0.04, new THREE.MeshPhysicalMaterial({ color: 0xfff6c8, metalness: 1, roughness: 0.1 }), 0.02); st.position.set(0, 1.25, 0.66); g.add(st);
  return g;
}

function tail() { return mesh(new THREE.ConeGeometry(0.45, 1.0, 32), MAT.yellow, -1.35, 0.45, 0, 1, 1, 0.75, 0, 0, 1.1); }

/** Kumpul satu pose. */
function duck(pose) {
  const root = new THREE.Group();
  const torso = buildTorso(); torso.position.set(0, 1.75, 0); root.add(torso);
  root.add(Object.assign(tail(), {}));
  root.children.at(-1).position.y += 1.5;
  const head = buildHead(); head.position.set(0.3, 3.55, 0); root.add(head);
  const legs = buildLegs(pose === 'run' ? 0.55 : pose === 'guitar' ? 0.12 : 0); legs.position.set(0, 0.85, 0); root.add(legs);

  const SH_L = [0.05, 2.65, 1.12]; const SH_R = [0.05, 2.65, -1.12];
  if (pose === 'guitar') {
    root.add(arm(SH_L, [0.35, 3.35, 1.85], [0.55, 4.25, 1.95], 'horns', 0.4));
    root.add(arm(SH_R, [0.75, 2.05, -1.3], [1.35, 2.15, -0.55], 'fist'));
    const gt = guitar(); gt.position.set(1.25, 1.55, 0.35); gt.rotation.set(0, 0.95, 0.55); gt.scale.setScalar(1.05); root.add(gt);
  } else if (pose === 'run') {
    root.rotation.z = -0.16;
    root.add(arm(SH_L, [-0.45, 2.0, 1.35], [0.15, 1.45, 1.4], 'fist'));
    root.add(arm(SH_R, [0.75, 2.75, -1.35], [1.35, 3.25, -1.2], 'fist'));
    const gt = guitar(); gt.position.set(-1.25, 2.1, -0.2); gt.rotation.set(0, Math.PI, 0.95); gt.scale.setScalar(0.85); root.add(gt);
  } else if (pose === 'trophy') {
    root.add(arm(SH_L, [0.6, 3.85, 1.45], [1.0, 5.1, 0.7], 'fist'));
    root.add(arm(SH_R, [0.6, 3.85, -1.35], [1.0, 5.1, -0.62], 'fist'));
    const tr = trophy(); tr.position.set(1.05, 5.25, 0); tr.rotation.y = 0.95; tr.scale.setScalar(1.3); root.add(tr);
  } else if (pose === 'thumbs') {
    root.add(arm(SH_L, [0.9, 2.55, 1.75], [1.75, 2.95, 1.95], 'thumb', 0.3));
    root.add(arm(SH_R, [-0.35, 2.05, -1.4], [0.25, 1.55, -1.25], 'fist'));
    head.rotation.z = 0.06;
  } else if (pose === 'head') {
    root.remove(legs);
  }
  return root;
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// bayang lembut di lantai
const shadowTex = canvasTex(256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); });

const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
let current = null;

window.renderPose = (pose) => {
  if (current) scene.remove(current);
  current = new THREE.Group();
  const d = duck(pose);
  current.add(d);
  if (pose !== 'head') {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.set(0.3, 0.02, 0); current.add(sh);
  }
  scene.add(current);
  // sudut 3/4 seperti imej rujukan (itik menghadap kanan-hadapan)
  const box = new THREE.Box3().setFromObject(d);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.62;
  const dirv = pose === 'head' ? new THREE.Vector3(1, 0.1, 0.62).normalize() : new THREE.Vector3(1, 0.24, 0.72).normalize();
  const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (pose === 'head' ? 0.78 : 0.92);
  camera.position.copy(c).add(dirv.multiplyScalar(dist));
  camera.lookAt(c);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
};
window.ready = true;
