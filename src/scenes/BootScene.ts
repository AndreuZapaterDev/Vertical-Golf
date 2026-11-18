import Phaser from 'phaser';
import { generateTextures } from '../gfx/textures';
import { LEVELS } from '../data/levels';

/**
 * Genera todas las texturas y animaciones. Si en el futuro usas sprites reales,
 * cárgalos en preload() con la misma clave y generateTextures() respetará los que ya existan.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    generateTextures(this);
    this.scene.launch('Transition');

    const anim = (key: string, texture: string, frames: number[], frameRate: number) =>
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(texture, { frames }), frameRate, repeat: -1 });
    anim('flag-wave', 'flag', [0, 1, 2, 3], 8);
    anim('saw-spin', 'saw', [0, 1, 2, 3], 20);
    anim('tuft-sway', 'tuft', [0, 1], 2);
    anim('dune-tuft-sway', 'dune-tuft', [0, 1], 2);
    anim('crab-walk', 'crab', [0, 1], 6);
    anim('reed-sway', 'reed', [0, 1], 2);
    anim('frog-idle', 'frog', [0], 1);
    anim('bird-flap', 'bird', [0, 1], 5);
    for (let i = 0; i < 3; i++) anim(`flower${i}-sway`, `flower${i}`, [0, 1], 2);

    // Atajo de desarrollo: ?level=5 entra directamente a ese nivel
    const lvl = parseInt(new URLSearchParams(window.location.search).get('level') ?? '', 10);
    if (lvl >= 1 && lvl <= LEVELS.length) this.scene.start('Game', { levelIndex: lvl - 1 });
    else this.scene.start('Menu');
  }
}
