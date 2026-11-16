import Phaser from 'phaser';
import { gameConfig } from './config.js';

// Espera a la fuente (máx. 2,5 s) para que los textos no salgan con la tipografía por defecto
async function start() {
  try {
    await Promise.race([
      document.fonts.load('16px "Jersey 10"'),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    /* sin conexión: se usa la fuente de respaldo */
  }
  const game = new Phaser.Game(gameConfig);
  window.__GAME__ = game; // útil para depurar desde la consola
}

start();
