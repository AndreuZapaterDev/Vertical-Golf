import { UPGRADES, SKINS, ECONOMY, upgradeDef, type UpgradeId } from '../data/upgrades';
import { TRAILS, DEFAULT_TRAIL, AURAS, DEFAULT_AURA, BALL_TYPES, DEFAULT_BALL, PRIZES, RARITIES, GACHA, type Prize, type PrizeKind, type Rarity } from '../data/cosmetics';
import { LEVELS } from '../data/levels';
import { WORLDS } from '../data/worlds';

const LEVEL_IDS = new Set(LEVELS.map((l) => l.id));
const devGachaPulls = new Set<string>();
/** Nivel activo de cada mejora en modo DEV (por defecto, el máximo). No toca el guardado real */
const devActive: Partial<Record<UpgradeId, number>> = {};
const BALL_ID_MIGRATIONS: Record<string, string> = {
  big: 'heavy',
  cork: 'feather',
  gum: 'bouncy',
  disk: 'slick',
};

function migratedBallId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const nextId = BALL_ID_MIGRATIONS[id] ?? id;
  return BALL_TYPES.some((ball) => ball.id === nextId) ? nextId : null;
}

/** Estilos de imagen del juego (filtro de color sobre la cámara): ver LOOKS en ui/looks.ts */
export type LookId = 'normal' | 'vivid' | 'soft' | 'cine';
export const LOOK_IDS: LookId[] = ['normal', 'vivid', 'soft', 'cine'];

export interface Settings {
  /** volumen 0–1 */
  music: number;
  sfx: number;
  vibration: boolean;
  shake: boolean;
  /** estilo de imagen */
  look: LookId;
}

export interface LevelResult {
  best: number;
  stars: number;
}

interface SaveState {
  levels: Record<string, LevelResult>;
  coins: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  /** nivel elegido para usar cada mejora; 0 significa desactivada */
  activeUpgradeLevels: Partial<Record<UpgradeId, number>>;
  /** fichas para el gachapón */
  tokens: number;
  trails: string[];
  trail: string;
  /** auras (la luz de la bola) */
  auras: string[];
  aura: string;
  skins: string[];
  skin: string;
  /** tipos de pelota (física) */
  balls: string[];
  ball: string;
  settings: Settings;
}

export interface CoinLine {
  label: string;
  amount: number;
}

/**
 * Progreso local (localStorage): niveles, monedas, mejoras, pelotas, skins, rastros y ajustes.
 * Cuando haya login con Supabase se puede sincronizar este mismo objeto con una tabla `progress`.
 *
 * El guardado se valida al cargar (valores corruptos → valores por defecto) y se escribe
 * con una copia de seguridad para no perder el progreso si una escritura se corta a medias.
 */
const KEY = 'vertical-golf:progress:v1';
const BACKUP = `${KEY}:backup`;

const DEFAULT_SETTINGS: Settings = { music: 0.6, sfx: 1, vibration: true, shake: true, look: 'normal' };

const fresh = (): SaveState => ({
  levels: {}, coins: 0, upgrades: {}, activeUpgradeLevels: {}, tokens: 0, trails: [DEFAULT_TRAIL], trail: DEFAULT_TRAIL, auras: [DEFAULT_AURA], aura: DEFAULT_AURA, skins: ['classic'], skin: 'classic', balls: [DEFAULT_BALL], ball: DEFAULT_BALL, settings: { ...DEFAULT_SETTINGS },
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
      // (las gemas de versiones anteriores se descartan)
      s.levels[k] = { best: Math.max(1, l.best), stars: Math.round(num(l.stars, 1, 0, 3)) };
    }
  }
  if (p.upgrades && typeof p.upgrades === 'object') {
    for (const u of UPGRADES) {
      const lv = p.upgrades[u.id];
      if (Number.isInteger(lv)) s.upgrades[u.id] = Math.min(Math.max(0, lv), u.values.length - 1);
    }
  }
  const legacyDisabled = Array.isArray(p.disabled) ? p.disabled : [];
  const activeLevels = p.activeUpgradeLevels && typeof p.activeUpgradeLevels === 'object' ? p.activeUpgradeLevels : {};
  for (const u of UPGRADES) {
    const purchased = s.upgrades[u.id] ?? 0;
    const savedLevel = activeLevels[u.id];
    const defaultLevel = legacyDisabled.includes(u.id) ? 0 : purchased;
    s.activeUpgradeLevels[u.id] = Number.isInteger(savedLevel)
      ? Math.min(purchased, Math.max(0, savedLevel))
      : defaultLevel;
  }
  s.tokens = Math.round(num(p.tokens, 0, 0));
  if (Array.isArray(p.trails)) s.trails = [...new Set<string>([DEFAULT_TRAIL, ...p.trails.filter((id: unknown) => TRAILS.some((t) => t.id === id))])];
  if (s.trails.includes(p.trail)) s.trail = p.trail;
  if (Array.isArray(p.auras)) s.auras = [...new Set<string>([DEFAULT_AURA, ...p.auras.filter((id: unknown) => AURAS.some((a) => a.id === id))])];
  if (s.auras.includes(p.aura)) s.aura = p.aura;
  if (Array.isArray(p.skins)) s.skins = [...new Set<string>(['classic', ...p.skins.filter((id: unknown) => SKINS.some((k) => k.id === id))])];
  if (s.skins.includes(p.skin)) s.skin = p.skin;
  if (Array.isArray(p.balls)) {
    const savedBalls: unknown[] = p.balls;
    const balls = savedBalls.map(migratedBallId).filter((id): id is string => id !== null);
    s.balls = [...new Set<string>([DEFAULT_BALL, ...balls])];
  }
  const equippedBall = migratedBallId(p.ball);
  if (equippedBall && s.balls.includes(equippedBall)) s.ball = equippedBall;

  // Ajustes (migración: la versión anterior solo tenía `sound: true/false`)
  const st = p.settings && typeof p.settings === 'object' ? p.settings : {};
  const legacyOff = p.sound === false;
  s.settings = {
    music: num(st.music, legacyOff ? 0 : DEFAULT_SETTINGS.music, 0, 1),
    sfx: num(st.sfx, legacyOff ? 0 : DEFAULT_SETTINGS.sfx, 0, 1),
    vibration: bool(st.vibration, DEFAULT_SETTINGS.vibration),
    shake: bool(st.shake, DEFAULT_SETTINGS.shake),
    look: LOOK_IDS.includes(st.look) ? st.look : DEFAULT_SETTINGS.look,
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

/** Lista guardada de lo conseguido de cada categoría */
const ownedList = (kind: PrizeKind): string[] => (kind === 'skin' ? state.skins : kind === 'ball' ? state.balls : kind === 'aura' ? state.auras : state.trails);

type SettingsListener = <K extends keyof Settings>(key: K, value: Settings[K]) => void;
const listeners = new Set<SettingsListener>();

export const progress = {
  // ---- modo DEV
  get devMode() {
    return dev;
  },
  setDevMode(on: boolean) {
    const enabled = !!on;
    if (enabled !== dev) {
      devGachaPulls.clear();
      for (const k of Object.keys(devActive) as UpgradeId[]) delete devActive[k];
    }
    dev = enabled;
    try {
      if (dev) localStorage.setItem(DEV_KEY, '1');
      else localStorage.removeItem(DEV_KEY);
    } catch {
      /* sin almacenamiento */
    }
  },

  /**
   * Borra todo el progreso (hoyos, monedas, mejoras, bolas, skins, rastros y fichas) y empieza de cero.
   * Se conservan los ajustes (música, efectos, vibración, temblor) y el modo DEV. Se borra también la copia de seguridad,
   * para que el progreso antiguo no se pueda recuperar por error.
   */
  resetAll() {
    const keep = { ...state.settings };
    state = fresh();
    state.settings = keep;
    devGachaPulls.clear();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.removeItem(BACKUP);
    } catch {
      /* sin almacenamiento: el reinicio vale solo para esta sesión */
    }
  },

  /** Resultado guardado de un hoyo (por id, p. ej. 'meadow-3') o null */
  level(id: string): LevelResult | null {
    return state.levels[id] || null;
  },
  totalStars() {
    return Object.values(state.levels).reduce((s, l) => s + (l.stars || 0), 0);
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
  record(i: string, { strokes, stars, par }: { strokes: number; stars: number; par: number }) {
    const prev = state.levels[i];
    // monedas (para las mejoras)
    // Cada estrella paga una sola vez, por escalones (5 + 5 + 10 = 20 con 3 estrellas): solo se cobra lo nuevo, así que repetirlo no da más
    const lines: CoinLine[] = [];
    const starNames = ['Hoyo completado', 'Segunda estrella', 'Tercera estrella'];
    for (let s = prev ? prev.stars : 0; s < stars; s++) lines.push({ label: starNames[s], amount: ECONOMY.starCoins[s] });
    if (strokes === 1 && ECONOMY.holeInOne > 0) lines.push({ label: 'Hoyo en uno', amount: ECONOMY.holeInOne });
    else if (strokes < par && ECONOMY.underPar > 0) lines.push({ label: 'Bajo par', amount: ECONOMY.underPar });
    const coins = lines.reduce((s, l) => s + l.amount, 0);
    // fichas (para el gachapón): una por terminar y otra más con 3 estrellas, cada vez
    const tokens = ECONOMY.tokens + (stars === 3 ? ECONOMY.tokens3Stars : 0);
    state.tokens += tokens;

    state.levels[i] = {
      best: prev ? Math.min(prev.best, strokes) : strokes,
      stars: Math.max(prev?.stars || 0, stars),
    };
    state.coins += coins;
    save();
    return { isBest: !!prev && strokes < prev.best, first: !prev, coins, lines, tokens };
  },

  // ---- monedas y fichas
  get coins() {
    return dev ? DEV_COINS : state.coins;
  },
  get tokens() {
    return dev ? DEV_COINS : state.tokens;
  },

  // ---- mejoras
  upgradeLevel(id: UpgradeId): number {
    if (dev) return upgradeDef(id).values.length - 1; // modo DEV: todas las mejoras al máximo
    return state.upgrades[id] || 0;
  },
  /** Nivel de mejora elegido para usar; 0 significa que está desactivada. */
  upgradeActiveLevel(id: UpgradeId): number {
    if (dev) return devActive[id] ?? this.upgradeLevel(id);
    return state.activeUpgradeLevels[id] ?? 0;
  },
  /** Valor actual de la mejora (p. ej. multiplicador de potencia). */
  stat(id: UpgradeId): number {
    const u = upgradeDef(id);
    return u.values[Math.min(this.upgradeActiveLevel(id), this.upgradeLevel(id), u.values.length - 1)];
  },
  /** ¿Está activa? */
  isUpgradeOn(id: UpgradeId): boolean {
    return this.upgradeActiveLevel(id) > 0;
  },
  /** Elige el nivel comprado que se usará (0 la desactiva). */
  setUpgradeActiveLevel(id: UpgradeId, level: number): boolean {
    if (!Number.isInteger(level) || level < 0 || level > this.upgradeLevel(id)) return false;
    if (this.upgradeActiveLevel(id) === level) return true;
    if (dev) {
      devActive[id] = level; // en modo DEV se puede cambiar el nivel activo sin tocar el guardado real
      return true;
    }
    state.activeUpgradeLevels[id] = level;
    save();
    return true;
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
    state.activeUpgradeLevels[id] = this.upgradeLevel(id); // al mejorarla, se activa el nuevo nivel
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
  equipSkin(id: string): boolean {
    if (!this.ownsSkin(id)) return false;
    state.skin = id;
    save();
    return true;
  },

  // ---- tipos de pelota
  get ball(): string {
    return this.ownsBall(state.ball) ? state.ball : DEFAULT_BALL;
  },
  ownsBall(id: string): boolean {
    return dev || state.balls.includes(id);
  },
  equipBall(id: string): boolean {
    if (!this.ownsBall(id)) return false;
    state.ball = id;
    save();
    return true;
  },

  /** Tienes este premio? / equípalo (sea del tipo que sea) */
  owns(kind: PrizeKind, id: string): boolean {
    return kind === 'skin' ? this.ownsSkin(id) : kind === 'ball' ? this.ownsBall(id) : kind === 'aura' ? this.ownsAura(id) : this.ownsTrail(id);
  },
  equip(kind: PrizeKind, id: string): boolean {
    return kind === 'skin' ? this.equipSkin(id) : kind === 'ball' ? this.equipBall(id) : kind === 'aura' ? this.equipAura(id) : this.equipTrail(id);
  },

  // ---- auras
  get aura(): string {
    return this.ownsAura(state.aura) ? state.aura : DEFAULT_AURA;
  },
  ownsAura(id: string): boolean {
    return dev || state.auras.includes(id);
  },
  equipAura(id: string): boolean {
    if (!this.ownsAura(id)) return false;
    state.aura = id;
    save();
    return true;
  },

  // ---- rastros
  get trail(): string {
    return this.ownsTrail(state.trail) ? state.trail : DEFAULT_TRAIL;
  },
  ownsTrail(id: string): boolean {
    return dev || state.trails.includes(id);
  },
  equipTrail(id: string): boolean {
    if (!this.ownsTrail(id)) return false;
    state.trail = id;
    save();
    return true;
  },

  // ---- gachapón
  /**
   * Premios que aún no tienes: solo estos pueden salir (nunca hay repetidos).
   * En modo DEV se mira el progreso real, para poder probar las tiradas.
   */
  remainingPrizes(): Prize[] {
    return PRIZES.filter((p) =>
      !ownedList(p.kind).includes(p.id) && !(dev && devGachaPulls.has(`${p.kind}:${p.id}`)),
    );
  },
  /** ¿Ha salido este premio del gachapón? Independiente de los desbloqueos gratis de DEV. */
  hasGachaPrize(kind: PrizeKind, id: string): boolean {
    return !this.remainingPrizes().some((p) => p.kind === kind && p.id === id);
  },
  /**
   * Probabilidad actual de cada rareza (0–1) y cuántos premios le quedan.
   * Cada premio restante tiene la misma probabilidad; la rareza depende de su proporción del bombo.
   */
  odds(): Record<Rarity, { chance: number; left: number; total: number }> {
    const left = this.remainingPrizes();
    const keys = Object.keys(RARITIES) as Rarity[];
    const count = (r: Rarity, list: Prize[]) => list.filter((p) => p.rarity === r).length;
    const leftByRarity = keys.map((r) => count(r, left));
    const totalByRarity = keys.map((r) => count(r, PRIZES));
    const out = {} as Record<Rarity, { chance: number; left: number; total: number }>;
    for (const [i, r] of keys.entries()) {
      out[r] = {
        chance: left.length ? leftByRarity[i] / left.length : 0,
        left: leftByRarity[i],
        total: totalByRarity[i],
      };
    }
    return out;
  },
  /** Progreso del bombo, excluyendo desbloqueos gratis del modo DEV. */
  gachaCollected(): { have: number; total: number } {
    const total = PRIZES.length;
    return { have: total - this.remainingPrizes().length, total };
  },
  /** ¿Ya salió todo lo del gachapón? */
  gachaComplete(): boolean {
    return this.remainingPrizes().length === 0;
  },
  canPull(): boolean {
    return this.tokens >= GACHA.cost && !this.gachaComplete();
  },
  /**
   * Tira del gachapón: gasta fichas, sortea la rareza con las probabilidades actuales y luego
   * uno de los premios que te faltan de esa rareza. Devuelve null si no se puede tirar.
   */
  pull(): Prize | null {
    if (!this.canPull()) return null;
    const odds = this.odds();
    const rarities = (Object.keys(odds) as Rarity[]).filter((r) => odds[r].left > 0);
    let roll = Math.random();
    let rarity = rarities[rarities.length - 1];
    for (const r of rarities) {
      roll -= odds[r].chance;
      if (roll < 0) {
        rarity = r;
        break;
      }
    }
    const pool = this.remainingPrizes().filter((p) => p.rarity === rarity);
    const prize = pool[Math.floor(Math.random() * pool.length)];
    // En modo DEV se simula la colección de la sesión, sin gastar ni guardar progreso.
    if (dev) {
      devGachaPulls.add(`${prize.kind}:${prize.id}`);
      return prize;
    }
    state.tokens -= GACHA.cost;
    ownedList(prize.kind).push(prize.id);
    save();
    return prize;
  },
  /** Cuántos premios del gachapón tienes ya (para el contador de la colección) */
  collected(): { have: number; total: number } {
    const have = PRIZES.filter((p) => this.owns(p.kind, p.id)).length;
    return { have, total: PRIZES.length };
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
