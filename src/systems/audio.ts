import { progress } from './progress';

/**
 * Audio chiptune sintetizado con WebAudio (sin archivos).
 *
 *   master ─┬─ sfxBus   (efectos; volumen = ajuste "Efectos")
 *           └─ musicBus (música; volumen = ajuste "Música") ← duck ← lowpass ← voces
 *
 * El AudioContext se crea en la primera interacción del usuario (política de autoplay).
 * La música es generativa: progresión de acordes por mundo + bajo + arpegio + percusión
 * y una melodía que se inventa por frases (A A B A) y va cambiando.
 */
let ctx: AudioContext | null = null;
// Los nodos se crean junto con el AudioContext (en ac()); antes de eso no se usan nunca
let master!: GainNode;
let sfxBus!: GainNode;
let musicBus!: GainNode;
let musicDuck!: GainNode;
let musicFilter!: BiquadFilterNode;
let noiseBuf!: AudioBuffer;

const SFX_GAIN = 0.4;
const MUSIC_GAIN = 0.2;

function ac(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    musicDuck = ctx.createGain();
    musicDuck.connect(musicBus);
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 12000;
    musicFilter.connect(musicDuck);
    applyVolumes();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    setTimeout(() => music.ensureRunning(), 0); // la música pendiente arranca en cuanto hay audio
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  return ctx;
}

function applyVolumes() {
  if (!ctx) return;
  const s = progress.settings;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(s.sfx * SFX_GAIN, t, 0.02);
  musicBus.gain.setTargetAtTime(s.music * MUSIC_GAIN, t, 0.05);
}

progress.onSettingsChange((key) => {
  if (key === 'sfx' || key === 'music') applyVolumes();
  if (key === 'music' && progress.settings.music > 0) music.ensureRunning();
});

// En segundo plano los temporizadores se ralentizan: se suspende el audio para no oír cortes
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

// ------------------------------------------------------------------ efectos

interface ToneOpts {
  type?: OscillatorType;
  vol?: number;
  /** frecuencia final (glissando) */
  slideTo?: number | null;
  delay?: number;
}

function tone(freq: number, dur: number, { type = 'square', vol = 0.12, slideTo = null, delay = 0 }: ToneOpts = {}) {
  const c = ac();
  if (!c || progress.settings.sfx <= 0) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, { vol = 0.2, freq = 1200, delay = 0, type = 'lowpass' }: { vol?: number; freq?: number; delay?: number; type?: BiquadFilterType } = {}) {
  const c = ac();
  if (!c || progress.settings.sfx <= 0) return;
  const t = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  unlock() {
    if (ac()) music.ensureRunning();
  },
  hit(power = 1) {
    noise(0.05, { vol: 0.25, freq: 4000 });
    tone(220 + power * 330, 0.08, { slideTo: 110, vol: 0.1 });
    if (power > 0.85) tone(70, 0.12, { type: 'sine', slideTo: 40, vol: 0.25 });
  },
  /** Clic de carga al apuntar: sube de tono con cada cuarto de potencia */
  charge(step: number) {
    tone(380 + step * 140, 0.03, { vol: 0.05 });
  },
  chargeMax() {
    tone(1100, 0.05, { vol: 0.06 });
    tone(1650, 0.06, { vol: 0.05, delay: 0.04 });
  },
  /** Aterrizaje: cada suelo suena distinto (hierba: golpe seco; arena: "fsh" blando; rough: roce de hierba alta; hielo: tintineo; madera: toc) */
  land(v = 200, mat = 'grass') {
    const k = Math.min(1, v / 600);
    switch (mat) {
      case 'sand':
        noise(0.14, { vol: 0.05 + k * 0.18, freq: 900 });
        tone(70, 0.05, { type: 'sine', vol: 0.03 + k * 0.05 });
        break;
      case 'rough':
        noise(0.12, { vol: 0.04 + k * 0.14, freq: 3200, type: 'highpass' });
        tone(110, 0.05, { type: 'triangle', vol: 0.04 + k * 0.07 });
        break;
      case 'ice':
        tone(1900, 0.05, { type: 'triangle', vol: 0.04 + k * 0.06 });
        tone(2850, 0.07, { type: 'triangle', vol: 0.03 + k * 0.04, delay: 0.02 });
        break;
      case 'wood':
        tone(210, 0.05, { type: 'square', vol: 0.04 + k * 0.1, slideTo: 140 });
        noise(0.03, { vol: 0.05 + k * 0.08, freq: 1800 });
        break;
      case 'mud':
      case 'quicksand':
        noise(0.16, { vol: 0.06 + k * 0.16, freq: 520 });
        tone(75, 0.08, { type: 'sine', vol: 0.04 + k * 0.06, slideTo: 50 });
        break;
      case 'crumble':
        noise(0.1, { vol: 0.06 + k * 0.1, freq: 1400 });
        tone(120, 0.05, { type: 'triangle', vol: 0.05 + k * 0.06 });
        break;
      default:
        tone(90 + Math.min(v, 600) * 0.1, 0.05, { type: 'triangle', vol: Math.min(0.25, v / 1500) });
    }
  },
  /** Pinzazo de cangrejo (en la Playa sustituye al zumbido de la sierra) */
  pinch() {
    tone(1900, 0.03, { type: 'square', vol: 0.1 });
    tone(1250, 0.03, { type: 'square', vol: 0.09, delay: 0.06 });
    noise(0.04, { vol: 0.12, freq: 5200, type: 'highpass', delay: 0.06 });
    tone(320, 0.18, { type: 'sawtooth', slideTo: 110, vol: 0.07, delay: 0.12 });
  },
  /** Croar de rana lejano (ambiente del pantano) */
  croak() {
    tone(150 + Math.random() * 40, 0.08, { type: 'sawtooth', slideTo: 95, vol: 0.035 });
    tone(190 + Math.random() * 40, 0.07, { type: 'sawtooth', slideTo: 110, vol: 0.03, delay: 0.11 });
  },
  /** Burbuja que sube del fango */
  bubble() {
    tone(420 + Math.random() * 260, 0.07, { type: 'sine', slideTo: 900, vol: 0.04 });
  },
  /** La arena movediza te traga */
  sink() {
    noise(0.6, { vol: 0.16, freq: 500 });
    tone(140, 0.6, { type: 'sine', slideTo: 55, vol: 0.1 });
  },
  /** Cangrejo aplastado: crujido corto y un "pop" que baja */
  squash() {
    noise(0.1, { vol: 0.18, freq: 900 });
    tone(260, 0.12, { type: 'triangle', slideTo: 70, vol: 0.12, delay: 0.02 });
  },
  /** Silbido de caída al salir de los límites */
  fall() {
    tone(1000, 0.55, { type: 'sine', slideTo: 130, vol: 0.09 });
    noise(0.4, { vol: 0.05, freq: 1500, type: 'bandpass' });
  },
  /** Campanita de inicio de hoyo */
  tee() {
    tone(784, 0.1, { type: 'triangle', vol: 0.07 });
    tone(1175, 0.16, { type: 'triangle', vol: 0.07, delay: 0.09 });
  },
  /** Cambio de viento: ráfaga corta que sube o baja de tono según la dirección */
  windShift(dir = 1) {
    noise(0.5, { vol: 0.09, freq: dir > 0 ? 2200 : 1400, type: 'bandpass' });
    tone(dir > 0 ? 300 : 520, 0.4, { type: 'sine', slideTo: dir > 0 ? 520 : 300, vol: 0.025 });
  },
  /** Pequeño "tic" al hacer zoom con la rueda (sube con el zoom) */
  zoomTick(zoom = 1) {
    tone(380 + zoom * 260, 0.02, { type: 'triangle', vol: 0.035 });
  },
  /** Viento de fondo continuo: 0 lo apaga; el signo da el lado (stereo) y el valor, la fuerza */
  wind(strength: number) {
    ambient('wind', Math.abs(strength) / 45, Math.sign(strength));
  },
  /** Mar de fondo (Playa): oleaje suave que sube y baja */
  sea(on: boolean) {
    ambient('sea', on ? 1 : 0, 0);
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
    tone(180, 0.08, { type: 'triangle', slideTo: 90, vol: 0.2 }); // "clonc" de la bola en la copa
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.1, { vol: 0.1, delay: 0.08 + i * 0.07 }));
    tone(1568, 0.3, { type: 'triangle', vol: 0.08, delay: 0.45 });
    music.duck(1.6);
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
  pause() {
    tone(660, 0.05, { vol: 0.08 });
    tone(440, 0.08, { vol: 0.08, delay: 0.05 });
  },
  resume() {
    tone(440, 0.05, { vol: 0.08 });
    tone(660, 0.08, { vol: 0.08, delay: 0.05 });
  },
};

// ------------------------------------------------------------------ ambientes continuos (viento, mar)

interface AmbientVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode | null;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
  level: number;
  dir: number;
}
const ambientVoices: Record<string, AmbientVoice | undefined> = {};
let ambientPaused = false;

/**
 * Bucle de ruido filtrado con un LFO lento. `level` (0–1) es la fuerza; con 0 se apaga con un fundido.
 *   wind: ruido de banda que sube de tono con la fuerza (silbido); ráfagas lentas
 *   sea:  ruido grave con un oleaje de ~8 s
 */
function ambient(kind: 'wind' | 'sea', level: number, dir: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  let v = ambientVoices[kind];
  const lv = Math.min(1, Math.max(0, level));
  if (!v) {
    if (lv <= 0) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = kind === 'wind' ? 'bandpass' : 'lowpass';
    filter.Q.value = kind === 'wind' ? 0.9 : 0.4;
    const gain = c.createGain();
    gain.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = kind === 'wind' ? 0.22 : 0.12;
    const lfoDepth = c.createGain();
    lfo.connect(lfoDepth);
    lfoDepth.connect(gain.gain); // el LFO mueve el volumen: ráfagas / olas
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    src.connect(filter).connect(gain);
    if (pan) gain.connect(pan).connect(sfxBus);
    else gain.connect(sfxBus);
    src.start(t, Math.random() * 0.8);
    lfo.start(t);
    v = ambientVoices[kind] = { src, gain, filter, pan, lfo, lfoDepth, level: 0, dir: 0 };
  }
  v.level = lv;
  v.dir = dir;
  const base = kind === 'wind' ? 0.03 + lv * 0.11 : 0.1 * lv;
  const target = ambientPaused ? 0 : base;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(target, t, 0.5);
  v.lfoDepth.gain.setTargetAtTime(ambientPaused ? 0 : base * (kind === 'wind' ? 0.45 : 0.6), t, 0.5);
  v.filter.frequency.setTargetAtTime(kind === 'wind' ? 500 + lv * 1500 : 520, t, 0.5);
  if (v.pan) v.pan.pan.setTargetAtTime(dir * 0.35, t, 0.5);
  if (lv <= 0) {
    // se apaga y se libera pasado el fundido
    const dead = v;
    ambientVoices[kind] = undefined;
    setTimeout(() => {
      try {
        dead.src.stop();
        dead.lfo.stop();
      } catch {
        /* ya parado */
      }
    }, 1800);
  }
}

/** Silencia (o devuelve) los ambientes al pausar */
function setAmbientPaused(on: boolean) {
  ambientPaused = on;
  if (!ctx) return;
  for (const kind of ['wind', 'sea'] as const) {
    const v = ambientVoices[kind];
    if (v) ambient(kind, v.level, v.dir);
  }
}

// ------------------------------------------------------------------ vibración

/** Vibración en móviles (si el ajuste está activo y el navegador la soporta) */
export function haptic(pattern: number | number[]) {
  if (!progress.settings.vibration || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* algunos navegadores la bloquean sin interacción previa */
  }
}

// ------------------------------------------------------------------ música generativa

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Song {
  bpm: number;
  /** tónica (MIDI) */
  root: number;
  swing: number;
  /** acordes: semitonos sobre la tónica */
  chords: number[][];
  /** escala de la melodía */
  scale: number[];
  /** ritmos de la melodía: [inicio, duración] en semicorcheas */
  rhythms: [number, number][][];
  lead: OscillatorType;
  /** semicorcheas del compás donde suena el bajo */
  bass: number[];
  /** el arpegio suena cada `arp` semicorcheas */
  arp: number;
  kick: number[];
  hat: number;
  echo?: boolean;
}

interface Note {
  step: number;
  len: number;
  /** grado de la escala */
  deg: number;
}
/** 4 compases de notas */
type Phrase = Note[][];

/**
 * Cada mundo: tempo, tónica (MIDI), acordes (semitonos sobre la tónica), escala de la melodía,
 * ritmos posibles de la melodía (pasos de semicorchea [inicio, duración]) y estilo de acompañamiento.
 */
const SONGS: Record<string, Song> = {
  // Pradera: alegre y saltarina, en Re mayor (I–IV–vi–V)
  meadow: {
    bpm: 124, root: 62, swing: 0.08,
    chords: [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]],
    scale: [0, 2, 4, 7, 9],
    rhythms: [
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]],
      [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]],
      [[0, 4], [4, 2], [6, 2], [8, 8]],
      [[2, 2], [4, 2], [8, 2], [10, 2], [12, 4]],
    ],
    lead: 'square', bass: [0, 6, 8, 14], arp: 2, kick: [0, 8], hat: 2,
  },
  day: {
    bpm: 116, root: 60, swing: 0,
    chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
    scale: [0, 2, 4, 7, 9],
    rhythms: [
      [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]],
      [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]],
      [[0, 4], [6, 2], [8, 2], [10, 6]],
      [[2, 2], [4, 2], [6, 2], [8, 8]],
    ],
    lead: 'square', bass: [0, 6, 8, 14], arp: 2, kick: [0, 8], hat: 2,
  },
  sunset: {
    bpm: 98, root: 53, swing: 0.12,
    chords: [[0, 4, 7, 11], [4, 7, 11, 14], [5, 9, 12, 16], [5, 8, 12, 15]],
    scale: [0, 2, 4, 7, 9, 11],
    rhythms: [
      [[0, 4], [4, 2], [6, 6], [12, 4]],
      [[0, 2], [2, 2], [4, 4], [8, 8]],
      [[2, 4], [6, 2], [8, 4], [12, 4]],
    ],
    lead: 'triangle', bass: [0, 10], arp: 4, kick: [0], hat: 4,
  },
  night: {
    bpm: 84, root: 57, swing: 0,
    chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
    scale: [0, 3, 5, 7, 10],
    rhythms: [
      [[0, 6], [8, 8]],
      [[0, 4], [4, 4], [12, 4]],
      [[2, 6], [10, 6]],
      [[0, 8], [8, 4], [12, 4]],
    ],
    lead: 'triangle', bass: [0, 8], arp: 4, kick: [], hat: 8, echo: true,
  },
};

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inventa una frase de 4 compases: lista de notas por compás (grado de la escala) */
function makePhrase(song: Song, rand: () => number): Phrase {
  const n = song.scale.length;
  let deg = n + Math.floor(rand() * n);
  const bars: Phrase = [];
  for (let b = 0; b < 4; b++) {
    if (b === 2 && rand() < 0.2) {
      bars.push([]); // compás de respiro
      continue;
    }
    const rhythm = song.rhythms[Math.floor(rand() * song.rhythms.length)];
    const notes = rhythm.map(([step, len]) => {
      const moves = [-2, -1, -1, 0, 1, 1, 2];
      deg = Math.min(n * 2 + 2, Math.max(1, deg + moves[Math.floor(rand() * moves.length)]));
      return { step, len, deg };
    });
    bars.push(notes);
  }
  // la frase termina en la tónica para que "cierre"
  const last = bars[3][bars[3].length - 1];
  if (last) last.deg = Math.round(last.deg / n) * n || n;
  return bars;
}

function voice(midi: number, t: number, dur: number, { type = 'square', vol = 0.1, attack = 0.005 }: { type?: OscillatorType; vol?: number; attack?: number } = {}) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(midiHz(midi), t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(musicFilter);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function drum(t: number, kind: 'kick' | 'hat') {
  if (!ctx) return;
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(musicFilter);
    o.start(t);
    o.stop(t + 0.16);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  src.connect(f).connect(g).connect(musicFilter);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.05);
}

const LOOKAHEAD = 0.15;

interface MusicPlayer {
  theme: string | null;
  timer: ReturnType<typeof setInterval> | null;
  song: Song | null;
  step: number;
  bar: number;
  nextTime: number;
  /** [frase A, frase B] */
  phrases: Phrase[];
  /** orden de las frases: A A B A */
  order: number[];
  pendingSong: boolean;
  rand: () => number;
  play(theme: string): void;
  stop(): void;
  ensureRunning(): void;
  setPaused(on: boolean): void;
  duck(sec?: number): void;
  newSong(): void;
  schedule(): void;
  playStep(t: number): void;
}

export const music: MusicPlayer = {
  theme: null,
  timer: null,
  song: null,
  step: 0,
  bar: 0,
  nextTime: 0,
  phrases: [],
  order: [0, 0, 1, 0],
  pendingSong: false,
  rand: Math.random,

  /** Elige la música de un mundo ('day' | 'sunset' | 'night'). Si ya suena, no se reinicia. */
  play(theme) {
    // los mundos que aún no tienen canción propia usan la del día o la de la noche
    if (!SONGS[theme]) theme = theme === 'swamp' ? 'night' : 'day';
    if (this.theme === theme && this.timer) return;
    this.theme = theme;
    this.pendingSong = true; // el cambio entra al empezar el siguiente compás
    this.ensureRunning();
  },

  stop() {
    this.theme = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },

  ensureRunning() {
    if (!ctx || this.timer || !this.theme) return;
    this.nextTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.bar = 0;
    this.pendingSong = true;
    this.timer = setInterval(() => this.schedule(), 30);
  },

  /** Música apagada y filtrada (pausa) */
  setPaused(on) {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicFilter.frequency.setTargetAtTime(on ? 650 : 12000, t, 0.08);
    musicDuck.gain.setTargetAtTime(on ? 0.55 : 1, t, 0.08);
    setAmbientPaused(on);
  },

  /** Baja la música un momento (para que se oiga una fanfarria) */
  duck(sec = 1.2) {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicDuck.gain.cancelScheduledValues(t);
    musicDuck.gain.setTargetAtTime(0.25, t, 0.03);
    musicDuck.gain.setTargetAtTime(1, t + sec, 0.4);
  },

  newSong() {
    const song = SONGS[this.theme ?? 'day'] ?? SONGS.day;
    this.song = song;
    this.rand = rng((Date.now() ^ (song.root * 7919)) >>> 0);
    this.phrases = [makePhrase(song, this.rand), makePhrase(song, this.rand)];
    this.bar = 0;
  },

  schedule() {
    if (!ctx || ctx.state !== 'running') return;
    // si la pestaña estuvo congelada, no intentes recuperar los compases perdidos
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      if (this.step === 0 && this.pendingSong) {
        this.pendingSong = false;
        this.newSong();
      }
      if (this.song && progress.settings.music > 0) this.playStep(this.nextTime);
      const song = this.song || SONGS.day;
      const sixteenth = 60 / song.bpm / 4;
      // swing: las semicorcheas pares se alargan un poco
      const sw = this.step % 2 === 0 ? 1 + song.swing : 1 - song.swing;
      this.nextTime += sixteenth * sw;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        // cada 16 compases (A A B A ×1) se inventa una frase B nueva
        if (this.bar % 16 === 0 && this.song) this.phrases[1] = makePhrase(this.song, this.rand);
      }
    }
  },

  playStep(t) {
    const s = this.song;
    if (!s) return;
    const st = this.step;
    const sixteenth = 60 / s.bpm / 4;
    const chord = s.chords[this.bar % s.chords.length];

    // bajo
    if (s.bass.includes(st)) {
      const oct = st === 8 && s.bass.length > 2 ? 12 : 0;
      voice(s.root - 24 + chord[0] + oct, t, sixteenth * (s.bass.length > 2 ? 2.2 : 6), { type: 'triangle', vol: 0.32 });
    }
    // arpegio
    if (st % s.arp === 0) {
      const i = Math.floor(st / s.arp) % chord.length;
      voice(s.root + chord[i], t, sixteenth * s.arp * 0.9, { type: s.arp > 2 ? 'triangle' : 'square', vol: s.arp > 2 ? 0.07 : 0.035 });
    }
    // percusión
    if (s.kick.includes(st)) drum(t, 'kick');
    if (st % s.hat === s.hat / 2 || (s.hat === 8 && st === 12)) drum(t, 'hat');

    // melodía (frase A A B A)
    const phrase = this.phrases[this.order[Math.floor(this.bar / 4) % 4]];
    const notes = phrase[this.bar % 4];
    for (const nt of notes) {
      if (nt.step !== st) continue;
      const n = s.scale.length;
      const midi = s.root + 12 + s.scale[nt.deg % n] + 12 * Math.floor(nt.deg / n) - 12;
      const dur = sixteenth * nt.len * 0.95;
      voice(midi, t, dur, { type: s.lead, vol: s.lead === 'square' ? 0.06 : 0.12, attack: 0.01 });
      if (s.echo) voice(midi + 12, t + sixteenth * 3, dur * 0.8, { type: 'sine', vol: 0.035, attack: 0.02 });
    }
  },
};
