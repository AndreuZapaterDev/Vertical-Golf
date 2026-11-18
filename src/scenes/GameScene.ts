import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import {
  W, H, VIEW, TILE, GRAVITY, MAX_SPEED, MAX_DRAG, FOLLOW_OFFSET, BALL_R, STEP, MATERIALS, THEMES, PAL, hex, FONT, FONT_SCALE,
  type MaterialKey, type Theme, type ThemeKey,
} from '../constants';
import { LEVELS, parseLevel, windAt, fogAt, type ParsedLevel, type MechanicKey } from '../data/levels';
import { renderTerrain, renderBlock, cellSolid } from '../gfx/terrain';
import { terrainRects, terrainRamps, thinSolidFor, TIDE_PERIOD, TIDE_LOW, TIDE_PHASE_STEP, CRUMBLE_DELAY, CRUMBLE_RESTORE, bumperSpeed } from '../data/terrainShapes';
import { tintFill } from '../gfx/tint';
import { bakeTexture, rgba, mixHex } from '../gfx/bake';
import { sfx, music, haptic } from '../systems/audio';
import { applyLook } from '../ui/looks';
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
  tide?: Tide;
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

/** Banco de arena de marea: sale a la vista (sólido) y se hunde (agua) en un ciclo fijo */
interface Tide {
  body: GameBody;
  sand: Phaser.GameObjects.TileSprite;
  water: Phaser.GameObjects.TileSprite;
  x: number;
  y: number;
  w: number;
  /** desfase del ciclo (ms) */
  phase: number;
  high: boolean;
}

/** aviso antes de que suba la marea (el banco parpadea) */
const TIDE_WARN = 2000;

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
type SkyObject = (Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite) & { f: number; baseY: number; baseX: number; tile?: boolean; drift?: number };
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

type PenaltyKind = 'water' | 'saw' | 'ob' | 'sink';
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
/** Cuánto se aleja la cámara con la máxima potencia (1/3 → zoom ×0,67, es decir, se ve 1,5 veces más mapa). Con 0 se desactiva */
const AIM_ZOOM_OUT = 1 / 3;
/** Límites del zoom con la rueda del ratón (relativo al zoom normal) */
const WHEEL_ZOOM_MIN = 0.5;
const WHEEL_ZOOM_MAX = 1.8;

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
  /** última vez que la bola tocó una pared o un techo (no un suelo) */
  wallTime = -1000;
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
  skyGrad!: Phaser.GameObjects.Image;
  /** brillos que se deslizan por la superficie del agua */
  waterFx: Phaser.GameObjects.TileSprite[] = [];
  bgTile!: Phaser.GameObjects.TileSprite;
  vignette!: Phaser.GameObjects.Image;
  /** mar que rodea las islas en los hoyos abiertos de la Playa (y fango en el Pantano) */
  sea: Phaser.GameObjects.TileSprite | null = null;
  /** velo de niebla del Pantano (se centra en la bola) y su densidad actual */
  fog: Phaser.GameObjects.Image | null = null;
  fogDensity = 0;
  /** ms que lleva la bola quieta sobre arena movediza */
  sinkTime = 0;
  /** viento que sopla ahora mismo a la altura de la bola (cambia al cruzar una banda de viento) */
  curWind = 0;
  /** zoom relativo (1 = normal; menos = más lejos) que se ajusta con la potencia del golpe al apuntar */
  zoomK = 1;
  camOff: Vec = { x: 0, y: FOLLOW_OFFSET };
  sky: SkyObject[] = [];
  clouds: Cloud[] = [];
  ground: MatterBody | null = null;
  movers: Mover[] = [];
  crumbles: Crumble[] = [];
  tides: Tide[] = [];
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
  onWheel!: (p: Phaser.Input.Pointer, over: unknown, dx: number, dy: number) => void;
  /** zoom que elige el jugador con la rueda del ratón (1 = normal); vuelve a 1 al disparar */
  wheelZoom = 1;
  offLook: (() => void) | null = null;
  lastZoomTick = 0;
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
    this.wallTime = -1000;
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
    this.zoomK = 1;
    this.wheelZoom = 1;
    this.curWind = windAt(L, this.L.start.r * T + T);
    sfx.wind(this.curWind);
    sfx.sea(L.theme === 'beach');
    if (L.theme === 'swamp') this.time.addEvent({ delay: 2600, loop: true, callback: () => { const r = Math.random(); if (r < 0.5) sfx.croak(); else if (r < 0.8) sfx.bubble(); } });
    // niebla (Pantano): un velo con un claro redondo que sigue a la bola
    this.fog = null;
    this.fogDensity = 0;
    if (L.fogBands.length) this.fog = this.add.image(0, 0, 'fog').setScrollFactor(0).setDepth(20).setAlpha(0).setDisplaySize(960, 960);
    this.sinkTime = 0;
    // En los hoyos abiertos la cámara deja ver un poco de vacío alrededor (se nota que son islas)
    const side = L.open ? 3 * T : 0;
    const bw = Math.max(this.worldW + side * 2, W);
    cam.setBounds((this.worldW - bw) / 2, 0, bw, this.worldH + (L.open ? 4 * T : 0));
    cam.setBackgroundColor(this.P.bgA);
    // estilo de imagen elegido en los ajustes (y se actualiza al cambiarlo desde la pausa)
    applyLook(cam);
    this.offLook = progress.onSettingsChange((key) => {
      if (key === 'look') applyLook(this.cameras.main);
    });

    // Fondo de cuadros fijo a la pantalla que se desplaza más lento que el terreno (parallax).
    // Con zoom Z, un objeto con scrollFactor 0 en (W·(Z−1)/2, H·(Z−1)/2) cubre exactamente la vista.
    const z = VIEW.Z;
    this.bgTile = this.add
      .tileSprite((W * (z - 1)) / 2, (H * (z - 1)) / 2, W, H, `checker-${L.theme}`)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(-10);
    this.bgTile.setAlpha(0.7); // damero más sutil: el cielo se lee como cielo, no como un tablero
    // degradado de altura: cielo más profundo arriba (su opacidad sube con la altura de la cámara, ver updateSky)
    const night = this.P.sky === 'night';
    const deep = mixHex(this.P.bgA, night ? '#0a0e2a' : this.P.sky === 'sunset' ? '#7a4a8a' : '#2a56b8', night ? 0.6 : 0.7);
    this.skyGrad = this.add
      .image((W * (z - 1)) / 2, (H * (z - 1)) / 2, bakeTexture(this, `skygrad-${L.theme}`, 1, 64, (c) => {
        const gr = c.createLinearGradient(0, 0, 0, 64);
        gr.addColorStop(0, rgba(deep, 1));
        gr.addColorStop(0.55, rgba(deep, 0.35));
        gr.addColorStop(1, rgba(deep, 0));
        c.fillStyle = gr;
        c.fillRect(0, 0, 1, 64);
      }, { linear: true }))
      .setOrigin(0)
      .setDisplaySize(W, H)
      .setScrollFactor(0)
      .setDepth(-9.95)
      .setAlpha(0.3);
    // viñeta suave: oscurece las esquinas y centra la mirada en la acción
    this.vignette = this.add
      .image((W * (z - 1)) / 2, (H * (z - 1)) / 2, bakeTexture(this, 'vignette', 64, 112, (c) => {
        const gr = c.createRadialGradient(32, 56, 14, 32, 56, 78);
        gr.addColorStop(0, 'rgba(10,18,40,0)');
        gr.addColorStop(0.6, 'rgba(10,18,40,0.07)');
        gr.addColorStop(1, 'rgba(10,18,40,0.26)');
        c.fillStyle = gr;
        c.fillRect(0, 0, 64, 112);
      }, { linear: true }))
      .setOrigin(0)
      .setDisplaySize(W, H)
      .setScrollFactor(0)
      .setDepth(40);
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
    // Playa: las islas flotan sobre el mar (caer por un borde es caer al agua)
    this.sea = null;
    if ((L.theme === 'beach' || L.theme === 'swamp') && L.open) {
      const swampy = L.theme === 'swamp';
      this.sea = this.add.tileSprite(-320, this.worldH - 9, this.worldW + 640, 40, swampy ? 'bog' : 'sea').setOrigin(0).setDepth(4.5);
      this.add.rectangle(-320, this.worldH + 31, this.worldW + 640, 120, swampy ? 0x1f4a30 : 0x1a8eab).setOrigin(0).setDepth(4.5);
      this.tweens.add({ targets: this.sea, y: this.sea.y + 2.5, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
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
      this.offLook?.();
      sfx.wind(0);
      sfx.sea(false);
      this.matter.world?.off('collisionstart', this.onCollStart);
      this.matter.world?.off('collisionactive', this.onCollActive);
      // el siguiente hoyo empieza con listas limpias (la escena se reutiliza)
      this.sky = [];
      this.waterFx = [];
      this.clouds = [];
      this.movers = [];
      this.crumbles = [];
      this.tides = [];
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
      const hills = this.add.tileSprite(0, 0, W * 2 + 8, 500, `hills-${th}-${layer}`).setOrigin(0, 80 / 500).setDepth(-9.6 + layer * 0.2);
      add(hills, y, f).tile = true;
    }

    this.buildIslets(add, span);
    this.buildWisps(add, span);

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

  /**
   * Jirones de nube en primer plano: cruzan por delante de las islas, más rápido que el mundo (parallax > 1),
   * muy transparentes para no estorbar. Dan profundidad y sensación de altura.
   */
  buildWisps(add: (o: Phaser.GameObjects.Image, screenY: number, f: number) => SkyObject, span: number) {
    if (this.P.sky === 'night') return;
    const tint = this.P.cloudTint ?? 0xffffff;
    const keys = [0, 1, 2].map((v) =>
      bakeTexture(this, `wisp-${v}`, 180, 44, (c) => {
        // nube blanda: varias elipses con degradado radial
        let seed = 91 + v * 17;
        const r = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
        for (let k = 0; k < 7; k++) {
          const cx = 28 + k * 21 + r() * 8;
          const cy = 22 + (r() - 0.5) * 12;
          const rx = 24 + r() * 14;
          const ry = 8 + r() * 6;
          c.save();
          c.translate(cx, cy);
          c.scale(1, ry / rx);
          const gr = c.createRadialGradient(0, 0, 0, 0, 0, rx);
          gr.addColorStop(0, 'rgba(255,255,255,0.55)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          c.fillStyle = gr;
          c.beginPath();
          c.arc(0, 0, rx, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
      }, { linear: true }),
    );
    let seed = 777 + this.levelIndex * 13;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const f = 1.25;
    const lo = -span * f - 40;
    for (let sy = lo + rnd() * 120; sy < H - 160; sy += 520 + rnd() * 340) {
      const img = this.add.image(Phaser.Math.Between(-60, W), 0, keys[Math.floor(rnd() * 3)]).setOrigin(0, 0).setTint(tint)
        .setAlpha(0.2 + rnd() * 0.12).setScale(1.2 + rnd() * 0.9).setDepth(8);
      const o = add(img, sy, f);
      o.drift = (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 4); // px/s
    }
  }

  /**
   * Islotes flotantes lejanos con parallax: dan sensación de altura. Se pintan con los colores del mundo
   * mezclados con el del cielo (perspectiva atmosférica), más difuminados cuanto más lejos.
   */
  buildIslets(add: (o: Phaser.GameObjects.Image, screenY: number, f: number) => SkyObject, span: number) {
    const P = this.P;
    const th = this.L.theme;
    const rnd = (() => {
      let a = 1234 + this.levelIndex * 77;
      return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
    })();
    // 3 formas de islote: [ancho, alto del cuerpo]
    const shapes: [number, number][] = [[34, 15], [22, 11], [46, 18]];
    const keys = shapes.map(([w, h], v) =>
      bakeTexture(this, `islet2-${th}-${v}`, w, h + 4, (c) => {
        const haze = P.bgA;
        const mix = (col: string) => mixHex(col, haze, 0.55); // neblina: se leen como fondo lejano, no como plataformas
        const grass = mix(P.grass), grassHi = mix(P.grassHi), grassDark = mix(P.grassDark);
        const dirt = mix(P.dirt), stripe = mix(P.stripe), line = mix(P.outline);
        const y0 = 4; // fila de la hierba (encima caben los matorrales)
        const inside = (x: number, y: number) => {
          if (y < y0 || y >= y0 + h) return false;
          const t = (y - y0) / (h - 1);
          const inset = Math.round((w / 2 - 3) * Math.pow(t, 1.7));
          return x >= inset && x < w - inset;
        };
        for (let y = y0; y < y0 + h; y++) {
          for (let x = 0; x < w; x++) {
            if (!inside(x, y)) continue;
            const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y + 1) || y === y0;
            const d = y - y0;
            c.fillStyle = edge ? line : d === 1 ? grassHi : d <= 3 ? grass : d === 4 ? grassDark : (x + y * 2) % 7 === 0 ? stripe : dirt;
            c.fillRect(x, y, 1, 1);
          }
        }
        // matorrales sobre la hierba
        let seed = v * 31 + 7;
        const r = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
        for (let k = 0; k < Math.max(1, Math.floor(w / 14)); k++) {
          const bx = 4 + Math.floor(r() * (w - 11));
          c.fillStyle = grassDark;
          c.fillRect(bx, y0 - 2, 5, 2);
          c.fillStyle = grass;
          c.fillRect(bx + 1, y0 - 3, 3, 1);
          c.fillRect(bx + 1, y0 - 2, 2, 1);
        }
      }),
    );
    for (const [f, alpha, n] of [[0.18, 0.38, 1], [0.34, 0.52, 1]] as const) {
      const lo = -span * f - 30;
      const hi = H - 130;
      for (let sy = lo + rnd() * 60; sy < hi; sy += 150 + rnd() * 120) {
        const v = Math.floor(rnd() * shapes.length);
        const x = Phaser.Math.Between(-10, W - 20) + rnd() * 20;
        const img = this.add.image(x, 0, keys[v]).setOrigin(0, 0).setAlpha(alpha).setDepth(-9.7).setScale(n);
        add(img, sy, f);
      }
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

  /** Aplica el zoom relativo y reajusta las capas fijas a la pantalla (fondo, degradado y viñeta) para que sigan cubriendo la vista */
  applyZoom() {
    const cam = this.cameras.main;
    const z = VIEW.Z * this.zoomK;
    if (Math.abs(cam.zoom - z) < 0.0005) return;
    cam.setZoom(z);
    // la vista mide W·Z/z de ancho; centrada en la pantalla, empieza en (W·Z/2)·(1 − 1/z)
    const k = VIEW.Z / z;
    const w = W * k;
    const h = H * k;
    const x0 = (W * VIEW.Z * (1 - 1 / z)) / 2 * 1;
    const y0 = (H * VIEW.Z * (1 - 1 / z)) / 2 * 1;
    this.bgTile.setPosition(x0, y0).setSize(w, h);
    this.skyGrad.setPosition(x0, y0).setDisplaySize(w, h);
    this.vignette.setPosition(x0, y0).setDisplaySize(w, h);
  }

  updateSky() {
    const { x: vx, y: vy } = this.cameras.main.worldView;
    const span = Math.max(1, this.worldH - H);
    this.skyGrad.setAlpha(0.3 + 0.5 * Phaser.Math.Clamp(1 - vy / span, 0, 1));
    const dt = this.game.loop.delta / 1000;
    for (const o of this.sky) {
      if (o.drift) {
        o.baseX += o.drift * dt;
        const wrap = W + 260;
        if (o.baseX > wrap) o.baseX -= wrap + 260;
        else if (o.baseX < -260) o.baseX += wrap + 260;
      }
      o.y = o.baseY + vy * (1 - o.f);
      if (o.tile && o instanceof Phaser.GameObjects.TileSprite) {
        o.x = vx - W / 2 - 4;
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
    const beach = this.P.decor === 'beach';
    const swamp = this.P.decor === 'swamp';
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
            this.sway(this.add.image(c * T + 6, y + 1, pine ? 'tree-pine' : 'tree-round').setOrigin(0.5, 1).setDepth(4).setFlipX(h(r, c, 7) < 0.5), 0.9);
          } else if (p < 0.2) this.add.image(x, y, 'bush').setOrigin(0.5, 1).setDepth(6);
          else if (p < 0.27 && run >= 3 && free(r - 1, c - 1)) this.add.tileSprite(c * T - 6, y + 1, 18, 8, 'fence').setOrigin(0, 1).setDepth(4);
          else if (p < 0.42) {
            const k = Math.floor(h(r, c, 4) * 3);
            this.add.sprite(x, y, `flower${k}`).setOrigin(0.5, 1).setDepth(6).play({ key: `flower${k}-sway`, delay: h(r, c, 5) * 800 });
          } else if (p < 0.6) this.add.sprite(x, y, 'tuft').setOrigin(0.5, 1).setDepth(6).play({ key: 'tuft-sway', startFrame: Math.floor(h(r, c, 3) * 2) });
          continue;
        }
        if (swamp) {
          // Pantano: cipreses con musgo, juncos, setas luminosas y alguna piedra
          const room = free(r - 1, c) && free(r - 2, c) && free(r - 3, c);
          if (p < 0.1 && room && c - lastTree > 3 && Math.abs(c - this.L.start.c) > 2) {
            lastTree = c;
            this.sway(this.add.image(c * T + 6, y + 1, 'cypress').setOrigin(0.5, 1).setDepth(4).setFlipX(h(r, c, 7) < 0.5), 0.7);
          } else if (p < 0.24) this.add.sprite(x, y, 'reed').setOrigin(0.5, 1).setDepth(6).play({ key: 'reed-sway', startFrame: Math.floor(h(r, c, 3) * 2), delay: h(r, c, 5) * 900 });
          else if (p < 0.31) {
            this.add.image(x, y, 'glowshroom').setOrigin(0.5, 1).setDepth(6);
            const gl = this.add.image(x, y - 5, 'glow').setTint(0x7fe3c0).setBlendMode('ADD').setScale(0.4).setAlpha(0.45).setDepth(6);
            this.tweens.add({ targets: gl, alpha: 0.18, duration: 1200 + h(r, c, 6) * 900, yoyo: true, repeat: -1, delay: h(r, c, 8) * 800 });
          } else if (p < 0.35) this.add.image(x, y, 'rock').setOrigin(0.5, 1).setDepth(6);
          continue;
        }
        if (beach) {
          // Playa: palmeras detrás del terreno, matas de duna, conchas, estrellas de mar y piedras
          const room = free(r - 1, c) && free(r - 2, c) && free(r - 3, c);
          if (p < 0.1 && room && c - lastTree > 3 && Math.abs(c - this.L.start.c) > 2) {
            lastTree = c;
            this.sway(this.add.image(c * T + 6, y + 1, 'palm').setOrigin(0.5, 1).setDepth(4).setFlipX(h(r, c, 7) < 0.5), 1.6);
          } else if (p < 0.2) this.add.image(x, y, h(r, c, 6) < 0.5 ? 'shell' : 'starfish').setOrigin(0.5, 1).setDepth(6);
          else if (p < 0.38) this.add.sprite(x, y, 'dune-tuft').setOrigin(0.5, 1).setDepth(6).play({ key: 'dune-tuft-sway', startFrame: Math.floor(h(r, c, 3) * 2) });
          else if (p < 0.43) this.add.image(x, y, 'rock').setOrigin(0.5, 1).setDepth(6);
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
    // destellos que se deslizan por la superficie del agua (una tira por charca)
    this.waterFx = [];
    const fx = bakeTexture(this, `waterfx-${this.L.theme}`, 24, 3, (c) => {
      const hi = mixHex(this.P.waterHi, '#ffffff', 0.6);
      c.fillStyle = rgba(hi, 0.95);
      c.fillRect(2, 0, 6, 1);
      c.fillRect(15, 0, 4, 1);
      c.fillStyle = rgba(hi, 0.55);
      c.fillRect(4, 1, 2, 1);
      c.fillRect(16, 1, 2, 1);
      c.fillRect(10, 2, 3, 1);
    });
    for (let r = 1; r < g.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 'W' || g[r - 1][c] === 'W') continue;
        let n = 1;
        while (g[r][c + n] === 'W') n++;
        this.waterFx.push(this.add.tileSprite(c * T, r * T + 1, n * T, 3, fx).setOrigin(0).setDepth(6.2).setAlpha(0.85));
        c += n - 1;
      }
    }
    // ondas que brillan en la superficie del agua
    for (let r = 1; r < g.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 'W' || g[r - 1][c] === 'W' || h(r, c, 7) > 0.6) continue;
        const x = c * T + 3 + Math.floor(h(r, c, 8) * 5);
        if (swamp && h(r, c, 12) < 0.7) {
          const lp = this.add.image(c * T + 6, r * T + 2, 'lilypad').setDepth(6.3);
          this.tweens.add({ targets: lp, y: lp.y + 1, duration: 1500 + h(r, c, 13) * 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: h(r, c, 14) * 1000 });
        }
        const wv = this.add.image(x, r * T + 4, 'wave').setDepth(6).setAlpha(0);
        this.tweens.add({ targets: wv, alpha: 0.8, x: x + 2, duration: 700, yoyo: true, repeat: -1, repeatDelay: 600 + h(r, c, 9) * 1600, delay: h(r, c, 10) * 2000 });
      }
    }
  }

  /** Balanceo suave y lento de un árbol o una palmera (apoyado en su base) */
  sway(o: Phaser.GameObjects.Image, amp: number) {
    this.tweens.add({
      targets: o, angle: { from: -amp, to: amp }, duration: 2400 + Math.random() * 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 1800,
    });
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
      const sprite = this.add.image(x, y, renderBlock(this, `mover-${L.theme}-${w}`, w, 9, L.theme, L.theme === 'beach' || L.theme === 'swamp' ? 'wood' : 'grass')).setOrigin(0).setDepth(6);
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
      // Pantano: nenúfares que se hunden (un parche por casilla); Playa: tablas de muelle; resto: bloques con grietas
      const key = L.theme === 'swamp'
        ? bakeTexture(this, `lily-${w}`, w, T, (c) => {
            const src = this.textures.get('lilyblock').getSourceImage() as CanvasImageSource;
            for (let i = 0; i < w / T; i++) c.drawImage(src, i * T, 0);
          })
        : renderBlock(this, `crumble-${L.theme}-${w}`, w, T, L.theme, L.theme === 'beach' ? 'wood' : 'crumble');
      const sprite = this.add.image(x, y, key).setOrigin(0).setDepth(6);
      const c: Crumble = { body, sprite, x, y, w, state: 'idle' };
      body.crumble = c;
      return c;
    });
    this.tides = L.tides.map((td, i) => {
      const w = td.n * T;
      const x = td.c * T;
      const y = td.r * T;
      const body = this.staticBody(x, y, w, T, 'sand');
      const sand = this.add.tileSprite(x, y, w, T, 'sandbar').setOrigin(0).setDepth(6);
      // el agua que cubre el banco (la casilla y la de debajo) cuando sube la marea
      const water = this.add.tileSprite(x, y, w, T * 2, 'sea').setOrigin(0).setDepth(6.1).setAlpha(0);
      const t: Tide = { body, sand, water, x, y, w, phase: (i * TIDE_PHASE_STEP) % TIDE_PERIOD, high: false };
      body.tide = t;
      return t;
    });
    for (const m of L.mushrooms) {
      const x = m.c * T;
      const y = (m.r + 1) * T - 6;
      const body = this.staticBody(x, y, T, 6, 'mushroom');
      // origen abajo-centro: así se aplasta contra el suelo al botar
      body.sprite = this.add.image(x + T / 2, y + 6, L.theme === 'beach' ? 'float' : L.theme === 'swamp' ? 'glowcap' : 'mushroom').setOrigin(0.5, 1).setDepth(6);
      // respira despacio (al botar sobre ella, el bote lo sustituye)
      this.tweens.add({ targets: body.sprite, scaleY: 0.93, scaleX: 1.05, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 600 });
    }
    this.bumpers = L.bumpers.map((b) => {
      const x = b.c * T + T / 2;
      const y = b.r * T + T / 2;
      const body: GameBody = this.matter.add.circle(x, y, 7.5, { isStatic: true, restitution: 0.9, friction: 0, label: 'bumper' });
      body.mat = 'bounds';
      const bk = L.theme === 'beach' ? 'coral' : L.theme === 'swamp' ? 'spore' : 'bumper';
      body.sprite = this.add.image(x, y, bk).setDepth(7).setData('base', bk);
      // halo que late para que se vea que "están vivos"
      const halo = this.add.image(x, y, 'glow').setTint(L.theme === 'beach' ? 0xff9ab0 : L.theme === 'swamp' ? 0xc8a0ff : 0xffd36b).setBlendMode('ADD').setScale(0.5).setAlpha(0.25).setDepth(6.9);
      this.tweens.add({ targets: halo, alpha: 0.05, scale: 0.8, duration: 900 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 500 });
      return body;
    });
    this.saws = L.saws.map((s) => {
      const x = s.c * T + T / 2;
      const y = s.r * T + T / 2;
      // En la Playa las sierras son cangrejos que pasean por la isla (mismo castigo al tocarlos)
      const crab = L.theme === 'beach';
      const frog = L.theme === 'swamp'; // en el Pantano son ranas que saltan de un lado a otro
      const sp = crab
        ? this.add.sprite(x, y + 2, 'crab', 0).setDepth(7).play('crab-walk')
        : frog
          ? this.add.sprite(x, y + 1, 'frog', 0).setDepth(7)
          : this.add.sprite(x, y, 'saw', 0).setDepth(7).play('saw-spin');
      if (frog) {
        if (s.range) this.frogHop(sp, x - s.range, x + s.range);
        return sp;
      }
      if (s.range) {
        if (!crab) this.add.image(x - s.range, y, bakeTexture(this, `sawrail-${L.theme}-${s.range}`, s.range * 2 + 2, 1, (c) => {
          c.fillStyle = rgba(this.P.outline, 0.4);
          for (let rx = 0; rx <= s.range * 2; rx += 3) c.fillRect(rx, 0, 2, 1);
        })).setOrigin(0).setDepth(4);
        sp.x = x - s.range;
        this.tweens.add({
          targets: sp, x: x + s.range, duration: 1800, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
          onYoyo: () => crab && sp.setFlipX(true),
          onRepeat: () => crab && sp.setFlipX(false),
        });
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
    // onda dorada que sale del hoyo de vez en cuando, para localizarlo de lejos
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.ringFx(x, y - 1, { r: 11, flat: 0.35, color: 0xffd36b, duration: 800 }) });
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
      mud: { light: 0xb08a5c, bits: [hex('#7a6248'), hex('#4c3a2a'), hex('#3a2c20')], n: 1.6 },
      quicksand: { light: 0xe6d99c, bits: [hex('#e6d99c'), hex('#b8a468'), hex('#8e7e48')], n: 1.6 },
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
      this.wheelZoom = 1; // al empezar a cargar el golpe, el zoom de la rueda vuelve al normal
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
    // rueda del ratón: zoom in / zoom out para mirar el mapa antes de golpear (al empezar a cargar el golpe vuelve al zoom normal)
    this.onWheel = (_p, _over, _dx, dy) => {
      if (this.state !== 'play' || this.aiming) return; // mientras se carga el golpe, el zoom no se toca
      const before = this.wheelZoom;
      this.wheelZoom = Phaser.Math.Clamp(this.wheelZoom * Math.exp(-dy * 0.0015), WHEEL_ZOOM_MIN, WHEEL_ZOOM_MAX);
      const now = this.time.now;
      if (this.wheelZoom !== before && now - this.lastZoomTick > 90) {
        this.lastZoomTick = now;
        sfx.zoomTick(this.wheelZoom);
      }
    };
    this.input.on('wheel', this.onWheel);
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
    this.input.off('wheel', this.onWheel);
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
    this.wheelZoom = 1; // igual que con el ratón: al empezar a apuntar vuelve el zoom normal
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
      } else {
        this.wallTime = this.simTime;
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
    else sfx.land(impact * 2.5, mat);
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
    const bs = bumperSpeed(this.L.theme);
    this.bumpVel = { x: d.x * bs, y: d.y * bs }; // se aplica tras el paso de física
    const spr = bumper.sprite;
    if (spr) {
      const base = (spr.getData('base') as string) || 'bumper';
      spr.setTexture(`${base}-lit`);
      this.time.delayedCall(140, () => spr.setTexture(base));
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

    // marea: el banco es sólido mientras está a la vista y deja de serlo cuando sube el agua
    for (const t of this.tides) {
      t.high = this.tideHigh(t, this.simTime);
      t.body.collisionFilter.mask = t.high ? 0 : 0xffffffff;
    }

    // plataformas finas: solo sólidas si la bola está por encima
    for (const b of this.thins) b.collisionFilter.mask = thinSolidFor(this.ball.position.y, this.ballR, b.bounds.min.y) ? 0xffffffff : 0;

    this.prevVel = this.getVel();
    this.matter.world.step(ms);

    this.grounded = this.simTime - this.groundTime < 30;
    // En el aire la bola no conserva giro: si llegara girando al suelo en sentido contrario, la fricción de Matter la empujaría hacia atrás
    // al aterrizar. En el suelo el giro se deja (así rueda con naturalidad).
    // Contra una pared tampoco se anula: una bola que no puede girar se frota contra la pared y la fricción de Matter la deja colgada.
    const touchingWall = this.simTime - this.wallTime < 30;
    if (!this.grounded && !touchingWall) Body.setAngularVelocity(this.ball, 0);
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
      vx += windAt(this.L, this.ball.position.y) * (this.ballType.wind ?? 1) * dt;
      // gravedad propia del tipo (Matter ya aplica la normal: se suma solo la diferencia)
      vy += GRAVITY * ((this.ballType.gravity ?? 1) - 1) * dt;
    }
    this.setVel(vx, vy);
  }

  /** ¿Está alta la marea en este banco en el instante `ms` (reloj de la física)? */
  tideHigh(t: Tide, ms: number) {
    return (ms + t.phase) % TIDE_PERIOD >= TIDE_LOW;
  }

  /** Dibuja los bancos de arena: salen a la vista, parpadean antes de hundirse y quedan cubiertos por el agua */
  updateTides() {
    for (const t of this.tides) {
      const phaseMs = (this.simTime + t.phase) % TIDE_PERIOD;
      const toHigh = TIDE_LOW - phaseMs; // ms hasta que sube la marea (negativo si ya está alta)
      const warn = toHigh > 0 && toHigh < TIDE_WARN;
      t.sand.setVisible(!t.high);
      t.sand.setAlpha(warn ? (Math.floor(toHigh / 170) % 2 ? 0.45 : 1) : 1);
      const target = t.high ? 0.9 : warn ? 0.35 * (1 - toHigh / TIDE_WARN) : 0;
      t.water.setAlpha(t.water.alpha + (target - t.water.alpha) * 0.2);
      t.water.tilePositionX = this.time.now * 0.012;
    }
  }

  /** La rana salta de un extremo a otro de su recorrido, haciendo pausas */
  frogHop(sp: Phaser.GameObjects.Sprite, xa: number, xb: number) {
    sp.x = xa;
    let dir = 1;
    const hop = () => {
      if (!sp.active) return;
      const to = Phaser.Math.Clamp(sp.x + dir * 22, xa, xb);
      sp.setFrame(1).setFlipX(dir < 0);
      this.tweens.add({ targets: sp, y: sp.y - 9, duration: 190, yoyo: true, ease: 'Quad.easeOut' });
      this.tweens.add({
        targets: sp, x: to, duration: 380, ease: 'Sine.easeInOut',
        onComplete: () => {
          sp.setFrame(0);
          if (to <= xa || to >= xb) dir = -dir;
          this.time.delayedCall(Phaser.Math.Between(600, 1300), hop);
        },
      });
    };
    this.time.delayedCall(Phaser.Math.Between(200, 1100), hop);
  }

  /** El cangrejo que te ha pellizcado muere: se aplasta, suelta unos trocitos y desaparece (hasta que reinicies el hoyo) */
  killEnemy(sp: Phaser.GameObjects.Sprite) {
    this.saws = this.saws.filter((s) => s !== sp);
    this.tweens.killTweensOf(sp);
    sp.stop();
    if (sp.texture.key === 'saw') {
      // sierra: se parte con un estallido de chispas y se desvanece girando
      sfx.bumper();
      this.sparks.explode(14, sp.x, sp.y);
      this.tweens.add({ targets: sp, scale: 1.7, angle: 100, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => sp.destroy() });
      return;
    }
    // cangrejo o rana: se aplasta, suelta unos trocitos de su color y desaparece
    sfx.squash();
    this.sparks.explode(7, sp.x, sp.y);
    this.dust.particleTint = sp.texture.key === 'frog' ? 0x5fc04a : 0xff6a4a;
    this.dust.explode(8, sp.x, sp.y + 3);
    this.tweens.add({
      targets: sp, scaleY: 0.25, scaleX: 1.35, y: sp.y + 3, duration: 130, ease: 'Quad.easeOut',
      onComplete: () => this.tweens.add({ targets: sp, alpha: 0, duration: 450, delay: 150, onComplete: () => sp.destroy() }),
    });
  }

  startCrumble(cr: Crumble) {
    cr.state = 'shaking';
    sfx.crack();
    const shake = this.tweens.add({ targets: cr.sprite, x: cr.x + 1, duration: 40, yoyo: true, repeat: -1 });
    this.time.delayedCall(CRUMBLE_DELAY, () => {
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
      this.time.delayedCall(CRUMBLE_RESTORE, restore);
    });
  }

  shoot(v: Phaser.Math.Vector2) {
    this.resumeFollow();
    const mat = this.currentMat();
    const power = shotPower(v.length());
    this.wheelZoom = 1; // al disparar, el zoom vuelve al normal
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
      vx += windAt(this.L, y) * (this.ballType.wind ?? 1) * st;
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
      && this.movers.length === 0 && this.crumbles.length === 0 && this.tides.length === 0;
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
    for (const fx of this.waterFx) fx.tilePositionX = this.time.now * 0.007;
    if (this.sea) this.sea.tilePositionX = this.time.now * 0.006;
    if (this.fog) {
      const cam = this.cameras.main;
      const z = cam.zoom;
      const mx = cam.width / 2;
      const my = cam.height / 2;
      const bp = this.ball.position;
      this.fogDensity += (fogAt(this.L, bp.y) - this.fogDensity) * 0.04;
      this.fog.setAlpha(this.fogDensity).setVisible(this.fogDensity > 0.01);
      // en coordenadas de un objeto fijo a la pantalla: el centro del claro sigue a la bola
      this.fog.setPosition(((bp.x - cam.worldView.x) * z - mx) / z + mx, ((bp.y - cam.worldView.y) * z - my) / z + my);
    }
    this.updateTides();

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

      // el viento puede cambiar con la altura: se avisa al HUD cuando la bola cruza a otra banda
      const w = windAt(this.L, this.ball.position.y);
      if (w !== this.curWind) {
        this.curWind = w;
        this.bus.emit('wind', w);
        sfx.wind(w);
        if (w) sfx.windShift(Math.sign(w));
      }

      // zoom out según la potencia al apuntar: cuanto más fuerte el golpe, más mapa se ve. Al disparar vuelve al zoom normal
      let zt = 1;
      if (this.aiming && this.aimVec.length() > 6) zt = 1 - AIM_ZOOM_OUT * shotPower(this.aimVec.length());
      zt *= this.wheelZoom;
      // El zoom se asienta siempre en un valor entero (píxeles perfectos): con zoom fraccionario el pixel art sale irregular y los textos, borrosos
      zt = Math.max(1, Math.round(VIEW.Z * zt)) / VIEW.Z;
      const rate = zt < this.zoomK ? 0.14 : 0.09; // se aleja rápido y vuelve con soltura
      this.zoomK += (zt - this.zoomK) * Math.min(1, rate * (delta / 16.7));
      if (Math.abs(this.zoomK - zt) < 0.004) this.zoomK = zt; // al llegar, se asienta exacto (zoom entero = píxeles nítidos)
      this.applyZoom();
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
      // arena movediza: si la bola se queda quieta encima, se hunde (+1 golpe)
      if (this.grounded && this.groundBody?.mat === 'quicksand' && this.relSpeed < 40) {
        this.sinkTime += delta;
        if (this.sinkTime > 700 && Math.random() < 0.08) {
          this.dust.particleTint = 0xe6d99c;
          this.dust.explode(2, cx, cy + this.ballR);
          sfx.bubble();
        }
        if (this.sinkTime > 1700) {
          this.sinkTime = 0;
          this.penalty(cx, cy, 'sink');
          return;
        }
      } else this.sinkTime = 0;
      // marea alta: si la bola está sobre un banco hundido, cae al agua
      if (this.tides.some((t) => t.high && cx > t.x - 1 && cx < t.x + t.w + 1 && cy > t.y - this.ballR - 4 && cy < t.y + T * 2)) {
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
          this.killEnemy(s); // todo enemigo (cangrejo, rana, sierra) pega una vez y desaparece
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
      // (un banco de marea no es un sitio seguro: si cae al agua, vuelve a la última isla firme)
      if (!b?.tide && b?.mat !== 'quicksand') this.safe = { x: cx, y: cy, body: b, dx: b ? cx - b.position.x : 0 };
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
      sfx.fall();
      this.bus.emit('toast', { title: '¡Fuera de límites!', text: sub, color: saved ? '#b8ec6a' : '#ffd36b', duration: 1600 });
    } else if (kind === 'sink') {
      // arena movediza: la bola se hunde despacio
      this.dust.particleTint = 0xb8a468;
      this.dust.explode(14, cx, cy + this.ballR);
      this.tweens.add({ targets: this.ballSprite, y: cy + 5, alpha: 0, duration: 450 });
      sfx.sink();
      this.bus.emit('toast', { title: '¡Te hundes!', text: sub, color: saved ? '#b8ec6a' : '#e6d99c', duration: 1600 });
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
      if (this.L.theme === 'beach') sfx.pinch();
      else sfx.hazard();
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
      wind: windAt(L, this.ball.position.y),
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
