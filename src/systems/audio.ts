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
let musicVerbGain!: GainNode;
let echoSend!: GainNode;
let echoDelay!: DelayNode;

const SFX_GAIN = 0.4;
const MUSIC_GAIN = 0.2;

/** Respuesta de impulso de una sala: ruido estéreo que se apaga y se oscurece con el tiempo */
function makeIR(c: AudioContext, sec: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * sec);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function ac(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    // sala pequeña para los efectos: les da cuerpo y los saca de lo "plano"
    const sfxVerb = ctx.createConvolver();
    sfxVerb.buffer = makeIR(ctx, 0.9, 2.5);
    const sfxVerbGain = ctx.createGain();
    sfxVerbGain.gain.value = 0.16;
    sfxBus.connect(sfxVerb).connect(sfxVerbGain).connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    musicDuck = ctx.createGain();
    musicDuck.connect(musicBus);
    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 12000;
    musicFilter.connect(musicDuck);
    // reverb de sala grande (la cantidad la fija cada canción)
    const musicVerb = ctx.createConvolver();
    musicVerb.buffer = makeIR(ctx, 2.6, 2.2);
    musicVerbGain = ctx.createGain();
    musicVerbGain.gain.value = 0.1;
    musicFilter.connect(musicVerb).connect(musicVerbGain).connect(musicDuck);
    // eco con realimentación, oscurecido en cada repetición
    echoSend = ctx.createGain();
    echoSend.gain.value = 0;
    echoDelay = ctx.createDelay(2);
    echoDelay.delayTime.value = 0.4;
    const echoFb = ctx.createGain();
    echoFb.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2600;
    musicFilter.connect(echoSend).connect(echoDelay).connect(echoTone);
    echoTone.connect(echoFb).connect(echoDelay);
    echoTone.connect(musicDuck);
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
  /** desafinación (cents) entre dos osciladores: suena más ancho y "brillante" */
  detune?: number;
  /** filtro paso bajo (Hz); por defecto las ondas duras (cuadrada, sierra) se suavizan solas */
  cutoff?: number;
}

function tone(freq: number, dur: number, { type = 'square', vol = 0.12, slideTo = null, delay = 0, detune = 0, cutoff }: ToneOpts = {}) {
  const c = ac();
  if (!c || progress.settings.sfx <= 0) return;
  const t = c.currentTime + delay;
  const g = c.createGain();
  // entrada de 4 ms (sin "clic") y caída exponencial al final
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.setValueAtTime(vol, t + Math.max(0.005, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const cut = cutoff ?? (type === 'square' || type === 'sawtooth' ? 5200 : 0);
  let out: AudioNode = g;
  if (cut) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cut;
    f.connect(g);
    out = f;
  }
  g.connect(sfxBus);
  for (const d of detune ? [-detune, detune] : [0]) {
    const o = c.createOscillator();
    o.type = type;
    o.detune.value = d;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
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
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.003);
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
    noise(0.04, { vol: 0.22, freq: 5200, type: 'highpass' }); // chasquido del palo
    noise(0.07, { vol: 0.14, freq: 1800 });
    tone(200 + power * 300, 0.09, { type: 'triangle', slideTo: 90, vol: 0.16 });
    tone(900 + power * 700, 0.03, { vol: 0.04 });
    tone(85, 0.14, { type: 'sine', slideTo: 42, vol: 0.12 + power * 0.2 }); // golpe de cuerpo
    if (power > 0.85) tone(55, 0.22, { type: 'sine', slideTo: 32, vol: 0.2, delay: 0.02 });
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
    tone(784, 0.12, { type: 'triangle', vol: 0.07, detune: 6 });
    tone(1175, 0.3, { type: 'triangle', vol: 0.07, delay: 0.09, detune: 6 });
    tone(2350, 0.3, { type: 'sine', vol: 0.025, delay: 0.1 });
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
    tone(1047, 0.07, { vol: 0.09, detune: 6 });
    tone(1568, 0.2, { vol: 0.09, delay: 0.06, detune: 6 });
    tone(3136, 0.25, { type: 'sine', vol: 0.03, delay: 0.07 });
  },
  hazard() {
    tone(400, 0.3, { type: 'sawtooth', slideTo: 50, vol: 0.12 });
    noise(0.25, { vol: 0.25, freq: 600 });
  },
  hole() {
    tone(180, 0.08, { type: 'triangle', slideTo: 90, vol: 0.2 }); // "clonc" de la bola en la copa
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      tone(f, 0.12, { vol: 0.09, delay: 0.08 + i * 0.07, detune: 7 });
      tone(f * 2, 0.16, { type: 'sine', vol: 0.045, delay: 0.08 + i * 0.07 });
    });
    [1047, 1319, 1568].forEach((f) => tone(f, 0.7, { type: 'triangle', vol: 0.05, delay: 0.45 })); // acorde final
    tone(2093, 0.5, { type: 'sine', vol: 0.03, delay: 0.5 });
    music.duck(1.6);
  },
  star(i = 0) {
    const f = 660 * Math.pow(1.26, i);
    tone(f, 0.18, { vol: 0.09, detune: 8 });
    tone(f * 2, 0.12, { type: 'triangle', vol: 0.06, delay: 0.04 });
    tone(f * 3, 0.3, { type: 'sine', vol: 0.03, delay: 0.06 }); // brillo de campana
  },
  click() {
    tone(1250, 0.03, { type: 'triangle', vol: 0.08 });
    tone(640, 0.05, { type: 'sine', vol: 0.06, slideTo: 520 });
  },
  brake() {
    tone(900, 0.12, { slideTo: 200, vol: 0.12 });
    noise(0.1, { vol: 0.15, freq: 2500 });
  },
  buy() {
    [784, 988, 1319, 1760].forEach((f, i) => {
      tone(f, 0.12, { vol: 0.09, delay: i * 0.06, detune: 7 });
      tone(f * 2, 0.1, { type: 'sine', vol: 0.03, delay: i * 0.06 });
    });
  },
  coin() {
    tone(1319, 0.06, { vol: 0.07, detune: 6 });
    tone(1760, 0.16, { vol: 0.07, delay: 0.05, detune: 6 });
    tone(3520, 0.14, { type: 'sine', vol: 0.025, delay: 0.06 });
  },
  denied() {
    tone(220, 0.15, { vol: 0.12, slideTo: 150 });
  },
  splash() {
    noise(0.45, { vol: 0.3, freq: 1400 });
    noise(0.3, { vol: 0.1, freq: 4200, type: 'highpass', delay: 0.04 }); // salpicaduras
    tone(500, 0.18, { type: 'sine', slideTo: 120, vol: 0.12 });
    tone(900, 0.1, { type: 'sine', slideTo: 300, vol: 0.06, delay: 0.08 });
    [0.12, 0.2, 0.3].forEach((d) => tone(700 + Math.random() * 500, 0.06, { type: 'sine', slideTo: 1500, vol: 0.03, delay: d })); // gotas
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

/** Instrumento sintetizado: forma de onda + envolvente + filtro + vibrato */
interface Inst {
  type: OscillatorType;
  vol: number;
  attack?: number;
  /** fracción de la nota que se mantiene antes de caer (0.6 por defecto) */
  hold?: number;
  /** nota pulsada: cae sola, como una cuerda, una marimba o una campana */
  pluck?: boolean;
  /** desafinación en cents entre dos osciladores: sonido ancho, tipo "coro" */
  detune?: number;
  /** vibrato en cents */
  vib?: number;
  /** filtro paso bajo (Hz) para suavizar */
  cutoff?: number;
}

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
  lead: Inst;
  /** semitonos que se suben/bajan la melodía */
  leadShift?: number;
  /** melodía compuesta a mano (frase A y frase B de 4 compases); si no hay, se inventa */
  tune?: { a: NoteDef[][]; b: NoteDef[][] };
  /** acordes cortos a contratiempo (rasgueo de guitarra, skank de reggae, oom-pah) */
  comp?: { steps: number[]; inst: Inst; shift?: number };
  /** semicorcheas del compás donde suena el bajo */
  bass: number[];
  bassInst?: Inst;
  /** duración del bajo en semicorcheas */
  bassLen?: number;
  /** el bajo alterna tónica y quinta (oom-pah) */
  bassAlt?: boolean;
  /** el arpegio suena cada `arp` semicorcheas (0 = sin arpegio) */
  arp: number;
  arpInst?: Inst;
  /** orden de las notas del acorde en el arpegio (los índices que pasan del acorde suben una octava) */
  arpPat?: number[];
  arpShift?: number;
  /** acorde sostenido de fondo */
  pad?: Inst;
  kick: number[];
  snare?: number[];
  hat?: number[];
  ohat?: number[];
  tom?: number[];
  /** cuánta reverb (0–1) */
  reverb: number;
  /** cuánto eco sincronizado con el tempo (0–1) */
  echo?: number;
}

/** nota compuesta a mano: [semicorchea de inicio, duración en semicorcheas, grado de la escala] */
type NoteDef = [number, number, number];
const toPhrase = (bars: NoteDef[][]): Phrase => bars.map((b) => b.map(([step, len, deg]) => ({ step, len, deg })));

interface Note {
  step: number;
  len: number;
  /** grado de la escala */
  deg: number;
}
/** 4 compases de notas */
type Phrase = Note[][];

const maj = (r: number) => [r, r + 4, r + 7];
const min = (r: number) => [r, r + 3, r + 7];
const maj7 = (r: number) => [r, r + 4, r + 7, r + 11];
const min7 = (r: number) => [r, r + 3, r + 7, r + 10];
const dom7 = (r: number) => [r, r + 4, r + 7, r + 10];
const dim = (r: number) => [r, r + 3, r + 6];
const pow = (r: number) => [r, r + 7, r + 12];

type Rhythm = [number, number][][];
const R_BOUNCE: Rhythm = [
  [[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 8]],
  [[2, 2], [4, 2], [8, 2], [10, 2], [12, 4]],
];
const R_FLOW: Rhythm = [
  [[0, 4], [4, 2], [6, 6], [12, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 8]],
  [[2, 4], [6, 2], [8, 4], [12, 4]],
];
const R_SPARSE: Rhythm = [
  [[0, 6], [8, 8]],
  [[0, 4], [4, 4], [12, 4]],
  [[2, 6], [10, 6]],
  [[0, 8], [8, 4], [12, 4]],
];
const R_SYNC: Rhythm = [
  [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
  [[0, 2], [3, 2], [6, 2], [10, 2], [12, 4]],
  [[2, 2], [5, 3], [8, 2], [10, 2], [14, 2]],
];
const R_DRIVE: Rhythm = [
  [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]],
];

const BASS: Inst = { type: 'triangle', vol: 0.32 };
const SUB: Inst = { type: 'sine', vol: 0.42 };
const ALL_8THS = [0, 2, 4, 6, 8, 10, 12, 14];

/**
 * Una canción por mundo (más la del menú). Cada una tiene su tempo, tónica, acordes, escala,
 * ritmos, instrumentos y percusión; el motor inventa la melodía y la va cambiando.
 */
const SONGS: Record<string, Song> = {
  // Menú: cálido y aventurero (I–V–vi–IV en Do mayor)
  menu: {
    bpm: 108, root: 60, swing: 0.05,
    chords: [maj(0), maj(7), min(9), maj(5)],
    scale: [0, 2, 4, 7, 9], rhythms: R_BOUNCE,
    // tema heroico: sube con el acorde de Do, respira en Sol y vuelve a casa
    tune: {
      a: [
        [[0, 4, 7], [4, 4, 8], [8, 4, 10], [12, 4, 8]],
        [[0, 4, 6], [4, 4, 8], [8, 6, 11], [14, 2, 10]],
        [[0, 4, 9], [4, 4, 10], [8, 4, 12], [12, 4, 10]],
        [[0, 4, 9], [4, 4, 8], [8, 8, 8]],
      ],
      b: [
        [[0, 2, 10], [2, 2, 9], [4, 4, 10], [8, 4, 8], [12, 4, 7]],
        [[0, 2, 11], [2, 2, 10], [4, 4, 11], [8, 4, 8], [12, 4, 6]],
        [[0, 4, 9], [4, 2, 10], [6, 2, 9], [8, 4, 8], [12, 4, 9]],
        [[0, 4, 9], [4, 4, 8], [8, 8, 10]],
      ],
    },
    leadShift: -12,
    lead: { type: 'triangle', vol: 0.13, vib: 10, attack: 0.02 },
    bass: [0, 6, 8, 14],
    arp: 2, arpInst: { type: 'sine', vol: 0.07, pluck: true }, arpPat: [0, 1, 2, 1],
    pad: { type: 'triangle', vol: 0.035, attack: 0.4, hold: 0.85, detune: 8 },
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14],
    reverb: 0.55, echo: 0.22,
  },
  // Pradera: alegre y saltarina, en Re mayor
  meadow: {
    bpm: 124, root: 62, swing: 0.08,
    chords: [maj(0), maj(5), min(9), maj(7)],
    scale: [0, 2, 4, 7, 9], rhythms: R_BOUNCE,
    // melodía de día de campo: salta por las notas del acorde y sube con ganas
    tune: {
      a: [
        [[0, 2, 7], [2, 2, 8], [4, 4, 10], [8, 2, 9], [10, 2, 8], [12, 4, 7]],
        [[0, 2, 9], [2, 2, 9], [4, 2, 8], [6, 2, 9], [8, 6, 10], [14, 2, 9]],
        [[0, 2, 9], [2, 2, 8], [4, 2, 7], [6, 2, 8], [8, 4, 9], [12, 4, 7]],
        [[0, 4, 8], [4, 2, 7], [6, 2, 6], [8, 8, 7]],
      ],
      b: [
        [[0, 4, 10], [4, 2, 9], [6, 2, 10], [8, 4, 11], [12, 4, 10]],
        [[0, 4, 9], [4, 2, 8], [6, 2, 9], [8, 4, 10], [12, 4, 9]],
        [[0, 2, 7], [2, 2, 8], [4, 2, 9], [6, 2, 10], [8, 4, 11], [12, 4, 9]],
        [[0, 2, 9], [2, 2, 8], [4, 4, 7], [8, 8, 10]],
      ],
    },
    leadShift: -12,
    lead: { type: 'square', vol: 0.06, cutoff: 4500 },
    bass: [0, 6, 8, 14],
    arp: 2, arpInst: { type: 'square', vol: 0.03, cutoff: 3000 },
    kick: [0, 8], snare: [4, 12], hat: [1, 3, 5, 7, 9, 11, 13, 15],
    reverb: 0.2,
  },
  // Playa caribeña: steel drum, ritmo de tresillo (3-3-2), rasgueo a contratiempo, bongós y maracas
  beach: {
    bpm: 104, root: 55, swing: 0.1,
    chords: [maj(0), maj(5), maj(0), dom7(7)], // Sol – Do – Sol – Re7
    scale: [0, 2, 4, 7, 9], rhythms: R_SYNC,
    tune: {
      a: [
        [[0, 3, 7], [3, 3, 8], [6, 2, 7], [8, 4, 5], [12, 4, 6]],
        [[0, 3, 9], [3, 3, 8], [6, 2, 9], [8, 4, 8], [12, 4, 7]],
        [[0, 3, 7], [3, 3, 8], [6, 2, 10], [8, 4, 9], [12, 4, 8]],
        [[0, 3, 8], [3, 3, 6], [6, 2, 8], [8, 4, 6], [12, 4, 8]],
      ],
      b: [
        [[0, 3, 10], [3, 3, 9], [6, 2, 8], [8, 4, 9], [12, 4, 8]],
        [[0, 3, 9], [3, 3, 8], [6, 2, 7], [8, 4, 8], [12, 4, 9]],
        [[0, 3, 10], [3, 3, 9], [6, 2, 8], [8, 2, 7], [10, 2, 8], [12, 4, 7]],
        [[0, 3, 8], [3, 3, 6], [6, 2, 8], [8, 6, 5]],
      ],
    },
    lead: { type: 'triangle', vol: 0.16, pluck: true, detune: 5, attack: 0.003 }, // steel drum
    bass: [0, 6, 12], bassAlt: true, bassLen: 3,
    arp: 0,
    comp: { steps: [2, 6, 10, 14], inst: { type: 'triangle', vol: 0.04, pluck: true, cutoff: 3200 }, shift: 12 },
    kick: [0, 6, 12], snare: [8], tom: [3, 10, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    reverb: 0.3, echo: 0.12,
  },
  // Pantano: lento, turbio y con eco
  swamp: {
    bpm: 78, root: 50, swing: 0.1,
    chords: [min(0), maj(8), min(5), dom7(7)],
    scale: [0, 3, 5, 7, 10], rhythms: R_SPARSE,
    // blues arrastrado; la parte B repite notas como un croar
    tune: {
      a: [
        [[0, 6, 8], [8, 4, 7], [12, 4, 6]],
        [[0, 4, 6], [4, 2, 5], [8, 8, 5]],
        [[0, 6, 8], [8, 4, 9], [12, 4, 8]],
        [[0, 4, 8], [4, 4, 6], [8, 8, 6]],
      ],
      b: [
        [[0, 2, 9], [2, 2, 9], [4, 4, 8], [8, 8, 7]],
        [[0, 2, 8], [2, 2, 8], [4, 4, 7], [8, 8, 6]],
        [[0, 2, 7], [2, 2, 7], [4, 4, 6], [8, 4, 5], [12, 4, 6]],
        [[0, 6, 8], [8, 8, 5]],
      ],
    },
    lead: { type: 'sawtooth', vol: 0.07, cutoff: 900, vib: 14, attack: 0.03 },
    bass: [0, 6, 10], bassInst: SUB, bassLen: 3,
    arp: 4, arpInst: { type: 'sine', vol: 0.08, pluck: true }, arpPat: [2, 1, 0, 1], arpShift: 12,
    pad: { type: 'sawtooth', vol: 0.02, cutoff: 600, attack: 0.5, hold: 0.9 },
    kick: [0], tom: [10], hat: [6, 14],
    reverb: 0.6, echo: 0.3,
  },
  // Selva: tambores tribales y marimba
  jungle: {
    bpm: 118, root: 52, swing: 0.05,
    chords: [min(0), maj(10), maj(8), maj(10)],
    scale: [0, 3, 5, 7, 10], rhythms: R_SYNC,
    lead: { type: 'square', vol: 0.07, pluck: true, cutoff: 2500 },
    bass: [0, 6, 10],
    arp: 2, arpInst: { type: 'sine', vol: 0.1, pluck: true }, arpPat: [0, 2, 1, 2],
    kick: [0, 8], tom: [0, 3, 6, 8, 11, 14], hat: [4, 12],
    reverb: 0.3, echo: 0.12,
  },
  // Caramelo: caja de música saltarina
  candy: {
    bpm: 132, root: 67, swing: 0.1,
    chords: [maj(0), min(9), maj(5), maj(7)],
    scale: [0, 2, 4, 5, 7, 9, 11], rhythms: R_BOUNCE,
    lead: { type: 'sine', vol: 0.14, pluck: true, attack: 0.003 }, leadShift: 12,
    bass: [0, 6, 8, 14],
    arp: 2, arpInst: { type: 'triangle', vol: 0.06, pluck: true }, arpPat: [0, 1, 2, 1], arpShift: 12,
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14],
    reverb: 0.35, echo: 0.2,
  },
  // Oeste: guitarra con shuffle
  west: {
    bpm: 104, root: 57, swing: 0.2,
    chords: [min(0), maj(10), maj(8), maj(7)],
    scale: [0, 3, 5, 6, 7, 10], rhythms: R_SYNC,
    lead: { type: 'sawtooth', vol: 0.06, pluck: true, cutoff: 2200 },
    bass: [0, 4, 8, 12], bassAlt: true, bassLen: 3,
    arp: 0,
    comp: { steps: [2, 6, 10, 14], inst: { type: 'sawtooth', vol: 0.03, pluck: true, cutoff: 1800 }, shift: 12 }, // rasgueo de guitarra
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14],
    reverb: 0.3, echo: 0.2,
  },
  // Templo: misterioso, escala frigia
  temple: {
    bpm: 92, root: 52, swing: 0,
    chords: [min(0), maj(1), min(0), maj(10)],
    scale: [0, 1, 4, 5, 7, 8, 10], rhythms: R_SPARSE,
    lead: { type: 'triangle', vol: 0.12, vib: 16, attack: 0.03 },
    bass: [0, 6, 10], bassLen: 3,
    arp: 2, arpInst: { type: 'sine', vol: 0.08, pluck: true }, arpPat: [0, 1, 2, 1],
    pad: { type: 'triangle', vol: 0.03, attack: 0.5 },
    kick: [], tom: [0, 6, 8, 14], hat: [4, 12],
    reverb: 0.5, echo: 0.25,
  },
  // Castillo: majestuoso, metales y marcha
  castle: {
    bpm: 88, root: 55, swing: 0,
    chords: [min(0), maj(8), maj(3), maj(10)],
    scale: [0, 2, 3, 5, 7, 8, 10], rhythms: R_FLOW,
    lead: { type: 'sawtooth', vol: 0.05, cutoff: 1800, detune: 10, attack: 0.03 },
    bass: [0, 8], bassLen: 6,
    arp: 4, arpInst: { type: 'triangle', vol: 0.07, pluck: true }, arpPat: [0, 1, 2, 1],
    pad: { type: 'sawtooth', vol: 0.02, cutoff: 900, attack: 0.35, detune: 9 },
    kick: [0, 8], snare: [4, 12], tom: [10],
    reverb: 0.55, echo: 0.1,
  },
  // Mansión encantada: theremin y caja de música
  haunted: {
    bpm: 70, root: 54, swing: 0.05,
    chords: [min(0), maj(8), dim(2), maj(7)],
    scale: [0, 2, 3, 5, 7, 8, 11], rhythms: R_SPARSE,
    lead: { type: 'sine', vol: 0.12, vib: 28, attack: 0.08 }, leadShift: 12,
    bass: [0, 10],
    arp: 4, arpInst: { type: 'sine', vol: 0.09, pluck: true }, arpPat: [2, 1, 0, 1], arpShift: 12,
    pad: { type: 'sawtooth', vol: 0.015, cutoff: 500, attack: 0.6, detune: 14 },
    kick: [0], tom: [8], hat: [14],
    reverb: 0.8, echo: 0.35,
  },
  // Cueva: goteos y cristales
  cave: {
    bpm: 74, root: 48, swing: 0,
    chords: [min(0), maj(8), min(5), maj(10)],
    scale: [0, 3, 5, 7, 10], rhythms: R_SPARSE,
    lead: { type: 'sine', vol: 0.12, pluck: true }, leadShift: 12,
    bass: [0], bassInst: SUB, bassLen: 12,
    arp: 4, arpInst: { type: 'sine', vol: 0.09, pluck: true }, arpPat: [0, 2, 1, 2], arpShift: 24,
    pad: { type: 'triangle', vol: 0.03, attack: 0.8 },
    kick: [], tom: [0],
    reverb: 0.9, echo: 0.4,
  },
  // Fondo marino: corrientes y burbujas
  sea: {
    bpm: 90, root: 53, swing: 0.1,
    chords: [maj7(0), min7(4), maj7(5), min7(2)],
    scale: [0, 2, 4, 7, 9, 11], rhythms: R_FLOW,
    lead: { type: 'triangle', vol: 0.12, vib: 8, attack: 0.04 },
    bass: [0, 10],
    arp: 2, arpInst: { type: 'sine', vol: 0.07, pluck: true }, arpPat: [0, 1, 2, 3, 2, 1], arpShift: 12,
    pad: { type: 'sine', vol: 0.04, attack: 0.5, detune: 6 },
    kick: [0], hat: [8],
    reverb: 0.75, echo: 0.3,
  },
  // Hielo: campanillas cristalinas
  ice: {
    bpm: 96, root: 64, swing: 0,
    chords: [maj7(0), maj7(5), min7(9), maj7(7)],
    scale: [0, 2, 4, 6, 7, 9, 11], rhythms: R_FLOW,
    lead: { type: 'sine', vol: 0.12, pluck: true }, leadShift: 12,
    bass: [0, 8],
    arp: 2, arpInst: { type: 'triangle', vol: 0.05, pluck: true }, arpPat: [0, 1, 2, 3], arpShift: 12,
    pad: { type: 'triangle', vol: 0.03, attack: 0.5, detune: 10 },
    kick: [0], snare: [12], hat: [4, 12],
    reverb: 0.7, echo: 0.3,
  },
  // Volcán: pesado e intenso
  volcano: {
    bpm: 132, root: 45, swing: 0,
    chords: [min(0), maj(1), maj(8), maj(7)],
    scale: [0, 1, 4, 5, 7, 8, 10], rhythms: R_DRIVE,
    lead: { type: 'sawtooth', vol: 0.06, cutoff: 3000, detune: 12 }, leadShift: 12,
    bass: ALL_8THS, bassInst: { type: 'sawtooth', vol: 0.2, cutoff: 450 }, bassLen: 1.6,
    arp: 0,
    pad: { type: 'sawtooth', vol: 0.02, cutoff: 700, attack: 0.2 },
    kick: [0, 4, 8, 12], snare: [4, 12], tom: [10], hat: [2, 6, 10, 14],
    reverb: 0.3, echo: 0.1,
  },
  // Zona industrial: máquinas y metal
  industrial: {
    bpm: 120, root: 50, swing: 0,
    chords: [pow(0), pow(0), pow(3), pow(5)],
    scale: [0, 3, 5, 6, 7, 10], rhythms: R_DRIVE,
    lead: { type: 'square', vol: 0.05, cutoff: 2400 },
    bass: ALL_8THS, bassInst: { type: 'square', vol: 0.14, cutoff: 420 }, bassLen: 1.3,
    arp: 4, arpInst: { type: 'square', vol: 0.03, pluck: true, cutoff: 2000 }, arpPat: [0, 2, 1, 2],
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], ohat: [10],
    reverb: 0.15,
  },
  // Zona nuclear: inquietante, escala de tonos enteros
  nuclear: {
    bpm: 112, root: 52, swing: 0,
    chords: [min(0), dim(2), maj(8), dim(1)],
    scale: [0, 2, 4, 6, 8, 10], rhythms: R_SYNC,
    lead: { type: 'sawtooth', vol: 0.05, cutoff: 1400, vib: 12, attack: 0.02 },
    bass: [0, 2, 6, 8, 10, 14], bassInst: { type: 'sawtooth', vol: 0.16, cutoff: 380 }, bassLen: 1.6,
    arp: 2, arpInst: { type: 'square', vol: 0.03, pluck: true, cutoff: 2500 }, arpPat: [0, 2, 1, 3],
    kick: [0, 8], snare: [12], hat: [2, 6, 10, 14], ohat: [14],
    reverb: 0.4, echo: 0.25,
  },
  // Ciudad neón: synthwave
  neon: {
    bpm: 108, root: 57, swing: 0,
    chords: [min7(0), maj7(8), maj7(3), dom7(10)],
    scale: [0, 2, 3, 5, 7, 8, 10], rhythms: R_SYNC,
    lead: { type: 'sawtooth', vol: 0.06, cutoff: 3200, detune: 10, vib: 6, attack: 0.02 },
    bass: ALL_8THS, bassInst: { type: 'sawtooth', vol: 0.22, cutoff: 500 }, bassLen: 1.8,
    arp: 2, arpInst: { type: 'sawtooth', vol: 0.025, pluck: true, cutoff: 2000 }, arpPat: [0, 1, 2, 3, 2, 1],
    pad: { type: 'sawtooth', vol: 0.02, cutoff: 1200, attack: 0.3, detune: 12 },
    kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14],
    reverb: 0.5, echo: 0.3,
  },
  // Circo: oom-pah de feria
  circus: {
    bpm: 140, root: 60, swing: 0.1,
    chords: [maj(0), maj(5), maj(0), maj(7)],
    scale: [0, 2, 4, 5, 7, 9, 11], rhythms: R_BOUNCE,
    lead: { type: 'square', vol: 0.05, cutoff: 4000 },
    bass: [0, 4, 8, 12], bassAlt: true, bassLen: 2,
    arp: 0,
    comp: { steps: [4, 12], inst: { type: 'square', vol: 0.035, pluck: true, cutoff: 3000 }, shift: 0 }, // el "pah"
    kick: [0, 8], snare: [4, 12], hat: [2, 6, 10, 14],
    reverb: 0.2,
  },
  // Cielo: arpas y nubes
  sky: {
    bpm: 100, root: 62, swing: 0,
    chords: [maj7(0), maj(7), min7(9), maj7(5)],
    scale: [0, 2, 4, 7, 9], rhythms: R_FLOW,
    lead: { type: 'triangle', vol: 0.12, vib: 8 }, leadShift: 12,
    bass: [0, 10],
    arp: 2, arpInst: { type: 'sine', vol: 0.08, pluck: true }, arpPat: [0, 1, 2, 3, 2, 1], arpShift: 12,
    pad: { type: 'triangle', vol: 0.035, attack: 0.5, detune: 8 },
    kick: [0], snare: [12], hat: [4, 12],
    reverb: 0.65, echo: 0.25,
  },
  // Espacio: flotante y sin percusión
  space: {
    bpm: 80, root: 57, swing: 0,
    chords: [maj7(0), maj(2), min7(9), maj7(5)],
    scale: [0, 2, 4, 6, 7, 9, 11], rhythms: R_SPARSE,
    lead: { type: 'sine', vol: 0.12, vib: 10, attack: 0.06 }, leadShift: 12,
    bass: [0], bassInst: SUB, bassLen: 14,
    arp: 4, arpInst: { type: 'triangle', vol: 0.07, pluck: true }, arpPat: [0, 1, 2, 3], arpShift: 12,
    pad: { type: 'sawtooth', vol: 0.015, cutoff: 900, attack: 0.8, detune: 12 },
    kick: [],
    reverb: 0.85, echo: 0.45,
  },
  // Espacio profundo: oscuro, latido lejano
  deepspace: {
    bpm: 66, root: 48, swing: 0,
    chords: [min(0), maj(8), maj(3), maj(10)],
    scale: [0, 3, 5, 7, 10], rhythms: R_SPARSE,
    lead: { type: 'sine', vol: 0.11, vib: 14, attack: 0.1 }, leadShift: 12,
    bass: [0], bassInst: { type: 'sine', vol: 0.45 }, bassLen: 14,
    arp: 8, arpInst: { type: 'sine', vol: 0.07, pluck: true }, arpPat: [0, 2, 1], arpShift: 24,
    pad: { type: 'sawtooth', vol: 0.02, cutoff: 500, attack: 1, hold: 0.9, detune: 16 },
    kick: [0],
    reverb: 0.95, echo: 0.5,
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
  // el compás 1 y el 2 comparten ritmo (pregunta y respuesta) y el 4 vuelve al ritmo del 1: la frase se reconoce
  const pick = () => song.rhythms[Math.floor(rand() * song.rhythms.length)];
  const r0 = pick();
  const r1 = pick();
  const rhythms = [r0, r0, r1, r0];
  for (let b = 0; b < 4; b++) {
    if (b === 2 && rand() < 0.2) {
      bars.push([]); // compás de respiro
      continue;
    }
    const chordPcs = song.chords[b % song.chords.length].map((x) => ((x % 12) + 12) % 12);
    const notes = rhythms[b].map(([step, len]) => {
      const moves = [-2, -1, -1, 0, 1, 1, 2];
      deg = Math.min(n * 2 + 2, Math.max(1, deg + moves[Math.floor(rand() * moves.length)]));
      // en los tiempos fuertes y en las notas largas la melodía cae sobre una nota del acorde
      if (step % 8 === 0 || len >= 4) {
        for (const o of [0, 1, -1, 2, -2]) {
          const d = deg + o;
          if (d >= 1 && chordPcs.includes(song.scale[d % n] % 12)) {
            deg = d;
            break;
          }
        }
      }
      return { step, len, deg };
    });
    bars.push(notes);
  }
  // la frase termina en la tónica para que "cierre"
  const last = bars[3][bars[3].length - 1];
  if (last) last.deg = Math.round(last.deg / n) * n || n;
  return bars;
}

/** Una nota de un instrumento (dos osciladores si lleva desafinación, filtro y vibrato opcionales) */
function voice(midi: number, t: number, dur: number, inst: Inst, volMul = 1) {
  if (!ctx) return;
  const vol = inst.vol * volMul;
  const atk = inst.attack ?? 0.008;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + atk);
  let end: number;
  if (inst.pluck) {
    end = t + atk + Math.max(0.18, dur * 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  } else {
    g.gain.setValueAtTime(vol, Math.max(t + atk + 0.001, t + dur * (inst.hold ?? 0.6)));
    end = t + dur;
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  let out: AudioNode = g;
  if (inst.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = inst.cutoff;
    f.connect(g);
    out = f;
  }
  g.connect(musicFilter);
  const dets = inst.detune ? [-inst.detune, inst.detune] : [0];
  for (const d of dets) {
    const o = ctx.createOscillator();
    o.type = inst.type;
    o.frequency.setValueAtTime(midiHz(midi), t);
    o.detune.value = d;
    o.connect(out);
    if (inst.vib) {
      const l = ctx.createOscillator();
      const ld = ctx.createGain();
      l.frequency.value = 5.2;
      ld.gain.value = inst.vib;
      l.connect(ld).connect(o.detune);
      l.start(t + Math.min(0.25, dur * 0.4)); // el vibrato entra con la nota ya sonando
      l.stop(end + 0.02);
    }
    o.start(t);
    o.stop(end + 0.02);
  }
}

type DrumKind = 'kick' | 'snare' | 'hat' | 'ohat' | 'tom';

function drum(t: number, kind: DrumKind, vel = 1) {
  if (!ctx) return;
  if (kind === 'kick' || kind === 'tom') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const k = kind === 'kick';
    o.frequency.setValueAtTime(k ? 140 : 230, t);
    o.frequency.exponentialRampToValueAtTime(k ? 45 : 100, t + (k ? 0.12 : 0.2));
    g.gain.setValueAtTime((k ? 0.35 : 0.26) * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (k ? 0.14 : 0.24));
    o.connect(g).connect(musicFilter);
    o.start(t);
    o.stop(t + 0.26);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  let dur = 0.04;
  let gain = 0.06;
  if (kind === 'snare') {
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.8;
    dur = 0.13;
    gain = 0.16;
    // cuerpo tonal de la caja
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    og.gain.setValueAtTime(0.12 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(musicFilter);
    o.start(t);
    o.stop(t + 0.12);
  } else {
    f.type = 'highpass';
    f.frequency.value = 7000;
    if (kind === 'ohat') {
      dur = 0.17;
      gain = 0.05;
    }
  }
  g.gain.setValueAtTime(gain * vel, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(musicFilter);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.01);
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

  /** Elige la canción ('menu' o el tema de un mundo). Si ya suena, no se reinicia. */
  play(theme) {
    if (!SONGS[theme]) theme = 'meadow';
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
    const song = SONGS[this.theme ?? 'meadow'] ?? SONGS.meadow;
    this.song = song;
    this.rand = rng((Date.now() ^ (song.root * 7919)) >>> 0);
    this.phrases = song.tune ? [toPhrase(song.tune.a), toPhrase(song.tune.b)] : [makePhrase(song, this.rand), makePhrase(song, this.rand)];
    this.bar = 0;
    if (ctx) {
      // reverb y eco propios de cada canción (el eco va a corchea con puntillo del tempo)
      const t = ctx.currentTime;
      musicVerbGain.gain.setTargetAtTime(song.reverb * 0.5, t, 0.3);
      echoSend.gain.setTargetAtTime(song.echo ?? 0, t, 0.3);
      echoDelay.delayTime.setTargetAtTime((60 / song.bpm) * 0.75, t, 0.1);
    }
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
      const song = this.song || SONGS.meadow;
      const sixteenth = 60 / song.bpm / 4;
      // swing: las semicorcheas pares se alargan un poco
      const sw = this.step % 2 === 0 ? 1 + song.swing : 1 - song.swing;
      this.nextTime += sixteenth * sw;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) {
        this.bar++;
        // cada 16 compases (A A B A ×1) se inventa una frase B nueva
        if (this.bar % 16 === 0 && this.song && !this.song.tune) this.phrases[1] = makePhrase(this.song, this.rand);
      }
    }
  },

  playStep(t) {
    const s = this.song;
    if (!s) return;
    const st = this.step;
    const sixteenth = 60 / s.bpm / 4;
    const chord = s.chords[this.bar % s.chords.length];
    const cyc = this.bar % 16; // posición dentro de la vuelta de 16 compases

    // pad: el acorde entero sostenido todo el compás
    if (s.pad && st === 0) {
      for (const n of chord) voice(s.root + n, t, sixteenth * 16.5, s.pad);
    }
    // bajo
    const bi = s.bass.indexOf(st);
    if (bi >= 0) {
      let n = s.root - 24 + chord[0];
      if (s.bassAlt) {
        if (bi % 2 === 1) n += 7;
      } else if (st === 8 && s.bass.length > 2 && s.bass.length < 8) n += 12;
      voice(n, t, sixteenth * (s.bassLen ?? (s.bass.length > 2 ? 2.2 : 6)), s.bassInst ?? BASS);
    }
    // arpegio
    if (s.arp > 0 && s.arpInst && st % s.arp === 0) {
      const pat = s.arpPat ?? chord.map((_, i) => i);
      const k = pat[Math.floor(st / s.arp) % pat.length];
      const n = chord[k % chord.length] + 12 * Math.floor(k / chord.length) + (s.arpShift ?? 0);
      voice(s.root + n, t, sixteenth * s.arp * (s.arpInst.pluck ? 1.6 : 0.9), s.arpInst);
    }
    // acordes cortos a contratiempo
    if (s.comp?.steps.includes(st)) {
      for (const n of chord) voice(s.root + n + (s.comp.shift ?? 0), t, sixteenth * 1.5, s.comp.inst);
    }
    // percusión: los dos primeros compases de cada vuelta van sin bombo ni caja (entrada suave)
    if (s.hat?.includes(st)) drum(t, 'hat', st % 4 === 2 ? 1 : 0.65);
    if (s.ohat?.includes(st)) drum(t, 'ohat');
    if (cyc >= 2) {
      if (s.kick.includes(st)) drum(t, 'kick');
      if (s.snare?.includes(st)) drum(t, 'snare');
      if (s.tom?.includes(st)) drum(t, 'tom');
    }
    // redoble al final de la vuelta
    if (cyc === 15 && st >= 12 && (s.snare || s.tom)) drum(t, s.snare ? 'snare' : 'tom', 0.5 + (st - 12) * 0.15);

    // melodía (frase A A B A)
    const phrase = this.phrases[this.order[Math.floor(this.bar / 4) % 4]];
    const notes = phrase[this.bar % 4];
    for (const nt of notes) {
      if (nt.step !== st) continue;
      const n = s.scale.length;
      const midi = s.root + s.scale[nt.deg % n] + 12 * Math.floor(nt.deg / n) + (s.leadShift ?? 0);
      voice(midi, t, sixteenth * nt.len * 0.95, s.lead);
    }
  },
};
