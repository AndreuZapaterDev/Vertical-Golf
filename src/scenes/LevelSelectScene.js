import { transitionTo } from './TransitionScene.js';
import Phaser from 'phaser';
import { W, H, PAL, hex } from '../constants.js';
import { Background } from '../gfx/background.js';
import { LEVELS } from '../data/levels.js';
import { progress } from '../systems/progress.js';
import { sfx } from '../systems/audio.js';
import { fitCamera } from '../ui/camera.js';
import { label, iconButton, panel } from '../ui/widgets.js';

const TILE = { day: 'blue', sunset: 'orange', night: 'purple' };

export default class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelect');
  }

  create() {
    fitCamera(this);
    this.bg = new Background(this, 'day');
    

    label(this, W / 2, 24, 'NIVELES', 22, { weight: '700', color: PAL.sand, strokeThickness: 4 });
    iconButton(this, 16, 24, 'back', () => this.go('Menu'));
    panel(this, W / 2, 46, 64, 16, 'hud9');
    this.add.image(W / 2 - 18, 46, 'star-sm');
    label(this, W / 2 - 10, 46, `${progress.totalStars()}/${LEVELS.length * 3}`, 10, { ox: 0, weight: '700' });

    const xs = [52, 120, 188];
    LEVELS.forEach((lvl, i) => {
      const x = xs[i % 3];
      const ty = 100 + Math.floor(i / 3) * 66;
      const unlocked = i < progress.unlocked;
      const rec = progress.level(i);

      const c = this.add.container(x, ty);
      c.add(this.add.nineslice(0, 0, `btn9-${unlocked ? TILE[lvl.theme] : 'gray'}`, 0, 50, 48, 5, 5, 5, 7));
      if (unlocked) {
        c.add(label(this, 0, -8, `${i + 1}`, 20, { weight: '700', strokeThickness: 3 }));
        for (let s = 0; s < 3; s++) c.add(this.add.image(-11 + s * 11, 11 - (s === 1 ? 1 : 0), rec && s < rec.stars ? 'star-sm' : 'star-sm-empty'));
        c.setSize(50, 48).setInteractive({ useHandCursor: true });
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
      } else {
        c.add(this.add.image(0, -2, 'lock'));
      }
      c.setAlpha(0).setScale(0.6);
      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 260, delay: 40 + i * 35, ease: 'Back.easeOut' });
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
