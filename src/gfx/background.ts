import type Phaser from 'phaser';
import { W, H } from '../constants';

/** Fondo de cuadros (para menús). drift: desplazamiento lento en diagonal. */
export class Background {
  drift: boolean;
  tile: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene, themeKey: string, { drift = true } = {}) {
    this.drift = drift;
    this.tile = scene.add.tileSprite(W / 2, H / 2, W + 4, H + 4, `checker-${themeKey}`).setDepth(-100);
    scene.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W, H).setAlpha(0.55).setDepth(-90);
  }

  update(dt: number) {
    if (!this.drift) return;
    this.tile.tilePositionX += 6 * dt;
    this.tile.tilePositionY += 6 * dt;
  }
}
