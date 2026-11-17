import { transitionTo } from './TransitionScene.js';
import Phaser from 'phaser';
import { W, H, VIEW, TILE, GRAVITY, MAX_SPEED, MAX_DRAG, FOLLOW_OFFSET, BALL_R, STEP, MATERIALS, THEMES, PAL, hex, FONT, FONT_SCALE } from '../constants.js';
import { LEVELS, parseLevel } from '../data/levels.js';
import { renderTerrain, renderBlock, cellSolid } from '../gfx/terrain.js';
import { sfx, music, haptic } from '../systems/audio.js';
import { progress } from '../systems/progress.js';
import { SKINS } from '../data/upgrades.js';
import { saveScore } from '../services/supabase.js';

const { Body, Sleeping } = Phaser.Physics.Matter.Matter;
const T = TILE;

const POWER_COLORS = [hex('#72d454'), hex('#ffd36b'), hex('#ff8a5c'), hex('#ef4d5e')];
const powerColor = (p) => POWER_COLORS[Math.min(3, Math.floor(p * 4))];
const FULL_MAT = { '#': 'grass', G: 'grass', r: 'rough', s: 'sand', i: 'ice' };

/**
 * Escena principal con física Matter (paso fijo de 120 Hz).
 * El nivel sale de un mapa de casillas (data/levels.js); el terreno se pinta como una sola textura.
 * Estados: intro → play → sinking → done
 */
export default class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  init(data) {
    this.levelIndex = Phaser.Math.Clamp(data?.levelIndex ?? 0, 0, LEVELS.length - 1);
    this.L = parseLevel(this.levelIndex);
    this.P = THEMES[this.L.theme];
    this.worldH = this.L.rows * T;
    this.worldW = this.L.cols * T;
    this.state = 'intro';
    this.strokes = 0;
    this.gemsCollected = 0;
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
    this.stats = {
      power: progress.stat('power'),
      aim: progress.stat('aim'),
      grip: progress.stat('grip'),
      magnet: progress.stat('magnet'),
      gemMagnet: progress.stat('gemMagnet'),
    };
    this.brakes = progress.stat('brake');
    this.shields = progress.stat('shield');
    this.skin = SKINS.find((s) => s.id === progress.skin) || SKINS[0];
    this.gemsTaken = [];
  }

  create() {
    const L = this.L;
    this.bus = new Phaser.Events.EventEmitter();

    // Hoyos cerrados: paredes a los lados. Abiertos: solo un techo alto; por los lados y abajo hay vacío.
    const walls = !L.open;
    this.matter.world.setBounds(0, -300, this.worldW, this.worldH + 300, 64, walls, walls, true, false);
    for (const wall of Object.values(this.matter.world.walls)) {
      if (!wall) continue;
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
    this.add.image(3, 4, terrainKey).setOrigin(0).setTintFill(0x1a1020).setAlpha(0.16).setDepth(-5);
    this.add.image(0, 0, terrainKey).setOrigin(0).setDepth(5);
    this.buildClouds();
    this.decorate();

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
    const add = (obj, screenY, f) => {
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
      hills.tile = true;
      add(hills, y, f);
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
    } else {
      add(this.add.image(W - 52, 0, 'glow').setTint(0xfff1b0).setBlendMode('ADD').setScale(1.4).setAlpha(0.5).setDepth(-9.85), 130, 0.1);
      add(this.add.image(W - 52, 0, 'sun').setDepth(-9.8), 130, 0.1);
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

  updateSky() {
    const { x: vx, y: vy } = this.cameras.main.worldView;
    for (const o of this.sky) {
      o.y = o.baseY + vy * (1 - o.f);
      if (o.tile) {
        o.x = vx - 4;
        o.tilePositionX = vx * o.f;
      } else o.x = o.baseX + vx * (1 - o.f);
    }
  }

  buildClouds() {
    this.clouds = [];
    const n = Math.round((this.worldH / 110) * Math.max(1, this.worldW / W));
    for (let i = 0; i < n; i++) {
      const c = this.add
        .image(Phaser.Math.Between(-30, this.worldW + 30), Phaser.Math.Between(10, this.worldH - 60), `cloud${i % 3}`)
        .setTint(this.P.cloudTint ?? 0xffffff)
        .setAlpha(this.P.cloudAlpha ?? 0.75)
        .setFlipX(Math.random() < 0.5)
        .setDepth(-8);
      c.vx = Phaser.Math.FloatBetween(2, 5);
      this.clouds.push(c);
    }
  }

  /** Matas, flores, piedras y (de noche) setas brillantes sobre la hierba; ondas en el agua */
  decorate() {
    const g = this.L.grid;
    const night = this.P.decor === 'night';
    const meadow = this.P.decor === 'meadow';
    const h = (a, b, s) => {
      let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(s, 1442695041) + this.levelIndex * 97;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const blocked = new Set([
      `${this.L.hole.r},${this.L.hole.c}`,
      `${this.L.start.r},${this.L.start.c}`,
      ...this.L.mushrooms.map((m) => `${m.r},${m.c}`),
    ]);
    const free = (r, c) => g[r]?.[c] === '.' && !blocked.has(`${r},${c}`);
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

  staticBody(x, y, w, h, mat, extra = {}) {
    const M = MATERIALS[mat];
    const b = this.matter.add.rectangle(x + w / 2, y + h / 2, w, h, {
      isStatic: true, friction: M.friction, frictionStatic: 0.5, restitution: M.restitution, label: mat, ...extra,
    });
    b.mat = mat;
    return b;
  }

  /** Cuerpos físicos: tramos de casillas fusionados (menos juntas = la bola no se engancha) */
  buildPhysics() {
    const g = this.L.grid;
    const keyOf = (ch) => FULL_MAT[ch] || (ch === '=' ? 'thin' : null);
    const open = [];
    const rects = [];
    for (let r = 0; r < g.length; r++) {
      const runs = [];
      const cols = g[r].length;
      for (let c = 0; c < cols; c++) {
        const key = keyOf(g[r][c]);
        if (!key) continue;
        let n = 1;
        while (c + n < cols && keyOf(g[r][c + n]) === key) n++;
        runs.push({ c0: c, c1: c + n - 1, r0: r, r1: r, key });
        c += n - 1;
      }
      for (const run of runs) {
        const prev = run.key !== 'thin' && open.find((o) => o.key === run.key && o.c0 === run.c0 && o.c1 === run.c1 && o.r1 === r - 1);
        if (prev) prev.r1 = r;
        else {
          open.push(run);
          rects.push(run);
        }
      }
    }
    for (const q of rects) {
      const x = q.c0 * T;
      const w = (q.c1 - q.c0 + 1) * T;
      if (q.key === 'thin') this.staticBody(x, q.r0 * T, w, 7, 'grass');
      else this.staticBody(x, q.r0 * T, w, (q.r1 - q.r0 + 1) * T, q.key);
    }

    // Rampas: cada diagonal continua es un solo triángulo
    const seen = new Set();
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        const ch = g[r][c];
        if ((ch !== '/' && ch !== '\\') || seen.has(`${r},${c}`)) continue;
        const up = ch === '/';
        let n = 0;
        while (g[up ? r - n : r + n]?.[c + n] === ch) {
          seen.add(`${up ? r - n : r + n},${c + n}`);
          n++;
        }
        const v = up
          ? [{ x: c * T, y: (r + 1) * T }, { x: (c + n) * T, y: (r + 1 - n) * T }, { x: (c + n) * T, y: (r + 1) * T }]
          : [{ x: c * T, y: r * T }, { x: (c + n) * T, y: (r + n) * T }, { x: c * T, y: (r + n) * T }];
        const body = this.matter.add.fromVertices((v[0].x + v[1].x + v[2].x) / 3, (v[0].y + v[1].y + v[2].y) / 3, [v], {
          isStatic: true, friction: MATERIALS.grass.friction, frictionStatic: 0.5, restitution: MATERIALS.grass.restitution, label: 'grass',
        });
        body.mat = 'grass';
      }
    }
    this.ground = this.matter.world.localWorld.bodies.find((b) => b.mat === 'grass' && b.bounds.max.y >= this.worldH - 1) || null;
  }

  buildObjects() {
    const L = this.L;
    this.movers = L.movers.map((m) => {
      const w = m.n * T;
      const x = m.c * T;
      const y = m.r * T;
      const body = this.staticBody(x, y, w, 9, 'wood');
      const sprite = this.add.image(x, y, renderBlock(this, `mover-${L.theme}-${w}`, w, 9, L.theme, 'grass')).setOrigin(0).setDepth(6);
      const rail = this.add.graphics().setDepth(4);
      rail.fillStyle(hex(this.P.outline), 0.35);
      for (let rx = x - 24; rx <= x + w + 24; rx += 4) rail.fillRect(rx, y + 4, 2, 1);
      const mv = { body, sprite, baseX: x, x, y, w, h: 9, range: 24, omega: (Math.PI * 2) / 3.2, phase: Math.random() * 6, t: 0, vx: 0 };
      body.mover = mv;
      return mv;
    });
    this.crumbles = L.crumbles.map((cr) => {
      const w = cr.n * T;
      const x = cr.c * T;
      const y = cr.r * T;
      const body = this.staticBody(x, y, w, T, 'crumble');
      const sprite = this.add.image(x, y, renderBlock(this, `crumble-${L.theme}-${w}`, w, T, L.theme, 'crumble')).setOrigin(0).setDepth(6);
      const c = { body, sprite, x, y, w, state: 'idle' };
      body.crumble = c;
      return c;
    });
    for (const m of L.mushrooms) {
      const x = m.c * T;
      const y = (m.r + 1) * T - 6;
      this.staticBody(x, y, T, 6, 'mushroom');
      this.add.image(x, y - 1, 'mushroom').setOrigin(0).setDepth(6);
    }
    this.bumpers = L.bumpers.map((b) => {
      const x = b.c * T + T / 2;
      const y = b.r * T + T / 2;
      const body = this.matter.add.circle(x, y, 7.5, { isStatic: true, restitution: 0.9, friction: 0, label: 'bumper' });
      body.mat = 'bounds';
      body.sprite = this.add.image(x, y, 'bumper').setDepth(7);
      return body;
    });
    this.saws = L.saws.map((s) => {
      const x = s.c * T + T / 2;
      const y = s.r * T + T / 2;
      const sp = this.add.sprite(x, y, 'saw', 0).setDepth(7).play('saw-spin');
      if (s.range) {
        const g = this.add.graphics().setDepth(4);
        g.fillStyle(hex(this.P.outline), 0.4);
        for (let rx = x - s.range; rx <= x + s.range; rx += 3) g.fillRect(rx, y, 2, 1);
        sp.x = x - s.range;
        this.tweens.add({ targets: sp, x: x + s.range, duration: 1800, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      }
      return sp;
    });
    this.gems = L.gems.map((g, idx) => {
      const x = g.c * T + T / 2;
      const y = g.r * T + T / 2;
      const img = this.add.image(x, y, 'gem').setDepth(7);
      this.tweens.add({ targets: img, y: y - 3, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const tw = this.add.sprite(x + 3, y - 3, 'twinkle', 2).setDepth(8);
      this.time.addEvent({
        delay: 1400 + Math.random() * 800,
        loop: true,
        callback: () => {
          if (!tw.active) return;
          tw.setPosition(img.x + Phaser.Math.Between(-3, 3), img.y + Phaser.Math.Between(-3, 2)).setFrame(1);
          this.time.delayedCall(90, () => tw.active && tw.setFrame(0));
          this.time.delayedCall(180, () => tw.active && tw.setFrame(2));
        },
      });
      return { img, tw, taken: false, idx, pulled: false };
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
    this.startPos = { x: s.c * T + T / 2, y: (s.r + 1) * T - BALL_R };
    this.ball = this.matter.add.circle(this.startPos.x, this.startPos.y, BALL_R, {
      label: 'ball', restitution: 0, friction: 0.4, frictionStatic: 0.3, frictionAir: 0, density: 0.004,
    });
    // marcas de salida del tee (en la Pradera)
    if (this.P.decor === 'meadow') {
      const gy = (s.r + 1) * T + 1;
      this.add.image(this.startPos.x - 14, gy, 'tee-red').setOrigin(0.5, 1).setDepth(6);
      this.add.image(this.startPos.x + 14, gy, 'tee-blue').setOrigin(0.5, 1).setDepth(6);
    }
    this.trailG = this.add.graphics().setDepth(9);
    this.ballShadow = this.add.image(0, 0, 'bshadow').setDepth(6).setAlpha(0);
    this.ballSprite = this.add.sprite(this.startPos.x, this.startPos.y, `ball-${this.skin.id}`, 0).setDepth(10);
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
   */
  setupInput() {
    const Z = VIEW.Z;
    this.onDown = (p) => {
      sfx.unlock();
      if (this.state === 'intro') return this.skipIntro();
      if (!this.ready || this.state !== 'play' || this.respawning) return;
      this.kbAiming = false;
      this.aiming = true;
      this.chargeStep = 0;
      this.aimStart = new Phaser.Math.Vector2(p.x / Z, p.y / Z);
      this.aimVec.set(0, 0);
    };
    this.onMove = (p) => {
      if (!this.aiming || this.kbAiming) return;
      this.aimVec.set(this.aimStart.x - p.x / Z, this.aimStart.y - p.y / Z);
      if (this.aimVec.length() > MAX_DRAG) this.aimVec.setLength(MAX_DRAG);
    };
    this.onUp = () => {
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
    const kb = this.input.keyboard;
    if (kb) {
      kb.on('keydown-R', this.onRestart);
      kb.on('keydown-SPACE', this.onShootKey);
      kb.on('keydown-ENTER', this.onShootKey);
      this.keys = kb.addKeys('LEFT,RIGHT,UP,DOWN,A,D,W,S,SHIFT', false);
    }
  }

  teardownInput() {
    this.input.off('pointerdown', this.onDown);
    this.input.off('pointermove', this.onMove);
    this.input.off('pointerup', this.onUp);
    this.input.off('pointerupoutside', this.onUp);
    const kb = this.input.keyboard;
    kb?.off('keydown-R', this.onRestart);
    kb?.off('keydown-SPACE', this.onShootKey);
    kb?.off('keydown-ENTER', this.onShootKey);
  }

  startKeyboardAim() {
    if (!this.ready || this.state !== 'play' || this.respawning) return;
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
  updateKeyboardAim(delta) {
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
    const step = Math.min(4, Math.floor((this.aimVec.length() / MAX_DRAG) * 4 + 0.001));
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

  getVel() {
    const v = Body.getVelocity(this.ball);
    return { x: v.x * 60, y: v.y * 60 };
  }

  setVel(x, y) {
    Body.setVelocity(this.ball, { x: x / 60, y: y / 60 });
  }

  currentMat() {
    return this.groundBody?.mat || 'grass';
  }

  carrierVelocity() {
    return this.grounded && this.groundBody?.mover ? this.groundBody.mover.vx : 0;
  }

  onCollide(e, start) {
    for (const pair of e.pairs) {
      let other;
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
        if (impact > 60) this.impactFx(other, impact, ny > 0.45);
      }
    }
  }

  /** Onda en el suelo al aterrizar con fuerza */
  ringFx(x, y, { r = 13, flat = 0.8, color = 0xffffff, duration = 320 } = {}) {
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
  shake(duration, intensity) {
    if (progress.settings.shake) this.cameras.main.shake(duration, intensity);
  }

  impactFx(other, impact, floor) {
    const mat = other.mat || 'grass';
    const p = this.ball.position;
    if (floor && impact > 120) this.ringFx(p.x, p.y + BALL_R, { flat: 0.4 });
    if (impact > 260) {
      this.hitStop = Math.max(this.hitStop, 30);
      this.shake(70, 0.003);
      haptic(12);
    }
    if (floor) {
      this.dust.particleTint = MATERIALS[mat]?.dust ?? 0xffffff;
      this.dust.explode(Math.min(8, Math.round(impact / 35)), p.x, p.y + BALL_R);
      this.tweens.add({ targets: this.ballSprite, scaleY: 0.75, scaleX: 1.25, duration: 60, yoyo: true });
    } else {
      this.tweens.add({ targets: this.ballSprite, scaleX: 0.8, scaleY: 1.15, duration: 50, yoyo: true });
    }
    if (mat === 'mushroom' && impact > 100) sfx.boing();
    else sfx.land(impact * 2.5);
  }

  bump(bumper) {
    const p = this.ball.position;
    const d = new Phaser.Math.Vector2(p.x - bumper.position.x, p.y - bumper.position.y).normalize();
    this.bumpVel = { x: d.x * 280, y: d.y * 280 }; // se aplica tras el paso de física
    bumper.sprite.setTexture('bumper-lit');
    this.time.delayedCall(140, () => bumper.sprite.setTexture('bumper'));
    this.tweens.add({ targets: bumper.sprite, scale: 1.3, duration: 70, yoyo: true });
    this.sparks.explode(8, bumper.position.x, bumper.position.y);
    this.ringFx(bumper.position.x, bumper.position.y, { r: 16, flat: 1, color: 0xffd36b, duration: 260 });
    this.shake(80, 0.004);
    this.hitStop = Math.max(this.hitStop, 45);
    haptic(20);
    sfx.bumper();
  }

  /** Un paso fijo de física + reglas propias (amortiguación, viento, plataformas) */
  tick(ms) {
    const dt = ms / 1000;
    this.simTime += ms;

    for (const m of this.movers) {
      m.t += dt;
      const nx = m.baseX + Math.sin(m.t * m.omega + m.phase) * m.range;
      m.vx = (nx - m.x) / dt;
      m.x = nx;
      Body.setPosition(m.body, { x: nx + m.w / 2, y: m.y + m.h / 2 }, true);
    }

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
    if (this.grounded) {
      const gb = this.groundBody;
      const M = MATERIALS[gb.mat] || MATERIALS.grass;
      const k = Math.exp(-M.damp * this.stats.grip * dt);
      vx = carrierVx + (vx - carrierVx) * k;
      if (vy > 0) vy *= k;
      if (this.groundNormal.y > 0.97 && this.relSpeed < 5) {
        vx = carrierVx;
        vy = 0;
      }
      if (gb.crumble && gb.crumble.state === 'idle') this.startCrumble(gb.crumble);
    } else {
      vx += this.L.wind * dt;
    }
    this.setVel(vx, vy);
  }

  startCrumble(cr) {
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
        const r = BALL_R + 1;
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

  shoot(v) {
    const mat = this.currentMat();
    const power = Math.min(v.length() / MAX_DRAG, 1);
    const dir = v.clone().normalize();
    const sp = power * MAX_SPEED * this.stats.power * (MATERIALS[mat]?.power ?? 1);
    this.setVel(dir.x * sp + this.carrierVelocity(), dir.y * sp);
    Body.setAngularVelocity(this.ball, 0);

    this.groundTime = -1000;
    this.grounded = false;
    this.ready = false;
    this.restTime = 0;
    this.strokes++;
    this.readyRing.clear();

    const p = this.ball.position;
    this.dust.particleTint = MATERIALS[mat]?.dust ?? 0xffffff;
    this.dust.explode(6, p.x, p.y + BALL_R);
    this.tweens.add({ targets: this.ballSprite, scaleX: 0.75, scaleY: 1.25, duration: 70, yoyo: true });
    sfx.hit(power);
    if (mat === 'mushroom') {
      this.sparks.explode(8, p.x, p.y + 4);
      sfx.boing();
    }
    if (power > 0.9) {
      this.shake(100, 0.005);
      this.hitStop = 45;
    }
    this.ringFx(p.x, p.y + BALL_R, { r: 6 + power * 10, flat: 0.4, duration: 260 });
    haptic(Math.round(8 + power * 22));

    this.bus.emit('shot', this.strokes);
    this.emitHud();
  }

  drawAim(cx, cy) {
    const g = this.aimGfx;
    g.clear();
    const v = this.aimVec;
    const len = v.length();
    if (len < 6) return;

    const power = len / MAX_DRAG;
    const dir = v.clone().normalize();
    const sp = power * MAX_SPEED * this.stats.power * (MATERIALS[this.currentMat()]?.power ?? 1);
    const col = powerColor(power);
    const ink = hex(this.P.outline);

    let x = cx;
    let y = cy;
    let vx = dir.x * sp + this.carrierVelocity();
    let vy = dir.y * sp;
    const st = 1 / 60;
    const n = Math.round(this.stats.aim * 60); // la mejora "Visor" alarga la trayectoria visible
    for (let i = 1; i <= n; i++) {
      vx += this.L.wind * st;
      vy += GRAVITY * st;
      x += vx * st;
      y += vy * st;
      if (i % 3 === 0) {
        const k = 1 - i / n;
        g.fillStyle(ink, 0.6).fillCircle(x, y, 1.6 + k);
        g.fillStyle(0xffffff, 1).fillCircle(x, y, 0.9 + k);
      }
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

  drawTrail() {
    const g = this.trailG;
    g.clear();
    const pts = this.trailPts;
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      g.lineStyle(1 + k * 5, this.skin.trail, k * 0.5);
      g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
  }

  cellAt(x, y) {
    return this.L.grid[Math.floor(y / T)]?.[Math.floor(x / T)];
  }

  /** Sombra de la bola proyectada hacia abajo sobre el terreno */
  updateBallShadow(cx, cy) {
    const s = this.ballShadow;
    if (!this.ballSprite.visible || this.state === 'sinking' || this.state === 'done') {
      s.setAlpha(0);
      return;
    }
    const maxD = 110;
    let gy = null;
    for (let d = BALL_R - 1; d < maxD; d++) {
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
    const k = Phaser.Math.Clamp((gy - cy - BALL_R) / maxD, 0, 1);
    s.setPosition(cx, gy - 1).setScale(1 - k * 0.6, 1).setAlpha(0.28 * (1 - k));
  }

  // ---------------------------------------------------------------- Bucle

  /** Cámara lenta cuando la bola vuela cerca del hoyo (momento "¿entra o no entra?") */
  targetTimeScale() {
    if (this.state !== 'play' || this.respawning || this.grounded || this.relSpeed < 40) return 1;
    const p = this.ball.position;
    const d = Phaser.Math.Distance.Between(p.x, p.y, this.cupPos.x, this.cupPos.y - BALL_R);
    return d < 30 ? 0.4 : 1;
  }

  update(_, delta) {
    let d = Math.min(delta, 100);
    if (this.hitStop > 0) {
      // hit-stop: congela la física unos ms para dar peso al impacto
      this.hitStop -= d;
      d = 0;
    }
    this.timeScale += (this.targetTimeScale() - this.timeScale) * 0.2;
    this.acc += d * this.timeScale;
    while (this.acc >= STEP) {
      this.tick(STEP);
      this.acc -= STEP;
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
      const dyCup = cy - (this.cupPos.y - BALL_R);
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
      for (const g of this.gems) {
        if (g.taken) continue;
        const dist = Phaser.Math.Distance.Between(cx, cy, g.img.x, g.img.y);
        if (dist < 9) this.collectGem(g);
        else if (dist < this.stats.gemMagnet) {
          // imán de gemas: la gema vuela hacia la bola
          if (!g.pulled) {
            g.pulled = true;
            this.tweens.killTweensOf(g.img);
            g.tw.setVisible(false);
          }
          g.img.x += (cx - g.img.x) * 0.18;
          g.img.y += (cy - g.img.y) * 0.18;
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
    this.counter.setVisible(this.ready || this.aiming).setText(String(this.strokes)).setPosition(cx, cy - 9);
    this.readyRing.clear();
    if (this.ready && !this.aiming) {
      const t = ((this.time.now - this.readyTime) % 1000) / 1000;
      this.readyRing.lineStyle(1.2, 0xffffff, 0.9 * (1 - t)).strokeCircle(cx, cy, 7 + t * 7);
    }
    if (this.aiming) this.drawAim(cx, cy);

    this.drawHolePointer(playing);

    const t = Phaser.Math.Clamp((this.startPos.y - cy) / (this.startPos.y - (this.cupPos.y - BALL_R)), 0, 1);
    this.bus.emit('progress', t);
  }

  // ---------------------------------------------------------------- Eventos de juego

  freezeBall(on) {
    this.frozen = on;
    Sleeping.set(this.ball, on);
    if (on) this.setVel(0, 0);
  }

  collectGem(g) {
    g.taken = true;
    this.gemsTaken.push(g.idx);
    this.gemsCollected++;
    sfx.gem();
    haptic(10);
    this.sparks.explode(10, g.img.x, g.img.y);
    this.tweens.killTweensOf(g.img);
    g.tw.destroy();
    this.tweens.add({ targets: g.img, y: g.img.y - 12, alpha: 0, duration: 320, onComplete: () => g.img.destroy() });
    this.bus.emit('gem', this.gemsCollected);
    this.emitHud();
  }

  /**
   * Flecha en el borde de la pantalla que señala el hoyo cuando no se ve
   * (los hoyos anchos no caben enteros en pantalla).
   */
  drawHolePointer(show) {
    const g = (this.holePtr ||= this.add.graphics().setDepth(29));
    g.clear();
    if (!show || this.aiming) return;
    const v = this.cameras.main.worldView;
    const { x: hx } = this.cupPos;
    const hy = this.cupPos.y - 8;
    if (hx > v.x + 4 && hx < v.right - 4 && hy > v.y + 4 && hy < v.bottom - 4) return;
    const m = 14;
    const px = Phaser.Math.Clamp(hx, v.x + m, v.right - m);
    const py = Phaser.Math.Clamp(hy, v.y + 46, v.bottom - m); // por debajo del HUD
    const a = Math.atan2(hy - py, hx - px);
    const bob = Math.sin(this.time.now / 180) * 1.5;
    const cx = px + Math.cos(a) * bob;
    const cy = py + Math.sin(a) * bob;
    const ink = hex(this.P.outline);
    const tip = (r, da) => ({ x: cx + Math.cos(a + da) * r, y: cy + Math.sin(a + da) * r });
    const p1 = tip(11, 0);
    const p2 = tip(7, 2.3);
    const p3 = tip(7, -2.3);
    g.fillStyle(ink, 0.8).fillCircle(cx, cy, 7.5);
    g.fillStyle(ink, 0.8).fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    g.fillStyle(0xffffff, 1).fillCircle(cx, cy, 6);
    // banderita dentro del círculo
    g.fillStyle(ink, 1).fillRect(cx - 2, cy - 4, 1, 8);
    g.fillStyle(hex(PAL.red), 1).fillTriangle(cx - 1, cy - 4, cx + 4, cy - 2, cx - 1, cy);
  }

  safePos() {
    const s = this.safe;
    const b = s.body;
    if (b?.crumble && b.crumble.state !== 'idle') return { ...this.startPos };
    if (b?.mover) return { x: b.position.x + s.dx, y: s.y };
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
    this.tweens.add({ targets: this.ballSprite, scale: 1.4, duration: 80, yoyo: true });
    this.trailPts = [];
    haptic(25);
    sfx.brake();
    this.bus.emit('brake', this.brakes);
  }

  /** Agua, sierra o fuera de límites: +1 golpe y vuelta a la última posición segura */
  penalty(cx, cy, kind) {
    this.respawning = true;
    this.aiming = false;
    this.kbAiming = false;
    this.ready = false;
    haptic(kind === 'saw' ? [40, 30, 60] : 50);
    this.holePtr?.clear();
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
      this.tweens.add({ targets: this.ballSprite, scale: 0.3, alpha: 0, duration: 300 });
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
      Body.setPosition(this.ball, p);
      this.freezeBall(false);
      this.setVel(0, 0);
      this.groundTime = -1000;
      this.restTime = 0;
      this.ballSprite.setPosition(p.x, p.y).setVisible(true).setAlpha(1).setScale(0);
      this.tweens.add({ targets: this.ballSprite, scale: 1, duration: 250, ease: 'Back.easeOut' });
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
      targets: this.ballSprite, y: y + 3, scale: 0.5, angle: 180, delay: 90, duration: 150, ease: 'Quad.easeIn',
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
    const rec = progress.record(L.id, { strokes: this.strokes, stars, par, gemsTaken: this.gemsTaken });
    saveScore({ level: L.code, strokes: this.strokes });
    // ¿siguiente hoyo dentro del mismo mundo? Si no, el mundo termina aquí
    const hasNext = LEVELS[this.levelIndex + 1]?.world === L.world;
    const worldJustCompleted = !wasComplete && progress.worldCompleted(L.world) >= L.holes;

    this.time.delayedCall(1100, () => {
      this.state = 'done';
      this.bus.emit('complete', {
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
        gems: this.gemsCollected,
        gemsTotal: this.gems.length,
        isBest: rec.isBest,
        coins: rec.coins,
        coinLines: rec.lines,
        totalCoins: progress.coins,
        hasNext,
      });
    });
  }

  /** Palabra que salta del hoyo: ¡Birdie!, ¡Par!… */
  popWord(x, y) {
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
    this.bus.emit('hud', { strokes: this.strokes, gems: this.gemsCollected });
  }

  getHudState() {
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
      gemsTotal: this.gems.length,
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

  goToLevel(i) {
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
