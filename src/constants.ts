// Resolución lógica del arte (1 unidad = 1 píxel de arte).
// El canvas real es W*Z × H*Z y las cámaras hacen zoom Z: el pixel art se ve nítido
// y los textos van a alta resolución.
export const W = 240;
export const H = 426;
export const VIEW = { Z: 3 };

export const TILE = 12; // tamaño de casilla de los mapas (20 columnas)
export const COLS = W / TILE;

export const GRAVITY = 500; // px/s² (Matter gravity y = 0.5)
export const MAX_SPEED = 420; // px/s a potencia máxima (~145 px ≈ 12 casillas de altura; los hoyos se diseñan para saltos de 6–7 filas con ~80 % de potencia)
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

export const hex = (s: string): number => parseInt(s.slice(1), 16);

/**
 * Materiales: fricción/rebote de Matter, amortiguación al rodar (damp),
 * multiplicador de potencia del golpe y color del polvo.
 */
export type MaterialKey = 'grass' | 'rough' | 'sand' | 'ice' | 'wood' | 'mushroom' | 'crumble' | 'bounds';

export interface Material {
  friction: number;
  restitution: number;
  /** amortiguación al rodar (cuanto más alta, antes frena) */
  damp: number;
  /** multiplicador de potencia del golpe desde este suelo */
  power: number;
  /** color del polvo al botar */
  dust: number;
}

export const MATERIALS: Record<MaterialKey, Material> = {
  grass: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#a9f07a') },
  rough: { friction: 0.9, restitution: 0.08, damp: 9, power: 0.8, dust: hex('#3f9a3c') },
  sand: { friction: 0.9, restitution: 0, damp: 14, power: 0.75, dust: hex('#f2d083') },
  ice: { friction: 0, restitution: 0.2, damp: 0.08, power: 1, dust: hex('#ffffff') },
  wood: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#a9f07a') },
  mushroom: { friction: 0.6, restitution: 0.8, damp: 2, power: 1.4, dust: hex('#ff9aa2') },
  crumble: { friction: 0.6, restitution: 0.3, damp: 3, power: 1, dust: hex('#dc9b67') },
  bounds: { friction: 0.1, restitution: 0.55, damp: 2, power: 1, dust: hex('#ffffff') },
};

/**
 * Paletas y ambientación de cada mundo (fondo de cuadros, tierra, hierba y agua).
 *   sky      'day' | 'sunset' | 'night' → sol, sol grande o luna y estrellas
 *   ambient  partículas de la UI: 'leaf' | 'petal' | 'firefly'
 *   decor    decoración sobre la hierba: 'day' | 'night' | 'meadow' (árboles, arbustos, vallas)
 *   mow      franjas de césped cortado (campo de golf)
 */
export interface Theme {
  bgA: string;
  bgB: string;
  outline: string;
  dirt: string;
  stripe: string;
  dirtLight: string;
  grassHi: string;
  grass: string;
  grassDark: string;
  grassLine: string;
  grassAlt?: string;
  greenHi?: string;
  green?: string;
  greenAlt?: string;
  roughHi?: string;
  rough?: string;
  roughDark?: string;
  water: string;
  waterHi: string;
  waterMid: string;
  sky: 'day' | 'sunset' | 'night';
  cloudTint?: number;
  cloudAlpha?: number;
  ambient: 'leaf' | 'petal' | 'firefly';
  decor: 'day' | 'night' | 'meadow';
  mow?: boolean;
  hillsDark?: [number, number];
}

export type ThemeKey = 'meadow' | 'beach' | 'swamp' | 'day' | 'sunset' | 'night';

export const THEMES: Record<ThemeKey, Theme> = {
  meadow: {
    bgA: '#a6dcf7', bgB: '#90cdf0',
    outline: '#2f2a2c', dirt: '#c08552', stripe: '#a86f43', dirtLight: '#d89d68',
    grassHi: '#c2f58a', grass: '#7ed957', grassDark: '#55b84a', grassLine: '#2e5e35',
    grassAlt: '#6cc94f', greenHi: '#e0ffb0', green: '#a6ec74', greenAlt: '#94e066',
    roughHi: '#5cb84a', rough: '#3f9a3c', roughDark: '#2c7a33',
    water: '#4fa6e6', waterHi: '#b4e4fb', waterMid: '#78c0ef',
    sky: 'day', cloudTint: 0xffffff, cloudAlpha: 0.95, ambient: 'leaf', decor: 'meadow', mow: true, hillsDark: [0.1, 0.2],
  },
  // Paletas provisionales de los mundos que vendrán (se usan en las tarjetas del mapa)
  beach: {
    bgA: '#ffe9b8', bgB: '#ffdc9c',
    outline: '#3a2a26', dirt: '#e8c07a', stripe: '#d4a862', dirtLight: '#f4d496',
    grassHi: '#c8f08a', grass: '#8fd35a', grassDark: '#5aa84a', grassLine: '#2f4e2d',
    water: '#3fb8e0', waterHi: '#b8f0ff', waterMid: '#70d0ee',
    sky: 'day', cloudTint: 0xffffff, cloudAlpha: 0.85, ambient: 'petal', decor: 'day',
  },
  swamp: {
    bgA: '#9fb59a', bgB: '#8aa588',
    outline: '#1e2620', dirt: '#6e5a44', stripe: '#5c4a38', dirtLight: '#86704f',
    grassHi: '#b4d46a', grass: '#7aa846', grassDark: '#567f36', grassLine: '#26401f',
    water: '#5e8a5a', waterHi: '#a4c890', waterMid: '#7aa470',
    sky: 'night', cloudTint: 0xc8d8c0, cloudAlpha: 0.5, ambient: 'firefly', decor: 'night',
  },
  day: {
    sky: 'day', cloudTint: 0xffffff, cloudAlpha: 0.75, ambient: 'leaf', decor: 'day',
    bgA: '#a8ef8e', bgB: '#80d07e',
    outline: '#35282c', dirt: '#c8834f', stripe: '#b47143', dirtLight: '#dc9b67',
    grassHi: '#b4f282', grass: '#72d454', grassDark: '#4aa947', grassLine: '#2c5a35',
    water: '#5aaee3', waterHi: '#a8def7', waterMid: '#7cc4ee',
  },
  sunset: {
    sky: 'sunset', cloudTint: 0xffe2d4, cloudAlpha: 0.75, ambient: 'petal', decor: 'day',
    bgA: '#ffdcb6', bgB: '#f8bc94',
    outline: '#3b2230', dirt: '#cf7a62', stripe: '#b8644f', dirtLight: '#e39880',
    grassHi: '#c6f07c', grass: '#8fd35a', grassDark: '#5aa84a', grassLine: '#2f4e2d',
    water: '#6aa6e8', waterHi: '#b4d8fb', waterMid: '#8cbdf2',
  },
  night: {
    sky: 'night', cloudTint: 0x9aa6dc, cloudAlpha: 0.35, ambient: 'firefly', decor: 'night', hillsDark: [0.28, 0.52],
    bgA: '#5869ad', bgB: '#4a5a9e',
    outline: '#171630', dirt: '#7d6fae', stripe: '#6b5d9b', dirtLight: '#9486c6',
    grassHi: '#8cecb4', grass: '#52c78b', grassDark: '#37a274', grassLine: '#1d4a44',
    water: '#4f8fe0', waterHi: '#a4ccff', waterMid: '#73aaf0',
  },
};
