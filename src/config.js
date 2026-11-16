import Phaser from 'phaser';
import { W, H, GRAVITY, VIEW } from './constants.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import LevelSelectScene from './scenes/LevelSelectScene.js';
import GameScene from './scenes/GameScene.js';
import UIScene from './scenes/UIScene.js';
import TransitionScene from './scenes/TransitionScene.js';
import ShopScene from './scenes/ShopScene.js';

const debug = new URLSearchParams(window.location.search).has('debug');

// Zoom entero según los píxeles físicos disponibles (nítido en móviles con alta densidad)
const dpr = Math.min(window.devicePixelRatio || 1, 3);
VIEW.Z = Phaser.Math.Clamp(Math.floor(Math.min((window.innerWidth * dpr) / W, (window.innerHeight * dpr) / H)), 2, 5);

export const gameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: W * VIEW.Z,
  height: H * VIEW.Z,
  backgroundColor: '#141a33',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  audio: { noAudio: true }, // sonidos sintetizados en systems/audio.js
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
  // Orden de dibujado: Game < UI < Transition
  scene: [BootScene, MenuScene, LevelSelectScene, ShopScene, GameScene, UIScene, TransitionScene],
};
