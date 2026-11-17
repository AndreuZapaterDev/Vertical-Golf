export type UpgradeId = 'power' | 'aim' | 'grip' | 'magnet' | 'brake' | 'shield' | 'gemMagnet';

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
  cost: number;
  /** o = contorno, w = blanco, s = sombra, d = hoyuelos */
  pal: { o: string; w: string; s: string; d: string };
  trail: number;
}

/**
 * Mejoras de la cuenta y bolas comprables con monedas.
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
  {
    id: 'gemMagnet', name: 'Imán de gemas', desc: 'Las gemas cercanas vienen a ti', icon: 'up-gem',
    costs: [35, 80], values: [0, 24, 40],
    fmt: (v) => (v ? `Radio ${v}` : 'Bloqueado'),
  },
];

export const SKINS: Skin[] = [
  { id: 'classic', name: 'Clásica', cost: 0, pal: { o: '#3a3550', w: '#ffffff', s: '#d3d8e6', d: '#dfe3ee' }, trail: 0xffffff },
  { id: 'fire', name: 'Fuego', cost: 100, pal: { o: '#5a1a20', w: '#ffb07a', s: '#ef4d5e', d: '#ffd8b0' }, trail: 0xff8a5c },
  { id: 'ocean', name: 'Océano', cost: 100, pal: { o: '#1d2a5a', w: '#9cecfa', s: '#4a86e0', d: '#d4f8ff' }, trail: 0x7fe3f5 },
  { id: 'melon', name: 'Sandía', cost: 120, pal: { o: '#1d4a2a', w: '#9be06a', s: '#3c9a46', d: '#2c6a34' }, trail: 0x86d35a },
  { id: 'gold', name: 'Dorada', cost: 180, pal: { o: '#7a4a10', w: '#ffe9a0', s: '#f2b43a', d: '#fff6cc' }, trail: 0xffd36b },
  { id: 'shadow', name: 'Sombra', cost: 220, pal: { o: '#0d0a18', w: '#5a4f80', s: '#2a2240', d: '#a898e0' }, trail: 0xa898e0 },
];

export const ECONOMY = { complete: 5, star: 15, gem: 10, underPar: 10, holeInOne: 25 };

export function upgradeDef(id: UpgradeId): Upgrade {
  const u = UPGRADES.find((u) => u.id === id);
  if (!u) throw new Error(`Mejora desconocida: ${id}`);
  return u;
}
