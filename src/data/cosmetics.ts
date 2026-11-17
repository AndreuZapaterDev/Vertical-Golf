import { SKINS } from './upgrades';

/**
 * Cosméticos que se consiguen en el gachapón: bolas (SKINS, en upgrades.ts) y rastros.
 * Las fichas se ganan al completar hoyos (ver ECONOMY.tokens*).
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITIES: Record<Rarity, { name: string; color: string; weight: number }> = {
  common: { name: 'Común', color: '#c8d0e0', weight: 55 },
  rare: { name: 'Rara', color: '#5aa8f0', weight: 28 },
  epic: { name: 'Épica', color: '#b47aff', weight: 13 },
  legendary: { name: 'Legendaria', color: '#ffd36b', weight: 4 },
};

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

export const TRAILS: Trail[] = [
  { id: 'basic', name: 'Clásico', rarity: 'common', colors: [0xffffff] },
  { id: 'mint', name: 'Menta', rarity: 'common', colors: [0xb8ffd8, 0x5ee0a0] },
  { id: 'peach', name: 'Melocotón', rarity: 'common', colors: [0xffe0b0, 0xff9a7a] },
  { id: 'sky', name: 'Cielo', rarity: 'common', colors: [0xd4f8ff, 0x5aa8f0] },
  { id: 'sunset', name: 'Atardecer', rarity: 'rare', colors: [0xef4d5e, 0xff8a5c, 0xffd36b] },
  { id: 'ocean', name: 'Marea', rarity: 'rare', colors: [0x2a4e98, 0x4a86e0, 0x9cecfa] },
  { id: 'thick', name: 'Cometa', rarity: 'rare', colors: [0xffffff, 0xfff1b0], width: 8 },
  { id: 'fire', name: 'Fuego', rarity: 'epic', colors: [0xef4d5e, 0xff8a5c, 0xfff1a8], sparkle: [0xff8a5c, 0xffd36b] },
  { id: 'stars', name: 'Estrellas', rarity: 'epic', colors: [0x5a4f80, 0xa898e0, 0xffffff], sparkle: [0xffffff, 0xfff1b0] },
  { id: 'rainbow', name: 'Arcoíris', rarity: 'legendary', colors: [0xef4d5e, 0xffd36b, 0x72d454, 0x5aa8f0, 0xb47aff], rainbow: true },
  { id: 'gold', name: 'Oro puro', rarity: 'legendary', colors: [0xa8611f, 0xf2b43a, 0xfff6cc], sparkle: [0xffd36b, 0xffffff], width: 7 },
];

export const DEFAULT_TRAIL = 'basic';
export const DEFAULT_SKIN = 'classic';

export const trailById = (id: string) => TRAILS.find((t) => t.id === id) || TRAILS[0];

/** Premio posible del gachapón */
export interface Prize {
  kind: 'skin' | 'trail';
  id: string;
  name: string;
  rarity: Rarity;
}

/** Todo lo que puede salir (lo que viene por defecto no está en el bombo) */
export const PRIZES: Prize[] = [
  ...SKINS.filter((s) => s.id !== DEFAULT_SKIN).map((s): Prize => ({ kind: 'skin', id: s.id, name: s.name, rarity: s.rarity })),
  ...TRAILS.filter((t) => t.id !== DEFAULT_TRAIL).map((t): Prize => ({ kind: 'trail', id: t.id, name: t.name, rarity: t.rarity })),
];

export const GACHA = {
  /** fichas por tirada */
  cost: 3,
  /** fichas que se devuelven si sale repetido */
  refund: 1,
};
