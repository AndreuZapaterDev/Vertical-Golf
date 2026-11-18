/**
 * Simulador de golpes sin pantalla, con el MISMO motor (Matter 0.20 que trae Phaser) y las mismas
 * reglas que GameScene: rozamiento propio por material, viento, setas, bumpers, plataformas móviles,
 * bloques frágiles, agua, sierras, fuera de límites, imán del hoyo y detección de "bola parada".
 *
 * Si cambias la física de GameScene.tick()/update(), cambia también este archivo.
 */
import { createRequire } from 'node:module';
import { TILE as T, GRAVITY, MAX_SPEED, BALL_R, STEP, MATERIALS, type MaterialKey } from '../../src/constants';
import { terrainRects, terrainRamps, thinSolidFor } from '../../src/data/terrainShapes';
import { windAt, type ParsedLevel } from '../../src/data/levels';

const require = createRequire(import.meta.url);
// Phaser no exporta sus fuentes en "exports": se cargan por ruta (es el mismo Matter que usa el juego)
const LIB = new URL('../../node_modules/phaser/src/physics/matter-js/lib/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const Engine = require(LIB + 'core/Engine.js');
const Events = require(LIB + 'core/Events.js');
const Bodies = require(LIB + 'factory/Bodies.js');
const Body = require(LIB + 'body/Body.js');
const Composite = require(LIB + 'body/Composite.js');
const Pairs = require(LIB + 'collision/Pairs.js');

type MBody = any; // cuerpo de Matter (sin tipos en Node)

/** Mejoras con las que se valida: las de una cuenta nueva (sin compras) */
export interface Stats {
  power: number;
  grip: number;
  magnet: number;
}
export const BASE_STATS: Stats = { power: 1, grip: 1, magnet: 18 };

/** Dónde está parada la bola antes de golpear */
export interface Rest {
  x: number;
  y: number;
  mat: MaterialKey;
  /** índice de la plataforma móvil sobre la que está (y su desplazamiento respecto a ella) */
  mover?: number;
  dx?: number;
}

export type Outcome =
  | { kind: 'rest'; rest: Rest; t: number }
  | { kind: 'sink'; t: number }
  | { kind: 'water' | 'ob' | 'saw' | 'timeout'; t: number; x: number; y: number };

interface Mover { body: MBody; baseX: number; x: number; y: number; w: number; h: number; range: number; omega: number; phase: number; vx: number }
interface Crumble { body: MBody; x: number; y: number; w: number; state: 'idle' | 'shaking' | 'fallen'; at: number }
interface SawDef { x: number; y: number; range: number }

const MAX_TIME = 14000; // ms: un golpe que no acaba en este tiempo se da por atascado
const ease = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2; // Sine.easeInOut

export class LevelSim {
  L: ParsedLevel;
  stats: Stats;
  engine: MBody;
  ball: MBody;
  movers: Mover[] = [];
  crumbles: Crumble[] = [];
  thins: MBody[] = [];
  saws: SawDef[];
  cup: { x: number; y: number };
  worldW: number;
  worldH: number;
  // estado del golpe en curso (igual que en GameScene)
  simTime = 0;
  groundTime = -1000;
  groundBody: MBody | null = null;
  groundNormal = { x: 0, y: 1 };
  grounded = false;
  relSpeed = 0;
  bumpVel: { x: number; y: number } | null = null;
  sawClock = 0;

  constructor(L: ParsedLevel, stats: Stats = BASE_STATS) {
    this.L = L;
    this.stats = stats;
    this.worldW = L.cols * T;
    this.worldH = L.rows * T;
    this.engine = Engine.create({ gravity: { x: 0, y: GRAVITY / 1000 }, positionIterations: 8, velocityIterations: 6 });
    const world = this.engine.world;
    const add = (b: MBody) => Composite.add(world, b);

    const staticBody = (x: number, y: number, w: number, h: number, mat: MaterialKey) => {
      const M = MATERIALS[mat];
      const b = Bodies.rectangle(x + w / 2, y + h / 2, w, h, { isStatic: true, friction: M.friction, frictionStatic: 0.5, restitution: M.restitution, label: mat });
      b.mat = mat;
      add(b);
      return b;
    };

    // límites del mundo como en GameScene.create (techo alto; paredes solo en hoyos cerrados)
    const th = 64;
    const bx = 0, by = -300, bw = this.worldW, bh = this.worldH + 300;
    const wall = (x: number, y: number, w: number, h: number) => {
      const b = Bodies.rectangle(x, y, w, h, { isStatic: true, friction: MATERIALS.bounds.friction, restitution: MATERIALS.bounds.restitution, label: 'bounds' });
      b.mat = 'bounds';
      add(b);
    };
    if (!L.open) {
      wall(bx - th / 2, by + bh / 2, th, bh + th * 2);
      wall(bx + bw + th / 2, by + bh / 2, th, bh + th * 2);
    }
    wall(bx + bw / 2, by - th / 2, bw + th * 2, th);

    for (const q of terrainRects(L.grid)) {
      const b = staticBody(q.x, q.y, q.w, q.h, q.mat);
      if (q.thin) this.thins.push(b);
    }
    for (const { verts: v, mat } of terrainRamps(L.grid)) {
      const M = MATERIALS[mat];
      const b = Bodies.fromVertices((v[0].x + v[1].x + v[2].x) / 3, (v[0].y + v[1].y + v[2].y) / 3, [v], {
        isStatic: true, friction: M.friction, frictionStatic: 0.5, restitution: M.restitution, label: mat,
      });
      b.mat = mat;
      add(b);
    }

    // objetos (GameScene.buildObjects)
    this.movers = L.movers.map((m) => {
      const w = m.n * T, x = m.c * T, y = m.r * T;
      const body = staticBody(x, y, w, 9, 'wood');
      const mv: Mover = { body, baseX: x, x, y, w, h: 9, range: 24, omega: (Math.PI * 2) / 3.2, phase: 0, vx: 0 };
      body.mover = mv;
      return mv;
    });
    this.crumbles = L.crumbles.map((cr) => {
      const w = cr.n * T, x = cr.c * T, y = cr.r * T;
      const body = staticBody(x, y, w, T, 'crumble');
      const c: Crumble = { body, x, y, w, state: 'idle', at: 0 };
      body.crumble = c;
      return c;
    });
    for (const m of L.mushrooms) staticBody(m.c * T, (m.r + 1) * T - 6, T, 6, 'mushroom');
    for (const b of L.bumpers) {
      const body = Bodies.circle(b.c * T + T / 2, b.r * T + T / 2, 7.5, { isStatic: true, restitution: 0.9, friction: 0, label: 'bumper' });
      body.mat = 'bounds';
      add(body);
    }
    this.saws = L.saws.map((s) => ({ x: s.c * T + T / 2, y: s.r * T + T / 2, range: s.range }));
    this.cup = { x: L.hole.c * T + T / 2, y: (L.hole.r + 1) * T };

    this.ball = Bodies.circle(0, 0, BALL_R, { label: 'ball', restitution: 0, friction: 0.4, frictionStatic: 0.3, frictionAir: 0, density: 0.004 });
    add(this.ball);

    const onCollide = (e: MBody, start: boolean) => {
      for (const pair of e.pairs) {
        let other: MBody;
        if (pair.bodyA === this.ball) other = pair.bodyB;
        else if (pair.bodyB === this.ball) other = pair.bodyA;
        else continue;
        other = other.parent || other;
        if (pair.isSensor || other.isSensor) continue;
        let nx = pair.collision.normal.x;
        let ny = pair.collision.normal.y;
        if (nx * (other.position.x - this.ball.position.x) + ny * (other.position.y - this.ball.position.y) < 0) {
          nx = -nx;
          ny = -ny;
        }
        if (other.label === 'bumper') {
          if (start) {
            const p = this.ball.position;
            const dx = p.x - other.position.x, dy = p.y - other.position.y;
            const d = Math.hypot(dx, dy) || 1;
            this.bumpVel = { x: (dx / d) * 280, y: (dy / d) * 280 };
          }
          continue;
        }
        if (ny > 0.45) {
          this.groundTime = this.simTime;
          this.groundBody = other;
          this.groundNormal = { x: nx, y: ny };
        }
      }
    };
    Events.on(this.engine, 'collisionStart', (e: MBody) => onCollide(e, true));
    Events.on(this.engine, 'collisionActive', (e: MBody) => onCollide(e, false));
  }

  getVel() {
    const v = Body.getVelocity(this.ball);
    return { x: v.x * 60, y: v.y * 60 };
  }
  setVel(x: number, y: number) {
    Body.setVelocity(this.ball, { x: x / 60, y: y / 60 });
  }
  carrierVelocity() {
    return this.grounded && this.groundBody?.mover ? this.groundBody.mover.vx : 0;
  }
  cellAt(x: number, y: number) {
    return this.L.grid[Math.floor(y / T)]?.[Math.floor(x / T)];
  }

  placeMovers(t: number) {
    for (const m of this.movers) {
      const nx = m.baseX + Math.sin(t * m.omega + m.phase) * m.range;
      m.vx = 0;
      m.x = nx;
      Body.setPosition(m.body, { x: nx + m.w / 2, y: m.y + m.h / 2 }, false);
      Body.setVelocity(m.body, { x: 0, y: 0 });
    }
  }

  /** Un paso fijo: copia de GameScene.tick() */
  tick(ms: number, moverT: number) {
    const dt = ms / 1000;
    this.simTime += ms;
    for (const m of this.movers) {
      const nx = m.baseX + Math.sin(moverT * m.omega + m.phase) * m.range;
      m.vx = (nx - m.x) / dt;
      m.x = nx;
      Body.setPosition(m.body, { x: nx + m.w / 2, y: m.y + m.h / 2 }, true);
    }
    for (const b of this.thins) b.collisionFilter.mask = thinSolidFor(this.ball.position.y, BALL_R, b.bounds.min.y) ? 0xffffffff : 0;
    Engine.update(this.engine, ms);

    this.grounded = this.simTime - this.groundTime < 30;
    // igual que en GameScene: en el aire la bola no conserva giro (evita empujes hacia atrás al aterrizar)
    if (!this.grounded) Body.setAngularVelocity(this.ball, 0);
    const v = this.getVel();
    const carrierVx = this.carrierVelocity();
    this.relSpeed = Math.hypot(v.x - carrierVx, v.y);
    if (this.bumpVel) {
      this.setVel(this.bumpVel.x, this.bumpVel.y);
      this.bumpVel = null;
      this.groundTime = -1000;
      return;
    }
    let { x: vx, y: vy } = v;
    const gb = this.groundBody;
    if (this.grounded && gb) {
      const M = MATERIALS[(gb.mat ?? 'grass') as MaterialKey];
      const k = Math.exp(-M.damp * this.stats.grip * dt);
      const { x: nx, y: ny } = this.groundNormal;
      const relativeVx = vx - carrierVx;
      const normalSpeed = relativeVx * nx + vy * ny;
      const tangentSpeed = (relativeVx * ny - vy * nx) * k;
      vx = carrierVx + normalSpeed * nx + tangentSpeed * ny;
      vy = normalSpeed * ny - tangentSpeed * nx;
      if (this.groundNormal.y > 0.97 && this.relSpeed < 5) {
        vx = carrierVx;
        vy = 0;
      }
      const cr: Crumble | undefined = gb.crumble;
      if (cr && cr.state === 'idle') {
        cr.state = 'shaking';
        cr.at = this.simTime + 1100;
      }
    } else {
      vx += windAt(this.L, this.ball.position.y) * dt;
    }
    this.setVel(vx, vy);

    for (const cr of this.crumbles) {
      if (cr.state === 'shaking' && this.simTime >= cr.at) {
        cr.state = 'fallen';
        cr.at = this.simTime + 3200;
        cr.body.collisionFilter.mask = 0;
      } else if (cr.state === 'fallen' && this.simTime >= cr.at) {
        const p = this.ball.position, r = BALL_R + 1;
        if (p.x > cr.x - r && p.x < cr.x + cr.w + r && p.y > cr.y - r && p.y < cr.y + T + r) cr.at += 300;
        else {
          cr.body.collisionFilter.mask = 0xffffffff;
          cr.state = 'idle';
        }
      }
    }
  }

  sawPos(s: SawDef, ms: number) {
    if (!s.range) return s.x;
    const p = (ms % 3600) / 1800;
    return s.x - s.range + 2 * s.range * ease(p > 1 ? 2 - p : p);
  }

  /**
   * Golpea desde `from` con ángulo `angle` (radianes, −π/2 = arriba) y potencia `speed` (0–1 de la velocidad máxima).
   * `phase` desfasa las plataformas móviles y las sierras (en ms) para probar distintos momentos.
   */
  shoot(from: Rest, angle: number, speed: number, phase = 0): Outcome {
    const moverT0 = phase / 1000;
    this.placeMovers(moverT0);
    for (const cr of this.crumbles) {
      cr.state = 'idle';
      cr.body.collisionFilter.mask = 0xffffffff;
    }
    // cada golpe empieza limpio (sin pares de colisión del golpe anterior): resultados reproducibles
    Pairs.clear(this.engine.pairs);
    Body.setAngle(this.ball, 0);
    this.ball.positionImpulse = { x: 0, y: 0 };
    this.ball.constraintImpulse = { x: 0, y: 0, angle: 0 };
    this.ball.totalContacts = 0;
    let x = from.x;
    if (from.mover !== undefined) x = this.movers[from.mover].x + (from.dx ?? 0);
    Body.setPosition(this.ball, { x, y: from.y }, false);
    Body.setVelocity(this.ball, { x: 0, y: 0 });
    Body.setAngularVelocity(this.ball, 0);
    this.ball.force.x = this.ball.force.y = 0;

    // velocidad de la plataforma en este instante (para el "carrier")
    let carrier = 0;
    if (from.mover !== undefined) {
      const m = this.movers[from.mover];
      carrier = Math.cos(moverT0 * m.omega + m.phase) * m.omega * m.range;
    }
    // el golpe sale desde el suelo donde estaba parada: igual que GameScene.shoot
    const sp = speed * MAX_SPEED * this.stats.power * MATERIALS[from.mat].power;
    this.simTime = 0;
    this.groundTime = -1000;
    this.grounded = false;
    this.groundBody = null;
    this.bumpVel = null;
    this.setVel(Math.cos(angle) * sp + carrier, Math.sin(angle) * sp);
    // si sale desde un bloque frágil, ese bloque ya tiembla
    const under = this.crumbles.find((c) => x > c.x - BALL_R && x < c.x + c.w + BALL_R && Math.abs(from.y + BALL_R - c.y) < 3);
    if (under) {
      under.state = 'shaking';
      under.at = 600;
    }

    let restTime = 0;
    let stillTime = 0;
    const m = this.stats.magnet;
    while (this.simTime < MAX_TIME) {
      this.tick(STEP, moverT0 + this.simTime / 1000 + STEP / 1000);
      const p = this.ball.position;
      const cx = p.x, cy = p.y;
      const t = this.simTime;

      const dxCup = this.cup.x - cx;
      const dyCup = cy - (this.cup.y - BALL_R);
      if (this.grounded && Math.abs(dyCup) < 2 && Math.abs(dxCup) < m && Math.abs(dxCup) > 0.5) {
        this.setVel(Math.max(-60, Math.min(60, dxCup * 6)), this.getVel().y);
      }
      if (Math.abs(dxCup) < 5 && dyCup > -6 && dyCup < 3 && this.getVel().y > -40) return { kind: 'sink', t };
      if (this.cellAt(cx, cy + 2) === 'W') return { kind: 'water', t, x: cx, y: cy };
      if (this.L.open && (cy > this.worldH + T || cx < -2 * T || cx > this.worldW + 2 * T)) return { kind: 'ob', t, x: cx, y: cy };
      if (!this.L.open && cy > this.worldH + T) return { kind: 'ob', t, x: cx, y: cy };
      for (const s of this.saws) {
        if (Math.hypot(cx - this.sawPos(s, phase + t), cy - s.y) < 12) return { kind: 'saw', t, x: cx, y: cy };
      }

      if (this.grounded && this.relSpeed < 6 && this.groundNormal.y > 0.97) restTime += STEP;
      else restTime = 0;
      if (this.relSpeed < 6) stillTime += STEP;
      else stillTime = 0;
      if (restTime > 150 || stillTime > 900) {
        const gb = this.groundBody;
        const mat: MaterialKey = (gb?.mat as MaterialKey) ?? 'grass';
        const rest: Rest = { x: cx, y: cy, mat };
        if (gb?.mover) {
          rest.mover = this.movers.indexOf(gb.mover);
          rest.dx = cx - gb.mover.x;
        }
        return { kind: 'rest', rest, t };
      }
    }
    const p = this.ball.position;
    return { kind: 'timeout', t: this.simTime, x: p.x, y: p.y };
  }
}

export const restOfStart = (L: ParsedLevel): Rest => ({
  x: L.start.c * T + T / 2,
  y: (L.start.r + 1) * T - BALL_R,
  mat: (L.grid[L.start.r + 1]?.[L.start.c] === 's' ? 'sand' : L.grid[L.start.r + 1]?.[L.start.c] === 'r' ? 'rough' : 'grass') as MaterialKey,
});
