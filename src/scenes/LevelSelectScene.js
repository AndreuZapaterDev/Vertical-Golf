import { transitionTo } from './TransitionScene.js';
import Phaser from 'phaser';
import { W, H, PAL, TILE } from '../constants.js';
import { Background } from '../gfx/background.js';
import { renderTerrain } from '../gfx/terrain.js';
import { LEVELS } from '../data/levels.js';
import { worldById } from '../data/worlds.js';
import { progress } from '../systems/progress.js';
import { sfx, music } from '../systems/audio.js';
import { fitCamera } from '../ui/camera.js';
import { label, iconButton, panel } from '../ui/widgets.js';

/** Hoyos de un mundo (rejilla de 3×3) */
export default class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelect');
  }

  init(data) {
    this.world = worldById(data?.world) || worldById(LEVELS[progress.nextLevelIndex()].world);
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
    this.add.image(3, gy + 4, tk).setOrigin(0).setTintFill(0x1a1020).setAlpha(0.16);
    this.add.image(0, gy, tk).setOrigin(0);

    label(this, W / 2, 22, wd.name.toUpperCase(), 22, { weight: '700', color: PAL.sand, strokeThickness: 4 });
    label(this, W / 2, 42, wd.tagline, 9, { color: '#ffffff', strokeThickness: 2 });
    iconButton(this, 16, 22, 'back', () => this.go('Worlds'));
    this.input.keyboard?.on('keydown-ESC', () => this.go('Worlds'));

    const holes = LEVELS.map((l, i) => ({ l, i })).filter(({ l }) => l.world === wd.id);
    panel(this, W / 2, 62, 64, 16, 'hud9');
    this.add.image(W / 2 - 18, 62, 'star-sm');
    label(this, W / 2 - 10, 62, `${progress.worldStars(wd.id)}/${holes.length * 3}`, 10, { ox: 0, weight: '700' });

    const xs = [52, 120, 188];
    holes.forEach(({ l, i }, k) => {
      const x = xs[k % 3];
      const ty = 110 + Math.floor(k / 3) * 76;
      const unlocked = progress.isLevelUnlocked(i);
      const rec = progress.level(l.id);

      const c = this.add.container(x, ty);
      c.add(this.add.nineslice(0, 0, `btn9-${unlocked ? wd.button : 'gray'}`, 0, 52, 50, 5, 5, 5, 7));
      if (unlocked) {
        c.add(label(this, 0, -9, `${l.number}`, 20, { weight: '700', strokeThickness: 3 }));
        for (let s = 0; s < 3; s++) c.add(this.add.image(-11 + s * 11, 11 - (s === 1 ? 1 : 0), rec && s < rec.stars ? 'star-sm' : 'star-sm-empty'));
        c.add(label(this, 0, 33, rec ? `Mejor ${rec.best} · Par ${l.par}` : `Par ${l.par}`, 7, { color: '#ffffff', strokeThickness: 2 }));
        c.setSize(52, 50).setInteractive({ useHandCursor: true });
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
        c.add(this.add.image(0, -2, 'lock'));
      }
      c.setAlpha(0).setScale(0.6);
      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 260, delay: 40 + k * 35, ease: 'Back.easeOut' });
    });
  }

  go(key, data) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  update(_, delta) {
    this.bg.update(delta / 1000);
  }
}
