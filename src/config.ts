import Phaser from 'phaser';
import { W, H, GRAVITY, VIEW } from './constants';
import BootScene from './scenes/BootScene';
import MenuScene from './scenes/MenuScene';
import LevelSelectScene from './scenes/LevelSelectScene';
import WorldSelectScene from './scenes/WorldSelectScene';
import GameScene from './scenes/GameScene';
import DemoScene from './scenes/DemoScene';
import UIScene from './scenes/UIScene';
import TransitionScene from './scenes/TransitionScene';
import ShopScene from './scenes/ShopScene';

const debug = new URLSearchParams(window.location.search).has('debug');

// Zoom entero según los píxeles físicos disponibles (nítido en móviles con alta densidad)
const dpr = Math.min(window.devicePixelRatio || 1, 3);
// (se redondea al más cercano, no hacia abajo: así el lienzo se escala lo menos posible para llenar la pantalla)
VIEW.Z = Phaser.Math.Clamp(Math.round(Math.min((window.innerWidth * dpr) / W, (window.innerHeight * dpr) / H)), 2, 5);

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: W * VIEW.Z,
  height: H * VIEW.Z,
  backgroundColor: '#141a33',
  // sin menú contextual (clic derecho / pulsación larga en el móvil)
  disableContextMenu: true,
  // dos dedos a la vez (mover el mapa en el móvil)
  input: { activePointers: 2 },
  pixelArt: true,
  // En Phaser 4 el valor por defecto pasó a false: lo fijamos para que el pixel art no tiemble
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  audio: { noAudio: true }, // sonidos sintetizados en systems/audio.ts
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: GRAVITY / 1000 },
      autoUpdate: false, // GameScene avanza la física con paso fijo
      positionIterations: 8,
      velocityIterations: 6,
      debug,
    },
  },
  // Orden de dibujado: Demo (partida de fondo) < Menu < Game < UI < Transition
  scene: [BootScene, DemoScene, MenuScene, WorldSelectScene, LevelSelectScene, ShopScene, GameScene, UIScene, TransitionScene],
};
