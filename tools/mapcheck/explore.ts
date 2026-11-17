/**
 * Explora un hoyo golpe a golpe: desde cada sitio donde la bola puede quedarse parada prueba una rejilla
 * de golpes (ángulo × potencia), y con eso calcula
 *   - el mínimo de golpes (jugador perfecto)
 *   - los golpes esperados de un jugador real (falla unos 3° y un 5 % de potencia), que es la base del par
 *   - la ruta recomendada, con la fiabilidad y el riesgo de cada golpe
 *   - sitios sin salida (desde donde ya no se puede llegar al hoyo)
 */
import { TILE as T } from '../../src/constants';
import type { ParsedLevel } from '../../src/data/levels';
import { LevelSim, restOfStart, type Rest, type Outcome } from './sim';

export const ANGLE_STEP = 3; // grados
export const ANGLES = Array.from({ length: Math.floor(174 / ANGLE_STEP) + 1 }, (_, i) => -177 + i * ANGLE_STEP);
export const POWERS = Array.from({ length: 19 }, (_, i) => 0.1 + i * 0.05);
/**
 * Error de un jugador real: pesos binomiales de los vecinos en la rejilla (±2 pasos de ángulo y potencia,
 * σ ≈ 3° y 5 %). La potencia no pasa del 100 % (el arrastre se topa), así que los golpes a tope son exactos.
 */
const W5 = [1, 4, 6, 4, 1];
const NOISE = W5.flatMap((wa, i) => W5.map((wp, j) => [i - 2, j - 2, wa * wp] as const));
const NOISE_SUM = 256;

type Res = { k: 'sink' } | { k: 'pen'; why: string } | { k: 'node'; id: number };

export interface Node {
  id: number;
  key: string;
  rest: Rest;
  /** resultado de cada golpe [momento][ángulo][potencia] */
  out: Res[][][] | null;
}

export interface Step {
  node: Node;
  angle: number;
  power: number;
  /** momento elegido (ms del ciclo), si hay piezas móviles */
  phase: number;
  /** probabilidad de avanzar (meterla o acercarse) con el error de un jugador real */
  reliability: number;
  /** probabilidad de penalización (agua, sierra, fuera de límites) */
  risk: number;
  result: Res;
}

export interface Report {
  id: string;
  name: string;
  par: number;
  nodes: number;
  capped: boolean;
  minStrokes: number;
  expected: number;
  suggestedPar: number;
  route: Step[];
  deadEnds: Node[];
  ms: number;
  shots: number;
}

const keyOf = (r: Rest) =>
  r.mover !== undefined ? `m${r.mover}:${Math.round((r.dx ?? 0) / 8)}` : `${Math.round(r.x / 6)},${Math.round(r.y / 4)}`;

/**
 * Momentos de golpe que se prueban (ms) cuando hay plataformas o sierras móviles: el jugador puede
 * esperar al momento bueno, así que el momento es una decisión más (como el ángulo), no un error.
 */
export const phasesOf = (L: ParsedLevel) => (L.movers.length > 0 || L.saws.some((s) => s.range) ? [0, 800, 1600, 2400] : [0]);

/** Prueba toda la rejilla de golpes desde un sitio, en cada momento (se ejecuta en los workers) */
export function shootGrid(sim: LevelSim, rest: Rest): Outcome[][][] {
  return phasesOf(sim.L).map((phase) =>
    ANGLES.map((a) => POWERS.map((p) => sim.shoot(rest, (a * Math.PI) / 180, p, phase))),
  );
}

export type Shooter = (rest: Rest) => Promise<Outcome[][][]>;

export async function explore(L: ParsedLevel, shooter: Shooter, { maxNodes = 700 }: { maxNodes?: number } = {}): Promise<Report> {
  const t0 = performance.now();
  const nodes: Node[] = [];
  const byKey = new Map<string, Node>();
  const getNode = (rest: Rest) => {
    const k = keyOf(rest);
    let n = byKey.get(k);
    if (!n) {
      n = { id: nodes.length, key: k, rest, out: null };
      nodes.push(n);
      byKey.set(k, n);
    }
    return n;
  };
  let shots = 0;

  // BFS por oleadas: cada sitio nuevo se expande con toda la rejilla de golpes (en paralelo)
  const start = getNode(restOfStart(L));
  let wave = [start];
  let capped = false;
  while (wave.length) {
    const grids = await Promise.all(wave.map((n) => shooter(n.rest)));
    const next: Node[] = [];
    wave.forEach((n, i) => {
      n.out = grids[i].map((grid) => grid.map((row) =>
        row.map((o) => {
          shots++;
          if (o.kind === 'sink') return { k: 'sink' } as Res;
          if (o.kind !== 'rest') return { k: 'pen', why: o.kind } as Res;
          const m = getNode(o.rest);
          if (!m.out && m !== n && !next.includes(m)) {
            if (m.id < maxNodes) next.push(m);
            else capped = true;
          }
          return { k: 'node', id: m.id } as Res;
        }),
      ));
    });
    wave = next.filter((m) => !m.out);
  }

  // Mínimo de golpes (BFS hacia atrás desde el hoyo sobre el grafo)
  const INF = 1e9;
  const best = nodes.map(() => INF);
  for (let it = 0; it < nodes.length + 2; it++) {
    let changed = false;
    for (const n of nodes) {
      if (!n.out) continue;
      let b = best[n.id];
      for (const grid of n.out) for (const row of grid) for (const r of row) {
        const v = r.k === 'sink' ? 1 : r.k === 'node' ? best[r.id] + 1 : INF;
        if (v < b) b = v;
      }
      if (b < best[n.id]) {
        best[n.id] = b;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Golpes esperados con error (iteración de valores)
  const E = nodes.map(() => 60);
  const value = (n: Node, fi: number, ai: number, pi: number, En: number) => {
    let s = 0;
    for (const [da, dp, w] of NOISE) {
      const a = Math.min(ANGLES.length - 1, Math.max(0, ai + da));
      const p = Math.min(POWERS.length - 1, Math.max(0, pi + dp));
      const r = n.out![fi][a][p];
      s += w * (r.k === 'sink' ? 0 : r.k === 'pen' ? 1 + En : r.id === n.id ? En : E[r.id]);
    }
    return s / NOISE_SUM;
  };
  for (let it = 0; it < 400; it++) {
    let delta = 0;
    for (const n of nodes) {
      if (!n.out) continue;
      let b = INF;
      for (let fi = 0; fi < n.out.length; fi++)
        for (let ai = 0; ai < ANGLES.length; ai++) for (let pi = 0; pi < POWERS.length; pi++) b = Math.min(b, value(n, fi, ai, pi, E[n.id]));
      const v = Math.min(60, 1 + b);
      delta = Math.max(delta, Math.abs(v - E[n.id]));
      E[n.id] = v;
    }
    if (delta < 1e-4) break;
  }

  // Ruta recomendada: en cada sitio, el golpe que minimiza los golpes esperados
  const route: Step[] = [];
  let cur: Node | undefined = start;
  const visited = new Set<number>();
  while (cur && cur.out && route.length < 40 && !visited.has(cur.id)) {
    visited.add(cur.id);
    let bv = INF, bf = 0, ba = 0, bp = 0;
    for (let fi = 0; fi < cur.out.length; fi++)
      for (let ai = 0; ai < ANGLES.length; ai++) for (let pi = 0; pi < POWERS.length; pi++) {
        const v = value(cur, fi, ai, pi, E[cur.id]);
        if (v < bv - 1e-9) {
          bv = v;
          bf = fi;
          ba = ai;
          bp = pi;
        }
      }
    let ok = 0, pen = 0;
    for (const [da, dp, w] of NOISE) {
      const r = cur.out[bf][Math.min(ANGLES.length - 1, Math.max(0, ba + da))][Math.min(POWERS.length - 1, Math.max(0, bp + dp))];
      if (r.k === 'sink' || (r.k === 'node' && E[r.id] < E[cur.id] - 0.3)) ok += w;
      if (r.k === 'pen') pen += w;
    }
    const result = cur.out[bf][ba][bp];
    route.push({ node: cur, angle: ANGLES[ba], power: POWERS[bp], phase: phasesOf(L)[bf], reliability: ok / NOISE_SUM, risk: pen / NOISE_SUM, result });
    cur = result.k === 'node' ? nodes[result.id] : undefined;
  }

  // sitios alcanzables desde los que ya no se puede llegar al hoyo
  const deadEnds = nodes.filter((n) => n.out && best[n.id] >= INF);

  const expected = E[start.id];
  return {
    id: L.id, name: L.name, par: L.par, nodes: nodes.length, capped,
    minStrokes: best[start.id] >= INF ? Infinity : best[start.id],
    expected,
    // par = golpes de un jugador real, redondeado (nunca menos que el mínimo + 1 si hay más de un golpe)
    suggestedPar: Math.max(best[start.id] >= INF ? 0 : best[start.id], Math.round(expected)),
    route, deadEnds, ms: performance.now() - t0, shots,
  };
}

/** Pinta el mapa con la ruta recomendada (S, 2, 3… = desde dónde sale cada golpe) y los sitios sin salida (x) */
export function drawRoute(L: ParsedLevel, rep: Report): string {
  const g = L.grid.map((row) => row.slice());
  const mark = (x: number, y: number, ch: string) => {
    const r = Math.floor(y / T), c = Math.floor(x / T);
    if (g[r]?.[c] !== undefined) g[r][c] = ch;
  };
  // objetos (el parser los quita de la rejilla)
  for (const m of L.movers) for (let k = 0; k < m.n; k++) g[m.r][m.c + k] = 'P';
  for (const m of L.crumbles) for (let k = 0; k < m.n; k++) g[m.r][m.c + k] = 'C';
  for (const m of L.mushrooms) g[m.r][m.c] = 'M';
  for (const b of L.bumpers) g[b.r][b.c] = 'O';
  for (const sw of L.saws) g[sw.r][sw.c] = sw.range ? 'Y' : 'X';
  for (const n of rep.deadEnds) mark(n.rest.x, n.rest.y, 'x');
  g[L.hole.r][L.hole.c] = 'H';
  rep.route.forEach((s, i) => mark(s.node.rest.x, s.node.rest.y, i === 0 ? 'S' : '123456789abcdefghijklmnopqrstuvwxyz'[i]));
  const rows = L.open ? g : g.slice(0, L.groundRow);
  return rows.map((r) => '  ' + r.join('')).join('\n');
}
