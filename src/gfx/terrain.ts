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
const MAT_OF: Record<string, number> = { '#': 1, '/': 1, '\\': 1, '=': 1, s: 2, '{': 2, '}': 2, i: 3, r: 4, G: 5, m: 6, q: 7 };

/** ¿El píxel (lx,ly) de una casilla con este carácter es sólido? */
export function cellSolid(ch: string | undefined, lx: number, ly: number): boolean {
  switch (ch) {
    case '#':
    case 's':
    case 'i':
    case 'r':
    case 'G':
    case 'm':
    case 'q':
      return true;
    case '/':
    case '{':
      return ly + 0.5 >= T - (lx + 0.5);
    case '\\':
    case '}':
      return ly + 0.5 >= lx + 0.5;
    case '=':
      return ly < 7;
    default:
      return false;
  }
}

const ALGAE: RGBA = [138, 214, 84, 255];
const MUD = { hi: rgb('#7a6248'), wet: rgb('#4c3a2a'), base: rgb('#3a2c20'), dark: rgb('#2c2018') };
const QSAND = { hi: rgb('#e6d99c'), base: rgb('#b8a468'), dark: rgb('#8e7e48') };
const SAND = { hi: rgb('#fff0b0'), base: rgb('#f2d083'), dark: rgb('#d9ad5e') };
const ICE = { hi: rgb('#ffffff'), light: rgb('#d6f5ff'), base: rgb('#a8e2f5'), dark: rgb('#7cc6ea'), shine: rgb('#e8fbff') };
const BUMP = [0, 1, 2, 2, 1, 0, 0, 0];
const lighten = (c: RGBA, k: number): RGBA => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k, 255].map(Math.round);

/** mezcla dos colores RGBA (t = 0 → a, t = 1 → b) */
const mixC = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2, 3].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));

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
  // en temas con `softWater` (Playa) la tierra no lleva contorno oscuro donde toca el agua: la poza se funde con la arena
  const E = (x: number, y: number) => S(x, y) || (!!P.softWater && !!Wt(x, y));

  const C: Palette = {
    outline: rgb(P.outline), dirt: rgb(P.dirt), stripe: rgb(P.stripe), dirtLight: rgb(P.dirtLight),
    grassHi: rgb(P.grassHi), grass: rgb(P.grass), grassDark: rgb(P.grassDark), grassLine: rgb(P.grassLine),
    water: rgb(P.water, 225), waterHi: rgb(P.waterHi, 235), waterMid: rgb(P.waterMid, 230),
  };
  C.rockHi = lighten(C.dirtLight, 0.35);
  C.deepWater = mixC(rgb(P.water, 235), rgb(P.outline, 235), 0.55);
  C.foam = lighten(rgb(P.waterHi, 240), 0.6);
  C.grassAlt = rgb(P.grassAlt || P.grass);
  C.greenHi = rgb(P.greenHi || P.grassHi);
  C.green = rgb(P.green || P.grass);
  C.greenAlt = rgb(P.greenAlt || P.grass);
  C.roughHi = rgb(P.roughHi || P.grass);
  C.rough = rgb(P.rough || P.grassDark);
  C.roughDark = rgb(P.roughDark || P.grassLine);
  // Profundidad: píxeles sólidos seguidos por encima (tierra) y de agua por encima (para sombrear el fondo)
  const hasWater = water.some((v) => v);
  const depth = new Uint8Array(w * h);
  const wdepth = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let d = 0;
    let wd = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      d = solid[i] ? Math.min(255, d + 1) : 0;
      wd = water[i] ? Math.min(255, wd + 1) : 0;
      depth[i] = d;
      wdepth[i] = wd;
    }
  }
  // Bajos de las islas flotantes: estalactitas de tierra y alguna enredadera colgando (solo adorno, sin física).
  // under[i] = largo de la estalactita cuyo primer píxel es i; vine[i] = largo de la enredadera.
  const under = new Uint8Array(w * h);
  const vine = new Uint8Array(w * h);
  if (!edgeSolid.bottom) {
    for (let y = 0; y < h - 2; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!solid[i] || solid[i + w] || water[i + w]) continue;
        const group = hash(x >> 2, y, 41);
        if (group < 0.55) {
          // estalactita de 4 columnas: el centro llega más abajo que los lados
          const lc = 2 + Math.floor(hash(x >> 2, y, 42) * 4); // 2–5
          const len = x % 4 === 1 || x % 4 === 2 ? lc : lc - 1;
          let free = 0;
          while (free < len && y + 1 + free < h && !solid[i + (1 + free) * w] && !water[i + (1 + free) * w]) free++;
          if (free >= len) under[i + w] = len;
        } else if (hash(x, y, 43) < (P.swampy ? 0.1 : 0.04) && !under[i + w] && !P.sandy) {
          const len = 6 + Math.floor(hash(x, y, 44) * 8);
          let free = 0;
          while (free < len && y + 1 + free < h && !solid[i + (1 + free) * w] && !water[i + (1 + free) * w]) free++;
          if (free >= 5) vine[i + w] = free;
        }
      }
    }
  }
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
        const edge = !E(x - 1, y) || !E(x + 1, y) || !E(x, y - 1) || !E(x, y + 1);
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
              const rock = P.sandy ? null : rockAt(x, y, C);
              if (rock) col = rock;
              else if (P.sandy) {
                // arena: ondulaciones suaves del oleaje, granos más claros y oscuros y algún guijarro
                const rip = (((y + Math.round(Math.sin(x * 0.22) * 1.6)) % 8) + 8) % 8;
                const g = hash(x, y, 53);
                col = rip === 0 ? C.dirtLight : g < 0.07 ? C.stripe : g < 0.15 ? C.dirtLight : C.dirt;
                if (hash(x >> 2, y >> 2, 54) < 0.012 && hash(x, y, 55) < 0.6) col = C.rockHi;
              } else {
                const wv = Math.round(Math.sin(x * 0.33) * 1.5);
                const band = (((y + wv) % 7) + 7) % 7;
                if (band === 0) col = C.stripe;
                else if (band === 1 && hash(x >> 2, y, 4) < 0.5) col = C.dirtLight;
                else if (hash(x, y, 51) < 0.012) col = C.dirtLight; // motas de piedra suelta
                else col = C.dirt;
              }
              // la tierra se oscurece hacia el fondo de la isla (volumen) y junto al borde derecho/inferior (sombra)
              if (col === C.dirt || col === C.stripe || col === C.dirtLight) {
                const k = Math.min(1, Math.max(0, (depth[i] - 7) / 24)) * 0.3;
                if (k > 0) col = mixC(col, C.outline, k);
              }
            }
          } else if (m === 6) {
            // barro: marrón oscuro y brillante, con charcos y burbujas
            if (openAbove && dd === 1) col = MUD.hi;
            else if (openAbove && dd <= 2) col = hash(x, y, 61) < 0.25 ? MUD.hi : MUD.wet;
            else col = hash(x, y, 62) < 0.05 ? MUD.hi : (((y + Math.round(Math.sin(x * 0.4) * 1.2)) % 6) === 0 ? MUD.dark : MUD.base);
          } else if (m === 7) {
            // arena movediza: remolinos pálidos y burbujas
            if (openAbove && dd === 1) col = QSAND.hi;
            else {
              const sw = (x + y * 2 + (x >> 2) * 3) % 9;
              col = hash(x, y, 63) < 0.04 ? QSAND.hi : sw < 2 ? QSAND.dark : QSAND.base;
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
        if (P.swampy && above && hash(x >> 1, y, 64) < 0.28) col = ALGAE; // algas y lentejas de agua en la superficie
        const wd = wdepth[i];
        if (!above && !above2) {
          // el agua se oscurece con la profundidad (hasta 35 %) y deja ver vetas de luz
          col = mixC(C.water, C.deepWater, Math.min(0.55, (wd - 2) / 14));
          if (hash(x >> 1, y, 5) < 0.05) col = C.waterMid;
          else if (wd <= 6 && (x + y * 3) % 11 === 0) col = C.waterHi; // destellos tipo cáusticas
        }
        // espuma donde el agua toca la tierra por los lados
        if (wd <= 3 && (S(x - 1, y) || S(x + 1, y))) col = C.foam;
        // poza de marea (Playa): aguas poco profundas, más claras junto a la arena y más turquesa en el centro
        else if (P.softWater && (S(x - 1, y) || S(x + 1, y) || S(x - 2, y) || S(x + 2, y) || S(x, y + 1) || S(x, y + 2))) col = mixC(col, C.waterHi, 0.5);
      }
      // arena mojada alrededor de la poza: la orilla se ve más oscura
      if (hasWater && P.softWater && col && m && col !== C.outline) {
        let wet = false;
        for (let k = 1; k <= 2 && !wet; k++) wet = !!(Wt(x - k, y) || Wt(x + k, y) || Wt(x, y - k) || Wt(x, y + k));
        if (wet) col = mixC(col, C.outline, 0.2);
      }
      // estalactitas y enredaderas bajo las islas
      if (!col && !water[i] && y > 0) {
        for (let k = 1; k <= 14 && y - k + 1 >= 0; k++) {
          const top = (y - k + 1) * w + x; // primer píxel bajo el borde de la isla
          const len = under[top];
          if (len >= k && k <= 5) {
            const lN = x > 0 ? under[top - 1] : 0;
            const lP = x < w - 1 ? under[top + 1] : 0;
            col = k === len || lN < k || lP < k ? C.outline : hash(x, y, 45) < 0.3 ? C.dirt : C.stripe;
            break;
          }
          const vl = vine[top];
          if (vl >= k) {
            // enredadera: hilo verde con hojitas alternas; la punta termina en hoja
            col = k === vl ? C.grassHi : k % 3 === 0 ? C.grass : C.grassDark;
            break;
          }
        }
        // hojitas a los lados de la enredadera
        if (!col) {
          for (const dx of [-1, 1]) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            for (let k = 2; k <= 14 && y - k + 1 >= 0; k++) {
              const vl = vine[(y - k + 1) * w + nx];
              if (vl >= k && k % 3 === 0 && hash(nx, y, 46) < 0.8) {
                col = C.grass;
                break;
              }
              if (vl >= k) break;
            }
            if (col) break;
          }
        }
      }
      // briznas de hierba que asoman por encima del contorno
      if (!col && !water[i] && !P.sandy && y + 1 < h && solid[i + w] === 1 && hash(x, y, 11) < 0.42) {
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
    (x, y) => {
      const ch = cell(x, y);
      if (ch === 'W') return true;
      // la mitad vacía de una rampa pegada al agua se llena de agua: la pendiente baja suave hasta la poza
      if ((ch === '{' || ch === '}' || ch === '/' || ch === '\\') && !cellSolid(ch, x % T, y % T)) return cell(x - T, y) === 'W' || cell(x + T, y) === 'W';
      return false;
    },
    (x, y) => {
      const ch = cell(x, y);
      return ch !== '/' && ch !== '\\' && ch !== '{' && ch !== '}';
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
