import { UPGRADES, SKINS, ECONOMY, upgradeDef } from '../data/upgrades.js';

/**
 * Progreso local (localStorage): niveles, monedas, mejoras y bolas.
 * Cuando haya login con Supabase se puede sincronizar este mismo objeto con una tabla `progress`.
 */
const KEY = 'vertical-golf:progress:v1';
const fresh = () => ({ unlocked: 1, levels: {}, sound: true, coins: 0, upgrades: {}, skins: ['classic'], skin: 'classic' });

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw);
    const s = { ...fresh(), ...p, levels: { ...(p.levels || {}) }, upgrades: { ...(p.upgrades || {}) } };
    if (!Array.isArray(s.skins) || !s.skins.includes('classic')) s.skins = ['classic', ...(s.skins || [])];
    return s;
  } catch {
    return fresh();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* modo privado o almacenamiento bloqueado: seguimos sin guardar */
  }
}

export const progress = {
  get unlocked() {
    return state.unlocked;
  },
  level(i) {
    return state.levels[i] || null;
  },
  gemsFound(i) {
    return state.levels[i]?.gemsFound || [];
  },
  totalStars() {
    return Object.values(state.levels).reduce((s, l) => s + (l.stars || 0), 0);
  },
  totalGems() {
    return Object.values(state.levels).reduce((s, l) => s + (l.gemsFound?.length || 0), 0);
  },

  /** Guarda el resultado de un hoyo y devuelve las monedas ganadas (con desglose) */
  record(i, { strokes, stars, par, gemsTaken = [] }) {
    const prev = state.levels[i];
    const prevGems = new Set(prev?.gemsFound || []);
    const lines = [{ label: 'Hoyo completado', amount: ECONOMY.complete }];
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
    state.unlocked = Math.max(state.unlocked, i + 2);
    state.coins += coins;
    save();
    return { isBest: !!prev && strokes < prev.best, first: !prev, coins, lines };
  },

  // ---- monedas
  get coins() {
    return state.coins;
  },

  // ---- mejoras
  upgradeLevel(id) {
    return state.upgrades[id] || 0;
  },
  /** Valor actual de la mejora (p. ej. multiplicador de potencia) */
  stat(id) {
    const u = upgradeDef(id);
    return u.values[Math.min(this.upgradeLevel(id), u.values.length - 1)];
  },
  nextCost(id) {
    const u = upgradeDef(id);
    return u.costs[this.upgradeLevel(id)] ?? null;
  },
  buyUpgrade(id) {
    const cost = this.nextCost(id);
    if (cost == null || state.coins < cost) return false;
    state.coins -= cost;
    state.upgrades[id] = this.upgradeLevel(id) + 1;
    save();
    return true;
  },
  upgradesBought() {
    return UPGRADES.reduce((s, u) => s + this.upgradeLevel(u.id), 0);
  },

  // ---- bolas
  get skin() {
    return SKINS.some((s) => s.id === state.skin) ? state.skin : 'classic';
  },
  ownsSkin(id) {
    return state.skins.includes(id);
  },
  buySkin(id) {
    const s = SKINS.find((k) => k.id === id);
    if (!s || this.ownsSkin(id) || state.coins < s.cost) return false;
    state.coins -= s.cost;
    state.skins.push(id);
    state.skin = id;
    save();
    return true;
  },
  equipSkin(id) {
    if (!this.ownsSkin(id)) return false;
    state.skin = id;
    save();
    return true;
  },

  get sound() {
    return state.sound;
  },
  set sound(v) {
    state.sound = v;
    save();
  },
};
