/**
 * audio.js — Bunyi kesan disintesis dengan Web Audio; muzik perlumbaan dari audio/itik-berlari.mp3 (dicache SW, berfungsi offline).
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
  ['countdown', 'Kiraan detik'], ['horn', 'Kord gitar permulaan'], ['running', 'Bunyi itik berlari'],
  ['music', 'Muzik itik berlari'], ['victory', 'Riff gitar kemenangan'], ['applause', 'Tepukan'], ['fireworks', 'Bunga api'],
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

let distCurve = null;
function distortion() {
  if (distCurve) return distCurve;
  const n = 2048; distCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; distCurve[i] = ((3 + 40) * x * 20 * (Math.PI / 180)) / (Math.PI + 40 * Math.abs(x)); }
  return distCurve;
}

/** Gitar elektrik terherot: power chord (akar + kelima + oktaf). */
function guitar(ch, { root = 82.41, at = 0, dur = 0.5, vol = 0.22, slide = 0, mute = false }) {
  const t = ctx.currentTime + at;
  const shaper = ctx.createWaveShaper(); shaper.curve = distortion(); shaper.oversample = '4x';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = mute ? 900 : 3200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(mute ? 0.0001 : vol * 0.5, t + (mute ? 0.12 : dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  shaper.connect(lp); lp.connect(g); g.connect(gains[ch]);
  [1, 1.4983, 2].forEach((m, i) => {
    [-6, 6].forEach((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(root * m, t); o.detune.value = det + i;
      if (slide) o.frequency.exponentialRampToValueAtTime(root * m * slide, t + dur);
      o.connect(shaper); o.start(t); o.stop(t + dur + 0.05);
    });
  });
}

function kick(ch, at, vol = 0.5) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g); g.connect(gains[ch]); o.start(t); o.stop(t + 0.25);
}

export function unlock() { if (ensure()) loadMusic(); }

export function countdownBeep(final = false) {
  if (!ensure()) return;
  if (final) return;
  guitar('countdown', { root: 110, dur: 0.35, vol: 0.2 });
  kick('countdown', 0, 0.5);
}

export function horn() {
  if (!ensure()) return;
  guitar('horn', { root: 82.41, dur: 1.8, vol: 0.26 });
  guitar('horn', { root: 164.8, dur: 1.6, vol: 0.12, at: 0.02 });
  burst('horn', { dur: 1.6, vol: 0.35, freq: 7000, q: 0.4, type: 'highpass' });
  kick('horn', 0, 0.7);
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

/* Muzik perlumbaan: fail audio/itik-berlari.mp3 (gelung). Jika gagal dimuat, guna muzik rock sintesis. */
const MUSIC_URL = 'audio/itik-berlari.mp3';
let musicBuf = null;
let musicLoad = null;
let musicSrc = null;
let musicWanted = false;

function loadMusic() {
  if (!musicLoad) {
    musicLoad = fetch(MUSIC_URL)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((ok, no) => ctx.decodeAudioData(ab, ok, no)))
      .then((buf) => { musicBuf = buf; return buf; })
      .catch(() => { musicLoad = null; return null; });
  }
  return musicLoad;
}

function playFile() {
  const src = ctx.createBufferSource();
  src.buffer = musicBuf; src.loop = true;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, ctx.currentTime);
  g.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.4);
  src.connect(g); g.connect(gains.music);
  src.start();
  musicSrc = { src, g };
}

export function startMusic() {
  if (!ensure() || musicTimer || musicSrc) return;
  musicWanted = true;
  if (musicBuf) { playFile(); return; }
  loadMusic().then((buf) => {
    if (!musicWanted || musicTimer || musicSrc) return;
    if (buf) playFile(); else startSynthMusic();
  });
}

/** Muzik sandaran (sintesis): bes + riff gitar gelung, 150 BPM. */
function startSynthMusic() {
  const beat = 60 / 150;
  const riff = [82.41, 82.41, 98, 82.41, 110, 82.41, 98, 73.42]; /* E E G E A E G D */
  let bar = 0;
  const playBar = () => {
    for (let i = 0; i < 8; i++) {
      const at = i * beat / 2;
      guitar('music', { root: riff[(i + bar * 2) % riff.length], at, dur: beat / 2.2, vol: 0.13, mute: i % 4 !== 0 });
      burst('music', { dur: 0.03, vol: 0.06, at, freq: 9000, q: 1, type: 'highpass' });
    }
    [0, 2].forEach((b) => kick('music', b * beat, 0.45));
    [1, 3].forEach((b) => burst('music', { dur: 0.16, vol: 0.28, at: b * beat, freq: 1800, q: 0.7 }));
    bar++;
  };
  playBar();
  musicTimer = setInterval(playBar, beat * 4 * 1000);
}

export function stopMusic() {
  musicWanted = false;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (musicSrc) {
    const { src, g } = musicSrc; musicSrc = null;
    try {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.6);
      src.stop(t + 0.65);
    } catch { /* sudah berhenti */ }
  }
}

export function victory() {
  if (!ensure()) return;
  const seq = [[82.41, 0], [98, 0.16], [110, 0.32], [123.47, 0.48], [146.83, 0.64]];
  seq.forEach(([r, at]) => guitar('victory', { root: r, at, dur: 0.2, vol: 0.2 }));
  guitar('victory', { root: 82.41, at: 0.82, dur: 2.2, vol: 0.28 });
  guitar('victory', { root: 164.8, at: 0.82, dur: 2, vol: 0.12 });
  burst('victory', { dur: 2, vol: 0.35, at: 0.82, freq: 6500, q: 0.4, type: 'highpass' });
  kick('victory', 0.82, 0.8);
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
