// Resolución lógica del arte (1 unidad = 1 píxel de arte).
// El canvas real es W*Z × H*Z y las cámaras hacen zoom Z: el pixel art se ve nítido
// y los textos van a alta resolución.
export const W = 240;
export const H = 426;
export const VIEW = { Z: 3 };

export const TILE = 12; // tamaño de casilla de los mapas (20 columnas)
export const COLS = W / TILE;

export const GRAVITY = 500; // px/s² (Matter gravity y = 0.5)
export const MAX_SPEED = 360; // px/s a potencia máxima (~130 px ≈ 11 casillas de altura)
export const MAX_DRAG = 64; // px lógicos de arrastre para potencia máxima
export const FOLLOW_OFFSET = 40;
export const BALL_R = 5;
export const STEP = 1000 / 120; // paso fijo de física (ms)

export const FONT = '"Jersey 10", "Pixelify Sans", monospace';
export const FONT_SCALE = 1.35; // Jersey 10 es estrecha: se escala para mantener los tamaños lógicos

export const PAL = {
  ink: '#141a33',
  navy: '#2b3768',
  blue: '#3d6fd6',
  sky: '#5aa8f0',
  cyan: '#7fe3f5',
  white: '#f4f6fb',
  steel: '#8e9ac0',
  grassL: '#b8ec6a',
  grass: '#5cb84a',
  sand: '#ffd36b',
  orange: '#ff8a5c',
  red: '#ef4d5e',
  gold: '#f2b43a',
};

export const hex = (s) => parseInt(s.slice(1), 16);

/**
 * Materiales: fricción/rebote de Matter, amortiguación al rodar (damp),
 * multiplicador de potencia del golpe y color del polvo.
 */
export const MATERIALS = {
  grass: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#a9f07a') },
  sand: { friction: 0.9, restitution: 0, damp: 14, power: 0.75, dust: hex('#f2d083') },
  ice: { friction: 0, restitution: 0.2, damp: 0.08, power: 1, dust: hex('#ffffff') },
  wood: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#a9f07a') },
  mushroom: { friction: 0.6, restitution: 0.8, damp: 2, power: 1.4, dust: hex('#ff9aa2') },
  crumble: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#dc9b67') },
  bounds: { friction: 0.1, restitution: 0.45, damp: 2, power: 1, dust: hex('#ffffff') },
};

/** Paletas de cada mundo (fondo de cuadros, tierra, hierba y agua) */
export const THEMES = {
  day: {
    bgA: '#a8ef8e', bgB: '#80d07e',
    outline: '#35282c', dirt: '#c8834f', stripe: '#b47143', dirtLight: '#dc9b67',
    grassHi: '#b4f282', grass: '#72d454', grassDark: '#4aa947', grassLine: '#2c5a35',
    water: '#5aaee3', waterHi: '#a8def7', waterMid: '#7cc4ee',
  },
  sunset: {
    bgA: '#ffdcb6', bgB: '#f8bc94',
    outline: '#3b2230', dirt: '#cf7a62', stripe: '#b8644f', dirtLight: '#e39880',
    grassHi: '#c6f07c', grass: '#8fd35a', grassDark: '#5aa84a', grassLine: '#2f4e2d',
    water: '#6aa6e8', waterHi: '#b4d8fb', waterMid: '#8cbdf2',
  },
  night: {
    bgA: '#5869ad', bgB: '#4a5a9e',
    outline: '#171630', dirt: '#7d6fae', stripe: '#6b5d9b', dirtLight: '#9486c6',
    grassHi: '#8cecb4', grass: '#52c78b', grassDark: '#37a274', grassLine: '#1d4a44',
    water: '#4f8fe0', waterHi: '#a4ccff', waterMid: '#73aaf0',
  },
};
