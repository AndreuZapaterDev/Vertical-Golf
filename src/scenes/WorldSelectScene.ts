import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, VIEW, THEMES } from '../constants';
import { WORLDS, type WorldDef } from '../data/worlds';
import { progress } from '../systems/progress';
import { sfx } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, iconButton, panel } from '../ui/widgets';
import LevelSelectScene, { PALETTES, hash2, type RGB } from './LevelSelectScene';

/** Mundo en el que estabas la última vez que se abrió este mapa (en esta sesión): si has avanzado, la bola recorre el camino hasta el nuevo */
let lastWorld = -1;
/** Terreno ya pintado (y sus máscaras) para un mismo estado de desbloqueos: abrir el mapa de nuevo no lo repinta */
let paintedCache: { sig: string; water: Uint8Array; dist: Uint8Array } | null = null;

/**
 * Geometría del mapa: los mundos van apilados de abajo (el primero) a arriba (el último), cada uno en una franja de ZH píxeles,
 * con fronteras onduladas entre ellos. Añadir un mundo a WORLDS alarga el mapa solo.
 */
const ZH = 180;
const NZ = WORLDS.length;
const MAP_H = NZ * ZH + 160;
const BIOME_IDS = WORLDS.map((w) => w.id);
/** frontera k (entre la zona k, de abajo, y la k+1, de arriba) para cada columna x */
const BOUNDS: number[][] = Array.from({ length: Math.max(0, NZ - 1) }, (_, k) =>
  Array.from({ length: W }, (_, x) => MAP_H - 40 - (k + 1) * ZH + 12 * Math.sin(x / 21 + k * 1.7) + 7 * Math.sin(x / 8 + k * 2.3)),
);
const biomeAt = (x: number, y: number) => {
  const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
  for (let k = 0; k < NZ - 1; k++) if (y > BOUNDS[k][xi]) return k;
  return NZ - 1;
};
/** Posición de la parada de cada mundo: en el centro de su franja, alternando izquierda y derecha para que el camino haga eses */
const NODES = WORLDS.map((_, i) => ({
  x: 72 + (i % 2) * 94 + (((i * 37) % 11) - 5),
  y: MAP_H - 40 - i * ZH - ZH / 2,
}));

/** Lagos por mundo (líquido propio: agua, lava, ácido…) */
const LAKES: Record<string, number> = { meadow: 3, beach: 0, swamp: 7, cave: 4, ice: 4, volcano: 5, nuclear: 5, sky: 0, space: 0, deepspace: 0, jungle: 5, temple: 2, sea: 0, industrial: 3, neon: 4, circus: 3, candy: 4, haunted: 3, castle: 2, west: 2 };
/** Elementos altos, bajos y tintes de decoración por mundo */
const TALL: Record<string, string[]> = {
  meadow: ['tree-round', 'tree-pine'], beach: ['palm'], swamp: ['cypress'], cave: ['crystal'], ice: ['pinesnow'],
  volcano: ['rock'], nuclear: ['cooltower'], sky: ['cloud2'], space: ['asteroid'], deepspace: ['asteroid'],
  jungle: ['jungletree'], temple: ['column'], sea: ['coralbig'], industrial: ['chimney'], neon: ['neontower', 'pylon', 'skyscraper'], circus: ['balloon'], candy: ['lollipop', 'candycane'],
  haunted: ['deadtree', 'tombstone'], castle: ['tower', 'tree-pine'], west: ['cactus', 'mesa'],
};
const SMALL: Record<string, string[]> = {
  meadow: ['bush', 'flower0', 'flower1', 'flower2', 'tuft', 'rock'], beach: ['shell', 'starfish', 'dune-tuft', 'rock'], swamp: ['reed', 'glowshroom', 'rock'],
  cave: ['glowshroom', 'rock', 'crystal'], ice: ['rock', 'crystal'], volcano: ['rock'],
  nuclear: ['barrel', 'glowshroom', 'rock'], sky: ['cloud0'], space: ['star-px', 'asteroid'], deepspace: ['star-px', 'asteroid'],
  jungle: ['fern', 'reed', 'glowshroom', 'ruin'], temple: ['rock', 'column', 'dune-tuft'], sea: ['seaweed', 'shell', 'starfish', 'coralbig'],
  industrial: ['crate', 'gear', 'barrel', 'chimney'], neon: ['cube', 'pylon', 'star-px'], circus: ['balloon', 'gumdrop', 'star-px'], candy: ['gumdrop', 'candycane', 'lollipop'],
  haunted: ['tombstone', 'pumpkin', 'ghost', 'rock'], castle: ['banner', 'haybale', 'rock', 'catapult', 'bush'], west: ['tumbleweed', 'rock', 'cactus', 'dune-tuft'],
};
const TINT: Record<string, number> = { volcano: 0xff7a4a, ice: 0xcfe6ff, nuclear: 0xb8ff6a };
/** Colores de los globos y las gominolas (se elige uno al azar) */
const CONFETTI = [0xff5a9a, 0xffd040, 0x40c0ff, 0x60e070, 0xb070ff, 0xff8a3a];

interface MapCloud {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  vx: number;
}

/**
 * Mapa de mundos: un mapa de todos los biomas (Pradera, Playa, Pantano… y los futuros) unidos por un camino, desplazable.
 * Cada mundo es una parada grande con su emblema y su progreso; los que aún no puedes pisar quedan bajo la niebla.
 */
export default class WorldSelectScene extends Phaser.Scene {
  mapY = 0;
  maxY = MAP_H - H;
  layer!: Phaser.GameObjects.Container;
  thumb!: Phaser.GameObjects.Rectangle;
  clouds: MapCloud[] = [];
  dragging = false;
  dragMoved = false;
  dragStartY = 0;
  dragStartMap = 0;
  panTween: Phaser.Tweens.Tween | null = null;

  constructor() {
    super('Worlds');
  }

  create() {
    fitCamera(this);
    this.clouds = [];
    this.dragging = false;
    this.dragMoved = false;
    this.panTween = null;
    this.buildMap();

    // --- interfaz fija
    this.add.rectangle(0, 0, W, 92, 0x141a33, 0.55).setOrigin(0).setDepth(29);
    panel(this, W / 2, 24, 108, 26, 'hud9').setDepth(30);
    label(this, W / 2, 24, 'MUNDOS', 20, { weight: '700', color: PAL.sand, strokeThickness: 4 }).setDepth(31);
    label(this, W / 2, 47, 'ELIGE TU PRÓXIMO CAMPO', 7, { color: '#ffffff', strokeThickness: 2 }).setDepth(31);
    iconButton(this, 16, 24, 'back', () => this.go('Menu')).setDepth(32);
    this.input.keyboard?.on('keydown-ESC', () => this.go('Menu'));
    const playable = WORLDS.filter((w) => w.levels.length > 0 && !w.comingSoon).length;
    const unlockedWorlds = WORLDS.filter((_, i) => progress.isWorldUnlocked(i)).length;
    label(this, W / 2, 74, `${unlockedWorlds}/${playable} MUNDOS DISPONIBLES · ${WORLDS.length - playable} PRÓXIMOS`, 7, { color: PAL.sand, strokeThickness: 2 }).setDepth(31);

    // --- desplazamiento: arrastrar o rueda del ratón
    const Z = VIEW.Z;
    const onDown = (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartY = p.y / Z;
      this.dragStartMap = this.mapY;
    };
    const onMove = (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const dy = p.y / Z - this.dragStartY;
      if (Math.abs(dy) > 4) {
        this.dragMoved = true;
        this.panTween?.stop();
      }
      if (this.dragMoved) this.setMapY(this.dragStartMap - dy);
    };
    const onUp = () => {
      this.dragging = false;
    };
    const onWheel = (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.panTween?.stop();
      this.setMapY(this.mapY + dy * 0.6);
    };
    this.input.on('pointerdown', onDown);
    this.input.on('pointermove', onMove);
    this.input.on('pointerup', onUp);
    this.input.on('pointerupoutside', onUp);
    this.input.on('wheel', onWheel);
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', onDown);
      this.input.off('pointermove', onMove);
      this.input.off('pointerup', onUp);
      this.input.off('pointerupoutside', onUp);
      this.input.off('wheel', onWheel);
    });
  }

  setMapY(y: number) {
    this.mapY = Phaser.Math.Clamp(y, 0, this.maxY);
    this.layer.y = -this.mapY;
    const trackTop = 100;
    const trackH = H - 112;
    const th = Math.max(18, (H / MAP_H) * trackH);
    const t = this.maxY > 0 ? this.mapY / this.maxY : 0;
    this.thumb.setSize(2, th).setPosition(W - 4, trackTop + t * (trackH - th));
  }

  /**
   * Pinta el mapa del mundo en una textura: los biomas con fronteras onduladas y mezcla en el borde, lagos (de agua, lava, ácido…),
   * colinas, dunas o asteroides, y el camino que une todas las paradas. Devuelve las máscaras de agua y de distancia al camino.
   */
  paintWorld(spline: Phaser.Curves.Spline, openAt: (t: number) => boolean, sig: string) {
    if (paintedCache && paintedCache.sig === sig && this.textures.exists('worldmap')) return { key: 'worldmap', water: paintedCache.water, dist: paintedCache.dist };
    const pals = BIOME_IDS.map((id) => PALETTES[id] ?? PALETTES.meadow);
    const key = 'worldmap';
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, W, MAP_H)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(W, MAP_H);
    const d = img.data;
    const N = W * MAP_H;
    const put = (i: number, c: RGB) => {
      const o = i * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    };
    const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < MAP_H;

    // camino y mapa de distancia (hasta 30 px)
    const S = Math.max(1500, NZ * 520);
    const path: { x: number; y: number; t: number }[] = [];
    for (let s = 0; s <= S; s++) {
      const p = spline.getPoint(s / S);
      path.push({ x: p.x, y: p.y, t: s / S });
    }
    const dist = new Uint8Array(N).fill(255);
    const stamp = (cx: number, cy: number, r: number) => {
      const ix = Math.round(cx);
      const iy = Math.round(cy);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = ix + dx;
          const y = iy + dy;
          if (!inb(x, y)) continue;
          const dd = Math.ceil(Math.hypot(dx, dy));
          if (dd > r) continue;
          const i = y * W + x;
          if (dd < dist[i]) dist[i] = dd;
        }
      }
    };
    for (let s = 0; s < path.length; s += 3) stamp(path[s].x, path[s].y, 30);
    for (const n of NODES) stamp(n.x, n.y, 44);

    // lagos de cada mundo
    let seed = 424242;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    interface Lake { cx: number; cy: number; rx: number; ry: number; p1: number; p2: number }
    const lakes: Lake[] = [];
    const free = (l: Lake) => {
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        const x = Math.round(l.cx + Math.cos(a) * l.rx * 1.2);
        const y = Math.round(l.cy + Math.sin(a) * l.ry * 1.2);
        if (inb(x, y) && dist[y * W + x] < 20) return false;
      }
      const cx = Math.round(l.cx);
      const cy = Math.round(l.cy);
      return !(inb(cx, cy) && dist[cy * W + cx] < 26);
    };
    for (let b = 0; b < NZ; b++) {
      const want = LAKES[BIOME_IDS[b]] ?? 3;
      const yMin = b < NZ - 1 ? BOUNDS[b][W >> 1] : 0;
      const yMax = b > 0 ? BOUNDS[b - 1][W >> 1] : MAP_H;
      for (let tries = 0; tries < 400 && lakes.filter((l) => biomeAt(l.cx, l.cy) === b).length < want; tries++) {
        const rx = 14 + rnd() * 18;
        const ry = 10 + rnd() * 14;
        const cx = 16 + rnd() * (W - 32);
        const cy = yMin + 20 + rnd() * Math.max(10, yMax - yMin - 40);
        if (biomeAt(cx, cy) !== b || biomeAt(cx, cy - ry * 1.3) !== b || biomeAt(cx, cy + ry * 1.3) !== b) continue;
        const l: Lake = { cx, cy, rx, ry, p1: rnd() * 6, p2: rnd() * 6 };
        if (free(l) && !lakes.some((o) => Math.hypot(o.cx - l.cx, o.cy - l.cy) < (o.rx + l.rx) * 0.9)) lakes.push(l);
      }
    }
    // el mar de la Playa, a ambos lados
    const beach = BIOME_IDS.indexOf('beach');
    if (beach >= 0) {
      for (const side of [-1, 1]) {
        const xe = side < 0 ? 0 : W - 1;
        for (let y = BOUNDS[beach][xe] + 20; y < BOUNDS[beach - 1][xe] - 10; y += 70 + Math.floor(rnd() * 30)) {
          const l: Lake = { cx: side < 0 ? -22 : W + 22, cy: y, rx: 46 + rnd() * 16, ry: 48 + rnd() * 22, p1: rnd() * 6, p2: rnd() * 6 };
          for (let k = 0; k < 8 && !free(l); k++) l.rx *= 0.85;
          if (free(l)) lakes.push(l);
        }
      }
    }
    const water = new Uint8Array(N);
    for (const l of lakes) {
      const x0 = Math.max(0, Math.floor(l.cx - l.rx * 1.4));
      const x1 = Math.min(W - 1, Math.ceil(l.cx + l.rx * 1.4));
      const y0 = Math.max(0, Math.floor(l.cy - l.ry * 1.4));
      const y1 = Math.min(MAP_H - 1, Math.ceil(l.cy + l.ry * 1.4));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const a = Math.atan2(y - l.cy, x - l.cx);
          const wob = 1 + 0.16 * Math.sin(3 * a + l.p1) + 0.09 * Math.sin(5 * a + l.p2);
          const e = ((x - l.cx) / l.rx) ** 2 + ((y - l.cy) / l.ry) ** 2;
          if (e < wob * wob && dist[y * W + x] >= 14) water[y * W + x] = 1;
        }
      }
    }
    const wat = (x: number, y: number) => inb(x, y) && water[y * W + x] === 1;

    // suelo de cada mundo, con mezcla en las fronteras
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < W; x++) {
        let b = biomeAt(x, y);
        const up = b < NZ - 1 ? Math.abs(y - BOUNDS[b][x]) : 99;
        const down = b > 0 ? Math.abs(y - BOUNDS[b - 1][x]) : 99;
        const dd = Math.min(up, down);
        if (dd < 8 && hash2(x, y, 7) < (1 - dd / 8) * 0.55) b = up < down ? b + 1 : b - 1;
        const P = pals[b];
        const id = BIOME_IDS[b];
        const v = hash2(x, y, 1);
        let c: RGB = P.ground;
        if (hash2(x >> 3, y >> 3, 2) < 0.24) c = P.g2;
        if (id === 'swamp' && hash2(x >> 4, y >> 4, 3) < 0.16) c = P.shore;
        if ((id === 'beach' || id === 'west') && (y + Math.round(Math.sin(x * 0.15) * 2)) % 9 === 0 && v < 0.55) c = P.g3;
        if (id === 'volcano' && hash2(x >> 3, y >> 3, 4) < 0.07) c = P.deep; // grietas de lava
        if (id === 'castle' && (x % 9 === 0 || (y + (Math.floor(x / 9) % 2) * 4) % 8 === 0) && v < 0.8) c = P.g3; // adoquines
        if (id === 'neon' && (x % 12 === 0 || y % 12 === 0)) c = hash2(x, y, 6) < 0.5 ? P.hi : P.shore; // cuadrícula luminosa
        if (id === 'industrial' && (x % 10 === 0 || y % 10 === 0) && v < 0.6) c = P.g3; // placas de metal
        if (id === 'temple' && (x % 12 === 0 || y % 12 === 0) && v < 0.7) c = P.g3; // losas de piedra
        if (id === 'sea' && (y + Math.round(Math.sin(x * 0.2) * 2)) % 8 === 0 && v < 0.5) c = P.g2; // ondas de arena en el fondo
        if ((id === 'candy' || id === 'circus') && v > 0.975) c = [[255, 90, 154], [255, 208, 64], [64, 192, 255], [96, 224, 112]][Math.floor(hash2(x, y, 8) * 4)] as RGB; // confeti y virutas
        if (v < 0.05) c = P.g3;
        else if (v > (id === 'space' || id === 'deepspace' ? 0.955 : 0.986)) c = P.hi;
        put(y * W + x, c);
      }
    }

    // colinas, dunas, nubes redondas o asteroides
    for (let b = 0; b < NZ; b++) {
      const P = pals[b];
      const domes = BIOME_IDS[b] === 'space' || BIOME_IDS[b] === 'deepspace' ? 6 : 4;
      const yMin = b < NZ - 1 ? BOUNDS[b][W >> 1] : 0;
      const yMax = b > 0 ? BOUNDS[b - 1][W >> 1] : MAP_H;
      for (let k = 0, placed = 0; k < 300 && placed < domes; k++) {
        const rx = 14 + rnd() * 14;
        const ry = 8 + rnd() * 8;
        const cx = Math.round(rx + rnd() * (W - rx * 2));
        const cy = Math.round(yMin + 20 + ry + rnd() * Math.max(10, yMax - yMin - 50));
        if (biomeAt(cx, cy) !== b || biomeAt(cx, cy - ry) !== b || biomeAt(cx - rx, cy) !== b || biomeAt(cx + rx, cy) !== b) continue;
        let ok = true;
        for (let a = 0; a < 12 && ok; a++) {
          const x = Math.round(cx + Math.cos((a / 12) * Math.PI * 2) * rx * 1.15);
          const y = Math.round(cy - Math.abs(Math.sin((a / 12) * Math.PI * 2)) * ry * 1.15);
          if (!inb(x, y) || water[y * W + x] || dist[y * W + x] < 16) ok = false;
        }
        if (!ok) continue;
        placed++;
        for (let y = cy - ry; y <= cy + 1; y++) {
          for (let x = cx - rx; x <= cx + rx; x++) {
            if (!inb(x, y)) continue;
            const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (e >= 1) continue;
            put(y * W + x, e > 0.8 ? P.outline : x < cx - rx * 0.2 && y < cy - ry * 0.35 ? P.hillHi : P.hill);
          }
        }
      }
    }

    // líquido: espuma, poca profundidad, fondo y orilla (con los colores del mundo donde está)
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const P = pals[biomeAt(x, y)];
        if (water[i]) {
          let near1 = false;
          let near3 = false;
          for (let dy = -3; dy <= 3 && !near1; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              if (wat(x + dx, y + dy)) continue;
              if (Math.max(Math.abs(dx), Math.abs(dy)) <= 1) {
                near1 = true;
                break;
              }
              near3 = true;
            }
          }
          let c: RGB = near1 ? P.foam : near3 ? P.water2 : P.water;
          if (!near1 && !near3) {
            if (wat(x - 7, y) && wat(x + 7, y) && wat(x, y - 7) && wat(x, y + 7)) c = P.deep;
            if ((x + y * 3) % 13 === 0 && hash2(x, y, 5) < 0.5) c = P.water2;
          }
          put(i, c);
        } else if (wat(x - 1, y) || wat(x + 1, y) || wat(x, y - 1) || wat(x, y + 1) || wat(x - 2, y) || wat(x + 2, y) || wat(x, y - 2) || wat(x, y + 2)) {
          put(i, P.shore);
        }
      }
    }

    // el camino
    const disc = (cx: number, cy: number, r: number, col: RGB) => {
      const ix = Math.round(cx);
      const iy = Math.round(cy);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          const x = ix + dx;
          const y = iy + dy;
          if (inb(x, y)) put(y * W + x, col);
        }
      }
    };
    for (const p of path) disc(p.x, p.y, 8, pals[biomeAt(p.x, p.y)].outline);
    for (const p of path) {
      const P = pals[biomeAt(p.x, p.y)];
      disc(p.x, p.y, 6, openAt(p.t) ? P.pathEdge : P.pathLocked);
    }
    for (const p of path) {
      const P = pals[biomeAt(p.x, p.y)];
      disc(p.x, p.y, 4, openAt(p.t) ? P.pathOpen : ([P.pathLocked[0] + 22, P.pathLocked[1] + 22, P.pathLocked[2] + 22] as RGB));
    }
    path.forEach((p, s) => {
      if (!openAt(p.t)) return;
      if (s % 9 === 0) disc(p.x, p.y, 0, [255, 255, 255]);
    });

    ctx.putImageData(img, 0, 0);
    tex.refresh();
    paintedCache = { sig, water, dist };
    return { key, water, dist };
  }

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  buildMap() {
    const unlocked = WORLDS.map((_, i) => progress.isWorldUnlocked(i));
    const currentW = Math.max(0, unlocked.lastIndexOf(true));
    const travelFrom = lastWorld >= 0 && lastWorld < currentW ? lastWorld : null;
    lastWorld = currentW;

    // hora del día (la de tu reloj), como en el mapa de hoyos (para probar: ?hora=21)
    const qs = new URLSearchParams(window.location.search);
    const hour = qs.has('hora') ? Number(qs.get('hora')) % 24 : new Date().getHours();
    const phase: 'dawn' | 'day' | 'dusk' | 'night' = hour >= 6 && hour < 9 ? 'dawn' : hour >= 9 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';

    // curva suave por todas las paradas, con eses entre ellas
    const ctrl: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(54, MAP_H - 16)];
    NODES.forEach((nd, i) => {
      ctrl.push(new Phaser.Math.Vector2(nd.x, nd.y));
      if (i < NZ - 1) ctrl.push(new Phaser.Math.Vector2((nd.x + NODES[i + 1].x) / 2 + (i % 2 ? -28 : 28), (nd.y + NODES[i + 1].y) / 2));
    });
    const spline = new Phaser.Curves.Spline(ctrl);
    const tNode = NODES.map((_, i) => (1 + 2 * i) / (ctrl.length - 1));
    const openAt = (t: number) => {
      if (t <= tNode[0]) return true;
      for (let i = 1; i < NZ; i++) if (t <= tNode[i]) return unlocked[i];
      return unlocked[NZ - 1];
    };
    const { key, water, dist } = this.paintWorld(spline, openAt, unlocked.map((u) => (u ? '1' : '0')).join(''));

    this.layer = this.add.container(0, 0).setDepth(1);
    this.layer.add(this.add.image(0, 0, key).setOrigin(0));

    // ---------- decoración por mundos, lejos del camino, de las paradas y del agua
    let seed = 777;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    const land = (x: number, y: number, minDist: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 4 || iy < 100 || ix >= W - 4 || iy >= MAP_H - 6) return false;
      const i = iy * W + ix;
      return !water[i] && dist[i] >= minDist && !water[iy * W + Math.max(0, ix - 4)] && !water[iy * W + Math.min(W - 1, ix + 4)];
    };
    const wet = (x: number, y: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 8 || iy < 100 || ix >= W - 8 || iy >= MAP_H - 8) return false;
      return water[iy * W + ix] && water[iy * W + ix - 6] && water[iy * W + ix + 6] && water[(iy - 5) * W + ix] && water[(iy + 5) * W + ix];
    };
    const placed: { x: number; y: number }[] = [];
    const spot = (biome: number, minDist: number, gap: number) => {
      const yMin = biome < NZ - 1 ? BOUNDS[biome][W >> 1] : 100;
      const yMax = biome > 0 ? BOUNDS[biome - 1][W >> 1] : MAP_H - 10;
      for (let t = 0; t < 50; t++) {
        const x = 6 + rnd() * (W - 12);
        const y = Math.max(104, yMin) + 8 + rnd() * Math.max(10, yMax - Math.max(104, yMin) - 16);
        if (biomeAt(x, y) !== biome || biomeAt(x, y - 30) !== biome) continue;
        if (land(x, y, minDist) && !placed.some((o) => Math.hypot(o.x - x, o.y - y) < gap)) {
          placed.push({ x, y });
          return { x, y };
        }
      }
      return null;
    };
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.layer.add(o);
      return o;
    };
    const sway = (o: Phaser.GameObjects.Image, amp: number) =>
      this.tweens.add({ targets: o, angle: { from: -amp, to: amp }, duration: 2400 + rnd() * 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd() * 1800 });

    for (let b = 0; b < NZ; b++) {
      const id = BIOME_IDS[b];
      const tall = TALL[id] ?? TALL.meadow;
      const small = SMALL[id] ?? SMALL.meadow;
      const tint = TINT[id];
      for (let k = 0; k < 14; k++) {
        const p = spot(b, 20, 17);
        if (!p) continue;
        const kind = tall[Math.floor(rnd() * tall.length)];
        const o = add(this.add.image(p.x, p.y, kind).setOrigin(0.5, 1).setDepth(p.y).setFlipX(rnd() < 0.5));
        if (kind === 'skyscraper') o.setScale(0.7 + rnd() * 0.5);
        if (id === 'sky') o.setScale(0.8).setAlpha(0.9);
        if (kind === 'tank' || kind === 'cooltower') o.setScale(0.7);
        if (tint) o.setTint(tint);
        if (kind === 'balloon') o.setTint(CONFETTI[Math.floor(rnd() * CONFETTI.length)]);
        if (['tree-round', 'tree-pine', 'palm', 'cypress', 'pinesnow', 'cactus'].includes(kind)) sway(o, id === 'beach' ? 1.6 : 0.9);
      }
      for (let k = 0; k < 26; k++) {
        const p = spot(b, 13, 9);
        if (!p) continue;
        const kind = small[Math.floor(rnd() * small.length)];
        const o = add(this.add.sprite(p.x, p.y, kind).setOrigin(0.5, 1).setDepth(p.y));
        if (tint) o.setTint(tint);
        if (kind === 'gumdrop' || kind === 'balloon') o.setTint(CONFETTI[Math.floor(rnd() * CONFETTI.length)]);
        if (kind === 'cloud0') o.setScale(0.5).setAlpha(0.85);
        if (kind === 'star-px') {
          o.setOrigin(0.5, 0.5).setScale(1.5);
          this.tweens.add({ targets: o, alpha: 0.2, duration: 700 + rnd() * 1500, yoyo: true, repeat: -1, delay: rnd() * 1500 });
        }
        if (kind === 'ghost') {
          o.setOrigin(0.5, 1).setAlpha(0.85);
          this.tweens.add({ targets: o, y: p.y - 5, alpha: { from: 0.55, to: 0.95 }, duration: 1500 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd() * 1000 });
        } else if (kind === 'tumbleweed') {
          this.tweens.add({ targets: o, x: p.x + 24, angle: 360, duration: 3200 + rnd() * 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd() * 1500 });
        }
        if (kind.startsWith('flower')) o.play({ key: `${kind}-sway`, delay: rnd() * 800 });
        else if (kind === 'tuft') o.play('tuft-sway');
        else if (kind === 'dune-tuft') o.play('dune-tuft-sway');
        else if (kind === 'reed') o.play({ key: 'reed-sway', delay: rnd() * 900 });
        else if (kind === 'glowshroom') {
          const gl = add(this.add.image(p.x, p.y - 5, 'glow').setTint(id === 'nuclear' ? 0xa8ff5a : 0x7fe3c0).setBlendMode('ADD').setScale(0.45).setAlpha(0.4).setDepth(p.y + 0.1));
          this.tweens.add({ targets: gl, alpha: 0.15, duration: 1300 + rnd() * 900, yoyo: true, repeat: -1 });
        }
      }
    }

    // emblema de cada mundo, junto a su parada (en el lado contrario al cartel de información)
    const sideOf = (i: number) => (NODES[i].x > W / 2 ? -1 : 1); // lado del cartel
    const lights: { x: number; y: number }[] = [];
    const pulse = (o: Phaser.GameObjects.Image, a0: number, a1: number, ms: number) =>
      this.tweens.add({ targets: o, alpha: { from: a0, to: a1 }, duration: ms, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    WORLDS.forEach((wd, i) => {
      const e = { x: NODES[i].x - sideOf(i) * 40, y: NODES[i].y + 8 };
      const glow = (tintc: number, sc: number, dy: number, a = 0.4) => {
        const g = add(this.add.image(e.x, e.y + dy, 'glow').setTint(tintc).setBlendMode('ADD').setScale(sc).setAlpha(a).setDepth(e.y + 1));
        pulse(g, a, a * 0.35, 900 + i * 40);
        return g;
      };
      switch (wd.id) {
        case 'meadow': {
          add(this.add.image(e.x, e.y, 'windmill').setOrigin(0.5, 1).setDepth(e.y));
          const bl = add(this.add.image(e.x, e.y - 17, 'blades').setDepth(e.y + 1));
          this.tweens.add({ targets: bl, angle: 360, duration: 5200, repeat: -1 });
          add(this.add.image(e.x + 22, e.y + 4, 'pole').setOrigin(0.5, 1).setDepth(e.y + 2).setScale(0.8));
          add(this.add.sprite(e.x + 23, e.y - 20, 'flag', 0).setOrigin(0, 0).setDepth(e.y + 3).setScale(0.8).play('flag-wave'));
          break;
        }
        case 'beach':
          add(this.add.image(e.x, e.y, 'lighthouse').setOrigin(0.5, 1).setDepth(e.y));
          glow(0xfff1b0, 1.2, -26, 0.5);
          lights.push({ x: e.x, y: e.y - 26 });
          break;
        case 'swamp':
          add(this.add.image(e.x, e.y, 'stilthut').setOrigin(0.5, 1).setDepth(e.y));
          lights.push({ x: e.x, y: e.y - 10 });
          break;
        case 'cave':
          add(this.add.image(e.x, e.y, 'cavearch').setOrigin(0.5, 1).setDepth(e.y));
          glow(0x7ae8e8, 0.7, -6, 0.3);
          break;
        case 'ice':
          add(this.add.image(e.x - 4, e.y, 'icepeak').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 14, e.y + 2, 'pinesnow').setOrigin(0.5, 1).setDepth(e.y + 1));
          break;
        case 'volcano': {
          add(this.add.image(e.x, e.y, 'volcano').setOrigin(0.5, 1).setDepth(e.y));
          glow(0xff8a2a, 1.4, -24, 0.55);
          lights.push({ x: e.x, y: e.y - 24 });
          break;
        }
        case 'nuclear':
          add(this.add.image(e.x, e.y, 'cooltower').setOrigin(0.5, 1).setDepth(e.y));
          glow(0xa8ff5a, 1.3, -18, 0.5);
          lights.push({ x: e.x, y: e.y - 18 });
          break;
        case 'jungle':
          add(this.add.image(e.x, e.y, 'ruin').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 18, e.y + 3, 'jungletree').setOrigin(0.5, 1).setDepth(e.y + 1).setScale(0.9));
          break;
        case 'temple':
          add(this.add.image(e.x, e.y, 'temple').setOrigin(0.5, 1).setDepth(e.y));
          glow(0xffb040, 0.6, -16, 0.5);
          lights.push({ x: e.x - 11, y: e.y - 8 });
          lights.push({ x: e.x + 10, y: e.y - 8 });
          break;
        case 'sea': {
          const sw = add(this.add.image(e.x, e.y, 'shipwreck').setOrigin(0.5, 1).setDepth(e.y));
          this.tweens.add({ targets: sw, angle: { from: -2, to: 2 }, duration: 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          add(this.add.image(e.x + 18, e.y + 2, 'coralbig').setOrigin(0.5, 1).setDepth(e.y + 1));
          break;
        }
        case 'industrial':
          add(this.add.image(e.x, e.y, 'factory').setOrigin(0.5, 1).setDepth(e.y));
          glow(0xff9a3a, 0.8, -22, 0.35);
          lights.push({ x: e.x, y: e.y - 14 });
          break;
        case 'neon': {
          const nt = add(this.add.image(e.x, e.y, 'neontower').setOrigin(0.5, 1).setDepth(e.y));
          void nt;
          glow(0x40f0ff, 1.2, -16, 0.5);
          add(this.add.image(e.x + 16, e.y + 2, 'cube').setOrigin(0.5, 1).setDepth(e.y + 1));
          add(this.add.image(e.x - 14, e.y + 1, 'skyscraper').setOrigin(0.5, 1).setDepth(e.y + 1).setTint(0x8a7ad0));
          lights.push({ x: e.x, y: e.y - 14 });
          break;
        }
        case 'circus': {
          add(this.add.image(e.x - 12, e.y, 'bigtop').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 20, e.y + 2, 'ferrisbase').setOrigin(0.5, 1).setDepth(e.y + 1));
          const wheel = add(this.add.image(e.x + 20, e.y - 14, 'ferris').setDepth(e.y + 2));
          this.tweens.add({ targets: wheel, angle: 360, duration: 9000, repeat: -1 });
          lights.push({ x: e.x - 12, y: e.y - 10 });
          break;
        }
        case 'candy':
          add(this.add.image(e.x, e.y, 'candycastle').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 18, e.y + 3, 'lollipop').setOrigin(0.5, 1).setDepth(e.y + 1));
          break;
        case 'haunted': {
          add(this.add.image(e.x, e.y, 'mansion').setOrigin(0.5, 1).setDepth(e.y));
          const gh = add(this.add.image(e.x + 18, e.y - 6, 'ghost').setOrigin(0.5, 1).setDepth(e.y + 2).setAlpha(0.85));
          this.tweens.add({ targets: gh, y: e.y - 11, alpha: { from: 0.55, to: 0.95 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          add(this.add.image(e.x - 17, e.y + 2, 'tombstone').setOrigin(0.5, 1).setDepth(e.y + 1));
          lights.push({ x: e.x - 6, y: e.y - 12 });
          lights.push({ x: e.x + 6, y: e.y - 12 });
          break;
        }
        case 'west':
          add(this.add.image(e.x - 2, e.y, 'saloon').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 22, e.y + 2, 'mesa').setOrigin(0.5, 1).setDepth(e.y - 1).setScale(0.8));
          add(this.add.image(e.x - 20, e.y + 3, 'cactus').setOrigin(0.5, 1).setDepth(e.y + 1));
          lights.push({ x: e.x - 2, y: e.y - 9 });
          break;
        case 'castle': {
          add(this.add.image(e.x, e.y, 'castle').setOrigin(0.5, 1).setDepth(e.y));
          add(this.add.image(e.x + 24, e.y + 3, 'catapult').setOrigin(0.5, 1).setDepth(e.y + 1));
          add(this.add.image(e.x - 22, e.y + 3, 'banner').setOrigin(0.5, 1).setDepth(e.y + 1));
          lights.push({ x: e.x - 10, y: e.y - 14 });
          lights.push({ x: e.x + 10, y: e.y - 14 });
          break;
        }
        case 'sky':
          add(this.add.image(e.x, e.y - 6, 'cloud1').setOrigin(0.5, 1).setDepth(e.y).setScale(1.5).setAlpha(0.95));
          add(this.add.image(e.x + 6, e.y - 22, 'pole').setOrigin(0.5, 1).setDepth(e.y + 1).setScale(0.7));
          add(this.add.sprite(e.x + 7, e.y - 40, 'flag', 0).setOrigin(0, 0).setDepth(e.y + 2).setScale(0.7).play('flag-wave'));
          break;
        case 'space': {
          const r = add(this.add.image(e.x, e.y, 'rocket').setOrigin(0.5, 1).setDepth(e.y));
          this.tweens.add({ targets: r, y: e.y - 2, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          glow(0xffb84a, 0.5, 2, 0.5);
          break;
        }
        case 'deepspace': {
          const pl = add(this.add.image(e.x, e.y - 8, 'planet').setOrigin(0.5, 0.5).setDepth(e.y));
          this.tweens.add({ targets: pl, y: e.y - 11, angle: { from: -6, to: 6 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          glow(0xb48ae0, 1.3, -8, 0.35);
          break;
        }
      }
    });
    // construcciones y animalitos sueltos de los tres primeros mundos
    for (const [b, houses, critter] of [[0, 'cabin', 'sheep'], [1, 'beachhut', 'crab'], [2, 'stilthut', 'frog']] as const) {
      for (let k = 0; k < 2; k++) {
        const p = spot(b, 24, 46);
        if (!p) continue;
        add(this.add.image(p.x, p.y, houses).setOrigin(0.5, 1).setDepth(p.y));
        lights.push({ x: p.x, y: p.y - 8 });
      }
      for (let k = 0; k < 3; k++) {
        const p = spot(b, 18, 36);
        if (!p) continue;
        if (critter === 'crab') {
          const cr = add(this.add.sprite(p.x, p.y, 'crab', 0).setOrigin(0.5, 1).setDepth(p.y).play('crab-walk'));
          this.tweens.add({ targets: cr, x: p.x + 28, duration: 2600 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onYoyo: () => cr.setFlipX(true), onRepeat: () => cr.setFlipX(false) });
        } else if (critter === 'frog') {
          const fr = add(this.add.sprite(p.x, p.y, 'frog', 0).setOrigin(0.5, 1).setDepth(p.y));
          let dir = 1;
          const hop = () => {
            if (!fr.active) return;
            if (fr.x > p.x + 20) dir = -1;
            if (fr.x < p.x - 20) dir = 1;
            fr.setFrame(1).setFlipX(dir < 0);
            this.tweens.add({ targets: fr, y: p.y - 7, duration: 170, yoyo: true, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: fr, x: fr.x + dir * 11, duration: 340, onComplete: () => { fr.setFrame(0); this.time.delayedCall(700 + Math.random() * 1500, hop); } });
          };
          this.time.delayedCall(400 + rnd() * 1500, hop);
        } else {
          const sh = add(this.add.image(p.x, p.y, 'sheep').setOrigin(0.5, 1).setDepth(p.y));
          this.tweens.add({ targets: sh, x: p.x + 22, duration: 3400 + rnd() * 1500, yoyo: true, repeat: -1, hold: 900, repeatDelay: 900, ease: 'Sine.easeInOut', onYoyo: () => sh.setFlipX(true), onRepeat: () => sh.setFlipX(false) });
        }
      }
    }
    // sobre el agua: veleros en la Pradera y la Playa, nenúfares en el Pantano; destellos en todos
    for (let k = 0, tries = 0; tries < 1200 && k < 90; tries++) {
      const x = 8 + rnd() * (W - 16);
      const y = 110 + rnd() * (MAP_H - 140);
      if (!wet(x, y)) continue;
      const id = BIOME_IDS[biomeAt(x, y)];
      k++;
      if (id === 'swamp') {
        const lp = add(this.add.image(x, y, 'lilypad').setDepth(y));
        this.tweens.add({ targets: lp, y: y + 1, duration: 1600 + rnd() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else if ((id === 'meadow' || id === 'beach') && rnd() < 0.45) {
        const bt = add(this.add.image(x, y, 'sailboat').setOrigin(0.5, 0.85).setDepth(y));
        this.tweens.add({ targets: bt, y: y + 2, angle: { from: -3, to: 3 }, duration: 1800 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: bt, x: x + 8 + rnd() * 10, duration: 5000 + rnd() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        const sp = add(this.add.image(x, y, 'wave').setDepth(y).setAlpha(0));
        if (id === 'volcano') sp.setTint(0xffe070);
        else if (id === 'nuclear') sp.setTint(0xe0ffa0);
        this.tweens.add({ targets: sp, alpha: 0.9, duration: 600, yoyo: true, repeat: -1, repeatDelay: 700 + rnd() * 1800, delay: rnd() * 2200 });
      }
    }

    // nubes con sombra (sin ellas en el espacio)
    const spaceStart = Math.min(...['space', 'deepspace'].map((s) => BIOME_IDS.indexOf(s)).filter((v) => v >= 0).concat([NZ]));
    const cloudCeiling = spaceStart < NZ ? BOUNDS[spaceStart - 1][W >> 1] : 0;
    const nClouds = 6 + Math.floor(Math.random() * 6);
    for (let k = 0; k < nClouds; k++) {
      const cx = rnd() * W;
      const cy = Math.max(cloudCeiling + 10, 120 + rnd() * (MAP_H - 200));
      const shadow = add(this.add.image(cx + 16, cy + 26, `cloud${k % 3}`).setTint(0x000000).setAlpha(0.13).setDepth(7).setScale(1.1));
      const img = add(this.add.image(cx, cy, `cloud${k % 3}`).setAlpha(0.7).setDepth(1500).setScale(1.1));
      this.clouds.push({ img, shadow, vx: 2.5 + rnd() * 3.5 });
    }

    // niebla sobre los mundos que aún no puedes pisar
    const firstLocked = unlocked.findIndex((u) => !u);
    if (firstLocked >= 0) {
      const veilKey = 'worldveil';
      if (!this.textures.exists(veilKey)) {
        const vt = this.textures.createCanvas(veilKey, 4, 64)!;
        const vc = vt.getContext();
        const g = vc.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, 'rgba(20,26,51,0.8)');
        g.addColorStop(1, 'rgba(20,26,51,0)');
        vc.fillStyle = g;
        vc.fillRect(0, 0, 4, 64);
        vt.refresh();
        vt.setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      const bottom = NODES[firstLocked].y + 60;
      add(this.add.image(0, 0, veilKey).setOrigin(0).setDisplaySize(W, bottom).setDepth(1600).setAlpha(0.6));
    }

    // ---------- paradas de los mundos: medalla grande + cartel con el progreso
    WORLDS.forEach((wd: WorldDef, i) => {
      const { x, y } = NODES[i];
      const playable = unlocked[i] && wd.levels.length > 0;
      const holes = wd.levels.length;
      const done = progress.worldCompleted(wd.id);
      const full = playable && holes > 0 && done >= holes;
      const c = this.add.container(x, y).setDepth(2000 + y);
      c.add(this.add.image(0, 16, 'bshadow').setScale(3.4, 2).setAlpha(0.35));
      const medalColor = !playable ? 'gray' : full ? 'done' : wd.button;
      const body = this.add.image(0, 0, this.medalTexture(medalColor, 22));
      c.add(body);
      c.add(label(this, 0, -1, `${i + 1}`, 20, { weight: '700', strokeThickness: 4, color: playable ? '#ffffff' : '#c8bfb4' }));
      if (!playable) c.add(this.add.image(15, 15, 'lock').setScale(0.9));

      // cartel con el nombre y el progreso, al lado de la parada
      const side = sideOf(i);
      const px = side * 78;
      const info = this.add.container(px, 0);
      info.add(panel(this, 0, 0, 108, 44, 'hud9'));
      info.add(label(this, 0, -12, wd.name, wd.name.length > 11 ? 9 : 11, { weight: '700', color: playable ? '#ffffff' : '#c8bfb4', strokeThickness: 3 }));
      if (playable) {
        const ratio = holes ? done / holes : 0;
        const bar = this.add.graphics();
        bar.fillStyle(0x1a1020, 0.9).fillRoundedRect(-44, 2, 88, 3, 1);
        if (ratio > 0) bar.fillStyle(0xb8ec6a).fillRoundedRect(-44, 2, 88 * ratio, 3, 1);
        info.add(bar);
        info.add(this.add.image(-34, 13, 'star-sm'));
        info.add(label(this, -27, 13, `${progress.worldStars(wd.id)}/${holes * 3}`, 8, { ox: 0, weight: '700' }));
        info.add(label(this, 47, 13, `${done}/${holes}`, 7, { ox: 1, color: '#f0dcc0', strokeThickness: 2 }));
      } else {
        const msg = wd.comingSoon || !wd.levels.length ? 'PRÓXIMAMENTE' : `Completa ${WORLDS[i - 1].name}`;
        info.add(label(this, 0, 6, msg, 7, { color: PAL.sand, strokeThickness: 2 }));
        info.add(label(this, 0, 16, wd.tagline, 5, { color: '#f0dcc0', strokeThickness: 1, wrap: 100 }));
      }
      c.add(info);

      if (playable) {
        c.setSize(44, 44).setInteractive({ useHandCursor: true });
        const hit = this.add.rectangle(px, 0, 108, 44, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
        c.add(hit);
        const open = () => {
          if (this.dragMoved) return;
          sfx.click();
          this.go('LevelSelect', { world: wd.id });
        };
        for (const o of [c, hit]) {
          o.on('pointerover', () => this.tweens.add({ targets: body, scale: 1.1, duration: 90 }));
          o.on('pointerout', () => this.tweens.add({ targets: body, scale: 1, duration: 90 }));
          o.on('pointerdown', () => sfx.unlock());
          o.on('pointerup', open);
        }
      }
      this.layer.add(c);
      c.setAlpha(0).setScale(0.6);
      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 300, delay: 300 + Math.min(i, 6) * 120, ease: 'Back.easeOut' });
    });

    // ---------- la bola: bota en el mundo actual o recorre el camino hasta él si acabas de abrir uno nuevo
    const cur = NODES[currentW];
    const startNode = travelFrom !== null ? NODES[travelFrom] : cur;
    const ring = this.add.image(startNode.x, startNode.y, this.medalTexture('done', 28)).setDepth(1999 + cur.y).setAlpha(0);
    const bshadow = this.add.image(startNode.x, startNode.y - 18, 'bshadow').setDepth(2500 + cur.y).setAlpha(0.5);
    const ball = this.add.sprite(startNode.x, startNode.y - 36, `ball-${progress.skin}`, 0).setDepth(2501 + cur.y);
    this.layer.add([ring, bshadow, ball]);
    const bounceAt = (x: number, y: number) => {
      this.tweens.killTweensOf([ring, bshadow, ball]);
      ring.setPosition(x, y).setScale(1);
      ball.setPosition(x, y - 36);
      bshadow.setPosition(x, y - 18).setScale(1).setAlpha(0.5);
      this.tweens.add({ targets: ring, alpha: { from: 0.55, to: 0 }, scale: { from: 0.9, to: 1.35 }, duration: 1100, repeat: -1, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: ball, y: y - 50, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: bshadow, scaleX: 0.7, alpha: 0.25, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeOut' });
    };
    bounceAt(startNode.x, startNode.y);
    const panDur = (y: number) => Math.min(1400, 400 + Math.abs(this.maxY - Phaser.Math.Clamp(y - H * 0.55, 0, this.maxY)) * 1.3);
    if (travelFrom !== null) {
      const tA = tNode[travelFrom];
      const tB = tNode[currentW];
      this.time.delayedCall(250 + panDur(startNode.y) + 500, () => {
        if (!ball.active) return;
        this.tweens.killTweensOf([ring, bshadow, ball]);
        ring.setAlpha(0);
        let lastHop = -1;
        sfx.whoosh();
        this.tweens.addCounter({
          from: 0, to: 1, duration: 2600, ease: 'Sine.easeInOut',
          onUpdate: (tw) => {
            const u = tw.getValue() ?? 0;
            const base = spline.getPoint(tA + (tB - tA) * u);
            const ph = u * 14;
            const hopH = Math.sin((ph - Math.floor(ph)) * Math.PI) * 16;
            ball.setPosition(base.x, base.y - 14 - hopH);
            bshadow.setPosition(base.x, base.y - 2).setScale(1 - hopH / 40).setAlpha(0.5);
            if (Math.floor(ph) !== lastHop) {
              lastHop = Math.floor(ph);
              sfx.land(110, 'grass');
              ball.setFrame(Math.floor(Math.random() * 4));
            }
            this.setMapY(base.y - H * 0.55);
          },
          onComplete: () => {
            sfx.star(2);
            bounceAt(cur.x, cur.y);
          },
        });
      });
    }

    // ---------- ordenar, barra lateral y entrada: el mapa sube desde la Pradera hasta el mundo actual
    this.layer.sort('depth');
    this.add.rectangle(W - 4, 100 + (H - 112) / 2, 2, H - 112, 0x141a33, 0.45).setDepth(31);
    this.thumb = this.add.rectangle(W - 4, 120, 2, 30, 0xf0dcc0, 0.9).setDepth(32);
    this.setMapY(this.maxY);
    const target = Phaser.Math.Clamp(startNode.y - H * 0.55, 0, this.maxY);
    this.panTween = this.tweens.addCounter({
      from: this.maxY, to: target, duration: Math.min(1400, 400 + Math.abs(this.maxY - target) * 1.3), delay: 250, ease: 'Sine.easeInOut',
      onUpdate: (tw) => this.setMapY(tw.getValue() ?? this.maxY),
    }) as unknown as Phaser.Tweens.Tween;

    // ---------- luz del día y ambiente
    const TINTS = { dawn: 0xffcdbd, dusk: 0xffae78, night: 0x5460a6 } as const;
    if (phase !== 'day') this.add.rectangle(0, 0, W, H, TINTS[phase], 1).setOrigin(0).setDepth(24).setBlendMode(Phaser.BlendModes.MULTIPLY);
    if (phase === 'dusk' || phase === 'night') {
      const glowAt = (x: number, y: number, sc: number) => {
        const g = this.add.image(x, y, 'glow').setTint(0xffd070).setBlendMode('ADD').setScale(sc).setAlpha(0.5).setDepth(1990);
        this.layer.add(g);
        this.tweens.add({ targets: g, alpha: 0.25, duration: 700 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 600 });
      };
      for (const p of NODES) glowAt(p.x, p.y, 1.3);
      for (const l of lights) glowAt(l.x, l.y, 0.8);
    }
    const kind = THEMES.meadow.ambient || 'leaf';
    this.add.particles(0, 0, phase === 'night' ? 'glow' : kind, phase === 'night'
      ? { x: { min: 0, max: W }, y: { min: 100, max: H }, lifespan: 4000, speedX: { min: -6, max: 6 }, speedY: { min: -8, max: 3 }, scale: { min: 0.06, max: 0.12 }, tint: 0xd8ff8a, blendMode: 'ADD', frequency: 380 }
      : { x: { min: -10, max: W }, y: 90, lifespan: 9000, speedX: { min: 4, max: 14 }, speedY: { min: 10, max: 22 }, rotate: { start: 0, end: 360 }, frequency: 1500, alpha: 0.9 }).setDepth(25);
    const phaseName = { dawn: 'AMANECER', day: 'DÍA', dusk: 'ATARDECER', night: 'NOCHE' }[phase];
    label(this, 6, H - 8, phaseName, 6, { ox: 0, color: '#f0dcc0', strokeThickness: 2 }).setDepth(31);

    // pájaros que cruzan el mapa de vez en cuando
    this.time.addEvent({
      delay: 6500, loop: true, callback: () => {
        const y = this.mapY + 110 + Math.random() * (H - 150);
        if (BOUNDS.length && spaceStart < NZ && y < BOUNDS[spaceStart - 1][W >> 1]) return; // no hay pájaros en el espacio
        const dir = Math.random() < 0.5 ? 1 : -1;
        const cnt = 2 + Math.floor(Math.random() * 3);
        for (let b = 0; b < cnt; b++) {
          const bird = this.add.sprite(dir > 0 ? -12 - b * 10 : W + 12 + b * 10, y + (b % 2) * 7 + b * 2, 'bird', 0).setTint(0x35282c).setAlpha(0.7).setDepth(1700).setFlipX(dir < 0);
          bird.play({ key: 'bird-flap', delay: b * 90 });
          this.layer.add(bird);
          bird.y = y + (b % 2) * 7 + b * 2;
          this.tweens.add({ targets: bird, x: dir > 0 ? W + 30 : -30, y: bird.y - 14, duration: 9000, onComplete: () => bird.destroy() });
        }
      },
    });
  }

  /** Textura de una medalla redonda (contorno, brillo arriba a la izquierda y sombra abajo a la derecha) */
  medalTexture(color: string, r: number) {
    const key = `medal-${color}-${r}`;
    if (this.textures.exists(key)) return key;
    const [base, hi, dark] = LevelSelectScene.NODE_COLORS[color] ?? LevelSelectScene.NODE_COLORS.green;
    const size = r * 2 + 2;
    const tex = this.textures.createCanvas(key, size, size)!;
    const c = tex.getContext();
    c.imageSmoothingEnabled = false;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - size / 2;
        const dy = y + 0.5 - size / 2;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const ring = d > r - 3 && d <= r - 2; // aro interior
        c.fillStyle = d > r - 2 ? '#35282c' : ring ? hi : dx + dy < -r * 0.7 && d < r - 5 ? hi : dx + dy > r * 0.55 ? dark : base;
        c.fillRect(x, y, 1, 1);
      }
    }
    tex.refresh();
    return key;
  }

  update(_: number, delta: number) {
    const dt = delta / 1000;
    for (const c of this.clouds) {
      c.img.x += c.vx * dt;
      if (c.img.x - c.img.width / 2 > W + 20) c.img.x = -c.img.width / 2 - 20;
      c.shadow.x = c.img.x + 16;
    }
  }
}
