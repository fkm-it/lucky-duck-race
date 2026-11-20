/**
 * audio.js — Semua bunyi disintesis dengan Web Audio (tiada fail audio → saiz kecil & berfungsi offline).
 * Saluran: countdown, horn, running, music, victory, applause, fireworks.
 * Lalai SENYAP: tiada bunyi sehingga admin hidupkan dalam Tetapan.
 */
let ctx = null;
let master = null;
const gains = {};
let cfg = { soundEnabled: false, masterVolume: 0.8, volumes: {} };
let musicTimer = null;
let runningNode = null;
let noiseBuf = null;

export const CHANNELS = [
  ['countdown', 'Kiraan detik'], ['horn', 'Hon permulaan'], ['running', 'Bunyi itik berlari'],
  ['music', 'Muzik latar perlumbaan'], ['victory', 'Bunyi kemenangan'], ['applause', 'Tepukan'], ['fireworks', 'Bunga api'],
];

export function configure(settings) {
  cfg = settings;
  if (ctx) applyGains();
  if (!cfg.soundEnabled) { stopMusic(); stopRunning(); }
}

function ensure() {
  if (!cfg.soundEnabled) return false;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    CHANNELS.forEach(([k]) => { gains[k] = ctx.createGain(); gains[k].connect(master); });
    applyGains();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

function applyGains() {
  master.gain.value = cfg.soundEnabled ? cfg.masterVolume : 0;
  CHANNELS.forEach(([k]) => { gains[k].gain.value = (cfg.volumes && cfg.volumes[k] !== undefined) ? cfg.volumes[k] : 0.7; });
}

function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function tone(ch, { freq = 440, type = 'sine', dur = 0.2, vol = 0.5, at = 0, slide = 0, attack = 0.01 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(gains[ch]);
  o.start(t); o.stop(t + dur + 0.05);
}

function burst(ch, { dur = 0.3, vol = 0.5, at = 0, freq = 1200, q = 0.8, type = 'bandpass' }) {
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noise();
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(gains[ch]);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

export function unlock() { ensure(); }

export function countdownBeep(final = false) {
  if (!ensure()) return;
  if (final) return;
  tone('countdown', { freq: 660, type: 'square', dur: 0.18, vol: 0.25 });
  tone('countdown', { freq: 1320, type: 'sine', dur: 0.25, vol: 0.15 });
}

export function horn() {
  if (!ensure()) return;
  [233, 294, 349].forEach((f) => tone('horn', { freq: f, type: 'sawtooth', dur: 1.1, vol: 0.18, attack: 0.03 }));
}

export function quack(at = 0) {
  if (!ensure()) return;
  tone('running', { freq: 520 + Math.random() * 120, type: 'sawtooth', dur: 0.12, vol: 0.12, at, slide: -260 });
}

export function startRunning() {
  if (!ensure() || runningNode) return;
  let alive = true;
  const step = () => {
    if (!alive) return;
    for (let i = 0; i < 4; i++) burst('running', { dur: 0.05, vol: 0.12, at: i * 0.06 + Math.random() * 0.03, freq: 300 + Math.random() * 400, q: 2 });
    if (Math.random() < 0.35) quack(Math.random() * 0.2);
    runningNode.t = setTimeout(step, 240);
  };
  runningNode = { stop: () => { alive = false; clearTimeout(runningNode && runningNode.t); } };
  step();
}

export function stopRunning() { if (runningNode) { runningNode.stop(); runningNode = null; } }

/** Muzik latar ringkas: bes + arpeggio gelung (tempo laju). */
export function startMusic() {
  if (!ensure() || musicTimer) return;
  const prog = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 294]];
  let bar = 0;
  const playBar = () => {
    const ch = prog[bar % prog.length];
    for (let i = 0; i < 8; i++) {
      tone('music', { freq: ch[i % 3] * (i % 4 === 3 ? 2 : 1), type: 'triangle', dur: 0.14, vol: 0.12, at: i * 0.15 });
    }
    tone('music', { freq: ch[0] / 2, type: 'square', dur: 0.5, vol: 0.08, at: 0 });
    tone('music', { freq: ch[0] / 2, type: 'square', dur: 0.5, vol: 0.08, at: 0.6 });
    bar++;
  };
  playBar();
  musicTimer = setInterval(playBar, 1200);
}

export function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

export function victory() {
  if (!ensure()) return;
  const notes = [523, 659, 784, 1047, 784, 1047];
  const times = [0, 0.14, 0.28, 0.42, 0.62, 0.76];
  notes.forEach((f, i) => tone('victory', { freq: f, type: 'square', dur: i === 5 ? 0.8 : 0.16, vol: 0.16, at: times[i] }));
  notes.forEach((f, i) => tone('victory', { freq: f / 2, type: 'triangle', dur: i === 5 ? 0.8 : 0.16, vol: 0.12, at: times[i] }));
}

export function applause(seconds = 3) {
  if (!ensure()) return;
  const n = Math.floor(seconds * 70);
  for (let i = 0; i < n; i++) {
    const at = Math.random() * seconds;
    const fade = 1 - at / seconds;
    burst('applause', { dur: 0.04, vol: 0.25 * fade + 0.05, at, freq: 1500 + Math.random() * 2500, q: 1.5 });
  }
}

export function firework() {
  if (!ensure()) return;
  tone('fireworks', { freq: 900, type: 'sine', dur: 0.5, vol: 0.06, slide: 1400 });
  burst('fireworks', { dur: 0.9, vol: 0.5, at: 0.5, freq: 400, q: 0.5, type: 'lowpass' });
  for (let i = 0; i < 10; i++) burst('fireworks', { dur: 0.05, vol: 0.15, at: 0.6 + Math.random() * 0.8, freq: 3000 + Math.random() * 3000, q: 3 });
}

export function drumroll(seconds = 1.4) {
  if (!ensure()) return;
  for (let t = 0; t < seconds; t += 0.045) burst('countdown', { dur: 0.05, vol: 0.12 + (t / seconds) * 0.2, at: t, freq: 180, q: 1, type: 'lowpass' });
}

export function stopAll() { stopMusic(); stopRunning(); }

export function test(ch) {
  const map = { countdown: () => countdownBeep(), horn, running: () => { quack(); quack(0.2); }, music: () => { startMusic(); setTimeout(stopMusic, 2500); }, victory, applause: () => applause(2), fireworks: firework };
  (map[ch] || victory)();
}
