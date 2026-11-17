import type Phaser from 'phaser';
import { TILE, THEMES, type Theme, type ThemeKey } from '../constants';

/**
 * Pintor de terreno: convierte la rejilla del nivel en una única textura pixel art
 * con contorno, esquinas redondeadas, hierba con festón, tierra ondulada, arena, hielo y agua.
 */

const T = TILE;

/** color [r, g, b, a] (0–255) */
type RGBA = number[];

function rgb(hexStr: string, a = 255): RGBA {
  const n = parseInt(hexStr.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

function hash(x: number, y: number, s = 0) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// 1 hierba · 2 arena · 3 hielo · 4 rough (hierba alta) · 5 green (alrededor del hoyo)
const MAT_OF: Record<string, number> = { '#': 1, '/': 1, '\\': 1, '=': 1, s: 2, i: 3, r: 4, G: 5 };

/** ¿El píxel (lx,ly) de una casilla con este carácter es sólido? */
export function cellSolid(ch: string | undefined, lx: number, ly: number): boolean {
  switch (ch) {
    case '#':
    case 's':
    case 'i':
    case 'r':
    case 'G':
      return true;
    case '/':
      return ly + 0.5 >= T - (lx + 0.5);
    case '\\':
      return ly + 0.5 >= lx + 0.5;
    case '=':
      return ly < 7;
    default:
      return false;
  }
}

const SAND = { hi: rgb('#fff0b0'), base: rgb('#f2d083'), dark: rgb('#d9ad5e') };
const ICE = { hi: rgb('#ffffff'), light: rgb('#d6f5ff'), base: rgb('#a8e2f5'), dark: rgb('#7cc6ea'), shine: rgb('#e8fbff') };
const BUMP = [0, 1, 2, 2, 1, 0, 0, 0];
const lighten = (c: RGBA, k: number): RGBA => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k, 255].map(Math.round);

type Palette = Record<string, RGBA>;
interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Piedras incrustadas en la tierra, con los tonos del propio mundo */
function rockAt(x: number, y: number, C: Palette): RGBA | null {
  const cx = Math.floor(x / 22);
  const cy = Math.floor(y / 16);
  if (hash(cx, cy, 21) > 0.13) return null;
  const sx = cx * 22 + 6 + Math.floor(hash(cx, cy, 22) * 10);
  const sy = cy * 16 + 5 + Math.floor(hash(cx, cy, 23) * 6);
  const rx = 2.5 + hash(cx, cy, 24) * 1.5;
  const dx = x + 0.5 - sx;
  const dy = y + 0.5 - sy;
  const d = (dx * dx) / (rx * rx) + (dy * dy) / 3;
  if (d > 1.2) return null;
  if (d > 0.8) return C.stripe;
  return dx + dy < -0.6 ? C.rockHi : C.dirtLight;
}

/**
 * Pinta píxeles a partir de funciones de máscara.
 * solidAt(x,y) → 0 (vacío) | 1 hierba | 2 arena | 3 hielo ; waterAt(x,y) → bool ; round(x,y) → si se pueden redondear esquinas
 */
function paint(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  P: Theme,
  solidAt: (x: number, y: number) => number,
  waterAt: (x: number, y: number) => boolean,
  canRound: (x: number, y: number) => boolean,
  edgeSolid: Edges = { left: 1, right: 1, top: 0, bottom: 1 },
) {
  const raw = new Uint8Array(w * h);
  const water = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      raw[y * w + x] = solidAt(x, y);
      water[y * w + x] = waterAt(x, y) ? 1 : 0;
    }
  }
  const S0 = (x: number, y: number) => {
    if (x < 0) return edgeSolid.left;
    if (x >= w) return edgeSolid.right;
    if (y < 0) return edgeSolid.top;
    if (y >= h) return edgeSolid.bottom;
    return raw[y * w + x];
  };
  // esquinas convexas redondeadas
  const solid = raw.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!raw[y * w + x] || !canRound(x, y)) continue;
      const u = !S0(x, y - 1);
      const d = !S0(x, y + 1);
      const l = !S0(x - 1, y);
      const r = !S0(x + 1, y);
      if ((u && l) || (u && r) || (d && l) || (d && r)) solid[y * w + x] = 0;
    }
  }
  const S = (x: number, y: number) => {
    if (x < 0) return edgeSolid.left;
    if (x >= w) return edgeSolid.right;
    if (y < 0) return edgeSolid.top;
    if (y >= h) return edgeSolid.bottom;
    return solid[y * w + x];
  };
  const Wt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && water[y * w + x];

  const C: Palette = {
    outline: rgb(P.outline), dirt: rgb(P.dirt), stripe: rgb(P.stripe), dirtLight: rgb(P.dirtLight),
    grassHi: rgb(P.grassHi), grass: rgb(P.grass), grassDark: rgb(P.grassDark), grassLine: rgb(P.grassLine),
    water: rgb(P.water, 225), waterHi: rgb(P.waterHi, 235), waterMid: rgb(P.waterMid, 230),
  };
  C.rockHi = lighten(C.dirtLight, 0.35);
  C.grassAlt = rgb(P.grassAlt || P.grass);
  C.greenHi = rgb(P.greenHi || P.grassHi);
  C.green = rgb(P.green || P.grass);
  C.greenAlt = rgb(P.greenAlt || P.grass);
  C.roughHi = rgb(P.roughHi || P.grass);
  C.rough = rgb(P.rough || P.grassDark);
  C.roughDark = rgb(P.roughDark || P.grassLine);
  // franjas de césped cortado: bandas de 6 px que alternan tono (como un fairway)
  const mow = (x: number) => P.mow && Math.floor(x / 6) % 2 === 1;

  const img = ctx.createImageData(w, h);
  const data = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let col: RGBA | null = null;
      const m = solid[i];
      if (m) {
        const edge = !S(x - 1, y) || !S(x + 1, y) || !S(x, y - 1) || !S(x, y + 1);
        if (edge) col = C.outline;
        else {
          let dd = 1;
          while (dd < 9 && S(x, y - dd - 1)) dd++;
          const openAbove = dd < 9; // hay aire (o agua) encima a poca distancia
          if (m === 4 && openAbove && dd <= 6) {
            // rough: hierba alta y oscura con briznas verticales
            const blade = hash(x, 0, 31) < 0.35;
            col = dd === 1 ? (blade ? C.roughHi : C.rough) : dd <= 4 ? (blade || hash(x, y, 32) < 0.15 ? C.roughDark : C.rough) : C.grassLine;
          } else if (m === 5 && openAbove && dd <= 3) {
            // green: césped muy fino y claro con franjas suaves
            col = dd === 1 ? C.greenHi : Math.floor(x / 4) % 2 ? C.greenAlt : C.green;
          } else if (m === 1 || m === 4 || m === 5) {
            const gd = 4 + BUMP[x % 8];
            if (openAbove && dd === 1) col = C.grassHi;
            else if (openAbove && dd <= 3) col = mow(x) ? C.grassAlt : C.grass;
            else if (openAbove && dd < gd) col = C.grassDark;
            else if (openAbove && dd === gd) col = C.grassLine;
            else if (openAbove && dd <= gd + 2) col = C.stripe; // sombra bajo la hierba
            else if (!S(x - 2, y)) col = C.dirtLight; // borde izquierdo iluminado
            else if (!S(x + 2, y) || !S(x, y + 2)) col = C.stripe; // borde derecho / inferior en sombra
            else {
              const rock = rockAt(x, y, C);
              if (rock) col = rock;
              else {
                const wv = Math.round(Math.sin(x * 0.33) * 1.5);
                const band = (((y + wv) % 7) + 7) % 7;
                if (band === 0) col = C.stripe;
                else if (band === 1 && hash(x >> 2, y, 4) < 0.5) col = C.dirtLight;
                else col = C.dirt;
              }
            }
          } else if (m === 2) {
            if (openAbove && dd === 1) col = SAND.hi;
            else col = hash(x, y, 3) < 0.09 ? SAND.dark : (((y + Math.round(Math.sin(x * 0.5))) % 5) === 0 ? SAND.dark : SAND.base);
          } else {
            if (openAbove && dd === 1) col = ICE.hi;
            else if (openAbove && dd <= 2) col = ICE.light;
            else if ((((x + y) % 9) + 9) % 9 === 0) col = ICE.shine;
            else col = dd > 6 ? ICE.dark : ICE.base;
          }
        }
      } else if (water[i]) {
        const above = !Wt(x, y - 1) && !S(x, y - 1);
        const above2 = !Wt(x, y - 2) && !S(x, y - 2);
        col = above ? C.waterHi : above2 ? C.waterMid : C.water;
        if (!above && hash(x >> 2, y, 5) < 0.04) col = C.waterMid;
      }
      // briznas de hierba que asoman por encima del contorno
      if (!col && !water[i] && y + 1 < h && solid[i + w] === 1 && hash(x, y, 11) < 0.42) {
        col = hash(x, y, 12) < 0.5 ? C.grass : C.grassDark;
      } else if (!col && !water[i] && y + 2 < h && solid[i + 2 * w] === 1 && !solid[i + w] && hash(x, y + 1, 11) < 0.42 && hash(x, y, 13) < 0.3) {
        col = C.grassHi;
      }
      // el rough asoma más alto (hasta 3 px) por encima del contorno
      if (!col && !water[i]) {
        const bh = Math.floor(hash(x, 0, 31) * 4); // altura de la brizna en esta columna (0–3)
        for (let k = 1; k <= 3; k++) {
          if (y + k >= h || !solid[i + k * w]) continue;
          if (solid[i + k * w] === 4 && k <= bh) col = k === bh ? C.roughHi : C.rough;
          break;
        }
      }
      if (col) {
        const o = i * 4;
        data[o] = col[0];
        data[o + 1] = col[1];
        data[o + 2] = col[2];
        data[o + 3] = col[3];
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Crea una textura de canvas (falla con un error claro si la clave ya existe) */
export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number): Phaser.Textures.CanvasTexture {
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`No se pudo crear la textura '${key}'`);
  return tex;
}

/** Textura con todo el terreno de un nivel */
export function renderTerrain(scene: Phaser.Scene, key: string, grid: string[][], themeKey: ThemeKey, { open = false } = {}) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const rows = grid.length;
  const cols = grid[0].length;
  const w = cols * T;
  const h = rows * T;
  const tex = canvasTexture(scene, key, w, h);
  // en los hoyos abiertos, fuera del mapa hay vacío (las islas llevan contorno por todos lados)
  const outside = open ? '.' : '#';
  const cell = (x: number, y: number) => grid[Math.floor(y / T)]?.[Math.floor(x / T)] ?? outside;
  paint(
    tex.getContext(),
    w,
    h,
    THEMES[themeKey],
    (x, y) => {
      const ch = cell(x, y);
      return cellSolid(ch, x % T, y % T) ? MAT_OF[ch] || 1 : 0;
    },
    (x, y) => cell(x, y) === 'W',
    (x, y) => {
      const ch = cell(x, y);
      return ch !== '/' && ch !== '\\';
    },
    open ? { left: 0, right: 0, top: 0, bottom: 0 } : undefined,
  );
  tex.refresh();
  return key;
}

/** Bloque suelto (plataforma móvil, bloque frágil) con el mismo estilo */
export function renderBlock(scene: Phaser.Scene, key: string, w: number, h: number, themeKey: ThemeKey, kind: 'grass' | 'crumble' | 'wood' = 'grass') {
  if (scene.textures.exists(key)) return key;
  const tex = canvasTexture(scene, key, w, h);
  const ctx = tex.getContext();
  const P = THEMES[themeKey];
  paint(ctx, w, h, P, () => 1, () => false, () => true, { left: 0, right: 0, top: 0, bottom: 0 });
  if (kind === 'crumble') {
    // grietas
    ctx.fillStyle = P.outline;
    for (let x = 5; x < w - 3; x += 9) {
      let cx = x;
      for (let y = 4; y < h - 1; y++) {
        ctx.fillRect(cx, y, 1, 1);
        if (hash(x, y, 2) < 0.4) cx += hash(x, y, 3) < 0.5 ? -1 : 1;
      }
    }
  }
  if (kind === 'wood') {
    // tablones en lugar de tierra
    ctx.fillStyle = '#8a5a3c';
    for (let x = 8; x < w - 2; x += 10) ctx.fillRect(x, 5, 1, h - 6);
  }
  tex.refresh();
  return key;
}
