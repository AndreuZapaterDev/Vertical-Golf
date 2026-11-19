// Resolución lógica del arte (1 unidad = 1 píxel de arte).
// El canvas real es W*Z × H*Z y las cámaras hacen zoom Z: el pixel art se ve nítido
// y los textos van a alta resolución.
/** Versión del juego (se muestra en la pantalla inicial) */
export const GAME_VERSION = '1.10';

export const W = 240;
export const H = 426;
export const VIEW = { Z: 3 };

export const TILE = 12; // tamaño de casilla de los mapas (20 columnas)
export const COLS = W / TILE;

export const GRAVITY = 500; // px/s² (Matter gravity y = 0.5)
export const MAX_SPEED = 420; // px/s a potencia máxima (~145 px ≈ 12 casillas de altura; los hoyos se diseñan para saltos de 6–7 filas con ~80 % de potencia)
export const MAX_DRAG = 64; // px lógicos de arrastre para potencia máxima
/** Curva de la potencia del golpe: potencia = (arrastre / MAX_DRAG) ^ SHOT_POWER_EXPONENT */
export const SHOT_POWER_EXPONENT = 1.25;
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
export type MaterialKey = 'grass' | 'rough' | 'sand' | 'ice' | 'wood' | 'mushroom' | 'crumble' | 'mud' | 'quicksand' | 'bounds';

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
  // Pantano: el barro frena en seco y resta mucha potencia; las arenas movedizas frenan aún más (y te hunden si te quedas)
  mud: { friction: 1, restitution: 0, damp: 20, power: 0.7, dust: hex('#5a4636') },
  quicksand: { friction: 1, restitution: 0, damp: 26, power: 0.6, dust: hex('#b8a468') },
  bounds: { friction: 0.1, restitution: 0.55, damp: 2, power: 1, dust: hex('#ffffff') },
};

/**
 * Paletas y ambientación de cada mundo (fondo de cuadros, tierra, hierba y agua).
 *   sky      'day' | 'sunset' | 'night' → sol, sol grande o luna y estrellas
 *   ambient  partículas de la UI: 'leaf' | 'petal' | 'firefly'
 *   decor    decoración sobre la hierba: 'day' | 'night' | 'meadow' (árboles, arbustos, vallas) | 'beach' (palmeras, conchas, estrellas de mar)
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
  decor: 'day' | 'night' | 'meadow' | 'beach' | 'swamp' | 'jungle';
  mow?: boolean;
  hillsDark?: [number, number];
  /** terreno de arena: textura con ondulaciones y sin hierba colgante (Playa) */
  /** pantano: algas en el agua y más musgo colgando bajo las islas */
  swampy?: boolean;
  /** selva: muchas lianas largas colgando bajo las islas */
  jungly?: boolean;
  sandy?: boolean;
  /** sin contorno oscuro donde la tierra toca el agua (pozas que se funden con la arena) */
  softWater?: boolean;
}

export type ThemeKey = 'meadow' | 'beach' | 'swamp' | 'haunted' | 'castle' | 'west' | 'jungle' | 'temple' | 'sea' | 'industrial' | 'neon' | 'circus' | 'candy' | 'cave' | 'ice' | 'volcano' | 'nuclear' | 'sky' | 'space' | 'deepspace' | 'day' | 'sunset' | 'night';

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
    bgA: '#bdeefa', bgB: '#a6e4f6',
    outline: '#8c6c48',
    dirt: '#ecd9b0', stripe: '#ddc596', dirtLight: '#f8ecce',
    grassHi: '#fff5d2', grass: '#f6e4b2', grassDark: '#dcc18c', grassLine: '#a9854f',
    greenHi: '#d8f7b2', green: '#abe37e', greenAlt: '#9ad56e',
    roughHi: '#c6c76c', rough: '#9aa44c', roughDark: '#68722f',
    water: '#2fcbdd', waterHi: '#c8fbff', waterMid: '#6fe2ee',
    sky: 'day', cloudTint: 0xffffff, cloudAlpha: 0.9, ambient: 'petal', decor: 'beach', sandy: true, softWater: true,
  },
  swamp: {
    bgA: '#4d6a58', bgB: '#43604f',
    outline: '#17211a',
    dirt: '#5a4632', stripe: '#473725', dirtLight: '#74593d',
    grassHi: '#a6c85a', grass: '#6f9a3c', grassDark: '#4c7430', grassLine: '#1f3a1a',
    greenHi: '#c6e07a', green: '#8fbf4a', greenAlt: '#7eaf3e',
    roughHi: '#8a9a3a', rough: '#667a2c', roughDark: '#3f5120',
    water: '#3f7a55', waterHi: '#9ad69a', waterMid: '#5fa070',
    sky: 'night', cloudTint: 0xb8d0b8, cloudAlpha: 0.45, ambient: 'firefly', decor: 'swamp', swampy: true, softWater: true, hillsDark: [0.2, 0.36],
  },
  // Mundos futuros (paletas provisionales: se pulirán cuando se hagan sus hoyos)
  castle: {
    bgA: '#7a90b8', bgB: '#6a82ac',
    outline: '#141c30',
    dirt: '#6a6e80', stripe: '#585c6e', dirtLight: '#8a8ea2',
    grassHi: '#9ac078', grass: '#6a9a4e', grassDark: '#4a7a38', grassLine: '#1c2c14',
    water: '#3a6a96', waterHi: '#9ac8e8', waterMid: '#5a92c0',
    sky: 'day', ambient: 'leaf', decor: 'day',
  },
  haunted: {
    bgA: '#2a2638', bgB: '#241f32',
    outline: '#0c0a14',
    dirt: '#4a4258', stripe: '#3a3348', dirtLight: '#665a78',
    grassHi: '#8aa870', grass: '#5a7a58', grassDark: '#3f5a40', grassLine: '#141c14',
    water: '#3a5a5a', waterHi: '#9ad0c0', waterMid: '#5a8a84',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  west: {
    bgA: '#f0c890', bgB: '#e8b878',
    outline: '#4a2414',
    dirt: '#b8683a', stripe: '#96502a', dirtLight: '#d8885a',
    grassHi: '#f0c088', grass: '#d89a5a', grassDark: '#b87a40', grassLine: '#6a3a1a',
    water: '#5a9ab0', waterHi: '#b8e0ec', waterMid: '#80b8cc',
    sky: 'sunset', ambient: 'leaf', decor: 'day',
  },
  jungle: {
    bgA: '#2c7d58', bgB: '#25704e',
    outline: '#0e2412',
    dirt: '#8a4a2a', stripe: '#6e3a20', dirtLight: '#a85f38', // tierra rojiza (laterita)
    grassHi: '#b4f070', grass: '#3fb84a', grassDark: '#23803a', grassLine: '#0e3a1a',
    roughHi: '#2fa04a', rough: '#1f7a3a', roughDark: '#145a2a',
    water: '#2aa890', waterHi: '#9af0d0', waterMid: '#4cc8a8',
    sky: 'day', cloudTint: 0xd8f0d0, cloudAlpha: 0.5, ambient: 'leaf', decor: 'jungle', jungly: true, hillsDark: [0.2, 0.34],
  },
  temple: {
    bgA: '#d8b888', bgB: '#c8a878',
    outline: '#4a3220',
    dirt: '#b8946a', stripe: '#9a7650', dirtLight: '#d8b48a',
    grassHi: '#e8cc98', grass: '#c8a870', grassDark: '#a8844c', grassLine: '#6a4a28',
    water: '#3a9ab8', waterHi: '#9ae0f0', waterMid: '#60bcd4',
    sky: 'sunset', ambient: 'petal', decor: 'day',
  },
  sea: {
    bgA: '#1e5aa8', bgB: '#184e98',
    outline: '#0a2448',
    dirt: '#c8b080', stripe: '#a89060', dirtLight: '#e0c898',
    grassHi: '#f0d8a0', grass: '#d8c088', grassDark: '#b09860', grassLine: '#6a5a38',
    water: '#2a7ac8', waterHi: '#a8e0ff', waterMid: '#58b0e8',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  industrial: {
    bgA: '#6a6c74', bgB: '#5c5e66',
    outline: '#16171c',
    dirt: '#4a4c54', stripe: '#3a3c44', dirtLight: '#686a74',
    grassHi: '#9a9ca6', grass: '#7a7c86', grassDark: '#5a5c66', grassLine: '#22232a',
    water: '#3a2a20', waterHi: '#ff9a3a', waterMid: '#8a4a20',
    sky: 'sunset', ambient: 'leaf', decor: 'day',
  },
  neon: {
    bgA: '#140a2a', bgB: '#10081f',
    outline: '#05020f',
    dirt: '#22103e', stripe: '#1a0c30', dirtLight: '#3a1c66',
    grassHi: '#40f0ff', grass: '#a040ff', grassDark: '#6a20c0', grassLine: '#2a0a5a',
    water: '#ff40c0', waterHi: '#ffd0f0', waterMid: '#ff80d8',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  circus: {
    bgA: '#7a3a8a', bgB: '#6a2e7a',
    outline: '#2a0f38',
    dirt: '#d84a5a', stripe: '#b83648', dirtLight: '#f07080',
    grassHi: '#ffe070', grass: '#f0b030', grassDark: '#c88820', grassLine: '#6a3a10',
    water: '#ff90c0', waterHi: '#ffe0f0', waterMid: '#ffb0d8',
    sky: 'sunset', ambient: 'petal', decor: 'day',
  },
  candy: {
    bgA: '#ffc8e0', bgB: '#ffb8d8',
    outline: '#6a2a48',
    dirt: '#a8683c', stripe: '#8a4e2a', dirtLight: '#c88a58',
    grassHi: '#ffffff', grass: '#ff9ac8', grassDark: '#e870a8', grassLine: '#8a3a68',
    water: '#7a4a2a', waterHi: '#c88a58', waterMid: '#9a6238',
    sky: 'day', ambient: 'petal', decor: 'day',
  },
  cave: {
    bgA: '#2a2f3a', bgB: '#252a34',
    outline: '#0f1218',
    dirt: '#5a5a68', stripe: '#484856', dirtLight: '#767688',
    grassHi: '#7ab89a', grass: '#4a8a74', grassDark: '#356a58', grassLine: '#142a22',
    water: '#2a6a8a', waterHi: '#7ad0e8', waterMid: '#3f8aa8',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  ice: {
    bgA: '#cfe8f6', bgB: '#bcdcf0',
    outline: '#2a4a6a',
    dirt: '#8ab4d8', stripe: '#7098c0', dirtLight: '#b4d4ec',
    grassHi: '#ffffff', grass: '#e8f4ff', grassDark: '#c4dcf0', grassLine: '#6a90b8',
    water: '#7fd0f0', waterHi: '#e0f8ff', waterMid: '#a0e0f8',
    sky: 'day', ambient: 'petal', decor: 'day',
  },
  volcano: {
    bgA: '#3a1a1a', bgB: '#2e1414',
    outline: '#120808',
    dirt: '#4a2a24', stripe: '#3a201c', dirtLight: '#6a3a30',
    grassHi: '#8a7a7a', grass: '#6a5a5a', grassDark: '#4a3c3c', grassLine: '#201414',
    water: '#ff7a2a', waterHi: '#ffd070', waterMid: '#ff9a3a',
    sky: 'sunset', ambient: 'firefly', decor: 'night',
  },
  nuclear: {
    bgA: '#2a3a22', bgB: '#22301c',
    outline: '#0e140a',
    dirt: '#4a4a3a', stripe: '#3a3a2c', dirtLight: '#66664e',
    grassHi: '#c8f070', grass: '#9ad04a', grassDark: '#6a9a30', grassLine: '#1c2c0e',
    water: '#8aff3a', waterHi: '#e0ffa0', waterMid: '#b4f060',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  sky: {
    bgA: '#8cd0ff', bgB: '#78c0f8',
    outline: '#2a4a8a',
    dirt: '#e8f0ff', stripe: '#c8d8f0', dirtLight: '#ffffff',
    grassHi: '#ffffff', grass: '#f4f8ff', grassDark: '#d0e0f8', grassLine: '#8aa8d0',
    water: '#6ab0f0', waterHi: '#c8e4ff', waterMid: '#90c8f8',
    sky: 'day', ambient: 'petal', decor: 'day',
  },
  space: {
    bgA: '#0a0e24', bgB: '#080c1e',
    outline: '#05070f',
    dirt: '#3a3a52', stripe: '#2e2e44', dirtLight: '#52526c',
    grassHi: '#c4c4dc', grass: '#9a9ab4', grassDark: '#6a6a88', grassLine: '#1a1a2a',
    water: '#2a4a9a', waterHi: '#8aa8f0', waterMid: '#4a6ac0',
    sky: 'night', ambient: 'firefly', decor: 'night',
  },
  deepspace: {
    bgA: '#1a0a2e', bgB: '#140824',
    outline: '#07030f',
    dirt: '#4a2a6a', stripe: '#3a2054', dirtLight: '#6a3e90',
    grassHi: '#d8b8ff', grass: '#b48ae0', grassDark: '#7a52b0', grassLine: '#2a1448',
    water: '#7a2a9a', waterHi: '#e0a0ff', waterMid: '#a050d0',
    sky: 'night', ambient: 'firefly', decor: 'night',
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
