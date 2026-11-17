import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, TILE } from '../constants';
import { Background } from '../gfx/background';
import { renderTerrain } from '../gfx/terrain';
import { LEVELS } from '../data/levels';
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
    this.input.keyboard?.on('keydown-ESC', () => this.go('Worlds'));

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

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  update(_: number, delta: number) {
    this.bg.update(delta / 1000);
  }
}
