import { TILE as T, type MaterialKey } from '../constants';

/**
 * Formas físicas del terreno de un mapa, sin depender de Phaser.
 * Las usan GameScene (para crear los cuerpos de Matter) y el validador de mapas
 * (tools/check-maps.ts), así los dos simulan exactamente el mismo terreno.
 */

/** Casillas sólidas enteras y su material */
export const FULL_MAT: Record<string, MaterialKey> = { '#': 'grass', G: 'grass', r: 'rough', s: 'sand', i: 'ice', m: 'mud', q: 'quicksand' };

/** Ciclo de los bancos de arena de marea 'T' (ms): TIDE_LOW con el banco a la vista y el resto bajo el agua. Lo comparten el juego y el validador */
export const TIDE_PERIOD = 12000;
export const TIDE_LOW = 8000;
/** desfase entre un banco y el siguiente (ms), para que no suban y bajen a la vez */
export const TIDE_PHASE_STEP = 4000;

/** Bloques frágiles 'C' (ms): tiempo desde que se pisan hasta que caen, y hasta que reaparecen. Lo comparten el juego y el validador */
export const CRUMBLE_DELAY = 2600;
export const CRUMBLE_RESTORE = 4000;

/** Velocidad (px/s) con la que un bumper lanza la bola; los corales de la Playa rebotan algo más. Lo comparten el juego y el validador */
export const BUMPER_SPEED = 280;
export const CORAL_SPEED = 360;
export const bumperSpeed = (theme: string) => (theme === 'beach' ? CORAL_SPEED : BUMPER_SPEED);

/** Grosor (px) de las plataformas finas '=' */
export const THIN_H = 7;

export interface RectShape {
  x: number;
  y: number;
  w: number;
  h: number;
  mat: MaterialKey;
  /** plataforma fina '=': solo es sólida por arriba (se atraviesa desde abajo) */
  thin?: boolean;
}

export interface RampShape {
  /** triángulo en coordenadas del mundo */
  verts: { x: number; y: number }[];
  mat: MaterialKey;
}

/**
 * Plataforma fina de un solo sentido: choca con la bola solo si la bola está por encima
 * (la base de la bola no más de 3 px por debajo de la cara de arriba). Se evalúa antes de cada paso de física.
 */
export const thinSolidFor = (ballY: number, ballR: number, top: number) => ballY + ballR <= top + 3;

/** Tramos de casillas fusionados en rectángulos grandes (menos juntas = la bola no se engancha) */
export function terrainRects(g: string[][]): RectShape[] {
  type Key = MaterialKey | 'thin';
  type Run = { c0: number; c1: number; r0: number; r1: number; key: Key };
  const keyOf = (ch: string): Key | null => FULL_MAT[ch] || (ch === '=' ? 'thin' : null);
  const open: Run[] = [];
  const rects: Run[] = [];
  for (let r = 0; r < g.length; r++) {
    const runs: Run[] = [];
    const cols = g[r].length;
    for (let c = 0; c < cols; c++) {
      const key = keyOf(g[r][c]);
      if (!key) continue;
      let n = 1;
      while (c + n < cols && keyOf(g[r][c + n]) === key) n++;
      runs.push({ c0: c, c1: c + n - 1, r0: r, r1: r, key });
      c += n - 1;
    }
    for (const run of runs) {
      const prev = run.key !== 'thin' && open.find((o) => o.key === run.key && o.c0 === run.c0 && o.c1 === run.c1 && o.r1 === r - 1);
      if (prev) prev.r1 = r;
      else {
        open.push(run);
        rects.push(run);
      }
    }
  }
  return rects.map((q) => {
    const x = q.c0 * T;
    const w = (q.c1 - q.c0 + 1) * T;
    return q.key === 'thin'
      ? { x, y: q.r0 * T, w, h: THIN_H, mat: 'grass' as const, thin: true }
      : { x, y: q.r0 * T, w, h: (q.r1 - q.r0 + 1) * T, mat: q.key };
  });
}

/** Material de cada rampa: '/' y '\' de hierba, '{' (sube a la derecha) y '}' (sube a la izquierda) de arena */
const RAMP_MAT: Record<string, MaterialKey> = { '/': 'grass', '\\': 'grass', '{': 'sand', '}': 'sand' };

/** Rampas: cada diagonal continua es un solo triángulo */
export function terrainRamps(g: string[][]): RampShape[] {
  const out: RampShape[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < g.length; r++) {
    for (let c = 0; c < g[r].length; c++) {
      const ch = g[r][c];
      if (!RAMP_MAT[ch] || seen.has(`${r},${c}`)) continue;
      const up = ch === '/' || ch === '{';
      let n = 0;
      while (g[up ? r - n : r + n]?.[c + n] === ch) {
        seen.add(`${up ? r - n : r + n},${c + n}`);
        n++;
      }
      const verts = up
        ? [{ x: c * T, y: (r + 1) * T }, { x: (c + n) * T, y: (r + 1 - n) * T }, { x: (c + n) * T, y: (r + 1) * T }]
        : [{ x: c * T, y: r * T }, { x: (c + n) * T, y: (r + n) * T }, { x: c * T, y: (r + n) * T }];
      out.push({ verts, mat: RAMP_MAT[ch] });
    }
  }
  return out;
}
