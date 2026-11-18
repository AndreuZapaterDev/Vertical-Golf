import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, TILE, THEMES } from '../constants';
import { Background } from '../gfx/background';
import { renderTerrain } from '../gfx/terrain';
import { LEVELS, parseLevel } from '../data/levels';
import { WORLDS, worldById, type WorldDef } from '../data/worlds';
import { tintFill } from '../gfx/tint';
import { progress } from '../systems/progress';
import { sfx, music } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, iconButton, panel } from '../ui/widgets';

/** Hoyos de un mundo (rejilla de 3×3) */
export default class LevelSelectScene extends Phaser.Scene {
  world!: WorldDef;
  bg!: Background;
  previewOpen = false;

  constructor() {
    super('LevelSelect');
  }

  init(data?: { world?: string }) {
    this.world = worldById(data?.world ?? '') || worldById(LEVELS[progress.nextLevelIndex()].world) || WORLDS[0];
  }

  create() {
    fitCamera(this);
    const wd = this.world;
    this.bg = new Background(this, wd.theme);
    music.play(wd.theme);

    // escenario del mundo al pie de la pantalla
    const grid = wd.preview.map((r) => (r + r.slice(-1).repeat(20 - r.length)).split(''));
    const tk = renderTerrain(this, `holes-terrain-${wd.id}`, grid, wd.theme);
    const gy = H - grid.length * TILE;
    tintFill(this.add.image(3, gy + 4, tk), 0x1a1020).setOrigin(0).setAlpha(0.16);
    this.add.image(0, gy, tk).setOrigin(0);

    panel(this, W / 2, 27, 164, 42, 'hud9');
    label(this, W / 2, 20, wd.name.toUpperCase(), 20, { weight: '700', color: PAL.sand, strokeThickness: 4 });
    label(this, W / 2, 40, wd.tagline, 8, { color: '#ffffff', strokeThickness: 2 });
    iconButton(this, 16, 22, 'back', () => this.go('Worlds'));
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.previewOpen) this.go('Worlds');
    });

    const holes = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) => l.world === wd.id);
    panel(this, W / 2, 72, 96, 18, 'hud9');
    this.add.image(W / 2 - 34, 72, 'star-sm');
    label(this, W / 2 - 26, 72, `${progress.worldStars(wd.id)}/${holes.length * 3}`, 9, { ox: 0, weight: '700' });
    label(this, W / 2 + 12, 72, 'ESTRELLAS', 6, { color: '#f0dcc0', strokeThickness: 1 });

    const xs = [52, 120, 188];
    holes.forEach(({ l, i }, k) => {
      const x = xs[k % 3];
      const ty = 116 + Math.floor(k / 3) * 76;
      const unlocked = progress.isLevelUnlocked(i);
      const rec = progress.level(l.id);

      const c = this.add.container(x, ty);
      c.add(this.add.nineslice(0, 0, `btn9-${unlocked ? wd.button : 'gray'}`, 0, 58, 68, 5, 5, 5, 7));
      if (unlocked) {
        c.add(label(this, 0, -18, `${l.number}`, 20, { weight: '700', strokeThickness: 3 }));
        c.add(label(this, 0, -2, l.name, 6, { color: '#fff8ec', strokeThickness: 1, wrap: 54 }));
        for (let s = 0; s < 3; s++) c.add(this.add.image(-11 + s * 11, 13 - (s === 1 ? 1 : 0), rec && s < rec.stars ? 'star-sm' : 'star-sm-empty'));
        c.add(label(this, 0, 29, rec ? `MEJOR ${rec.best} · PAR ${l.par}` : `PAR ${l.par}`, 6, { color: '#ffffff', strokeThickness: 1 }));
        c.setSize(58, 68).setInteractive({ useHandCursor: true });
        c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.07, duration: 90 }));
        c.on('pointerout', () => {
          this.tweens.add({ targets: c, scale: 1, duration: 90 });
          c.y = ty;
        });
        c.on('pointerdown', () => {
          sfx.unlock();
          c.y = ty + 1;
        });
        c.on('pointerup', () => {
          c.y = ty;
          sfx.click();
          this.go('Game', { levelIndex: i });
        });
        // botón de previsualización (esquina superior derecha de la tarjeta)
        const eye = this.add.container(21, -26);
        eye.add([this.add.nineslice(0, 0, 'btn9-white', 0, 14, 15, 5, 5, 5, 7), this.add.image(0, -1, 'icon-eye').setScale(0.9)]);
        eye.setSize(18, 18).setInteractive({ useHandCursor: true });
        eye.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => {
          e?.stopPropagation?.();
          sfx.unlock();
        });
        eye.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => {
          e?.stopPropagation?.();
          sfx.click();
          this.showPreview(i);
        });
        c.add(eye);
        // el siguiente hoyo por jugar late suavemente
        if (!rec) this.tweens.add({ targets: c.list[0], alpha: 0.75, duration: 600, yoyo: true, repeat: -1 });
      } else {
        c.add(label(this, 0, -17, `${l.number}`, 18, { color: '#c8bfb4', strokeThickness: 3 }));
        c.add(this.add.image(0, 5, 'lock').setScale(0.85));
      }
      c.setAlpha(0).setScale(0.6);
      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 260, delay: 40 + k * 35, ease: 'Back.easeOut' });
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
    for (const o of [...L.saws, ...L.bumpers, ...L.mushrooms, ...L.movers, ...L.crumbles]) mark(o.c, o.r);
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
    this.bg.update(delta / 1000);
  }
}
