import type { Rarity } from './cosmetics';

export type UpgradeId = 'power' | 'aim' | 'grip' | 'magnet' | 'brake' | 'shield';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  desc: string;
  icon: string;
  costs: number[];
  values: number[];
  /** texto del valor para la tienda */
  fmt: (v: number) => string;
}

export interface Skin {
  id: string;
  name: string;
  /** rareza en el gachapón */
  rarity: Rarity;
  /** o = contorno, w = blanco, s = sombra, d = hoyuelos */
  pal: { o: string; w: string; s: string; d: string };
  /** dibujo extra: rayas de sandía, puntos… */
  pattern?: 'stripes' | 'dots';
}

/**
 * Mejoras de la cuenta (se compran con monedas).
 * values[n] = efecto con n niveles comprados; costs[n] = precio del nivel n+1.
 */
export const UPGRADES: Upgrade[] = [
  {
    id: 'power', name: 'Potencia', desc: 'Golpes más fuertes', icon: 'up-power',
    costs: [40, 90, 160], values: [1, 1.08, 1.16, 1.25],
    fmt: (v) => (v === 1 ? 'Normal' : `+${Math.round((v - 1) * 100)}%`),
  },
  {
    id: 'aim', name: 'Visor', desc: 'Ves más trayectoria al apuntar', icon: 'up-aim',
    costs: [30, 70, 130], values: [0.3, 0.5, 0.75, 1.1],
    fmt: (v) => ({ 0.3: 'Corto', 0.5: 'Medio', 0.75: 'Largo', 1.1: 'Completo' } as Record<number, string>)[v] ?? String(v),
  },
  {
    id: 'grip', name: 'Agarre', desc: 'La bola frena antes al aterrizar', icon: 'up-grip',
    costs: [40, 80, 140], values: [1, 1.5, 2, 2.6],
    fmt: (v) => (v === 1 ? 'Normal' : `×${v}`),
  },
  {
    id: 'magnet', name: 'Imán de hoyo', desc: 'El hoyo atrae la bola desde más lejos', icon: 'up-magnet',
    costs: [50, 100, 170], values: [18, 28, 38, 50],
    fmt: (v) => `${Math.round(v / 12 * 10) / 10} casillas`,
  },
  {
    id: 'brake', name: 'Freno aéreo', desc: 'Botón para frenar la bola en el aire', icon: 'up-brake',
    costs: [70, 130, 200], values: [0, 1, 2, 3],
    fmt: (v) => (v ? `${v} por hoyo` : 'Bloqueado'),
  },
  {
    id: 'shield', name: 'Salvavidas', desc: 'Anula penalizaciones de agua y sierras', icon: 'up-shield',
    costs: [60, 140], values: [0, 1, 2],
    fmt: (v) => (v ? `${v} por hoyo` : 'Bloqueado'),
  },
];

/** Bolas: la clásica viene de serie; el resto salen del gachapón */
export const SKINS: Skin[] = [
  { id: 'classic', name: 'Clásica', rarity: 'common', pal: { o: '#3a3550', w: '#ffffff', s: '#d3d8e6', d: '#dfe3ee' } },
  { id: 'peach', name: 'Melocotón', rarity: 'common', pal: { o: '#5a2a30', w: '#ffd8c0', s: '#ff9a7a', d: '#ffe8dc' } },
  { id: 'mint', name: 'Menta', rarity: 'common', pal: { o: '#1d4a3a', w: '#d0ffe8', s: '#5ee0a0', d: '#a0f0c8' } },
  { id: 'fire', name: 'Fuego', rarity: 'rare', pal: { o: '#5a1a20', w: '#ffb07a', s: '#ef4d5e', d: '#ffd8b0' } },
  { id: 'ocean', name: 'Océano', rarity: 'rare', pal: { o: '#1d2a5a', w: '#9cecfa', s: '#4a86e0', d: '#d4f8ff' } },
  { id: 'melon', name: 'Sandía', rarity: 'rare', pal: { o: '#1d4a2a', w: '#9be06a', s: '#3c9a46', d: '#2c6a34' }, pattern: 'stripes' },
  { id: 'candy', name: 'Caramelo', rarity: 'epic', pal: { o: '#5a1a40', w: '#ffffff', s: '#ff9ab0', d: '#ef4d5e' }, pattern: 'stripes' },
  { id: 'shadow', name: 'Sombra', rarity: 'epic', pal: { o: '#0d0a18', w: '#5a4f80', s: '#2a2240', d: '#a898e0' } },
  { id: 'gold', name: 'Dorada', rarity: 'legendary', pal: { o: '#7a4a10', w: '#ffe9a0', s: '#f2b43a', d: '#fff6cc' } },
  { id: 'galaxy', name: 'Galaxia', rarity: 'legendary', pal: { o: '#0d0a28', w: '#3a2a80', s: '#1d1450', d: '#ffffff' }, pattern: 'dots' },
];

/**
 * Al terminar un hoyo:
 *   monedas (mejoras): complete por terminar, star por cada estrella NUEVA, underPar / holeInOne
 *   fichas (gachapón): tokens por terminar + tokens3Stars extra si es con 3 estrellas (cada vez)
 */
export const ECONOMY = { complete: 5, star: 15, underPar: 10, holeInOne: 25, tokens: 1, tokens3Stars: 1 };

export function upgradeDef(id: UpgradeId): Upgrade {
  const u = UPGRADES.find((u) => u.id === id);
  if (!u) throw new Error(`Mejora desconocida: ${id}`);
  return u;
}
