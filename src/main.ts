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
  crispScaling(game);
  mobileFullscreen();
  capFrameRate(game);
}

/**
 * Escalado del lienzo. Si se muestra a su tamaño (o a un múltiplo entero) se deja "pixelado" (nítido); si el navegador tiene que
 * encogerlo o estirarlo una fracción, el pixelado deja píxeles de distinto tamaño y se ve irregular, así que entonces se suaviza.
 */
function crispScaling(game: Phaser.Game) {
  const apply = () => {
    const c = game.canvas;
    if (!c || !c.width) return;
    const r = c.getBoundingClientRect().width / c.width;
    const exact = Math.abs(r - Math.round(r)) < 0.03;
    c.style.imageRendering = exact ? 'pixelated' : 'auto';
  };
  apply();
  game.scale.on('resize', apply);
  window.addEventListener('resize', apply);
}

/**
 * En pantallas de 100 Hz o más el navegador dibuja un fotograma por refresco (144, 165, 240…), y el juego
 * gastaría 2-4 veces más CPU y batería sin que se note (la física va a paso fijo y el arte es pixel art).
 * Se mide el refresco real y se limita a su mitad/tercio exacto (144 → 72, 120 → 60, 240 → 60): el ritmo
 * sale regular. En pantallas de 60 Hz (o menos) no se toca nada.
 */
function capFrameRate(game: Phaser.Game) {
  setTimeout(() => {
    const t: number[] = [];
    const tick = (now: number) => {
      t.push(now);
      if (t.length < 45) return void requestAnimationFrame(tick);
      const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
      const period = d[Math.floor(d.length / 4)]; // cuartil bajo: ignora los tirones de carga
      const hz = 1000 / period;
      if (hz < 100 || hz > 400) return;
      const n = Math.max(2, Math.round(hz / 60));
      // un 1 % por encima del refresco/n, para que la tolerancia de los relojes no se coma fotogramas
      game.loop.setFPSLimit((hz / n) * 1.01);
      console.info(`[fps] pantalla ~${Math.round(hz)} Hz → límite ${Math.round(hz / n)} fps`);
    };
    requestAnimationFrame(tick);
  }, 2500);
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
