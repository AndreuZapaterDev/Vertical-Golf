import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, TILE, THEMES } from '../constants';
import { Background } from '../gfx/background';
import { renderTerrain } from '../gfx/terrain';
import { tintFill } from '../gfx/tint';
import { openSettings, type SettingsPanel } from '../ui/settings';
import { applyLook } from '../ui/looks';
import { LEVELS } from '../data/levels';
import { UPGRADES } from '../data/upgrades';
import { progress } from '../systems/progress';
import { sfx, music } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, gradientFill, makeButton, iconButton, panel } from '../ui/widgets';
import { isSupabaseEnabled } from '../services/supabase';

// Escenario decorativo del menú, con el mismo pintor de terreno que los niveles
const MENU_MAP = [
  '....................',
  '............../#####',
  '##WWW#......########',
  '####################',
  '####################',
  '####################',
];

type Cloud = Phaser.GameObjects.Image & { vx: number };

export default class MenuScene extends Phaser.Scene {
  bg!: Background;
  clouds: Cloud[] = [];
  resetPanel: Phaser.GameObjects.Container | null = null;
  ballY = 0;
  ball!: Phaser.GameObjects.Sprite;
  trail!: Phaser.GameObjects.Graphics;
  trailPts: { x: number; y: number }[] = [];
  dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  settingsPanel: SettingsPanel | null = null;

  constructor() {
    super('Menu');
  }

  create() {
    fitCamera(this);
    const next = progress.nextLevelIndex();
    const nextLevel = LEVELS[next];
    const theme = nextLevel.theme;
    this.bg = new Background(this, theme);

    const gy = H - MENU_MAP.length * TILE;
    const grid = MENU_MAP.map((row) => row.split(''));
    const tk = renderTerrain(this, `menu-terrain-${theme}`, grid, theme);
    tintFill(this.add.image(3, gy + 4, tk), 0x1a1020).setOrigin(0).setAlpha(0.16).setDepth(4);
    this.add.image(0, gy, tk).setOrigin(0).setDepth(5);

    // nubes y decoración
    const P = THEMES[theme];
    this.clouds = [[30, 40, 0], [180, 150, 2], [90, 300, 1], [210, 330, 0]].map(([x, y, k]) =>
      Object.assign(this.add.image(x, y, `cloud${k}`).setTint(P.cloudTint ?? 0xffffff).setAlpha(P.cloudAlpha ?? 0.75).setDepth(-50), { vx: 3 + k }),
    );
    const top = (row: number) => gy + row * TILE + 1;
    this.add.sprite(10, top(2), 'tuft').setOrigin(0.5, 1).setDepth(6).play('tuft-sway');
    this.add.sprite(84, top(3), 'flower0').setOrigin(0.5, 1).setDepth(6).play('flower0-sway');
    this.add.sprite(140, top(2), 'flower1').setOrigin(0.5, 1).setDepth(6).play({ key: 'flower1-sway', delay: 400 });
    this.add.sprite(118, top(3), 'tuft').setOrigin(0.5, 1).setDepth(6).play({ key: 'tuft-sway', startFrame: 1 });
    this.add.image(232, top(1), 'rock').setOrigin(0.5, 1).setDepth(6);

    // hoyo en la meseta derecha
    const hx = 210;
    const hy = gy + TILE;
    this.add.image(hx, hy + 1, 'cup').setDepth(6);
    this.add.image(hx, hy + 1, 'pole').setOrigin(0.5, 1).setDepth(7);
    this.add.sprite(hx + 2, hy - 28, 'flag', 0).setOrigin(0, 0).setDepth(7).play('flag-wave');

    this.ballY = gy + 3 * TILE - 5;
    this.ball = this.add.sprite(90, this.ballY, `ball-${progress.skin}`, 0).setDepth(10);
    this.trail = this.add.graphics().setDepth(9);
    this.trailPts = [];
    this.dust = this.add.particles(0, 0, 'px', {
      lifespan: 400, speed: { min: 15, max: 50 }, angle: { min: 200, max: 340 }, gravityY: 100, alpha: { start: 1, end: 0 },
      tint: 0xb4f282, emitting: false,
    }).setDepth(11);
    this.time.delayedCall(500, () => this.hop());

    // Logo
    const t1 = label(this, W / 2, 66, 'VERTICAL', 26, { strokeThickness: 5, shadowY: 3 });
    const t2 = label(this, W / 2, 104, 'GOLF', 56, { strokeThickness: 7, shadowY: 4, stroke: '#2c5a35' });
    gradientFill(t1, [[0.2, '#ffffff'], [0.9, '#ffe8c8']]);
    gradientFill(t2, [[0.15, '#e8ff9a'], [0.55, '#86d35a'], [0.95, '#3c9a46']]);
    this.tweens.add({ targets: [t1, t2], y: '-=3', duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    label(this, W / 2, 142, 'Golpea, rebota y sube hasta el hoyo', 10);

    // Botones
    panel(this, W / 2, 244, 178, 146, 'panel9').setAlpha(0.94);
    label(this, W / 2, 184, 'SIGUIENTE PARTIDA', 8, { color: '#f0dcc0', strokeThickness: 2 });
    const play = makeButton(this, W / 2, 210, { color: 'green', w: 132, h: 34, text: 'JUGAR', size: 18, onClick: () => this.go('Game', { levelIndex: next }) });
    this.tweens.add({ targets: play, scale: 1.04, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    panel(this, W / 2, 236, 160, 16, 'hud9').setAlpha(0.7);
    label(this, W / 2, 236, `${nextLevel.worldName} · Hoyo ${nextLevel.number} · ${nextLevel.name}`, 8, { color: PAL.sand });
    makeButton(this, W / 2, 267, { color: 'gold', w: 124, h: 26, text: 'MUNDOS', size: 13, onClick: () => this.go('Worlds') });
    const shop = makeButton(this, W / 2, 297, { color: 'blue', w: 124, h: 26, text: '   TIENDA', size: 13, onClick: () => this.go('Shop', { back: 'Menu' }) });
    shop.add(this.add.image(-34, -2, 'up-power'));
    // aviso si hay alguna mejora o bola que ya puedes comprar
    const canBuy = UPGRADES.some((u) => (progress.nextCost(u.id) ?? Infinity) <= progress.coins) || progress.canPull();
    if (canBuy) {
      const badge = label(this, W / 2 + 67, 286, '!', 10, { color: '#ffffff', stroke: '#ef4d5e', strokeThickness: 4 });
      this.tweens.add({ targets: badge, scale: 1.3, duration: 400, yoyo: true, repeat: -1 });
    }

    panel(this, 84, 14, 160, 20, 'hud9');
    this.add.image(12, 14, 'star-sm');
    label(this, 20, 14, `${progress.totalStars()}/${LEVELS.length * 3}`, 8, { ox: 0 });
    this.add.rectangle(56, 14, 1, 13, 0xc8bfb4, 0.6);
    this.add.image(63, 14, 'coin');
    label(this, 71, 14, `${progress.coins}`, 8, { ox: 0, color: PAL.sand });
    this.add.rectangle(108, 14, 1, 13, 0xc8bfb4, 0.6);
    this.add.image(115, 14, 'token');
    label(this, 123, 14, `${progress.tokens}`, 8, { ox: 0, color: '#d8b8ff' });

    // Ajustes (música, efectos, vibración, temblor)
    this.settingsPanel = null;
    const openPanel = () => {
      if (this.settingsPanel) return;
      this.settingsPanel = openSettings(this, {
        onClose: () => (this.settingsPanel = null),
        // el modo DEV y borrar la partida viven en los ajustes
        extras: { onDevChange: () => this.scene.restart(), onReset: () => this.confirmReset() },
      });
    };
    iconButton(this, W - 16, 14, 'gear', openPanel);
    if (progress.devMode) label(this, W - 38, 14, 'DEV', 8, { color: PAL.orange, weight: '700', strokeThickness: 2 });

    this.resetPanel = null;
    // estilo de imagen elegido en los ajustes (se ve al momento en el menú)
    applyLook(this.cameras.main);
    const offLook = progress.onSettingsChange((key) => {
      if (key === 'look') applyLook(this.cameras.main);
    });
    this.events.once('shutdown', () => offLook());
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.resetPanel) this.closeReset();
      else this.settingsPanel?.close();
    });
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.settingsPanel && !this.resetPanel) this.go('Game', { levelIndex: next });
    });
    music.play('menu');
    music.setPaused(false);

    label(this, W / 2, H - 9, isSupabaseEnabled ? '● online' : '○ offline', 8, { color: '#f0dcc0', strokeThickness: 2 }).setDepth(20);

  }

  /** Ventana de confirmación: borra todo el progreso y reinicia el menú */
  confirmReset() {
    if (this.resetPanel) return;
    sfx.click();
    const c = this.add.container(W / 2, H / 2).setDepth(95);
    const blocker = this.add.rectangle(0, 0, W, H, 0x35282c, 0.7).setInteractive();
    blocker.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => e?.stopPropagation?.());
    c.add([
      blocker,
      panel(this, 0, 0, 200, 132),
      label(this, 0, -46, '¿BORRAR PARTIDA?', 14, { weight: '700', color: '#ff9a8a', strokeThickness: 3 }),
      label(this, 0, -18, 'Se borrarán hoyos, estrellas, monedas, mejoras y bolas. No se puede deshacer.', 8, { wrap: 170, color: '#fff8ec', strokeThickness: 2 }),
      makeButton(this, -46, 34, { color: 'white', w: 78, h: 26, text: 'CANCELAR', size: 10, onClick: () => this.closeReset() }),
      makeButton(this, 46, 34, {
        color: 'orange', w: 78, h: 26, text: 'BORRAR', size: 11,
        onClick: () => {
          progress.resetAll();
          sfx.hazard();
          this.closeReset();
          this.scene.restart();
        },
      }),
    ]);
    c.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.resetPanel = c;
  }

  closeReset() {
    this.resetPanel?.destroy();
    this.resetPanel = null;
  }

  hop() {
    if (!this.ball.active) return;
    const fromX = this.ball.x;
    const toX = fromX < 108 ? Phaser.Math.Between(115, 136) : Phaser.Math.Between(80, 100);
    const h = Phaser.Math.Between(30, 90);
    const y0 = this.ballY;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 380 + h * 4,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        this.ball.x = fromX + (toX - fromX) * t;
        this.ball.y = y0 - 4 * h * t * (1 - t);
        this.ball.setFrame(((Math.floor(this.ball.x / 3) % 4) + 4) % 4);
      },
      onComplete: () => {
        this.dust.explode(6, this.ball.x, y0 + 5);
        this.tweens.add({ targets: this.ball, scaleY: 0.75, scaleX: 1.25, duration: 60, yoyo: true });
        this.time.delayedCall(Phaser.Math.Between(200, 500), () => this.hop());
      },
    });
  }

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  update(_: number, delta: number) {
    this.bg.update(delta / 1000);
    for (const c of this.clouds) {
      c.x += c.vx * (delta / 1000);
      if (c.x - c.width / 2 > W + 10) c.x = -c.width / 2 - 10;
    }
    const pts = this.trailPts;
    if (this.ball.y < this.ballY - 2) pts.push({ x: this.ball.x, y: this.ball.y });
    else pts.shift();
    if (pts.length > 10) pts.shift();
    const g = this.trail.clear();
    for (let i = 1; i < pts.length; i++) {
      const k = i / pts.length;
      g.lineStyle(1 + k * 4, 0xffffff, k * 0.5).lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
  }
}
