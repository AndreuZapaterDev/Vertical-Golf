import { TILE as T, GRAVITY, MAX_SPEED, BALL_R, STEP, MATERIALS, type MaterialKey } from '../constants';
import { terrainRects, terrainRamps, thinSolidFor } from '../data/terrainShapes';
import type { ParsedLevel } from '../data/levels';

/**
 * Simulador de golpes sin pantalla para la IA de la partida de fondo del menú.
 * Misma física que GameScene.tick() (copia reducida de tools/mapcheck/sim.ts, sin plataformas móviles, sierras ni mareas:
 * los hoyos de la demo solo llevan terreno, charcas y paredes). Si cambias la física de GameScene, cambia también esto.
 *
 * No importa Phaser: recibe la librería Matter por parámetro (en el juego, la de Phaser; en Node, la de node_modules).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MBody = any;

/** Lo que usamos de Matter (el mismo objeto que expone Phaser.Physics.Matter.Matter) */
export interface MatterLib {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Engine: any; Events: any; Bodies: any; Body: any; Composite: any; Pairs: any;
}

/** Dónde está parada la bola antes de golpear */
export interface Rest {
  x: number;
  y: number;
  mat: MaterialKey;
}

export type Outcome =
  | { kind: 'rest'; rest: Rest; t: number }
  | { kind: 'sink'; t: number }
  | { kind: 'water' | 'ob' | 'timeout'; t: number; x: number; y: number };

/** Un golpe que no acaba en este tiempo (ms) se da por atascado */
const MAX_TIME = 9000;

export class DemoSim {
  L: ParsedLevel;
  engine: MBody;
  ball: MBody;
  cup: { x: number; y: number };
  worldW: number;
  worldH: number;
  private M: MatterLib;
  private thins: MBody[] = [];
  private simTime = 0;
  private groundTime = -1000;
  private wallTime = -1000;
  private groundBody: MBody | null = null;
  private groundNormal = { x: 0, y: 1 };
  private grounded = false;
  private relSpeed = 0;

  constructor(L: ParsedLevel, M: MatterLib) {
    this.L = L;
    this.M = M;
    const { Engine, Events, Bodies, Composite } = M;
    this.worldW = L.cols * T;
    this.worldH = L.rows * T;
    this.engine = Engine.create({ gravity: { x: 0, y: GRAVITY / 1000 }, positionIterations: 8, velocityIterations: 6 });
    const world = this.engine.world;
    const add = (b: MBody) => Composite.add(world, b);

    const staticBody = (x: number, y: number, w: number, h: number, mat: MaterialKey) => {
      const m = MATERIALS[mat];
      const b = Bodies.rectangle(x + w / 2, y + h / 2, w, h, { isStatic: true, friction: m.friction, frictionStatic: 0.5, restitution: m.restitution, label: mat });
      b.mat = mat;
      add(b);
      return b;
    };

    // límites del mundo como en GameScene.create: techo alto y paredes a los lados
    const th = 64;
    const bx = 0, by = -300, bw = this.worldW, bh = this.worldH + 300;
    const wall = (x: number, y: number, w: number, h: number) => {
      const b = Bodies.rectangle(x, y, w, h, { isStatic: true, friction: MATERIALS.bounds.friction, restitution: MATERIALS.bounds.restitution, label: 'bounds' });
      b.mat = 'bounds';
      add(b);
    };
    wall(bx - th / 2, by + bh / 2, th, bh + th * 2);
    wall(bx + bw + th / 2, by + bh / 2, th, bh + th * 2);
    wall(bx + bw / 2, by - th / 2, bw + th * 2, th);

    for (const q of terrainRects(L.grid)) {
      const b = staticBody(q.x, q.y, q.w, q.h, q.mat);
      if (q.thin) this.thins.push(b);
    }
    for (const { verts: v, mat } of terrainRamps(L.grid)) {
      const m = MATERIALS[mat];
      const b = Bodies.fromVertices((v[0].x + v[1].x + v[2].x) / 3, (v[0].y + v[1].y + v[2].y) / 3, [v], {
        isStatic: true, friction: m.friction, frictionStatic: 0.5, restitution: m.restitution, label: mat,
      });
      b.mat = mat;
      add(b);
    }
    this.cup = { x: L.hole.c * T + T / 2, y: (L.hole.r + 1) * T };

    this.ball = Bodies.circle(0, 0, BALL_R, { label: 'ball', restitution: 0, friction: 0.4, frictionStatic: 0.3, frictionAir: 0, density: 0.004 });
    add(this.ball);

    const onCollide = (e: MBody) => {
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
        if (ny > 0.45) {
          this.groundTime = this.simTime;
          this.groundBody = other;
          this.groundNormal = { x: nx, y: ny };
        } else this.wallTime = this.simTime;
      }
    };
    Events.on(this.engine, 'collisionStart', onCollide);
    Events.on(this.engine, 'collisionActive', onCollide);
  }

  private getVel() {
    const v = this.M.Body.getVelocity(this.ball);
    return { x: v.x * 60, y: v.y * 60 };
  }
  private setVel(x: number, y: number) {
    this.M.Body.setVelocity(this.ball, { x: x / 60, y: y / 60 });
  }

  /** Un paso fijo: copia de GameScene.tick() */
  private tick(ms: number) {
    const { Body, Engine } = this.M;
    const dt = ms / 1000;
    this.simTime += ms;
    for (const b of this.thins) b.collisionFilter.mask = thinSolidFor(this.ball.position.y, BALL_R, b.bounds.min.y) ? 0xffffffff : 0;
    Engine.update(this.engine, ms);

    this.grounded = this.simTime - this.groundTime < 30;
    // en el aire la bola no conserva giro, salvo contra una pared (si no, la fricción de Matter la deja colgada)
    if (!this.grounded && this.simTime - this.wallTime >= 30) Body.setAngularVelocity(this.ball, 0);
    const v = this.getVel();
    this.relSpeed = Math.hypot(v.x, v.y);
    let { x: vx, y: vy } = v;
    const gb = this.groundBody;
    if (this.grounded && gb) {
      const m = MATERIALS[(gb.mat ?? 'grass') as MaterialKey];
      const k = Math.exp(-m.damp * dt);
      const { x: nx, y: ny } = this.groundNormal;
      const normalSpeed = vx * nx + vy * ny;
      const tangentSpeed = (vx * ny - vy * nx) * k;
      vx = normalSpeed * nx + tangentSpeed * ny;
      vy = normalSpeed * ny - tangentSpeed * nx;
      if (this.groundNormal.y > 0.97 && this.relSpeed < 5) {
        vx = 0;
        vy = 0;
      }
    }
    this.setVel(vx, vy);
  }

  private cellAt(x: number, y: number) {
    return this.L.grid[Math.floor(y / T)]?.[Math.floor(x / T)];
  }

  /**
   * Golpea desde `from` con ángulo `angle` (radianes, −π/2 = arriba) y potencia `power` (0–1, ya con la curva del juego).
   * Devuelve cómo acaba: en el hoyo, parada en algún sitio, al agua, fuera de límites o atascada.
   */
  shoot(from: Rest, angle: number, power: number): Outcome {
    const { Body, Pairs } = this.M;
    // cada golpe empieza limpio (sin pares de colisión del anterior): resultados reproducibles
    Pairs.clear(this.engine.pairs);
    Body.setAngle(this.ball, 0);
    this.ball.positionImpulse = { x: 0, y: 0 };
    this.ball.constraintImpulse = { x: 0, y: 0, angle: 0 };
    this.ball.totalContacts = 0;
    Body.setPosition(this.ball, { x: from.x, y: from.y }, false);
    Body.setVelocity(this.ball, { x: 0, y: 0 });
    Body.setAngularVelocity(this.ball, 0);
    this.ball.force.x = this.ball.force.y = 0;

    const sp = power * MAX_SPEED * MATERIALS[from.mat].power;
    this.simTime = 0;
    this.groundTime = -1000;
    this.wallTime = -1000;
    this.grounded = false;
    this.groundBody = null;
    this.setVel(Math.cos(angle) * sp, Math.sin(angle) * sp);

    let restTime = 0;
    let stillTime = 0;
    const magnet = 18;
    while (this.simTime < MAX_TIME) {
      this.tick(STEP);
      const { x: cx, y: cy } = this.ball.position;
      const t = this.simTime;

      const dxCup = this.cup.x - cx;
      const dyCup = cy - (this.cup.y - BALL_R);
      if (this.grounded && Math.abs(dyCup) < 2 && Math.abs(dxCup) < magnet && Math.abs(dxCup) > 0.5) {
        this.setVel(Math.max(-60, Math.min(60, dxCup * 6)), this.getVel().y);
      }
      if (Math.abs(dxCup) < 5 && dyCup > -6 && dyCup < 3 && this.getVel().y > -40) return { kind: 'sink', t };
      if (this.cellAt(cx, cy + 2) === 'W') return { kind: 'water', t, x: cx, y: cy };
      if (cy > this.worldH + T) return { kind: 'ob', t, x: cx, y: cy };

      if (this.grounded && this.relSpeed < 6 && this.groundNormal.y > 0.97) restTime += STEP;
      else restTime = 0;
      if (this.relSpeed < 6) stillTime += STEP;
      else stillTime = 0;
      if (restTime > 150 || stillTime > 900) {
        const mat = ((this.groundBody?.mat as MaterialKey) ?? 'grass') as MaterialKey;
        return { kind: 'rest', rest: { x: cx, y: cy, mat }, t };
      }
    }
    const { x, y } = this.ball.position;
    return { kind: 'timeout', t: this.simTime, x, y };
  }
}
