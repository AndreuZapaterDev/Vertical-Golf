import Phaser from 'phaser';
import { THEMES, W, H } from '../constants';
import { SKINS, blendHex, type Skin } from '../data/upgrades';
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
  // luz desde arriba a la izquierda: 0 brillo, 1 luz, 2 medio, 3 sombra (cada píxel de la esfera)
  const shadeAt = (x: number, y: number) => {
    const dx = (x - 4.5) / 4.5;
    const dy = (y - 4.5) / 4.5;
    const lum = (-0.55 * dx - 0.75 * dy) * 0.7 + Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy)) * 0.5;
    return lum > 0.78 ? 0 : lum > 0.34 ? 1 : lum > 0 ? 2 : 3;
  };
  const patterns: Record<string, (u: number, y: number, f: number, P: Skin['pal']) => string | null> = {
    checker: (u, y, _f, P) => (((u >> 1) + (y >> 1)) % 2 ? P.d : null),
    bands: (_u, y, _f, P) => (y % 4 === 2 ? P.d : null),
    split: (u, _y, _f, P) => (u % 8 < 4 ? P.d : null),
    zigzag: (u, y, _f, P) => ((u + [0, 1, 2, 1][y % 4] * 2) % 4 === 0 ? P.d : null),
    swirl: (u, y, _f, P) => ((u + y) % 4 === 0 ? P.d : (u + y) % 4 === 2 ? blendHex(P.d, P.s, 0.55) : null),
    stars: (u, y, f, P) => (['2,3', '6,2', '4,6', '7,5', '1,7', '5,0'].includes(`${u % 8},${y}`) ? (f % 2 ? '#ffffff' : P.d) : null),
    flame: (u, y, f, P) => (y >= 9 - [2, 3, 1, 3, 2, 1, 3, 2][u % 8] - (f % 2) ? (y >= 8 ? '#ffffff' : P.d) : null),
    glitch: (u, y, f, P) => (y === 3 + (f % 2) * 3 ? '#ffffff' : y % 3 === 0 && (u + y) % 5 < 2 ? P.d : null),
    hex: (u, y, _f, P) => (y % 2 === 0 && (u + (y >> 1) * 2) % 4 === 0 ? P.d : null),
    ember: (u, y, _f, P) => ((u * 7 + y * 13) % 11 < 2 ? P.d : null),
    stripes: (u, _y, _f, P) => (u % 4 === 1 ? P.d : null),
  };
  const glints = [[7, 2], [8, 5], [6, 8], [2, 6]];
  for (const skin of SKINS) {
    const P = skin.pal;
    const flat = !skin.pattern || ['gradient', 'shimmer', 'prism'].includes(skin.pattern);
    makeFrames(scene, `ball-${skin.id}`, 10, 10, 4, (c, f) => {
      const inside = (x: number, y: number) => base[y][x] === 'w' || base[y][x] === 's' || base[y][x] === 'h';
      bitmap(c, 0, 0, base, { o: P.o });
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          if (!inside(x, y)) continue;
          const lvl = shadeAt(x, y);
          const u = x + f * 2; // el dibujo se desplaza con los fotogramas: parece que rueda
          let ink: string | null = null;
          let col = [blendHex(P.w, '#ffffff', 0.7), P.w, blendHex(P.w, P.s, 0.55), P.s][lvl];
          if (skin.pattern === 'gradient') ink = blendHex(P.w, P.s, (x - 1) / 7);
          else if (skin.pattern === 'shimmer') ink = blendHex(P.w, P.s, ((x + y + f * 3) % 10) / 9);
          else if (skin.pattern === 'prism') ink = [P.w, P.s, P.d, '#76f5e8', '#ff65c4'][Math.floor((x + y * 2 + f * 3) / 2) % 5];
          else if (skin.pattern === 'dots') {
            const dot = [[2, 3], [6, 2], [4, 6], [7, 5], [3, 8]].find(([dx, dy]) => 1 + ((dx + f * 2) % 8) === x && dy === y);
            if (dot) ink = (dot[0] + dot[1]) % 3 ? P.d : '#ffd36b';
          } else if (skin.pattern) ink = patterns[skin.pattern](u, y, f, P);
          if (ink) col = lvl === 0 ? blendHex(ink, '#ffffff', 0.45) : lvl === 1 ? ink : blendHex(ink, P.o, lvl === 2 ? 0.18 : 0.38);
          px(c, x, y, col);
        }
      }
      if (flat) for (const [x, y] of dimples[f]) px(c, x, y, blendHex(P.d, P.s, shadeAt(x, y) / 4));
      // destello viajero: solo en las skins épicas y legendarias
      if (skin.rarity === 'epic' || skin.rarity === 'legendary') {
        const [gx, gy] = glints[f];
        if (inside(gx, gy)) px(c, gx, gy, '#ffffff');
        if (skin.rarity === 'legendary' && inside(gx - 1, gy)) px(c, gx - 1, gy, blendHex(P.d, '#ffffff', 0.6));
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
  // Cortavientos: tres ráfagas
  icon('up-wind', [
    '.............', '..ccccccc....', '.........cc..', '.........cc..', '..cccccc.c...', '.............', 'ccccccccccc..',
    '...........c.', '...........cc', '..........cc.', '.cccccccc....', '.............', '.............',
  ], { c: '#7fe3f5' });
  // Botas
  icon('up-boots', [
    '.............', '...ooooo.....', '...obbbo.....', '...obbbo.....', '...obbbo.....', '...obbbooo...', '...obbbbbbo..',
    '..obbbbbbbbo.', '..obbbbbbbbo.', '..ooooooooo..', '..owwwwwwwo..', '..ooooooooo..', '.............',
  ], { b: '#c8834f', w: '#fff4dc' });
  // Antihundimiento: bola sobre un remolino de arena
  icon('up-sink', [
    '.............', '.....ooo.....', '....owwwo....', '....owwwo....', '.....ooo.....', '..yyyyyyyyy..', '.ydddddddddy.',
    '..yyddddyyy..', '...yydddyy...', '....yyyyy....', '.....yyy.....', '.............', '.............',
  ], { w: '#ffffff', y: '#e6d99c', d: '#b8a468' });
  // Linterna
  icon('up-lantern', [
    '.....ooo.....', '....o...o....', '....ooooo....', '...ooyyyoo...', '...oyyYyyo...', '...oyYYYyo...', '...oyyYyyo...',
    '...ooyyyoo...', '....ooooo....', '.....ooo.....', '.............', '.............', '.............',
  ], { y: '#ffd36b', Y: '#fff6cc' });
  // Suela firme: bloque con grieta
  icon('up-crumble', [
    '.............', '.ooooooooooo.', '.obbbbbbbbbo.', '.obbbbbdbbbo.', '.obbbbdbbbbo.', '.obbbdbbbbbo.', '.obbbbdbbbbo.',
    '.obbbbbdbbbo.', '.obbbbbbdbbo.', '.obbbbbbbbbo.', '.ooooooooooo.', '.............', '.............',
  ], { b: '#e39880', d: '#8a5a3c' });
  // Segunda oportunidad: flecha que da la vuelta
  icon('up-mulligan', [
    '.............', '.....gggg....', '...gg....gg..', '..g........g.', '.ggg.......g.', 'ggggg......g.', '.ggg.......g.',
    '..g........g.', '...gg....gg..', '.....gggg....', '.............', '.............', '.............',
  ], { g: '#9ad8ff' });
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
        const isIn = (px: number, py: number) =>
          py >= 0 && py <= 18 && (blobs.some(([bx, by, r]) => Math.hypot(px + 0.5 - bx, py + 0.5 - by) <= r) || (py >= 12 && px > 5 && px < w - 5));
        if (!isIn(x, y)) return null;
        if (y >= 17) return '#c3d2e8'; // base de la nube
        if (y >= 15) return (x + y) % 2 ? '#d6e1f1' : '#dfe8f4'; // vientre en sombra, con tramado
        if (!isIn(x, y - 1)) return '#ffffff'; // borde superior iluminado
        const hi = blobs.some(([bx, by, r]) => Math.hypot(x + 0.5 - (bx - 2), y + 0.5 - (by - 2)) <= r * 0.65);
        return hi ? '#ffffff' : y >= 13 ? '#e6edf8' : '#f2f6fc';
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
  // --- Playa: palmera, concha, estrella de mar, mata de duna, cangrejo y mar
  make(scene, 'palm', 28, 36, (c) => {
    const cx = 14;
    const cy = 10;
    const leaf = new Map<string, number>(); // 1 = parte alta de la hoja, 2 = parte baja
    const mark = (x: number, y: number, v: number) => {
      if (x >= 0 && y >= 0 && x < 28 && y < 36) leaf.set(`${x},${y}`, v);
    };
    [-168, -140, -105, -75, -40, -12, 8, 180].forEach((deg) => {
      const a = (deg * Math.PI) / 180;
      const L = Math.abs(Math.cos(a)) > 0.6 ? 12 : 9;
      for (let t = 0; t <= 1; t += 0.02) {
        const x = cx + Math.cos(a) * L * t;
        const y = cy + Math.sin(a) * L * t * 0.7 + 8 * t * t * Math.abs(Math.cos(a));
        const th = 1.5 * (1 - t) + 0.7;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            if (Math.hypot(dx, dy) <= th) mark(Math.round(x + dx), Math.round(y + dy), dy < 0 || t < 0.3 ? 1 : 2);
          }
        }
      }
    });
    mask(c, 28, 36, (x, y) => {
      const l = leaf.get(`${x},${y}`);
      if (l) return l === 1 ? '#5ed06a' : '#2f9a4e';
      if (y >= cy + 1) {
        const tx = 13 + Math.round((y - cy) * 0.1);
        if (x >= tx && x <= tx + 1) return y % 4 === 0 ? '#6e4528' : x === tx ? '#c08a52' : '#8a5a34';
      }
      if ((x === 12 || x === 15) && y === cy + 2) return '#6e4528'; // cocos
      return null;
    }, '#3a5a2e');
  });
  make(scene, 'shell', 7, 4, (c) => bitmap(c, 0, 0, ['..ooo..', '.ophpo.', 'oppphpo', '.ooooo.'], { o: '#8a5a52', p: '#ffb8c8', h: '#fff0f4' }));
  make(scene, 'starfish', 8, 7, (c) =>
    bitmap(c, 0, 0, ['...oo...', '..oaao..', 'ooaaaaoo', '.oaahao.', '..oaao..', '.oao.oao', 'oo....oo'], { o: '#b8452e', a: '#ff9a62', h: '#ffd0a8' }));
  makeFrames(scene, 'dune-tuft', 8, 7, 2, (c, f) => {
    bitmap(c, 0, 0, f
      ? ['..o..o..', '.og.ogo.', '.ogoghgo', 'oggghggo', 'ogggggo.', '.ogggo..', '........']
      : ['.o..o...', 'ogo.og..', 'ogoghgo.', 'oggghggo', 'ogggggo.', '..oggo..', '........'],
    { o: '#6a6a30', g: '#c9c460', h: '#f0e8a0' });
  });
  makeFrames(scene, 'crab', 14, 9, 2, (c, f) => {
    bitmap(c, 0, 0, [
      'oo..o....o..oo',
      'oro.o....o.oro',
      '.oooooooooooo.',
      '.orrrrrrrrrro.',
      '..orrhrrhrro..',
      '..orrrrrrrro..',
      f ? '..ooooooooo...' : '.o.oooooooo.o.',
      f ? '.o.o.o..o.o.o.' : 'o..o.o..o.o..o',
      '..............',
    ].map((r) => r.slice(0, 14).padEnd(14, '.')), { o: '#6e2a24', r: '#ff6a4a', h: '#ffd0c0' });
  });
  // Playa: flotador hinchable (sustituye a la seta) y coral (sustituye al bumper)
  make(scene, 'float', 12, 7, (c) =>
    bitmap(c, 0, 0, [
      '...oooooo...',
      '..orrwwrro..',
      '.orwwrrwwro.',
      'orwwroorwwro',
      '.orrwwwwrro.',
      '..oooooooo..',
      '............',
    ], { o: '#8a2a2a', r: '#ff5a4a', w: '#ffffff' }));
  for (const [key, ring, core] of [['coral', '#ff6f91', '#ffe4ec'], ['coral-lit', '#ffb3c6', '#ffffff']] as const) {
    make(scene, key, 17, 17, (c) =>
      mask(c, 17, 17, (x, y) => {
        const dx = x + 0.5 - 8.5;
        const dy = y + 0.5 - 8.5;
        const r = Math.hypot(dx, dy);
        if (r > 7.6) return null;
        if (r > 5.4) return dx + dy < -3 ? '#ffd0dc' : (x * 7 + y * 3) % 5 === 0 ? '#e24a73' : ring;
        if (r > 3.2) return (x + y) % 3 === 0 ? '#e24a73' : '#ffd36b';
        return core;
      }, '#7a2a4a'));
  }
  // --- Pantano: ciprés con musgo, juncos, nenúfares, rana, seta luminosa, esporas, fango y niebla
  make(scene, 'cypress', 26, 38, (c) => {
    mask(c, 26, 38, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // tronco acampanado en la base
      const tw = 2.2 + Math.max(0, (y - 26)) * 0.35;
      if (y >= 14 && Math.abs(cx - 13) <= tw) return x < 13 ? '#6a4c30' : '#4a3422';
      // copa en varias masas
      const blobs: [number, number, number][] = [[13, 9, 8], [7, 13, 5], [19, 13, 5], [13, 15, 6], [10, 5, 4], [16, 5, 4]];
      const hit = blobs.some(([bx, by, r]) => Math.hypot(cx - bx, cy - by) <= r);
      if (hit) return cy < 8 && cx < 13 ? '#4f8a3a' : cy > 14 ? '#2c5a2c' : '#3b7234';
      // musgo que cuelga
      if (y >= 15 && y < 27 && [5, 8, 11, 15, 18, 21].includes(x) && y < 17 + ((x * 7) % 9)) return y % 3 === 0 ? '#9bc46a' : '#6f9a4a';
      return null;
    }, '#14301c');
  });
  makeFrames(scene, 'reed', 7, 14, 2, (c, f) => {
    const o = f ? 1 : 0;
    rect(c, 3 + o, 5, 1, 9, '#4c7430');
    rect(c, 2, 7, 1, 7, '#3b5c26');
    rect(c, 5, 9, 1, 5, '#3b5c26');
    rect(c, 2 + o, 1, 3, 5, '#6a4426');
    rect(c, 3 + o, 0, 1, 1, '#6a4426');
    rect(c, 2 + o, 2, 1, 2, '#8a5a34');
    px(c, 5 + o, 6, '#8aa85a');
  });
  make(scene, 'lilypad', 10, 4, (c) => {
    bitmap(c, 0, 0, ['.oooooo...', 'ogggggggo.', '.oggghggo.', '..oooooo..'], { o: '#1f4a24', g: '#4aa04a', h: '#8fd46a' });
    px(c, 6, 0, '#ff9ac8'); px(c, 7, 0, '#ffd0e4');
  });
  // nenúfar que se hunde: sustituye a los bloques frágiles en el pantano (un parche de nenúfares por casilla)
  make(scene, 'lilyblock', 12, 12, (c) => {
    rect(c, 0, 0, 12, 7, '#3f8a3f');
    rect(c, 0, 0, 12, 1, '#9bd46a');
    rect(c, 0, 6, 12, 1, '#1f4a24');
    rect(c, 5, 1, 2, 3, '#1f4a24');
    for (const [x, y] of [[2, 3], [8, 4], [10, 2]]) px(c, x, y, '#2c6a2c');
    px(c, 3, 1, '#ff9ac8'); px(c, 4, 1, '#ffd0e4');
    rect(c, 0, 7, 12, 2, '#244f2c');
  });
  makeFrames(scene, 'frog', 12, 10, 2, (c, f) => {
    bitmap(c, 0, f ? 0 : 1, [
      '.oo......oo.',
      'owwo....owwo',
      'owko.oo.okwo',
      '.oggggggggo.',
      'oggghgghgggo',
      'ogggggggggo.',
      f ? 'oo.oggggo.oo' : '.ogoggggogo.',
      f ? 'o...o..o...o' : 'oo.oo..oo.oo',
    ].map((r) => r.slice(0, 12).padEnd(12, '.')), { o: '#1f4a24', g: '#5fc04a', h: '#b8ee80', w: '#ffffff', k: '#101810' });
  });
  make(scene, 'glowcap', 12, 7, (c) =>
    bitmap(c, 0, 0, [
      '..oooooooo..',
      '.ocwcccbbco.',
      'ocwwccccbbco',
      'occccwcccbco',
      'oddddddddddo',
      '.ossssssssso.',
      '..oooooooo..',
    ], { o: '#0f3a3a', c: '#3fe0c0', w: '#ffffff', b: '#1fa890', d: '#0f6a62', s: '#b8f0e0' }));
  for (const [key, ring, core] of [['spore', '#9a6ad0', '#e6d0ff'], ['spore-lit', '#d0a8ff', '#ffffff']] as const) {
    make(scene, key, 17, 17, (c) =>
      mask(c, 17, 17, (x, y) => {
        const dx = x + 0.5 - 8.5;
        const dy = y + 0.5 - 8.5;
        const r = Math.hypot(dx, dy);
        if (r > 7.6) return null;
        if (r > 5.4) return dx + dy < -3 ? '#e6d0ff' : (x * 5 + y * 7) % 6 === 0 ? '#6a3aa0' : ring;
        if (r > 3.2) return (x + y) % 3 === 0 ? '#6a3aa0' : '#7fe0b0';
        return core;
      }, '#2a1a4a'));
  }
  // fango del fondo (se repite en horizontal bajo las islas, como el mar de la Playa)
  make(scene, 'bog', 48, 40, (c) => {
    for (let x = 0; x < 48; x++) {
      const wy = 1 + Math.round(Math.sin((x / 48) * Math.PI * 3));
      rect(c, x, wy, 1, 40 - wy, '#3a6a4c');
      rect(c, x, 14, 1, 26, '#2c5a3e');
      rect(c, x, 28, 1, 12, '#1f4a30');
      px(c, x, wy, '#8ac88a');
    }
    for (const [x, y] of [[4, 3], [13, 2], [24, 3], [33, 2], [41, 3]]) rect(c, x, y, 3, 1, '#8fd454'); // lentejas de agua
    for (const [x, y] of [[8, 9], [28, 11], [38, 8]]) { px(c, x, y, '#9ad69a'); px(c, x + 1, y - 1, '#9ad69a'); }
  });
  // niebla: velo con un claro redondo en el centro (se coloca sobre la bola)
  make(scene, 'fog', 256, 256, (c) => {
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(120,150,130,0)');
    g.addColorStop(0.16, 'rgba(120,150,130,0)');
    g.addColorStop(0.34, 'rgba(120,150,130,0.9)');
    g.addColorStop(1, 'rgba(120,150,130,0.9)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
  }, true);
  // --- hitos del mapa de hoyos: molino (con aspas aparte, para girar), faro y velero
  make(scene, 'windmill', 16, 24, (c) =>
    mask(c, 16, 24, (x, y) => {
      const cx = x + 0.5;
      if (y < 7) {
        const half = (y + 1) * 0.95;
        return Math.abs(cx - 8) <= half ? (x < 8 ? '#e84a4a' : '#b83030') : null;
      }
      const half = 3.4 + (y - 7) * 0.45;
      if (Math.abs(cx - 8) > half) return null;
      if (y >= 19 && Math.abs(cx - 8) < 1.6) return '#5a3a24';
      if (y >= 11 && y <= 13 && Math.abs(cx - 8) < 1.1) return '#7fd0f0';
      return x < 8 ? '#f0e0c0' : '#d8c4a0';
    }, '#4a3322'));
  make(scene, 'blades', 26, 26, (c) =>
    mask(c, 26, 26, (x, y) => {
      const dx = x + 0.5 - 13;
      const dy = y + 0.5 - 13;
      for (let r = 0; r < 4; r++) {
        const u = r === 0 ? dx : r === 1 ? dy : r === 2 ? -dx : -dy;
        const v = r === 0 ? dy : r === 1 ? -dx : r === 2 ? -dy : dx;
        if (Math.abs(u) <= 1.1 && Math.abs(v) <= 12) return '#7a5030';
        if (u >= 1.1 && u <= 4.8 && v >= 3.5 && v <= 11.5) return '#fff6e0';
      }
      return null;
    }, '#4a3322'));
  make(scene, 'lighthouse', 12, 32, (c) =>
    mask(c, 12, 32, (x, y) => {
      const cx = x + 0.5;
      if (y < 4) return Math.abs(cx - 6) <= 2.6 - (y < 1 ? 1.6 : 0) ? '#e84a4a' : null; // techo
      if (y < 9) return Math.abs(cx - 6) <= 2.8 ? (y > 5 && y < 8 ? '#ffe070' : '#7a6a58') : null; // linterna
      const half = 2.6 + (y - 9) * 0.16;
      if (Math.abs(cx - 6) > half) return null;
      return Math.floor((y - 9) / 4) % 2 ? '#e84a4a' : x < 6 ? '#ffffff' : '#d8dce8';
    }, '#4a3322'));
  make(scene, 'sailboat', 16, 16, (c) =>
    mask(c, 16, 16, (x, y) => {
      const cx = x + 0.5;
      if (y >= 12 && y <= 14) return Math.abs(cx - 8) <= 6.5 - (y - 12) * 1.6 ? '#8a5a34' : null; // casco
      if (y >= 2 && y < 12) {
        const half = (y - 2) * 0.55;
        if (cx > 8 && cx - 8 <= half) return '#ffffff';
        if (cx < 8 && 8 - cx <= half * 0.55) return '#e8ecf4';
      }
      if (x === 8 && y >= 1 && y <= 12) return '#4a3322';
      return null;
    }, '#4a3322'));
  // --- detalles del mapa de hoyos: cabaña, chiringuito de playa, cabaña sobre pilotes, muelle, barca, oveja y cartel de madera
  make(scene, 'cabin', 20, 18, (c) =>
    mask(c, 20, 18, (x, y) => {
      const cx = x + 0.5;
      if (y < 8) {
        const half = 2 + y * 1.15;
        if (Math.abs(cx - 10) > half) return y >= 2 && y <= 5 && x >= 14 && x <= 16 ? '#8a8090' : null; // chimenea
        return x < 10 ? '#c0603a' : '#9a4a2c';
      }
      if (Math.abs(cx - 10) > 8.2) return null;
      if (y >= 11 && Math.abs(cx - 10) < 2) return '#5a3a24';
      if (y >= 9 && y <= 11 && Math.abs(cx - 5.5) < 1.6) return '#7fd0f0';
      return y % 3 === 0 ? '#b8905c' : '#d8b078';
    }, '#4a3322'));
  make(scene, 'beachhut', 20, 20, (c) =>
    mask(c, 20, 20, (x, y) => {
      const cx = x + 0.5;
      if (y < 9) {
        const half = 1.5 + y * 1.1;
        return Math.abs(cx - 10) <= half ? ((x + y) % 3 === 0 ? '#c0902c' : '#e0b84a') : null;
      }
      if (y >= 9 && y < 19 && (Math.abs(cx - 4) < 1 || Math.abs(cx - 16) < 1)) return '#7a5030';
      if (y >= 14 && y <= 16 && cx > 6 && cx < 14) return x % 4 < 2 ? '#e84a4a' : '#ffffff'; // toalla
      return null;
    }, '#4a3322'));
  make(scene, 'stilthut', 20, 26, (c) =>
    mask(c, 20, 26, (x, y) => {
      const cx = x + 0.5;
      if (y < 7) {
        const half = 2 + y * 1.2;
        return Math.abs(cx - 10) <= half ? (x < 10 ? '#4f7a3c' : '#3a5c2c') : null;
      }
      if (y < 15) {
        if (Math.abs(cx - 10) > 7.2) return null;
        if (y >= 9 && y <= 12 && Math.abs(cx - 10) < 1.8) return '#ffe070';
        return y % 3 === 0 ? '#6a5034' : '#8a6a44';
      }
      if (y === 15) return Math.abs(cx - 10) <= 8.5 ? '#6a4626' : null;
      return Math.abs(cx - 4) < 0.9 || Math.abs(cx - 16) < 0.9 ? '#4a3422' : null;
    }, '#1f1a12'));
  make(scene, 'pier', 28, 8, (c) => {
    rect(c, 0, 2, 28, 3, '#b8864e');
    rect(c, 0, 2, 28, 1, '#d8a868');
    rect(c, 0, 4, 28, 1, '#8a5a34');
    for (let x = 3; x < 28; x += 4) rect(c, x, 2, 1, 3, '#7a4c28');
    for (const x of [2, 12, 22]) rect(c, x, 5, 2, 3, '#5a3a24');
    rect(c, 0, 1, 28, 1, '#4a3322');
    rect(c, 0, 5, 28, 1, '#4a3322');
  });
  make(scene, 'rowboat', 14, 8, (c) =>
    mask(c, 14, 8, (x, y) => {
      const cx = x + 0.5;
      if (y >= 3 && y <= 6) return Math.abs(cx - 7) <= 6.2 - (y - 3) * 1.4 ? (y === 3 ? '#6a4626' : '#9a6a3c') : null;
      if (y === 2 && (x === 4 || x === 9)) return '#4a3322';
      if (x >= 2 && x <= 12 && y === 1 && (x === 3 || x === 11)) return '#7a5030';
      return null;
    }, '#4a3322'));
  make(scene, 'sheep', 12, 10, (c) =>
    mask(c, 12, 10, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot((cx - 6) / 4.8, (cy - 4.5) / 3.6) <= 1) return cy < 4 ? '#ffffff' : '#e4e8f0';
      if (x >= 9 && x <= 11 && y >= 3 && y <= 6) return '#3a3340';
      if ((x === 3 || x === 8) && y >= 8 && y <= 9) return '#3a3340';
      return null;
    }, '#3a3340'));
  make(scene, 'signboard', 62, 22, (c) => {
    rect(c, 9, 14, 3, 8, '#5a3a24');
    rect(c, 50, 14, 3, 8, '#5a3a24');
    rect(c, 3, 2, 56, 14, '#4a3322');
    rect(c, 4, 3, 54, 12, '#c8905a');
    rect(c, 4, 3, 54, 1, '#e0b078');
    rect(c, 4, 14, 54, 1, '#9a6a3c');
    for (const x of [6, 55]) px(c, x, 5, '#4a3322');
  });
  // --- emblemas y decorados de los mundos futuros (para el mapa de mundos)
  make(scene, 'pyramid', 24, 20, (c) =>
    mask(c, 24, 20, (x, y) => {
      const cx = x + 0.5;
      const half = 0.6 + y * 0.6;
      if (Math.abs(cx - 12) > half) return null;
      if (y >= 14 && Math.abs(cx - 12) < 1.6) return '#3a2410';
      return cx < 12 ? (y % 4 === 3 ? '#d0aa60' : '#ecca7c') : (y % 4 === 3 ? '#a8803c' : '#c8a050');
    }, '#6a4a2a'));
  make(scene, 'cavearch', 22, 22, (c) =>
    mask(c, 22, 22, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y < 6 || Math.hypot((cx - 11) / 10.5, (cy - 20) / 15) > 1) return null;
      if (Math.hypot((cx - 11) / 4.4, (cy - 21) / 8.4) < 1) return '#080a10';
      if ((x === 4 || x === 17) && y >= 8 && y <= 12) return '#7ae8e8';
      return x < 11 ? '#7a7a8c' : '#5a5a6c';
    }, '#0f1218'));
  make(scene, 'icepeak', 24, 28, (c) =>
    mask(c, 24, 28, (x, y) => {
      const cx = x + 0.5;
      const half = y * 0.42 + (y > 8 && y % 5 === 0 ? 1 : 0);
      if (Math.abs(cx - 12) > half) return null;
      if (y < 9) return cx < 12 ? '#ffffff' : '#e8f2ff';
      return cx < 12 ? '#cfe6f8' : '#9cc4e4';
    }, '#2a4a6a'));
  make(scene, 'volcano', 26, 28, (c) =>
    mask(c, 26, 28, (x, y) => {
      const cx = x + 0.5;
      if (y < 4) return null;
      const half = 3 + (y - 4) * 0.46;
      if (Math.abs(cx - 13) > half) return null;
      if (y >= 4 && y <= 6 && Math.abs(cx - 13) < half - 0.5) return y === 4 ? '#ffe070' : '#ff8a2a';
      if (Math.abs(cx - 13) < 1 && y > 6 && y < 20) return '#ff7a2a';
      return cx < 13 ? '#6a4a44' : '#3e2622';
    }, '#120808'));
  make(scene, 'tank', 20, 12, (c) =>
    mask(c, 20, 12, (x, y) => {
      const cx = x + 0.5;
      if (y >= 8 && y <= 11 && cx > 1.5 && cx < 18.5) return y === 11 ? '#2a2a24' : '#3a3a30'; // orugas
      if (y >= 5 && y <= 8 && cx > 3 && cx < 17) return '#6a7a4a';
      if (y >= 2 && y <= 5 && cx > 7 && cx < 14) return '#7a8a56';
      if (y >= 3 && y <= 4 && cx >= 14 && cx < 20) return '#4a5638';
      return null;
    }, '#1c2418'));
  make(scene, 'cooltower', 18, 28, (c) =>
    mask(c, 18, 28, (x, y) => {
      const cx = x + 0.5;
      const half = 4.8 + Math.abs(y - 13) * 0.2;
      if (Math.abs(cx - 9) > half) return null;
      if (y >= 2 && y <= 4) return y % 2 ? '#e84a4a' : '#ffffff';
      return cx < 9 ? '#d0d4d8' : '#9ca0a8';
    }, '#0e140a'));
  make(scene, 'skyscraper', 14, 30, (c) =>
    mask(c, 14, 30, (x, y) => {
      if (x < 1 || x > 12) return null;
      if (y === 0 && x !== 6 && x !== 7) return null;
      if (y > 3 && y % 3 === 0 && x % 3 === 0) return (x * 7 + y * 3) % 5 === 0 ? '#ffe070' : '#2a3a5a';
      return x < 7 ? '#6a7a9a' : '#4a5a7a';
    }, '#141a28'));
  make(scene, 'rocket', 10, 26, (c) =>
    mask(c, 10, 26, (x, y) => {
      const cx = x + 0.5;
      if (y < 5) return Math.abs(cx - 5) <= y * 0.9 + 0.4 ? '#e84a4a' : null;
      if (y < 19) {
        if (Math.abs(cx - 5) > 3) return null;
        if (y >= 8 && y <= 10 && Math.abs(cx - 5) < 1.5) return '#7fd0f0';
        return cx < 5 ? '#ffffff' : '#c4cad8';
      }
      if (y < 24) return Math.abs(cx - 5) <= 3 + (y - 19) * 0.5 && Math.abs(cx - 5) > 1.2 ? '#e84a4a' : Math.abs(cx - 5) <= 3 ? '#c4cad8' : null;
      return Math.abs(cx - 5) < 1.5 ? '#ffb84a' : null;
    }, '#05070f'));
  make(scene, 'planet', 26, 22, (c) =>
    mask(c, 26, 22, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dp = Math.hypot(cx - 13, cy - 11);
      const ring = Math.abs(Math.hypot((cx - 13) / 12, (cy - 11) / 3.2) - 1);
      const front = cy > 11;
      if (ring < 0.22 && (front || dp > 7.2)) return ring < 0.1 ? '#f0d8ff' : '#b48ae0';
      if (dp <= 7.2) return cx - 13 + (cy - 11) < -3 ? '#e0a0ff' : cx - 13 + (cy - 11) > 4 ? '#6a3a9a' : '#a060d0';
      return null;
    }, '#07030f'));
  make(scene, 'cactus', 8, 14, (c) =>
    mask(c, 8, 14, (x, y) => {
      if (x >= 3 && x <= 4) return x === 3 ? '#4aa04a' : '#2f7a34';
      if (x === 1 && y >= 4 && y <= 8) return '#4aa04a';
      if (x === 2 && y === 8) return '#4aa04a';
      if (x === 6 && y >= 2 && y <= 6) return '#2f7a34';
      if (x === 5 && y === 6) return '#2f7a34';
      return null;
    }, '#1c4020'));
  make(scene, 'pinesnow', 14, 22, (c) =>
    mask(c, 14, 22, (x, y) => {
      const cx = x + 0.5;
      if (y >= 18) return Math.abs(cx - 7) <= 1 ? '#6a4a30' : null;
      const tier = y % 6;
      const half = 1 + (y / 18) * 5.6 + (tier < 2 ? 0 : 0.6);
      if (Math.abs(cx - 7) > half) return null;
      return tier < 2 ? '#ffffff' : cx < 7 ? '#3a8a60' : '#26664a';
    }, '#143a2a'));
  make(scene, 'crystal', 8, 12, (c) =>
    mask(c, 8, 12, (x, y) => {
      const cx = x + 0.5;
      const half = y < 4 ? y * 0.9 : 3.6 - (y - 4) * 0.12;
      if (Math.abs(cx - 4) > half) return null;
      return cx < 4 ? '#b8fff0' : '#3fe0c0';
    }, '#0f3a3a'));
  make(scene, 'barrel', 8, 9, (c) =>
    mask(c, 8, 9, (x, y) => {
      if (y >= 3 && y <= 4) return (x + y) % 2 ? '#ffd030' : '#2a2a24';
      return x < 4 ? '#7a8a50' : '#566638';
    }, '#1c2418'));
  make(scene, 'asteroid', 10, 8, (c) =>
    mask(c, 10, 8, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot((cx - 5) / 4.6, (cy - 4) / (3.4 + (x % 3 === 0 ? 0.4 : 0))) > 1) return null;
      return (x + y) % 5 === 0 ? '#5a5a70' : cx < 5 ? '#9a9ab0' : '#6a6a82';
    }, '#05070f'));
  // --- emblemas y decorados de las zonas futuras (2.ª tanda): selva, templo, fondo marino, industrial, neón, circo y caramelo
  make(scene, 'jungletree', 24, 30, (c) =>
    mask(c, 24, 30, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y >= 18 && Math.abs(cx - 12) <= 2.4) return x < 12 ? '#7a5a3a' : '#5a4228';
      const blobs: [number, number, number][] = [[12, 9, 9], [6, 12, 6], [18, 12, 6], [12, 14, 7]];
      if (blobs.some(([bx, by, r]) => Math.hypot(cx - bx, cy - by) <= r)) return cy < 8 && cx < 12 ? '#6fd058' : cy > 14 ? '#1f6a2a' : '#2f8a38';
      if (y >= 15 && y < 27 && [4, 8, 16, 20].includes(x) && y < 17 + ((x * 5) % 8)) return y % 3 === 0 ? '#9ad870' : '#4aa040';
      return null;
    }, '#0e2412'));
  make(scene, 'ruin', 18, 18, (c) =>
    mask(c, 18, 18, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y < 4 + (x % 5 === 1 ? 3 : 0) + (x > 11 ? 3 : 0)) return null;
      if (Math.hypot((cx - 9) / 3.2, (cy - 16) / 7) < 1) return '#101810';
      if (y < 7 && (x + y) % 3 === 0) return '#4aa040';
      return (x * 3 + y * 5) % 7 === 0 ? '#6a6a60' : x < 9 ? '#9a9a8c' : '#7a7a6e';
    }, '#1a2418'));
  make(scene, 'fern', 10, 8, (c) =>
    mask(c, 10, 8, (x, y) => {
      const cx = x + 0.5;
      const half = 0.6 + y * 0.55;
      if (Math.abs(cx - 5) > half) return null;
      return (x + y) % 3 === 0 ? '#2f8a38' : '#4aa83a';
    }, '#123a16'));
  // Selva: hoja gigante (sustituye a la seta), tótem (sustituye al bumper) y planta carnívora (sustituye a las sierras; dos frames: cerrada y abierta)
  make(scene, 'jleaf', 12, 7, (c) =>
    bitmap(c, 0, 0, [
      '...oooooo...',
      '..oghhgggo..',
      '.oghggdggdo.',
      'oggggdddgggo',
      '.oddgggggddo',
      '..oodddddoo.',
      '....oooo....',
    ], { o: '#0e3a1a', g: '#3fb84a', h: '#b4f070', d: '#23803a' }));
  for (const [key, ring, core] of [['totem', '#c0763a', '#ffe0a0'], ['totem-lit', '#ffb060', '#ffffff']] as const) {
    make(scene, key, 17, 17, (c) =>
      mask(c, 17, 17, (x, y) => {
        const dx = x + 0.5 - 8.5;
        const dy = y + 0.5 - 8.5;
        const r = Math.hypot(dx, dy);
        if (r > 7.6) return null;
        if (r > 5.4) return dx + dy < -3 ? '#e8a868' : (x * 5 + y * 7) % 6 === 0 ? '#7a3e1c' : ring;
        if (r > 3.2) return (x + y) % 3 === 0 ? '#7a3e1c' : '#f0c060';
        return core;
      }, '#3a1a0a'));
  }
  makeFrames(scene, 'plant', 12, 10, 2, (c, f) => {
    const stem = ['..oooggooo..', '....ogg.....', '..ogggggg...', '.oggggggggo.'];
    bitmap(c, 0, 0, (f
      ? ['orro....orro', 'orrro..orrro', 'owrrroorrrwo', 'owowrrrrowow', '.orrrwwrrro.', '..orrrrrro..']
      : ['...oooooo...', '..orrrrrro..', '.orrrhrrrro.', 'orrrrrrrrrro', 'owowowowowow', '.orrrrrrrro.']
    ).concat(stem), { o: '#3a0e18', r: '#e0405a', h: '#ff9ab0', w: '#ffffff', g: '#3fb84a' });
  });
  make(scene, 'temple', 28, 24, (c) =>
    mask(c, 28, 24, (x, y) => {
      const cx = x + 0.5;
      const tier = y < 8 ? 0 : y < 15 ? 1 : 2;
      const half = [5, 9, 13][tier];
      if (Math.abs(cx - 14) > half) return null;
      if (y >= 17 && Math.abs(cx - 14) < 2.4) return '#1a1008';
      if (tier === 0 && y >= 2 && y <= 6 && Math.abs(cx - 14) < 1.6) return y === 2 ? '#ffe070' : '#2a1a10'; // antorcha / puerta
      if ((x === 3 || x === 24) && y >= 14 && y <= 16) return '#ffd040'; // antorchas
      return (y % 7 === 6) ? '#a8844c' : cx < 14 ? '#d8b88a' : '#b8946a';
    }, '#4a3220'));
  make(scene, 'column', 8, 18, (c) =>
    mask(c, 8, 18, (x, y) => {
      if (y < 3 + (x > 4 ? 3 : 0)) return null;
      if (y >= 15 || y < 5) return x >= 0 && x <= 7 ? '#c8b088' : null;
      return x >= 1 && x <= 6 ? (x < 4 ? '#e0cca0' : '#b8a074') : null;
    }, '#4a3220'));
  make(scene, 'shipwreck', 24, 18, (c) =>
    mask(c, 24, 18, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y >= 9 && y <= 15) {
        const half = 11 - (y - 9) * 0.9 - (cx > 12 ? (cx - 12) * 0.2 : 0);
        if (Math.abs(cx - 11) <= half) return (x + y) % 4 === 0 ? '#4a3220' : '#6a4a2e';
      }
      if (x === 11 && y >= 1 && y <= 9) return '#4a3220';
      if (cy >= 2 && cy <= 6 && cx > 11 && cx < 17 && cx - 11 <= 6 - Math.abs(cy - 4) * 1.4) return '#c8c0a8';
      return null;
    }, '#0a2448'));
  make(scene, 'seaweed', 8, 16, (c) =>
    mask(c, 8, 16, (x, y) => {
      const sway = Math.round(Math.sin(y * 0.6) * 1.6);
      return Math.abs(x - 3.5 - sway) < 0.9 ? (y % 3 === 0 ? '#3aa860' : '#1f7a44') : null;
    }, '#0a3a28'));
  make(scene, 'coralbig', 16, 14, (c) =>
    mask(c, 16, 14, (x, y) => {
      const cx = x + 0.5;
      if (y >= 10 && Math.abs(cx - 8) < 4) return '#d84a7a';
      for (const bx of [3.5, 8, 12.5]) {
        const top = bx === 8 ? 1 : 4;
        if (y >= top && y < 11 && Math.abs(cx - bx) < 1.4 + (y < top + 3 ? 0.8 : 0)) return (x + y) % 3 === 0 ? '#ff90b0' : '#ff5a8a';
      }
      return null;
    }, '#5a1a38'));
  make(scene, 'candycastle', 24, 24, (c) =>
    mask(c, 24, 24, (x, y) => {
      const cx = x + 0.5;
      if (y < 8) {
        const half = 1 + y * 1.3;
        return Math.abs(cx - 12) <= half ? ((x + y) % 4 < 2 ? '#ff9ac8' : '#ffffff') : null;
      }
      if (Math.abs(cx - 12) > 9) return null;
      if (y >= 15 && Math.abs(cx - 12) < 2.2) return '#6a3a1c';
      if (y >= 10 && y <= 12 && (Math.abs(cx - 6.5) < 1.2 || Math.abs(cx - 17.5) < 1.2)) return '#ffe070';
      return (x + y) % 5 === 0 ? '#ffffff' : '#c88a58';
    }, '#6a2a48'));
  make(scene, 'lollipop', 12, 26, (c) =>
    mask(c, 12, 26, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = Math.hypot(cx - 6, cy - 6);
      if (d <= 5.6) return (Math.atan2(cy - 6, cx - 6) + d * 0.9) % 1.6 < 0.8 ? '#ff5a9a' : '#ffffff';
      if (y > 11 && Math.abs(cx - 6) < 0.9) return '#e8e0d0';
      return null;
    }, '#6a2a48'));
  make(scene, 'candycane', 8, 16, (c) =>
    mask(c, 8, 16, (x, y) => {
      if (y < 4) return x >= 2 && x <= 6 && Math.hypot(x + 0.5 - 5, y + 0.5 - 4) <= 3 && Math.hypot(x + 0.5 - 5, y + 0.5 - 4) >= 1.4 ? (x + y) % 3 === 0 ? '#ffffff' : '#e8344a' : null;
      return x >= 4 && x <= 5 ? ((y >> 1) % 2 ? '#ffffff' : '#e8344a') : null;
    }, '#6a2a48'));
  make(scene, 'gumdrop', 8, 8, (c) =>
    mask(c, 8, 8, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y < 2 || Math.hypot((cx - 4) / 3.6, (cy - 6) / 4.6) > 1) return null;
      return cx - 4 + (cy - 6) < -1.5 ? '#ffffff' : '#c8c8c8';
    }, '#6a2a48'));
  make(scene, 'neontower', 16, 30, (c) =>
    mask(c, 16, 30, (x, y) => {
      const cx = x + 0.5;
      const half = 3 + y * 0.18;
      if (Math.abs(cx - 8) > half) return null;
      if (y % 5 === 0) return '#40f0ff';
      if (Math.abs(cx - 8) > half - 1) return '#ff40c0';
      return (x * 3 + y) % 7 === 0 ? '#3a1c66' : '#1a0c30';
    }, '#05020f'));
  make(scene, 'cube', 12, 12, (c) => {
    const col = '#40f0ff';
    const col2 = '#ff40c0';
    for (let i = 0; i < 8; i++) {
      px(c, 2 + i, 2, col); px(c, 2 + i, 9, col); px(c, 2, 2 + i, col); px(c, 9, 2 + i, col);
      px(c, 4 + i, 0, col2); px(c, 4 + i, 7, col2); px(c, 4, i, col2); px(c, 11, i, col2);
    }
    for (let i = 0; i < 3; i++) { px(c, 2 + i, 2 - i, col2); px(c, 9 + i, 9 - i, col2); }
  });
  make(scene, 'pylon', 6, 18, (c) => {
    rect(c, 2, 4, 2, 14, '#3a1c66');
    rect(c, 2, 4, 1, 14, '#a040ff');
    rect(c, 1, 0, 4, 4, '#40f0ff');
    rect(c, 2, 1, 2, 2, '#ffffff');
  });
  make(scene, 'factory', 26, 24, (c) =>
    mask(c, 26, 24, (x, y) => {
      if (y < 10 && x >= 18 && x <= 22) return y % 4 === 0 ? '#e8344a' : '#8a5a48'; // chimenea
      if (y < 8) return null;
      if (x < 1 || x > 24) return null;
      if (y < 12 && x % 6 < 3) return null; // dientes de sierra
      if (y >= 14 && y <= 16 && x % 5 === 2) return '#ffd040';
      if (y >= 19 && x >= 10 && x <= 14) return '#2a2a30';
      return (x + y) % 6 === 0 ? '#6a6a74' : x < 13 ? '#9a8a7a' : '#7a6a5a';
    }, '#16171c'));
  make(scene, 'chimney', 8, 22, (c) =>
    mask(c, 8, 22, (x, y) => {
      const half = 2 + y * 0.07;
      if (Math.abs(x + 0.5 - 4) > half) return null;
      return y % 5 < 1 ? '#e8344a' : x < 4 ? '#a88a78' : '#8a6a58';
    }, '#16171c'));
  make(scene, 'gear', 12, 12, (c) =>
    mask(c, 12, 12, (x, y) => {
      const dx = x + 0.5 - 6;
      const dy = y + 0.5 - 6;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const R = 5.4 + (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 ? 0.6 : -0.2);
      if (d > R) return null;
      if (d < 1.8) return '#16171c';
      return d > 4 ? '#c8c8d4' : '#8a8a98';
    }, '#16171c'));
  make(scene, 'crate', 8, 8, (c) => {
    rect(c, 0, 0, 8, 8, '#16171c');
    rect(c, 1, 1, 6, 6, '#b8864e');
    rect(c, 1, 1, 6, 1, '#d8a868');
    rect(c, 1, 3, 6, 1, '#8a5a34');
    rect(c, 3, 1, 1, 6, '#8a5a34');
  });
  make(scene, 'bigtop', 28, 26, (c) =>
    mask(c, 28, 26, (x, y) => {
      const cx = x + 0.5;
      if (y < 3) return x === 14 || x === 15 ? '#ffd040' : null; // banderín
      if (y < 12) {
        const half = (y - 2) * 1.25;
        if (Math.abs(cx - 14) > half) return null;
        return Math.floor(cx / 3.5) % 2 ? '#ffffff' : '#e8344a';
      }
      if (Math.abs(cx - 14) > 12.5) return null;
      if (y >= 17 && Math.abs(cx - 14) < 2.6) return '#3a0f20';
      return Math.floor(cx / 3.5) % 2 ? '#fff0f0' : '#d82a40';
    }, '#2a0f38'));
  make(scene, 'ferris', 30, 30, (c) => {
    const cx = 15;
    const cy = 15;
    for (let a = 0; a < 720; a++) {
      const t = (a / 720) * Math.PI * 2;
      px(c, Math.round(cx + Math.cos(t) * 13), Math.round(cy + Math.sin(t) * 13), '#fff0b0');
    }
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      for (let r = 1; r < 13; r++) px(c, Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), '#e8e0d0');
      rect(c, Math.round(cx + Math.cos(t) * 13) - 1, Math.round(cy + Math.sin(t) * 13) - 1, 3, 3, ['#e8344a', '#40a0ff', '#ffd040', '#40e070'][k % 4]);
    }
    rect(c, 14, 14, 3, 3, '#ffd040');
  });
  make(scene, 'ferrisbase', 20, 16, (c) => {
    for (let y = 0; y < 16; y++) {
      px(c, 10 - Math.round(y * 0.55), y, '#e8e0d0');
      px(c, 9 + Math.round(y * 0.55), y, '#e8e0d0');
    }
    rect(c, 0, 14, 20, 2, '#6a2a48');
  });
  make(scene, 'balloon', 8, 14, (c) =>
    mask(c, 8, 14, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot((cx - 4) / 3.4, (cy - 4.5) / 4.2) <= 1) return cx - 4 + (cy - 4.5) < -1.6 ? '#ffffff' : '#d8d8d8';
      if (x === 4 && y >= 9) return '#e8e0d0';
      return null;
    }, '#2a0f38'));
  // --- 3.ª tanda de emblemas: mansión encantada, piratas y oeste
  make(scene, 'mansion', 26, 28, (c) =>
    mask(c, 26, 28, (x, y) => {
      const cx = x + 0.5;
      if (y < 9) {
        const half = 1 + y * 1.2;
        if (Math.abs(cx - 13) <= half) return cx < 13 ? '#3a3050' : '#2a2240';
        return x >= 20 && x <= 22 && y >= 2 && y < 7 ? '#2a2240' : null; // chimenea torcida
      }
      if (Math.abs(cx - 13) > 11) return null;
      if (y >= 20 && Math.abs(cx - 13) < 2.4) return '#0c0a14';
      if (y >= 12 && y <= 15 && ((Math.abs(cx - 7) < 1.6) || (Math.abs(cx - 19) < 1.6))) return (x + y) % 2 ? '#ffe070' : '#a89040';
      return (x + y * 3) % 7 === 0 ? '#4a4258' : cx < 13 ? '#6a5e80' : '#52486a';
    }, '#0c0a14'));
  make(scene, 'tombstone', 8, 10, (c) =>
    mask(c, 8, 10, (x, y) => {
      const cx = x + 0.5;
      if (y < 2) return Math.abs(cx - 4) <= 1.5 + y * 0.8 ? '#a8a8b8' : null;
      if (Math.abs(cx - 4) > 3) return null;
      if (y >= 3 && y <= 6 && Math.abs(cx - 4) < 0.8) return '#5a5a6a';
      return cx < 4 ? '#b8b8c8' : '#8a8a9a';
    }, '#141420'));
  make(scene, 'deadtree', 14, 24, (c) =>
    mask(c, 14, 24, (x, y) => {
      if (Math.abs(x + 0.5 - 7) <= 1.2 && y >= 6) return x < 7 ? '#4a4258' : '#2e2840';
      const branches: [number, number, number][] = [[7, 6, 1], [4, 5, 0.5], [10, 4, 0.5], [3, 2, 0.4], [11, 1, 0.4]];
      for (const [bx, by] of branches) if (Math.abs(x - bx) <= 0.8 && y >= by && y < by + 5 && (bx === 7 || Math.abs(y - by - 2) < 3)) return '#3a3350';
      if (x >= 4 && x <= 6 && y === 7 - (x - 4)) return '#3a3350';
      if (x >= 8 && x <= 10 && y === 5 + (x - 8)) return '#3a3350';
      return null;
    }, '#0c0a14'));
  make(scene, 'ghost', 10, 12, (c) =>
    mask(c, 10, 12, (x, y) => {
      const cx = x + 0.5;
      if (y < 9) {
        const half = Math.min(4.6, 1.8 + y * 0.7);
        if (Math.abs(cx - 5) > half) return null;
        if (y >= 3 && y <= 5 && (Math.abs(cx - 3.5) < 0.8 || Math.abs(cx - 6.5) < 0.8)) return '#1a1a28';
        return '#f0f0ff';
      }
      if (Math.abs(cx - 5) > 4.6) return null;
      return (x + y) % 2 === 0 ? '#f0f0ff' : y > 10 ? null : '#d0d0e8';
    }, '#2a2a40'));
  make(scene, 'pumpkin', 8, 7, (c) =>
    mask(c, 8, 7, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y === 0) return x === 4 ? '#3a6a2a' : null;
      if (Math.hypot((cx - 4) / 3.8, (cy - 4) / 3) > 1) return null;
      if (y >= 3 && y <= 4 && (x === 2 || x === 5)) return '#2a1408';
      return cx < 4 ? '#ff9a2a' : '#e07a14';
    }, '#4a2408'));
  make(scene, 'pirateship', 30, 26, (c) =>
    mask(c, 30, 26, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (y >= 17 && y <= 23) {
        const half = 13 - (y - 17) * 1.1;
        if (Math.abs(cx - 15) <= half) return (x + y) % 4 === 0 ? '#4a2e1a' : '#6a4426';
      }
      for (const mx of [10, 20]) if (Math.abs(cx - mx) < 0.8 && y >= 2 && y <= 17) return '#3a2410';
      for (const [mx, top, bot] of [[10, 4, 13], [20, 6, 14]] as const) {
        if (cy >= top && cy <= bot && Math.abs(cx - mx) < 5 - (cy - top) * 0.25 && Math.abs(cx - mx) >= 0.8) return '#f4ecd8';
      }
      if (x === 20 && y >= 0 && y <= 2) return '#141414';
      return null;
    }, '#1a1008'));
  make(scene, 'chest', 10, 8, (c) =>
    mask(c, 10, 8, (x, y) => {
      if (y < 3) return x >= 1 && x <= 8 && !(y === 0 && (x === 1 || x === 8)) ? '#8a5a34' : null;
      if (x < 0 || x > 9) return null;
      if (y === 3) return '#ffd040';
      return x === 4 || x === 5 ? '#ffd040' : '#6a4426';
    }, '#2a1a10'));
  make(scene, 'cannon', 14, 9, (c) =>
    mask(c, 14, 9, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot(cx - 4, cy - 6.5) <= 2.4) return '#6a4426'; // rueda
      if (cy >= 2 + (13 - cx) * 0.12 && cy <= 5 + (13 - cx) * 0.12 && cx >= 3 && cx <= 13) return cx < 4 ? '#8a8a96' : '#3a3a44';
      return null;
    }, '#141418'));
  make(scene, 'saloon', 26, 22, (c) =>
    mask(c, 26, 22, (x, y) => {
      const cx = x + 0.5;
      if (y < 3) return cx > 4 && cx < 22 ? '#6a4426' : null;
      if (y < 5 && y >= 3) return cx > 2 && cx < 24 ? '#8a5a34' : null; // falso frontal
      if (Math.abs(cx - 13) > 11.5) return null;
      if (y >= 14 && Math.abs(cx - 13) < 2.2) return '#1a0f08'; // puertas batientes
      if (y >= 8 && y <= 11 && (Math.abs(cx - 6.5) < 1.6 || Math.abs(cx - 19.5) < 1.6)) return '#7fd0f0';
      return y % 3 === 0 ? '#8a5a34' : x < 13 ? '#b8864e' : '#9a6c3c';
    }, '#2a1408'));
  make(scene, 'mesa', 22, 26, (c) =>
    mask(c, 22, 26, (x, y) => {
      const cx = x + 0.5;
      const half = y < 6 ? 6 + y * 0.6 : 9.6 + (y - 6) * 0.25;
      if (Math.abs(cx - 11) > half) return null;
      return y % 6 === 5 ? '#a8582e' : cx < 11 ? '#d8885a' : '#b8683a';
    }, '#4a2414'));
  make(scene, 'tumbleweed', 8, 8, (c) =>
    mask(c, 8, 8, (x, y) => {
      const d = Math.hypot(x + 0.5 - 4, y + 0.5 - 4);
      if (d > 3.6) return null;
      return (x * 3 + y * 5) % 4 === 0 ? '#8a6a3a' : '#c8a060';
    }, '#4a2414'));
  make(scene, 'traincar', 24, 12, (c) =>
    mask(c, 24, 12, (x, y) => {
      if (y >= 9 && y <= 11) return (x % 6 < 3) ? '#2a2a30' : null; // ruedas
      if (y >= 1 && y <= 8 && x >= 0 && x <= 23) return y === 1 ? '#6a2a1a' : x % 6 === 5 ? '#4a1a10' : x < 12 ? '#9a3a24' : '#7a2c1a';
      return null;
    }, '#1a0a08'));
  // --- castillo medieval: castillo, torre, estandarte, catapulta y bala de heno
  make(scene, 'castle', 32, 30, (c) =>
    mask(c, 32, 30, (x, y) => {
      const cx = x + 0.5;
      const tower = (tx: number, w: number, top: number) => Math.abs(cx - tx) <= w && y >= top;
      // almenas: dientes en lo alto de torres y muralla
      const crown = (tx: number, w: number, top: number) => y < top + 2 && Math.abs(cx - tx) <= w && (Math.floor(cx - tx + 20) % 3 === 0);
      if (crown(6, 4.6, 8) || crown(26, 4.6, 8) || crown(16, 4.6, 2)) return '#9aa0b4';
      if (tower(6, 4.6, 10) || tower(26, 4.6, 10) || tower(16, 5.6, 4) || (Math.abs(cx - 16) <= 12 && y >= 16)) {
        if (y >= 20 && Math.abs(cx - 16) < 2.6) return '#1a1008'; // puerta
        if (((Math.abs(cx - 6) < 0.8 || Math.abs(cx - 26) < 0.8) && y >= 13 && y <= 15) || (Math.abs(cx - 16) < 0.9 && y >= 9 && y <= 12)) return '#ffe070'; // ventanas
        return (x * 3 + y) % 6 === 0 ? '#7a8094' : cx < 16 ? '#b0b6c8' : '#8a90a4';
      }
      if (x === 16 && y >= 0 && y < 4) return '#4a3220';
      if (x >= 17 && x <= 20 && y >= 0 && y <= 2) return '#e8344a'; // banderín
      return null;
    }, '#141c30'));
  make(scene, 'tower', 10, 26, (c) =>
    mask(c, 10, 26, (x, y) => {
      if (y < 3) return x % 3 !== 1 ? '#9aa0b4' : null;
      if (x < 1 || x > 8) return null;
      if (y >= 8 && y <= 10 && (x === 4 || x === 5)) return '#ffe070';
      return (x + y * 2) % 7 === 0 ? '#7a8094' : x < 5 ? '#b0b6c8' : '#8a90a4';
    }, '#141c30'));
  make(scene, 'banner', 6, 16, (c) => {
    rect(c, 1, 0, 1, 16, '#4a3220');
    rect(c, 2, 1, 4, 8, '#e8344a');
    rect(c, 2, 1, 4, 1, '#ff7a8a');
    for (let i = 0; i < 4; i++) px(c, 2 + i, 9 + (i < 2 ? i : 3 - i), '#e8344a');
    rect(c, 3, 3, 2, 2, '#ffd040');
  });
  make(scene, 'catapult', 18, 14, (c) =>
    mask(c, 18, 14, (x, y) => {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (Math.hypot(cx - 5, cy - 11) <= 2.6 || Math.hypot(cx - 13, cy - 11) <= 2.6) return '#6a4426'; // ruedas
      if (cy >= 9 && cy <= 11 && cx >= 3 && cx <= 15) return '#8a5a34';
      if (cx >= 6 && cx <= 8 && cy >= 2 && cy <= 9 && Math.abs(cx - 7 - (cy - 9) * -0.1) < 1.4) return '#9a6c3c';
      if (cy >= 1 + (cx - 6) * 0.4 && cy <= 2.6 + (cx - 6) * 0.4 && cx >= 3 && cx <= 14) return '#b8864e'; // brazo
      if (Math.hypot(cx - 3.6, cy - 1.2) <= 1.8) return '#6a6a74'; // piedra
      return null;
    }, '#1a1008'));
  make(scene, 'haybale', 10, 8, (c) =>
    mask(c, 10, 8, (x, y) => {
      if (x < 0 || x > 9) return null;
      return y === 3 || y === 5 ? '#a8842c' : (x + y) % 3 === 0 ? '#e8c860' : '#d8b444';
    }, '#4a3410'));
  // banco de arena de marea (casilla de 12×12 que se repite)
  make(scene, 'sandbar', 12, 12, (c) => {
    rect(c, 0, 0, 12, 12, '#f6e4b2');
    rect(c, 0, 0, 12, 1, '#fff5d2');
    rect(c, 0, 1, 12, 1, '#f9ebc2');
    rect(c, 0, 9, 12, 1, '#ecd6a2'); // transición a arena húmeda
    rect(c, 0, 10, 12, 2, '#dcc18c');
    rect(c, 0, 11, 12, 1, '#a9854f');
    for (const [x, y] of [[2, 4], [7, 3], [4, 7], [9, 7], [10, 5]]) px(c, x, y, '#ead09a');
    for (const [x, y] of [[1, 2], [8, 6], [5, 9]]) px(c, x, y, '#fffbe8'); // brillos de arena mojada
    rect(c, 1, 5, 3, 1, '#e8cd92');
    rect(c, 6, 8, 4, 1, '#e8cd92');
  });
  // mar: tira que se repite en horizontal bajo las islas
  make(scene, 'sea', 48, 40, (c) => {
    for (let x = 0; x < 48; x++) {
      const wy = 1 + Math.round(Math.sin((x / 48) * Math.PI * 4));
      rect(c, x, wy, 1, 40 - wy, '#2fc4d8');
      rect(c, x, 16, 1, 24, '#22aac4');
      rect(c, x, 28, 1, 12, '#1a8eab');
      px(c, x, wy, '#e4fdff');
      px(c, x, wy + 1, '#8ae9f3');
    }
    for (const [x, y] of [[6, 10], [20, 7], [34, 12], [44, 8]]) rect(c, x, y, 4, 1, '#b8f4fa');
  });
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

/**
 * Cielo de un mundo: degradado vertical a pantalla completa (W×H) con tramado ordenado (dithering 4×4), que es como
 * se hace un degradado en pixel art. Va de un tono profundo arriba al color del mundo y a un horizonte claro y neblinoso abajo.
 * Se crea la primera vez que se pide (no para todos los mundos al arrancar).
 */
export function skyTexture(scene: Phaser.Scene, themeKey: string): string {
  const key = `skybase-${themeKey}`;
  if (scene.textures.exists(key)) return key;
  const T = THEMES[themeKey as keyof typeof THEMES];
  const night = T.sky === 'night';
  const top = night ? mix(T.bgA, '#04060f', 0.82) : T.sky === 'sunset' ? mix(T.bgA, '#5a2f86', 0.62) : mix(T.bgA, '#2457c0', 0.68);
  const mid = night ? mix(T.bgA, '#04060f', 0.32) : T.bgA;
  const low = night ? mix(T.bgB, '#8fb8a0', 0.14) : T.sky === 'sunset' ? mix(T.bgB, '#ffe0b0', 0.5) : mix(T.bgB, '#ffffff', 0.5);
  const hex3 = (c: string) => [(parseInt(c.slice(1), 16) >> 16) & 255, (parseInt(c.slice(1), 16) >> 8) & 255, parseInt(c.slice(1), 16) & 255];
  const A = hex3(top);
  const B = hex3(mid);
  const C = hex3(low);
  const STEPS = 18; // niveles de color del degradado
  const ramp: number[][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const k = i / STEPS;
    const [p, q, t] = k < 0.55 ? [A, B, k / 0.55] : [B, C, (k - 0.55) / 0.45];
    ramp.push([0, 1, 2].map((ch) => Math.round(p[ch] * (1 - t) + q[ch] * t)));
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const tex = canvasTexture(scene, key, W, H);
  const ctx = tex.getContext();
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const level = (y / (H - 1)) * STEPS;
    const lo = Math.min(STEPS - 1, Math.floor(level));
    const fr = level - lo;
    for (let x = 0; x < W; x++) {
      const thr = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const col = ramp[lo + (fr > thr ? 1 : 0)];
      const o = (y * W + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  if (!night) {
    // bancos de bruma y nubes muy lejanas, suaves y con el borde tramado: el cielo no se queda vacío
    let sd = 7771;
    const r2 = () => ((sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 7; i++) {
      const cx = r2() * W;
      const cy = H * (0.08 + r2() * 0.72);
      const rx = 36 + r2() * 60;
      const ry = 3 + r2() * 6;
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          if (d >= 1) continue;
          if ((1 - d) * 0.9 > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) {
            const o = (y * W + x) * 4;
            for (let ch = 0; ch < 3; ch++) img.data[o + ch] = Math.min(255, img.data[o + ch] + (255 - img.data[o + ch]) * 0.16);
          }
        }
      }
    }
  }
  if (night) {
    // estrellas: más y más brillantes arriba; unas pocas más grandes en cruz
    let seed = 20261;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const setPx = (x: number, y: number, k: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const o = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = Math.round(img.data[o + ch] * (1 - k) + 255 * k);
    };
    for (let i = 0; i < 150; i++) {
      const x = Math.floor(rnd() * W);
      const y = Math.floor(H * 0.85 * Math.pow(rnd(), 1.5));
      const k = 0.35 + rnd() * 0.55;
      setPx(x, y, k);
      if (i % 12 === 0) {
        setPx(x - 1, y, k * 0.5);
        setPx(x + 1, y, k * 0.5);
        setPx(x, y - 1, k * 0.5);
        setPx(x, y + 1, k * 0.5);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

function generateSky(scene: Phaser.Scene) {
  // Colinas lejanas (dos capas por mundo) para el parallax del inicio de cada hoyo
  for (const [k, T] of Object.entries(THEMES)) {
    const darkness = T.hillsDark || [0.14, 0.26];
    [[darkness[0], 0.9, 1.3, 3], [darkness[1], 1.7, 0.7, 11]].forEach(([dark, f1, f2, seed], layer) => {
      const w = 240;
      const h = 80;
      // la pradera tiene colinas verdes; de noche, siluetas oscuras para que no parezcan dibujos de línea
      const base = k === 'meadow' ? (layer ? '#8fd08a' : '#a8dcb0') : k === 'beach' ? (layer ? '#e6c98e' : '#f2deb2') : k === 'swamp' ? (layer ? '#3c5a47' : '#587a64') : k === 'jungle' ? (layer ? '#2f8a52' : '#4fae78') : T.bgB;
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
        // matas y vetas de luz sobre las colinas (textura barata: se pinta una vez)
        {
          const topAt = (x: number) => {
            const a = (x / w) * Math.PI * 2;
            return Math.round(h * (layer ? 0.42 : 0.3) + Math.sin(a * f1 * 2 + seed) * 12 + Math.sin(a * f2 * 5 + seed * 2) * 6 + Math.sin(a * 11 + seed) * 1.5);
          };
          for (let i = 0; i < 70; i++) {
            const x = (i * 37 + seed * 13) % w;
            const y = topAt(x) + 2 + ((i * 7) % 11);
            px(c, x, y, mix(body, '#ffffff', 0.14));
            px(c, x + 1, y + 1, mix(body, T.outline, 0.12));
            if (i % 5 === 0) px(c, x + 2, y, mix(body, '#ffffff', 0.08));
          }
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
            if (k === 'swamp') {
              // cipreses lejanos con musgo colgando
              rect(c, tx, top - 9, 1, 9, tree);
              rect(c, tx - 3, top - 12, 7, 3, tree);
              rect(c, tx - 2, top - 14, 5, 2, tree);
              rect(c, tx - 1, top - 15, 3, 1, tree);
              for (const dx of [-3, 0, 3]) rect(c, tx + dx, top - 9, 1, 3 + ((tx + dx) % 3), tree);
              continue;
            }
            if (k === 'beach') {
              // palmeritas lejanas
              rect(c, tx, top - 8, 1, 8, tree);
              rect(c, tx - 3, top - 9, 7, 1, tree);
              rect(c, tx - 2, top - 10, 5, 1, tree);
              px(c, tx - 4, top - 8, tree);
              px(c, tx + 4, top - 8, tree);
              rect(c, tx - 1, top - 11, 3, 1, tree);
              continue;
            }
            rect(c, tx, top - 6, 1, 6, tree);
            rect(c, tx - 2, top - 9, 5, 4, tree);
            rect(c, tx - 1, top - 11, 3, 2, tree);
          }
        }
      });
    });
  }

  // Montañas lejanas (tercera capa): picos azulados y neblinosos que dan profundidad al horizonte.
  // Cada mundo tiene su silueta: cumbres nevadas en la Pradera, acantilados y dunas de arena en la Playa, cerros oscuros en el Pantano.
  for (const [k, T] of Object.entries(THEMES)) {
    const w = 240;
    const h = 80;
    const FILL = 420;
    const night = T.sky === 'night';
    const haze = night ? mix(T.bgA, T.outline, 0.3) : k === 'beach' ? mix(T.bgA, '#f3d9a8', 0.4) : mix(T.bgA, '#6f8fc0', 0.36);
    make(scene, `hills-${k}-2`, w, h + FILL, (c) => {
      for (let x = 0; x < w; x++) {
        const a = (x / w) * Math.PI * 2;
        // picos: crestas de |seno| (periódicas, para que el fondo se repita sin costuras)
        const pointy = Math.abs(Math.sin(a * 3 + 1)) * 16 + Math.abs(Math.sin(a * 7 + 2)) * 5 + Math.sin(a * 13) * 1.2;
        const soft = Math.abs(Math.sin(a * 2 + 0.6)) * 11 + Math.sin(a * 5 + 1) * 4;
        const ridge = k === 'beach' ? soft : pointy;
        const top = Math.round(46 - ridge);
        rect(c, x, top, 1, h + FILL - top, haze);
        px(c, x, top, mix(haze, '#ffffff', night ? 0.12 : 0.4));
        // vertiente iluminada a un lado de cada cresta
        if (!night && ridge > 6) px(c, x, top + 1, mix(haze, '#ffffff', 0.2));
        // nieve en las cumbres más altas (solo la Pradera)
        if (k === 'meadow' && ridge > 16.5) rect(c, x, top, 1, Math.min(3, Math.round(ridge - 15.5)), '#f4f8ff');
      }
      // detalles lejanos: un molino sobre una cresta de la Pradera y un faro en la costa de la Playa
      if (k === 'meadow' || k === 'beach') {
        const dark = mix(haze, T.outline, 0.22);
        const ridgeTop = (x: number) => {
          const a = (x / w) * Math.PI * 2;
          const pointy = Math.abs(Math.sin(a * 3 + 1)) * 16 + Math.abs(Math.sin(a * 7 + 2)) * 5 + Math.sin(a * 13) * 1.2;
          const soft = Math.abs(Math.sin(a * 2 + 0.6)) * 11 + Math.sin(a * 5 + 1) * 4;
          return Math.round(46 - (k === 'beach' ? soft : pointy));
        };
        if (k === 'meadow') {
          const mx = 168;
          const my = ridgeTop(mx);
          rect(c, mx - 2, my - 8, 5, 8, dark);
          rect(c, mx - 1, my - 10, 3, 2, dark);
          for (let i = -5; i <= 5; i++) {
            px(c, mx + i, my - 9 + i, dark);
            px(c, mx + i, my - 9 - i, dark);
          }
        } else {
          const lx = 52;
          const ly = ridgeTop(lx);
          const tower = mix(haze, '#ffffff', 0.55);
          const stripe = mix(haze, '#d9806e', 0.7);
          for (let y = 0; y < 16; y++) rect(c, lx - 2 + (y > 12 ? 0 : 0), ly - 16 + y, 5, 1, Math.floor(y / 4) % 2 ? stripe : tower);
          rect(c, lx - 3, ly - 19, 7, 3, dark);
          rect(c, lx - 1, ly - 21, 3, 2, dark);
          px(c, lx, ly - 22, mix(haze, '#fff6cc', 0.9));
        }
      }

      // neblina en la base, para fundirse con las colinas de delante
      const mist = c.createLinearGradient(0, h * 0.45, 0, h + FILL);
      mist.addColorStop(0, 'rgba(255,255,255,0)');
      mist.addColorStop(1, `rgba(255,255,255,${night ? 0.1 : 0.6})`);
      c.globalCompositeOperation = 'source-atop';
      c.fillStyle = mist;
      c.fillRect(0, 0, w, h + FILL);
      c.globalCompositeOperation = 'source-over';
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
      // tronco con la base ensanchada y dos ramitas
      if (y >= 17 && x >= 9 && x <= 12) return x === 9 ? '#a8744a' : x === 12 ? '#6a4228' : '#8a5a38';
      if (y >= 25 && x >= 8 && x <= 13) return x <= 9 ? '#8a5a38' : '#6a4228';
      if (y === 16 && (x === 8 || x === 13)) return '#7a4e30';
      const blobs = [[11, 8, 8], [5.5, 12, 5.5], [16.5, 12, 5.5], [11, 14, 6], [8, 5, 4.5], [15, 6, 4.5]];
      if (!blobs.some(([bx, by, r]) => Math.hypot(cx - bx, cy - by) <= r)) return null;
      // luz desde arriba a la izquierda: cuatro tonos y motas de hojas sueltas
      const lit = Math.hypot(cx - 8, cy - 5);
      const leaf = (x * 7 + y * 13) % 6 === 0;
      if (lit < 3.2) return '#b8f58a';
      if (lit < 6 && !leaf) return '#8fe060';
      if (cy > 16 || Math.hypot(cx - 16, cy - 14) < 3.6) return leaf ? '#348a38' : '#2f7a34';
      if (cy > 13 || cx > 15) return leaf ? '#4aa845' : '#3f9a3c';
      return leaf ? '#7ad656' : '#5cc04a';
    }, o);
  });
  // pino 16×30
  make(scene, 'tree-pine', 16, 30, (c) => {
    mask(c, 16, 30, (x, y) => {
      if (y >= 24 && x >= 7 && x <= 8) return x === 7 ? '#8a5a38' : '#6a4228';
      if (y >= 24) return null;
      const tier = y < 9 ? y / 9 : y < 17 ? (y - 6) / 11 : (y - 13) / 11;
      const half = 1 + tier * 6.5 + (y % 3 === 0 ? 0.8 : 0); // bordes aserrados
      const dx = x + 0.5 - 8;
      if (Math.abs(dx) > half) return null;
      if (y === 8 || y === 16 || y === 23) return '#1f6a3a'; // sombra bajo cada piso
      if (dx < -half + 1.4) return '#7fd36a'; // borde iluminado
      return dx < 0 ? ((x + y) % 4 === 0 ? '#5cc060' : '#4fae58') : (x + y) % 4 === 0 ? '#2a7a40' : '#2f8a46';
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
      const leaf = (x * 5 + y * 11) % 5 === 0;
      if (Math.hypot(cx - 5.5, cy - 3) < 1.8) return '#c0f58c';
      if (cy > 5) return leaf ? '#2f7a34' : '#3f9a3c';
      return leaf ? '#7ad656' : '#5cc04a';
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

/** '#rrggbb' + opacidad → 'rgba(...)' */
function rgbaHex(hex: string, a: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${a})`;
}

/**
 * Marco de panel (se usa como NineSlice): contorno oscuro con esquinas cortadas, canto de luz arriba/izquierda y de sombra
 * abajo/derecha, línea de sombra interior (opcional), relleno con degradado vertical (el centro se estira, así que el degradado
 * abarca todo el panel) y un brillo fino bajo el borde. `stud`: remaches dorados con luz en las cuatro esquinas.
 */
function frame(
  scene: Phaser.Scene,
  key: string,
  size: number,
  { outline, light, dark, top, bottom, alpha, stud, inner, sunken, round }: {
    outline: string; light: string; dark: string; top: string; bottom: string; alpha: number;
    stud?: boolean; inner?: boolean;
    /** hundido (caja de texto): el canto oscuro va arriba/izquierda y el de luz abajo/derecha */
    sunken?: boolean;
    /** esquinas redondeadas de 2 px en vez de cortadas de 1 */
    round?: boolean;
  },
) {
  make(scene, key, size, size, (c) => {
    const s = size;
    const first = inner ? 3 : 2; // primera fila/columna del relleno
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dl = x, dr = s - 1 - x, dt = y, db = s - 1 - y;
        // esquinas: s = distancia en escalera a la esquina más cercana
        const cs = Math.min(dl, dr) + Math.min(dt, db);
        if (round) {
          if (Math.min(dl, dr) < 3 && Math.min(dt, db) < 3) {
            if (cs <= 1) continue; // recortada
            if (cs === 2) {
              px(c, x, y, outline);
              continue;
            }
          }
        } else if ((dl === 0 || dr === 0) && (dt === 0 || db === 0)) continue; // esquina cortada
        const ring = Math.min(dl, dr, dt, db);
        const lit = dt === 1 || dl === 1; // canto de arriba/izquierda
        if (ring === 0) px(c, x, y, outline);
        else if (ring === 1) px(c, x, y, lit !== !!sunken ? light : dark);
        else if (inner && ring === 2) px(c, x, y, 'rgba(24,14,18,0.62)');
        else {
          let col = blendHex(top, bottom, Math.min(1, Math.max(0, (y - first) / Math.max(1, s - first * 2 - 1))));
          if (y === first) col = blendHex(col, '#ffffff', 0.13); // brillo bajo el borde de arriba
          px(c, x, y, rgbaHex(col, alpha));
        }
      }
    }
    if (stud) {
      for (const [x, y] of [[3, 3], [s - 5, 3], [3, s - 5], [s - 5, s - 5]]) {
        rect(c, x, y, 2, 2, '#f2b43a');
        px(c, x, y, '#fff0a0');
        px(c, x + 1, y + 1, '#a8611f');
      }
    }
  });
}

/**
 * Botón de 3 estados (NineSlice 5,5,5,7): `key` (reposo, con labio grueso abajo y brillo arriba), `key-hover` (cara más clara)
 * y `key-down` (pulsado: el labio se aplasta y la cara baja). La cara lleva degradado vertical.
 */
function button9(scene: Phaser.Scene, key: string, face: string, light: string, dark: string, lip: string) {
  const OUT = '#35282c';
  for (const state of ['up', 'hover', 'down'] as const) {
    make(scene, state === 'up' ? key : `${key}-${state}`, 16, 18, (c) => {
      const down = state === 'down';
      const f = state === 'hover' ? blendHex(face, '#ffffff', 0.2) : face;
      const lipTop = down ? 15 : 13; // el labio (grosor 3) se reduce a 1 px al pulsar
      const lastFace = lipTop - 1;
      for (let y = 0; y < 18; y++) {
        for (let x = 0; x < 16; x++) {
          // esquinas redondeadas de 2 px
          const cs = Math.min(x, 15 - x) + Math.min(y, 17 - y);
          if (Math.min(x, 15 - x) < 3 && Math.min(y, 17 - y) < 3) {
            if (cs <= 1) continue;
            if (cs === 2) {
              px(c, x, y, OUT);
              continue;
            }
          }
          if (x === 0 || x === 15 || y === 0 || y >= 16) {
            px(c, x, y, OUT);
            continue;
          }
          if (y >= lipTop) {
            px(c, x, y, y === lipTop && !down ? blendHex(lip, f, 0.3) : lip);
            continue;
          }
          const t = (y - 1) / (lastFace - 1);
          let col = down
            ? blendHex(blendHex(f, dark, 0.3), blendHex(f, dark, 0.55), t)
            : blendHex(blendHex(f, light, 0.42), blendHex(f, dark, 0.5), t);
          if (down) {
            if (y <= 2) col = blendHex(f, dark, 0.7); // sombra interior de arriba
            else if (x === 1) col = blendHex(f, dark, 0.5);
            else if (x === 14) col = blendHex(f, light, 0.2);
          } else if (y === 1) col = blendHex(f, light, 0.8); // canto de luz
          else if (x === 1 && y >= 2) col = blendHex(f, light, 0.6);
          else if (x === 14 && y >= 2) col = blendHex(f, dark, 0.75);
          else if ((y === 2 && x >= 3 && x <= 7) || (y === 3 && x === 3)) col = '#ffffff'; // destello
          px(c, x, y, col);
        }
      }
    });
  }
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
  frame(scene, 'panel9', 12, { outline: '#35282c', light: '#fff4dc', dark: '#c8834f', top: '#51393f', bottom: '#33242a', alpha: 0.95, stud: true, inner: true, round: true });
  frame(scene, 'hud9', 8, { outline: '#35282c', light: '#fff4dc', dark: '#b47143', top: '#523a40', bottom: '#382930', alpha: 0.9, round: true });
  // caja de texto / campo: hundida (canto oscuro arriba, de luz abajo) y más oscura que el panel
  frame(scene, 'field9', 8, { outline: '#2a1e22', light: '#9a7a62', dark: '#1a1216', top: '#22181c', bottom: '#33252b', alpha: 0.92, sunken: true, round: true });
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
