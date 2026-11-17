import Phaser from 'phaser';
import { gameConfig } from './config';

// Espera a la fuente (máx. 2,5 s) para que los textos no salgan con la tipografía por defecto
async function start() {
  try {
    await Promise.race([
      document.fonts.load('16px "Jersey 10"'),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    /* sin conexión: se usa la fuente de respaldo */
  }
  // El juego usa la API de Phaser 4: con otra versión, avisa claramente en vez de quedarse en negro
  if (!Phaser.VERSION.startsWith('4.')) {
    const msg = `Vertical Golf necesita Phaser 4, pero se ha cargado Phaser ${Phaser.VERSION}. Reinstala las dependencias (npm install).`;
    console.error(msg);
    document.getElementById('game')!.innerHTML = `<p style="color:#ffd36b;font:16px sans-serif;padding:24px;text-align:center">${msg}</p>`;
    return;
  }
  const game = new Phaser.Game(gameConfig);
  window.__GAME__ = game; // útil para depurar desde la consola
  mobileFullscreen();
}

/**
 * En el móvil, el primer toque pone el juego a pantalla completa y en vertical
 * (los navegadores solo lo permiten tras una interacción). Si ya está instalado
 * en la pantalla de inicio, no hace falta.
 */
function mobileFullscreen() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (!touch || standalone) return;
  const go = () => {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('portrait'))
      .catch(() => {
        /* iPhone (Safari) no deja: se juega igual, con las barras del navegador */
      });
  };
  document.addEventListener('touchend', go, { once: true });
}

start();
