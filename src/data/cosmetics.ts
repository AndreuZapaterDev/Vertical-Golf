import { SKINS } from './upgrades';

/**
 * Lo que se consigue en el gachapón: tipos de pelota (física), skins (SKINS, en upgrades.ts) y rastros.
 * Se equipan por separado: cualquier skin y cualquier rastro valen para cualquier tipo de pelota.
 * Las fichas se ganan al completar hoyos (ver ECONOMY.tokens*).
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: Record<Rarity, { name: string; color: string }> = {
  common: { name: 'Común', color: '#72d454' },
  rare: { name: 'Rara', color: '#5aa8f0' },
  epic: { name: 'Épica', color: '#b47aff' },
  legendary: { name: 'Legendaria', color: '#ffd36b' },
};

/** Orden de las rarezas (de menos a más rara) para ordenar listas */
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

/** Ordena por rareza (común → legendaria) sin cambiar el orden dentro de cada rareza */
export const byRarity = <T extends { rarity: Rarity }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));

/**
 * Rastro que deja la bola al volar.
 *   colors   colores de la cola (de la punta hacia la bola); se reparten a lo largo
 *   rainbow  los colores giran en el tiempo (arcoíris)
 *   sparkle  suelta chispas de estos colores mientras vuela
 *   width    grosor máximo
 */
export interface Trail {
  id: string;
  name: string;
  rarity: Rarity;
  colors: number[];
  rainbow?: boolean;
  sparkle?: number[];
  width?: number;
}

/** Colores lisos comunes, combinaciones raras y efectos animados en las rarezas altas */
export const TRAILS: Trail[] = byRarity([
  { id: 'basic', name: 'Clásico', rarity: 'common', colors: [0xffffff] },
  { id: 'mint', name: 'Verde', rarity: 'common', colors: [0x5ee0a0] },
  { id: 'red', name: 'Rojo', rarity: 'common', colors: [0xef4d5e] },
  { id: 'blue', name: 'Azul', rarity: 'common', colors: [0x5aa8f0] },
  { id: 'yellow', name: 'Amarillo', rarity: 'common', colors: [0xffd36b] },
  { id: 'pink', name: 'Rosa', rarity: 'common', colors: [0xff72b6] },
  { id: 'purple', name: 'Violeta', rarity: 'common', colors: [0xb47aff] },
  { id: 'cyan', name: 'Cian', rarity: 'common', colors: [0x7fe3f5] },
  { id: 'orange', name: 'Naranja', rarity: 'common', colors: [0xff8a5c] },
  { id: 'coral', name: 'Coral', rarity: 'common', colors: [0xff8068] },
  { id: 'turquoise', name: 'Turquesa', rarity: 'common', colors: [0x45c7b1] },
  { id: 'violet', name: 'Violeta claro', rarity: 'common', colors: [0x9666d8] },
  { id: 'emerald', name: 'Esmeralda', rarity: 'common', colors: [0x26a96c] },
  { id: 'copper', name: 'Cobre', rarity: 'common', colors: [0xb86f3e] },
  { id: 'indigo', name: 'Índigo', rarity: 'common', colors: [0x4656b8] },
  { id: 'salmon', name: 'Salmón', rarity: 'common', colors: [0xf47f91] },
  { id: 'honey', name: 'Miel', rarity: 'common', colors: [0xd9a529] },
  { id: 'grape', name: 'Uva', rarity: 'common', colors: [0x713c94] },
  { id: 'tangerine', name: 'Mandarina', rarity: 'common', colors: [0xf36f21] },
  { id: 'burgundy', name: 'Burdeos', rarity: 'common', colors: [0x8d263f] },
  { id: 'olive', name: 'Oliva', rarity: 'common', colors: [0x7f9d3e] },
  { id: 'sand', name: 'Arena', rarity: 'common', colors: [0xe0bd88] },
  { id: 'crimson', name: 'Carmesí', rarity: 'common', colors: [0xb7284b] },
  { id: 'magenta', name: 'Magenta', rarity: 'common', colors: [0xd946a8] },
  { id: 'navy', name: 'Marino', rarity: 'common', colors: [0x2a477a] },
  { id: 'aqua', name: 'Aqua', rarity: 'common', colors: [0x4ab6bc] },
  { id: 'royal', name: 'Real', rarity: 'common', colors: [0x5264d8] },
  { id: 'teal', name: 'Verde azulado', rarity: 'common', colors: [0x1f8f87] },
  { id: 'cream', name: 'Crema', rarity: 'common', colors: [0xffe6b3] },
  { id: 'lilac', name: 'Lila', rarity: 'common', colors: [0xb89be6] },
  { id: 'peach', name: 'Melocotón', rarity: 'rare', colors: [0xffe0b0, 0xff9a7a] },
  { id: 'sky', name: 'Cielo', rarity: 'rare', colors: [0xd4f8ff, 0x5aa8f0] },
  { id: 'sunset', name: 'Atardecer', rarity: 'rare', colors: [0xef4d5e, 0xff8a5c, 0xffd36b] },
  { id: 'ocean', name: 'Marea', rarity: 'rare', colors: [0x2a4e98, 0x4a86e0, 0x9cecfa] },
  { id: 'thick', name: 'Cometa', rarity: 'rare', colors: [0xffffff, 0xfff1b0], width: 8 },
  { id: 'bubbles', name: 'Burbujas', rarity: 'rare', colors: [0xe695e8, 0xffd8f6, 0x72ddd0], sparkle: [0xffffff, 0xc8faff], width: 8 },
  { id: 'candy-cane', name: 'Bastón dulce', rarity: 'rare', colors: [0xef4d5e, 0xffffff] },
  { id: 'desert', name: 'Desierto', rarity: 'rare', colors: [0xd99054, 0xffdc91, 0xfff0c4] },
  { id: 'berry', name: 'Frutos rojos', rarity: 'rare', colors: [0x713c94, 0xd946a8, 0xffa6d7] },
  { id: 'forest', name: 'Bosque', rarity: 'rare', colors: [0x28543a, 0x72b84a, 0xc4e875] },
  { id: 'fire', name: 'Fuego', rarity: 'epic', colors: [0xef4d5e, 0xff8a5c, 0xfff1a8], sparkle: [0xff8a5c, 0xffd36b] },
  { id: 'stars', name: 'Estrellas', rarity: 'epic', colors: [0x5a4f80, 0xa898e0, 0xffffff], sparkle: [0xffffff, 0xfff1b0] },
  { id: 'aurora', name: 'Aurora boreal', rarity: 'epic', colors: [0x286b78, 0x55e6b2, 0xb47aff, 0x5aa8f0], sparkle: [0x9ffff0, 0xffffff], rainbow: true, width: 7 },
  { id: 'lightning', name: 'Chispa', rarity: 'epic', colors: [0x6a4bdb, 0xc3a7ff, 0xfff36b, 0xffffff], sparkle: [0xfff36b, 0xffffff], rainbow: true, width: 6 },
  { id: 'rainbow', name: 'Espectro', rarity: 'rare', colors: [0xef4d5e, 0xffd36b, 0x72d454, 0x5aa8f0, 0xb47aff] },
  { id: 'gold', name: 'Dorado', rarity: 'rare', colors: [0xa8611f, 0xf2b43a, 0xfff6cc] },
  { id: 'confetti', name: 'Confeti', rarity: 'rare', colors: [0xef4d5e, 0xffd36b, 0x72d454, 0x5aa8f0], width: 8 },
  { id: 'supernova', name: 'Supernova', rarity: 'legendary', colors: [0x372387, 0x7a49ff, 0xd975ff, 0x7fe3f5, 0xffffff], sparkle: [0x7fe3f5, 0xffffff, 0xff9ade], rainbow: true, width: 9 },
]);

/**
 * Aura: la luz que rodea a la bola mientras juegas.
 *   color / color2  colores de la luz (color2 se usa en chispas, llamas, órbitas y halos)
 *   style           soft: luz fija · pulse: late · ring: ondas · orbit: puntos que giran · sparks: chispas
 *                   flame: llamas hacia arriba · rainbow: cambia de color · halo: aro doble con puntos
 *   size            tamaño de la luz (1 = normal)
 * 'auto' es la de siempre: toma el color del rastro.
 */
export type AuraStyle = 'soft' | 'pulse' | 'ring' | 'orbit' | 'sparks' | 'flame' | 'rainbow' | 'halo';
export interface Aura {
  id: string;
  name: string;
  rarity: Rarity;
  color: number;
  color2?: number;
  style: AuraStyle;
  size?: number;
}

type AuraRow = [id: string, name: string, rarity: Rarity, color: number, style: AuraStyle, color2?: number, size?: number];
const auraFrom = ([id, name, rarity, color, style, color2, size]: AuraRow): Aura => ({ id, name, rarity, color, style, color2, size });

export const AURAS: Aura[] = byRarity(([
  ['auto', 'Del rastro', 'common', 0xffffff, 'soft'],
  // comunes: luz suave de un color
  ['white', 'Blanca', 'common', 0xffffff, 'soft'], ['warm', 'Cálida', 'common', 0xffd9a0, 'soft'], ['red', 'Roja', 'common', 0xef4d5e, 'soft'],
  ['blue', 'Azul', 'common', 0x5aa8f0, 'soft'], ['green', 'Verde', 'common', 0x72d454, 'soft'], ['yellow', 'Amarilla', 'common', 0xffd36b, 'soft'],
  ['pink', 'Rosa', 'common', 0xff72b6, 'soft'], ['violet', 'Violeta', 'common', 0xb47aff, 'soft'], ['orange', 'Naranja', 'common', 0xff8a5c, 'soft'],
  ['cyan', 'Cian', 'common', 0x7fe3f5, 'soft'], ['teal', 'Verde azulado', 'common', 0x45c7b1, 'soft'], ['lime', 'Lima', 'common', 0xc4e84a, 'soft'],
  ['magenta', 'Magenta', 'common', 0xd946a8, 'soft'], ['gold', 'Dorada', 'common', 0xf2b43a, 'soft'], ['mint', 'Menta', 'common', 0x9ff0c8, 'soft'],
  ['sky', 'Celeste', 'common', 0x9cd4ff, 'soft'], ['coral', 'Coral', 'common', 0xff8068, 'soft'], ['indigo', 'Índigo', 'common', 0x6a78e8, 'soft'],
  ['lilac', 'Lila', 'common', 0xc8aef0, 'soft'], ['peach', 'Melocotón', 'common', 0xffb89a, 'soft'], ['amber', 'Ámbar', 'common', 0xffb020, 'soft'],
  ['scarlet', 'Escarlata', 'common', 0xd8283c, 'soft'], ['azure', 'Azur', 'common', 0x2a8aff, 'soft'], ['jade', 'Jade', 'common', 0x2fb078, 'soft'],
  ['plum', 'Ciruela', 'common', 0x9a4aa8, 'soft'], ['aqua', 'Aqua', 'common', 0x4ad8d0, 'soft'], ['lemon', 'Limón', 'common', 0xf0f060, 'soft'],
  ['rose', 'Rosa té', 'common', 0xf0a0b8, 'soft'], ['ice', 'Hielo', 'common', 0xd8f4ff, 'soft'], ['sun', 'Sol', 'common', 0xffe890, 'soft', undefined, 1.2],
  // raras: laten o sueltan ondas
  ['p-red', 'Latido rojo', 'rare', 0xff4a5a, 'pulse'], ['p-blue', 'Latido azul', 'rare', 0x4a9aff, 'pulse'], ['p-green', 'Latido verde', 'rare', 0x5ee08a, 'pulse'],
  ['p-gold', 'Latido dorado', 'rare', 0xffc83a, 'pulse', undefined, 1.2], ['p-violet', 'Latido violeta', 'rare', 0xa070ff, 'pulse'],
  ['p-pink', 'Latido rosa', 'rare', 0xff6ab0, 'pulse'], ['p-cyan', 'Latido cian', 'rare', 0x5ee8f8, 'pulse'], ['p-orange', 'Latido naranja', 'rare', 0xff8a3a, 'pulse'],
  ['p-white', 'Latido blanco', 'rare', 0xffffff, 'pulse', undefined, 1.25], ['p-lime', 'Latido lima', 'rare', 0xb8f040, 'pulse'],
  ['p-teal', 'Latido turquesa', 'rare', 0x45c7b1, 'pulse'],
  ['r-red', 'Ondas rojas', 'rare', 0xef4d5e, 'ring'], ['r-blue', 'Ondas azules', 'rare', 0x5aa8f0, 'ring'], ['r-green', 'Ondas verdes', 'rare', 0x72d454, 'ring'],
  ['r-gold', 'Ondas doradas', 'rare', 0xffd36b, 'ring'], ['r-violet', 'Ondas violetas', 'rare', 0xb47aff, 'ring'], ['r-pink', 'Ondas rosas', 'rare', 0xff72b6, 'ring'],
  ['r-cyan', 'Ondas cian', 'rare', 0x7fe3f5, 'ring'], ['r-orange', 'Ondas naranjas', 'rare', 0xff8a5c, 'ring'], ['r-white', 'Ondas blancas', 'rare', 0xffffff, 'ring'],
  ['r-teal', 'Ondas turquesa', 'rare', 0x45c7b1, 'ring'], ['r-lime', 'Ondas lima', 'rare', 0xc4e84a, 'ring'], ['r-magenta', 'Ondas magenta', 'rare', 0xd946a8, 'ring'],
  ['r-indigo', 'Ondas índigo', 'rare', 0x6a78e8, 'ring'], ['r-sun', 'Ondas solares', 'rare', 0xffe890, 'ring', undefined, 1.2],
  // épicas: puntos que giran, chispas y llamas (con dos colores)
  ['o-gold', 'Satélites dorados', 'epic', 0xffd36b, 'orbit', 0xfff6cc], ['o-ice', 'Satélites de hielo', 'epic', 0x7fe3f5, 'orbit', 0xffffff],
  ['o-rose', 'Satélites rosas', 'epic', 0xff72b6, 'orbit', 0xffd8f6], ['o-jade', 'Satélites de jade', 'epic', 0x45c7b1, 'orbit', 0xc4ffe8],
  ['o-violet', 'Satélites violetas', 'epic', 0xb47aff, 'orbit', 0x7fe3f5], ['o-fire', 'Satélites de fuego', 'epic', 0xff8a5c, 'orbit', 0xffe890],
  ['s-star', 'Polvo de estrellas', 'epic', 0xffffff, 'sparks', 0xfff1b0], ['s-fairy', 'Hada', 'epic', 0xff9ade, 'sparks', 0xc8faff],
  ['s-spring', 'Primavera', 'epic', 0x9be06a, 'sparks', 0xffd8f6], ['s-electric', 'Electricidad', 'epic', 0x7fb8ff, 'sparks', 0xfff36b],
  ['s-ember', 'Brasas', 'epic', 0xff6a2a, 'sparks', 0xffd36b],
  ['f-fire', 'Llamas', 'epic', 0xff6a2a, 'flame', 0xffd36b], ['f-blue', 'Llamas azules', 'epic', 0x3a8aff, 'flame', 0x9cecfa],
  ['f-ghost', 'Llamas fantasma', 'epic', 0x72ffc0, 'flame', 0xffffff], ['f-violet', 'Llamas violetas', 'epic', 0xa070ff, 'flame', 0xff9ade],
  ['f-sun', 'Llamas solares', 'epic', 0xffb020, 'flame', 0xfff6cc, 1.2],
  // legendarias
  ['rainbow', 'Arcoíris', 'legendary', 0xffffff, 'rainbow'], ['rainbow-big', 'Arcoíris radiante', 'legendary', 0xffffff, 'rainbow', undefined, 1.4],
  ['halo-gold', 'Halo dorado', 'legendary', 0xffd36b, 'halo', 0xffffff, 1.2], ['halo-ice', 'Halo helado', 'legendary', 0x7fe3f5, 'halo', 0xffffff, 1.2],
  ['halo-void', 'Halo del vacío', 'legendary', 0x8a4aff, 'halo', 0xff72b6, 1.2], ['halo-sun', 'Halo solar', 'legendary', 0xff8a3a, 'halo', 0xfff36b, 1.3],
  ['halo-jade', 'Halo de jade', 'legendary', 0x45e0a0, 'halo', 0xe8fff4, 1.2], ['halo-blood', 'Halo carmesí', 'legendary', 0xe0283c, 'halo', 0xffb0b8, 1.2],
] as AuraRow[]).map(auraFrom));

export const DEFAULT_AURA = 'auto';
export const auraById = (id: string) => AURAS.find((a) => a.id === id) || AURAS[0];

/**
 * Tipo de pelota: cambia cómo se comporta (la skin y el rastro son aparte y valen para cualquier tipo).
 * Todos los campos son multiplicadores sobre la bola normal salvo radius y bounce.
 *   radius   radio en px (la normal mide BALL_R = 5)
 *   grip     frenado al rodar (>1 frena antes, <1 rueda más)
 *   bounce   rebote propio (Matter usa el mayor entre bola y suelo; la normal tiene 0)
 *   power    potencia del golpe
 *   gravity  gravedad en el aire (<1 flota más)
 *   wind     cuánto le afecta el viento
 *   magnet   alcance del imán del hoyo
 */
export interface BallType {
  id: string;
  name: string;
  rarity: Rarity;
  desc: string;
  radius?: number;
  grip?: number;
  bounce?: number;
  power?: number;
  gravity?: number;
  wind?: number;
  magnet?: number;
}

export const BALL_TYPES: BallType[] = byRarity([
  { id: 'standard', name: 'Estándar', rarity: 'common', desc: 'La de toda la vida' },
  { id: 'grippy', name: 'Goma', rarity: 'common', desc: 'Se agarra al suelo y frena enseguida', grip: 2 },
  { id: 'slick', name: 'Pulida', rarity: 'common', desc: 'Apenas frena: rueda mucho más lejos', grip: 0.45 },
  { id: 'bouncy', name: 'Saltarina', rarity: 'rare', desc: 'Rebota alto, pero cuesta más controlarla', bounce: 0.6, grip: 0.9 },
  { id: 'mini', name: 'Mini', rarity: 'rare', desc: 'Pequeña y ligera: el viento la empuja más', radius: 3.5, wind: 1.3, power: 1.05 },
  { id: 'heavy', name: 'Plomo', rarity: 'epic', desc: 'Casi ignora el viento, cae a plomo y frena rápido', wind: 0.15, gravity: 1.15, grip: 1.6, power: 0.92 },
  { id: 'feather', name: 'Pluma', rarity: 'epic', desc: 'Flota en el aire y vuela más lejos, pero el viento la lleva', gravity: 0.7, wind: 1.6 },
  { id: 'rocket', name: 'Cohete', rarity: 'legendary', desc: '+15% de potencia en cada golpe', power: 1.15 },
  { id: 'magnet', name: 'Imantada', rarity: 'epic', desc: 'El hoyo la atrae desde el doble de lejos', magnet: 2, grip: 1.3 },
]);

export const DEFAULT_TRAIL = 'basic';
export const DEFAULT_SKIN = 'classic';
export const DEFAULT_BALL = 'standard';

export const trailById = (id: string) => TRAILS.find((t) => t.id === id) || TRAILS[0];
export const ballTypeById = (id: string) => BALL_TYPES.find((b) => b.id === id) || BALL_TYPES[0];

export type PrizeKind = 'skin' | 'ball' | 'trail' | 'aura';

/** Nombre de cada categoría para la UI */
export const KIND_NAMES: Record<PrizeKind, string> = { ball: 'Pelota', skin: 'Skin', trail: 'Rastro', aura: 'Aura' };

/** Premio posible del gachapón */
export interface Prize {
  kind: PrizeKind;
  id: string;
  name: string;
  rarity: Rarity;
}

/** Todo lo que puede salir, por rareza (lo que viene por defecto no está en el bombo) */
export const PRIZES: Prize[] = byRarity([
  ...BALL_TYPES.filter((b) => b.id !== DEFAULT_BALL).map((b): Prize => ({ kind: 'ball', id: b.id, name: b.name, rarity: b.rarity })),
  ...SKINS.filter((s) => s.id !== DEFAULT_SKIN).map((s): Prize => ({ kind: 'skin', id: s.id, name: s.name, rarity: s.rarity })),
  ...TRAILS.filter((t) => t.id !== DEFAULT_TRAIL).map((t): Prize => ({ kind: 'trail', id: t.id, name: t.name, rarity: t.rarity })),
  ...AURAS.filter((a) => a.id !== DEFAULT_AURA).map((a): Prize => ({ kind: 'aura', id: a.id, name: a.name, rarity: a.rarity })),
]);

/** El gachapón nunca da repetidos: solo sortea entre lo que te falta */
export const GACHA = {
  /** fichas por tirada */
  cost: 1,
};
