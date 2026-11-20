/**
 * theme.js — Elemen visual tema ROCK THE DRAW yang dikongsi (Paparan Utama, log masuk, laman kehadiran).
 */
import { html } from './util.js';

/** Latar konsert: dinding LED, lampu sorot, laser & asap (CSS sahaja — ringan). */
export const concertBg = () => html`<div class="concert-bg" aria-hidden="true">
  <div class="cb-led"></div>
  <div class="cb-spots"><i></i><i></i><i></i><i></i></div>
  <div class="cb-lasers"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="cb-smoke"><i></i><i></i><i></i></div>
  <div class="cb-floor"></div>
</div>`;
