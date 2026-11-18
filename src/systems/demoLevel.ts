import { COLS, TILE as T, type ThemeKey } from '../constants';
import { WORLDS } from '../data/worlds';
import type { ParsedLevel } from '../data/levels';

/**
 * Hoyo aleatorio para la partida de fondo del menú: una escalera de islas que sube hasta el hoyo.
 * Sin Phaser: lo usa GameScene (modo demo) y la herramienta de comprobación (tools/check-demo.ts).
 */

/** Plataforma por la que pasa el recorrido: centro x, cara de arriba y y ancho (px del mundo) */
export interface Stop {
  x: number;
  y: number;
  w: number;
}

export interface DemoHole {
  L: ParsedLevel;
  /** el suelo y las islas por orden de subida; la última lleva el hoyo */
  stops: Stop[];
}

/** Mundos con hoyos de verdad: son los que salen en el fondo del menú */
export const DEMO_THEMES: ThemeKey[] = WORLDS.filter((w) => !w.comingSoon && w.levels.length).map((w) => w.theme);

/** Casilla "especial" de cada mundo con la que se salpican las islas (frena y resta potencia) */
const SPECIAL: Partial<Record<ThemeKey, string>> = { meadow: 'r', beach: 's', swamp: 'm' };

/** Generador pseudoaleatorio con semilla (mulberry32) */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Filas de suelo bajo la salida (la cámara necesita terreno bajo la bola) y de cielo sobre el hoyo */
const GROUND_ROWS = 16;
const SKY_ROWS = 20;

export function generateDemoHole(theme: ThemeKey, seed: number): DemoHole {
  const rand = seeded(seed);
  const ri = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const cols = COLS;
  const last = cols - 2; // última columna interior (1..last)

  const count = ri(5, 7); // islas (la última lleva el hoyo)
  const gaps = Array.from({ length: count }, () => ri(4, 5)); // filas de subida entre una isla y la siguiente
  const total = gaps.reduce((a, b) => a + b, 0);
  const rows = SKY_ROWS + total + GROUND_ROWS;
  const groundRow = rows - GROUND_ROWS;

  const grid: string[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r >= groundRow || c === 0 || c === cols - 1 ? '#' : '.')),
  );

  // salida: lejos de las paredes para que la bola no empiece pegada a una
  const startC = ri(4, last - 3);
  const stops: Stop[] = [{ x: (cols * T) / 2, y: groundRow * T, w: (cols - 2) * T }];

  // charca en el suelo (a un lado de la salida): si la bola cae, respawn con +1 golpe
  if (rand() < 0.85) {
    const n = ri(3, 4);
    const room = startC > cols / 2 ? [2, startC - n - 2] : [startC + 3, last - n];
    if (room[1] >= room[0]) {
      const c0 = ri(room[0], room[1]);
      for (let c = c0; c < c0 + n; c++) grid[groundRow][c] = 'W';
    }
  }

  const special = SPECIAL[theme];
  let row = groundRow;
  for (let k = 0; k < count; k++) {
    row -= gaps[k];
    const finalIsland = k === count - 1;
    const w = finalIsland ? 7 : ri(4, 6);
    // zigzag: cada isla en el lado contrario a la anterior. Así cada salto es lateral, la bola cae sobre la isla
    // y no choca por debajo con la que viene después (la siguiente queda en el lado de donde sale el golpe, mucho más arriba)
    // Cada lado tiene su mitad (columnas 1–8 y 11–18) y entre las dos queda un pasillo libre: dos islas seguidas nunca se solapan.
    const goRight = (k % 2 === 0) === (startC < cols / 2);
    const c0 = goRight ? ri(11, last - w + 1) : ri(1, 8 - w + 1);
    const c1 = c0 + w - 1;
    for (let cc = c0; cc <= c1; cc++) {
      grid[row][cc] = '#';
      grid[row + 1][cc] = '#';
    }
    // alguna casilla del mundo (arena, rough, barro) en un extremo de la isla, lejos del centro de aterrizaje
    if (special && !finalIsland && w >= 5 && rand() < 0.35) grid[row][rand() < 0.5 ? c0 : c1] = special;
    stops.push({ x: ((c0 + c1 + 1) / 2) * T, y: row * T, w: w * T });
  }

  // hoyo en el centro de la última isla, con el césped fino del green alrededor (como parseLevel)
  const top = stops[stops.length - 1];
  const holeC = Math.round(top.x / T - 0.5);
  const holeR = Math.round(top.y / T) - 1;
  for (let c = holeC - 3; c <= holeC + 3; c++) if (grid[holeR + 1][c] === '#' && c >= 1 && c <= last) grid[holeR + 1][c] = 'G';

  const wi = Math.max(0, WORLDS.findIndex((w) => w.theme === theme));
  const world = WORLDS[wi];
  const L: ParsedLevel = {
    name: 'Partida de fondo', par: count, map: '', theme, world: world.id, worldName: world.name, worldIndex: wi,
    number: ri(1, 9), holes: 9, id: `demo-${theme}`, code: 0,
    index: 0, open: false, grid, cols, rows, groundRow,
    start: { c: startC, r: groundRow - 1 }, hole: { c: holeC, r: holeR },
    saws: [], bumpers: [], mushrooms: [], movers: [], crumbles: [], tides: [], wind: 0, windBands: [], fogBands: [],
  };
  return { L, stops };
}
