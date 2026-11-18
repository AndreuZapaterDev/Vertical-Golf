import Phaser from 'phaser';
import { THEMES } from '../constants';
import { SKINS } from '../data/upgrades';
import { canvasTexture } from './terrain';

/**
 * Sprites e interfaz en pixel art generados por código.
 * El terreno se pinta aparte (gfx/terrain.ts).
 * Si más adelante usas sprites dibujados a mano, cárgalos en BootScene con la misma clave:
 * make() no sobrescribe texturas existentes.
 */

type Ctx = CanvasRenderingContext2D;
/** píxel a píxel: devuelve un color CSS o null/'' para dejarlo vacío */
type PixelFn = (x: number, y: number) => string | null | undefined | false | 0;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx, w: number, h: number) => void, linear = false) {
  if (scene.textures.exists(key)) return key;
  const tex = canvasTexture(scene, key, w, h);
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  draw(c, w, h);
  tex.refresh();
  if (linear) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

function makeFrames(scene: Phaser.Scene, key: string, fw: number, fh: number, n: number, draw: (c: Ctx, i: number) => void) {
  if (scene.textures.exists(key)) return key;
  const tex = canvasTexture(scene, key, fw * n, fh);
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  for (let i = 0; i < n; i++) {
    c.save();
    c.translate(i * fw, 0);
    c.beginPath();
    c.rect(0, 0, fw, fh);
    c.clip();
    draw(c, i);
    c.restore();
    tex.add(i, 0, i * fw, 0, fw, fh);
  }
  tex.refresh();
  return key;
}

const px = (c: Ctx, x: number, y: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x, y, 1, 1);
};
const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};

function blendHex(a: string, b: string, t: number) {
  const from = Number.parseInt(a.slice(1), 16);
  const to = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) * (1 - t) + ((to >> shift) & 0xff) * t);
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

function mask(c: Ctx, w: number, h: number, fn: PixelFn, outline?: string | null) {
  const grid: ReturnType<PixelFn>[] = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = fn(x, y);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = grid[y * w + x];
      if (typeof col === 'string' && col) px(c, x, y, col);
      else if (outline && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) px(c, x, y, outline);
    }
  }
}

function bitmap(c: Ctx, x: number, y: number, rows: string[], pal: Record<string, string | undefined>) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = pal[row[i]];
      if (col) px(c, x + i, y + j, col);
    }
  });
}

function inPoly(pts: [number, number][], x: number, y: number) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function radial(c: Ctx, x: number, y: number, r: number, stops: [number, string][]) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

export function generateTextures(scene: Phaser.Scene) {
  // --- suaves
  make(scene, 'glow', 64, 64, (c) => {
    c.fillStyle = radial(c, 32, 32, 32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]);
    c.fillRect(0, 0, 64, 64);
  }, true);
  make(scene, 'vignette', 64, 64, (c) => {
    c.fillStyle = radial(c, 32, 32, 46, [[0, 'rgba(20,10,30,0)'], [0.6, 'rgba(20,10,30,0)'], [1, 'rgba(20,10,30,0.35)']]);
    c.fillRect(0, 0, 64, 64);
  }, true);
  make(scene, 'ray', 32, 128, (c) => {
    for (let x = 0; x < 32; x++) {
      const a = Math.exp(-(((x - 16) / 7) ** 2));
      const g = c.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, 1, 128);
    }
  }, true);

  // --- fondo de cuadros por mundo
  for (const [k, T] of Object.entries(THEMES)) {
    make(scene, `checker-${k}`, 72, 72, (c) => {
      rect(c, 0, 0, 72, 72, T.bgA);
      rect(c, 36, 0, 36, 36, T.bgB);
      rect(c, 0, 36, 36, 36, T.bgB);
    });
  }

  // --- bola (10 px, 4 frames de rodadura)
  const base = [
    '...oooo...',
    '..owwwwo..',
    '.owhhwwso.',
    'owhwwwwwso',
    'owwwwwwwso',
    'owwwwwwwso',
    'owwwwwwsso',
    '.owwwwsso.',
    '..osssso..',
    '...oooo...',
  ];
  const dimples = [[[3, 4], [6, 6], [5, 3]], [[4, 5], [6, 3], [3, 7]], [[5, 4], [3, 6], [7, 6]], [[4, 3], [6, 5], [4, 7]]];
  makeFrames(scene, 'ball', 10, 10, 4, (c, f) => {
    bitmap(c, 0, 0, base, { o: '#3a3550', w: '#ffffff', h: '#ffffff', s: '#d3d8e6' });
    for (const [x, y] of dimples[f]) px(c, x, y, '#dfe3ee');
  });
  // una textura por bola comprable (misma forma, otra paleta o efecto)
  for (const skin of SKINS) {
    const P = skin.pal;
    makeFrames(scene, `ball-${skin.id}`, 10, 10, 4, (c, f) => {
      bitmap(c, 0, 0, base, { o: P.o, w: P.w, h: '#ffffff', s: P.s });
      const inside = (x: number, y: number) => base[y][x] === 'w' || base[y][x] === 's';
      if (skin.pattern === 'stripes') {
        for (const x of [3, 6]) for (let y = 1; y < 9; y++) if (inside(x, y)) px(c, x, y, P.d);
      } else if (skin.pattern === 'dots') {
        // estrellitas que giran con la bola
        for (const [x, y] of [[2, 3], [6, 2], [4, 6], [7, 5], [3, 8]]) {
          const xx = 1 + ((x + f * 2) % 8);
          if (inside(xx, y)) px(c, xx, y, (x + y) % 3 ? P.d : '#ffd36b');
        }
      } else {
        for (let y = 1; y < 9; y++) {
          for (let x = 1; x < 9; x++) {
            if (!inside(x, y)) continue;
            if (skin.pattern === 'gradient') px(c, x, y, blendHex(P.w, P.s, (x - 1) / 7));
            else if (skin.pattern === 'shimmer') px(c, x, y, blendHex(P.w, P.s, ((x + y + f * 3) % 10) / 9));
            else if (skin.pattern === 'prism') {
              const colors = [P.w, P.s, P.d, '#76f5e8', '#ff65c4'];
              const band = Math.floor((x + y * 2 + f * 3) / 2) % colors.length;
              px(c, x, y, colors[band]);
            }
          }
        }
        for (const [x, y] of dimples[f]) px(c, x, y, P.d);
      }
    });
  }

  // moneda
  make(scene, 'coin', 9, 9, (c) =>
    bitmap(c, 0, 0, [
      '..ooooo..', '.oyyyyyo.', 'oywwyyydo', 'oywyyyydo', 'oyyyyyydo', 'oyyyyyydo', 'oyyyyyddo', '.oddddddo', '..ooooo..',
    ], { o: '#7a4a10', y: '#ffd36b', w: '#fff6cc', d: '#e0962a' }),
  );

  // ficha del gachapón
  make(scene, 'token', 9, 9, (c) =>
    bitmap(c, 0, 0, [
      '..ooooo..', '.oppppqo.', 'oppwppqqo', 'opwwwpqqo', 'oppwppqqo', 'opppppqqo', 'oqpppqqqo', '.oqqqqqo.', '..ooooo..',
    ], { o: '#3a1d5a', p: '#b47aff', q: '#7a4ad0', w: '#ffffff' }),
  );
  // cápsula del gachapón (mitad de color arriba, blanca abajo); se tiñe la de arriba aparte
  make(scene, 'capsule-top', 22, 11, (c) =>
    mask(c, 22, 11, (x, y) => (Math.hypot(x + 0.5 - 11, y + 0.5 - 11) <= 10 ? (Math.hypot(x - 7, y - 4) < 3 ? '#ffffff' : '#e8e8e8') : null), '#35282c'),
  );
  make(scene, 'capsule-bottom', 22, 11, (c) =>
    mask(c, 22, 11, (x, y) => (Math.hypot(x + 0.5 - 11, y + 0.5) <= 10 ? (y > 6 ? '#d8d0d8' : '#fff8ec') : null), '#35282c'),
  );

  // iconos de las mejoras (13×13)
  const icon = (key: string, rows: string[], pal: Record<string, string>) => make(scene, key, 13, 13, (c) => bitmap(c, 0, 0, rows, { o: '#35282c', ...pal }));
  icon('up-power', [
    '......ooo....', '.....oyyo....', '....oyyo.....', '...oyyo......', '..oyyyyyyo...', '.oyyyyyyo....', '....oyyo.....',
    '...oyyo......', '..oyyo.......', '.oyyo........', 'oyyo.........', 'ooo..........', '.............',
  ], { y: '#ffd36b' });
  icon('up-aim', [
    '.............', '.......w.....', '.....w...w...', '...w.......w.', '..w.........w', '.w...........', '.w...........',
    'w....ooo.....', 'w...owwwo....', '....owwwo....', '....owwwo....', '.....ooo.....', '.............',
  ], { w: '#ffffff' });
  icon('up-grip', [
    '.............', '...oo.oo.oo..', '..oggoggoggo.', '..oggoggoggo.', '..oggoggoggo.', '.ooggggggggo.', 'oggggggggggo.',
    'ogggggggggo..', 'ogggggggggo..', '.oggggggggo..', '..oggggggo...', '...oooooo....', '.............',
  ], { g: '#ff9a6a' });
  icon('up-magnet', [
    '.............', '..ooo...ooo..', '.orro...orro.', '.orro...orro.', '.orro...orro.', '.orro...orro.', '.orro...orro.',
    '.orrooooorro.', '.orrrrrrrrro.', '..orrrrrrro..', '...ooooooo...', '.............', '.............',
  ], { r: '#ef4d5e' });
  icon('up-brake', [
    '....ooooo....', '...obbbbbo...', '..obbbbbbbo..', '.obbwwwwwbbo.', '.obbwwwwwbbo.', '.obbbbbbbbbo.', '.obbbbbbbbbo.',
    '..obbbbbbbo..', '...obbbbbo...', '....ooooo....', '.....o.o.....', '....o...o....', '.............',
  ], { b: '#ef4d5e', w: '#ffffff' });
  make(scene, 'up-shield', 13, 13, (c) =>
    mask(c, 13, 13, (x, y) => {
      const dx = x + 0.5 - 6.5;
      const dy = y + 0.5 - 6.5;
      const r = Math.hypot(dx, dy);
      if (r > 5.6 || r < 2.6) return null;
      return Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 2)) % 2 ? '#ef4d5e' : '#ffffff';
    }, '#35282c'),
  );
  icon('up-gem', [
    '.............', '.c...ooooo...', '..c.obwccdo..', '....bwcccddo.', '.c.occcccdeo.', '...occcccdeo.', '....occcdeo..',
    '.c...occdeo..', '......odeo...', '.......oo....', '..c..........', '.............', '.............',
  ], { b: '#ffffff', w: '#e0fbff', c: '#7fe3f5', d: '#4ab8ea', e: '#3a7fd6' });

  // --- hoyo y bandera
  make(scene, 'pole', 3, 30, (c) => {
    rect(c, 0, 3, 3, 27, '#3a3550');
    rect(c, 1, 3, 1, 27, '#f4f6fb');
    rect(c, 0, 0, 3, 3, '#f2b43a');
    px(c, 1, 1, '#ffe28a');
  });
  makeFrames(scene, 'flag', 14, 11, 4, (c, f) => {
    mask(c, 14, 11, (x, y) => {
      const wave = Math.round(Math.sin(x * 0.7 - f * (Math.PI / 2)));
      const top = 1 + wave;
      const bottom = 9 - Math.floor(x / 4) + wave;
      if (y < top || y > bottom || x > 12) return null;
      return y === bottom ? '#c4304a' : '#ef4d5e';
    }, '#3a3550');
  });
  make(scene, 'cup', 13, 4, (c) => bitmap(c, 0, 0, ['.ooooooooooo.', 'okkkkkkkkkkko', 'okkkkkkkkkkko', '.ooooooooooo.'], { o: '#35282c', k: '#141020' }));

  // --- seta (casilla de 12×6)
  make(scene, 'mushroom', 12, 7, (c) =>
    bitmap(c, 0, 0, [
      '..oooooooo..',
      '.orrwwrrrro.',
      'orwwrrrwwrro',
      'orrrrrrwwrro',
      'oddddddddddo',
      '.oyyyyyyyyo.',
      '..oooooooo..',
    ], { o: '#35282c', r: '#ef4d5e', w: '#ffffff', d: '#c4304a', y: '#ffe8cc' }),
  );

  // --- obstáculos
  makeFrames(scene, 'saw', 19, 19, 4, (c, f) => {
    mask(c, 19, 19, (x, y) => {
      const dx = x + 0.5 - 9.5;
      const dy = y + 0.5 - 9.5;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) / (Math.PI * 2) + f / 32;
      const tooth = (((a * 8) % 1) + 1) % 1;
      const R = tooth < 0.5 ? 8.6 - tooth * 2 : 7;
      if (r > R) return null;
      if (r > 5.5) return dx + dy < 0 ? '#ffffff' : '#c9d1e2';
      if (r > 3.8) return '#ef4d5e';
      if (r > 1.6) return '#3a3550';
      return '#c9d1e2';
    }, '#35282c');
  });
  for (const [key, ring, core, mid] of [
    ['bumper', '#ef4d5e', '#ffffff', '#ffd36b'],
    ['bumper-lit', '#ff9aa2', '#ffffff', '#fff3a0'],
  ]) {
    make(scene, key, 17, 17, (c) =>
      mask(c, 17, 17, (x, y) => {
        const dx = x + 0.5 - 8.5;
        const dy = y + 0.5 - 8.5;
        const r = Math.hypot(dx, dy);
        if (r > 7.6) return null;
        if (r > 5.4) return dx + dy < -3 ? '#ffffff' : ring;
        if (r > 3.2) return core;
        return mid;
      }, '#35282c'),
    );
  }
  make(scene, 'gem', 9, 9, (c) =>
    bitmap(c, 0, 0, [
      '..ooooo..',
      '.obwccdo.',
      'obwcccddo',
      'occccddeo',
      '.occcdeo.',
      '..ocdeo..',
      '...oeo...',
      '....o....',
    ], { o: '#35282c', b: '#ffffff', w: '#e0fbff', c: '#7fe3f5', d: '#4ab8ea', e: '#3a7fd6' }),
  );

  // --- partículas
  make(scene, 'px', 2, 2, (c) => rect(c, 0, 0, 2, 2, '#ffffff'));
  make(scene, 'spark', 5, 5, (c) => bitmap(c, 0, 0, ['..x..', '..x..', 'xxxxx', '..x..', '..x..'], { x: '#ffffff' }));
  makeFrames(scene, 'twinkle', 5, 5, 3, (c, f) => {
    const rows = [
      ['.....', '..x..', '.xwx.', '..x..', '.....'],
      ['..x..', '..x..', 'xxwxx', '..x..', '..x..'],
      ['.....', '.....', '..w..', '.....', '.....'],
    ][f];
    bitmap(c, 0, 0, rows, { x: '#ffffff', w: '#ffffff' });
  });
  make(scene, 'leaf', 4, 3, (c) => bitmap(c, 0, 0, ['.ab.', 'abbc', '.cc.'], { a: '#c8f070', b: '#86d35a', c: '#3d9a4a' }));
  make(scene, 'streak', 14, 1, (c) => {
    rect(c, 0, 0, 14, 1, 'rgba(255,255,255,0.6)');
    rect(c, 4, 0, 6, 1, '#ffffff');
  });
  make(scene, 'drop', 3, 3, (c) => bitmap(c, 0, 0, ['.a.', 'aba', '.a.'], { a: '#7cc4ee', b: '#ffffff' }));
  make(scene, 'petal', 3, 2, (c) => bitmap(c, 0, 0, ['ab.', '.bb'], { a: '#ffe0e8', b: '#ff9ab0' }));
  make(scene, 'wave', 5, 1, (c) => bitmap(c, 0, 0, ['.www.'], { w: '#ffffff' }));
  make(scene, 'bshadow', 10, 3, (c) => bitmap(c, 0, 0, ['..xxxxxx..', 'xxxxxxxxxx', '..xxxxxx..'], { x: '#000000' }));

  // nubes planas (fondo)
  const cloudBlobs = [
    [[9, 12, 7], [20, 8, 9], [32, 11, 7], [41, 14, 5]],
    [[8, 11, 6], [18, 7, 8], [28, 10, 6]],
    [[9, 13, 7], [21, 9, 9], [34, 7, 8], [46, 11, 7], [55, 14, 5]],
  ];
  cloudBlobs.forEach((blobs, i) => {
    const w = [48, 36, 62][i];
    make(scene, `cloud${i}`, w, 20, (c) =>
      mask(c, w, 20, (x, y) => {
        if (y > 18) return null;
        const inside = blobs.some(([bx, by, r]) => Math.hypot(x + 0.5 - bx, y + 0.5 - by) <= r) || (y >= 12 && y <= 18 && x > 5 && x < w - 5);
        if (!inside) return null;
        if (y >= 17) return '#dfe8f4';
        const hi = blobs.some(([bx, by, r]) => Math.hypot(x + 0.5 - (bx - 2), y + 0.5 - (by - 2)) <= r * 0.65);
        return hi ? '#ffffff' : '#f2f6fc';
      }, null),
    );
  });

  // decoración sobre la hierba (con contorno, como el terreno)
  makeFrames(scene, 'tuft', 8, 6, 2, (c, f) => {
    bitmap(c, 0, 0, f
      ? ['..o..o..', '.og.ogo.', '.ogoghgo', 'oggghggo', 'ogggggo.', '........']
      : ['.o..o...', 'ogo.og..', 'ogoghgo.', 'oggghggo', 'ogggggo.', '........'],
    { o: '#2c5a35', g: '#72d454', h: '#b4f282' });
  });
  const flowerCols = [['#ffffff', '#ffd36b'], ['#ff9ab0', '#fff1c1'], ['#ffd36b', '#ff8a5c']];
  flowerCols.forEach(([petal, center], i) => {
    makeFrames(scene, `flower${i}`, 7, 9, 2, (c, f) => {
      const o = f;
      bitmap(c, o, 0, ['.ooo.', 'opcpo', '.opo.', '..o..'], { o: '#35282c', p: petal, c: center });
      rect(c, 3, 3, 1, 5, '#2c5a35');
      px(c, 2, 5, '#72d454');
      px(c, 4, 6, '#72d454');
    });
  });
  make(scene, 'rock', 8, 5, (c) => bitmap(c, 0, 0, ['..oooo..', '.ohhbbo.', 'ohbbbbso', 'obbbbsso', '.oooooo.'], { o: '#35282c', h: '#f0dfc6', b: '#b09c88', s: '#6e5a58' }));
  make(scene, 'glowshroom', 7, 7, (c) =>
    bitmap(c, 0, 0, ['.ooooo.', 'ocwcbco', 'occccco', '.oosoo.', '...s...', '...s...', '..ooo..'], { o: '#1d2a5a', c: '#7fe3f5', w: '#ffffff', b: '#4ab8ea', s: '#e8e0f0' }),
  );

  generateSky(scene);
  generateUi(scene);
}

// ------------------------------------------------------------------ cielo y fondo lejano

/** Mezcla dos colores '#rrggbb' (k=0 → a, k=1 → b) */
function mix(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

function generateSky(scene: Phaser.Scene) {
  // Colinas lejanas (dos capas por mundo) para el parallax del inicio de cada hoyo
  for (const [k, T] of Object.entries(THEMES)) {
    const darkness = T.hillsDark || [0.14, 0.26];
    [[darkness[0], 0.9, 1.3, 3], [darkness[1], 1.7, 0.7, 11]].forEach(([dark, f1, f2, seed], layer) => {
      const w = 240;
      const h = 80;
      // la pradera tiene colinas verdes; de noche, siluetas oscuras para que no parezcan dibujos de línea
      const base = k === 'meadow' ? (layer ? '#8fd08a' : '#a8dcb0') : T.bgB;
      const body = mix(base, T.outline, dark);
      const rim = T.sky === 'night' ? mix(T.bgA, T.outline, 0.1) : mix(base, '#ffffff', 0.3);
      const FILL = 420; // la tierra de las colinas se prolonga hacia abajo y se funde con la neblina
      make(scene, `hills-${k}-${layer}`, w, h + FILL, (c) => {
        for (let x = 0; x < w; x++) {
          const a = (x / w) * Math.PI * 2;
          const top = Math.round(
            h * (layer ? 0.42 : 0.3) + Math.sin(a * f1 * 2 + seed) * 12 + Math.sin(a * f2 * 5 + seed * 2) * 6 + Math.sin(a * 11 + seed) * 1.5,
          );
          rect(c, x, top, 1, h + FILL - top, body);
          px(c, x, top, rim);
        }
        // neblina: la parte baja se aclara hacia el color del cielo
        const mist = c.createLinearGradient(0, h * 0.5, 0, h + FILL);
        mist.addColorStop(0, 'rgba(255,255,255,0)');
        mist.addColorStop(1, `rgba(255,255,255,${layer ? 0.55 : 0.7})`);
        c.globalCompositeOperation = 'source-atop';
        c.fillStyle = mist;
        c.fillRect(0, 0, w, h + FILL);
        c.globalCompositeOperation = 'source-over';
        // arbolitos en la capa cercana
        if (layer) {
          for (let i = 0; i < 9; i++) {
            const tx = (i * 53 + seed * 17) % w;
            const a = (tx / w) * Math.PI * 2;
            const top = Math.round(h * 0.42 + Math.sin(a * f1 * 2 + seed) * 12 + Math.sin(a * f2 * 5 + seed * 2) * 6 + Math.sin(a * 11 + seed) * 1.5);
            const tree = mix(body, T.outline, 0.25);
            rect(c, tx, top - 6, 1, 6, tree);
            rect(c, tx - 2, top - 9, 5, 4, tree);
            rect(c, tx - 1, top - 11, 3, 2, tree);
          }
        }
      });
    });
  }

  // Sol del atardecer: disco con franjas retro
  make(scene, 'sun-big', 44, 44, (c) =>
    mask(c, 44, 44, (x, y) => {
      const r = Math.hypot(x + 0.5 - 22, y + 0.5 - 22);
      if (r > 21) return null;
      if (y > 26 && (y - 26) % 5 >= 3 - Math.floor((y - 26) / 6)) return null;
      return y < 14 ? '#fff1a8' : y < 24 ? '#ffd36b' : y < 32 ? '#ffae5c' : '#ff8a5c';
    }, null),
  );
  // Sol de día: pequeño y suave
  make(scene, 'sun', 20, 20, (c) =>
    mask(c, 20, 20, (x, y) => {
      const r = Math.hypot(x + 0.5 - 10, y + 0.5 - 10);
      if (r > 9) return null;
      return r < 6 && x < 10 && y < 10 ? '#fffbe0' : '#fff1a8';
    }, null),
  );
  // Luna creciente
  make(scene, 'moon', 18, 18, (c) =>
    mask(c, 18, 18, (x, y) => {
      const r = Math.hypot(x + 0.5 - 9, y + 0.5 - 9);
      const r2 = Math.hypot(x + 0.5 - 13, y + 0.5 - 6);
      if (r > 8 || r2 < 7) return null;
      return r > 6.5 ? '#c8d0f4' : '#f2f4ff';
    }, null),
  );
  generateMeadow(scene);
  make(scene, 'star-px', 3, 3, (c) => bitmap(c, 0, 0, ['.x.', 'xwx', '.x.'], { x: 'rgba(255,255,255,0.55)', w: '#ffffff' }));
  // Pájaro (2 fotogramas de aleteo), blanco para teñirlo con el color del mundo
  makeFrames(scene, 'bird', 7, 4, 2, (c, f) =>
    bitmap(c, 0, 0, f ? ['.......', 'xx...xx', '..xxx..', '...x...'] : ['x.....x', '.x...x.', '..xxx..', '...x...'], { x: '#ffffff' }),
  );
}

// ------------------------------------------------------------------ pradera (campo de golf)

function generateMeadow(scene: Phaser.Scene) {
  const o = '#2f2a2c';
  // árbol redondo (copa con brillos) 22×28
  make(scene, 'tree-round', 22, 28, (c) => {
    mask(c, 22, 28, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y >= 17 && x >= 9 && x <= 12) return x === 9 ? '#9a6a44' : '#7a4e30'; // tronco
      const blobs = [[11, 9, 8], [6, 12, 5.5], [16, 12, 5.5], [11, 14, 6]];
      if (!blobs.some(([bx, by, r]) => Math.hypot(cx - bx, cy - by) <= r)) return null;
      if (Math.hypot(cx - 8, cy - 6) < 4) return '#9fe46c';
      if (cy > 15 || Math.hypot(cx - 15, cy - 13) < 4) return '#3f9a3c';
      return '#5cc04a';
    }, o);
  });
  // pino 16×30
  make(scene, 'tree-pine', 16, 30, (c) => {
    mask(c, 16, 30, (x, y) => {
      if (y >= 24 && x >= 7 && x <= 8) return '#7a4e30';
      if (y >= 24) return null;
      const tier = y < 9 ? y / 9 : y < 17 ? (y - 6) / 11 : (y - 13) / 11;
      const half = 1 + tier * 6.5;
      if (Math.abs(x + 0.5 - 8) > half) return null;
      return x < 8 ? '#4fae58' : '#2f8a46';
    }, o);
  });
  // arbusto 14×8
  make(scene, 'bush', 14, 8, (c) =>
    mask(c, 14, 8, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y > 6) return null;
      const inside = [[4, 5, 3.5], [8, 4, 4], [11, 5.5, 2.8]].some(([bx, by, r]) => Math.hypot(cx - bx, cy - by) <= r);
      if (!inside) return null;
      return Math.hypot(cx - 6, cy - 3) < 2 ? '#a6ec74' : cy > 5 ? '#3f9a3c' : '#5cc04a';
    }, o),
  );
  // valla blanca 12×8 (se repite)
  make(scene, 'fence', 12, 8, (c) =>
    bitmap(c, 0, 0, [
      '.o.....o....', 'owo...owo...', 'owooooowoooo', 'owwwwwwwwwww', 'owooooowoooo', 'owo...owo...', 'owo...owo...', 'ooo...ooo...',
    ], { o, w: '#fff8ec' }),
  );
  // marcas del tee (salida): bolitas de color
  for (const [k, col] of [['tee-red', '#ef4d5e'], ['tee-blue', '#4a86e0']]) {
    make(scene, k, 5, 5, (c) => bitmap(c, 0, 0, ['.ooo.', 'ohcco', 'occco', 'occco', '.ooo.'], { o, h: '#ffffff', c: col }));
  }
  // tee de madera bajo la bola
  make(scene, 'tee', 3, 4, (c) => bitmap(c, 0, 0, ['ooo', '.o.', '.o.', '.o.'], { o: '#f2d6a0' }));
}

// ------------------------------------------------------------------ interfaz

function frame(
  scene: Phaser.Scene,
  key: string,
  size: number,
  { outline, light, dark, fill, stud }: { outline: string; light: string; dark: string; fill: string; stud?: string },
) {
  make(scene, key, size, size, (c) => {
    const s = size;
    rect(c, 1, 0, s - 2, s, outline);
    rect(c, 0, 1, s, s - 2, outline);
    rect(c, 1, 1, s - 2, s - 2, light);
    rect(c, 2, 2, s - 3, s - 3, dark);
    rect(c, 2, 2, s - 4, s - 4, fill);
    if (stud) for (const [x, y] of [[3, 3], [s - 4, 3], [3, s - 4], [s - 4, s - 4]]) px(c, x, y, stud);
  });
}

function button9(scene: Phaser.Scene, key: string, face: string, light: string, dark: string, lip: string) {
  make(scene, key, 16, 18, (c) => {
    rect(c, 1, 0, 14, 18, '#35282c');
    rect(c, 0, 1, 16, 16, '#35282c');
    rect(c, 1, 1, 14, 15, lip);
    rect(c, 1, 1, 14, 12, face);
    rect(c, 2, 1, 12, 1, light);
    rect(c, 1, 2, 1, 10, light);
    rect(c, 2, 2, 3, 1, '#ffffff');
    rect(c, 14, 2, 1, 11, dark);
  });
}

const ICONS: Record<string, string[]> = {
  home: ['....x....', '...xxx...', '..xxxxx..', '.xxxxxxx.', 'xxxxxxxxx', '.xx...xx.', '.xx.x.xx.', '.xx.x.xx.', '.xxxxxxx.'],
  restart: ['..xxxx.x.', '.xx..xxx.', 'xx...xxx.', 'x........', 'x.......x', 'x.......x', 'xx.....xx', '.xx...xx.', '..xxxxx..'],
  sound: ['....x....', '...xx..x.', 'xxxxx...x', 'xxxxx.x.x', 'xxxxx.x.x', 'xxxxx...x', '...xx..x.', '....x....', '.........'],
  mute: ['....x....', '...xx....', 'xxxxx.x.x', 'xxxxx..x.', 'xxxxx.x.x', 'xxxxx....', '...xx....', '....x....', '.........'],
  back: ['...x.....', '..xx.....', '.xxxxxxxx', 'xxxxxxxxx', '.xxxxxxxx', '..xx.....', '...x.....', '.........', '.........'],
  pause: ['.........', '.xx...xx.', '.xx...xx.', '.xx...xx.', '.xx...xx.', '.xx...xx.', '.xx...xx.', '.xx...xx.', '.........'],
  eye: ['.........', '...xxx...', '.xx...xx.', 'x..xxx..x', 'x.xxxxx.x', 'x..xxx..x', '.xx...xx.', '...xxx...', '.........'],
  gear: ['...x.x...', '.x.xxx.x.', '..xxxxx..', 'xxxx.xxxx', '.xx...xx.', 'xxxx.xxxx', '..xxxxx..', '.x.xxx.x.', '...x.x...'],
};

function generateUi(scene: Phaser.Scene) {
  frame(scene, 'panel9', 12, { outline: '#35282c', light: '#fff4dc', dark: '#c8834f', fill: 'rgba(58,40,44,0.94)', stud: '#f2b43a' });
  frame(scene, 'hud9', 8, { outline: '#35282c', light: '#fff4dc', dark: '#b47143', fill: 'rgba(58,40,44,0.88)' });
  button9(scene, 'btn9-green', '#72d454', '#b4f282', '#4aa947', '#2c7a3a');
  button9(scene, 'btn9-blue', '#4a86e0', '#9cc8ff', '#3a6cc0', '#2a4e98');
  button9(scene, 'btn9-gold', '#f2b43a', '#ffe28a', '#d9922a', '#a8611f');
  button9(scene, 'btn9-white', '#fff8ec', '#ffffff', '#e8dcc8', '#c8a888');
  button9(scene, 'btn9-orange', '#ff8a5c', '#ffc59a', '#e06a44', '#b04a3a');
  button9(scene, 'btn9-purple', '#7a6ad0', '#b4a8ff', '#5e50a8', '#40387a');
  button9(scene, 'btn9-gray', '#8a8494', '#b4aec0', '#6e6878', '#4e4858');

  for (const [name, rows] of Object.entries(ICONS)) make(scene, `icon-${name}`, 9, 9, (c) => bitmap(c, 0, 0, rows, { x: '#35282c' }));

  const stars: [string, number, boolean][] = [
    ['star', 23, false],
    ['star-empty', 23, true],
    ['star-sm', 9, false],
    ['star-sm-empty', 9, true],
  ];
  for (const [key, size, empty] of stars) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? size / 4.4 : size / 2 - 0.5;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      pts.push([size / 2 + Math.cos(a) * r, size / 2 + size * 0.04 + Math.sin(a) * r]);
    }
    make(scene, key, size, size, (c) =>
      mask(c, size, size, (x, y) => {
        if (!inPoly(pts, x + 0.5, y + 0.5)) return null;
        if (empty) return y > size * 0.6 ? '#5a4448' : '#6e5458';
        if (size > 10 && x < size * 0.45 && y < size * 0.45 && x + y > size * 0.45) return '#fff8d0';
        return y > size * 0.62 ? '#f2b43a' : y > size * 0.4 ? '#ffd36b' : '#ffe28a';
      }, '#35282c'),
    );
  }

  make(scene, 'lock', 9, 11, (c) =>
    bitmap(c, 0, 0, ['..aaaaa..', '.a.....a.', '.a.....a.', '.a.....a.', 'bbbbbbbbb', 'bcccccccb', 'bccc.cccb', 'bccc.cccb', 'bcccccccb', 'bbbbbbbbb', '.........'],
      { a: '#e8dcc8', b: '#35282c', c: '#fff8ec' }),
  );
  make(scene, 'hand', 11, 13, (c) =>
    bitmap(c, 0, 0, [
      '...oo......', '..owwo.....', '..owwo.....', '..owwooo...', '..owwowwoo.', 'oooowwowwo.', 'owwowwwwwwo',
      'owwwwwwwwwo', '.owwwwwwwwo', '.owwwwwwwo.', '..owwwwwwo.', '...owwwwo..', '...oooooo..',
    ], { o: '#35282c', w: '#ffffff' }),
  );
}
