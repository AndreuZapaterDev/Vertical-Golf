import Phaser from 'phaser';
import { W, H } from '../constants.js';
import { fitCamera } from '../ui/camera.js';

const SIZE = 24; // tamaño de cada rombo
const DUR = 380; // ms de cada mitad

/**
 * Transición pixel art: una ola de rombos cubre la pantalla, se cambia de escena y se destapa.
 * Vive siempre encima del resto de escenas. Uso: transitionTo(scene, () => scene.scene.start('X'))
 */
export default class TransitionScene extends Phaser.Scene {
  constructor() {
    super('Transition');
  }

  create() {
    fitCamera(this);
    this.g = this.add.graphics();
    this.blocker = this.add.zone(W / 2, H / 2, W, H).setInteractive();
    this.blocker.disableInteractive();
    this.state = 'reveal'; // al arrancar el juego, destapa
    this.t = 0;
    this.cols = Math.ceil(W / SIZE) + 1;
    this.rows = Math.ceil(H / SIZE) + 1;
  }

  /** Cubre la pantalla, ejecuta cb (cambio de escena) y destapa */
  cover(cb) {
    if (this.state === 'cover') return;
    this.state = 'cover';
    this.t = 0;
    this.cb = cb;
    this.blocker.setInteractive();
    this.scene.bringToTop();
  }

  update(_, delta) {
    if (this.state === 'idle') return;
    this.t += delta;
    const p = Math.min(1, this.t / DUR);
    // progreso de cada rombo según su diagonal
    const g = this.g.clear();
    g.fillStyle(0x35282c, 1);
    const span = this.cols + this.rows;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const d = (c + r) / span;
        let k = Phaser.Math.Clamp(p * 1.6 - d * 0.6, 0, 1);
        if (this.state === 'reveal') k = 1 - k;
        if (k <= 0) continue;
        const s = (SIZE * 0.75) * k;
        const x = c * SIZE;
        const y = r * SIZE;
        g.fillPoints([{ x, y: y - s }, { x: x + s, y }, { x, y: y + s }, { x: x - s, y }], true);
      }
    }
    if (p < 1) return;
    if (this.state === 'cover') {
      g.fillRect(0, 0, W, H);
      this.state = 'hold';
      const cb = this.cb;
      this.cb = null;
      cb?.();
      // da un fotograma a la nueva escena para crearse antes de destapar
      this.time.delayedCall(60, () => {
        this.state = 'reveal';
        this.t = 0;
        this.scene.bringToTop();
      });
    } else if (this.state === 'reveal') {
      this.state = 'idle';
      g.clear();
      this.blocker.disableInteractive();
    }
  }
}

export function transitionTo(scene, cb) {
  const t = scene.scene.get('Transition');
  if (t?.sys.isActive()) t.cover(cb);
  else cb();
}
