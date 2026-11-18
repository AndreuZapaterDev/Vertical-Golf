import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, TILE, THEMES, VIEW } from '../constants';
import { renderTerrain } from '../gfx/terrain';
import { LEVELS, parseLevel } from '../data/levels';
import { WORLDS, worldById, type WorldDef } from '../data/worlds';
import { progress } from '../systems/progress';
import { sfx, music } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, iconButton, panel } from '../ui/widgets';

export type RGB = [number, number, number];
export interface MapPalette {
  ground: RGB; g2: RGB; g3: RGB; hi: RGB;
  water: RGB; water2: RGB; deep: RGB; foam: RGB; shore: RGB;
  hill: RGB; hillHi: RGB; outline: RGB;
  pathOpen: RGB; pathEdge: RGB; pathLocked: RGB;
}

/** Colores del terreno del mapa de cada mundo */
export const PALETTES: Record<string, MapPalette> = {
  meadow: {
    ground: [126, 217, 87], g2: [108, 201, 79], g3: [85, 184, 74], hi: [180, 242, 130],
    water: [79, 166, 230], water2: [120, 192, 239], deep: [56, 130, 200], foam: [225, 246, 252], shore: [196, 160, 104],
    hill: [140, 226, 100], hillHi: [190, 246, 140], outline: [47, 94, 53],
    pathOpen: [240, 220, 192], pathEdge: [196, 160, 118], pathLocked: [150, 146, 160],
  },
  beach: {
    ground: [238, 216, 162], g2: [228, 200, 142], g3: [214, 184, 120], hi: [250, 238, 204],
    water: [47, 203, 221], water2: [111, 226, 238], deep: [26, 142, 171], foam: [240, 252, 255], shore: [214, 184, 120],
    hill: [246, 226, 176], hillHi: [255, 244, 208], outline: [140, 108, 72],
    pathOpen: [200, 168, 112], pathEdge: [160, 128, 80], pathLocked: [176, 164, 140],
  },
  swamp: {
    ground: [72, 112, 58], g2: [60, 98, 50], g3: [44, 76, 40], hi: [110, 150, 80],
    water: [63, 122, 85], water2: [95, 160, 112], deep: [36, 84, 58], foam: [150, 200, 120], shore: [90, 70, 50],
    hill: [88, 120, 64], hillHi: [120, 160, 84], outline: [23, 33, 26],
    pathOpen: [150, 120, 86], pathEdge: [100, 76, 52], pathLocked: [90, 98, 86],
  },
  cave: {
    ground: [92, 92, 108], g2: [78, 78, 94], g3: [58, 58, 74], hi: [130, 150, 170],
    water: [42, 106, 138], water2: [70, 150, 180], deep: [24, 66, 92], foam: [150, 210, 230], shore: [60, 60, 76],
    hill: [110, 110, 128], hillHi: [150, 150, 170], outline: [15, 18, 24],
    pathOpen: [170, 150, 120], pathEdge: [110, 96, 76], pathLocked: [80, 80, 92],
  },
  ice: {
    ground: [228, 242, 255], g2: [208, 230, 250], g3: [184, 214, 240], hi: [255, 255, 255],
    water: [127, 208, 240], water2: [176, 230, 250], deep: [86, 160, 210], foam: [255, 255, 255], shore: [190, 220, 240],
    hill: [214, 234, 252], hillHi: [255, 255, 255], outline: [60, 100, 140],
    pathOpen: [255, 250, 240], pathEdge: [180, 200, 220], pathLocked: [140, 160, 180],
  },
  volcano: {
    ground: [74, 58, 58], g2: [62, 46, 46], g3: [44, 32, 32], hi: [140, 96, 80],
    water: [255, 122, 42], water2: [255, 190, 90], deep: [190, 50, 20], foam: [255, 230, 140], shore: [40, 24, 24],
    hill: [92, 70, 66], hillHi: [130, 100, 90], outline: [18, 8, 8],
    pathOpen: [170, 130, 100], pathEdge: [100, 70, 56], pathLocked: [70, 56, 56],
  },
  nuclear: {
    ground: [70, 86, 52], g2: [58, 74, 42], g3: [42, 56, 30], hi: [170, 230, 80],
    water: [138, 255, 58], water2: [200, 255, 140], deep: [70, 190, 30], foam: [240, 255, 200], shore: [70, 70, 50],
    hill: [86, 104, 62], hillHi: [130, 160, 80], outline: [14, 20, 10],
    pathOpen: [170, 170, 130], pathEdge: [110, 110, 80], pathLocked: [80, 88, 72],
  },
  sky: {
    ground: [214, 232, 255], g2: [198, 220, 250], g3: [176, 204, 244], hi: [255, 255, 255],
    water: [106, 176, 240], water2: [160, 210, 250], deep: [70, 140, 220], foam: [255, 255, 255], shore: [190, 214, 244],
    hill: [236, 244, 255], hillHi: [255, 255, 255], outline: [90, 130, 190],
    pathOpen: [255, 248, 220], pathEdge: [190, 200, 230], pathLocked: [150, 170, 205],
  },
  space: {
    ground: [16, 20, 48], g2: [12, 16, 40], g3: [8, 10, 28], hi: [210, 220, 255],
    water: [42, 74, 154], water2: [90, 120, 210], deep: [20, 36, 96], foam: [170, 190, 250], shore: [24, 28, 60],
    hill: [70, 70, 96], hillHi: [120, 120, 150], outline: [5, 7, 15],
    pathOpen: [180, 200, 255], pathEdge: [100, 120, 200], pathLocked: [60, 70, 110],
  },
  deepspace: {
    ground: [32, 14, 56], g2: [26, 10, 46], g3: [18, 6, 32], hi: [230, 200, 255],
    water: [122, 42, 154], water2: [180, 90, 220], deep: [70, 20, 100], foam: [240, 190, 255], shore: [40, 16, 66],
    hill: [110, 70, 150], hillHi: [170, 120, 210], outline: [7, 3, 15],
    pathOpen: [210, 170, 250], pathEdge: [130, 90, 190], pathLocked: [80, 56, 120],
  },
  jungle: {
    ground: [58, 120, 54], g2: [46, 102, 44], g3: [34, 80, 36], hi: [120, 190, 80],
    water: [58, 138, 106], water2: [104, 190, 150], deep: [34, 94, 74], foam: [190, 235, 210], shore: [90, 70, 48],
    hill: [70, 140, 60], hillHi: [110, 180, 84], outline: [14, 36, 18],
    pathOpen: [190, 160, 110], pathEdge: [130, 100, 62], pathLocked: [90, 104, 84],
  },
  temple: {
    ground: [214, 186, 136], g2: [200, 170, 120], g3: [176, 144, 96], hi: [240, 220, 170],
    water: [58, 154, 184], water2: [120, 208, 232], deep: [36, 110, 140], foam: [220, 245, 250], shore: [160, 128, 84],
    hill: [222, 196, 146], hillHi: [244, 226, 180], outline: [74, 50, 32],
    pathOpen: [240, 220, 170], pathEdge: [176, 140, 90], pathLocked: [150, 134, 110],
  },
  sea: {
    ground: [36, 102, 176], g2: [30, 90, 160], g3: [22, 70, 130], hi: [120, 190, 240],
    water: [14, 56, 120], water2: [40, 100, 170], deep: [8, 34, 84], foam: [150, 210, 250], shore: [60, 130, 200],
    hill: [210, 180, 130], hillHi: [240, 214, 162], outline: [10, 36, 72],
    pathOpen: [255, 240, 190], pathEdge: [180, 150, 100], pathLocked: [70, 110, 160],
  },
  industrial: {
    ground: [110, 112, 120], g2: [98, 100, 108], g3: [78, 80, 88], hi: [150, 152, 162],
    water: [58, 42, 32], water2: [255, 150, 60], deep: [30, 20, 14], foam: [255, 200, 100], shore: [70, 70, 76],
    hill: [128, 130, 140], hillHi: [166, 168, 178], outline: [22, 23, 28],
    pathOpen: [230, 210, 120], pathEdge: [150, 134, 70], pathLocked: [90, 92, 100],
  },
  neon: {
    ground: [26, 14, 54], g2: [20, 10, 44], g3: [14, 6, 32], hi: [64, 240, 255],
    water: [255, 64, 192], water2: [255, 150, 224], deep: [180, 30, 130], foam: [255, 220, 244], shore: [40, 20, 80],
    hill: [60, 30, 110], hillHi: [110, 60, 180], outline: [5, 2, 15],
    pathOpen: [64, 240, 255], pathEdge: [160, 64, 255], pathLocked: [70, 50, 120],
  },
  circus: {
    ground: [140, 60, 160], g2: [124, 50, 144], g3: [100, 38, 118], hi: [255, 224, 112],
    water: [255, 144, 192], water2: [255, 196, 222], deep: [210, 90, 150], foam: [255, 240, 250], shore: [180, 70, 90],
    hill: [230, 80, 96], hillHi: [255, 130, 140], outline: [42, 15, 56],
    pathOpen: [255, 224, 112], pathEdge: [200, 150, 40], pathLocked: [130, 90, 140],
  },
  candy: {
    ground: [255, 168, 208], g2: [255, 150, 198], g3: [232, 120, 168], hi: [255, 255, 255],
    water: [122, 74, 42], water2: [190, 130, 88], deep: [80, 46, 24], foam: [240, 200, 160], shore: [200, 140, 90],
    hill: [255, 214, 232], hillHi: [255, 255, 255], outline: [106, 42, 72],
    pathOpen: [255, 248, 224], pathEdge: [220, 170, 190], pathLocked: [200, 150, 180],
  },
  haunted: {
    ground: [62, 56, 80], g2: [52, 46, 68], g3: [38, 32, 52], hi: [150, 170, 130],
    water: [54, 88, 88], water2: [90, 140, 136], deep: [30, 56, 58], foam: [170, 210, 200], shore: [46, 40, 60],
    hill: [80, 72, 100], hillHi: [118, 108, 140], outline: [12, 10, 20],
    pathOpen: [220, 214, 196], pathEdge: [140, 132, 120], pathLocked: [80, 76, 96],
  },
  west: {
    ground: [204, 134, 84], g2: [188, 118, 72], g3: [156, 92, 56], hi: [236, 182, 128],
    water: [90, 154, 176], water2: [140, 196, 214], deep: [56, 108, 132], foam: [224, 242, 248], shore: [150, 90, 54],
    hill: [218, 142, 92], hillHi: [244, 180, 130], outline: [74, 36, 20],
    pathOpen: [236, 206, 150], pathEdge: [170, 120, 76], pathLocked: [150, 110, 86],
  },
  castle: {
    ground: [140, 146, 158], g2: [126, 132, 146], g3: [104, 110, 126], hi: [184, 190, 204],
    water: [58, 106, 150], water2: [110, 160, 202], deep: [32, 68, 104], foam: [214, 232, 246], shore: [96, 100, 114],
    hill: [112, 160, 92], hillHi: [150, 200, 120], outline: [20, 28, 48],
    pathOpen: [232, 214, 168], pathEdge: [150, 130, 90], pathLocked: [112, 116, 132],
  },
};

/** Ruido determinista (0–1) para los píxeles del terreno */
export function hash2(x: number, y: number, s: number) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Parada actual de cada mundo la última vez que se abrió el mapa (en esta sesión): si ha avanzado, la bola recorre el camino hasta ella */
const lastCurrent: Record<string, number> = {};

interface MapCloud {
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  vx: number;
}

/**
 * Hoyos de un mundo: un mapa del mundo, más alto que la pantalla, con un camino que serpentea de abajo (hoyo 1) a arriba (último hoyo).
 * Se desplaza arrastrando o con la rueda. El terreno (lagos, mar, colinas y el propio camino) se pinta una vez en una textura.
 */
export default class LevelSelectScene extends Phaser.Scene {
  world!: WorldDef;
  previewOpen = false;
  /** alto del mapa (px lógicos) y desplazamiento actual: mapY = coordenada del mapa que queda arriba de la pantalla */
  mapH = 1000;
  mapY = 0;
  maxY = 0;
  layer!: Phaser.GameObjects.Container;
  thumb!: Phaser.GameObjects.Rectangle;
  clouds: MapCloud[] = [];
  dragging = false;
  dragMoved = false;
  dragStartY = 0;
  dragStartMap = 0;
  panTween: Phaser.Tweens.Tween | null = null;

  constructor() {
    super('LevelSelect');
  }

  init(data?: { world?: string }) {
    this.world = worldById(data?.world ?? '') || worldById(LEVELS[progress.nextLevelIndex()].world) || WORLDS[0];
  }

  create() {
    fitCamera(this);
    const wd = this.world;
    music.play(wd.theme);
    this.clouds = [];
    this.previewOpen = false;
    this.dragging = false;
    this.dragMoved = false;
    this.panTween = null;

    const holes = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) => l.world === wd.id);
    this.buildMap(wd, holes);

    // --- interfaz fija: título, volver, estrellas y barra de desplazamiento
    this.add.rectangle(0, 0, W, 92, 0x141a33, 0.55).setOrigin(0).setDepth(29);
    panel(this, W / 2, 27, 164, 42, 'hud9').setDepth(30);
    label(this, W / 2, 20, wd.name.toUpperCase(), 20, { weight: '700', color: PAL.sand, strokeThickness: 4 }).setDepth(31);
    label(this, W / 2, 40, wd.tagline, 8, { color: '#ffffff', strokeThickness: 2 }).setDepth(31);
    iconButton(this, 16, 22, 'back', () => this.go('Worlds')).setDepth(32);
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.previewOpen) this.go('Worlds');
    });
    panel(this, W / 2, 72, 96, 18, 'hud9').setDepth(30);
    this.add.image(W / 2 - 34, 72, 'star-sm').setDepth(31);
    label(this, W / 2 - 26, 72, `${progress.worldStars(wd.id)}/${holes.length * 3}`, 9, { ox: 0, weight: '700' }).setDepth(31);
    label(this, W / 2 + 12, 72, 'ESTRELLAS', 6, { color: '#f0dcc0', strokeThickness: 1 }).setDepth(31);

    // --- desplazamiento: arrastrar o rueda del ratón
    const Z = VIEW.Z;
    const onDown = (p: Phaser.Input.Pointer) => {
      if (this.previewOpen) return;
      this.dragging = true;
      this.dragMoved = false;
      this.dragStartY = p.y / Z;
      this.dragStartMap = this.mapY;
    };
    const onMove = (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown || this.previewOpen) return;
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
      if (this.previewOpen) return;
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
      if (this.textures.exists(`levelmap-${wd.id}`)) this.textures.remove(`levelmap-${wd.id}`);
    });
  }

  /** Mueve el mapa (limitado a sus bordes) y actualiza la barra lateral */
  setMapY(y: number) {
    this.mapY = Phaser.Math.Clamp(y, 0, this.maxY);
    this.layer.y = -this.mapY;
    const trackTop = 100;
    const trackH = H - 112;
    const th = Math.max(18, (H / this.mapH) * trackH);
    const t = this.maxY > 0 ? this.mapY / this.maxY : 0;
    this.thumb.setSize(2, th).setPosition(W - 4, trackTop + t * (trackH - th));
  }

  /** Colores de las paradas (base, claro, oscuro) según el color del mundo */
  static readonly NODE_COLORS: Record<string, [string, string, string]> = {
    green: ['#72d454', '#b4f282', '#4aa947'],
    gold: ['#f2b43a', '#ffe28a', '#d9922a'],
    blue: ['#4a86e0', '#9cc8ff', '#3a6cc0'],
    purple: ['#7a6ad0', '#b4a8ff', '#5e50a8'],
    orange: ['#ff8a5c', '#ffc59a', '#e06a44'],
    gray: ['#8a8494', '#b4aec0', '#6e6878'],
    done: ['#ffd36b', '#fff1b0', '#e0a030'],
  };

  /** Textura de una parada redonda (con contorno, brillo arriba a la izquierda y sombra abajo a la derecha) */
  nodeTexture(color: string, r = 15) {
    const key = `node-${color}-${r}`;
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
        c.fillStyle = d > r - 2 ? '#35282c' : dx + dy < -r * 0.7 && d < r - 4 ? hi : dx + dy > r * 0.55 ? dark : base;
        c.fillRect(x, y, 1, 1);
      }
    }
    tex.refresh();
    return key;
  }

  /** Posiciones de las paradas: un camino en S de abajo hacia arriba, con curvas amplias y un poco de desorden */
  nodePositions(n: number, mapH: number) {
    const y0 = mapH - 112;
    const y1 = 150;
    const out: { x: number; y: number }[] = [];
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : k / (n - 1);
      const x = W / 2 + 64 * Math.sin(t * Math.PI * 2 * 1.5 + 0.35) + (((k * 37) % 13) - 6) * 1.2;
      const y = y0 + (y1 - y0) * t + (((k * 53) % 17) - 8) * 1.2;
      out.push({ x: Math.round(x), y: Math.round(y) });
    }
    return out;
  }

  /**
   * Pinta el terreno del mapa en una textura (una vez): suelo con ruido, lagos o mar, colinas y el camino.
   * Devuelve las máscaras de agua y de distancia al camino, para colocar la decoración sin pisar nada.
   */
  paintMap(wd: WorldDef, pos: { x: number; y: number }[], spline: Phaser.Curves.Spline, openSeg: boolean[]) {
    const mapH = this.mapH;
    const P = PALETTES[wd.id] ?? PALETTES.meadow;
    const key = `levelmap-${wd.id}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, W, mapH)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const img = ctx.createImageData(W, mapH);
    const d = img.data;
    const N = W * mapH;
    const put = (i: number, c: RGB) => {
      const o = i * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    };
    const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < mapH;

    // 1) puntos del camino y mapa de distancia al camino (hasta 30 px)
    const n = pos.length;
    const S = 1300;
    const path: { x: number; y: number; seg: number }[] = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const p = spline.getPoint(t);
      path.push({ x: p.x, y: p.y, seg: Math.min(n - 2, Math.floor(t * (n - 1))) });
    }
    const dist = new Uint8Array(N).fill(255);
    const stampDist = (cx: number, cy: number, r: number) => {
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
    for (let s = 0; s < path.length; s += 2) stampDist(path[s].x, path[s].y, 30);
    for (const p of pos) stampDist(p.x, p.y, 34);

    // 2) lagos (o mar en la costa de la Playa), lejos del camino
    let seed = 7001 + wd.id.length * 131;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    interface Lake { cx: number; cy: number; rx: number; ry: number; p1: number; p2: number }
    const lakes: Lake[] = [];
    const lakeFree = (l: Lake) => {
      for (let k = 0; k < 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        const x = Math.round(l.cx + Math.cos(a) * l.rx * 1.2);
        const y = Math.round(l.cy + Math.sin(a) * l.ry * 1.2);
        if (inb(x, y) && dist[y * W + x] < 20) return false;
      }
      const cx = Math.round(l.cx);
      const cy = Math.round(l.cy);
      return !(inb(cx, cy) && dist[cy * W + cx] < 24);
    };
    const wanted = wd.id === 'swamp' ? 11 : wd.id === 'beach' ? 5 : 7;
    for (let tries = 0; tries < 400 && lakes.length < wanted; tries++) {
      const rx = 16 + rnd() * 22;
      const ry = 12 + rnd() * 18;
      const l: Lake = { cx: 14 + rnd() * (W - 28), cy: 90 + rnd() * (mapH - 170), rx, ry, p1: rnd() * 6, p2: rnd() * 6 };
      if (lakeFree(l) && !lakes.some((o) => Math.hypot(o.cx - l.cx, o.cy - l.cy) < (o.rx + l.rx) * 0.9)) lakes.push(l);
    }
    if (wd.id === 'beach') {
      // la costa: mar a ambos lados
      for (const side of [-1, 1]) {
        for (let y = 40; y < mapH; y += 120 + Math.floor(rnd() * 50)) {
          const l: Lake = { cx: side < 0 ? -26 : W + 26, cy: y, rx: 52 + rnd() * 18, ry: 90 + rnd() * 40, p1: rnd() * 6, p2: rnd() * 6 };
          // se encoge hasta que no toque el camino
          for (let k = 0; k < 8 && !lakeFree(l); k++) l.rx *= 0.85;
          if (lakeFree(l)) lakes.push(l);
        }
      }
    }
    const water = new Uint8Array(N);
    for (const l of lakes) {
      const x0 = Math.max(0, Math.floor(l.cx - l.rx * 1.4));
      const x1 = Math.min(W - 1, Math.ceil(l.cx + l.rx * 1.4));
      const y0 = Math.max(0, Math.floor(l.cy - l.ry * 1.4));
      const y1 = Math.min(mapH - 1, Math.ceil(l.cy + l.ry * 1.4));
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

    // 3) suelo con ruido
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < W; x++) {
        const v = hash2(x, y, 1);
        const patch = hash2(x >> 3, y >> 3, 2);
        let c: RGB = P.ground;
        if (patch < 0.24) c = P.g2;
        if (wd.id === 'swamp' && hash2(x >> 4, y >> 4, 3) < 0.16) c = P.shore;
        if (wd.id === 'beach' && ((y + Math.round(Math.sin(x * 0.15) * 2)) % 9 === 0) && v < 0.55) c = P.g3;
        if (v < 0.05) c = P.g3;
        else if (v > 0.986) c = P.hi;
        put(y * W + x, c);
      }
    }

    // 4) colinas (cúpulas con contorno), lejos del camino y del agua
    const hills = wd.id === 'beach' ? 7 : 9;
    for (let k = 0, placed = 0; k < 200 && placed < hills; k++) {
      const rx = 14 + rnd() * 14;
      const ry = 8 + rnd() * 8;
      const cx = Math.round(rx + rnd() * (W - rx * 2));
      const cy = Math.round(80 + ry + rnd() * (mapH - 160));
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

    // 5) agua: orilla clara (espuma), aguas poco profundas, fondo con destellos y orilla de tierra mojada
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (water[i]) {
          let near1 = false;
          let near3 = false;
          for (let dy = -3; dy <= 3 && !near1; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              if (wat(x + dx, y + dy)) continue;
              const m = Math.max(Math.abs(dx), Math.abs(dy));
              if (m <= 1) {
                near1 = true;
                break;
              }
              near3 = true;
            }
          }
          let c: RGB = near1 ? P.foam : near3 ? P.water2 : P.water;
          if (!near1 && !near3) {
            const deep = wat(x - 7, y) && wat(x + 7, y) && wat(x, y - 7) && wat(x, y + 7);
            if (deep) c = P.deep;
            if ((x + y * 3) % 13 === 0 && hash2(x, y, 5) < 0.5) c = P.water2;
          }
          put(i, c);
        } else if (wat(x - 1, y) || wat(x + 1, y) || wat(x, y - 1) || wat(x, y + 1) || wat(x - 2, y) || wat(x + 2, y) || wat(x, y - 2) || wat(x, y + 2)) {
          put(i, P.shore);
        }
      }
    }

    // 6) el camino: contorno oscuro, senda (cerrada en gris), borde y guijarros; puntitos en los tramos abiertos
    const disc = (cx: number, cy: number, r: number, col: RGB, over?: (i: number) => boolean) => {
      const ix = Math.round(cx);
      const iy = Math.round(cy);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + 1) continue;
          const x = ix + dx;
          const y = iy + dy;
          if (!inb(x, y)) continue;
          const i = y * W + x;
          if (!over || over(i)) put(i, col);
        }
      }
    };
    for (const p of path) disc(p.x, p.y, 8, P.outline);
    for (const p of path) disc(p.x, p.y, 6, openSeg[p.seg] ? P.pathEdge : P.pathLocked);
    for (const p of path) disc(p.x, p.y, 4, openSeg[p.seg] ? P.pathOpen : ([P.pathLocked[0] + 22, P.pathLocked[1] + 22, P.pathLocked[2] + 22] as RGB));
    path.forEach((p, s) => {
      if (!openSeg[p.seg]) return;
      if (s % 7 === 0) disc(p.x, p.y, 0, [255, 255, 255]);
      else if (hash2(s, 17, 9) < 0.06) disc(p.x + (hash2(s, 3, 9) - 0.5) * 5, p.y + (hash2(s, 4, 9) - 0.5) * 5, 0, P.pathEdge);
    });

    ctx.putImageData(img, 0, 0);
    tex.refresh();
    return { key, water, dist };
  }

  /** El mapa: terreno, decoración y paradas */
  buildMap(wd: WorldDef, holes: { l: (typeof LEVELS)[number]; i: number }[]) {
    const n = holes.length;
    this.mapH = Math.max(H + 160, 150 + (n - 1) * 105 + 190);
    this.maxY = this.mapH - H;
    const pos = this.nodePositions(n, this.mapH);
    const unlockedAt = holes.map(({ i }) => progress.isLevelUnlocked(i));
    const nextIdx = holes.findIndex(({ l, i }) => progress.isLevelUnlocked(i) && !progress.level(l.id));
    const currentK = nextIdx >= 0 ? nextIdx : n - 1;
    const prevK = lastCurrent[wd.id];
    lastCurrent[wd.id] = currentK;
    const travelFrom = prevK !== undefined && prevK < currentK ? prevK : null; // acabas de avanzar: la bola recorrerá el camino

    // hora del día (la de tu reloj) y tiempo: cambian la luz del mapa, las nubes y si llueve
    // (para probar: añade ?hora=21 o ?lluvia=1 a la dirección del juego)
    const qs = new URLSearchParams(window.location.search);
    const hour = qs.has('hora') ? Number(qs.get('hora')) % 24 : new Date().getHours();
    const phase: 'dawn' | 'day' | 'dusk' | 'night' = hour >= 6 && hour < 9 ? 'dawn' : hour >= 9 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';
    const rainy = qs.has('lluvia') ? qs.get('lluvia') !== '0' : Math.random() < (wd.id === 'swamp' ? 0.65 : wd.id === 'meadow' ? 0.12 : 0.04);

    // curva suave por las paradas, con un punto intermedio desviado para que el camino haga eses
    const ctrl: Phaser.Math.Vector2[] = [];
    for (let k = 0; k < n; k++) {
      ctrl.push(new Phaser.Math.Vector2(pos[k].x, pos[k].y));
      if (k < n - 1) {
        const mx = (pos[k].x + pos[k + 1].x) / 2 + (k % 2 ? -1 : 1) * 22;
        ctrl.push(new Phaser.Math.Vector2(mx, (pos[k].y + pos[k + 1].y) / 2));
      }
    }
    const spline = new Phaser.Curves.Spline(ctrl);
    const openSeg = Array.from({ length: Math.max(0, n - 1) }, (_, k) => unlockedAt[k + 1]);
    const { key, water, dist } = this.paintMap(wd, pos, spline, openSeg);

    this.layer = this.add.container(0, 0).setDepth(1);
    this.layer.add(this.add.image(0, 0, key).setOrigin(0));

    // ---------- decoración (se coloca en tierra, lejos del camino)
    let seed = 99173 + wd.id.length * 53;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    // el cartel del punto de partida: nada de decoración (árboles, casas…) en su zona, para que no lo tape
    const signSide = pos[0].x > W / 2 ? -1 : 1;
    const signPos = { x: pos[0].x + signSide * 50, y: pos[0].y + 8 };
    const land = (x: number, y: number, minDist: number) => {
      if (Math.abs(x - signPos.x) < 46 && y > signPos.y - 34 && y < signPos.y + 46) return false;
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 4 || iy < 100 || ix >= W - 4 || iy >= this.mapH - 6) return false;
      const i = iy * W + ix;
      return !water[i] && dist[i] >= minDist && !water[iy * W + Math.max(0, ix - 4)] && !water[iy * W + Math.min(W - 1, ix + 4)];
    };
    const wet = (x: number, y: number) => {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 8 || iy < 100 || ix >= W - 8 || iy >= this.mapH - 8) return false;
      return water[iy * W + ix] && water[iy * W + ix - 6] && water[iy * W + ix + 6] && water[(iy - 5) * W + ix] && water[(iy + 5) * W + ix];
    };
    const placed: { x: number; y: number }[] = [];
    const spot = (minDist: number, gap: number) => {
      for (let t = 0; t < 40; t++) {
        const x = 6 + rnd() * (W - 12);
        const y = 104 + rnd() * (this.mapH - 130);
        if (land(x, y, minDist) && !placed.some((o) => Math.hypot(o.x - x, o.y - y) < gap)) {
          placed.push({ x, y });
          return { x, y };
        }
      }
      return null;
    };
    const sway = (o: Phaser.GameObjects.Image, amp: number) =>
      this.tweens.add({ targets: o, angle: { from: -amp, to: amp }, duration: 2400 + rnd() * 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd() * 1800 });
    const add = (o: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite) => {
      this.layer.add(o);
      return o;
    };
    // árboles y plantas según el mundo
    const trees = wd.id === 'meadow' ? ['tree-round', 'tree-pine'] : wd.id === 'beach' ? ['palm'] : ['cypress'];
    for (let k = 0; k < 46; k++) {
      const p = spot(20, 17);
      if (!p) continue;
      const o = add(this.add.image(p.x, p.y, trees[Math.floor(rnd() * trees.length)]).setOrigin(0.5, 1).setDepth(p.y).setFlipX(rnd() < 0.5)) as Phaser.GameObjects.Image;
      sway(o, wd.id === 'beach' ? 1.6 : 0.9);
    }
    const small = wd.id === 'meadow' ? ['bush', 'flower0', 'flower1', 'flower2', 'tuft', 'rock'] : wd.id === 'beach' ? ['shell', 'starfish', 'dune-tuft', 'rock'] : ['reed', 'glowshroom', 'rock'];
    for (let k = 0; k < 90; k++) {
      const p = spot(13, 9);
      if (!p) continue;
      const kind = small[Math.floor(rnd() * small.length)];
      const o = add(this.add.sprite(p.x, p.y, kind).setOrigin(0.5, 1).setDepth(p.y)) as Phaser.GameObjects.Sprite;
      if (kind.startsWith('flower')) o.play({ key: `${kind}-sway`, delay: rnd() * 800 });
      else if (kind === 'tuft') o.play('tuft-sway');
      else if (kind === 'dune-tuft') o.play('dune-tuft-sway');
      else if (kind === 'reed') o.play({ key: 'reed-sway', delay: rnd() * 900 });
      else if (kind === 'glowshroom') {
        const gl = add(this.add.image(p.x, p.y - 5, 'glow').setTint(0x7fe3c0).setBlendMode('ADD').setScale(0.45).setAlpha(0.4).setDepth(p.y + 0.1)) as Phaser.GameObjects.Image;
        this.tweens.add({ targets: gl, alpha: 0.15, duration: 1300 + rnd() * 900, yoyo: true, repeat: -1 });
      }
    }
    // hitos del mundo: molinos (Pradera) y faro (Playa)
    if (wd.id === 'meadow') {
      for (let k = 0; k < 3; k++) {
        const p = spot(26, 60);
        if (!p) continue;
        add(this.add.image(p.x, p.y, 'windmill').setOrigin(0.5, 1).setDepth(p.y));
        const blades = add(this.add.image(p.x, p.y - 17, 'blades').setDepth(p.y + 1)) as Phaser.GameObjects.Image;
        this.tweens.add({ targets: blades, angle: 360, duration: 5200 + k * 700, repeat: -1 });
      }
    }
    if (wd.id === 'beach') {
      const p = spot(26, 60);
      if (p) {
        add(this.add.image(p.x, p.y, 'lighthouse').setOrigin(0.5, 1).setDepth(p.y));
        const beam = add(this.add.image(p.x, p.y - 26, 'glow').setTint(0xfff1b0).setBlendMode('ADD').setScale(1.1).setAlpha(0.2).setDepth(p.y + 1)) as Phaser.GameObjects.Image;
        this.tweens.add({ targets: beam, alpha: 0.7, scale: 1.8, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    // sobre el agua: veleros (Pradera y Playa) y nenúfares (Pantano), más destellos
    for (let k = 0, boats = 0, tries = 0; tries < 400 && boats < (wd.id === 'swamp' ? 24 : 6); tries++) {
      const x = 8 + rnd() * (W - 16);
      const y = 110 + rnd() * (this.mapH - 140);
      if (!wet(x, y)) continue;
      k++;
      boats++;
      if (wd.id === 'swamp') {
        const lp = add(this.add.image(x, y, 'lilypad').setDepth(y)) as Phaser.GameObjects.Image;
        this.tweens.add({ targets: lp, y: y + 1, duration: 1600 + rnd() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else {
        const b = add(this.add.image(x, y, 'sailboat').setOrigin(0.5, 0.85).setDepth(y)) as Phaser.GameObjects.Image;
        this.tweens.add({ targets: b, y: y + 2, angle: { from: -3, to: 3 }, duration: 1800 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: b, x: x + 8 + rnd() * 10, duration: 5000 + rnd() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    for (let k = 0, tries = 0; tries < 600 && k < 36; tries++) {
      const x = 6 + rnd() * (W - 12);
      const y = 104 + rnd() * (this.mapH - 130);
      if (!wet(x, y)) continue;
      k++;
      const sp = add(this.add.image(x, y, 'wave').setDepth(y).setAlpha(0)) as Phaser.GameObjects.Image;
      this.tweens.add({ targets: sp, alpha: 0.9, duration: 600, yoyo: true, repeat: -1, repeatDelay: 700 + rnd() * 1800, delay: rnd() * 2200 });
    }

    // ---------- más detalles propios de cada mundo
    const lights: { x: number; y: number }[] = [];
    const wAt = (x: number, y: number) => water[Math.round(y) * W + Math.round(x)] === 1;
    // muelles con barca de remos, entrando en los lagos
    for (let k = 0, tries = 0; tries < 700 && k < (wd.id === 'swamp' ? 3 : 2); tries++) {
      const x = 12 + rnd() * (W - 24);
      const y = 112 + rnd() * (this.mapH - 150);
      for (const dir of [1, -1]) {
        if (!land(x, y, 22) || placed.some((o) => Math.hypot(o.x - x, o.y - y) < 44)) break;
        if (wAt(x + dir * 9, y) && wAt(x + dir * 20, y) && wAt(x + dir * 26, y + 8)) {
          placed.push({ x, y });
          add(this.add.image(x + dir * 1, y, 'pier').setOrigin(dir > 0 ? 0 : 1, 0.5).setFlipX(dir < 0).setDepth(y));
          const boat = add(this.add.image(x + dir * 28, y + 9, 'rowboat').setDepth(y + 1).setFlipX(dir < 0)) as Phaser.GameObjects.Image;
          this.tweens.add({ targets: boat, y: boat.y + 1.5, angle: { from: -4, to: 4 }, duration: 1700 + rnd() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          k++;
          break;
        }
      }
    }
    // puentes de madera que cruzan un tramo estrecho de un lago
    for (let k = 0, tries = 0; tries < 500 && k < 2; tries++) {
      const y = Math.round(116 + rnd() * (this.mapH - 160));
      let xa = -1;
      for (let x = 8; x < W - 8; x++) {
        const isW = water[y * W + x] === 1;
        if (isW && xa < 0 && water[y * W + x - 1] === 0) xa = x;
        else if (!isW && xa >= 0) {
          const len = x - xa;
          const okLand = dist[y * W + Math.max(0, xa - 4)] >= 22 && dist[y * W + Math.min(W - 1, x + 3)] >= 22;
          if (len >= 22 && len <= 48 && okLand && !placed.some((o) => Math.hypot(o.x - (xa + len / 2), o.y - y) < 50)) {
            placed.push({ x: xa + len / 2, y });
            const bw = len + 10;
            const bk = `bridge-${wd.id}-${bw}`;
            if (!this.textures.exists(bk)) {
              const bt = this.textures.createCanvas(bk, bw, 12)!;
              const bc = bt.getContext();
              bc.fillStyle = '#4a3322';
              bc.fillRect(0, 0, bw, 12);
              bc.fillStyle = '#b8864e';
              bc.fillRect(0, 2, bw, 8);
              bc.fillStyle = '#d8a868';
              bc.fillRect(0, 2, bw, 1);
              bc.fillStyle = '#8a5a34';
              for (let bx = 3; bx < bw; bx += 4) bc.fillRect(bx, 2, 1, 8);
              bc.fillStyle = '#6a4626';
              bc.fillRect(0, 0, bw, 2);
              bc.fillRect(0, 10, bw, 2);
              for (let bx = 1; bx < bw; bx += 11) bc.fillRect(bx, 0, 2, 12);
              bt.refresh();
            }
            add(this.add.image(xa - 5, y, bk).setOrigin(0, 0.5).setDepth(y - 2));
            k++;
          }
          xa = -1;
        }
      }
    }
    // construcciones: cabañas en la Pradera, chiringuitos en la Playa y casas sobre pilotes en el Pantano
    const house = wd.id === 'meadow' ? 'cabin' : wd.id === 'beach' ? 'beachhut' : 'stilthut';
    for (let k = 0; k < 2; k++) {
      const p = spot(24, 46);
      if (!p) continue;
      add(this.add.image(p.x, p.y, house).setOrigin(0.5, 1).setDepth(p.y));
      lights.push({ x: p.x, y: p.y - 8 });
    }
    // animalitos: ovejas, cangrejos que cruzan la playa y ranas
    for (let k = 0; k < 3; k++) {
      const p = spot(18, 36);
      if (!p) continue;
      if (wd.id === 'beach') {
        const cr = add(this.add.sprite(p.x, p.y, 'crab', 0).setOrigin(0.5, 1).setDepth(p.y).play('crab-walk')) as Phaser.GameObjects.Sprite;
        this.tweens.add({
          targets: cr, x: p.x + 30, duration: 2600 + rnd() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          onYoyo: () => cr.setFlipX(true), onRepeat: () => cr.setFlipX(false),
        });
      } else if (wd.id === 'swamp') {
        const fr = add(this.add.sprite(p.x, p.y, 'frog', 0).setOrigin(0.5, 1).setDepth(p.y)) as Phaser.GameObjects.Sprite;
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
        const sh = add(this.add.image(p.x, p.y, 'sheep').setOrigin(0.5, 1).setDepth(p.y)) as Phaser.GameObjects.Image;
        this.tweens.add({
          targets: sh, x: p.x + 22, duration: 3400 + rnd() * 1500, yoyo: true, repeat: -1, hold: 900, repeatDelay: 900, ease: 'Sine.easeInOut',
          onYoyo: () => sh.setFlipX(true), onRepeat: () => sh.setFlipX(false),
        });
        this.tweens.add({ targets: sh, y: p.y - 1, duration: 260, yoyo: true, repeat: -1 });
      }
    }
    // cartel con el nombre del mundo en el punto de partida
    {
      const sx = signPos.x;
      const sy = signPos.y;
      add(this.add.image(sx, sy, 'signboard').setOrigin(0.5, 1).setDepth(sy));
      const txt = label(this, sx, sy - 14, wd.name.toUpperCase(), 7, { color: '#fff1d8', stroke: '#3a2418', strokeThickness: 2 }).setDepth(sy + 1);
      this.layer.add(txt);
    }

    // nubes con sombra sobre el terreno
    const cloudTint = THEMES[wd.theme].cloudTint ?? 0xffffff;
    const nClouds = 4 + Math.floor(Math.random() * 5) + (rainy ? 3 : 0);
    for (let k = 0; k < nClouds; k++) {
      const cx = rnd() * W;
      const cy = 120 + rnd() * (this.mapH - 200);
      const shadow = add(this.add.image(cx + 16, cy + 26, `cloud${k % 3}`).setTint(0x000000).setAlpha(0.13).setDepth(7).setScale(1.1)) as Phaser.GameObjects.Image;
      const img = add(this.add.image(cx, cy, `cloud${k % 3}`).setTint(rainy ? 0x9aa8b4 : cloudTint).setAlpha(rainy ? 0.6 : wd.id === 'swamp' ? 0.4 : 0.7).setDepth(1500).setScale(1.1)) as Phaser.GameObjects.Image;
      this.clouds.push({ img, shadow, vx: 2.5 + rnd() * 3.5 });
    }

    // velo de niebla sobre lo que aún no has desbloqueado (más oscuro cuanto más arriba)
    const firstLocked = unlockedAt.findIndex((u) => !u);
    if (firstLocked >= 0) {
      const veilKey = `mapveil-${wd.id}`;
      if (!this.textures.exists(veilKey)) {
        const vt = this.textures.createCanvas(veilKey, 4, 64)!;
        const vc = vt.getContext();
        const g = vc.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, 'rgba(20,26,51,0.85)');
        g.addColorStop(1, 'rgba(20,26,51,0)');
        vc.fillStyle = g;
        vc.fillRect(0, 0, 4, 64);
        vt.refresh();
        vt.setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
      const bottom = pos[firstLocked].y + 10;
      this.layer.add(this.add.image(0, 0, veilKey).setOrigin(0).setDisplaySize(W, bottom).setDepth(1600).setAlpha(0.9));
    }

    // ---------- banderín del hoyo final
    const last = pos[n - 1];
    add(this.add.image(last.x + 3, last.y - 14, 'pole').setOrigin(0.5, 1).setDepth(1900));
    add(this.add.sprite(last.x + 5, last.y - 42, 'flag', 0).setOrigin(0, 0).setDepth(1901).play('flag-wave'));

    // ---------- cinta con el nombre del hoyo (fija): el siguiente por jugar, o el que señalas
    panel(this, W / 2, 100, 176, 18, 'hud9').setDepth(30);
    const bannerTxt = label(this, W / 2, 100, '', 8, { color: PAL.sand, weight: '700', strokeThickness: 2 }).setDepth(31);
    const showName = (k: number) => {
      const { l } = holes[k];
      const rec = progress.level(l.id);
      bannerTxt.setText(unlockedAt[k] ? `${l.number}. ${l.name.toUpperCase()} · PAR ${l.par}${rec ? ` · MEJOR ${rec.best}` : ''}` : `${l.number}. ???`);
    };
    showName(currentK);

    // ---------- paradas
    holes.forEach(({ l, i }, k) => {
      const { x, y } = pos[k];
      const unlocked = unlockedAt[k];
      const rec = progress.level(l.id);
      const color = !unlocked ? 'gray' : rec ? 'done' : wd.button;
      const c = this.add.container(x, y).setDepth(2000 + y);
      // sombra en el suelo
      c.add(this.add.image(0, 12, 'bshadow').setScale(2.4, 1.6).setAlpha(0.35));
      const body = this.add.image(0, 0, this.nodeTexture(color));
      c.add(body);
      c.add(label(this, 0, -1, `${l.number}`, 14, { weight: '700', strokeThickness: 3, color: unlocked ? '#ffffff' : '#c8bfb4' }));
      if (!unlocked) c.add(this.add.image(11, 11, 'lock').setScale(0.6));
      if (unlocked) {
        for (let st = 0; st < 3; st++) c.add(this.add.image(-9 + st * 9, 22 - (st === 1 ? 1 : 0), rec && st < rec.stars ? 'star-sm' : 'star-sm-empty').setScale(0.9));
      }
      if (rec) {
        // las paradas completadas brillan de vez en cuando
        const sp = this.add.image(0, 0, 'spark').setBlendMode('ADD').setAlpha(0).setScale(0.8);
        c.add(sp);
        const twinkle = () => {
          if (!sp.active) return;
          sp.setPosition(Phaser.Math.Between(-12, 12), Phaser.Math.Between(-12, 8));
          this.tweens.add({ targets: sp, alpha: { from: 0.9, to: 0 }, scale: { from: 0.4, to: 1.2 }, duration: 600, onComplete: () => this.time.delayedCall(Phaser.Math.Between(400, 2200), twinkle) });
        };
        this.time.delayedCall(300 + k * 150, twinkle);
      }
      if (unlocked) {
        c.setSize(34, 34).setInteractive({ useHandCursor: true });
        c.on('pointerover', () => {
          this.tweens.add({ targets: body, scale: 1.12, duration: 90 });
          showName(k);
        });
        c.on('pointerout', () => {
          this.tweens.add({ targets: body, scale: 1, duration: 90 });
          showName(currentK);
        });
        c.on('pointerdown', () => sfx.unlock());
        c.on('pointerup', () => {
          if (this.dragMoved) return; // fue un arrastre, no un toque
          sfx.click();
          this.go('Game', { levelIndex: i });
        });
        // botón de previsualización (ojo) junto a la parada
        const eye = this.add.container(x + 21, y - 14).setDepth(3000 + y);
        eye.add([this.add.nineslice(0, 0, 'btn9-white', 0, 14, 15, 5, 5, 5, 7), this.add.image(0, -1, 'icon-eye').setScale(0.9)]);
        eye.setSize(18, 18).setInteractive({ useHandCursor: true });
        eye.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => {
          e?.stopPropagation?.();
          sfx.unlock();
        });
        eye.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => {
          e?.stopPropagation?.();
          if (this.dragMoved) return;
          sfx.click();
          this.showPreview(i);
        });
        this.layer.add(eye);
        eye.setAlpha(0).setScale(0.6);
        this.tweens.add({ targets: eye, alpha: 1, scale: 1, duration: 240, delay: 500 + k * 70, ease: 'Back.easeOut' });
      }
      this.layer.add(c);
      c.setAlpha(0).setScale(0.5);
      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 260, delay: 300 + k * 70, ease: 'Back.easeOut' });

    });

    // ---------- la bola: bota en la parada actual o, si acabas de avanzar, recorre el camino hasta ella
    const cur = pos[currentK];
    const startNode = travelFrom !== null ? pos[travelFrom] : cur;
    const ring = this.add.image(startNode.x, startNode.y, this.nodeTexture('done', 19)).setDepth(1999 + cur.y).setAlpha(0);
    const bshadow = this.add.image(startNode.x, startNode.y - 14, 'bshadow').setDepth(2500 + cur.y).setAlpha(0.5);
    const ball = this.add.sprite(startNode.x, startNode.y - 28, `ball-${progress.skin}`, 0).setDepth(2501 + cur.y);
    this.layer.add([ring, bshadow, ball]);
    const bounceAt = (x: number, y: number) => {
      this.tweens.killTweensOf([ring, bshadow, ball]);
      ring.setPosition(x, y).setScale(1);
      ball.setPosition(x, y - 28);
      bshadow.setPosition(x, y - 14).setScale(1).setAlpha(0.5);
      this.tweens.add({ targets: ring, alpha: { from: 0.55, to: 0 }, scale: { from: 0.9, to: 1.35 }, duration: 1100, repeat: -1, ease: 'Sine.easeOut' });
      this.tweens.add({ targets: ball, y: y - 40, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeOut' });
      this.tweens.add({ targets: bshadow, scaleX: 0.7, alpha: 0.25, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeOut' });
    };
    bounceAt(startNode.x, startNode.y);
    const panDur = (y: number) => Math.min(1400, 400 + Math.abs(this.maxY - Phaser.Math.Clamp(y - H * 0.55, 0, this.maxY)) * 1.3);
    if (travelFrom !== null) {
      const steps = currentK - travelFrom;
      const tA = travelFrom / (n - 1);
      const tB = currentK / (n - 1);
      this.time.delayedCall(250 + panDur(startNode.y) + 500, () => {
        if (!ball.active) return;
        this.tweens.killTweensOf([ring, bshadow, ball]);
        ring.setAlpha(0);
        let lastHop = -1;
        sfx.whoosh();
        this.tweens.addCounter({
          from: 0, to: 1, duration: 850 * steps + 350, ease: 'Sine.easeInOut',
          onUpdate: (tw) => {
            const u = tw.getValue() ?? 0;
            const base = spline.getPoint(tA + (tB - tA) * u);
            const ph = u * steps * 5;
            const hopH = Math.sin((ph - Math.floor(ph)) * Math.PI) * 15;
            ball.setPosition(base.x, base.y - 14 - hopH);
            bshadow.setPosition(base.x, base.y - 2).setScale(1 - hopH / 40).setAlpha(0.5);
            if (Math.floor(ph) !== lastHop) {
              lastHop = Math.floor(ph);
              sfx.land(110, 'grass');
              ball.setFrame(Math.floor(Math.random() * 4));
            }
            this.setMapY(base.y - H * 0.55); // la cámara acompaña a la bola
          },
          onComplete: () => {
            sfx.star(1);
            bounceAt(cur.x, cur.y);
          },
        });
      });
    }


    // ---------- ordenar por altura, barra lateral y entrada: el mapa sube desde el hoyo 1 hasta la parada actual
    this.layer.sort('depth');
    this.add.rectangle(W - 4, 100 + (H - 112) / 2, 2, H - 112, 0x141a33, 0.45).setDepth(31);
    this.thumb = this.add.rectangle(W - 4, 120, 2, 30, 0xf0dcc0, 0.9).setDepth(32);
    this.setMapY(this.maxY);
    const target = Phaser.Math.Clamp(startNode.y - H * 0.55, 0, this.maxY);
    this.panTween = this.tweens.addCounter({
      from: this.maxY, to: target, duration: Math.min(1400, 400 + Math.abs(this.maxY - target) * 1.3), delay: 250, ease: 'Sine.easeInOut',
      onUpdate: (tw) => this.setMapY(tw.getValue() ?? this.maxY),
    }) as unknown as Phaser.Tweens.Tween;

    // ---------- ambiente: partículas fijas a la pantalla (hojas, pétalos o luciérnagas)
    const kind = THEMES[wd.theme]?.ambient || 'leaf';
    if (kind === 'firefly') {
      this.add.particles(0, 0, 'glow', {
        x: { min: 0, max: W }, y: { min: 100, max: H }, lifespan: 4000, speedX: { min: -6, max: 6 }, speedY: { min: -8, max: 3 },
        scale: { min: 0.06, max: 0.12 }, tint: 0xd8ff8a, blendMode: 'ADD', frequency: 380,
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.max(0, Math.sin(t * Math.PI * 3)) * Math.sin(t * Math.PI) },
      }).setDepth(25);
    } else {
      this.add.particles(0, 0, kind, {
        x: { min: -10, max: W }, y: 90, lifespan: 9000, speedX: { min: 4, max: 14 }, speedY: { min: 10, max: 22 },
        rotate: { start: 0, end: 360 }, frequency: 1500, alpha: 0.9,
      }).setDepth(25);
    }

    // ---------- luz del día (según la hora de tu reloj) y tiempo
    const TINT = { dawn: 0xffcdbd, dusk: 0xffae78, night: 0x5460a6 } as const;
    if (phase !== 'day' || rainy) {
      const col = phase !== 'day' ? TINT[phase] : 0xb8c6d4;
      this.add.rectangle(0, 0, W, H, col, 1).setOrigin(0).setDepth(24).setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    if (phase === 'dusk' || phase === 'night') {
      // faroles: las paradas y las construcciones se iluminan
      const glowAt = (x: number, y: number, sc: number) => {
        const g = this.add.image(x, y, 'glow').setTint(0xffd070).setBlendMode('ADD').setScale(sc).setAlpha(0.5).setDepth(1990);
        this.layer.add(g);
        this.tweens.add({ targets: g, alpha: 0.25, duration: 700 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 600 });
      };
      for (const p of pos) glowAt(p.x, p.y, 0.9);
      for (const l of lights) glowAt(l.x, l.y, 0.8);
    }
    if (rainy) {
      this.add.particles(0, 0, 'px', {
        x: { min: -30, max: W + 20 }, y: 90, lifespan: 1100, speedY: { min: 250, max: 340 }, speedX: -45,
        scaleX: 1, scaleY: { min: 4, max: 7 }, tint: 0xcfe4f4, alpha: { start: 0.55, end: 0.1 }, frequency: 22,
      }).setDepth(26);
    }
    const phaseName = { dawn: 'AMANECER', day: 'DÍA', dusk: 'ATARDECER', night: 'NOCHE' }[phase];
    label(this, 6, H - 8, `${phaseName}${rainy ? ' · LLUVIA' : ''}`, 6, { ox: 0, color: '#f0dcc0', strokeThickness: 2 }).setDepth(31);

    // pájaros que cruzan el mapa de vez en cuando
    this.time.addEvent({
      delay: 6500, loop: true, callback: () => {
        const y = this.mapY + 110 + Math.random() * (H - 150);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const n2 = 2 + Math.floor(Math.random() * 3);
        for (let b = 0; b < n2; b++) {
          const bird = this.add.sprite(dir > 0 ? -12 - b * 10 : W + 12 + b * 10, y + (b % 2) * 7 + b * 2, 'bird', 0).setTint(0x35282c).setAlpha(0.7).setDepth(1700).setFlipX(dir < 0);
          bird.play({ key: 'bird-flap', delay: b * 90 });
          this.layer.add(bird);
          bird.y = y + (b % 2) * 7 + b * 2;
          this.tweens.add({ targets: bird, x: dir > 0 ? W + 30 : -30, y: bird.y - 14, duration: 9000, onComplete: () => bird.destroy() });
        }
      },
    });
  }

  /** Ventana con el mapa completo del hoyo (terreno, salida y hoyo). Toca en cualquier sitio para cerrar. */
  showPreview(index: number) {
    if (this.previewOpen) return;
    this.previewOpen = true;
    const L = parseLevel(index);
    const key = `preview-${L.id}`;
    renderTerrain(this, key, L.grid, L.theme, { open: L.open });
    // Recorta el vacío que rodea el mapa (los hoyos abiertos llevan filas y columnas libres) para poder ampliarlo más
    let c0 = L.cols;
    let c1 = 0;
    let r0 = L.rows;
    let r1 = 0;
    const mark = (c: number, r: number) => {
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    };
    L.grid.forEach((row, r) => row.forEach((ch, c) => ch !== '.' && mark(c, r)));
    mark(L.start.c, L.start.r);
    mark(L.hole.c, L.hole.r);
    for (const o of [...L.saws, ...L.bumpers, ...L.mushrooms, ...L.movers, ...L.crumbles, ...L.tides]) mark(o.c, o.r);
    const pad = 2;
    c0 = L.open ? Math.max(0, c0 - pad) : 0;
    c1 = L.open ? Math.min(L.cols - 1, c1 + pad) : L.cols - 1;
    r0 = Math.max(0, r0 - pad);
    r1 = Math.min(L.rows - 1, r1 + 1);
    const tw = (c1 - c0 + 1) * TILE;
    const th = (r1 - r0 + 1) * TILE;
    const s = Math.min((W - 24) / tw, (H - 84) / th, 1.5);
    const iw = tw * s;
    const ih = th * s;
    const pw = Math.max(iw + 16, 150);
    const ph = ih + 58;
    const cy = H / 2;

    const m = this.add.container(0, 0).setDepth(100);
    const shade = this.add.rectangle(0, 0, W, H, 0x000000, 0.72).setOrigin(0).setInteractive();
    m.add(shade);
    m.add(panel(this, W / 2, cy, pw, ph));
    m.add(label(this, W / 2, cy - ph / 2 + 13, `${L.number}. ${L.name}`.toUpperCase(), 9, { weight: '700', strokeThickness: 2, wrap: pw - 16 }));
    const x0 = W / 2 - iw / 2;
    const y0 = cy - ph / 2 + 26;
    m.add(this.add.rectangle(x0, y0, iw, ih, Phaser.Display.Color.HexStringToColor(THEMES[L.theme].bgA).color).setOrigin(0));
    const img = this.add.image(x0 - c0 * TILE * s, y0 - r0 * TILE * s, key).setOrigin(0).setScale(s);
    img.setCrop(c0 * TILE, r0 * TILE, tw, th);
    m.add(img);

    // salida (blanco) y hoyo (bandera roja)
    const g = this.add.graphics();
    const px = (c: number) => x0 + (c - c0 + 0.5) * TILE * s;
    const py = (r: number) => y0 + (r - r0 + 0.5) * TILE * s;
    const rad = Math.max(2.5, 4 * s);
    // objetos que no van en la textura del terreno: tablones móviles (marrón), bloques frágiles (naranja) y bancos de marea (arena con borde azul)
    const bars = (list: { c: number; r: number; n: number }[], fill: number, edge: number) => {
      for (const o of list) {
        g.fillStyle(fill, 1).fillRect(px(o.c) - (TILE * s) / 2, py(o.r) - (TILE * s) / 2, o.n * TILE * s, Math.max(2, TILE * s * 0.6));
        g.lineStyle(1, edge, 1).strokeRect(px(o.c) - (TILE * s) / 2, py(o.r) - (TILE * s) / 2, o.n * TILE * s, Math.max(2, TILE * s * 0.6));
      }
    };
    bars(L.movers, 0xc08552, 0x35282c);
    bars(L.crumbles, 0xe39880, 0x35282c);
    bars(L.tides, 0xf6e4b2, 0x2fcbdd);
    g.fillStyle(0xffffff, 1).fillCircle(px(L.start.c), py(L.start.r), rad).lineStyle(1, 0x35282c, 1).strokeCircle(px(L.start.c), py(L.start.r), rad);
    const hx = px(L.hole.c);
    const hy = py(L.hole.r);
    g.lineStyle(1, 0x35282c, 1).lineBetween(hx, hy + rad, hx, hy - rad * 2.4);
    g.fillStyle(0xef4d5e, 1).fillTriangle(hx, hy - rad * 2.4, hx + rad * 1.6, hy - rad * 1.7, hx, hy - rad * 1);
    m.add(g);
    m.add(label(this, W / 2, cy + ph / 2 - 10, 'TOCA PARA CERRAR', 6, { color: '#f0dcc0', strokeThickness: 1 }));

    const close = () => {
      sfx.click();
      m.destroy();
      this.previewOpen = false;
      if (this.textures.exists(key)) this.textures.remove(key);
      this.input.keyboard?.off('keydown-ESC', onEsc);
    };
    const onEsc = () => close();
    shade.on('pointerup', close);
    this.input.keyboard?.once('keydown-ESC', onEsc);
    m.setAlpha(0);
    this.tweens.add({ targets: m, alpha: 1, duration: 120 });
  }

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  update(_: number, delta: number) {
    // las nubes cruzan el mapa despacio y su sombra las sigue por el suelo
    const dt = delta / 1000;
    for (const c of this.clouds) {
      c.img.x += c.vx * dt;
      if (c.img.x - c.img.width / 2 > W + 20) c.img.x = -c.img.width / 2 - 20;
      c.shadow.x = c.img.x + 16;
    }
  }
}
