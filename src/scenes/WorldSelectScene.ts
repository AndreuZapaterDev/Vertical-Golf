import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, PAL } from '../constants';
import { Background } from '../gfx/background';
import { renderTerrain } from '../gfx/terrain';
import { WORLDS, type WorldDef } from '../data/worlds';
import { progress } from '../systems/progress';
import { sfx } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, iconButton, panel } from '../ui/widgets';

const CARD_W = 220;
const SKY_W = 204;
const SKY_H = 58;

/** Mapa de mundos: una tarjeta por mundo con su paisaje en miniatura */
export default class WorldSelectScene extends Phaser.Scene {
  bg!: Background;

  constructor() {
    super('Worlds');
  }

  create() {
    fitCamera(this);
    this.bg = new Background(this, 'day');

    label(this, W / 2, 24, 'MUNDOS', 22, { weight: '700', color: PAL.sand, strokeThickness: 4 });
    iconButton(this, 16, 24, 'back', () => this.go('Menu'));
    this.input.keyboard?.on('keydown-ESC', () => this.go('Menu'));

    WORLDS.forEach((wd, i) => this.card(wd, i, 112 + i * 108));
  }

  card(wd: WorldDef, i: number, y: number) {
    const unlocked = progress.isWorldUnlocked(i);
    const holes = wd.levels.length;
    const c = this.add.container(W / 2, y);
    c.add(panel(this, 0, 0, CARD_W, 100));

    // cielo de cuadros + escenario del mundo
    const top = -44;
    const sky = this.add.tileSprite(-SKY_W / 2, top, SKY_W, SKY_H, `checker-${wd.theme}`).setOrigin(0).setTileScale(0.5);
    const grid = wd.preview.map((r) => r.split(''));
    const tk = renderTerrain(this, `world-card-${wd.id}`, grid, wd.theme);
    const land = this.add.image(-SKY_W / 2, top + SKY_H - 30, tk).setOrigin(0).setCrop(0, 0, SKY_W, 30);
    c.add([sky, land]);
    if (wd.id === 'meadow') {
      // banderita del campo de golf
      c.add(this.add.image(62, top + SKY_H - 30 - 11, 'pole').setOrigin(0.5, 1).setScale(0.7));
      c.add(this.add.sprite(63, top + SKY_H - 30 - 32, 'flag', 0).setOrigin(0, 0).setScale(0.7).play('flag-wave'));
    }

    c.add(label(this, -100, 28, wd.name, 16, { ox: 0, weight: '700', color: unlocked ? '#ffffff' : '#c8bfb4' }));
    c.add(label(this, -100, 42, wd.tagline, 8, { ox: 0, color: '#f0dcc0', strokeThickness: 2 }));

    if (unlocked) {
      c.add(this.add.image(58, 28, 'star-sm'));
      c.add(label(this, 66, 28, `${progress.worldStars(wd.id)}/${holes * 3}`, 10, { ox: 0, weight: '700' }));
      c.add(label(this, 100, 42, `${progress.worldCompleted(wd.id)}/${holes} hoyos`, 8, { ox: 1, color: '#f0dcc0', strokeThickness: 2 }));
      c.setSize(CARD_W, 100).setInteractive({ useHandCursor: true });
      c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.03, duration: 90 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 90 }));
      c.on('pointerdown', () => sfx.unlock());
      c.on('pointerup', () => {
        sfx.click();
        this.go('LevelSelect', { world: wd.id });
      });
    } else {
      sky.setTint(0x8a8494);
      land.setTint(0x8a8494);
      c.add(this.add.rectangle(0, top + SKY_H / 2, SKY_W, SKY_H, 0x35282c, 0.35));
      c.add(this.add.image(0, top + SKY_H / 2 - 4, 'lock').setScale(1.6));
      const msg = wd.comingSoon ? 'PRÓXIMAMENTE' : `Completa ${WORLDS[i - 1].name}`;
      c.add(label(this, 100, 28, msg, 9, { ox: 1, color: PAL.sand, strokeThickness: 2 }));
    }

    c.setAlpha(0).setX(W / 2 + 16);
    this.tweens.add({ targets: c, alpha: 1, x: W / 2, duration: 280, delay: 60 + i * 80, ease: 'Cubic.easeOut' });
  }

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }

  update(_: number, delta: number) {
    this.bg.update(delta / 1000);
  }
}
