import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import {
  W, H, VIEW, TILE, GRAVITY, MAX_SPEED, MAX_DRAG, FOLLOW_OFFSET, BALL_R, STEP, MATERIALS, THEMES, PAL, hex, FONT, FONT_SCALE,
  type MaterialKey, type Theme, type ThemeKey,
} from '../constants';
import { LEVELS, parseLevel, type ParsedLevel, type MechanicKey } from '../data/levels';
import { renderTerrain, renderBlock, cellSolid } from '../gfx/terrain';
import { terrainRects, terrainRamps, thinSolidFor } from '../data/terrainShapes';
import { tintFill } from '../gfx/tint';
import { bakeTexture, rgba } from '../gfx/bake';
import { sfx, music, haptic } from '../systems/audio';
import { progress, type CoinLine } from '../systems/progress';
import { SKINS, type Skin } from '../data/upgrades';
import { trailById, ballTypeById, type Trail, type BallType } from '../data/cosmetics';
import { saveScore } from '../services/supabase';

// ---------------------------------------------------------------- Tipos

type Vec = { x: number; y: number };

/** Cuerpo de Matter (el tipo exacto lo da la propia fábrica de Phaser) */
type MatterBody = ReturnType<Phaser.Physics.Matter.Factory['rectangle']>;

/** Cuerpo de Matter con los datos de juego que le colgamos */
type GameBody = MatterBody & {
  mat?: MaterialKey;
  mover?: Mover;
  crumble?: Crumble;
  sprite?: Phaser.GameObjects.Image;
};

interface Mover {
  body: GameBody;
  sprite: Phaser.GameObjects.Image;
  baseX: number;
  x: number;
  y: number;
  w: number;
  h: number;
  range: number;
  omega: number;
  phase: number;
  t: number;
  /** velocidad horizontal actual (px/s): la bola encima la hereda */
  vx: number;
}

interface Crumble {
  body: GameBody;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  w: number;
  state: 'idle' | 'shaking' | 'fallen';
}

/** Decoración que se agita cuando la bola aterriza cerca (matas, flores, arbustos) */
type Decor = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/**
 * Luz y "metralla" de cada superficie al recibir un golpe:
 * light = color del destello; bits = colores de los trocitos que saltan; n = cantidad relativa
 */
interface ImpactLook {
  light: number;
  bits: number[];
  n: number;
}


/** Objeto del cielo con parallax (ver buildSky) */
type SkyObject = (Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite) & { f: number; baseY: number; baseX: number; tile?: boolean };
type Cloud = Phaser.GameObjects.Image & { vx: number };

/** Lo mínimo que usamos de Matter.js (Phaser lo expone sin tipos fiables entre versiones) */
interface MatterLib {
  Body: {
    getVelocity(b: MatterBody): Vec;
    setVelocity(b: MatterBody, v: Vec): void;
    setPosition(b: MatterBody, p: Vec, updateVelocity?: boolean): void;
    setAngularVelocity(b: MatterBody, w: number): void;
  };
  Sleeping: { set(b: MatterBody, on: boolean): void };
}

interface CollisionPair {
  bodyA: GameBody;
  bodyB: GameBody;
  isSensor: boolean;
  collision: { normal: Vec };
}
interface CollisionEvent {
  pairs: CollisionPair[];
}

type PenaltyKind = 'water' | 'saw' | 'ob';
type GameState = 'intro' | 'play' | 'sinking' | 'done';

/** Datos del hoyo para el HUD (UIScene) */
export interface HudState {
  levelIndex: number;
  hole: number;
  holes: number;
  worldName: string;
  name: string;
  theme: ThemeKey;
  par: number;
  wind: number;
  heightM: number;
  intro?: MechanicKey;
  tutorial?: boolean;
  open: boolean;
  brakes: number;
  shields: number;
}

/** Resultado del hoyo para la ventana final */
export interface CompleteInfo {
  levelIndex: number;
  hole: number;
  world: string;
  worldName: string;
  worldJustCompleted: boolean;
  worldStars: number;
  worldStarsMax: number;
  name: string;
  strokes: number;
  par: number;
  stars: number;
  isBest: boolean;
  coins: number;
  coinLines: CoinLine[];
  /** fichas del gachapón ganadas */
  tokens: number;
  totalCoins: number;
  hasNext: boolean;
}

export interface ToastOpts {
  title: string;
  text: string;
  color?: string;
  duration?: number;
}

const { Body, Sleeping } = (Phaser.Physics.Matter as unknown as { Matter: MatterLib }).Matter;
const T = TILE;

const POWER_COLORS = [hex('#72d454'), hex('#ffd36b'), hex('#ff8a5c'), hex('#ef4d5e')];
const powerColor = (p: number) => POWER_COLORS[Math.min(3, Math.floor(p * 4))];
/** 12 puntos del contorno de la bola (para comprobar choques en la trayectoria sin recalcular senos y cosenos) */
const RING = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)]);
const SHOT_POWER_EXPONENT = 1.25;
const shotPower = (dragLength: number) => Math.pow(Phaser.Math.Clamp(dragLength / MAX_DRAG, 0, 1), SHOT_POWER_EXPONENT);

/**
 * Escena principal con física Matter (paso fijo de 120 Hz).
 * El nivel sale de un mapa de casillas (data/levels.js); el terreno se pinta como una sola textura.
 * Estados: intro → play → sinking → done
 */
export default class GameScene extends Phaser.Scene {
  // --- hoyo
  levelIndex = 0;
  L!: ParsedLevel;
  P!: Theme;
  worldW = 0;
  worldH = 0;
  state: GameState = 'intro';
  strokes = 0;

  // --- apuntado y golpe
  aiming = false;
  kbAiming = false;
  aimVec = new Phaser.Math.Vector2();
  aimStart = new Phaser.Math.Vector2();
  /** apuntado con teclado (se recuerda entre golpes) */
  kb = { angle: -Math.PI / 2, power: 0.55 };
  chargeStep = 0;
  ready = false;
  readyTime = 0;

  // --- física de la bola
  respawning = false;
  frozen = false;
  restTime = 0;
  simTime = 0;
  acc = 0;
  groundTime = -1000;
  groundBody: GameBody | null = null;
  groundNormal: Vec = { x: 0, y: 1 };
  grounded = false;
  relSpeed = 0;
  prevVel: Vec = { x: 0, y: 0 };
  bumpVel: Vec | null = null;
  rollDist = 0;
  trailPts: Vec[] = [];
  /** ms de congelación breve en impactos fuertes */
  hitStop = 0;
  /** cámara lenta cuando la bola vuela cerca del hoyo */
  timeScale = 1;
  /** ms que la bola lleva quieta (aunque sea en una rampa o encajada) */
  stillTime = 0;
  safe: { x: number; y: number; body: GameBody | null; dx?: number } = { x: 0, y: 0, body: null };

  // --- mejoras de la cuenta
  stats = { power: 1, aim: 0.3, grip: 1, magnet: 18 };
  brakes = 0;
  shields = 0;
  skin!: Skin;
  trail!: Trail;
  /** tipo de pelota equipado (física) */
  ballType!: BallType;
  /** radio de la bola y escala de su sprite (dependen del tipo) */
  ballR = BALL_R;
  ballScale = 1;
  /** tono principal del rastro (luz de la bola, fogonazo del golpe) */
  trailColor = 0xffffff;
  trailFx!: Phaser.GameObjects.Particles.ParticleEmitter;

  // --- objetos de la escena
  bus!: Phaser.Events.EventEmitter;
  bgTile!: Phaser.GameObjects.TileSprite;
  camOff: Vec = { x: 0, y: FOLLOW_OFFSET };
  sky: SkyObject[] = [];
  clouds: Cloud[] = [];
  ground: MatterBody | null = null;
  movers: Mover[] = [];
  crumbles: Crumble[] = [];
  /** plataformas finas '=' (se atraviesan desde abajo) */
  thins: GameBody[] = [];
  bumpers: GameBody[] = [];
  saws: Phaser.GameObjects.Sprite[] = [];
  cupPos: Vec = { x: 0, y: 0 };
  pole!: Phaser.GameObjects.Image;
  cupGlow!: Phaser.GameObjects.Image;
  flag!: Phaser.GameObjects.Sprite;
  flagNum!: Phaser.GameObjects.Text;
  startPos: Vec = { x: 0, y: 0 };
  ball!: MatterBody;
  ballSprite!: Phaser.GameObjects.Sprite;
  ballShadow!: Phaser.GameObjects.Image;
  trailG!: Phaser.GameObjects.Graphics;
  counter!: Phaser.GameObjects.Text;
  readyRing!: Phaser.GameObjects.Graphics;
  aimGfx!: Phaser.GameObjects.Graphics;
  /** flecha que señala el hoyo fuera de pantalla: punta (se gira) + chapa con la bandera */
  shadowAt = { x: -1e9, y: -1e9, on: false };
  holePtr: { wedge: Phaser.GameObjects.Image; badge: Phaser.GameObjects.Image } | null = null;
  dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  confetti!: Phaser.GameObjects.Particles.ParticleEmitter;
  hazardFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  splash!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** trocitos de superficie que saltan al botar (hierba, arena, astillas…) */
  debris!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** halo de luz que acompaña a la bola */
  ballLight!: Phaser.GameObjects.Image;
  decor: Decor[] = [];
  /** ms hasta el siguiente soplo de polvo al rodar */
  rollFxTimer = 0;
  impactLooks!: Record<MaterialKey, ImpactLook>;
  introTimer: Phaser.Time.TimerEvent | null = null;
  keys?: Record<'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | 'A' | 'D' | 'W' | 'S' | 'SHIFT', Phaser.Input.Keyboard.Key>;

  // --- manejadores (se guardan para poder quitarlos al salir)
  onCollStart!: (e: CollisionEvent) => void;
  onCollActive!: (e: CollisionEvent) => void;
  onDown!: (p: Phaser.Input.Pointer) => void;
  onMove!: (p: Phaser.Input.Pointer) => void;
  onUp!: (p: Phaser.Input.Pointer) => void;
  onMiddleDown!: (e: MouseEvent) => void;
  /** cámara libre (botón central): no sigue a la bola hasta apuntar o golpear */
  freeCam = false;
  /** arrastre en curso: posición inicial del puntero y del scroll de la cámara */
  pan: { x: number; y: number; scrollX: number; scrollY: number; touch: boolean } | null = null;
  onRestart!: () => void;
  onShootKey!: () => void;

  constructor() {
    super('Game');
  }

  init(data?: { levelIndex?: number }) {
    this.levelIndex = Phaser.Math.Clamp(data?.levelIndex ?? 0, 0, LEVELS.length - 1);
    this.L = parseLevel(this.levelIndex);
    this.P = THEMES[this.L.theme];
    this.worldH = this.L.rows * T;
    this.worldW = this.L.cols * T;
    this.state = 'intro';
    this.strokes = 0;
    this.aiming = false;
    this.aimVec = new Phaser.Math.Vector2();
    this.ready = false;
    this.respawning = false;
    this.frozen = false;
    this.restTime = 0;
    this.simTime = 0;
    this.acc = 0;
    this.groundTime = -1000;
    this.groundBody = null;
    this.groundNormal = { x: 0, y: 1 };
    this.grounded = false;
    this.relSpeed = 0;
    this.prevVel = { x: 0, y: 0 };
    this.rollDist = 0;
    this.trailPts = [];
    this.hitStop = 0; // ms de congelación breve en impactos fuertes
    this.timeScale = 1; // cámara lenta cuando la bola vuela cerca del hoyo
    this.stillTime = 0; // ms que la bola lleva quieta (aunque sea en una rampa o encajada)
    this.kbAiming = false;
    this.kb = { angle: -Math.PI / 2, power: 0.55 }; // apuntado con teclado (se recuerda entre golpes)
    this.chargeStep = 0;

    // Mejoras de la cuenta
    // Tipo de pelota: sus multiplicadores se suman a los de las mejoras
    this.ballType = ballTypeById(progress.ball);
    const bt = this.ballType;
    this.ballR = bt.radius ?? BALL_R;
    this.ballScale = this.ballR / BALL_R;
    this.stats = {
      power: progress.stat('power') * (bt.power ?? 1),
      aim: progress.stat('aim'),
      grip: progress.stat('grip') * (bt.grip ?? 1),
      magnet: progress.stat('magnet') * (bt.magnet ?? 1),
    };
    this.brakes = progress.stat('brake');
    this.shields = progress.stat('shield');
    this.skin = SKINS.find((s) => s.id === progress.skin) || SKINS[0];
    this.trail = trailById(progress.trail);
    this.trailColor = this.trail.colors[this.trail.colors.length - 1];
    this.bumpVel = null;
    this.holePtr = null;
    this.shadowAt = { x: -1e9, y: -1e9, on: false };
    this.introTimer = null;
    this.rollFxTimer = 0;
    this.freeCam = false;
    this.pan = null;
  }

  create() {
    const L = this.L;
    this.bus = new Phaser.Events.EventEmitter();

    // Hoyos cerrados: paredes a los lados. Abiertos: solo un techo alto; por los lados y abajo hay vacío.
    const walls = !L.open;
    this.matter.world.setBounds(0, -300, this.worldW, this.worldH + 300, 64, walls, walls, true, false);
    for (const w of Object.values(this.matter.world.walls)) {
      if (!w) continue;
      const wall = w as GameBody;
      wall.mat = 'bounds';
      wall.friction = MATERIALS.bounds.friction;
      wall.restitution = MATERIALS.bounds.restitution;
    }
    const cam = this.cameras.main;
    cam.setZoom(VIEW.Z);
    // En los hoyos abiertos la cámara deja ver un poco de vacío alrededor (se nota que son islas)
    const side = L.open ? 3 * T : 0;
    const bw = Math.max(this.worldW + side * 2, W);
    cam.setBounds((this.worldW - bw) / 2, 0, bw, this.worldH + (L.open ? 4 * T : 0));
    cam.setBackgroundColor(this.P.bgA);

    // Fondo de cuadros fijo a la pantalla que se desplaza más lento que el terreno (parallax).
    // Con zoom Z, un objeto con scrollFactor 0 en (W·(Z−1)/2, H·(Z−1)/2) cubre exactamente la vista.
    const z = VIEW.Z;
    this.bgTile = this.add
      .tileSprite((W * (z - 1)) / 2, (H * (z - 1)) / 2, W, H, `checker-${L.theme}`)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-10);
    this.camOff = { x: 0, y: FOLLOW_OFFSET };
    this.buildSky();
    music.play(L.theme);
    music.setPaused(false);
    const terrainKey = renderTerrain(this, 'terrain', L.grid, L.theme, { open: L.open });
    // sombra proyectada del terreno sobre el fondo (da profundidad)
    tintFill(this.add.image(3, 4, terrainKey), 0x1a1020).setOrigin(0).setAlpha(0.16).setDepth(-5);
    this.add.image(0, 0, terrainKey).setOrigin(0).setDepth(5);
    this.buildClouds();
    this.decorate();
    // lo que se agita cuando la bola cae cerca
    const sway = new Set(['tuft', 'flower0', 'flower1', 'flower2', 'bush', 'glowshroom']);
    this.decor = this.children.list.filter(
      (o): o is Decor => (o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.Sprite) && sway.has(o.texture.key),
    );

    this.buildPhysics();
    this.buildObjects();
    this.buildHole();
    this.createBall();
    this.createFx();
    this.aimGfx = this.add.graphics().setDepth(30);
    this.setupInput();

    this.onCollStart = (e) => this.onCollide(e, true);
    this.onCollActive = (e) => this.onCollide(e, false);
    this.matter.world.on('collisionstart', this.onCollStart);
    this.matter.world.on('collisionactive', this.onCollActive);

    this.scene.stop('UI');
    this.scene.launch('UI', { bus: this.bus, gameScene: this });

    this.events.once('shutdown', () => {
      this.bus.removeAllListeners();
      this.teardownInput();
      this.matter.world?.off('collisionstart', this.onCollStart);
      this.matter.world?.off('collisionactive', this.onCollActive);
      // el siguiente hoyo empieza con listas limpias (la escena se reutiliza)
      this.sky = [];
      this.clouds = [];
      this.movers = [];
      this.crumbles = [];
      this.thins = [];
      this.bumpers = [];
      this.saws = [];
      this.decor = [];
    });

    this.startIntro();
  }

  // ---------------------------------------------------------------- Construcción

  /**
   * Cielo con parallax: colinas lejanas al pie del nivel, sol/luna, estrellas y pájaros.
   * Cada objeto guarda baseY y su factor f (0 = pegado a la pantalla, 1 = se mueve con el mundo);
   * en update se coloca en y = baseY + vista.y · (1 − f).
   */
  buildSky() {
    const th = this.L.theme;
    const sky = this.P.sky;
    const span = Math.max(0, this.worldH - H); // recorrido vertical de la cámara
    this.sky = [];
    const add = (o: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite, screenY: number, f: number) => {
      const obj = o as SkyObject;
      // screenY: altura en pantalla cuando la cámara está abajo del todo (al empezar)
      obj.f = f;
      obj.baseY = screenY + span * f;
      obj.baseX = obj.x;
      this.sky.push(obj);
      return obj;
    };

    // colinas: al empezar, su base queda escondida tras el suelo.
    // Son tiras que se repiten en horizontal y acompañan a la cámara (los hoyos pueden ser más anchos que la pantalla).
    for (const [layer, y, f] of [[0, H - 18, 0.35], [1, H + 6, 0.55]]) {
      const hills = this.add.tileSprite(0, 0, W + 8, 80, `hills-${th}-${layer}`).setOrigin(0, 1).setDepth(-9.6 + layer * 0.2);
      add(hills, y, f).tile = true;
    }

    if (sky === 'night') {
      add(this.add.image(52, 0, 'moon').setDepth(-9.8), 150, 0.1);
      const glow = add(this.add.image(52, 0, 'glow').setTint(0x9fb4ff).setBlendMode('ADD').setScale(1.1).setAlpha(0.35).setDepth(-9.85), 150, 0.1);
      this.tweens.add({ targets: glow, alpha: 0.2, scale: 1.25, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      for (let i = 0; i < 46; i++) {
        const big = Math.random() < 0.25;
        const s = this.add.image(Phaser.Math.Between(-40, W + 40), 0, big ? 'star-px' : 'px').setDepth(-9.9).setAlpha(Phaser.Math.FloatBetween(0.3, 0.9));
        if (!big) s.setScale(0.5);
        add(s, Phaser.Math.Between(-span * 0.2, H - 60), 0.2);
        this.tweens.add({ targets: s, alpha: 0.1, duration: Phaser.Math.Between(700, 2200), yoyo: true, repeat: -1, delay: Math.random() * 2000 });
      }
    } else if (sky === 'sunset') {
      add(this.add.image(W * 0.32, 0, 'glow').setTint(0xff9a5c).setBlendMode('ADD').setScale(2.6).setAlpha(0.45).setDepth(-9.85), H - 120, 0.15);
      add(this.add.image(W * 0.32, 0, 'sun-big').setDepth(-9.8).setAlpha(0.95), H - 120, 0.15);
      this.sunRays(add, W * 0.32, H - 120, 0.15, 0xffb07a, [-35, -5, 25]);
    } else {
      add(this.add.image(W - 52, 0, 'glow').setTint(0xfff1b0).setBlendMode('ADD').setScale(1.4).setAlpha(0.5).setDepth(-9.85), 130, 0.1);
      add(this.add.image(W - 52, 0, 'sun').setDepth(-9.8), 130, 0.1);
      this.sunRays(add, W - 52, 130, 0.1, 0xfff1b0, [22, 42, 62]);
    }

    // bandadas de pájaros cruzando de vez en cuando (no de noche)
    if (sky !== 'night') {
      const flock = () => {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const view = this.cameras.main.worldView;
        const y0 = view.y + Phaser.Math.Between(40, Math.round(H * 0.45));
        const x0 = view.x;
        const n = Phaser.Math.Between(2, 4);
        for (let i = 0; i < n; i++) {
          const b = this.add
            .sprite(dir > 0 ? x0 - 12 - i * 10 : x0 + W + 12 + i * 10, y0 + (i % 2) * 6 + i * 2, 'bird', 0)
            .setTint(hex(this.P.outline))
            .setAlpha(0.55)
            .setDepth(-8.5)
            .play({ key: 'bird-flap', delay: i * 90 });
          this.tweens.add({
            targets: b,
            x: dir > 0 ? x0 + W + 40 : x0 - 40,
            y: b.y - Phaser.Math.Between(4, 16),
            duration: Phaser.Math.Between(9000, 13000),
            onComplete: () => b.destroy(),
          });
        }
      };
      this.time.delayedCall(Phaser.Math.Between(1500, 4000), flock);
      this.time.addEvent({ delay: 14000, loop: true, callback: flock });
    }
  }

  /** Rayos de luz suaves que salen del sol y se mecen despacio */
  sunRays(
    add: (o: Phaser.GameObjects.Image, screenY: number, f: number) => SkyObject,
    x: number,
    screenY: number,
    f: number,
    tint: number,
    angles: number[],
  ) {
    angles.forEach((a, i) => {
      const ray = this.add.image(x, 0, 'ray').setOrigin(0.5, 0).setBlendMode('ADD').setTint(tint)
        .setScale(1.6 + i * 0.3, 2.4 + (i % 2) * 0.6).setAngle(a).setAlpha(0.1).setDepth(-9.7);
      add(ray, screenY, f);
      this.tweens.add({
        targets: ray, angle: a + 6, alpha: 0.2, duration: 3200 + i * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 500,
      });
    });
  }

  updateSky() {
    const { x: vx, y: vy } = this.cameras.main.worldView;
    for (const o of this.sky) {
      o.y = o.baseY + vy * (1 - o.f);
      if (o.tile && o instanceof Phaser.GameObjects.TileSprite) {
        o.x = vx - 4;
        o.tilePositionX = vx * o.f;
      } else o.x = o.baseX + vx * (1 - o.f);
    }
  }

  buildClouds() {
    this.clouds = [];
    const n = Math.round((this.worldH / 110) * Math.max(1, this.worldW / W));
    for (let i = 0; i < n; i++) {
      const img = this.add
        .image(Phaser.Math.Between(-30, this.worldW + 30), Phaser.Math.Between(10, this.worldH - 60), `cloud${i % 3}`)
        .setTint(this.P.cloudTint ?? 0xffffff)
        .setAlpha(this.P.cloudAlpha ?? 0.75)
        .setFlipX(Math.random() < 0.5)
        .setDepth(-8);
      this.clouds.push(Object.assign(img, { vx: Phaser.Math.FloatBetween(2, 5) }));
    }
  }

  /** Matas, flores, piedras y (de noche) setas brillantes sobre la hierba; ondas en el agua */
  decorate() {
    const g = this.L.grid;
    const night = this.P.decor === 'night';
    const meadow = this.P.decor === 'meadow';
    const h = (a: number, b: number, s: number) => {
      let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1442695041) + this.levelIndex * 97;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const blocked = new Set([
      `${this.L.hole.r},${this.L.hole.c}`,
      `${this.L.start.r},${this.L.start.c}`,
      ...this.L.mushrooms.map((m) => `${m.r},${m.c}`),
    ]);
    const free = (r: number, c: number) => g[r]?.[c] === '.' && !blocked.has(`${r},${c}`);
    let lastTree = -9;
    const cols = this.L.cols;
    const edge = this.L.open ? 0 : 1; // los hoyos cerrados no decoran las paredes
    for (let r = 1; r < g.length; r++) {
      let run = 0; // casillas seguidas de hierba (para las vallas)
      for (let c = edge; c < cols - edge; c++) {
        if (g[r][c] !== '#' || g[r - 1][c] !== '.' || blocked.has(`${r - 1},${c}`)) {
          run = 0;
          continue;
        }
        run++;
        const x = c * T + 2 + Math.floor(h(r, c, 1) * 8);
        const y = r * T + 1;
        const p = h(r, c, 2);
        if (meadow) {
          // Pradera: árboles detrás del terreno, arbustos, vallas blancas, flores y matas
          const room = free(r - 1, c) && free(r - 2, c) && free(r - 3, c);
          if (p < 0.1 && room && c - lastTree > 2 && Math.abs(c - this.L.start.c) > 2) {
            lastTree = c;
            const pine = h(r, c, 6) < 0.4;
            this.add.image(c * T + 6, y + 1, pine ? 'tree-pine' : 'tree-round').setOrigin(0.5, 1).setDepth(4).setFlipX(h(r, c, 7) < 0.5);
          } else if (p < 0.2) this.add.image(x, y, 'bush').setOrigin(0.5, 1).setDepth(6);
          else if (p < 0.27 && run >= 3 && free(r - 1, c - 1)) this.add.tileSprite(c * T - 6, y + 1, 18, 8, 'fence').setOrigin(0, 1).setDepth(4);
          else if (p < 0.42) {
            const k = Math.floor(h(r, c, 4) * 3);
            this.add.sprite(x, y, `flower${k}`).setOrigin(0.5, 1).setDepth(6).play({ key: `flower${k}-sway`, delay: h(r, c, 5) * 800 });
          } else if (p < 0.6) this.add.sprite(x, y, 'tuft').setOrigin(0.5, 1).setDepth(6).play({ key: 'tuft-sway', startFrame: Math.floor(h(r, c, 3) * 2) });
          continue;
        }
        if (p < 0.2) this.add.sprite(x, y, 'tuft').setOrigin(0.5, 1).setDepth(6).play({ key: 'tuft-sway', startFrame: Math.floor(h(r, c, 3) * 2) });
        else if (p < 0.3 && !night) {
          const k = Math.floor(h(r, c, 4) * 3);
          this.add.sprite(x, y, `flower${k}`).setOrigin(0.5, 1).setDepth(6).play({ key: `flower${k}-sway`, delay: h(r, c, 5) * 800 });
        } else if (p < 0.3 && night) {
          this.add.image(x, y, 'glowshroom').setOrigin(0.5, 1).setDepth(6);
          const gl = this.add.image(x, y - 5, 'glow').setTint(0x7fe3f5).setBlendMode('ADD').setScale(0.35).setAlpha(0.45).setDepth(6);
          this.tweens.add({ targets: gl, alpha: 0.2, duration: 1200 + h(r, c, 6) * 800, yoyo: true, repeat: -1 });
        } else if (p < 0.36) this.add.image(x, y, 'rock').setOrigin(0.5, 1).setDepth(6);
      }
    }
    // ondas que brillan en la superficie del agua
    for (let r = 1; r < g.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 'W' || g[r - 1][c] === 'W' || h(r, c, 7) > 0.6) continue;
        const x = c * T + 3 + Math.floor(h(r, c, 8) * 5);
        const wv = this.add.image(x, r * T + 4, 'wave').setDepth(6).setAlpha(0);
        this.tweens.add({ targets: wv, alpha: 0.8, x: x + 2, duration: 700, yoyo: true, repeat: -1, repeatDelay: 600 + h(r, c, 9) * 1600, delay: h(r, c, 10) * 2000 });
      }
    }
  }

  staticBody(x: number, y: number, w: number, h: number, mat: MaterialKey): GameBody {
    const M = MATERIALS[mat];
    const b: GameBody = this.matter.add.rectangle(x + w / 2, y + h / 2, w, h, {
      isStatic: true, friction: M.friction, frictionStatic: 0.5, restitution: M.restitution, label: mat,
    });
    b.mat = mat;
    return b;
  }

  /** Cuerpos físicos: tramos de casillas fusionados (menos juntas = la bola no se engancha) */
  buildPhysics() {
    const g = this.L.grid;
    this.thins = [];
    for (const q of terrainRects(g)) {
      const b = this.staticBody(q.x, q.y, q.w, q.h, q.mat);
      if (q.thin) this.thins.push(b);
    }
    for (const { verts: v, mat } of terrainRamps(g)) {
      const M = MATERIALS[mat];
      const body: GameBody = this.matter.add.fromVertices((v[0].x + v[1].x + v[2].x) / 3, (v[0].y + v[1].y + v[2].y) / 3, [v], {
        isStatic: true, friction: M.friction, frictionStatic: 0.5, restitution: M.restitution, label: mat,
      });
      body.mat = mat;
    }
    this.ground = (this.matter.world.getAllBodies() as GameBody[]).find((b) => b.mat === 'grass' && b.bounds.max.y >= this.worldH - 1) || null;
  }

  buildObjects() {
    const L = this.L;
    this.movers = L.movers.map((m) => {
      const w = m.n * T;
      const x = m.c * T;
      const y = m.r * T;
      const body = this.staticBody(x, y, w, 9, 'wood');
      const sprite = this.add.image(x, y, renderBlock(this, `mover-${L.theme}-${w}`, w, 9, L.theme, 'grass')).setOrigin(0).setDepth(6);
      // carril punteado (pre-dibujado: un Graphics se re-triangularía en cada fotograma)
      const railW = w + 48 + 2;
      this.add.image(x - 24, y + 4, bakeTexture(this, `rail-${L.theme}-${w}`, railW, 1, (c) => {
        c.fillStyle = rgba(this.P.outline, 0.35);
        for (let rx = 0; rx <= w + 48; rx += 4) c.fillRect(rx, 0, 2, 1);
      })).setOrigin(0).setDepth(4);
      const mv: Mover = { body, sprite, baseX: x, x, y, w, h: 9, range: 24, omega: (Math.PI * 2) / 3.2, phase: Math.random() * 6, t: 0, vx: 0 };
      body.mover = mv;
      return mv;
    });
    this.crumbles = L.crumbles.map((cr) => {
      const w = cr.n * T;
      const x = cr.c * T;
      const y = cr.r * T;
      const body = this.staticBody(x, y, w, T, 'crumble');
      const sprite = this.add.image(x, y, renderBlock(this, `crumble-${L.theme}-${w}`, w, T, L.theme, 'crumble')).setOrigin(0).setDepth(6);
      const c: Crumble = { body, sprite, x, y, w, state: 'idle' };
      body.crumble = c;
      return c;
    });
    for (const m of L.mushrooms) {
      const x = m.c * T;
      const y = (m.r + 1) * T - 6;
      const body = this.staticBody(x, y, T, 6, 'mushroom');
      // origen abajo-centro: así se aplasta contra el suelo al botar
      body.sprite = this.add.image(x + T / 2, y + 6, 'mushroom').setOrigin(0.5, 1).setDepth(6);
    }
    this.bumpers = L.bumpers.map((b) => {
      const x = b.c * T + T / 2;
      const y = b.r * T + T / 2;
      const body: GameBody = this.matter.add.circle(x, y, 7.5, { isStatic: true, restitution: 0.9, friction: 0, label: 'bumper' });
      body.mat = 'bounds';
      body.sprite = this.add.image(x, y, 'bumper').setDepth(7);
      return body;
    });
    this.saws = L.saws.map((s) => {
      const x = s.c * T + T / 2;
      const y = s.r * T + T / 2;
      const sp = this.add.sprite(x, y, 'saw', 0).setDepth(7).play('saw-spin');
      if (s.range) {
        this.add.image(x - s.range, y, bakeTexture(this, `sawrail-${L.theme}-${s.range}`, s.range * 2 + 2, 1, (c) => {
          c.fillStyle = rgba(this.P.outline, 0.4);
          for (let rx = 0; rx <= s.range * 2; rx += 3) c.fillRect(rx, 0, 2, 1);
        })).setOrigin(0).setDepth(4);
        sp.x = x - s.range;
        this.tweens.add({ targets: sp, x: x + s.range, duration: 1800, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      }
      return sp;
    });
  }

  buildHole() {
    const h = this.L.hole;
    this.cupPos = { x: h.c * T + T / 2, y: (h.r + 1) * T };
    const { x, y } = this.cupPos;
    this.add.image(x, y + 1, 'cup').setDepth(6);
    this.pole = this.add.image(x, y + 1, 'pole').setOrigin(0.5, 1).setDepth(7);
    // brillo suave para encontrar el hoyo de un vistazo
    this.cupGlow = this.add.image(x, y - 2, 'glow').setTint(0xfff1b0).setBlendMode('ADD').setScale(0.45).setAlpha(0.35).setDepth(5);
    this.tweens.add({ targets: this.cupGlow, alpha: 0.12, scale: 0.6, duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.flag = this.add.sprite(x + 2, y - 28, 'flag', 0).setOrigin(0, 0).setDepth(7).play('flag-wave');
    // número del hoyo en la bandera
    this.flagNum = this.add
      .text(x + 8, y - 23, String(this.L.number), {
        fontFamily: FONT, fontSize: `${Math.round(7 * FONT_SCALE)}px`, color: '#ffffff', resolution: VIEW.Z * 2,
      })
      .setOrigin(0.5)
      .setDepth(8);
  }

  createBall() {
    const s = this.L.start;
    this.startPos = { x: s.c * T + T / 2, y: (s.r + 1) * T - this.ballR };
    this.ball = this.matter.add.circle(this.startPos.x, this.startPos.y, this.ballR, {
      label: 'ball', restitution: this.ballType.bounce ?? 0, friction: 0.4, frictionStatic: 0.3, frictionAir: 0, density: 0.004,
    });
    // marcas de salida del tee (en la Pradera)
    if (this.P.decor === 'meadow') {
      const gy = (s.r + 1) * T + 1;
      this.add.image(this.startPos.x - 14, gy, 'tee-red').setOrigin(0.5, 1).setDepth(6);
      this.add.image(this.startPos.x + 14, gy, 'tee-blue').setOrigin(0.5, 1).setDepth(6);
    }
    this.trailG = this.add.graphics().setDepth(9);
    this.ballLight = this.add.image(this.startPos.x, this.startPos.y, 'glow').setBlendMode('ADD').setTint(this.trailColor).setScale(0.35).setAlpha(0.12).setDepth(9.5);
    this.ballShadow = this.add.image(0, 0, 'bshadow').setDepth(6).setAlpha(0);
    this.ballSprite = this.add.sprite(this.startPos.x, this.startPos.y, `ball-${this.skin.id}`, 0).setDepth(10).setScale(this.ballScale);
    this.counter = this.add
      .text(0, 0, '0', {
        fontFamily: FONT, fontSize: `${Math.round(11 * FONT_SCALE)}px`, color: '#ffffff', stroke: this.P.outline, strokeThickness: 3, resolution: VIEW.Z,
      })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setVisible(false);
    this.readyRing = this.add.graphics().setDepth(9);
    this.safe = { x: this.startPos.x, y: this.startPos.y, body: null };
  }

  createFx() {
    const P = this.P;
    this.impactLooks = {
      grass: { light: 0xe0ffb0, bits: [hex(P.grassHi), hex(P.grass), hex(P.grassDark)], n: 1 },
      rough: { light: 0xc8f090, bits: [hex(P.roughHi ?? P.grass), hex(P.rough ?? P.grassDark)], n: 1.3 },
      sand: { light: 0xffe7a0, bits: [hex('#fff0b0'), hex('#f2d083'), hex('#d9ad5e')], n: 1.8 },
      ice: { light: 0xe0fbff, bits: [0xffffff, hex('#d6f5ff'), hex('#a8e2f5')], n: 1.2 },
      wood: { light: 0xffd8a0, bits: [hex('#c8905a'), hex('#8a5a3c')], n: 0.9 },
      mushroom: { light: 0xff9ad0, bits: [hex('#ff9aa2'), 0xffffff, hex('#ffd0e0')], n: 1.4 },
      crumble: { light: 0xffc090, bits: [hex(P.dirtLight), hex(P.dirt), hex(P.stripe)], n: 1.6 },
      bounds: { light: 0xffffff, bits: [0xffffff, hex('#ffd36b')], n: 0.8 },
    };
    // chispas de los rastros especiales (fuego, estrellas, oro…)
    this.trailFx = this.add.particles(0, 0, 'px', {
      lifespan: { min: 250, max: 500 }, speed: { min: 5, max: 25 }, angle: { min: 0, max: 360 }, gravityY: 30,
      scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
    }).setDepth(9);
    // trocitos de superficie: salen hacia arriba y caen con gravedad
    this.debris = this.add.particles(0, 0, 'px', {
      lifespan: { min: 320, max: 650 }, speed: { min: 40, max: 150 }, angle: { min: 215, max: 325 }, gravityY: 420,
      scale: { start: 1, end: 0.3 }, alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, emitting: false,
    }).setDepth(12);
    this.dust = this.add.particles(0, 0, 'px', {
      lifespan: 450, speed: { min: 15, max: 60 }, angle: { min: 200, max: 340 }, gravityY: 120, scale: { start: 1, end: 0.5 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(12);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: { min: 30, max: 100 }, angle: { min: 0, max: 360 }, alpha: { start: 1, end: 0 },
      tint: [0xffffff, hex('#ffd36b')], emitting: false,
    }).setDepth(13);
    this.confetti = this.add.particles(0, 0, 'px', {
      lifespan: 1800, speed: { min: 80, max: 220 }, angle: { min: 235, max: 305 }, gravityY: 260, rotate: { min: 0, max: 360 },
      tint: [hex('#ef4d5e'), hex('#ffd36b'), hex('#72d454'), hex('#4a86e0'), 0xffffff, hex('#ff8a5c')], emitting: false,
    }).setDepth(14);
    this.hazardFx = this.add.particles(0, 0, 'px', {
      lifespan: 450, speed: { min: 40, max: 130 }, angle: { min: 0, max: 360 }, tint: [hex('#ef4d5e'), 0xffffff, hex('#ff8a5c')], emitting: false,
    }).setDepth(13);
    this.splash = this.add.particles(0, 0, 'drop', {
      lifespan: 600, speed: { min: 40, max: 120 }, angle: { min: 230, max: 310 }, gravityY: 400, emitting: false,
    }).setDepth(13);
  }

  // ---------------------------------------------------------------- Intro de cámara

  startIntro() {
    const cam = this.cameras.main;
    cam.centerOn(this.cupPos.x, this.cupPos.y + 30);
    this.introTimer = this.time.delayedCall(1200, () => {
      const target = this.startPos.y - FOLLOW_OFFSET;
      const dist = Math.hypot(target - cam.midPoint.y, this.startPos.x - cam.midPoint.x);
      const duration = Phaser.Math.Clamp(dist * 2.5, 600, 2400);
      cam.pan(this.startPos.x, target, duration, 'Sine.easeInOut', false, (_c, prog) => {
        if (prog === 1) this.beginPlay();
      });
    });
  }

  skipIntro() {
    this.introTimer?.remove(false);
    this.beginPlay();
  }

  beginPlay() {
    if (this.state !== 'intro') return;
    this.state = 'play';
    const cam = this.cameras.main;
    cam.panEffect.reset();
    cam.startFollow(this.ballSprite, false, 0.1, 0.1, 0, FOLLOW_OFFSET);
    this.bus.emit('play');
  }

  // ---------------------------------------------------------------- Entrada (coordenadas de pantalla → lógicas)

  /**
   * Ratón/táctil: arrastra y suelta (tirachinas).
   * Teclado: ← → (o A/D) giran, ↑ ↓ (o W/S) cambian la potencia, ESPACIO/ENTER golpea
   * (MAYÚS para ajuste fino). En el aire, ESPACIO usa el freno. ESC/P (pausa) los gestiona UIScene.
   * Botón central (rueda) + arrastrar: mueve la cámara por el mapa; vuelve a la bola al apuntar o golpear.
   */
  setupInput() {
    const Z = VIEW.Z;
    // dos dedos (config: input.activePointers = 2) → mover el mapa
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    const mid = () => ({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
    this.onDown = (p) => {
      sfx.unlock();
      if (p.middleButtonDown()) {
        if (this.state === 'intro') this.skipIntro();
        this.startPan(p.x, p.y, false);
        return;
      }
      // dos dedos en la pantalla: se cancela el apuntado y se mueve el mapa
      if (p1.isDown && p2.isDown) {
        if (this.state === 'intro') this.skipIntro();
        this.cancelAim();
        const m = mid();
        this.startPan(m.x, m.y, true);
        return;
      }
      if (this.state === 'intro') return this.skipIntro();
      if (!this.ready || this.state !== 'play' || this.respawning) return;
      this.resumeFollow();
      this.kbAiming = false;
      this.aiming = true;
      this.chargeStep = 0;
      this.aimStart.set(p.x / Z, p.y / Z);
      this.aimVec.set(0, 0);
    };
    this.onMove = (p) => {
      if (this.pan) {
        // arrastrar = mover el mapa con la mano (la cámara va al revés que el ratón)
        const at = this.pan.touch ? mid() : p;
        const cam = this.cameras.main;
        cam.setScroll(this.pan.scrollX - (at.x - this.pan.x) / cam.zoom, this.pan.scrollY - (at.y - this.pan.y) / cam.zoom);
        return;
      }
      if (!this.aiming || this.kbAiming) return;
      this.aimVec.set(this.aimStart.x - p.x / Z, this.aimStart.y - p.y / Z);
      if (this.aimVec.length() > MAX_DRAG) this.aimVec.setLength(MAX_DRAG);
    };
    this.onUp = (p) => {
      // con dos dedos, el arrastre acaba al levantar cualquiera de ellos
      if (this.pan && (this.pan.touch || p.button === 1 || !p.middleButtonDown())) {
        this.pan = null;
        this.input.setDefaultCursor('default');
        return;
      }
      if (!this.aiming || this.kbAiming) return;
      this.aiming = false;
      this.aimGfx.clear();
      if (this.aimVec.length() >= 6 && this.ready) this.shoot(this.aimVec);
    };
    this.onRestart = () => this.restartLevel();
    this.onShootKey = () => {
      sfx.unlock();
      if (this.state === 'intro') return this.skipIntro();
      if (this.kbAiming && this.ready) {
        this.aiming = false;
        this.kbAiming = false;
        this.aimGfx.clear();
        this.shoot(this.aimVec);
      } else if (this.ready && !this.aiming) {
        this.startKeyboardAim();
      } else {
        this.useBrake();
      }
    };

    this.input.on('pointerdown', this.onDown);
    this.input.on('pointermove', this.onMove);
    this.input.on('pointerup', this.onUp);
    this.input.on('pointerupoutside', this.onUp);
    // sin esto, el clic central del navegador activa el autodesplazamiento de la página
    this.onMiddleDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    this.game.canvas.addEventListener('mousedown', this.onMiddleDown);
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-R', this.onRestart);
      kb.on('keydown-SPACE', this.onShootKey);
      kb.on('keydown-ENTER', this.onShootKey);
      this.keys = kb.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SHIFT', false) as GameScene['keys'];
    }
  }

  teardownInput() {
    this.input.off('pointerdown', this.onDown);
    this.input.off('pointermove', this.onMove);
    this.input.off('pointerup', this.onUp);
    this.input.off('pointerupoutside', this.onUp);
    this.game.canvas.removeEventListener('mousedown', this.onMiddleDown);
    this.pan = null;
    this.input.setDefaultCursor('default');
    const kb = this.input.keyboard;
    kb?.off('keydown-R', this.onRestart);
    kb?.off('keydown-SPACE', this.onShootKey);
    kb?.off('keydown-ENTER', this.onShootKey);
  }

  /** Empieza a mover la cámara libremente (botón central o dos dedos) */
  startPan(x: number, y: number, touch: boolean) {
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.panEffect.reset();
    this.freeCam = true;
    this.pan = { x, y, scrollX: cam.scrollX, scrollY: cam.scrollY, touch };
    if (!touch) this.input.setDefaultCursor('grabbing');
  }

  /** La cámara vuelve a seguir a la bola (suavemente, por el lerp del seguimiento) */
  resumeFollow() {
    if (!this.freeCam) return;
    this.freeCam = false;
    this.pan = null;
    this.input.setDefaultCursor('default');
    this.cameras.main.startFollow(this.ballSprite, false, 0.1, 0.1, this.camOff.x, this.camOff.y);
  }

  startKeyboardAim() {
    if (!this.ready || this.state !== 'play' || this.respawning) return;
    this.resumeFollow();
    this.aiming = true;
    this.kbAiming = true;
    this.chargeStep = 0;
    this.applyKeyboardAim();
  }

  applyKeyboardAim() {
    const { angle, power } = this.kb;
    this.aimVec.set(Math.cos(angle), Math.sin(angle)).scale(Math.max(0.1, power) * MAX_DRAG);
  }

  /** Lee las teclas de dirección cada fotograma (empieza a apuntar en cuanto pulsas una) */
  updateKeyboardAim(delta: number) {
    const k = this.keys;
    if (!k) return;
    const left = k.LEFT.isDown || k.A.isDown;
    const right = k.RIGHT.isDown || k.D.isDown;
    const up = k.UP.isDown || k.W.isDown;
    const down = k.DOWN.isDown || k.S.isDown;
    if (!(left || right || up || down)) return;
    if (!this.kbAiming) {
      if (this.aiming) return; // está apuntando con el ratón
      this.startKeyboardAim();
      if (!this.kbAiming) return;
    }
    const dt = delta / 1000;
    const fine = k.SHIFT.isDown ? 0.25 : 1;
    if (left) this.kb.angle -= 1.5 * fine * dt;
    if (right) this.kb.angle += 1.5 * fine * dt;
    if (up) this.kb.power += 0.6 * fine * dt;
    if (down) this.kb.power -= 0.6 * fine * dt;
    this.kb.angle = Phaser.Math.Clamp(this.kb.angle, -Math.PI, 0);
    this.kb.power = Phaser.Math.Clamp(this.kb.power, 0.1, 1);
    this.applyKeyboardAim();
  }

  /** Cancela el apuntado (ESC) */
  cancelAim() {
    this.aiming = false;
    this.kbAiming = false;
    this.aimGfx.clear();
  }

  /** Clics que suben de tono con cada cuarto de potencia mientras apuntas */
  chargeFeedback() {
    const step = Math.min(4, Math.floor(shotPower(this.aimVec.length()) * 4 + 0.001));
    if (step > this.chargeStep) {
      if (step === 4) {
        sfx.chargeMax();
        haptic(8);
      } else sfx.charge(step);
    }
    this.chargeStep = step;
  }

  /** ¿Se puede pausar ahora? (no durante la celebración del final) */
  canPause() {
    return this.state === 'intro' || this.state === 'play';
  }

  // ---------------------------------------------------------------- Física

  getVel(): Vec {
    const v = Body.getVelocity(this.ball);
    return { x: v.x * 60, y: v.y * 60 };
  }

  setVel(x: number, y: number) {
    Body.setVelocity(this.ball, { x: x / 60, y: y / 60 });
  }

  currentMat(): MaterialKey {
    return this.groundBody?.mat || 'grass';
  }

  carrierVelocity() {
    return this.grounded && this.groundBody?.mover ? this.groundBody.mover.vx : 0;
  }

  onCollide(e: CollisionEvent, start: boolean) {
    for (const pair of e.pairs) {
      let other: GameBody;
      if (pair.bodyA === this.ball) other = pair.bodyB;
      else if (pair.bodyB === this.ball) other = pair.bodyA;
      else continue;
      other = (other.parent as GameBody) || other;
      if (pair.isSensor || other.isSensor) continue;

      let nx = pair.collision.normal.x;
      let ny = pair.collision.normal.y;
      if (nx * (other.position.x - this.ball.position.x) + ny * (other.position.y - this.ball.position.y) < 0) {
        nx = -nx;
        ny = -ny;
      }

      if (other.label === 'bumper') {
        if (start) this.bump(other);
        continue;
      }
      if (ny > 0.45) {
        this.groundTime = this.simTime;
        this.groundBody = other;
        this.groundNormal = { x: nx, y: ny };
      }
      if (start && !this.frozen) {
        const impact = this.prevVel.x * nx + this.prevVel.y * ny;
        if (impact > 60) this.impactFx(other, impact, ny > 0.45, nx, ny);
      }
    }
  }

  /** Onda en el suelo al aterrizar con fuerza */
  ringFx(x: number, y: number, { r = 13, flat = 0.8, color = 0xffffff, duration = 320 } = {}) {
    const g = this.add.graphics().setDepth(9);
    const o = { r: 2, a: 0.9 };
    this.tweens.add({
      targets: o,
      r,
      a: 0,
      duration,
      ease: 'Quad.easeOut',
      onUpdate: () => g.clear().lineStyle(1.2, color, o.a).strokeEllipse(x, y, o.r * 2, o.r * 2 * flat),
      onComplete: () => g.destroy(),
    });
  }

  /** Temblor de cámara (respeta el ajuste "Temblor") */
  shake(duration: number, intensity: number) {
    if (progress.settings.shake) this.cameras.main.shake(duration, intensity);
  }

  /**
   * Bote contra una superficie: destello de luz del color del material en el punto de contacto,
   * trocitos que saltan (hierba, arena, astillas, chispas…), onda, aplastamiento y la decoración
   * cercana que se agita. (nx, ny) apunta de la bola hacia la superficie.
   */
  impactFx(other: GameBody, impact: number, floor: boolean, nx = 0, ny = 1) {
    const mat = other.mat || 'grass';
    const look = this.impactLooks[mat];
    const p = this.ball.position;
    const hx = p.x + nx * this.ballR;
    const hy = p.y + ny * this.ballR;
    const k = Phaser.Math.Clamp((impact - 60) / 300, 0, 1); // 0 = toque suave, 1 = golpe fuerte

    // destello de luz en el punto de contacto
    this.flashLight(hx, hy, look.light, 0.25 + k * 0.45, 0.35 + k * 0.5);

    if (floor && impact > 120) this.ringFx(p.x, p.y + this.ballR, { flat: 0.4, r: 10 + k * 10 });
    if (impact > 260) {
      this.hitStop = Math.max(this.hitStop, 30);
      this.shake(70, 0.003);
      haptic(12);
    }
    if (floor) {
      this.dust.particleTint = MATERIALS[mat].dust;
      this.dust.explode(Math.min(8, Math.round(impact / 35)), p.x, p.y + this.ballR);
      // trocitos del material, en dos o tres tonos
      const n = Math.round(Math.min(14, impact / 28) * look.n);
      look.bits.forEach((col, i) => {
        this.debris.particleTint = col;
        this.debris.explode(Math.max(1, Math.round(n / look.bits.length) - i), hx, hy - 1);
      });
      this.tweens.add({ targets: this.ballSprite, scaleY: (0.75 - k * 0.1) * this.ballScale, scaleX: (1.25 + k * 0.1) * this.ballScale, duration: 60, yoyo: true });
      this.shakeDecor(hx, hy, k);
    } else {
      // pared o techo: chispas pequeñas
      this.sparks.explode(2 + Math.round(k * 5), hx, hy);
      this.tweens.add({ targets: this.ballSprite, scaleX: 0.8 * this.ballScale, scaleY: 1.15 * this.ballScale, duration: 50, yoyo: true });
    }
    // la seta se aplasta y rebota
    if (mat === 'mushroom' && other.sprite) {
      const s = other.sprite;
      this.tweens.killTweensOf(s);
      s.setScale(1);
      this.tweens.add({ targets: s, scaleY: 0.55, scaleX: 1.3, duration: 70, yoyo: true, ease: 'Quad.easeOut', onComplete: () => s.setScale(1) });
      this.sparks.explode(4 + Math.round(k * 6), s.x, s.y - 6);
    }
    if (mat === 'mushroom' && impact > 100) sfx.boing();
    else sfx.land(impact * 2.5);
  }

  /** Destello de luz aditivo que se expande y se apaga */
  flashLight(x: number, y: number, color: number, alpha: number, scale: number) {
    const fl = this.add.image(x, y, 'glow').setBlendMode('ADD').setTint(color).setAlpha(alpha).setScale(scale * 0.6).setDepth(11);
    this.tweens.add({ targets: fl, scale, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => fl.destroy() });
  }

  /** Matas, flores y arbustos cercanos al bote se agitan (más cuanto más fuerte) */
  shakeDecor(x: number, y: number, k: number) {
    const reach = 18 + k * 22;
    for (const d of this.decor) {
      const dx = d.x - x;
      if (Math.abs(dx) > reach || Math.abs(d.y - y) > 14 || !d.active) continue;
      if (this.tweens.isTweening(d)) continue;
      const side = dx === 0 ? 1 : Math.sign(dx);
      const near = 1 - Math.abs(dx) / reach;
      this.tweens.add({
        targets: d,
        angle: { from: side * (8 + 16 * k) * near, to: 0 },
        scaleY: { from: 1 - 0.3 * near * (0.5 + k), to: 1 },
        duration: 380 + near * 200,
        ease: 'Elastic.easeOut',
      });
    }
  }

  bump(bumper: GameBody) {
    const p = this.ball.position;
    const d = new Phaser.Math.Vector2(p.x - bumper.position.x, p.y - bumper.position.y).normalize();
    this.bumpVel = { x: d.x * 280, y: d.y * 280 }; // se aplica tras el paso de física
    const spr = bumper.sprite;
    if (spr) {
      spr.setTexture('bumper-lit');
      this.time.delayedCall(140, () => spr.setTexture('bumper'));
      this.tweens.add({ targets: spr, scale: 1.3, duration: 70, yoyo: true });
    }
    this.sparks.explode(8, bumper.position.x, bumper.position.y);
    this.ringFx(bumper.position.x, bumper.position.y, { r: 16, flat: 1, color: 0xffd36b, duration: 260 });
    this.shake(80, 0.004);
    this.hitStop = Math.max(this.hitStop, 45);
    haptic(20);
    sfx.bumper();
  }

  /** Un paso fijo de física + reglas propias (rozamiento tangencial, viento, plataformas) */
  tick(ms: number) {
    const dt = ms / 1000;
    this.simTime += ms;

    for (const m of this.movers) {
      m.t += dt;
      const nx = m.baseX + Math.sin(m.t * m.omega + m.phase) * m.range;
      m.vx = (nx - m.x) / dt;
      m.x = nx;
      Body.setPosition(m.body, { x: nx + m.w / 2, y: m.y + m.h / 2 }, true);
    }

    // plataformas finas: solo sólidas si la bola está por encima
    for (const b of this.thins) b.collisionFilter.mask = thinSolidFor(this.ball.position.y, this.ballR, b.bounds.min.y) ? 0xffffffff : 0;

    this.prevVel = this.getVel();
    this.matter.world.step(ms);

    this.grounded = this.simTime - this.groundTime < 30;
    const v = this.getVel();
    const carrierVx = this.carrierVelocity();
    this.relSpeed = Math.hypot(v.x - carrierVx, v.y);
    if (this.frozen) return;
    if (this.bumpVel) {
      this.setVel(this.bumpVel.x, this.bumpVel.y);
      this.bumpVel = null;
      this.groundTime = -1000;
      return;
    }

    let { x: vx, y: vy } = v;
    const gb = this.groundBody;
    if (this.grounded && gb) {
      const M = MATERIALS[gb.mat ?? 'grass'];
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
      if (gb.crumble && gb.crumble.state === 'idle') this.startCrumble(gb.crumble);
    } else {
      vx += this.L.wind * (this.ballType.wind ?? 1) * dt;
      // gravedad propia del tipo (Matter ya aplica la normal: se suma solo la diferencia)
      vy += GRAVITY * ((this.ballType.gravity ?? 1) - 1) * dt;
    }
    this.setVel(vx, vy);
  }

  startCrumble(cr: Crumble) {
    cr.state = 'shaking';
    sfx.crack();
    const shake = this.tweens.add({ targets: cr.sprite, x: cr.x + 1, duration: 40, yoyo: true, repeat: -1 });
    this.time.delayedCall(1100, () => {
      shake.stop();
      cr.sprite.x = cr.x;
      cr.state = 'fallen';
      cr.body.collisionFilter.mask = 0; // deja de colisionar
      this.dust.particleTint = MATERIALS.crumble.dust;
      this.dust.explode(12, cr.x + cr.w / 2, cr.y + 6);
      this.tweens.add({ targets: cr.sprite, y: cr.y + 24, alpha: 0, duration: 400, ease: 'Quad.easeIn' });
      // Reaparece pasado un rato, pero nunca encima de la bola (se quedaría incrustada)
      const restore = () => {
        const p = this.ball.position;
        const r = this.ballR + 1;
        if (p.x > cr.x - r && p.x < cr.x + cr.w + r && p.y > cr.y - r && p.y < cr.y + T + r) {
          this.time.delayedCall(300, restore);
          return;
        }
        cr.body.collisionFilter.mask = 0xffffffff;
        cr.sprite.setPosition(cr.x, cr.y).setAlpha(0);
        this.tweens.add({ targets: cr.sprite, alpha: 1, duration: 300 });
        cr.state = 'idle';
      };
      this.time.delayedCall(3200, restore);
    });
  }

  shoot(v: Phaser.Math.Vector2) {
    this.resumeFollow();
    const mat = this.currentMat();
    const power = shotPower(v.length());
    const dir = v.clone().normalize();
    const sp = power * MAX_SPEED * this.stats.power * MATERIALS[mat].power;
    this.setVel(dir.x * sp + this.carrierVelocity(), dir.y * sp);
    Body.setAngularVelocity(this.ball, 0);

    this.groundTime = -1000;
    this.grounded = false;
    this.ready = false;
    this.restTime = 0;
    this.strokes++;
    this.readyRing.clear();

    const p = this.ball.position;
    this.dust.particleTint = MATERIALS[mat].dust;
    this.dust.explode(6, p.x, p.y + this.ballR);
    // el palo levanta un poco de suelo y hay un fogonazo del color de la bola
    const look = this.impactLooks[mat];
    look.bits.forEach((col) => {
      this.debris.particleTint = col;
      this.debris.explode(Math.round(2 + power * 4 * look.n), p.x, p.y + this.ballR - 1);
    });
    this.flashLight(p.x, p.y, this.trailColor, 0.3 + power * 0.4, 0.4 + power * 0.5);
    this.shakeDecor(p.x, p.y + this.ballR, power * 0.6);
    this.tweens.add({ targets: this.ballSprite, scaleX: 0.75 * this.ballScale, scaleY: 1.25 * this.ballScale, duration: 70, yoyo: true });
    sfx.hit(power);
    if (mat === 'mushroom') {
      this.sparks.explode(8, p.x, p.y + 4);
      sfx.boing();
    }
    if (power > 0.9) {
      this.shake(100, 0.005);
      this.hitStop = 45;
    }
    this.ringFx(p.x, p.y + this.ballR, { r: 6 + power * 10, flat: 0.4, duration: 260 });
    haptic(Math.round(8 + power * 22));

    this.bus.emit('shot', this.strokes);
    this.emitHud();
  }

  drawAim(cx: number, cy: number) {
    const g = this.aimGfx;
    g.clear();
    const v = this.aimVec;
    const len = v.length();
    if (len < 6) return;

    const power = shotPower(len);
    const dir = v.clone().normalize();
    const sp = power * MAX_SPEED * this.stats.power * MATERIALS[this.currentMat()].power;
    const col = powerColor(power);
    const ink = hex(this.P.outline);

    let x = cx;
    let y = cy;
    let vx = dir.x * sp + this.carrierVelocity();
    let vy = dir.y * sp;
    const st = STEP / 1000;
    const n = Math.ceil(this.stats.aim / st); // la mejora "Visor" alarga la trayectoria visible
    let impact = false;
    for (let i = 1; i <= n; i++) {
      vx += this.L.wind * (this.ballType.wind ?? 1) * st;
      vy += GRAVITY * (this.ballType.gravity ?? 1) * st;
      x += vx * st;
      y += vy * st;
      if (this.trajectoryHitsTerrain(x, y, vy)) {
        impact = true;
        break;
      }
      if (i % 3 === 0) {
        const k = 1 - i / n;
        g.fillStyle(ink, 0.6).fillCircle(x, y, 1.6 + k);
        g.fillStyle(0xffffff, 1).fillCircle(x, y, 0.9 + k);
      }
    }
    if (impact) {
      g.lineStyle(1.2, col, 0.9).strokeCircle(x, y, 3.2);
      g.fillStyle(col, 0.85).fillCircle(x, y, 1);
    }

    const bx = cx - dir.x * len * 0.4;
    const by = cy - dir.y * len * 0.4;
    g.lineStyle(2.2, ink, 1).lineBetween(cx, cy, bx, by);
    g.lineStyle(1, col, 1).lineBetween(cx, cy, bx, by);
    g.fillStyle(ink).fillCircle(bx, by, 3);
    g.fillStyle(col).fillCircle(bx, by, 2);

    g.lineStyle(2.4, ink, 0.8).strokeCircle(cx, cy, 10);
    g.lineStyle(1.4, col, 1);
    g.beginPath();
    g.arc(cx, cy, 10, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2, false);
    g.strokePath();
  }

  /** Comprueba el contacto de la bola con el terreno sólido del mapa (las plataformas finas solo al bajar). */
  trajectoryHitsTerrain(x: number, y: number, vy: number): boolean {
    const radius = this.ballR * 0.9;
    for (let i = 0; i < 12; i++) {
      const px = x + RING[i][0] * radius;
      const py = y + RING[i][1] * radius;
      const ch = this.cellAt(px, py);
      const lx = ((px % T) + T) % T;
      const ly = ((py % T) + T) % T;
      if (ch === '=' && vy < 0) continue;
      if (cellSolid(ch, lx, ly)) return true;
    }
    return false;
  }

  /** Rastro equipado: degradado de colores a lo largo de la cola (o arcoíris que gira) y chispas */
  drawTrail() {
    const g = this.trailG;
    g.clear();
    const pts = this.trailPts;
    const tr = this.trail;
    const cols = tr.colors;
    const wMax = (tr.width ?? 6) - 1;
    const shift = tr.rainbow ? Math.floor(this.time.now / 90) : 0;
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      const col = cols[(Math.min(cols.length - 1, Math.floor(k * cols.length)) + shift) % cols.length];
      g.lineStyle(1 + k * wMax, col, k * (tr.rainbow ? 0.7 : 0.55));
      g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    // chispas que se desprenden de la cola
    if (tr.sparkle && pts.length > 2 && Math.random() < 0.45) {
      const p = pts[pts.length - 2];
      this.trailFx.particleTint = tr.sparkle[Math.floor(Math.random() * tr.sparkle.length)];
      this.trailFx.explode(1, p.x + Phaser.Math.Between(-2, 2), p.y + Phaser.Math.Between(-2, 2));
    }
  }

  cellAt(x: number, y: number): string | undefined {
    return this.L.grid[Math.floor(y / T)]?.[Math.floor(x / T)];
  }

  /** Sombra de la bola proyectada hacia abajo sobre el terreno */
  updateBallShadow(cx: number, cy: number) {
    const s = this.ballShadow;
    if (!this.ballSprite.visible || this.state === 'sinking' || this.state === 'done') {
      s.setAlpha(0);
      this.shadowAt.on = false;
      return;
    }
    // quieta (y con el mismo estado) no hace falta volver a buscar el suelo
    if (Math.abs(cx - this.shadowAt.x) < 0.02 && Math.abs(cy - this.shadowAt.y) < 0.02 && this.shadowAt.on) return;
    this.shadowAt = { x: cx, y: cy, on: true };
    const maxD = 110;
    let gy: number | null = null;
    for (let d = this.ballR - 1; d < maxD; d++) {
      const y = cy + d;
      const ch = this.cellAt(cx, y);
      const lx = ((Math.floor(cx) % T) + T) % T;
      const ly = ((Math.floor(y) % T) + T) % T;
      if (ch && cellSolid(ch, lx, ly)) {
        gy = Math.floor(y);
        break;
      }
    }
    if (gy === null) {
      s.setAlpha(0);
      return;
    }
    const k = Phaser.Math.Clamp((gy - cy - this.ballR) / maxD, 0, 1);
    s.setPosition(cx, gy - 1).setScale(1 - k * 0.6, 1).setAlpha(0.28 * (1 - k));
  }

  /**
   * Halo de luz de la bola (más intenso cuanto más rápido va) y polvillo del material
   * mientras rueda deprisa.
   */
  updateBallLight(cx: number, cy: number, delta: number) {
    const L = this.ballLight;
    const visible = this.ballSprite.visible && this.ballSprite.alpha > 0.5 && this.state !== 'sinking' && this.state !== 'done';
    const speed = Phaser.Math.Clamp(this.relSpeed / 320, 0, 1);
    const targetA = visible ? 0.1 + speed * 0.32 : 0;
    L.setPosition(cx, cy);
    L.alpha += (targetA - L.alpha) * 0.2;
    L.setScale(0.3 + speed * 0.3);

    // al rodar rápido por el suelo, va soltando polvo (y briznas en la hierba)
    if (!visible || this.respawning || !this.grounded || this.relSpeed < 45) return;
    this.rollFxTimer -= delta;
    if (this.rollFxTimer > 0) return;
    this.rollFxTimer = Phaser.Math.Linear(110, 45, Phaser.Math.Clamp((this.relSpeed - 45) / 200, 0, 1));
    const mat = this.currentMat();
    if (mat === 'mushroom' || mat === 'bounds') return;
    this.dust.particleTint = MATERIALS[mat].dust;
    this.dust.explode(1, cx, cy + this.ballR);
    if (Math.random() < 0.5) {
      const bits = this.impactLooks[mat].bits;
      this.debris.particleTint = bits[Math.floor(Math.random() * bits.length)];
      this.debris.explode(1, cx, cy + this.ballR - 1);
    }
  }

  // ---------------------------------------------------------------- Bucle

  /**
   * Bola parada y lista para golpear, sin nada que se mueva (plataformas, bloques frágiles): la física
   * no tiene nada que calcular, así que no se avanza (ahorra CPU mientras el jugador apunta o piensa).
   * Se reanuda sola en cuanto se golpea (`shoot` pone `ready` a false).
   */
  physicsIdle() {
    return this.state === 'play' && this.ready && !this.respawning && !this.frozen && !this.bumpVel
      && this.movers.length === 0 && this.crumbles.length === 0;
  }

  /** Cámara lenta cuando la bola vuela cerca del hoyo (momento "¿entra o no entra?") */
  targetTimeScale() {
    if (this.state !== 'play' || this.respawning || this.grounded || this.relSpeed < 40) return 1;
    const p = this.ball.position;
    const d = Phaser.Math.Distance.Between(p.x, p.y, this.cupPos.x, this.cupPos.y - this.ballR);
    return d < 30 ? 0.4 : 1;
  }

  update(_: number, delta: number) {
    let d = Math.min(delta, 100);
    if (this.hitStop > 0) {
      // hit-stop: congela la física unos ms para dar peso al impacto
      this.hitStop -= d;
      d = 0;
    }
    this.timeScale += (this.targetTimeScale() - this.timeScale) * 0.2;
    this.acc += d * this.timeScale;
    if (this.physicsIdle()) this.acc = 0;
    else {
      while (this.acc >= STEP) {
        this.tick(STEP);
        this.acc -= STEP;
      }
    }
    for (const m of this.movers) m.sprite.x = m.x;

    // parallax del fondo
    const view = this.cameras.main.worldView;
    this.bgTile.tilePositionX = view.x * 0.6;
    this.bgTile.tilePositionY = view.y * 0.6;
    this.updateSky();

    // la cámara se adelanta hacia donde apuntas
    if (this.state === 'play') {
      let tx = 0;
      let ty = FOLLOW_OFFSET;
      if (this.aiming && this.aimVec.length() > 6) {
        const k = Math.min(this.aimVec.length() / MAX_DRAG, 1) * 55;
        const d = this.aimVec.clone().normalize();
        tx = -d.x * k;
        ty = FOLLOW_OFFSET - d.y * k;
      }
      this.camOff.x += (tx - this.camOff.x) * 0.06;
      this.camOff.y += (ty - this.camOff.y) * 0.06;
      this.cameras.main.setFollowOffset(this.camOff.x, this.camOff.y);
    }

    for (const c of this.clouds) {
      c.x += c.vx * (delta / 1000);
      if (c.x - c.width / 2 > this.worldW + 40) c.x = -c.width / 2 - 40;
    }

    const p = this.ball.position;
    const cx = p.x;
    const cy = p.y;
    this.updateBallShadow(cx, cy);
    this.updateBallLight(cx, cy, delta);
    // un Graphics vacío también cuesta (rompe el lote de dibujo): solo se muestran cuando tienen algo que pintar
    this.aimGfx.setVisible(this.aiming);
    this.readyRing.setVisible(this.ready && !this.aiming);
    this.trailG.setVisible(this.trailPts.length > 1);

    if (!this.respawning && this.state !== 'done') {
      if (this.relSpeed > 90 && this.state !== 'sinking') this.trailPts.push({ x: cx, y: cy });
      else this.trailPts.shift();
      if (this.trailPts.length > 12) this.trailPts.shift();
      this.drawTrail();
    }

    if (this.state === 'sinking' || this.state === 'done') return;

    if (!this.respawning) {
      const dx = cx - this.ballSprite.x;
      this.ballSprite.setPosition(cx, cy);
      this.rollDist += dx;
      this.ballSprite.setFrame(((Math.floor(this.rollDist / 3) % 4) + 4) % 4);
    }

    const playing = this.state === 'play' && !this.respawning;
    if (playing) {
      const dxCup = this.cupPos.x - cx;
      const dyCup = cy - (this.cupPos.y - this.ballR);
      if (this.grounded && Math.abs(dyCup) < 2 && Math.abs(dxCup) < this.stats.magnet && Math.abs(dxCup) > 0.5) {
        this.setVel(Phaser.Math.Clamp(dxCup * 6, -60, 60), this.getVel().y);
      }
      if (Math.abs(dxCup) < 5 && dyCup > -6 && dyCup < 3 && this.getVel().y > -40) {
        this.sink();
        return;
      }
      if (this.cellAt(cx, cy + 2) === 'W') {
        this.penalty(cx, cy, 'water');
        return;
      }
      // fuera de límites: la bola se ha caído de las islas (solo en hoyos abiertos)
      if (this.L.open && (cy > this.worldH + T || cx < -2 * T || cx > this.worldW + 2 * T)) {
        this.penalty(cx, cy, 'ob');
        return;
      }
      for (const s of this.saws) {
        if (Phaser.Math.Distance.Between(cx, cy, s.x, s.y) < 12) {
          this.penalty(cx, cy, 'saw');
          return;
        }
      }
    }

    if (this.grounded && this.relSpeed < 6 && this.groundNormal.y > 0.97 && !this.respawning) this.restTime += delta;
    else this.restTime = 0;
    // Red de seguridad: si la bola lleva quieta un buen rato aunque no esté en suelo plano
    // (encajada entre una rampa y una pared, por ejemplo), también se puede golpear.
    if (this.relSpeed < 6 && !this.respawning && this.hitStop <= 0) this.stillTime += delta;
    else this.stillTime = 0;

    const canShoot = playing && (this.restTime > 150 || this.stillTime > 900);
    if (canShoot && !this.ready) {
      this.ready = true;
      this.readyTime = this.time.now;
      const b = this.groundBody;
      this.safe = { x: cx, y: cy, body: b, dx: b ? cx - b.position.x : 0 };
    } else if (!canShoot && this.ready && !this.aiming) {
      this.ready = false;
    }
    if (this.ready) this.updateKeyboardAim(delta);
    if (this.aiming) this.chargeFeedback();

    // contador de golpes sobre la bola y anillo de "listo"
    this.counter.setVisible(this.ready || this.aiming).setText(String(this.strokes)).setPosition(cx, cy - 4 - this.ballR);
    this.readyRing.clear();
    if (this.ready && !this.aiming) {
      const t = ((this.time.now - this.readyTime) % 1000) / 1000;
      this.readyRing.lineStyle(1.2, 0xffffff, 0.9 * (1 - t)).strokeCircle(cx, cy, 2 + this.ballR + t * 7);
    }
    if (this.aiming) this.drawAim(cx, cy);

    this.drawHolePointer(playing);

    const t = Phaser.Math.Clamp((this.startPos.y - cy) / (this.startPos.y - (this.cupPos.y - this.ballR)), 0, 1);
    this.bus.emit('progress', t);
  }

  // ---------------------------------------------------------------- Eventos de juego

  freezeBall(on: boolean) {
    this.frozen = on;
    Sleeping.set(this.ball, on);
    if (on) this.setVel(0, 0);
  }

  /**
   * Flecha en el borde de la pantalla que señala el hoyo cuando no se ve
   * (los hoyos anchos no caben enteros en pantalla).
   */
  drawHolePointer(show: boolean) {
    const ptr = (this.holePtr ||= this.buildHolePointer());
    const hide = () => {
      if (ptr.badge.visible) ptr.badge.setVisible(false), ptr.wedge.setVisible(false);
    };
    if (!show || this.aiming) return hide();
    const v = this.cameras.main.worldView;
    const { x: hx } = this.cupPos;
    const hy = this.cupPos.y - 8;
    if (hx > v.x + 4 && hx < v.right - 4 && hy > v.y + 4 && hy < v.bottom - 4) return hide();
    const m = 14;
    const px = Phaser.Math.Clamp(hx, v.x + m, v.right - m);
    const py = Phaser.Math.Clamp(hy, v.y + 46, v.bottom - m); // por debajo del HUD
    const a = Math.atan2(hy - py, hx - px);
    const bob = Math.sin(this.time.now / 180) * 1.5;
    const cx = px + Math.cos(a) * bob;
    const cy = py + Math.sin(a) * bob;
    ptr.wedge.setPosition(cx, cy).setRotation(a).setVisible(true);
    ptr.badge.setPosition(cx, cy).setVisible(true);
  }

  /** Texturas de la flecha del hoyo (se dibujan una vez, a 4× y con filtro suave para que se vean nítidas) */
  buildHolePointer() {
    const K = 4;
    const ink = rgba(this.P.outline, 0.8);
    const wedge = bakeTexture(this, `holeptr-wedge-${this.L.theme}`, 24, 24, (c, k) => {
      c.fillStyle = ink;
      c.beginPath();
      c.moveTo(23 * k, 12 * k);
      c.lineTo((12 + 7 * Math.cos(2.3)) * k, (12 + 7 * Math.sin(2.3)) * k);
      c.lineTo((12 + 7 * Math.cos(-2.3)) * k, (12 + 7 * Math.sin(-2.3)) * k);
      c.closePath();
      c.fill();
    }, { scale: K, linear: true });
    const badge = bakeTexture(this, `holeptr-badge-${this.L.theme}`, 16, 16, (c, k) => {
      const o = this.P.outline;
      c.fillStyle = ink;
      c.beginPath();
      c.arc(8 * k, 8 * k, 7.5 * k, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(8 * k, 8 * k, 6 * k, 0, Math.PI * 2);
      c.fill();
      // banderita dentro del círculo
      c.fillStyle = o;
      c.fillRect(6 * k, 4 * k, 1 * k, 8 * k);
      c.fillStyle = PAL.red;
      c.beginPath();
      c.moveTo(7 * k, 4 * k);
      c.lineTo(12 * k, 6 * k);
      c.lineTo(7 * k, 8 * k);
      c.closePath();
      c.fill();
    }, { scale: K, linear: true });
    return {
      wedge: this.add.image(0, 0, wedge).setScale(1 / K).setDepth(29).setVisible(false),
      badge: this.add.image(0, 0, badge).setScale(1 / K).setDepth(29.1).setVisible(false),
    };
  }

  safePos(): Vec {
    const s = this.safe;
    const b = s.body;
    if (b?.crumble && b.crumble.state !== 'idle') return { ...this.startPos };
    if (b?.mover) return { x: b.position.x + (s.dx ?? 0), y: s.y };
    return { x: s.x, y: s.y };
  }

  /** ¿Se puede usar el freno aéreo ahora mismo? */
  canBrake() {
    return this.brakes > 0 && this.state === 'play' && !this.respawning && !this.grounded && this.relSpeed > 30;
  }

  /** Freno aéreo: corta la velocidad y la bola cae en vertical */
  useBrake() {
    if (!this.canBrake()) return;
    this.brakes--;
    const v = this.getVel();
    this.setVel(0, Math.max(0, v.y) * 0.15);
    const p = this.ball.position;
    this.ringFx(p.x, p.y);
    this.sparks.explode(8, p.x, p.y);
    this.tweens.add({ targets: this.ballSprite, scale: 1.4 * this.ballScale, duration: 80, yoyo: true });
    this.trailPts = [];
    haptic(25);
    sfx.brake();
    this.bus.emit('brake', this.brakes);
  }

  /** Agua, sierra o fuera de límites: +1 golpe y vuelta a la última posición segura */
  penalty(cx: number, cy: number, kind: PenaltyKind) {
    this.respawning = true;
    this.aiming = false;
    this.kbAiming = false;
    this.ready = false;
    haptic(kind === 'saw' ? [40, 30, 60] : 50);
    this.holePtr?.wedge.setVisible(false);
    this.holePtr?.badge.setVisible(false);
    this.aimGfx.clear();
    this.readyRing.clear();
    this.counter.setVisible(false);
    this.freezeBall(true);
    this.trailPts = [];
    this.trailG.clear();

    // Salvavidas: anula la penalización
    const saved = this.shields > 0;
    if (saved) {
      this.shields--;
      this.bus.emit('shield', this.shields);
    }
    const sub = saved ? `Salvavidas usado (quedan ${this.shields})` : '+1 golpe de penalización';

    if (kind === 'ob') {
      this.tweens.add({ targets: this.ballSprite, scale: 0.3 * this.ballScale, alpha: 0, duration: 300 });
      sfx.whoosh();
      this.bus.emit('toast', { title: '¡Fuera de límites!', text: sub, color: saved ? '#b8ec6a' : '#ffd36b', duration: 1600 });
    } else if (kind === 'water') {
      this.splash.explode(14, cx, cy);
      this.tweens.add({ targets: this.ballSprite, y: cy + 6, alpha: 0, duration: 300 });
      sfx.splash();
      this.bus.emit('toast', { title: '¡Al agua!', text: sub, color: saved ? '#b8ec6a' : '#7fe3f5', duration: 1600 });
    } else {
      this.ballSprite.setVisible(false);
      this.hazardFx.explode(16, cx, cy);
      this.shake(200, 0.012);
      this.cameras.main.flash(90, 239, 77, 94);
      sfx.hazard();
      this.bus.emit('toast', { title: '¡Ay!', text: sub, color: saved ? '#b8ec6a' : '#ef4d5e', duration: 1600 });
    }

    if (!saved) this.strokes++;
    this.emitHud();

    this.time.delayedCall(800, () => {
      const p = this.safePos();
      this.resumeFollow(); // tras una penalización, la cámara vuelve con la bola
      Body.setPosition(this.ball, p);
      this.freezeBall(false);
      this.setVel(0, 0);
      this.groundTime = -1000;
      this.restTime = 0;
      this.ballSprite.setPosition(p.x, p.y).setVisible(true).setAlpha(1).setScale(0);
      this.tweens.add({ targets: this.ballSprite, scale: this.ballScale, duration: 250, ease: 'Back.easeOut' });
      this.sparks.explode(6, p.x, p.y);
      this.respawning = false;
    });
  }

  sink() {
    this.state = 'sinking';
    this.aiming = false;
    this.kbAiming = false;
    this.aimGfx.clear();
    this.readyRing.clear();
    this.counter.setVisible(false);
    this.freezeBall(true);
    this.trailPts = [];
    this.trailG.clear();

    const { x, y } = this.cupPos;
    // la bola se asoma al borde, gira y cae dentro de la copa
    this.tweens.add({ targets: this.ballSprite, x, y: y - 3, duration: 90, ease: 'Sine.easeOut' });
    this.tweens.add({
      targets: this.ballSprite, y: y + 3, scale: 0.5 * this.ballScale, angle: 180, delay: 90, duration: 150, ease: 'Quad.easeIn',
      onComplete: () => this.ballSprite.setVisible(false).setAngle(0),
    });
    sfx.hole();
    haptic([20, 40, 30, 40, 50]);
    this.time.delayedCall(200, () => {
      this.confetti.explode(60, x, y - 4);
      this.sparks.explode(14, x, y - 4);
      this.ringFx(x, y, { r: 22, flat: 0.45, color: 0xffd36b, duration: 450 });
      this.time.delayedCall(110, () => this.ringFx(x, y, { r: 34, flat: 0.45, duration: 520 }));
      this.cameras.main.flash(150, 255, 255, 255);
      this.cameras.main.zoomTo(VIEW.Z * 1.15, 600, 'Sine.easeOut');
      this.shake(120, 0.004);
      // la bandera da un salto de alegría
      for (const o of [this.pole, this.flag, this.flagNum]) this.tweens.add({ targets: o, y: o.y - 7, duration: 140, yoyo: true, ease: 'Quad.easeOut', repeat: 1 });
      this.tweens.killTweensOf(this.cupGlow);
      this.tweens.add({ targets: this.cupGlow, alpha: 0.9, scale: 1.4, duration: 200, yoyo: true });
      this.popWord(x, y - 14);
    });

    const par = this.L.par;
    const stars = this.strokes <= par ? 3 : this.strokes <= par + 2 ? 2 : 1;
    const L = this.L;
    const wasComplete = progress.worldCompleted(L.world) >= L.holes;
    const rec = progress.record(L.id, { strokes: this.strokes, stars, par });
    saveScore({ level: L.code, strokes: this.strokes });
    // ¿siguiente hoyo dentro del mismo mundo? Si no, el mundo termina aquí
    const hasNext = LEVELS[this.levelIndex + 1]?.world === L.world;
    const worldJustCompleted = !wasComplete && progress.worldCompleted(L.world) >= L.holes;

    this.time.delayedCall(1100, () => {
      this.state = 'done';
      this.bus.emit('complete', <CompleteInfo>{
        levelIndex: this.levelIndex,
        hole: L.number,
        world: L.world,
        worldName: L.worldName,
        worldJustCompleted,
        worldStars: progress.worldStars(L.world),
        worldStarsMax: L.holes * 3,
        name: this.L.name,
        strokes: this.strokes,
        par,
        stars,
        isBest: rec.isBest,
        coins: rec.coins,
        coinLines: rec.lines,
        tokens: rec.tokens,
        totalCoins: progress.coins,
        hasNext,
      });
    });
  }

  /** Palabra que salta del hoyo: ¡Birdie!, ¡Par!… */
  popWord(x: number, y: number) {
    const d = this.strokes - this.L.par;
    const word = this.strokes === 1 ? '¡Hoyo en uno!' : d <= -2 ? '¡Eagle!' : d === -1 ? '¡Birdie!' : d === 0 ? '¡Par!' : '¡Dentro!';
    // que no quede tapada por el HUD cuando el hoyo está arriba del todo
    y = Math.max(y, this.cameras.main.worldView.y + 70);
    const t = this.add
      .text(x, y, word, {
        fontFamily: FONT, fontSize: `${Math.round(16 * FONT_SCALE)}px`, color: '#ffd36b', stroke: '#35282c', strokeThickness: 4, resolution: VIEW.Z * 1.2,
      })
      .setOrigin(0.5)
      .setDepth(20)
      .setScale(0);
    this.tweens.add({ targets: t, scale: 1, y: y - 10, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, delay: 750, duration: 350 });
  }

  // ---------------------------------------------------------------- API para la UI

  emitHud() {
    this.bus.emit('hud', { strokes: this.strokes });
  }

  getHudState(): HudState {
    const L = this.L;
    return {
      levelIndex: this.levelIndex,
      hole: L.number,
      holes: L.holes,
      worldName: L.worldName,
      name: L.name,
      theme: L.theme,
      par: L.par,
      wind: L.wind,
      heightM: Math.round(((this.L.groundRow - this.L.hole.r) * T) / 4),
      intro: L.intro,
      tutorial: L.tutorial,
      open: L.open,
      brakes: this.brakes,
      shields: this.shields,
    };
  }

  restartLevel() {
    transitionTo(this, () => this.scene.restart({ levelIndex: this.levelIndex }));
  }

  goToLevel(i: number) {
    transitionTo(this, () => this.scene.restart({ levelIndex: i }));
  }

  goToShop() {
    transitionTo(this, () => {
      this.scene.stop('UI');
      this.scene.start('Shop', { back: 'Menu' });
    });
  }

  goToMenu() {
    transitionTo(this, () => {
      this.scene.stop('UI');
      this.scene.start('Menu');
    });
  }

  /** Vuelve a la lista de hoyos de este mundo */
  goToHoles() {
    transitionTo(this, () => {
      this.scene.stop('UI');
      this.scene.start('LevelSelect', { world: this.L.world });
    });
  }
}
