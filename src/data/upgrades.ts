import type { Rarity } from './cosmetics';
import { CRUMBLE_DELAY } from './terrainShapes';

export type UpgradeId = 'power' | 'aim' | 'grip' | 'magnet' | 'wind' | 'boots' | 'sink' | 'lantern' | 'crumble' | 'brake' | 'shield' | 'mulligan';

/** Categoría con la que se agrupan en la tienda */
export type UpgradeGroup = 'shot' | 'terrain' | 'help';

export interface Upgrade {
  id: UpgradeId;
  name: string;
  desc: string;
  /** dónde se nota más (sale en la tarjeta de la tienda) */
  where: string;
  group: UpgradeGroup;
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
  /** Patrón o efecto visual de la skin */
  pattern?: 'stripes' | 'dots' | 'gradient' | 'shimmer' | 'prism';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Mejoras de la cuenta (se compran con monedas).
 * values[n] = efecto con n niveles comprados; costs[n] = precio del nivel n+1.
 *
 * Las de "terreno" salen de lo que usan los mapas: viento (los tres mundos), arena y barro (Playa, Pradera y Pantano),
 * arenas movedizas y niebla (Pantano) y bloques frágiles (muelles, nenúfares). Todas son opcionales: los mapas se
 * validan con una cuenta sin mejoras (tools/check-maps.ts).
 */
export const UPGRADES: Upgrade[] = [
  // --- Golpe
  {
    id: 'power', name: 'Potencia', desc: 'Golpes más fuertes', where: 'Saltos altos y largos', group: 'shot', icon: 'up-power',
    costs: [50, 100, 200], values: [1, 1.08, 1.16, 1.25],
    fmt: (v) => (v === 1 ? 'Normal' : `+${Math.round((v - 1) * 100)}%`),
  },
  {
    id: 'aim', name: 'Visor', desc: 'Ves más trayectoria al apuntar', where: 'Todos los hoyos', group: 'shot', icon: 'up-aim',
    costs: [50, 100, 200], values: [0.3, 0.38, 0.46, 0.56],
    fmt: (v) => ({ 0.3: 'Corto', 0.38: 'Medio', 0.46: 'Largo', 0.56: 'Muy largo' } as Record<number, string>)[v] ?? String(v),
  },
  {
    id: 'grip', name: 'Agarre', desc: 'La bola frena antes al aterrizar', where: 'Islas pequeñas y cuestas', group: 'shot', icon: 'up-grip',
    costs: [50, 100, 200], values: [1, 1.5, 2, 2.6],
    fmt: (v) => (v === 1 ? 'Normal' : `×${v}`),
  },
  {
    id: 'magnet', name: 'Imán de hoyo', desc: 'El hoyo atrae la bola desde más lejos', where: 'El último golpe', group: 'shot', icon: 'up-magnet',
    costs: [50, 100, 200], values: [18, 28, 38, 50],
    fmt: (v) => `${Math.round(v / 12 * 10) / 10} casillas`,
  },

  // --- Terreno y clima
  {
    id: 'wind', name: 'Cortavientos', desc: 'El viento empuja menos a la bola', where: 'Brisas de los tres mundos', group: 'terrain', icon: 'up-wind',
    costs: [60, 120, 240], values: [1, 0.75, 0.5, 0.3],
    fmt: (v) => (v === 1 ? 'Normal' : `-${pct(1 - v)} viento`),
  },
  {
    id: 'boots', name: 'Botas', desc: 'Menos fuerza perdida en arena, rough y barro', where: 'Dunas, búnkers y Pantano', group: 'terrain', icon: 'up-boots',
    costs: [60, 120, 240], values: [1, 0.65, 0.35, 0],
    fmt: (v) => (v === 1 ? 'Normal' : v === 0 ? 'Sin pérdida' : `-${pct(1 - v)} pérdida`),
  },
  {
    id: 'sink', name: 'Antihundimiento', desc: 'Tardas más en hundirte en la arena movediza', where: 'Pantano', group: 'terrain', icon: 'up-sink',
    costs: [60, 120, 240], values: [1700, 2500, 3500, 5200],
    fmt: (v) => (v === 1700 ? 'Normal' : `${(v / 1000).toFixed(1)} s`),
  },
  {
    id: 'lantern', name: 'Linterna', desc: 'Ves más lejos cuando hay niebla', where: 'Niebla del Pantano', group: 'terrain', icon: 'up-lantern',
    costs: [60, 120, 240], values: [1, 1.3, 1.65, 2.1],
    fmt: (v) => (v === 1 ? 'Normal' : `×${v}`),
  },
  {
    id: 'crumble', name: 'Suela firme', desc: 'Los bloques frágiles tardan más en caer', where: 'Muelles y nenúfares', group: 'terrain', icon: 'up-crumble',
    costs: [60, 120, 240], values: [1, 1.4, 1.9, 2.6],
    fmt: (v) => (v === 1 ? 'Normal' : `${((CRUMBLE_DELAY * v) / 1000).toFixed(1)} s`),
  },

  // --- Ayudas (usos por hoyo)
  {
    id: 'brake', name: 'Freno aéreo', desc: 'Botón para frenar la bola en el aire', where: 'Cuando te pasas de fuerza', group: 'help', icon: 'up-brake',
    costs: [150, 300, 500], values: [0, 1, 2, 3],
    fmt: (v) => (v ? `${v} por hoyo` : 'Bloqueado'),
  },
  {
    id: 'shield', name: 'Salvavidas', desc: 'Anula penalizaciones de agua y sierras', where: 'Agua, sierras, cangrejos', group: 'help', icon: 'up-shield',
    costs: [150, 300, 500], values: [0, 1, 2, 3],
    fmt: (v) => (v ? `${v} por hoyo` : 'Bloqueado'),
  },
  {
    id: 'mulligan', name: 'Segunda oportunidad', desc: 'Deshaces tu último golpe, sin penalizar', where: 'Para no perder una estrella', group: 'help', icon: 'up-mulligan',
    costs: [200, 400, 700], values: [0, 1, 2, 3],
    fmt: (v) => (v ? `${v} por hoyo` : 'Bloqueado'),
  },
];

/** Nombre y orden de los grupos de la tienda */
export const UPGRADE_GROUPS: { id: UpgradeGroup; name: string; color: string }[] = [
  { id: 'shot', name: 'Golpe', color: 'gold' },
  { id: 'terrain', name: 'Terreno', color: 'green' },
  { id: 'help', name: 'Ayudas', color: 'purple' },
];

/** Skins (ordenadas por rareza): la clásica viene de serie; el resto salen del gachapón */
export const SKINS: Skin[] = [
  { id: 'classic', name: 'Clásica', rarity: 'common', pal: { o: '#3a3550', w: '#ffffff', s: '#d3d8e6', d: '#dfe3ee' } },
  { id: 'peach', name: 'Melocotón', rarity: 'common', pal: { o: '#5a2a30', w: '#ffd8c0', s: '#ff9a7a', d: '#ffe8dc' } },
  { id: 'mint', name: 'Menta', rarity: 'common', pal: { o: '#1d4a3a', w: '#d0ffe8', s: '#5ee0a0', d: '#a0f0c8' } },
  { id: 'sky', name: 'Celeste', rarity: 'common', pal: { o: '#294b6b', w: '#d5f1ff', s: '#79b9e8', d: '#f5fcff' } },
  { id: 'red', name: 'Roja', rarity: 'common', pal: { o: '#61212d', w: '#ffb3b8', s: '#e84b5d', d: '#ffe3e5' } },
  { id: 'blue', name: 'Azul', rarity: 'common', pal: { o: '#18385b', w: '#9bd9ff', s: '#428bd2', d: '#dff6ff' } },
  { id: 'yellow', name: 'Amarilla', rarity: 'common', pal: { o: '#5c441a', w: '#fff0a3', s: '#f5c842', d: '#fff9d6' } },
  { id: 'lime', name: 'Lima', rarity: 'common', pal: { o: '#31511c', w: '#d7ff88', s: '#83c83c', d: '#f5ffd8' } },
  { id: 'graphite', name: 'Grafito', rarity: 'common', pal: { o: '#171b22', w: '#d7dce5', s: '#636b78', d: '#f7f8fb' } },
  { id: 'pink', name: 'Rosa', rarity: 'common', pal: { o: '#63274a', w: '#ffd1e7', s: '#ed78b5', d: '#fff1f7' } },
  { id: 'coral', name: 'Coral', rarity: 'common', pal: { o: '#6a2931', w: '#ffd2be', s: '#ff8068', d: '#ffe3d7' } },
  { id: 'turquoise', name: 'Turquesa', rarity: 'common', pal: { o: '#174e4c', w: '#bffcf0', s: '#45c7b1', d: '#d6fff5' } },
  { id: 'violet', name: 'Violeta', rarity: 'common', pal: { o: '#3f2a6e', w: '#d7c3ff', s: '#9666d8', d: '#efe6ff' } },
  { id: 'orange', name: 'Naranja', rarity: 'common', pal: { o: '#713b1e', w: '#ffd099', s: '#ff9638', d: '#ffe7c8' } },
  { id: 'cyan', name: 'Cian', rarity: 'common', pal: { o: '#15516a', w: '#b9fbff', s: '#4ddce8', d: '#e6ffff' } },
  { id: 'emerald', name: 'Esmeralda', rarity: 'common', pal: { o: '#174a35', w: '#a9f3c1', s: '#26a96c', d: '#dafbe4' } },
  { id: 'copper', name: 'Cobre', rarity: 'common', pal: { o: '#59301f', w: '#f1c090', s: '#b86f3e', d: '#ffe2c2' } },
  { id: 'indigo', name: 'Índigo', rarity: 'common', pal: { o: '#252a69', w: '#b9c3ff', s: '#4656b8', d: '#e0e5ff' } },
  { id: 'salmon', name: 'Salmón', rarity: 'common', pal: { o: '#71333f', w: '#ffd0d0', s: '#f47f91', d: '#ffe8e8' } },
  { id: 'honey', name: 'Miel', rarity: 'common', pal: { o: '#684219', w: '#fff0a8', s: '#d9a529', d: '#fff8d6' } },
  { id: 'grape', name: 'Uva', rarity: 'common', pal: { o: '#3f2057', w: '#dbaaff', s: '#713c94', d: '#f5dcff' } },
  { id: 'tangerine', name: 'Mandarina', rarity: 'common', pal: { o: '#703519', w: '#ffc487', s: '#f36f21', d: '#ffe4c8' } },
  { id: 'burgundy', name: 'Burdeos', rarity: 'common', pal: { o: '#451b2b', w: '#e39ba9', s: '#8d263f', d: '#ffe2e8' } },
  { id: 'olive', name: 'Oliva', rarity: 'common', pal: { o: '#39421b', w: '#d9e7a5', s: '#7f9d3e', d: '#f5ffd0' } },
  { id: 'sand', name: 'Arena', rarity: 'common', pal: { o: '#69563c', w: '#fff0cf', s: '#e0bd88', d: '#fff8e6' } },
  { id: 'crimson', name: 'Carmesí', rarity: 'common', pal: { o: '#4a172d', w: '#e991ae', s: '#b7284b', d: '#ffdce8' } },
  { id: 'magenta', name: 'Magenta', rarity: 'common', pal: { o: '#60224f', w: '#ffd0f0', s: '#d946a8', d: '#fff0fa' } },
  { id: 'navy', name: 'Marino', rarity: 'common', pal: { o: '#1c2f4d', w: '#a9cdf4', s: '#2a477a', d: '#e7f4ff' } },
  { id: 'aqua', name: 'Aqua', rarity: 'common', pal: { o: '#1f4d51', w: '#baf9f4', s: '#4ab6bc', d: '#e4fffc' } },
  { id: 'royal', name: 'Real', rarity: 'common', pal: { o: '#2c3371', w: '#b9c5ff', s: '#5264d8', d: '#edf0ff' } },
  { id: 'lavender', name: 'Lavanda', rarity: 'rare', pal: { o: '#4b3b63', w: '#f0e2ff', s: '#c4a4e8', d: '#fff7ff' }, pattern: 'dots' },
  { id: 'fire', name: 'Fuego', rarity: 'rare', pal: { o: '#5a1a20', w: '#ffb07a', s: '#ef4d5e', d: '#ffd8b0' }, pattern: 'stripes' },
  { id: 'ocean', name: 'Océano', rarity: 'rare', pal: { o: '#1d2a5a', w: '#9cecfa', s: '#4a86e0', d: '#d4f8ff' }, pattern: 'dots' },
  { id: 'melon', name: 'Sandía', rarity: 'rare', pal: { o: '#1d4a2a', w: '#9be06a', s: '#3c9a46', d: '#2c6a34' }, pattern: 'stripes' },
  { id: 'ice', name: 'Hielo', rarity: 'rare', pal: { o: '#394a5b', w: '#f4f8ff', s: '#a9c5df', d: '#dff7ff' }, pattern: 'stripes' },
  { id: 'galaxy', name: 'Galaxia', rarity: 'rare', pal: { o: '#0d0a28', w: '#3a2a80', s: '#1d1450', d: '#ffffff' }, pattern: 'dots' },
  { id: 'radioactive', name: 'Radiactiva', rarity: 'rare', pal: { o: '#243b18', w: '#cbff5c', s: '#71c936', d: '#f3ffb0' }, pattern: 'stripes' },
  { id: 'electric', name: 'Eléctrica', rarity: 'rare', pal: { o: '#172d67', w: '#bffcff', s: '#4389ef', d: '#f2ffff' }, pattern: 'stripes' },
  { id: 'camo', name: 'Camuflaje', rarity: 'rare', pal: { o: '#273822', w: '#c9d88a', s: '#71874c', d: '#e8edbd' }, pattern: 'dots' },
  { id: 'marble', name: 'Mármol', rarity: 'rare', pal: { o: '#42516a', w: '#ffffff', s: '#adc5df', d: '#d8eaff' }, pattern: 'stripes' },
  { id: 'candy', name: 'Caramelo', rarity: 'epic', pal: { o: '#5a1a40', w: '#ffffff', s: '#ff9ab0', d: '#ef4d5e' }, pattern: 'gradient' },
  { id: 'shadow', name: 'Sombra', rarity: 'epic', pal: { o: '#11131a', w: '#a6b0c5', s: '#303540', d: '#e3ecff' }, pattern: 'shimmer' },
  { id: 'lava', name: 'Plasma', rarity: 'epic', pal: { o: '#29183d', w: '#e8b3ff', s: '#8e45d6', d: '#fff0ff' }, pattern: 'gradient' },
  { id: 'aurora', name: 'Aurora', rarity: 'epic', pal: { o: '#163c48', w: '#8ffff0', s: '#43bba0', d: '#d8a6ff' }, pattern: 'shimmer' },
  { id: 'gold', name: 'Dorada', rarity: 'epic', pal: { o: '#7a4a10', w: '#ffe9a0', s: '#f2b43a', d: '#fff6cc' }, pattern: 'shimmer' },
  { id: 'prism', name: 'Prisma', rarity: 'legendary', pal: { o: '#30135b', w: '#8af7ff', s: '#ef71ff', d: '#fff4a8' }, pattern: 'prism' },
];

/**
 * Al terminar un hoyo:
 *   monedas (mejoras): cada estrella paga una vez, por escalones: la 1.ª (hoyo completado) 5, la 2.ª 5 más y la 3.ª 10 más,
 *     así que el total de un hoyo es 5, 10 o 20 monedas según sus estrellas. Solo se cobra lo nuevo: repetir un hoyo sin mejorar no da monedas.
 *     underPar y holeInOne son bonus extra; con 0 no se pagan ni se muestran
 *   fichas (gachapón): tokens por terminar + tokens3Stars extra si es con 3 estrellas (cada vez)
 */
export const ECONOMY = { starCoins: [5, 5, 10], underPar: 0, holeInOne: 0, tokens: 1, tokens3Stars: 1 };

export function upgradeDef(id: UpgradeId): Upgrade {
  const u = UPGRADES.find((u) => u.id === id);
  if (!u) throw new Error(`Mejora desconocida: ${id}`);
  return u;
}
