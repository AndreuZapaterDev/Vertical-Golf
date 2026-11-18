import type GameScene from '../scenes/GameScene';
import { GRAVITY, MAX_DRAG, MAX_SPEED, BALL_R, MATERIALS, SHOT_POWER_EXPONENT, TILE as T } from '../constants';
import { FULL_MAT } from '../data/terrainShapes';
import type { DemoSim, Outcome, Rest } from './demoSim';
import type { Stop } from './demoLevel';

/**
 * "Jugador" automático de la partida de fondo del menú.
 *
 * Planifica cada golpe con DemoSim (la misma física que el juego): apunta a la siguiente isla con la
 * trayectoria de un proyectil, comprueba en la simulación que el golpe sale bien y entonces lo ejecuta
 * en el juego de verdad, con el mismo apuntado y carga que un jugador (la flecha crece, suben los clics).
 */

export interface Shot {
  /** radianes, −π/2 = arriba */
  angle: number;
  /** 0–1 (la que da la curva de potencia del juego) */
  power: number;
}

const onStop = (r: Rest, s: Stop) => Math.abs(r.x - s.x) <= s.w / 2 + 1 && Math.abs(r.y + BALL_R - s.y) < 4;

/** En qué plataforma está parada la bola (la más cercana si no está sobre ninguna) */
export function stopIndex(stops: Stop[], r: Rest): number {
  const on = stops.findIndex((s) => onStop(r, s));
  if (on >= 0) return on;
  let best = 0;
  let bd = Infinity;
  stops.forEach((s, i) => {
    const d = Math.hypot(s.x - r.x, s.y - r.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/**
 * Ángulos (del juego: −π/2 = arriba) con los que un golpe de velocidad `v` pasa por un punto a `dx` en horizontal y
 * `dyUp` por encima (negativo si está más abajo), llegando BAJANDO (si no, chocaría con la isla por debajo). Hay dos: tiro tenso y tiro alto.
 */
export function arcAngles(dx: number, dyUp: number, v: number): number[] {
  const adx = Math.abs(dx);
  if (adx < 1.5) return dyUp > 0 ? [-Math.PI / 2] : [];
  const A = (GRAVITY * adx * adx) / (2 * v * v);
  const disc = adx * adx - 4 * A * (dyUp + A);
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: number[] = [];
  for (const u of [(adx - sq) / (2 * A), (adx + sq) / (2 * A)]) {
    const a = Math.atan(u); // elevación sobre la horizontal
    const vyEnd = v * Math.sin(a) - (GRAVITY * adx) / (v * Math.cos(a)); // velocidad vertical (hacia arriba) al llegar
    if (vyEnd > -15) continue;
    out.push(Math.atan2(-Math.sin(a), Math.sign(dx) * Math.cos(a)));
  }
  return out;
}

/**
 * ¿La parábola del golpe llega a su punto de destino sin tocar terreno? (comprobación barata, antes de simular).
 * Se recorre cada 1/60 s con 4 puntos del contorno de la bola.
 */
export function pathClear(grid: string[][], from: Rest, angle: number, v: number, toX: number): boolean {
  const vx = Math.cos(angle) * v;
  const vy = Math.sin(angle) * v;
  const solid = (x: number, y: number) => {
    const ch = grid[Math.floor(y / T)]?.[Math.floor(x / T)];
    return ch !== undefined && ch in FULL_MAT;
  };
  const r = BALL_R - 1;
  for (let t = 1 / 60; t < 4; t += 1 / 60) {
    const x = from.x + vx * t;
    const y = from.y + vy * t + 0.5 * GRAVITY * t * t;
    // al llegar al destino en horizontal ya no hace falta mirar más (el aterrizaje lo juzga la simulación)
    if ((vx > 0 && x >= toX) || (vx < 0 && x <= toX)) return true;
    if (solid(x - r, y) || solid(x + r, y) || solid(x, y - r) || solid(x, y + r)) return false;
  }
  return true;
}

/**
 * Busca un golpe que lleve la bola a la siguiente isla (o al hoyo). Es un generador: cada `yield` es una simulación
 * hecha, para repartir el trabajo entre fotogramas. Devuelve null si no encuentra nada.
 */
export function* planShot(sim: DemoSim, stops: Stop[], rest: Rest, rand: () => number): Generator<void, Shot | null, void> {
  const lastIdx = stops.length - 1;
  const idx = stopIndex(stops, rest);
  const aimAtCup = idx >= lastIdx - 1; // en la penúltima isla o en la última se apunta directo al hoyo
  const target = aimAtCup ? stops[lastIdx] : stops[idx + 1];
  const here = Math.abs(sim.cup.x - rest.x);

  // punto al que se apunta: el hoyo, o un sitio de la isla (no siempre el centro, para que cada partida sea distinta)
  const aimPoint = () => (aimAtCup
    ? { x: sim.cup.x, y: sim.cup.y - BALL_R }
    : { x: target.x + (rand() - 0.5) * target.w * 0.5, y: target.y - BALL_R });

  // 3 = en el hoyo, 2 = parada en la isla objetivo, 1,5 = más cerca del hoyo en la última isla, 0 = no vale
  const score = (o: Outcome): number => {
    if (o.kind === 'sink') return 3;
    if (o.kind !== 'rest') return 0;
    if (idx === lastIdx) return onStop(o.rest, target) && Math.abs(sim.cup.x - o.rest.x) < here - 3 ? 1.5 : 0;
    return onStop(o.rest, target) ? 2 : 0;
  };

  const good: { shot: Shot; s: number }[] = [];
  let tried = 0;
  // potencias al azar (la ventana de un buen golpe puede ser muy estrecha): solo se simulan los que no chocan con el terreno
  for (let i = 0; i < 120; i++) {
    const power = 0.4 + rand() * 0.6;
    const v = power * MAX_SPEED * MATERIALS[rest.mat].power;
    const p = aimPoint();
    for (const angle of arcAngles(p.x - rest.x, rest.y - p.y, v)) {
      if (!pathClear(sim.L.grid, rest, angle, v, p.x)) continue;
      const o = sim.shoot(rest, angle, power);
      tried++;
      yield;
      const s = score(o);
      if (s > 0) good.push({ shot: { angle, power }, s });
    }
    if (good.some((g) => g.s === 3) || good.length >= 3 || tried >= 30) break;
  }
  if (good.length) {
    const best = Math.max(...good.map((g) => g.s));
    const pool = good.filter((g) => g.s === best);
    return pool[Math.floor(rand() * pool.length)].shot;
  }

  // plan B: rejilla gruesa y nos quedamos con lo que más acerque a la bola al hoyo
  let bestShot: Shot | null = null;
  let bestScore = -Infinity;
  for (let a = -168; a <= -12; a += 12) {
    for (const power of [0.55, 0.7, 0.85, 1]) {
      const angle = (a * Math.PI) / 180;
      const o = sim.shoot(rest, angle, power);
      yield;
      let s = -1e6;
      if (o.kind === 'sink') s = 1e6;
      else if (o.kind === 'rest') s = -Math.hypot(sim.cup.x - o.rest.x, (sim.cup.y - o.rest.y) * 1.5);
      if (s > bestScore) {
        bestScore = s;
        bestShot = { angle, power };
      }
    }
  }
  return bestShot;
}

type PilotState = 'wait' | 'plan' | 'aim';

/** Controla a la bola de GameScene en modo demo: espera, planifica, apunta, golpea */
export class DemoPilot {
  private state: PilotState = 'wait';
  private t = 0;
  private plan: Generator<void, Shot | null, void> | null = null;
  private shot: Shot | null = null;
  private dir = { x: 0, y: -1 };
  private len = 0;
  private aimDur = 900;
  /** ms que lleva la partida y golpes dados (si se alarga demasiado, se cambia de hoyo) */
  elapsed = 0;
  shots = 0;

  private scene: GameScene;
  private sim: DemoSim;
  private stops: Stop[];

  constructor(scene: GameScene, sim: DemoSim, stops: Stop[]) {
    this.scene = scene;
    this.sim = sim;
    this.stops = stops;
  }

  update(delta: number) {
    const s = this.scene;
    this.elapsed += delta;
    // seguridad: si un hoyo se atasca (muchos golpes o demasiado rato), se cambia de hoyo
    if (this.elapsed > 120000 || this.shots > 18) {
      s.demoNext();
      return;
    }
    const free = s.state === 'play' && s.ready && !s.aiming && !s.respawning && !s.frozen;

    if (this.state === 'wait') {
      if (!free) {
        this.t = Math.min(this.t, 0);
        return;
      }
      this.t += delta;
      if (this.t > 650) {
        const { x, y } = s.ball.position;
        const rest: Rest = { x, y, mat: s.currentMat() };
        this.plan = planShot(this.sim, this.stops, rest, Math.random);
        this.state = 'plan';
      }
      return;
    }

    if (this.state === 'plan') {
      if (!free) {
        this.state = 'wait';
        this.t = 0;
        return;
      }
      const t0 = performance.now();
      while (this.plan && performance.now() - t0 < 5) {
        const r = this.plan.next();
        if (r.done) {
          this.plan = null;
          // sin plan: un golpe suave hacia arriba, para no quedarse parado (se volverá a planificar)
          this.shot = r.value ?? { angle: -Math.PI / 2 + (Math.random() - 0.5), power: 0.6 };
          this.startAim(this.shot);
          break;
        }
      }
      return;
    }

    // 'aim': la flecha crece como si arrastrase un jugador y se suelta
    this.t += delta;
    const u = Math.min(1, this.t / this.aimDur);
    const e = 1 - Math.pow(1 - u, 2.2);
    s.aimVec.set(this.dir.x * this.len * e, this.dir.y * this.len * e);
    if (this.t >= this.aimDur + 200) {
      const v = s.aimVec.clone();
      s.aiming = false;
      s.aimGfx.clear();
      this.state = 'wait';
      this.t = 0; // (mientras vuela no está "libre": no planifica hasta que se pare)
      this.shots++;
      s.shoot(v);
    }
  }

  private startAim(shot: Shot) {
    const s = this.scene;
    this.dir = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
    this.len = MAX_DRAG * Math.pow(shot.power, 1 / SHOT_POWER_EXPONENT);
    this.aimDur = 650 + shot.power * 700;
    this.t = 0;
    s.resumeFollow();
    s.kbAiming = false;
    s.aiming = true;
    s.chargeStep = 0;
    s.aimVec.set(0, 0);
    this.state = 'aim';
  }
}
