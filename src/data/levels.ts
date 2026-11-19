import { COLS, TILE, type ThemeKey } from '../constants';
import { WORLDS } from './worlds';

/**
 * Los hoyos se dibujan como mapas de texto en data/worlds/<mundo>.ts (18 columnas interiores;
 * las paredes laterales y el suelo se añaden solos, salvo en los hoyos abiertos). Fila 0 = arriba.
 *
 *   .  vacío            #  tierra con hierba     /  rampa que sube a la derecha
 *   \  rampa que sube a la izquierda              =  plataforma fina
 *   {  rampa de arena que sube a la derecha       }  rampa de arena que sube a la izquierda
 *   r  rough (hierba alta: frena y resta potencia)
 *   s  arena (búnker)   i  hielo                 W  agua (penalización)
 *   M  seta saltarina   P  plataforma móvil      C  bloque frágil
 *   T  banco de arena de marea (aparece y desaparece cada pocos segundos; Playa)
 *   m  barro (Pantano: frena en seco)   q  arena movediza (Pantano: si te quedas, te hundes)
 *   O  bumper           X  sierra                Y  sierra móvil (en la Playa, X e Y son cangrejos)
 *   S  salida           H  hoyo
 */

export type MechanicKey = keyof typeof MECHANICS;

/** Un hoyo tal y como se escribe en data/worlds/<mundo>.ts */
export interface LevelDef {
  name: string;
  par: number;
  map: string;
  /** islas flotantes sin paredes ni suelo (caerse = fuera de límites) */
  open?: boolean;
  tutorial?: boolean;
  /** mecánica que se presenta con un aviso al empezar */
  intro?: MechanicKey;
  /** px/s² de empuje horizontal mientras la bola vuela (+ derecha) */
  wind?: number;
  /** vientos distintos según la altura: bandas entre dos alturas (en filas sobre la salida) con su propio viento. Fuera de ellas rige `wind` */
  windZones?: WindZone[];
  /** niebla según la altura: bandas (en filas sobre la salida) con su densidad 0–1; con niebla solo se ve lo que rodea a la bola */
  fogZones?: FogZone[];
}

/** Banda de niebla: de la altura `from` a la `to` (filas por encima de la salida) con densidad `density` (0 = sin niebla, 1 = muy espesa) */
export interface FogZone {
  from: number;
  to: number;
  density: number;
}

/** Banda de viento: de la altura `from` a la `to` (filas por encima de la salida) sopla `wind` px/s² (+ derecha, − izquierda) */
export interface WindZone {
  from: number;
  to: number;
  wind: number;
}

/** Un hoyo con los datos de su mundo y su posición */
export interface LevelMeta extends LevelDef {
  theme: ThemeKey;
  world: string;
  worldName: string;
  worldIndex: number;
  number: number;
  holes: number;
  id: string;
  code: number;
}

export interface Cell {
  c: number;
  r: number;
}
export interface Saw extends Cell {
  range: number;
}
/** tramo horizontal de n casillas (plataformas móviles, bloques frágiles) */
export interface Span extends Cell {
  n: number;
}

/** Hoyo ya convertido en rejilla + objetos (lo que usa GameScene) */
export interface ParsedLevel extends LevelMeta {
  index: number;
  open: boolean;
  grid: string[][];
  cols: number;
  rows: number;
  groundRow: number;
  start: Cell;
  hole: Cell;
  saws: Saw[];
  bumpers: Cell[];
  mushrooms: Cell[];
  movers: Span[];
  crumbles: Span[];
  /** bancos de arena que emergen y se hunden con la marea */
  tides: Span[];
  wind: number;
  /** bandas de viento ya en píxeles (y0 arriba, y1 abajo) */
  windBands: { y0: number; y1: number; wind: number }[];
  /** bandas de niebla ya en píxeles */
  fogBands: { y0: number; y1: number; density: number }[];
}

/**
 * Lista plana de todos los hoyos jugables, en orden de mundos.
 * Cada hoyo sabe a qué mundo pertenece y su número dentro de él.
 *   id    'meadow-3' (clave del guardado)
 *   code  101, 102… (mundo·100 + hoyo; es el número que se guarda en Supabase)
 */
export const LEVELS: LevelMeta[] = WORLDS.flatMap((w, wi) =>
  w.levels.map((l, i) => ({
    ...l,
    theme: w.theme,
    world: w.id,
    worldName: w.name,
    worldIndex: wi,
    number: i + 1,
    holes: w.levels.length,
    id: `${w.id}-${i + 1}`,
    code: (wi + 1) * 100 + i + 1,
  })),
);

export const levelIndexById = (id: string) => LEVELS.findIndex((l) => l.id === id);
export const levelsOfWorld = (worldId: string) => LEVELS.filter((l) => l.world === worldId);

export interface Mechanic {
  title: string;
  text: string;
  color: string;
}

export const MECHANICS = {
  ramp: { title: 'Cuencos y rampas', text: 'La bola rueda cuesta abajo y se queda en el fondo del cuenco.', color: '#b8ec6a' },
  rough: { title: 'Hierba alta', text: 'El rough frena la bola en seco, pero desde ahí golpeas más flojo.', color: '#7ed957' },
  water: { title: 'Agua', text: 'Si la bola cae al agua, +1 golpe y vuelves atrás.', color: '#7fe3f5' },
  sand: { title: 'Búnker', text: 'La arena frena en seco y tus golpes salen más flojos.', color: '#ffd36b' },
  mushroom: { title: 'Seta turbo', text: 'Rebota mucho y desde ella golpeas más fuerte. ¡Úsala para saltar alto!', color: '#ff9aa2' },
  bumper: { title: 'Bumpers', text: '¡Como en un pinball! Te lanzan disparado.', color: '#ff8a5c' },
  moving: { title: 'Plataformas móviles', text: 'Te llevan encima. Elige bien el momento.', color: '#ffd36b' },
  crumble: { title: 'Bloques frágiles', text: 'Se rompen al poco de pisarlos. ¡Date prisa!', color: '#e39880' },
  ice: { title: 'Hielo', text: 'Resbala muchísimo. Los muros te frenan.', color: '#7fe3f5' },
  saw: { title: 'Sierras', text: 'Tocarlas suma un golpe de penalización, y la sierra se rompe.', color: '#ef4d5e' },
  edge: { title: 'Islas flotantes', text: 'Si la bola cae por un borde, +1 golpe y vuelves al último sitio. ¡Mide bien la fuerza!', color: '#ffd36b' },
  coral: { title: 'Corales', text: 'Los corales te lanzan disparado, como un pinball. Aprovéchalos o esquívalos.', color: '#ff9ab0' },
  pier: { title: 'Muelle', text: 'Las tablas del muelle se rompen poco después de pisarlas. ¡No te pares!', color: '#e39880' },
  float: { title: 'Flotadores', text: 'Rebotan mucho y desde ellos golpeas más fuerte. ¡Úsalos para saltar alto!', color: '#ff8a7a' },
  surf: { title: 'Tablas de surf', text: 'Se deslizan de lado a lado y te llevan encima. Elige bien el momento.', color: '#7fe3f5' },
  mud: { title: 'Barro', text: 'El barro frena la bola en seco y los golpes salen más flojos. Intenta no caer en él.', color: '#b08a5c' },
  lily: { title: 'Nenúfares', text: 'Los nenúfares se hunden poco después de pisarlos y vuelven a salir. ¡No te pares!', color: '#8fd46a' },
  frog: { title: 'Ranas', text: 'Las ranas saltan de un lado a otro. Si te tocan, +1 golpe y la rana desaparece; si no quieres el golpe, espera a que se aparte.', color: '#8fd46a' },
  quicksand: { title: 'Arenas movedizas', text: 'La arena movediza te traga si te quedas quieto. ¡Golpea enseguida para salir!', color: '#e6d99c' },
  fog: { title: 'Niebla', text: 'La niebla esconde lo que hay lejos: solo ves cerca de la bola. Memoriza el camino.', color: '#b8d0b8' },
  log: { title: 'Troncos', text: 'Los troncos flotan de lado a lado y te llevan encima. Elige bien el momento.', color: '#b08a5c' },
  tide: { title: 'Marea', text: 'Los bancos de arena emergen y se hunden con la marea. Si suben las olas con la bola encima, +1 golpe: aterriza cuando el banco esté a la vista.', color: '#7fe3f5' },
  dune: { title: 'Dunas', text: 'Las dunas son de arena: frenan la bola y desde ellas golpeas más flojo. Pasa por encima con fuerza.', color: '#ffd36b' },
  crab: { title: 'Cangrejos', text: 'Un cangrejo pasea por la isla. Si lo tocas, +1 golpe y el cangrejo desaparece; mejor pasar por encima.', color: '#ff8a5c' },
  leaf: { title: 'Hojas gigantes', text: 'Rebotan mucho y desde ellas golpeas más fuerte. ¡Úsalas para saltar alto!', color: '#8ae05a' },
  totem: { title: 'Tótems', text: 'Los tótems te lanzan disparado, como un pinball. Aprovéchalos o esquívalos.', color: '#ffb060' },
  plant: { title: 'Plantas carnívoras', text: 'Si te acercas (mira el círculo rojo), se estiran y te comen la bola: +1 golpe. Pasa lejos, o rápido, antes de que te alcancen.', color: '#e0405a' },
  wind: { title: 'Brisa', text: 'El viento empuja la bola mientras vuela. Mira las flechas.', color: '#7fe3f5' },
} satisfies Record<string, Mechanic>;

const GROUND_ROWS = 3;

/**
 * Convierte el mapa de texto en la rejilla completa + lista de objetos.
 *
 * Dos tipos de hoyo:
 *  - cerrado (por defecto): se añaden paredes a los lados y suelo abajo (18 columnas interiores)
 *  - abierto (`open: true`): islas flotantes sin paredes ni suelo, de cualquier ancho.
 *    Si la bola cae por un borde, es "fuera de límites" (+1 golpe y vuelta al último sitio seguro).
 */
export function parseLevel(index: number): ParsedLevel {
  const meta = LEVELS[index];
  const open = !!meta.open;
  const lines = meta.map.replace(/^\r?\n/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  const inner = open ? Math.max(...lines.map((l) => l.length)) : COLS - 2;
  const cols = open ? inner : COLS;
  const grid: string[][] = [];
  const objects = {
    saws: [] as Saw[], bumpers: [] as Cell[], mushrooms: [] as Cell[], movers: [] as Span[], crumbles: [] as Span[], tides: [] as Span[],
  };
  let start: Cell | null = null;
  let hole: Cell | null = null;

  lines.forEach((raw, r) => {
    if (raw.length !== inner) console.warn(`[${meta.id}] fila ${r} tiene ${raw.length} columnas (deberían ser ${inner})`);
    const body = raw.padEnd(inner, '.').slice(0, inner);
    const row = (open ? body : '#' + body + '#').split('');
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      const cell = { c, r };
      if (ch === 'S') start = cell;
      else if (ch === 'H') hole = cell;
      else if (ch === 'X') objects.saws.push({ ...cell, range: 0 });
      else if (ch === 'Y') objects.saws.push({ ...cell, range: 30 });
      else if (ch === 'O') objects.bumpers.push(cell);
      else if (ch === 'M') objects.mushrooms.push(cell);
      if ('SH*XYOM'.includes(ch)) row[c] = '.';
    }
    // tramos de plataformas móviles y bloques frágiles
    for (const [ch, list] of [['P', objects.movers], ['C', objects.crumbles], ['T', objects.tides]] as const) {
      for (let c = 0; c < cols; c++) {
        if (row[c] !== ch) continue;
        let n = 0;
        while (row[c + n] === ch) n++;
        list.push({ c, r, n });
        for (let k = 0; k < n; k++) row[c + k] = '.';
        c += n - 1;
      }
    }
    grid.push(row);
  });
  if (!open) for (let i = 0; i < GROUND_ROWS; i++) grid.push('#'.repeat(COLS).split(''));

  // (TypeScript no ve las asignaciones dentro del forEach: se recuperan con un cast)
  const s = start as Cell | null;
  const h = hole as Cell | null;
  if (!s || !h) throw new Error(`[${meta.id}] falta la salida (S) o el hoyo (H)`);

  // El green: el césped que rodea el hoyo se pinta como césped fino (misma física que la hierba)
  {
    const r = h.r + 1;
    const c0 = open ? 0 : 1;
    const c1 = open ? cols - 1 : cols - 2;
    for (let c = h.c - 3; c <= h.c + 3; c++) if (grid[r]?.[c] === '#' && c >= c0 && c <= c1) grid[r][c] = 'G';
  }

  const groundRow = open ? s.r + 1 : grid.length - GROUND_ROWS;
  const floorY = (s.r + 1) * TILE;
  const windBands = (meta.windZones ?? []).map((z) => ({ y0: floorY - z.to * TILE, y1: floorY - z.from * TILE, wind: z.wind }));
  const fogBands = (meta.fogZones ?? []).map((z) => ({ y0: floorY - z.to * TILE, y1: floorY - z.from * TILE, density: z.density }));
  return { ...meta, index, open, grid, cols, rows: grid.length, groundRow, start: s, hole: h, ...objects, wind: meta.wind || 0, windBands, fogBands };
}

/** Densidad de niebla (0–1) a la altura `y` (píxeles del mundo) */
export function fogAt(L: Pick<ParsedLevel, 'fogBands'>, y: number): number {
  for (const b of L.fogBands) if (y >= b.y0 && y < b.y1) return b.density;
  return 0;
}

/** Viento (px/s²) que sopla a la altura `y` (píxeles del mundo) */
export function windAt(L: Pick<ParsedLevel, 'wind' | 'windBands'>, y: number): number {
  for (const b of L.windBands) if (y >= b.y0 && y < b.y1) return b.wind;
  return L.wind;
}
