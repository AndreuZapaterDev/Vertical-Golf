import { progress } from './progress.js';

/**
 * Efectos de sonido estilo chiptune sintetizados con WebAudio (sin archivos).
 * El AudioContext se crea en la primera interacción del usuario.
 */
let ctx = null;
let master = null;
let noiseBuf = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'square', vol = 0.12, slideTo = null, delay = 0 } = {}) {
  const c = ac();
  if (!c || !progress.sound) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.2, freq = 1200, delay = 0 } = {}) {
  const c = ac();
  if (!c || !progress.sound) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  unlock() {
    ac();
  },
  hit(power = 1) {
    noise(0.05, { vol: 0.25, freq: 4000 });
    tone(220 + power * 330, 0.08, { slideTo: 110, vol: 0.1 });
  },
  land(v = 200) {
    tone(90 + Math.min(v, 600) * 0.1, 0.05, { type: 'triangle', vol: Math.min(0.25, v / 1500) });
  },
  boing() {
    tone(160, 0.22, { slideTo: 700, vol: 0.1 });
  },
  bumper() {
    tone(880, 0.06, { vol: 0.1 });
    tone(1320, 0.1, { vol: 0.08, delay: 0.05 });
  },
  crack() {
    noise(0.15, { vol: 0.25, freq: 900 });
    tone(140, 0.08, { type: 'triangle', vol: 0.12, delay: 0.05 });
  },
  gem() {
    tone(1047, 0.06, { vol: 0.1 });
    tone(1568, 0.12, { vol: 0.1, delay: 0.06 });
  },
  hazard() {
    tone(400, 0.3, { type: 'sawtooth', slideTo: 50, vol: 0.12 });
    noise(0.25, { vol: 0.25, freq: 600 });
  },
  hole() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1, { vol: 0.1, delay: i * 0.07 }));
  },
  star(i = 0) {
    tone(660 * Math.pow(1.26, i), 0.15, { vol: 0.1 });
    tone(1320 * Math.pow(1.26, i), 0.1, { type: 'triangle', vol: 0.06, delay: 0.04 });
  },
  click() {
    tone(700, 0.04, { vol: 0.08 });
  },
  brake() {
    tone(900, 0.12, { slideTo: 200, vol: 0.12 });
    noise(0.1, { vol: 0.15, freq: 2500 });
  },
  buy() {
    [784, 988, 1319].forEach((f, i) => tone(f, 0.09, { vol: 0.1, delay: i * 0.06 }));
  },
  coin() {
    tone(1319, 0.05, { vol: 0.07 });
    tone(1760, 0.08, { vol: 0.07, delay: 0.05 });
  },
  denied() {
    tone(220, 0.15, { vol: 0.12, slideTo: 150 });
  },
  splash() {
    noise(0.35, { vol: 0.3, freq: 1200 });
    tone(500, 0.18, { type: 'sine', slideTo: 120, vol: 0.12 });
    tone(900, 0.1, { type: 'sine', slideTo: 300, vol: 0.06, delay: 0.08 });
  },
  whoosh() {
    noise(0.2, { vol: 0.12, freq: 1500 });
  },
};
