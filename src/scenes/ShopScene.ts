import Phaser from 'phaser';
import { W, H, PAL, BALL_R } from '../constants';
import { Background } from '../gfx/background';
import { UPGRADES, SKINS } from '../data/upgrades';
import { TRAILS, BALL_TYPES, RARITIES, RARITY_ORDER, PRIZES, GACHA, KIND_NAMES, trailById, ballTypeById, type Rarity, type Trail, type Prize, type PrizeKind, type BallType } from '../data/cosmetics';
import { hex } from '../constants';
import { progress } from '../systems/progress';
import { sfx } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, makeButton, iconButton, panel } from '../ui/widgets';
import { transitionTo } from './TransitionScene';

const CREAM = '#f0dcc0';
const GACHA_MACHINE_Y = 176;

/** Tamaño relativo de un tipo de pelota respecto a la normal */
const ballScale = (b: BallType) => (b.radius ?? BALL_R) / BALL_R;

/** Cápsula dentro de la bola del gachapón (posición polar para el remolino) */
interface Capsule {
  c: Phaser.GameObjects.Container;
  a: number;
  r: number;
  ang: number;
  rarity: Rarity;
}

interface TrailPreview {
  graphics: Phaser.GameObjects.Graphics;
  trail: Trail;
  x: number;
  y: number;
  len: number;
}

/** Porcentaje con precisión suficiente para que se note cómo cambia tras cada premio */
function percentage(chance: number): string {
  const value = chance * 100;
  if (value > 0 && value < 0.1) return '<0.1';
  return String(Number(value.toFixed(1)));
}

/** Tienda: mejoras, gachapón, catálogo y equipamiento */
type Tab = 'upgrades' | 'gacha' | 'collection' | 'equipment';

export default class ShopScene extends Phaser.Scene {
  back = 'Menu';
  tab: Tab = 'upgrades';
  /** sub-pestaña de la colección */
  colTab: PrizeKind = 'ball';
  colPage = 0;
  /** categoría del equipamiento */
  equipKind: PrizeKind = 'ball';
  equipPage = 0;
  bg!: Background;
  coinText!: Phaser.GameObjects.Text;
  walletIcon!: Phaser.GameObjects.Image;
  tabs!: Record<Tab, Phaser.GameObjects.Container>;
  content!: Phaser.GameObjects.Container;
  sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  trailPreviews: TrailPreview[] = [];
  /** animación del gachapón en curso */
  busy = false;

  constructor() {
    super('Shop');
  }

  init(data?: { back?: string; tab?: Tab }) {
    this.back = data?.back || 'Menu';
    this.tab = data?.tab || 'upgrades';
    this.colTab = 'ball';
    this.colPage = 0;
    this.equipKind = 'ball';
    this.equipPage = 0;
  }

  create() {
    fitCamera(this);
    this.bg = new Background(this, 'sunset');

    panel(this, W / 2, 22, 112, 24, 'hud9');
    label(this, W / 2, 22, 'TIENDA', 20, { color: PAL.sand, strokeThickness: 4 });
    iconButton(this, 16, 22, 'back', () => {
      if (!this.busy) transitionTo(this, () => this.scene.start(this.back));
    });

    // cartera: monedas en Habilidades, fichas en Gachapón y Colección
    panel(this, W - 34, 22, 56, 20, 'hud9');
    this.walletIcon = this.add.image(W - 54, 22, 'coin');
    this.coinText = label(this, W - 45, 22, String(progress.coins), 11, { ox: 0, color: PAL.sand });

    // pestañas
    panel(this, W / 2, 50, 234, 28, 'hud9').setAlpha(0.82);
    const tab = (x: number, t: Tab, text: string, color: string) =>
      makeButton(this, x, 50, { color, w: 54, h: 22, text, size: 7, onClick: () => !this.busy && this.show(t) });
    this.tabs = {
      upgrades: tab(W / 2 - 87, 'upgrades', 'Mejoras', 'gold'),
      gacha: tab(W / 2 - 29, 'gacha', 'Gachapón', 'purple'),
      collection: tab(W / 2 + 29, 'collection', 'Colección', 'blue'),
      equipment: tab(W / 2 + 87, 'equipment', 'Equipar', 'green'),
    };
    this.busy = false;

    this.content = this.add.container(0, 0);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(50);
    this.show(this.tab);
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const [k, b] of Object.entries(this.tabs)) {
      const selected = k === tab;
      b.setAlpha(selected ? 1 : 0.7).setScale(selected ? 1.04 : 1);
    }
    this.trailPreviews = [];
    this.content.removeAll(true);
    this.content.setX(0);
    this.updateWallet();
    if (tab === 'upgrades') this.buildUpgrades();
    else if (tab === 'gacha') this.buildGacha();
    else if (tab === 'collection') this.buildCollection();
    else this.buildEquipment();
  }

  flash(x: number, y: number) {
    this.sparks.explode(12, x, y);
    this.tweens.add({ targets: this.coinText, scale: { from: 1.4, to: 1 }, duration: 250, ease: 'Back.easeOut' });
  }

  addPageControls(page: number, pageCount: number, y: number, onPage: (page: number) => void) {
    if (pageCount <= 1) return;
    this.content.add(makeButton(this, W / 2 - 32, y, {
      color: page > 0 ? 'blue' : 'gray', w: 26, h: 16, text: '<', size: 10,
      onClick: () => page > 0 && onPage(page - 1),
    }));
    this.content.add(label(this, W / 2, y, `${page + 1} / ${pageCount}`, 8, { color: CREAM }));
    this.content.add(makeButton(this, W / 2 + 32, y, {
      color: page < pageCount - 1 ? 'blue' : 'gray', w: 26, h: 16, text: '>', size: 10,
      onClick: () => page < pageCount - 1 && onPage(page + 1),
    }));
  }

  buildUpgrades() {
    const top = 72;
    const rowH = 48;
    this.content.add(panel(this, W / 2, 218, 228, 306, 'panel9'));
    UPGRADES.forEach((u, i) => {
      const y = top + 22 + i * rowH;
      const lvl = progress.upgradeLevel(u.id);
      const max = u.costs.length;
      const cost = progress.nextCost(u.id);
      const afford = cost != null && progress.coins >= cost;

      const activeLevel = progress.upgradeActiveLevel(u.id);
      const on = activeLevel > 0;
      const active = lvl > 0 && on;
      const card = this.add.container(W / 2, y);
      card.add(panel(this, 0, 0, 228, 44, 'hud9'));
      card.add(this.add.image(-98, -2, u.icon).setScale(lvl ? 1.5 : 1.3).setAlpha(active ? 1 : 0.5));
      card.add(label(this, -82, -12, u.name, 11, { ox: 0, color: active ? PAL.sand : lvl ? '#c8bfb4' : '#ffffff' }));
      card.add(label(this, -82, 1, u.desc, 7, { ox: 0, color: CREAM, strokeThickness: 2 }));
      // pips de nivel
      for (let k = 0; k < max; k++) {
        const g = this.add.graphics();
        const px = -82 + k * 10;
        g.fillStyle(0x35282c).fillRect(px, 10, 8, 6);
        g.fillStyle(k < lvl ? 0xb8ec6a : 0x6e5458).fillRect(px + 1, 11, 6, 4);
        card.add(g);
      }
      card.add(label(this, -82 + max * 10 + 3, 13, on ? u.fmt(u.values[activeLevel]) : 'Apagada', 7, { ox: 0, color: on ? '#ffffff' : '#c8bfb4', strokeThickness: 2 }));

      // selector del nivel activo (0 apaga la mejora)
      if (lvl > 0) {
        card.add(label(this, 0, 12, 'NIV', 5, { color: CREAM, strokeThickness: 1 }));
        for (let level = 0; level <= lvl; level++) {
          card.add(makeButton(this, 13 + level * 11, 12, {
            color: activeLevel === level ? (level === 0 ? 'orange' : 'green') : 'gray',
            w: 10, h: 14, text: String(level), size: 7,
            onClick: () => {
              progress.setUpgradeActiveLevel(u.id, level);
              sfx.click();
              this.show('upgrades');
            },
          }));
        }
      }

      if (cost == null) {
        card.add(label(this, 84, 0, 'MÁX', 12, { color: PAL.grassL }));
      } else {
        const btn = makeButton(this, 84, 0, {
          color: afford ? 'green' : 'gray',
          w: 52,
          h: 26,
          text: `${cost}`,
          size: 11,
          onClick: () => {
            if (progress.buyUpgrade(u.id)) {
              sfx.buy();
              this.show('upgrades');
              this.flash(W / 2 - 98, y);
            } else {
              sfx.denied();
              this.tweens.add({ targets: card, x: W / 2 + 3, duration: 40, yoyo: true, repeat: 2 });
            }
          },
        });
        btn.add(this.add.image(-16, -2, 'coin'));
        (btn.list[1] as Phaser.GameObjects.Text).x = 5;
        card.add(btn);
      }
      card.setAlpha(0).setX(W / 2 + 12);
      this.tweens.add({ targets: card, alpha: 1, x: W / 2, duration: 220, delay: i * 35 });
      this.content.add(card);
    });
  }

  // ---------------------------------------------------------------- Colección

  /**
   * Catálogo completo de pelotas, skins y rastros, incluidos los que faltan por conseguir.
   */
  buildCollection() {
    const { have, total } = progress.collected();
    const itemCount = this.colTab === 'ball' ? BALL_TYPES.length : this.colTab === 'skin' ? SKINS.length : TRAILS.length;
    const pageSize = 25;
    const pageCount = Math.ceil(itemCount / pageSize);
    this.colPage = Math.min(this.colPage, pageCount - 1);
    const pageStart = this.colPage * pageSize;
    const visibleCount = Math.min(pageSize, itemCount - pageStart);
    const rows = Math.ceil(visibleCount / 5);
    const lastRowY = 136 + (rows - 1) * 46;
    const pageControlsY = lastRowY + 38;
    const panelTop = 110;
    const panelBottom = pageCount > 1 ? pageControlsY + 21 : lastRowY + 29;
    this.content.add(panel(this, W / 2, (panelTop + panelBottom) / 2, 224, panelBottom - panelTop, 'hud9'));
    this.content.add(label(this, W / 2, 72, `Colección ${have}/${total}`, 10, { color: CREAM, strokeThickness: 2 }));

    // sub-pestañas
    const sub: { kind: PrizeKind; text: string; color: string }[] = [
      { kind: 'ball', text: 'Pelotas', color: 'green' },
      { kind: 'skin', text: 'Skins', color: 'gold' },
      { kind: 'trail', text: 'Rastros', color: 'blue' },
    ];
    sub.forEach((t, i) => {
      const b = makeButton(this, W / 2 + (i - 1) * 74, 92, {
        color: t.color, w: 68, h: 18, text: t.text, size: 9,
        onClick: () => {
          if (this.colTab === t.kind) return;
          this.colTab = t.kind;
          this.colPage = 0;
          sfx.click();
          this.show('collection');
        },
      });
      b.setAlpha(this.colTab === t.kind ? 1 : 0.55);
      this.content.add(b);
    });

    const cell = (x: number, y: number, i: number, rarity: Rarity, owned: boolean, equipped: boolean, draw: (c: Phaser.GameObjects.Container) => void, onPick: () => void) => {
      const c = this.add.container(x, y);
      c.add(this.add.nineslice(0, 0, equipped ? 'btn9-gold' : owned ? 'btn9-white' : 'btn9-gray', 0, 36, 42, 5, 5, 5, 7));
      // franja de rareza
      c.add(this.add.rectangle(0, 15, 26, 3, hex(RARITIES[rarity].color), owned ? 1 : 0.4));
      if (owned) draw(c);
      else c.add(label(this, 0, -3, '?', 18, { color: '#c8bfb4' }));
      if (owned) {
        c.setSize(36, 42).setInteractive({ useHandCursor: true });
        c.on('pointerup', () => {
          onPick();
          sfx.click();
        });
      }
      c.setScale(0.8).setAlpha(0);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, delay: i * 25, ease: 'Back.easeOut' });
      this.content.add(c);
    };
    const col = (i: number) => 36 + (i % 5) * 42;
    const row = (i: number) => 136 + Math.floor(i / 5) * 46;

    if (this.colTab === 'ball') {
      // tipos de pelota: se dibujan con la skin equipada y a su tamaño
      BALL_TYPES.slice(pageStart, pageStart + pageSize).forEach((b, i) => {
        cell(col(i), row(i), i, b.rarity, progress.ownsBall(b.id), progress.ball === b.id, (c) => {
          const ball = this.add.sprite(0, -6, `ball-${progress.skin}`, 0).setScale(1.8 * ballScale(b));
          c.add(ball);
          this.spinBall(ball);
          c.add(label(this, 0, 8, b.name, 6, { color: '#ffffff', strokeThickness: 2 }));
        }, () => {
          this.equipKind = 'ball';
          this.equipPage = 0;
          this.show('equipment');
        });
      });
    } else if (this.colTab === 'skin') {
      SKINS.slice(pageStart, pageStart + pageSize).forEach((s, i) => {
        cell(col(i), row(i), i, s.rarity, progress.ownsSkin(s.id), progress.skin === s.id, (c) => {
          const ball = this.add.sprite(0, -3, `ball-${s.id}`, 0).setScale(2.2);
          c.add(ball);
          this.spinBall(ball);
        }, () => {
          this.equipKind = 'skin';
          this.equipPage = 0;
          this.show('equipment');
        });
      });
    } else {
      TRAILS.slice(pageStart, pageStart + pageSize).forEach((t, i) => {
        cell(col(i), row(i), i, t.rarity, progress.ownsTrail(t.id), progress.trail === t.id, (c) => {
          c.add(this.trailPreview(t, 0, -3, 30));
        }, () => {
          this.equipKind = 'trail';
          this.equipPage = 0;
          this.show('equipment');
        });
      });
    }
    this.addPageControls(this.colPage, pageCount, pageControlsY, (page) => {
      this.colPage = page;
      this.show('collection');
    });
  }

  /** Selector de objetos desbloqueados; el detalle queda siempre separado bajo la cuadrícula. */
  buildEquipment() {
    const kind = this.equipKind;
    const equippedId = kind === 'ball' ? progress.ball : kind === 'skin' ? progress.skin : progress.trail;
    const kindLabel = KIND_NAMES[kind];
    this.content.add(label(this, W / 2, 72, 'EQUIPAMIENTO', 11, { color: CREAM, strokeThickness: 2 }));

    const sub: { kind: PrizeKind; text: string; color: string }[] = [
      { kind: 'ball', text: 'Pelotas', color: 'green' },
      { kind: 'skin', text: 'Skins', color: 'gold' },
      { kind: 'trail', text: 'Rastros', color: 'blue' },
    ];
    sub.forEach((t, i) => {
      const b = makeButton(this, W / 2 + (i - 1) * 74, 94, {
        color: t.color, w: 68, h: 18, text: t.text, size: 9,
        onClick: () => {
          if (this.equipKind === t.kind) return;
          this.equipKind = t.kind;
          this.equipPage = 0;
          sfx.click();
          this.show('equipment');
        },
      });
      b.setAlpha(kind === t.kind ? 1 : 0.55);
      this.content.add(b);
    });

    const ownedBalls = BALL_TYPES.filter((b) => progress.ownsBall(b.id));
    const ownedSkins = SKINS.filter((s) => progress.ownsSkin(s.id));
    const ownedTrails = TRAILS.filter((t) => progress.ownsTrail(t.id));
    const ownedCount = kind === 'ball' ? ownedBalls.length : kind === 'skin' ? ownedSkins.length : ownedTrails.length;
    const pageSize = 24;
    const pageCount = Math.ceil(ownedCount / pageSize);
    this.equipPage = Math.min(this.equipPage, pageCount - 1);
    const pageStart = this.equipPage * pageSize;
    const visibleCount = Math.min(pageSize, ownedCount - pageStart);
    const rows = Math.ceil(visibleCount / 6);
    const lastRowY = 132 + (rows - 1) * 37;
    const pageControlsY = lastRowY + 28;
    const panelTop = 110;
    const panelBottom = pageCount > 1 ? pageControlsY + 18 : lastRowY + 24;
    this.content.add(panel(this, W / 2, (panelTop + panelBottom) / 2, 224, panelBottom - panelTop, 'hud9'));
    const x = (i: number) => 35 + (i % 6) * 34;
    const y = (i: number) => 132 + Math.floor(i / 6) * 37;
    const cell = (
      px: number, py: number, i: number, rarity: Rarity, equipped: boolean,
      draw: (c: Phaser.GameObjects.Container) => void, onPick: () => void,
    ) => {
      const c = this.add.container(px, py);
      c.add(this.add.nineslice(0, 0, equipped ? 'btn9-gold' : 'btn9-white', 0, 30, 32, 5, 5, 5, 7));
      c.add(this.add.rectangle(0, 14, 24, 2, hex(RARITIES[rarity].color), 1));
      draw(c);
      if (!equipped) {
        c.setSize(30, 32).setInteractive({ useHandCursor: true });
        c.on('pointerup', () => {
          onPick();
          sfx.click();
          this.show('equipment');
        });
      }
      c.setScale(0.8).setAlpha(0);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, delay: i * 20, ease: 'Back.easeOut' });
      this.content.add(c);
    };

    if (kind === 'ball') {
      ownedBalls.slice(pageStart, pageStart + pageSize).forEach((b, i) => cell(x(i), y(i), i, b.rarity, equippedId === b.id, (c) => {
        const ball = this.add.sprite(0, -4, `ball-${progress.skin}`, 0).setScale(1.45 * ballScale(b));
        c.add(ball);
        this.spinBall(ball);
        c.add(label(this, 0, 9, b.name, 5, { color: '#ffffff', strokeThickness: 1 }));
      }, () => progress.equipBall(b.id)));
    } else if (kind === 'skin') {
      ownedSkins.slice(pageStart, pageStart + pageSize).forEach((s, i) => cell(x(i), y(i), i, s.rarity, equippedId === s.id, (c) => {
        const ball = this.add.sprite(0, -1, `ball-${s.id}`, 0).setScale(1.9);
        c.add(ball);
        this.spinBall(ball);
      }, () => progress.equipSkin(s.id)));
    } else {
      ownedTrails.slice(pageStart, pageStart + pageSize).forEach((t, i) => cell(x(i), y(i), i, t.rarity, equippedId === t.id, (c) => {
        c.add(this.trailPreview(t, 0, -1, 26));
      }, () => progress.equipTrail(t.id)));
    }
    this.addPageControls(this.equipPage, pageCount, pageControlsY, (page) => {
      this.equipPage = page;
      this.show('equipment');
    });

    const box = this.add.container(W / 2, 353);
    box.add(panel(this, 0, 0, 224, 86, 'hud9'));
    if (kind === 'ball') {
      const b = ballTypeById(equippedId);
      const preview = this.add.sprite(-78, 0, `ball-${progress.skin}`, 0).setScale(2.5 * ballScale(b));
      box.add(preview);
      this.spinBall(preview);
      box.add(label(this, -42, -25, `${kindLabel.toUpperCase()} EQUIPADA`, 6, { ox: 0, color: CREAM, strokeThickness: 1 }));
      box.add(label(this, -42, -10, b.name, 10, { ox: 0, color: RARITIES[b.rarity].color }));
      box.add(label(this, -42, 10, b.desc, 7, { ox: 0, align: 'left', color: '#ffffff', strokeThickness: 1, wrap: 140 }));
    } else if (kind === 'skin') {
      const skin = SKINS.find((s) => s.id === equippedId) || SKINS[0];
      const preview = this.add.sprite(-78, 0, `ball-${skin.id}`, 0).setScale(2.5);
      box.add(preview);
      this.spinBall(preview);
      box.add(label(this, -42, -25, `${kindLabel.toUpperCase()} EQUIPADA`, 6, { ox: 0, color: CREAM, strokeThickness: 1 }));
      box.add(label(this, -42, -10, skin.name, 10, { ox: 0, color: RARITIES[skin.rarity].color }));
      box.add(label(this, -42, 10, RARITIES[skin.rarity].name, 7, { ox: 0, color: '#ffffff' }));
    } else {
      const trail = trailById(equippedId);
      box.add(this.trailPreview(trail, 0, 0, 42).setPosition(-78, 0).setScale(1.2));
      box.add(label(this, -42, -25, `${kindLabel.toUpperCase()} EQUIPADO`, 6, { ox: 0, color: CREAM, strokeThickness: 1 }));
      box.add(label(this, -42, -10, trail.name, 10, { ox: 0, color: RARITIES[trail.rarity].color }));
      box.add(label(this, -42, 10, RARITIES[trail.rarity].name, 7, { ox: 0, color: '#ffffff' }));
    }
    box.add(label(this, -42, 29, `Desbloqueados: ${ownedCount}`, 6, { ox: 0, color: CREAM }));
    this.content.add(box);
  }

  /** Mini dibujo de un rastro: una curva con sus colores y una bola en la punta */
  trailPreview(t: Trail, x: number, y: number, len: number) {
    const preview = { graphics: this.add.graphics(), trail: t, x, y, len };
    this.trailPreviews.push(preview);
    this.drawTrailPreview(preview);
    return preview.graphics;
  }

  drawTrailPreview({ graphics: g, trail: t, x, y, len }: TrailPreview) {
    g.clear();
    const n = 10;
    const wMax = (t.width ?? 6) - 1;
    const shift = t.rainbow ? Math.floor(this.time.now / 120) : 0;
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const colorIndex = Math.floor(k * t.colors.length);
      const col = t.colors[t.rainbow ? (colorIndex + shift) % t.colors.length : Math.min(t.colors.length - 1, colorIndex)];
      const x0 = x - len / 2 + ((i - 1) / n) * len;
      const x1 = x - len / 2 + k * len;
      const y0 = y + 6 - Math.sin(((i - 1) / n) * Math.PI * 0.9) * 10;
      const y1 = y + 6 - Math.sin(k * Math.PI * 0.9) * 10;
      g.lineStyle(1 + k * wMax * 0.7, col, 0.35 + k * 0.6).lineBetween(x0, y0, x1, y1);
    }
    if (t.sparkle) for (let i = 0; i < 4; i++) g.fillStyle(t.sparkle[i % t.sparkle.length], 1).fillRect(x - len / 2 + 4 + i * 6, y - 4 + (i % 2) * 6, 1, 1);
  }

  spinBall(ball: Phaser.GameObjects.Sprite) {
    this.tweens.addCounter({
      from: 0, to: 4, duration: 900, repeat: -1,
      onUpdate: (tw) => {
        if (ball.active) ball.setFrame(Math.floor(tw.getValue() ?? 0) % 4);
      },
    });
  }

  // ---------------------------------------------------------------- Gachapón

  /**
   * Máquina del gachapón. Dentro solo hay cápsulas de lo que te falta (nunca hay repetidos) y las
   * probabilidades se recalculan con tu colección: si completas una rareza, su parte se reparte.
   */
  buildGacha() {
    const cx = W / 2;
    const gy = GACHA_MACHINE_Y;
    const odds = progress.odds();
    const left = progress.remainingPrizes();
    const { have, total } = progress.gachaCollected();
    const complete = progress.gachaComplete();
    const canPull = progress.canPull();

    this.content.add(panel(this, cx, 242, 224, 340, 'panel9'));
    this.content.add(label(this, cx, 82, complete ? '¡COLECCIÓN COMPLETA!' : 'CÁPSULAS SORPRESA', 13, { color: PAL.sand, strokeThickness: 3 }));

    // barra de colección
    const bar = this.add.graphics();
    const bw = 130;
    const bx = cx - bw / 2 - 14;
    const fill = (bw * have) / total;
    bar.fillStyle(0x1a1020).fillRoundedRect(bx - 1, 94, bw + 2, 8, 3);
    bar.fillStyle(0x7a4ad0).fillRoundedRect(bx, 95, Math.max(4, fill), 6, 2);
    bar.fillStyle(0xd8b8ff, 0.6).fillRect(bx + 2, 96, Math.max(0, fill - 4), 1);
    this.content.add(bar);
    this.content.add(label(this, bx + bw + 6, 97, `${have}/${total}`, 8, { ox: 0, color: '#d8b8ff', strokeThickness: 2 }));

    // máquina (en un contenedor para poder sacudirla entera)
    const machine = this.add.container(0, 0);
    this.content.add(machine);
    const aura = this.add.image(cx, gy, 'glow').setTint(0x8c74ff).setBlendMode('ADD').setAlpha(0.32).setScale(2.5);
    machine.add(aura);
    this.tweens.add({ targets: aura, alpha: 0.48, scale: 2.7, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const shell = this.add.graphics();
    shell.fillStyle(0x24172f, 0.45).fillEllipse(cx, gy + 112, 150, 18);
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 68, gy + 48, 136, 82, 9);
    shell.fillStyle(0xef4d5e).fillRoundedRect(cx - 63, gy + 53, 126, 72, 7);
    shell.fillStyle(0xffa08d).fillRoundedRect(cx - 57, gy + 58, 114, 5, 2);
    shell.fillStyle(0xc73550).fillRoundedRect(cx - 57, gy + 68, 114, 45, 4);
    shell.fillStyle(0xffd36b).fillRect(cx - 53, gy + 118, 106, 3);
    // boca de salida y remaches
    shell.fillStyle(0x35282c).fillRoundedRect(cx + 10, gy + 88, 42, 30, 5);
    shell.fillStyle(0x171323).fillRoundedRect(cx + 14, gy + 92, 34, 22, 3);
    shell.fillStyle(0xf2b43a).fillCircle(cx - 48, gy + 77, 3);
    shell.fillStyle(0xf2b43a).fillCircle(cx + 48, gy + 77, 3);
    // ranura de fichas
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 22, gy + 72, 26, 14, 3);
    shell.fillStyle(0x171323).fillRect(cx - 18, gy + 77, 18, 3);
    machine.add(shell);
    // piloto: verde si puedes tirar, rojo si faltan fichas, dorado si ya lo tienes todo
    const led = this.add.circle(cx - 9, gy + 66, 2.5, canPull ? 0x72d454 : complete ? 0xffd36b : 0xef4d5e);
    machine.add(led);
    if (canPull) this.tweens.add({ targets: led, alpha: 0.3, duration: 450, yoyo: true, repeat: -1 });

    const glass = this.add.graphics();
    glass.fillStyle(0x302b5a).fillCircle(cx, gy, 69);
    glass.fillStyle(0x80caff, 0.14).fillCircle(cx, gy, 64);
    machine.add(glass);

    // cápsulas: una por premio que te falta (hasta 22), del color de su rareza
    const rnd = new Phaser.Math.RandomDataGenerator(['gacha', String(left.length)]);
    const inside = rnd.shuffle([...left]).slice(0, 22);
    const caps: Capsule[] = [];
    for (const p of inside) {
      const a = rnd.realInRange(0, Math.PI * 2);
      const r = 10 + Math.sqrt(rnd.frac()) * 42;
      const ang = rnd.between(-40, 40);
      const c = this.add.container(cx + Math.cos(a) * r, gy - 2 + Math.sin(a) * r * 0.7).setAngle(ang).setScale(0.75);
      if (RARITY_ORDER.indexOf(p.rarity) >= 2) {
        // las épicas y legendarias brillan
        const g = this.add.image(0, 0, 'glow').setTint(hex(RARITIES[p.rarity].color)).setBlendMode('ADD').setScale(0.35).setAlpha(0.5);
        c.add(g);
        this.tweens.add({ targets: g, alpha: 0.15, scale: 0.45, duration: 500 + rnd.between(0, 300), yoyo: true, repeat: -1 });
      }
      c.add([this.add.image(0, -4, 'capsule-top').setTint(hex(RARITIES[p.rarity].color)), this.add.image(0, 2, 'capsule-bottom')]);
      // flotan un poco
      this.tweens.add({ targets: c, y: c.y - 1.5, duration: 700 + rnd.between(0, 500), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd.between(0, 600) });
      caps.push({ c, a, r, ang, rarity: p.rarity });
      machine.add(c);
    }
    if (complete) {
      machine.add(label(this, cx, gy - 4, '¡Lo tienes todo!', 12, { color: PAL.sand, strokeThickness: 3 }));
      machine.add(label(this, cx, gy + 12, 'Ya no quedan cápsulas', 8, { color: CREAM, strokeThickness: 2 }));
    }

    const rim = this.add.graphics();
    rim.lineStyle(4, 0x35282c, 1).strokeCircle(cx, gy, 69);
    rim.lineStyle(2, 0xa6eaff, 0.9).strokeCircle(cx, gy, 65);
    rim.fillStyle(0xffffff, 0.42).fillEllipse(cx - 27, gy - 35, 18, 30);
    rim.fillStyle(0xffffff, 0.28).fillEllipse(cx + 34, gy - 12, 8, 18);
    machine.add(rim);

    const knob = this.add.container(cx - 56, gy + 91);
    const kg = this.add.graphics();
    kg.fillStyle(0x35282c).fillCircle(0, 0, 15);
    kg.fillStyle(0xffd36b).fillCircle(0, 0, 12);
    kg.fillStyle(0xa8611f).fillCircle(0, 0, 7);
    kg.fillStyle(0xfff6cc).fillCircle(-2, -2, 3);
    kg.fillStyle(0x35282c).fillRect(-1, -12, 2, 6);
    knob.add(kg);
    machine.add(knob);
    if (canPull) this.tweens.add({ targets: knob, angle: { from: -10, to: 10 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // botón
    if (complete) {
      this.content.add(makeButton(this, cx, 328, { color: 'gold', w: 172, h: 34, text: '¡COMPLETA!', size: 15 }));
    } else {
      const btn = makeButton(this, cx, 328, {
        color: canPull ? 'purple' : 'gray', w: 172, h: 34, text: `   ¡TIRAR! · ${GACHA.cost}`, size: 15,
        onClick: () => this.pull(machine, knob, caps),
      });
      btn.add(this.add.image(16, -2, 'token'));
      (btn.list[1] as Phaser.GameObjects.Text).x = -12;
      if (canPull) this.tweens.add({ targets: btn, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.content.add(btn);
      if (!canPull) {
        const need = GACHA.cost - progress.tokens;
        this.content.add(label(this, cx, 309, need === 1 ? 'Te falta 1 ficha' : `Te faltan ${need} fichas`, 7, { color: '#ffb0b0', strokeThickness: 2 }));
      }
    }

    // probabilidades actuales (toca una rareza para ver qué premios tiene)
    this.content.add(label(this, cx, 351, 'PROBABILIDADES', 8, { color: CREAM, strokeThickness: 2 }));
    RARITY_ORDER.forEach((rarity, i) => {
      const o = odds[rarity];
      const R = RARITIES[rarity];
      const color = hex(R.color);
      const done = o.left === 0;
      const card = this.add.container(cx + (i - 1.5) * 51, 378);
      const g = this.add.graphics();
      g.fillStyle(color, done ? 0.08 : 0.18).fillRoundedRect(-23, -18, 46, 37, 3);
      g.lineStyle(1, color, done ? 0.4 : 0.9).strokeRoundedRect(-23, -18, 46, 37, 3);
      // barra de lo conseguido de esta rareza
      const got = o.total ? (o.total - o.left) / o.total : 1;
      g.fillStyle(0x1a1020, 0.8).fillRect(-18, 13, 36, 3);
      g.fillStyle(color, 1).fillRect(-18, 13, 36 * got, 3);
      card.add(g);
      const big = done ? 'OK' : `${percentage(o.chance)}%`;
      card.add(label(this, 0, -10, big, 10, { color: R.color, strokeThickness: 2 }));
      card.add(label(this, 0, 0, R.name, 6, { color: CREAM, strokeThickness: 1 }));
      card.add(label(this, 0, 8, done ? 'Completa' : `${o.total - o.left}/${o.total}`, 6, { color: done ? R.color : '#ffffff', strokeThickness: 1 }));
      card.setSize(46, 37).setInteractive({ useHandCursor: true });
      card.on('pointerup', () => {
        if (this.busy) return;
        sfx.click();
        this.showRarityList(rarity);
      });
      this.content.add(card);
    });
    this.content.add(label(this, cx, 405, 'Sin repetidos · las probabilidades cambian con tu colección', 6, { color: CREAM }));
  }

  /** Ventana con los premios de una rareza: los que tienes y los que faltan ("?") */
  showRarityList(rarity: Rarity) {
    this.busy = true;
    const R = RARITIES[rarity];
    const list = PRIZES.filter((p) => p.rarity === rarity);
    const cols = 5;
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const h = 76 + rows * 44;
    const cx = W / 2;
    const cy = H / 2;
    const items: Phaser.GameObjects.GameObject[] = [];
    const close = () => {
      for (const o of items) o.destroy();
      this.busy = false;
    };
    const blocker = this.add.rectangle(cx, cy, W, H, 0x1a1020, 0.75).setDepth(55).setInteractive();
    blocker.on('pointerup', close);
    items.push(blocker);
    const box = this.add.container(cx, cy).setDepth(56);
    items.push(box);
    // el panel se traga los toques para que no cierren la ventana
    box.add(panel(this, 0, 0, 220, h, 'panel9').setInteractive());
    const odds = progress.odds();
    const o = odds[rarity];
    const rarityPct = percentage(o.chance);
    const prizeChance = o.left ? o.chance / o.left : 0;
    const prizePct = percentage(prizeChance);
    box.add(label(this, 0, -h / 2 + 16, R.name.toUpperCase(), 14, { color: R.color, strokeThickness: 3 }));
    box.add(label(this, 0, -h / 2 + 31, o.left
      ? `Quedan ${o.left} · rareza ${rarityPct}% · premio ${prizePct}% c/u`
      : `¡Completa! ${o.total}/${o.total}`, 7, {
      color: CREAM, strokeThickness: 2,
    }));
    list.forEach((p, i) => {
      const inRow = Math.min(cols, list.length - Math.floor(i / cols) * cols);
      const x = ((i % cols) - (inRow - 1) / 2) * 40;
      const y = -h / 2 + 62 + Math.floor(i / cols) * 44;
      const owned = progress.hasGachaPrize(p.kind, p.id);
      box.add(this.add.nineslice(x, y, owned ? 'btn9-white' : 'btn9-gray', 0, 36, 36, 5, 5, 5, 7));
      if (owned) box.add(this.prizeIcon(p, x, y - 4));
      else box.add(label(this, x, y - 4, '?', 16, { color: '#c8bfb4' }));
      box.add(label(this, x, y + 11, owned ? p.name : KIND_NAMES[p.kind], 5, { color: owned ? '#ffffff' : '#c8bfb4', strokeThickness: 1 }));
    });
    box.add(makeButton(this, 0, h / 2 - 18, { color: 'green', w: 80, h: 22, text: 'Cerrar', size: 10, onClick: close }));
    box.setScale(0.9).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 180, ease: 'Back.easeOut' });
  }

  /** Dibujo pequeño de un premio: pelota (con tu skin y a su tamaño), skin o rastro */
  prizeIcon(p: Prize, x: number, y: number) {
    if (p.kind === 'trail') return this.trailPreview(trailById(p.id), 0, 0, 26).setPosition(x, y);
    const k = p.kind === 'ball' ? ballScale(ballTypeById(p.id)) : 1;
    const s = this.add.sprite(x, y, `ball-${p.kind === 'skin' ? p.id : progress.skin}`, 0).setScale(1.8 * k);
    this.spinBall(s);
    return s;
  }

  /**
   * Tirada: la manivela gira, las cápsulas dan vueltas dentro de la bola, la máquina tiembla,
   * una cápsula de la rareza que ha salido baja por la boca y se abre.
   */
  pull(machine: Phaser.GameObjects.Container, knob: Phaser.GameObjects.Container, caps: Capsule[]) {
    if (this.busy) return;
    const prize = progress.pull();
    if (!prize) {
      sfx.denied();
      this.tweens.add({ targets: this.content, x: 3, duration: 40, yoyo: true, repeat: 2 });
      return;
    }
    this.busy = true;
    this.updateWallet();
    sfx.click();
    const cx = W / 2;
    const gy = GACHA_MACHINE_Y;
    const color = hex(RARITIES[prize.rarity].color);

    this.tweens.killTweensOf(knob);
    this.tweens.add({ targets: knob, angle: knob.angle + 720, duration: 1000, ease: 'Cubic.easeInOut' });
    this.tweens.add({ targets: machine, x: { from: -2, to: 2 }, duration: 45, yoyo: true, repeat: 10, onComplete: () => machine.setX(0) });
    // remolino de cápsulas
    for (const k of caps) this.tweens.killTweensOf(k.c);
    this.tweens.addCounter({
      from: 0, to: 1, duration: 1000, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        for (const k of caps) {
          if (!k.c.active) continue;
          const a = k.a + t * Math.PI * 4;
          const r = k.r * (1 - Math.sin(t * Math.PI) * 0.35);
          k.c.setPosition(cx + Math.cos(a) * r, gy - 2 + Math.sin(a) * r * 0.7).setAngle(k.ang + t * 720);
        }
      },
    });
    [200, 400, 600, 800].forEach((d, i) => this.time.delayedCall(d, () => sfx.charge(Math.min(3, i + 1))));

    // la cápsula del premio se va hacia la boca de la máquina
    const pick = caps.find((k) => k.rarity === prize.rarity);
    this.time.delayedCall(1000, () => {
      if (pick?.c.active) this.tweens.add({ targets: pick.c, x: cx + 30, y: gy + 62, scale: 0.3, alpha: 0, duration: 200, ease: 'Quad.easeIn' });
    });

    const cap = this.add.container(cx + 31, gy + 96).setDepth(60).setScale(0.6).setAlpha(0);
    const top = this.add.image(0, -5, 'capsule-top').setTint(color);
    const bot = this.add.image(0, 5, 'capsule-bottom');
    cap.add([top, bot]);
    this.time.delayedCall(1200, () => {
      cap.setAlpha(1);
      sfx.land(300);
      this.tweens.add({
        targets: cap, y: gy + 106, duration: 220, ease: 'Bounce.easeOut',
        onComplete: () => this.reveal(cap, top, bot, prize, color),
      });
    });
  }

  /** La cápsula sube al centro y tiembla: cuanto más rara, más tiempo, más luz y más fuerte */
  reveal(cap: Phaser.GameObjects.Container, top: Phaser.GameObjects.Image, bot: Phaser.GameObjects.Image, prize: Prize, color: number) {
    const cx = W / 2;
    const cy = 190;
    const tier = RARITY_ORDER.indexOf(prize.rarity); // 0 común … 3 legendaria
    const blocker = this.add.rectangle(cx, H / 2, W, H, 0x1a1020, 0).setDepth(55).setInteractive();
    this.tweens.add({ targets: blocker, fillAlpha: 0.8, duration: 300 });
    const glow = this.add.image(cx, cy, 'glow').setTint(color).setBlendMode('ADD').setScale(0.2).setAlpha(0).setDepth(59);
    const shakes = 3 + tier * 2;
    this.tweens.add({
      targets: cap, x: cx, y: cy, scale: 3, duration: 450, ease: 'Cubic.easeOut',
      onComplete: () => {
        // la luz crece mientras tiembla
        this.tweens.add({ targets: glow, alpha: 0.35 + tier * 0.15, scale: 1 + tier * 0.5, duration: shakes * 140 });
        let n = 0;
        this.tweens.add({
          targets: cap, angle: { from: -6 - tier * 2, to: 6 + tier * 2 }, duration: 70 - tier * 6, yoyo: true, repeat: shakes,
          onRepeat: () => {
            n++;
            if (n % 2 === 0) sfx.charge(Math.min(3, 1 + Math.floor((n / shakes) * 3)));
            if (tier >= 2) this.shake(60, 0.002 * tier);
          },
          onComplete: () => {
            cap.setAngle(0);
            sfx.hole();
            if (tier >= 2) this.time.delayedCall(250, () => sfx.star(tier - 1));
            this.sparks.explode(16 + tier * 12, cx, cy);
            if (tier >= 1) this.cameras.main.flash(120 + tier * 60, 255, 255, 255);
            if (tier === 3) this.shake(250, 0.008);
            this.tweens.add({ targets: top, y: -26, angle: -25, alpha: 0, duration: 400, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: bot, y: 24, angle: 15, alpha: 0, duration: 400, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: glow, alpha: 0, duration: 400, onComplete: () => glow.destroy() });
            this.showPrize(prize, color, blocker, cap);
          },
        });
      },
    });
  }

  /** Temblor de cámara (respeta el ajuste "Temblor") */
  shake(duration: number, intensity: number) {
    if (progress.settings.shake) this.cameras.main.shake(duration, intensity);
  }

  showPrize(prize: Prize, color: number, blocker: Phaser.GameObjects.Rectangle, cap: Phaser.GameObjects.Container) {
    const cx = W / 2;
    const cy = 190;
    const tier = RARITY_ORDER.indexOf(prize.rarity);
    const r = RARITIES[prize.rarity];
    const items: Phaser.GameObjects.GameObject[] = [blocker, cap];
    let sparkle: Phaser.Time.TimerEvent | null = null;
    const card = panel(this, cx, cy + 14, 220, 244, 'panel9').setDepth(56);
    items.push(card);
    const rays = this.add.image(cx, cy, 'ray').setOrigin(0.5, 1).setTint(color).setBlendMode('ADD').setAlpha(0.3 + tier * 0.1).setScale(2.2, 1.2).setDepth(56);
    const rays2 = this.add.image(cx, cy, 'ray').setOrigin(0.5, 1).setTint(color).setBlendMode('ADD').setAlpha(0.3 + tier * 0.1).setScale(2.2, 1.2).setAngle(180).setDepth(56);
    const glow = this.add.image(cx, cy, 'glow').setTint(color).setBlendMode('ADD').setScale(1.4 + tier * 0.2).setAlpha(0.7).setDepth(56);
    this.tweens.add({ targets: [rays, rays2], angle: '+=360', duration: 7000 - tier * 1200, repeat: -1 });
    this.tweens.add({ targets: glow, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
    items.push(rays, rays2, glow);
    // las legendarias siguen soltando chispas
    if (tier === 3) {
      sparkle = this.time.addEvent({
        delay: 220, loop: true,
        callback: () => this.sparks.explode(2, cx + Phaser.Math.Between(-40, 40), cy + Phaser.Math.Between(-30, 30)),
      });
    }

    let shown: Phaser.GameObjects.Graphics | Phaser.GameObjects.Sprite;
    let size = 2.6;
    if (prize.kind === 'trail') {
      shown = this.trailPreview(trailById(prize.id), 0, 0, 30).setPosition(cx, cy).setDepth(57);
    } else {
      // una pelota se enseña con la skin que llevas puesta, a su tamaño
      const ball = this.add.sprite(cx, cy, `ball-${prize.kind === 'skin' ? prize.id : progress.skin}`, 0).setDepth(57);
      this.spinBall(ball);
      shown = ball;
      size = prize.kind === 'skin' ? 5 : 4 * ballScale(ballTypeById(prize.id));
    }
    items.push(shown);
    this.tweens.add({ targets: shown, scale: { from: 0, to: size }, duration: 400, ease: 'Back.easeOut' });
    this.tweens.add({ targets: shown, y: cy - 3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 400 });

    const t3 = label(this, cx, cy - 70, tier >= 2 ? `¡${r.name.toUpperCase()}!` : '¡NUEVO!', 18, { color: tier >= 2 ? r.color : PAL.sand, strokeThickness: 4 }).setDepth(57);
    this.tweens.add({ targets: t3, scale: { from: 0, to: 1 }, duration: 350, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t3, scale: 1.12, duration: 420, yoyo: true, repeat: -1, delay: 350 });
    const t1 = label(this, cx, cy + 56, prize.name, 18, { color: '#ffffff' }).setDepth(57);
    const t2 = label(this, cx, cy + 75, `${KIND_NAMES[prize.kind]} · ${r.name}`, 10, { color: r.color }).setDepth(57);
    items.push(t1, t2, t3);
    const { have, total } = progress.gachaCollected();
    const sub = prize.kind === 'ball' ? ballTypeById(prize.id).desc : `Colección ${have}/${total}`;
    items.push(label(this, cx, cy + 92, sub, 8, { color: CREAM, strokeThickness: 2, wrap: 196 }).setDepth(57));

    const close = () => {
      sparkle?.remove();
      for (const o of items) o.destroy();
      this.busy = false;
      this.show('gacha');
    };
    const equip = makeButton(this, cx - 52, cy + 122, {
      color: 'gold', w: 96, h: 26, text: 'Equipar', size: 12,
      onClick: () => {
        progress.equip(prize.kind, prize.id);
        close();
      },
    }).setDepth(57);
    const ok = makeButton(this, cx + 52, cy + 122, { color: 'green', w: 96, h: 26, text: 'Seguir', size: 12, onClick: close }).setDepth(57);
    items.push(equip, ok);
  }

  /** Cartera de la cabecera: monedas en Habilidades, fichas en el resto */
  updateWallet() {
    const tokens = this.tab !== 'upgrades';
    this.walletIcon.setTexture(tokens ? 'token' : 'coin');
    this.coinText.setText(String(tokens ? progress.tokens : progress.coins)).setColor(tokens ? '#d8b8ff' : PAL.sand);
  }

  update(_: number, delta: number) {
    this.bg.update(delta / 1000);
    this.trailPreviews = this.trailPreviews.filter((preview) => preview.graphics.active);
    for (const preview of this.trailPreviews) {
      if (preview.trail.rainbow) this.drawTrailPreview(preview);
    }
  }
}
