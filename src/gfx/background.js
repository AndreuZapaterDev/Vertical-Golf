import { W, H } from '../constants.js';

/** Fondo de cuadros (para menús). drift: desplazamiento lento en diagonal. */
export class Background {
  constructor(scene, themeKey, { drift = true } = {}) {
    this.drift = drift;
    this.tile = scene.add.tileSprite(W / 2, H / 2, W + 4, H + 4, `checker-${themeKey}`).setDepth(-100);
  }

  update(dt) {
    if (!this.drift) return;
    this.tile.tilePositionX += 6 * dt;
    this.tile.tilePositionY += 6 * dt;
  }
}
