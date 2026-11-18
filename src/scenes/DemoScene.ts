import GameScene from './GameScene';

/**
 * Partida de fondo del menú principal: el propio GameScene en modo demo, con un hoyo aleatorio que juega sola una IA
 * (systems/demoPilot.ts). Es la escena que va DEBAJO del menú (en config.ts va antes que Menu), así los fondos de
 * cada mundo (cielo, colinas, sol, pájaros, decoración, agua) son exactamente los del juego.
 * No guarda progreso, no pone música ni HUD y no lee la entrada. MenuScene la lanza y la para.
 */
export default class DemoScene extends GameScene {
  constructor() {
    super('Demo');
    this.demo = true;
  }
}
