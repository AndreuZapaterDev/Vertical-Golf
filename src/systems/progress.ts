import { UPGRADES, SKINS, ECONOMY, upgradeDef, type UpgradeId } from '../data/upgrades';
import { LEVELS } from '../data/levels';
import { WORLDS } from '../data/worlds';

const LEVEL_IDS = new Set(LEVELS.map((l) => l.id));

export interface Settings {
  /** volumen 0–1 */
  music: number;
  sfx: number;
  vibration: boolean;
  shake: boolean;
}

export interface LevelResult {
  best: number;
  stars: number;
  gems: number;
  /** índices de las gemas recogidas alguna vez */
  gemsFound: number[];
}

interface SaveState {
  levels: Record<string, LevelResult>;
  coins: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  skins: string[];
  skin: string;
  settings: Settings;
}

export interface CoinLine {
  label: string;
  amount: number;
}

/**
 * Progreso local (localStorage): niveles, monedas, mejoras, bolas y ajustes.
 * Cuando haya login con Supabase se puede sincronizar este mismo objeto con una tabla `progress`.
 *
 * El guardado se valida al cargar (valores corruptos → valores por defecto) y se escribe
 * con una copia de seguridad para no perder el progreso si una escritura se corta a medias.
 */
const KEY = 'vertical-golf:progress:v1';
const BACKUP = `${KEY}:backup`;

const DEFAULT_SETTINGS: Settings = { music: 0.6, sfx: 1, vibration: true, shake: true };

const fresh = (): SaveState => ({
  levels: {}, coins: 0, upgrades: {}, skins: ['classic'], skin: 'classic', settings: { ...DEFAULT_SETTINGS },
});

const num = (v: unknown, def: number, min = 0, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/**
 * Convierte cualquier cosa leída del almacenamiento en un estado válido.
 * `p` viene de JSON.parse (puede ser cualquier cosa): se valida campo a campo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitize(p: any): SaveState {
  const s = fresh();
  if (!p || typeof p !== 'object') return s;
  s.coins = Math.round(num(p.coins, 0, 0));
  if (p.levels && typeof p.levels === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [k, l] of Object.entries(p.levels as Record<string, any>)) {
      // solo hoyos que existen (los niveles antiguos, guardados por número, se descartan)
      if (!LEVEL_IDS.has(k) || !l || typeof l !== 'object' || !Number.isFinite(l.best)) continue;
      const gemsFound: number[] = Array.isArray(l.gemsFound) ? [...new Set<number>(l.gemsFound.filter(Number.isInteger))] : [];
      s.levels[k] = { best: Math.max(1, l.best), stars: Math.round(num(l.stars, 1, 0, 3)), gems: gemsFound.length, gemsFound };
    }
  }
  if (p.upgrades && typeof p.upgrades === 'object') {
    for (const u of UPGRADES) {
      const lv = p.upgrades[u.id];
      if (Number.isInteger(lv)) s.upgrades[u.id] = Math.min(Math.max(0, lv), u.values.length - 1);
    }
  }
  if (Array.isArray(p.skins)) s.skins = [...new Set<string>(['classic', ...p.skins.filter((id: unknown) => SKINS.some((k) => k.id === id))])];
  if (s.skins.includes(p.skin)) s.skin = p.skin;

  // Ajustes (migración: la versión anterior solo tenía `sound: true/false`)
  const st = p.settings && typeof p.settings === 'object' ? p.settings : {};
  const legacyOff = p.sound === false;
  s.settings = {
    music: num(st.music, legacyOff ? 0 : DEFAULT_SETTINGS.music, 0, 1),
    sfx: num(st.sfx, legacyOff ? 0 : DEFAULT_SETTINGS.sfx, 0, 1),
    vibration: bool(st.vibration, DEFAULT_SETTINGS.vibration),
    shake: bool(st.shake, DEFAULT_SETTINGS.shake),
  };
  return s;
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function load(): SaveState {
  const main = read(KEY);
  if (main) return sanitize(main);
  const backup = read(BACKUP); // la principal falta o está corrupta
  return sanitize(backup);
}

let state = load();

// Modo DEV: todo desbloqueado. Se guarda aparte y no modifica el progreso real.
const DEV_KEY = 'vertical-golf:dev';
const DEV_COINS = 99999;
let dev = false;
try {
  dev = localStorage.getItem(DEV_KEY) === '1';
} catch {
  /* sin almacenamiento */
}

function save() {
  try {
    const json = JSON.stringify(state);
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP, prev);
    localStorage.setItem(KEY, json);
  } catch {
    /* modo privado o almacenamiento bloqueado: seguimos sin guardar */
  }
}

type SettingsListener = <K extends keyof Settings>(key: K, value: Settings[K]) => void;
const listeners = new Set<SettingsListener>();

export const progress = {
  // ---- modo DEV
  get devMode() {
    return dev;
  },
  setDevMode(on: boolean) {
    dev = !!on;
    try {
      if (dev) localStorage.setItem(DEV_KEY, '1');
      else localStorage.removeItem(DEV_KEY);
    } catch {
      /* sin almacenamiento */
    }
  },

  /** Resultado guardado de un hoyo (por id, p. ej. 'meadow-3') o null */
  level(id: string): LevelResult | null {
    return state.levels[id] || null;
  },
  gemsFound(id: string): number[] {
    return state.levels[id]?.gemsFound || [];
  },
  totalStars() {
    return Object.values(state.levels).reduce((s, l) => s + (l.stars || 0), 0);
  },
  totalGems() {
    return Object.values(state.levels).reduce((s, l) => s + (l.gemsFound?.length || 0), 0);
  },
  worldStars(worldId: string) {
    return LEVELS.filter((l) => l.world === worldId).reduce((s, l) => s + (state.levels[l.id]?.stars || 0), 0);
  },
  worldCompleted(worldId: string): number {
    return LEVELS.filter((l) => l.world === worldId).filter((l) => state.levels[l.id]).length;
  },

  /** Un mundo está abierto si es el primero o si se completaron todos los hoyos del anterior */
  isWorldUnlocked(worldIndex: number): boolean {
    const w = WORLDS[worldIndex];
    if (!w || w.comingSoon || !w.levels.length) return false;
    if (worldIndex === 0 || dev) return true;
    const prev = WORLDS[worldIndex - 1];
    return this.worldCompleted(prev.id) >= prev.levels.length;
  },

  /** Un hoyo está abierto si su mundo lo está y es el primero o ya completaste el anterior */
  isLevelUnlocked(index: number): boolean {
    const l = LEVELS[index];
    if (!l || !this.isWorldUnlocked(l.worldIndex)) return false;
    return dev || l.number === 1 || !!state.levels[LEVELS[index - 1]?.id];
  },

  /** El hoyo con el que seguir jugando: el primero abierto sin completar (o el último abierto) */
  nextLevelIndex(): number {
    let last = 0;
    for (let i = 0; i < LEVELS.length; i++) {
      if (!this.isLevelUnlocked(i)) continue;
      if (!state.levels[LEVELS[i].id]) return i;
      last = i;
    }
    return last;
  },

  /** Guarda el resultado de un hoyo y devuelve las monedas ganadas (con desglose) */
  record(i: string, { strokes, stars, par, gemsTaken = [] }: { strokes: number; stars: number; par: number; gemsTaken?: number[] }) {
    const prev = state.levels[i];
    const prevGems = new Set(prev?.gemsFound || []);
    const lines: CoinLine[] = [{ label: 'Hoyo completado', amount: ECONOMY.complete }];
    const newStars = Math.max(0, stars - (prev?.stars || 0));
    if (newStars) lines.push({ label: `Estrellas nuevas ×${newStars}`, amount: newStars * ECONOMY.star });
    const newGems = gemsTaken.filter((g) => !prevGems.has(g));
    if (newGems.length) lines.push({ label: `Gemas nuevas ×${newGems.length}`, amount: newGems.length * ECONOMY.gem });
    if (strokes === 1) lines.push({ label: 'Hoyo en uno', amount: ECONOMY.holeInOne });
    else if (strokes < par) lines.push({ label: 'Bajo par', amount: ECONOMY.underPar });
    const coins = lines.reduce((s, l) => s + l.amount, 0);

    const gemsFound = [...new Set([...prevGems, ...gemsTaken])];
    state.levels[i] = {
      best: prev ? Math.min(prev.best, strokes) : strokes,
      stars: Math.max(prev?.stars || 0, stars),
      gems: gemsFound.length,
      gemsFound,
    };
    state.coins += coins;
    save();
    return { isBest: !!prev && strokes < prev.best, first: !prev, coins, lines };
  },

  // ---- monedas
  get coins() {
    return dev ? DEV_COINS : state.coins;
  },

  // ---- mejoras
  upgradeLevel(id: UpgradeId): number {
    return state.upgrades[id] || 0;
  },
  /** Valor actual de la mejora (p. ej. multiplicador de potencia) */
  stat(id: UpgradeId): number {
    const u = upgradeDef(id);
    return u.values[Math.min(this.upgradeLevel(id), u.values.length - 1)];
  },
  nextCost(id: UpgradeId): number | null {
    const u = upgradeDef(id);
    return u.costs[this.upgradeLevel(id)] ?? null;
  },
  buyUpgrade(id: UpgradeId): boolean {
    const cost = this.nextCost(id);
    if (cost == null || this.coins < cost) return false;
    if (!dev) state.coins -= cost;
    state.upgrades[id] = this.upgradeLevel(id) + 1;
    save();
    return true;
  },
  upgradesBought() {
    return UPGRADES.reduce((s, u) => s + this.upgradeLevel(u.id), 0);
  },

  // ---- bolas
  get skin(): string {
    return SKINS.some((s) => s.id === state.skin) && this.ownsSkin(state.skin) ? state.skin : 'classic';
  },
  ownsSkin(id: string): boolean {
    return dev || state.skins.includes(id);
  },
  buySkin(id: string): boolean {
    const s = SKINS.find((k) => k.id === id);
    if (!s || this.ownsSkin(id) || this.coins < s.cost) return false;
    if (!dev) state.coins -= s.cost;
    state.skins.push(id);
    state.skin = id;
    save();
    return true;
  },
  equipSkin(id: string): boolean {
    if (!this.ownsSkin(id)) return false;
    state.skin = id;
    save();
    return true;
  },

  // ---- ajustes
  get settings(): Readonly<Settings> {
    return state.settings;
  },
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (!(key in DEFAULT_SETTINGS)) return;
    state.settings[key] = value;
    save();
    for (const fn of listeners) fn(key, value);
  },
  /** Avisa cuando cambia un ajuste (el audio lo usa para aplicar el volumen al momento) */
  onSettingsChange(fn: SettingsListener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
