import Phaser from 'phaser';
import { THEMES } from '../constants.js';
import { SKINS } from '../data/upgrades.js';

/**
 * Sprites e interfaz en pixel art generados por código.
 * El terreno se pinta aparte (gfx/terrain.js).
 * Si más adelante usas sprites dibujados a mano, cárgalos en BootScene con la misma clave:
 * make() no sobrescribe texturas existentes.
 */

function make(scene, key, w, h, draw, linear = false) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  draw(c, w, h);
  tex.refresh();
  if (linear) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

function makeFrames(scene, key, fw, fh, n, draw) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, fw * n, fh);
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

const px = (c, x, y, col) => {
  c.fillStyle = col;
  c.fillRect(x, y, 1, 1);
};
const rect = (c, x, y, w, h, col) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};

function mask(c, w, h, fn, outline) {
  const grid = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = fn(x, y);
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = grid[y * w + x];
      if (col) px(c, x, y, col);
      else if (outline && (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1))) px(c, x, y, outline);
    }
  }
}

function bitmap(c, x, y, rows, pal) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = pal[row[i]];
      if (col) px(c, x + i, y + j, col);
    }
  });
}

function inPoly(pts, x, y) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function radial(c, x, y, r, stops) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  return g;
}

export function generateTextures(scene) {
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
  // una textura por bola comprable (misma forma, otra paleta)
  for (const skin of SKINS) {
    const P = skin.pal;
    makeFrames(scene, `ball-${skin.id}`, 10, 10, 4, (c, f) => {
      bitmap(c, 0, 0, base, { o: P.o, w: P.w, h: '#ffffff', s: P.s });
      if (skin.id === 'melon') for (const x of [3, 6]) for (let y = 1; y < 9; y++) if (base[y][x] === 'w' || base[y][x] === 's') px(c, x, y, P.d);
      for (const [x, y] of dimples[f]) px(c, x, y, P.d);
    });
  }

  // moneda
  make(scene, 'coin', 9, 9, (c) =>
    bitmap(c, 0, 0, [
      '..ooooo..', '.oyyyyyo.', 'oywwyyydo', 'oywyyyydo', 'oyyyyyydo', 'oyyyyyydo', 'oyyyyyddo', '.oddddddo', '..ooooo..',
    ], { o: '#7a4a10', y: '#ffd36b', w: '#fff6cc', d: '#e0962a' }),
  );

  // iconos de las mejoras (13×13)
  const icon = (key, rows, pal) => make(scene, key, 13, 13, (c) => bitmap(c, 0, 0, rows, { o: '#35282c', ...pal }));
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

  generateUi(scene);
}

// ------------------------------------------------------------------ interfaz

function frame(scene, key, size, { outline, light, dark, fill, stud }) {
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

function button9(scene, key, face, light, dark, lip) {
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

const ICONS = {
  home: ['....x....', '...xxx...', '..xxxxx..', '.xxxxxxx.', 'xxxxxxxxx', '.xx...xx.', '.xx.x.xx.', '.xx.x.xx.', '.xxxxxxx.'],
  restart: ['..xxxx.x.', '.xx..xxx.', 'xx...xxx.', 'x........', 'x.......x', 'x.......x', 'xx.....xx', '.xx...xx.', '..xxxxx..'],
  sound: ['....x....', '...xx..x.', 'xxxxx...x', 'xxxxx.x.x', 'xxxxx.x.x', 'xxxxx...x', '...xx..x.', '....x....', '.........'],
  mute: ['....x....', '...xx....', 'xxxxx.x.x', 'xxxxx..x.', 'xxxxx.x.x', 'xxxxx....', '...xx....', '....x....', '.........'],
  back: ['...x.....', '..xx.....', '.xxxxxxxx', 'xxxxxxxxx', '.xxxxxxxx', '..xx.....', '...x.....', '.........', '.........'],
};

function generateUi(scene) {
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

  for (const [key, size, empty] of [
    ['star', 23, false],
    ['star-empty', 23, true],
    ['star-sm', 9, false],
    ['star-sm-empty', 9, true],
  ]) {
    const pts = [];
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
