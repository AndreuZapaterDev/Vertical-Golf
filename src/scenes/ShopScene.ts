import Phaser from 'phaser';
import { W, H, PAL, BALL_R } from '../constants';
import { Background } from '../gfx/background';
import { bakeTexture } from '../gfx/bake';
import { tintFill } from '../gfx/tint';
import { UPGRADES, UPGRADE_GROUPS, SKINS, type Upgrade, type UpgradeGroup, type UpgradeId } from '../data/upgrades';
import { TRAILS, AURAS, BALL_TYPES, RARITIES, RARITY_ORDER, PRIZES, GACHA, KIND_NAMES, trailById, ballTypeById, auraById, type Rarity, type Trail, type Aura, type Prize, type PrizeKind, type BallType } from '../data/cosmetics';
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
  /** objeto seleccionado en la colección (su ficha sale debajo) */
  colSel: string | null = null;
  /** grupo de mejoras que se ve y la mejora seleccionada (su información sale abajo) */
  upGroup: UpgradeGroup = 'shot';
  upSel: UpgradeId | null = null;
  /** categoría del equipamiento */
  equipKind: PrizeKind = 'ball';
  equipPage = 0;
  bg!: Background;
  coinText!: Phaser.GameObjects.Text;
  walletIcon!: Phaser.GameObjects.Image;
  tabs!: Record<Tab, Phaser.GameObjects.Container>;
  tabX!: Record<Tab, number>;
  tabGlow!: Phaser.GameObjects.Image;
  content!: Phaser.GameObjects.Container;
  sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  trailPreviews: TrailPreview[] = [];
  /** animación del gachapón en curso */
  busy = false;
  /** cosas del gachapón que hay que parar al cambiar de pestaña (luces, destellos, temporizadores) */
  gachaStops: (() => void)[] = [];
  /** trampilla de la boca de la máquina (se abre al caer la cápsula) */
  gachaFlap: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Shop');
  }

  init(data?: { back?: string; tab?: Tab }) {
    this.back = data?.back || 'Menu';
    this.tab = data?.tab || 'upgrades';
    this.colTab = 'ball';
    this.colPage = 0;
    this.colSel = null;
    this.upGroup = 'shot';
    this.upSel = null;
    this.gachaStops = [];
    this.equipKind = 'ball';
    this.equipPage = 0;
  }

  create() {
    fitCamera(this);
    this.bg = new Background(this, 'sunset');

    // título con marco de panel y cartera como contador hundido
    panel(this, W / 2, 22, 112, 28, 'panel9');
    label(this, W / 2, 20.5, 'TIENDA', 19, { color: PAL.sand, strokeThickness: 4 });
    iconButton(this, 16, 22, 'back', () => {
      if (!this.busy) transitionTo(this, () => this.scene.start(this.back));
    });

    // cartera: monedas en Habilidades, fichas en Gachapón y Colección
    panel(this, W - 34, 22, 56, 20, 'field9');
    this.walletIcon = this.add.image(W - 54, 22, 'coin');
    this.coinText = label(this, W - 45, 22, String(progress.coins), 11, { ox: 0, color: PAL.sand });

    // pestañas, con un brillo dorado que se desliza hasta la activa
    this.tabX = { upgrades: W / 2 - 87, gacha: W / 2 - 29, collection: W / 2 + 29, equipment: W / 2 + 87 };
    this.tabGlow = this.add.image(this.tabX[this.tab], 50, 'glow').setTint(0xffd36b).setBlendMode('ADD').setScale(1.15, 0.6).setAlpha(0.6);
    const tab = (t: Tab, text: string, color: string) =>
      makeButton(this, this.tabX[t], 50, { color, w: 54, h: 22, text, size: 7, onClick: () => !this.busy && this.show(t) });
    this.tabs = {
      upgrades: tab('upgrades', 'Mejoras', 'gold'),
      gacha: tab('gacha', 'Gachapón', 'purple'),
      collection: tab('collection', 'Colección', 'blue'),
      equipment: tab('equipment', 'Equipar', 'green'),
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
      b.setAlpha(selected ? 1 : 0.65).setScale(selected ? 1.04 : 1);
    }
    this.tweens.killTweensOf(this.tabGlow);
    this.tweens.add({ targets: this.tabGlow, x: this.tabX[tab], duration: 180, ease: 'Cubic.easeOut' });
    for (const stop of this.gachaStops) stop();
    this.gachaStops = [];
    this.trailPreviews = [];
    this.content.removeAll(true);
    this.content.setX(0);
    // el contenido de cada pestaña aparece con un fundido corto
    this.tweens.killTweensOf(this.content);
    this.content.setAlpha(0);
    this.tweens.add({ targets: this.content, alpha: 1, duration: 150 });
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

  /**
   * Mejoras: tres grupos (Golpe, Terreno y Ayudas) con sus tarjetas. Tocar una tarjeta la selecciona y abajo salen
   * dónde sirve, qué cambia con el siguiente nivel y (si la tienes) el selector de nivel activo.
   * Los grupos con algo que puedes comprar llevan un aviso "!".
   */
  buildUpgrades() {
    const group = this.upGroup;
    const list = UPGRADES.filter((u) => u.group === group);
    const accent = { shot: 0xf2b43a, terrain: 0x72d454, help: 0x9a8af0 }[group];
    const totalLevels = UPGRADES.reduce((n, u) => n + u.values.length - 1, 0);
    const bought = progress.upgradesBought();
    // tarjetas más holgadas cuando hay pocas; el marco y la caja de información se ajustan para no dejar huecos
    const n = list.length;
    const spacing = n >= 5 ? 48 : n === 4 ? 54 : 58;
    const CH = spacing - 4; // alto de la tarjeta
    const HW = 106; // medio ancho (el marco mide 228: así las tarjetas no pisan su borde)
    const firstY = 116 + spacing / 2;
    const panelBottom = 116 + n * spacing + 4;
    const infoY = panelBottom + 28;

    // progreso total de mejoras, con barra
    this.content.add(panel(this, W / 2, 72, 140, 14, 'field9'));
    this.content.add(label(this, W / 2 - 20, 72, `Mejoras ${bought}/${totalLevels}`, 9, { color: CREAM, strokeThickness: 2 }));
    const hb = this.add.graphics();
    const hw = 50 * (bought / totalLevels);
    hb.fillStyle(0x0f0a14).fillRoundedRect(W / 2 + 14, 69.5, 50, 5, 2);
    if (bought > 0) {
      hb.fillStyle(0xffd36b).fillRoundedRect(W / 2 + 14, 69.5, Math.max(3, hw), 5, 2);
      hb.fillStyle(0xffffff, 0.4).fillRect(W / 2 + 15, 70, Math.max(0, hw - 2), 1);
    }
    this.content.add(hb);

    // grupos
    UPGRADE_GROUPS.forEach((g, i) => {
      const x = W / 2 + (i - 1) * 74;
      const b = makeButton(this, x, 92, {
        color: g.color, w: 68, h: 18, text: g.name, size: 9,
        onClick: () => {
          if (this.upGroup === g.id) return;
          this.upGroup = g.id;
          this.upSel = null;
          this.show('upgrades');
        },
      });
      b.setAlpha(group === g.id ? 1 : 0.55);
      this.content.add(b);
      if (group === g.id) this.content.add(this.add.rectangle(x, 103, 44, 2, 0xffd36b));
      const canBuy = UPGRADES.some((u) => {
        const c = progress.nextCost(u.id);
        return u.group === g.id && c != null && progress.coins >= c;
      });
      if (canBuy) {
        const badge = label(this, x + 31, 85, '!', 9, { color: '#ffffff', stroke: '#ef4d5e', strokeThickness: 3 });
        this.content.add(badge);
        this.tweens.add({ targets: badge, scale: 1.25, duration: 420, yoyo: true, repeat: -1 });
      }
    });

    // marco de las tarjetas (siempre del mismo tamaño, para que no salte al cambiar de grupo)
    this.content.add(panel(this, W / 2, (110 + panelBottom) / 2, 228, panelBottom - 110, 'panel9'));

    // caja de información de la mejora seleccionada
    this.content.add(panel(this, W / 2, infoY, 228, 40, 'field9'));
    const infoTitle = label(this, W / 2 - 106, infoY - 10, '', 8, { ox: 0, color: PAL.sand, strokeThickness: 2 });
    const infoText = label(this, W / 2 - 106, infoY + 3, '', 7, { ox: 0, color: CREAM, strokeThickness: 1 });
    this.content.add([infoTitle, infoText]);
    let niv: Phaser.GameObjects.Container | null = null;
    // resplandor de la tarjeta seleccionada (una capa por tarjeta, solo se ve la elegida)
    const glows = new Map<UpgradeId, Phaser.GameObjects.Container>();
    const showInfo = (u: Upgrade) => {
      this.upSel = u.id;
      for (const [id, g] of glows) g.setVisible(id === u.id);
      const lvl = progress.upgradeLevel(u.id);
      const cost = progress.nextCost(u.id);
      infoTitle.setText(`${u.name} · ${u.where}`);
      infoText.setText(cost == null
        ? `Nivel máximo: ${u.fmt(u.values[lvl])}`
        : `Ahora: ${u.fmt(u.values[lvl])}  →  Nivel ${lvl + 1}: ${u.fmt(u.values[lvl + 1])}`);
      // selector del nivel activo (0 apaga la mejora), a la derecha de la caja
      niv?.destroy();
      niv = this.add.container(W / 2, infoY);
      if (lvl > 0) {
        const activeLevel = progress.upgradeActiveLevel(u.id);
        niv.add(label(this, 33, 3, 'NIVEL', 5, { color: CREAM, strokeThickness: 1 }));
        for (let level = 0; level <= lvl; level++) {
          niv.add(makeButton(this, 50 + level * 13, 3, {
            color: activeLevel === level ? (level === 0 ? 'orange' : 'green') : 'gray',
            w: 12, h: 15, text: String(level), size: 7,
            onClick: () => {
              progress.setUpgradeActiveLevel(u.id, level);
              sfx.click();
              this.upSel = u.id;
              this.show('upgrades');
            },
          }));
        }
      }
      this.content.add(niv);
    };

    list.forEach((u, i) => {
      const y = firstY + i * spacing;
      const lvl = progress.upgradeLevel(u.id);
      const max = u.costs.length;
      const cost = progress.nextCost(u.id);
      const afford = cost != null && progress.coins >= cost;
      const maxed = cost == null;
      const activeLevel = progress.upgradeActiveLevel(u.id);
      const on = activeLevel > 0;
      const active = lvl > 0 && on;

      const card = this.add.container(W / 2, y);
      // cuerpo de la tarjeta: borde (dorado si está al máximo, verde si puedes comprarla), tinte del grupo y tira de color
      const bg = this.add.graphics();
      const hh = CH / 2;
      bg.fillStyle(maxed ? 0xffd36b : afford ? 0x9ae06a : 0x35282c).fillRoundedRect(-HW - 1, -hh - 1, HW * 2 + 2, CH + 2, 6);
      bg.fillStyle(lvl > 0 ? 0x4a3a40 : 0x3f2f36).fillRoundedRect(-HW, -hh, HW * 2, CH, 5);
      if (lvl > 0) bg.fillStyle(accent, maxed ? 0.18 : 0.09).fillRoundedRect(-HW, -hh, HW * 2, CH, 5);
      bg.fillStyle(0xffffff, 0.07).fillRoundedRect(-HW + 1, -hh + 1, HW * 2 - 2, 13, { tl: 4, tr: 4, bl: 0, br: 0 });
      bg.fillStyle(accent).fillRoundedRect(-HW, -hh, 5, CH, { tl: 5, bl: 5, tr: 0, br: 0 });
      card.add(bg);
      // seleccionada: se ilumina con el color del grupo (relleno más vivo y borde que late)
      // (un halo que se sale de la tarjeta, un relleno muy vivo con luz aditiva y un borde grueso)
      const halo = this.add.graphics().setBlendMode('ADD');
      for (let r = 1; r <= 3; r++) halo.lineStyle(2, accent, 0.34 / r).strokeRoundedRect(-HW - r * 1.6, -hh - r * 1.6, HW * 2 + r * 3.2, CH + r * 3.2, 5 + r);
      const fillGlow = this.add.graphics().setBlendMode('ADD');
      fillGlow.fillStyle(accent, 0.34).fillRoundedRect(-HW, -hh, HW * 2, CH, 5);
      fillGlow.fillStyle(0xffffff, 0.16).fillRoundedRect(-HW + 1, -hh + 1, HW * 2 - 2, 14, { tl: 4, tr: 4, bl: 0, br: 0 });
      const edge = this.add.graphics();
      edge.lineStyle(2.5, accent, 1).strokeRoundedRect(-HW + 1, -hh + 1, HW * 2 - 2, CH - 2, 4);
      edge.lineStyle(1, 0xffffff, 0.55).strokeRoundedRect(-HW + 3, -hh + 3, HW * 2 - 6, CH - 6, 3);
      const hl = this.add.container(0, 0, [halo, fillGlow, edge]).setVisible(false);
      card.add(hl);
      this.tweens.add({ targets: hl, alpha: { from: 0.7, to: 1 }, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      glows.set(u.id, hl);
      if (afford) {
        const ring = this.add.rectangle(0, 0, HW * 2, CH).setStrokeStyle(1.5, 0x9ae06a, 1);
        card.add(ring);
        this.tweens.add({ targets: ring, alpha: 0.15, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }

      // icono en una insignia circular (con el color del grupo si la tienes; con halo si está activa)
      const ib = this.add.graphics();
      ib.fillStyle(0x35282c).fillCircle(-85, 0, 17);
      ib.fillStyle(lvl > 0 ? accent : 0x6e5458).fillCircle(-85, 0, 15.5);
      ib.fillStyle(0x241a22).fillCircle(-85, 0, 13.5);
      ib.fillStyle(0xffffff, 0.09).fillEllipse(-88, -6, 13, 6);
      card.add(ib);
      if (active) card.add(this.add.image(-85, 0, 'glow').setTint(accent).setBlendMode('ADD').setScale(0.6).setAlpha(0.4));
      card.add(this.add.image(-85, 0, u.icon).setScale(lvl ? 1.7 : 1.5).setAlpha(active ? 1 : 0.55));

      card.add(label(this, -62, -12, u.name, 11, { ox: 0, color: active ? PAL.sand : lvl ? '#c8bfb4' : '#ffffff' }));
      card.add(label(this, -62, 0, u.desc, 7, { ox: 0, color: CREAM, strokeThickness: 2 }));

      // niveles: segmentos redondeados (los comprados con brillo; los que no están activos, apagados)
      const pg = this.add.graphics();
      for (let k = 0; k < max; k++) {
        const px = -62 + k * 15;
        pg.fillStyle(0x1a1020).fillRoundedRect(px, 8, 13, 7, 3);
        if (k < lvl) {
          pg.fillStyle(accent, k < activeLevel ? 1 : 0.35).fillRoundedRect(px + 1, 9, 11, 5, 2);
          if (k < activeLevel) pg.fillStyle(0xffffff, 0.4).fillRect(px + 2, 9.5, 9, 1);
        }
      }
      card.add(pg);
      // valor actual y, en verde, el del siguiente nivel
      const short = (t: string) => t.replace(' por hoyo', '/hoyo');
      const nowText = on ? short(u.fmt(u.values[activeLevel])) : 'Apagada';
      const vx = -62 + max * 15 + 4;
      card.add(label(this, vx, 12, nowText, 7, { ox: 0, color: on ? '#ffffff' : '#c8bfb4', strokeThickness: 2 }));
      if (!maxed) {
        const nx = vx + Math.ceil(nowText.length * 3.3) + 5;
        const nextText = `›  ${short(u.fmt(u.values[lvl + 1]))}`;
        // solo si cabe antes del botón del precio (si no, el siguiente nivel sale en la caja de abajo)
        if (nx + Math.ceil(nextText.length * 3.3) <= 50) card.add(label(this, nx, 12, nextText, 7, { ox: 0, color: '#9be06a', strokeThickness: 2 }));
      }

      if (maxed) {
        // distintivo dorado de "al máximo"
        const mg = this.add.graphics();
        mg.fillStyle(0x35282c).fillRoundedRect(54, -11, 48, 22, 6);
        mg.fillStyle(0xf2b43a).fillRoundedRect(55, -10, 46, 20, 5);
        mg.fillStyle(0xfff0a0, 0.7).fillRoundedRect(56, -9, 44, 5, 3);
        card.add(mg);
        card.add(label(this, 78, 0.5, 'MÁX', 11, { color: '#5a3a10', stroke: false, shadow: false }));
      } else {
        const btn = makeButton(this, 78, 0, {
          color: afford ? 'green' : 'gray',
          w: 48,
          h: 26,
          text: `${cost}`,
          size: 11,
          onClick: () => {
            if (progress.buyUpgrade(u.id)) {
              sfx.buy();
              this.upSel = u.id;
              this.show('upgrades');
              this.flash(W / 2 - 85, y);
            } else {
              sfx.denied();
              this.tweens.add({ targets: card, x: W / 2 + 3, duration: 40, yoyo: true, repeat: 2 });
            }
          },
        });
        btn.add(this.add.image(-14, -2, 'coin'));
        (btn.list[1] as Phaser.GameObjects.Text).x = 5;
        card.add(btn);
      }

      // tocar la tarjeta la selecciona
      card.setSize(HW * 2, CH).setInteractive();
      card.on('pointerup', () => {
        sfx.click();
        showInfo(u);
      });

      card.setAlpha(0).setX(W / 2 + 12);
      this.tweens.add({ targets: card, alpha: 1, x: W / 2, duration: 220, delay: i * 35 });
      this.content.add(card);
    });
    showInfo(list.find((u) => u.id === this.upSel) ?? list[0]);
  }

  // ---------------------------------------------------------------- Colección y equipamiento
  // (comparten las casillas y la ficha de detalle)

  itemList(kind: PrizeKind): { id: string; name: string; rarity: Rarity }[] {
    return kind === 'ball' ? BALL_TYPES : kind === 'skin' ? SKINS : kind === 'aura' ? AURAS : TRAILS;
  }

  owns(kind: PrizeKind, id: string) {
    return progress.owns(kind, id);
  }

  equippedOf(kind: PrizeKind) {
    return kind === 'ball' ? progress.ball : kind === 'skin' ? progress.skin : kind === 'aura' ? progress.aura : progress.trail;
  }

  ownedCount(kind: PrizeKind) {
    return this.itemList(kind).filter((i) => this.owns(kind, i.id)).length;
  }

  /** Dibujo de un objeto dentro de un contenedor: pelota (con tu skin y a su tamaño), skin o rastro */
  drawItem(c: Phaser.GameObjects.Container, kind: PrizeKind, id: string, k: number, withName: boolean, ox = 0, oy = 0) {
    if (kind === 'ball') {
      const b = ballTypeById(id);
      const ball = this.add.sprite(ox, oy - (withName ? 5 : 0) * k, `ball-${progress.skin}`, 0).setScale(1.8 * ballScale(b) * k);
      c.add(ball);
      this.spinBall(ball);
      if (withName) c.add(label(this, ox, oy + 8 * k, b.name, k < 1 ? 5 : 6, { color: '#ffffff', strokeThickness: k < 1 ? 1 : 2 }));
    } else if (kind === 'skin') {
      const ball = this.add.sprite(ox, oy - 2 * k, `ball-${id}`, 0).setScale(2.2 * k);
      c.add(ball);
      this.spinBall(ball);
    } else if (kind === 'aura') {
      this.auraPreview(c, auraById(id), k, ox, oy - 2 * k);
    } else {
      c.add(this.trailPreview(trailById(id), 0, 0, 30 * k).setPosition(ox, oy - 2 * k));
    }
  }

  /** Bola con su aura animada: luz que late, ondas, satélites, chispas o cambio de color según el estilo */
  auraPreview(c: Phaser.GameObjects.Container, A: Aura, k: number, ox: number, oy: number) {
    const col = A.id === 'auto' ? 0xffffff : A.color;
    const col2 = A.color2 ?? col;
    const glow = this.add.image(ox, oy, 'glow').setBlendMode('ADD').setTint(col).setScale(1.05 * k * (A.size ?? 1)).setAlpha(0.85);
    c.add(glow);
    this.tweens.add({ targets: glow, alpha: 0.5, scale: glow.scale * (A.style === 'pulse' ? 1.3 : 1.1), duration: 750, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (A.style === 'rainbow') {
      this.tweens.addCounter({ from: 0, to: 1, duration: 2400, repeat: -1, onUpdate: (tw) => glow.setTint(Phaser.Display.Color.HSLToColor(tw.getValue() ?? 0, 0.9, 0.7).color) });
    }
    if (A.style === 'ring' || A.style === 'halo') {
      const ring = this.add.circle(ox, oy, 8 * k).setStrokeStyle(1, col, 0.9);
      c.add(ring);
      this.tweens.add({ targets: ring, scale: { from: 0.8, to: 1.7 }, alpha: { from: 1, to: 0 }, duration: 1300, repeat: -1 });
      if (A.style === 'halo') c.add(this.add.circle(ox, oy, 9 * k).setStrokeStyle(1, col2, 0.7));
    }
    if (A.style === 'orbit' || A.style === 'halo' || A.style === 'rainbow') {
      const n = A.style === 'orbit' ? 3 : 2;
      const orbit = this.add.container(ox, oy);
      for (let i = 0; i < n; i++) {
        const a = (i * Math.PI * 2) / n;
        orbit.add(this.add.rectangle(Math.cos(a) * 11 * k, Math.sin(a) * 11 * k, 2, 2, i % 2 ? col2 : col));
      }
      c.add(orbit);
      this.tweens.add({ targets: orbit, angle: 360, duration: 1800, repeat: -1 });
    }
    if (A.style === 'sparks' || A.style === 'flame') {
      for (let i = 0; i < 4; i++) {
        const dot = this.add.rectangle(ox + (i - 1.5) * 4 * k, oy + 6 * k, 2, 2, i % 2 ? col2 : col).setAlpha(0);
        c.add(dot);
        this.tweens.add({ targets: dot, y: oy - 12 * k, alpha: { from: 1, to: 0 }, duration: 900, repeat: -1, delay: i * 220 });
      }
    }
    const ball = this.add.sprite(ox, oy, `ball-${progress.skin}`, 0).setScale(1.5 * k);
    c.add(ball);
    this.spinBall(ball);
  }

  /** Rasgos de un objeto para las etiquetas de la ficha: estadísticas de la pelota, efectos del rastro, estilo de la skin */
  itemTraits(kind: PrizeKind, id: string): { text: string; color: string }[] {
    const good = '#9be06a';
    const bad = '#ff9a7a';
    const neutral = '#d8d0e8';
    const out: { text: string; color: string }[] = [];
    if (kind === 'ball') {
      const b = ballTypeById(id);
      const pct = (v: number) => `${v > 1 ? '+' : '-'}${Math.round(Math.abs(v - 1) * 100)}%`;
      if (b.radius && b.radius < BALL_R) out.push({ text: 'Pequeña', color: neutral });
      if (b.power && b.power !== 1) out.push({ text: `Potencia ${pct(b.power)}`, color: b.power > 1 ? good : bad });
      if (b.grip && b.grip !== 1) out.push({ text: b.grip > 1 ? `Agarre ×${b.grip}` : 'Rueda más', color: b.grip > 1 ? good : neutral });
      if (b.bounce) out.push({ text: 'Rebota', color: neutral });
      if (b.gravity && b.gravity !== 1) out.push({ text: b.gravity < 1 ? 'Flota' : 'Pesada', color: neutral });
      if (b.wind && b.wind !== 1) out.push({ text: `Viento ${pct(b.wind)}`, color: b.wind < 1 ? good : bad });
      if (b.magnet && b.magnet !== 1) out.push({ text: `Imán ×${b.magnet}`, color: good });
      if (!out.length) out.push({ text: 'Sin cambios', color: neutral });
    } else if (kind === 'skin') {
      const names = {
        stripes: 'Rayas', dots: 'Puntos', gradient: 'Degradado', shimmer: 'Destellos', prism: 'Prisma', checker: 'Cuadros', bands: 'Franjas',
        split: 'Dos mitades', zigzag: 'Zigzag', swirl: 'Espiral', stars: 'Estrellas', flame: 'Llamas', glitch: 'Glitch', hex: 'Panal', ember: 'Moteado',
      };
      const s = SKINS.find((x) => x.id === id);
      out.push({ text: s?.pattern ? names[s.pattern] : 'Color liso', color: neutral });
      if (s && (s.rarity === 'epic' || s.rarity === 'legendary')) out.push({ text: 'Destello', color: good });
    } else if (kind === 'aura') {
      const names = { soft: 'Luz suave', pulse: 'Late', ring: 'Ondas', orbit: 'Satélites', sparks: 'Chispas', flame: 'Llamas', rainbow: 'Arcoíris', halo: 'Halo' };
      const a = auraById(id);
      out.push({ text: a.id === 'auto' ? 'Color del rastro' : names[a.style], color: a.style === 'soft' ? neutral : good });
      if (a.color2 && a.style !== 'rainbow') out.push({ text: '2 colores', color: neutral });
    } else {
      const t = trailById(id);
      if (t.rainbow) out.push({ text: 'Arcoíris', color: good });
      if (t.sparkle) out.push({ text: 'Chispas', color: good });
      if ((t.width ?? 6) >= 8) out.push({ text: 'Grueso', color: neutral });
      out.push({ text: t.colors.length > 1 ? `${t.colors.length} colores` : 'Color liso', color: neutral });
    }
    return out;
  }

  /** Etiquetas pequeñas en filas que se ajustan al ancho disponible */
  addChips(c: Phaser.GameObjects.Container, traits: { text: string; color: string }[], x0: number, y0: number, maxW: number) {
    let x = 0;
    let y = 0;
    for (const t of traits) {
      const w = Math.ceil(t.text.length * 3.3) + 8;
      if (x + w > maxW && x > 0) {
        x = 0;
        y += 12;
      }
      const col = hex(t.color);
      const g = this.add.graphics();
      g.fillStyle(col, 0.18).fillRoundedRect(x0 + x, y0 + y - 5, w, 10, 3);
      g.lineStyle(1, col, 0.7).strokeRoundedRect(x0 + x, y0 + y - 5, w, 10, 3);
      c.add(g);
      c.add(label(this, x0 + x + w / 2, y0 + y, t.text, 6, { color: t.color, strokeThickness: 1 }));
      x += w + 3;
    }
  }

  /**
   * Casilla de la colección / el equipamiento: marco según su estado (equipada, tuya o aún no), brillo para las
   * rarezas altas, insignia verde si está equipada y silueta oscura si todavía no la tienes.
   */
  slotCell(
    x: number, y: number, w: number, h: number,
    o: { rarity: Rarity; owned: boolean; equipped: boolean; ghost?: boolean; interactive: boolean; delay: number; draw: (c: Phaser.GameObjects.Container) => void; onPick?: () => void },
  ) {
    const c = this.add.container(x, y);
    const rc = hex(RARITIES[o.rarity].color);
    const tier = RARITY_ORDER.indexOf(o.rarity);
    c.add(this.add.nineslice(0, 0, o.equipped ? 'btn9-gold' : o.owned ? 'btn9-white' : 'btn9-gray', 0, w, h, 5, 5, 5, 7));
    if (o.owned && tier >= 2) {
      const gl = this.add.image(0, -2, 'glow').setTint(rc).setBlendMode('ADD').setScale((w / 64) * 1.15).setAlpha(0.4);
      c.add(gl);
      this.tweens.add({ targets: gl, alpha: 0.18, duration: 900, yoyo: true, repeat: -1, delay: o.delay });
    }
    // franja de rareza
    c.add(this.add.rectangle(0, h / 2 - 7, w - 12, 3, rc, o.owned ? 1 : 0.4));
    const n0 = c.length;
    if (o.owned) o.draw(c);
    else if (o.ghost) {
      o.draw(c);
      for (const ch of c.list.slice(n0)) {
        if (ch instanceof Phaser.GameObjects.Sprite || ch instanceof Phaser.GameObjects.Image) tintFill(ch, 0x2a1f30).setAlpha(0.6);
      }
    } else c.add(label(this, 0, -3, '?', 18, { color: '#c8bfb4' }));
    if (o.equipped) {
      const bx = w / 2 - 5;
      const by = -h / 2 + 5;
      const bg = this.add.graphics();
      bg.fillStyle(0x35282c).fillCircle(bx, by, 5).fillStyle(0x72d454).fillCircle(bx, by, 4);
      bg.lineStyle(1.5, 0xffffff).lineBetween(bx - 2, by, bx - 0.5, by + 1.8).lineBetween(bx - 0.5, by + 1.8, bx + 2.2, by - 1.8);
      c.add(bg);
    }
    c.setSize(w, h);
    if (o.interactive) {
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => this.tweens.add({ targets: c, scale: 1.07, duration: 80 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scale: 1, duration: 80 }));
      c.on('pointerup', () => {
        sfx.click();
        o.onPick?.();
      });
    }
    c.setScale(0.8).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, delay: o.delay, ease: 'Back.easeOut' });
    this.content.add(c);
    return c;
  }

  /**
   * Ficha de detalle de un objeto (vista previa, nombre, rareza y rasgos).
   * 'col': botón para equiparlo, o para ir al gachapón si aún no lo tienes. 'eq': cuántos tienes desbloqueados.
   */
  fillDetail(box: Phaser.GameObjects.Container, kind: PrizeKind, id: string, mode: 'col' | 'eq') {
    const def = this.itemList(kind).find((i) => i.id === id) ?? this.itemList(kind)[0];
    const R = RARITIES[def.rarity];
    const owned = this.owns(kind, def.id);
    const equipped = this.equippedOf(kind) === def.id;
    box.add(panel(this, 0, 0, 224, 84, 'panel9'));
    box.add(panel(this, -76, -2, 54, 54, 'field9'));
    if (owned) this.drawItem(box, kind, def.id, 1.4, false, -76, -2);
    else box.add(label(this, -76, -2, '?', 24, { color: '#c8bfb4' }));
    box.add(label(this, -42, -29, owned ? def.name : '???', 11, { ox: 0, color: R.color }));
    box.add(label(this, -42, -17, `${KIND_NAMES[kind]} · ${R.name}`, 7, { ox: 0, color: CREAM, strokeThickness: 1 }));
    this.addChips(box, owned ? this.itemTraits(kind, def.id) : [{ text: 'Sin descubrir', color: '#c8bfb4' }], -42, -5, 142);
    if (mode === 'eq') {
      const have = this.ownedCount(kind);
      const total = this.itemList(kind).length;
      box.add(label(this, -42, 24, `Desbloqueados ${have}/${total}`, 6, { ox: 0, color: CREAM }));
      const g = this.add.graphics();
      g.fillStyle(0x1a1020).fillRoundedRect(-42, 30, 100, 5, 2);
      g.fillStyle(hex(R.color)).fillRoundedRect(-42, 30, Math.max(3, (100 * have) / total), 5, 2);
      box.add(g);
      return;
    }
    if (!owned) {
      box.add(label(this, -42, 26, 'Sale del gachapón', 7, { ox: 0, color: CREAM }));
      box.add(makeButton(this, 76, 27, { color: 'purple', w: 56, h: 18, text: 'Gachapón', size: 8, onClick: () => this.show('gacha') }));
    } else if (equipped) {
      box.add(label(this, -42, 26, 'EQUIPADA', 8, { ox: 0, color: '#9be06a' }));
    } else {
      box.add(makeButton(this, 70, 27, { color: 'gold', w: 66, h: 20, text: 'Equipar', size: 9, onClick: () => {
        progress.equip(kind, def.id);
        sfx.buy();
        this.show('collection');
      } }));
    }
  }

  /** Catálogo completo de pelotas, skins y rastros, incluidos los que faltan; al tocar uno, su ficha sale debajo */
  buildCollection() {
    const kind = this.colTab;
    const list = this.itemList(kind);
    const { have, total } = progress.collected();
    const pageSize = 20;
    const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
    this.colPage = Math.min(this.colPage, pageCount - 1);
    const pageStart = this.colPage * pageSize;
    const shown = list.slice(pageStart, pageStart + pageSize);
    const rows = Math.max(1, Math.ceil(shown.length / 5));
    const rowY = (r: number) => 134 + r * 44;
    const lastRowY = rowY(rows - 1);
    const controlsY = lastRowY + 33;
    const panelTop = 110;
    const panelBottom = pageCount > 1 ? controlsY + 15 : lastRowY + 26;
    this.content.add(panel(this, W / 2, (panelTop + panelBottom) / 2, 224, panelBottom - panelTop, 'panel9'));
    this.content.add(panel(this, W / 2, 72, 112, 14, 'field9'));
    this.content.add(label(this, W / 2, 72, `Colección ${have}/${total}`, 9, { color: CREAM, strokeThickness: 2 }));

    // sub-pestañas, con lo que llevas de cada una
    const sub: { kind: PrizeKind; text: string; color: string }[] = [
      { kind: 'ball', text: 'Pelotas', color: 'green' },
      { kind: 'skin', text: 'Skins', color: 'gold' },
      { kind: 'trail', text: 'Rastros', color: 'blue' },
      { kind: 'aura', text: 'Auras', color: 'purple' },
    ];
    sub.forEach((t, i) => {
      const x = W / 2 + (i - 1.5) * 56;
      const b = makeButton(this, x, 92, {
        color: t.color, w: 54, h: 18, text: `${t.text} ${this.ownedCount(t.kind)}/${this.itemList(t.kind).length}`, size: 6,
        onClick: () => {
          if (this.colTab === t.kind) return;
          this.colTab = t.kind;
          this.colPage = 0;
          this.colSel = null;
          this.show('collection');
        },
      });
      b.setAlpha(kind === t.kind ? 1 : 0.55);
      this.content.add(b);
      if (kind === t.kind) this.content.add(this.add.rectangle(x, 103, 44, 2, 0xffd36b));
    });

    // casillas
    let sel = this.colSel ?? this.equippedOf(kind);
    if (!list.some((i) => i.id === sel)) sel = list[0].id;
    const ring = this.add.rectangle(-100, -100, 40, 44).setStrokeStyle(1.5, 0xffffff, 1).setVisible(false);
    let detail: Phaser.GameObjects.Container | null = null;
    const showDetail = (id: string) => {
      this.colSel = id;
      detail?.destroy();
      detail = this.add.container(W / 2, panelBottom + 6 + 42);
      this.fillDetail(detail, kind, id, 'col');
      this.content.add(detail);
    };
    shown.forEach((it, i) => {
      const x = 36 + (i % 5) * 42;
      const y = rowY(Math.floor(i / 5));
      this.slotCell(x, y, 36, 40, {
        rarity: it.rarity, owned: this.owns(kind, it.id), equipped: this.equippedOf(kind) === it.id, ghost: kind === 'ball' || kind === 'skin',
        interactive: true, delay: i * 22,
        draw: (c) => this.drawItem(c, kind, it.id, 1, kind === 'ball'),
        onPick: () => {
          ring.setPosition(x, y).setVisible(true);
          showDetail(it.id);
        },
      });
      if (it.id === sel) ring.setPosition(x, y).setVisible(true);
    });
    this.content.add(ring);
    this.addPageControls(this.colPage, pageCount, controlsY, (page) => {
      this.colPage = page;
      this.show('collection');
    });
    showDetail(sel);
  }

  /** Selector de objetos desbloqueados (al tocar uno se equipa); la ficha del equipado queda siempre debajo */
  buildEquipment() {
    const kind = this.equipKind;
    const equippedId = this.equippedOf(kind);
    this.content.add(panel(this, W / 2, 72, 112, 14, 'field9'));
    this.content.add(label(this, W / 2, 72, 'EQUIPAMIENTO', 10, { color: CREAM, strokeThickness: 2 }));

    const sub: { kind: PrizeKind; text: string; color: string }[] = [
      { kind: 'ball', text: 'Pelotas', color: 'green' },
      { kind: 'skin', text: 'Skins', color: 'gold' },
      { kind: 'trail', text: 'Rastros', color: 'blue' },
      { kind: 'aura', text: 'Auras', color: 'purple' },
    ];
    sub.forEach((t, i) => {
      const x = W / 2 + (i - 1.5) * 56;
      const b = makeButton(this, x, 94, {
        color: t.color, w: 54, h: 18, text: `${t.text} ${this.ownedCount(t.kind)}`, size: 7,
        onClick: () => {
          if (this.equipKind === t.kind) return;
          this.equipKind = t.kind;
          this.equipPage = 0;
          this.show('equipment');
        },
      });
      b.setAlpha(kind === t.kind ? 1 : 0.55);
      this.content.add(b);
      if (kind === t.kind) this.content.add(this.add.rectangle(x, 105, 44, 2, 0xffd36b));
    });

    const owned = this.itemList(kind).filter((i) => this.owns(kind, i.id));
    const pageSize = 24;
    const pageCount = Math.max(1, Math.ceil(owned.length / pageSize));
    this.equipPage = Math.min(this.equipPage, pageCount - 1);
    const pageStart = this.equipPage * pageSize;
    const shown = owned.slice(pageStart, pageStart + pageSize);
    const rows = Math.max(1, Math.ceil(shown.length / 6));
    const lastRowY = 132 + (rows - 1) * 37;
    const pageControlsY = lastRowY + 28;
    const panelTop = 110;
    const panelBottom = pageCount > 1 ? pageControlsY + 18 : lastRowY + 24;
    this.content.add(panel(this, W / 2, (panelTop + panelBottom) / 2, 224, panelBottom - panelTop, 'panel9'));
    shown.forEach((it, i) => {
      const equipped = equippedId === it.id;
      this.slotCell(35 + (i % 6) * 34, 132 + Math.floor(i / 6) * 37, 30, 32, {
        rarity: it.rarity, owned: true, equipped, interactive: !equipped, delay: i * 18,
        draw: (c) => this.drawItem(c, kind, it.id, 0.85, kind === 'ball'),
        onPick: () => {
          progress.equip(kind, it.id);
          this.show('equipment');
        },
      });
    });
    this.addPageControls(this.equipPage, pageCount, pageControlsY, (page) => {
      this.equipPage = page;
      this.show('equipment');
    });

    const box = this.add.container(W / 2, 353);
    this.fillDetail(box, kind, equippedId, 'eq');
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
   * Se puede tirar de una en una o de diez (la tirada múltiple enseña todos los premios juntos).
   */
  buildGacha() {
    const cx = W / 2;
    const gy = GACHA_MACHINE_Y;
    const GR = 66; // radio del cristal
    this.gachaFlap = null;
    const odds = progress.odds();
    const left = progress.remainingPrizes();
    const { have, total } = progress.gachaCollected();
    const complete = progress.gachaComplete();
    const canPull = progress.canPull();
    const showTen = !complete && left.length >= 2;
    const canTen = showTen && progress.tokens >= GACHA.cost * 10;

    this.content.add(panel(this, cx, 244, 224, 344, 'panel9'));
    // foco de luz morada detrás de la máquina
    const spot = this.add.image(cx, gy + 18, 'glow').setTint(0x6a4ad0).setBlendMode('ADD').setScale(3.3).setAlpha(0.3);
    this.content.add(spot);
    this.tweens.add({ targets: spot, alpha: 0.18, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // cinta del título, con un destello que la cruza de vez en cuando
    const ribbon = this.add.graphics();
    ribbon.fillStyle(0x35282c).fillRoundedRect(cx - 91, 67, 182, 24, 6);
    ribbon.fillStyle(0xffd36b).fillRoundedRect(cx - 89, 69, 178, 20, 5);
    ribbon.fillStyle(complete ? 0x8a5a10 : 0x4a2c7a).fillRoundedRect(cx - 87, 71, 174, 16, 4);
    ribbon.fillStyle(0xffffff, 0.14).fillRoundedRect(cx - 85, 72, 170, 5, 2);
    this.content.add(ribbon);
    this.content.add(label(this, cx, 79, complete ? '¡COLECCIÓN COMPLETA!' : 'CÁPSULAS SORPRESA', 11, { color: complete ? '#fff6cc' : PAL.sand, strokeThickness: 3 }));
    const shine = this.add.rectangle(cx - 78, 79, 7, 14, 0xffffff, 0).setAngle(20).setBlendMode('ADD');
    this.content.add(shine);
    const shineTween = this.tweens.addCounter({
      from: 0, to: 1, duration: 900, repeat: -1, repeatDelay: 2600, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        shine.setX(cx - 78 + 156 * t).setAlpha(Math.sin(Math.PI * t) * 0.45);
      },
    });
    this.gachaStops.push(() => shineTween.stop());

    // barra de colección
    const bar = this.add.graphics();
    const bw = 130;
    const bx = cx - bw / 2 - 14;
    const fill = (bw * have) / total;
    bar.fillStyle(0x1a1020).fillRoundedRect(bx - 1, 94, bw + 2, 7, 3);
    bar.fillStyle(0x7a4ad0).fillRoundedRect(bx, 95, Math.max(4, fill), 5, 2);
    bar.fillStyle(0xd8b8ff, 0.6).fillRect(bx + 2, 96, Math.max(0, fill - 4), 1);
    this.content.add(bar);
    this.content.add(label(this, bx + bw + 6, 98, `${have}/${total}`, 8, { ox: 0, color: '#d8b8ff', strokeThickness: 2 }));

    // máquina (en un contenedor para poder sacudirla entera)
    const machine = this.add.container(0, 0);
    this.content.add(machine);
    const aura = this.add.image(cx, gy, 'glow').setTint(0x8c74ff).setBlendMode('ADD').setAlpha(0.3).setScale(2.5);
    machine.add(aura);
    this.tweens.add({ targets: aura, alpha: 0.46, scale: 2.7, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const shell = this.add.graphics();
    shell.fillStyle(0x24172f, 0.45).fillEllipse(cx, gy + 114, 164, 18);
    // patas y asas
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 62, gy + 126, 20, 8, 3).fillRoundedRect(cx + 42, gy + 126, 20, 8, 3);
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 77, gy + 66, 11, 28, 4).fillRoundedRect(cx + 66, gy + 66, 11, 28, 4);
    shell.fillStyle(0xf2b43a).fillRoundedRect(cx - 75, gy + 68, 7, 24, 3).fillRoundedRect(cx + 68, gy + 68, 7, 24, 3);
    shell.fillStyle(0xfff0a0, 0.7).fillRect(cx - 74, gy + 70, 2, 18).fillRect(cx + 69, gy + 70, 2, 18);
    // cuerpo
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 68, gy + 48, 136, 82, 9);
    shell.fillStyle(0xef4d5e).fillRoundedRect(cx - 63, gy + 53, 126, 72, 7);
    shell.fillStyle(0xffa08d).fillRoundedRect(cx - 57, gy + 58, 114, 5, 2);
    shell.fillStyle(0xc73550).fillRoundedRect(cx - 57, gy + 68, 114, 45, 4);
    shell.fillStyle(0xe85a70, 0.9).fillRoundedRect(cx - 57, gy + 68, 114, 8, 4);
    shell.fillStyle(0xffffff, 0.2).fillRoundedRect(cx - 61, gy + 56, 5, 62, 2);
    // franja de precaución (rayas doradas y oscuras)
    shell.fillStyle(0x35282c).fillRect(cx - 54, gy + 117, 108, 5);
    for (let i = 0; i < 13; i++) shell.fillStyle(i % 2 ? 0x35282c : 0xffd36b).fillRect(cx - 53 + i * 8, gy + 118, 8, 3);
    // collar de latón donde el cristal se une al cuerpo (se ve a los lados de la bola)
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 64, gy + 42, 128, 18, 7);
    shell.fillStyle(0xf2b43a).fillRoundedRect(cx - 62, gy + 44, 124, 14, 6);
    shell.fillStyle(0xfff0a0, 0.8).fillRoundedRect(cx - 58, gy + 45, 116, 3, 1);
    shell.fillStyle(0xa8611f).fillRoundedRect(cx - 62, gy + 53, 124, 5, 3);
    // boca de salida y remaches
    shell.fillStyle(0x35282c).fillRoundedRect(cx + 10, gy + 88, 42, 30, 5);
    shell.fillStyle(0x171323).fillRoundedRect(cx + 14, gy + 92, 34, 22, 3);
    shell.fillStyle(0x3a2f4d, 0.6).fillRoundedRect(cx + 14, gy + 92, 34, 5, 2);
    shell.fillStyle(0xf2b43a).fillCircle(cx - 48, gy + 77, 3);
    shell.fillStyle(0xf2b43a).fillCircle(cx + 48, gy + 77, 3);
    shell.fillStyle(0xfff0a0).fillCircle(cx - 49, gy + 76, 1).fillCircle(cx + 47, gy + 76, 1);
    // ranura de fichas
    shell.fillStyle(0x35282c).fillRoundedRect(cx - 22, gy + 72, 26, 14, 3);
    shell.fillStyle(0x171323).fillRect(cx - 18, gy + 77, 18, 3);
    machine.add(shell);
    // piloto: verde si puedes tirar, rojo si faltan fichas, dorado si ya lo tienes todo
    const led = this.add.circle(cx - 9, gy + 66, 2.5, canPull ? 0x72d454 : complete ? 0xffd36b : 0xef4d5e);
    machine.add(led);
    if (canPull) this.tweens.add({ targets: led, alpha: 0.3, duration: 450, yoyo: true, repeat: -1 });
    // pantalla LCD con las fichas que tienes
    const lcd = this.add.graphics();
    lcd.fillStyle(0x35282c).fillRoundedRect(cx - 56, gy + 70, 32, 16, 3);
    lcd.fillStyle(0x0f2a14).fillRoundedRect(cx - 54, gy + 72, 28, 12, 2);
    lcd.fillStyle(0x2f7a3c, 0.35).fillRect(cx - 53, gy + 73, 26, 3);
    machine.add(lcd);
    const tkShown = progress.tokens > 999 ? '999+' : String(progress.tokens);
    const lcdText = label(this, cx - 40, gy + 78, tkShown, 8, { color: '#9aff9a', stroke: '#0a2a0a', strokeThickness: 1 });
    machine.add(lcdText);
    if (canPull) this.tweens.add({ targets: lcdText, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });
    // luces del frontal que se persiguen
    const lamps: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < 4; i++) {
      const l = this.add.circle(cx + 17 + i * 10, gy + 78, 2.4, i % 2 ? 0xffd36b : 0x7fe3f5);
      l.setStrokeStyle(1, 0x35282c);
      machine.add(l);
      lamps.push(l);
    }
    // trampilla de la boca de salida (articulada por arriba): se levanta cuando cae una cápsula
    const flap = this.add.container(cx + 31, gy + 92);
    const fg = this.add.graphics();
    fg.fillStyle(0x35282c).fillRoundedRect(-17, 0, 34, 22, 3);
    fg.fillStyle(0x5a4e7a).fillRoundedRect(-15, 1, 30, 18, 2);
    fg.fillStyle(0x8a7eb0).fillRect(-14, 2, 28, 3);
    fg.fillStyle(0xf2b43a).fillCircle(-12, 2, 2).fillCircle(12, 2, 2);
    flap.add(fg);
    machine.add(flap);
    this.gachaFlap = flap;

    // cristal con volumen: degradado radial, reflejo del fondo y brillo
    const globe = bakeTexture(this, 'gacha-globe', 132, 132, (c) => {
      const g = c.createRadialGradient(48, 42, 6, 66, 66, 66);
      g.addColorStop(0, '#6a68b8');
      g.addColorStop(0.5, '#3a3676');
      g.addColorStop(1, '#1d1844');
      c.fillStyle = g;
      c.beginPath();
      c.arc(66, 66, 66, 0, Math.PI * 2);
      c.fill();
    }, { linear: true });
    machine.add(this.add.image(cx, gy, globe).setDisplaySize(GR * 2, GR * 2));
    const glass = this.add.graphics();
    glass.fillStyle(0x80caff, 0.12).fillEllipse(cx, gy + 46, 96, 30); // reflejo del suelo del cristal
    machine.add(glass);

    // cápsulas amontonadas en el fondo, como en una máquina de verdad (sin solaparse del todo)
    const rnd = new Phaser.Math.RandomDataGenerator(['gacha', String(left.length)]);
    const inside = rnd.shuffle([...left]).slice(0, 24);
    const spots: { x: number; y: number }[] = [];
    for (let tries = 0; spots.length < inside.length && tries < 900; tries++) {
      const px = rnd.realInRange(-50, 50);
      const py = rnd.realInRange(-8, 50);
      if (Math.hypot(px, py) > 53) continue; // dentro del cristal
      if (spots.some((s) => Math.hypot(s.x - px, s.y - py) < 16)) continue;
      spots.push({ x: px, y: py });
    }
    spots.sort((a, b) => a.y - b.y); // las de arriba se dibujan primero: las de abajo quedan por delante
    const caps: Capsule[] = [];
    inside.slice(0, spots.length).forEach((p, i) => {
      const s = spots[i];
      const a = Math.atan2(s.y, s.x);
      const r = Math.hypot(s.x, s.y);
      const ang = rnd.between(-50, 50);
      const rc = hex(RARITIES[p.rarity].color);
      const c = this.add.container(cx + s.x, gy + s.y).setAngle(ang).setScale(0.82);
      if (RARITY_ORDER.indexOf(p.rarity) >= 2) {
        // las épicas y legendarias brillan
        const g = this.add.image(0, 0, 'glow').setTint(rc).setBlendMode('ADD').setScale(0.4).setAlpha(0.55);
        c.add(g);
        this.tweens.add({ targets: g, alpha: 0.15, scale: 0.5, duration: 500 + rnd.between(0, 300), yoyo: true, repeat: -1 });
      }
      c.add([this.add.image(0, -4, 'capsule-top').setTint(rc), this.add.image(0, 2, 'capsule-bottom'), this.add.ellipse(-4, -6, 5, 3, 0xffffff, 0.75)]);
      // se acomodan con un balanceo mínimo
      this.tweens.add({ targets: c, y: c.y - 0.8, duration: 800 + rnd.between(0, 600), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: rnd.between(0, 700) });
      caps.push({ c, a, r, ang, rarity: p.rarity });
      machine.add(c);
    });
    if (complete) {
      machine.add(label(this, cx, gy - 4, '¡Lo tienes todo!', 12, { color: PAL.sand, strokeThickness: 3 }));
      machine.add(label(this, cx, gy + 12, 'Ya no quedan cápsulas', 8, { color: CREAM, strokeThickness: 2 }));
    }

    // borde del cristal y reflejos
    const rim = this.add.graphics();
    rim.lineStyle(3, 0x35282c, 1).strokeCircle(cx, gy, GR - 0.5);
    rim.lineStyle(2, 0xa6eaff, 0.9).strokeCircle(cx, gy, GR - 4);
    rim.fillStyle(0xffffff, 0.42).fillEllipse(cx - 26, gy - 34, 17, 29);
    rim.fillStyle(0xffffff, 0.28).fillEllipse(cx + 33, gy - 12, 8, 17);
    machine.add(rim);
    const sheen = this.add.ellipse(cx - 30, gy - 30, 9, 34, 0xffffff, 0.15).setAngle(24);
    machine.add(sheen);
    this.tweens.add({ targets: sheen, x: cx + 32, alpha: 0.05, duration: 3800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // corona de latón con bombillas que se persiguen (más deprisa al tirar)
    const ring = this.add.graphics();
    ring.lineStyle(10, 0x35282c, 1).strokeCircle(cx, gy, GR + 4);
    ring.lineStyle(6, 0xf2b43a, 1).strokeCircle(cx, gy, GR + 4);
    ring.lineStyle(1.5, 0xa8611f, 1).strokeCircle(cx, gy, GR + 1.5);
    ring.lineStyle(1.5, 0xfff0a0, 0.9);
    ring.beginPath();
    ring.arc(cx, gy, GR + 6.2, Phaser.Math.DegToRad(195), Phaser.Math.DegToRad(285), false);
    ring.strokePath();
    machine.add(ring);
    const bulbs: { b: Phaser.GameObjects.Arc; a: number; col: number }[] = [];
    const lightN = 20;
    for (let i = 0; i < lightN; i++) {
      const a = (i / lightN) * Math.PI * 2;
      const col = i % 2 ? 0xfff0a0 : 0xff9ac0;
      const b = this.add.circle(cx + Math.cos(a) * (GR + 4), gy + Math.sin(a) * (GR + 4), 2.7, col);
      b.setStrokeStyle(1, 0x35282c);
      machine.add(b);
      bulbs.push({ b, a, col });
    }
    let lightFrame = 0;
    const lights = this.tweens.addCounter({
      from: 0, to: 1, duration: 2400, repeat: -1,
      onUpdate: (tw) => {
        if (lightFrame++ & 1) return; // las bombillas se actualizan un fotograma de cada dos (se ven igual de fluidas y cuesta la mitad)
        const t = tw.getValue() ?? 0;
        for (const { b, a } of bulbs) {
          if (!b.active) continue;
          const v = Math.max(0, Math.cos((a / (Math.PI * 2) - t) * Math.PI * 2));
          b.setAlpha(0.35 + 0.65 * v).setScale(0.85 + 0.35 * v);
        }
        lamps.forEach((l, i) => {
          if (l.active) l.setAlpha(0.3 + 0.7 * Math.max(0, Math.cos((i / lamps.length - t * 2) * Math.PI * 2)));
        });
      },
    });
    lights.timeScale = canPull ? 1.5 : 0.6;
    this.gachaStops.push(() => lights.stop());

    // manivela: placa de latón con un brazo y una bola roja (al girar, la bola da la vuelta)
    const knob = this.add.container(cx - 24, gy + 104);
    const kg = this.add.graphics();
    kg.fillStyle(0x35282c).fillCircle(0, 0, 14);
    kg.fillStyle(0xd9922a).fillCircle(0, 0, 12);
    kg.fillStyle(0xffd36b).fillCircle(0, 0, 10);
    kg.fillStyle(0xfff6cc).fillCircle(-3, -3, 3);
    kg.fillStyle(0xa8611f).fillCircle(0, 0, 3);
    kg.fillStyle(0x35282c).fillRoundedRect(-2.5, -14, 5, 13, 2);
    kg.fillStyle(0xf2b43a).fillRoundedRect(-1.5, -13, 3, 11, 1);
    kg.fillStyle(0x35282c).fillCircle(0, -14, 4.4);
    kg.fillStyle(0xef4d5e).fillCircle(0, -14, 3.4);
    kg.fillStyle(0xffb0b8).fillCircle(-1, -15, 1);
    knob.add(kg);
    machine.add(knob);
    if (canPull) this.tweens.add({ targets: knob, angle: { from: -10, to: 10 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // si puedes tirar: destellos y confeti de colores que caen despacio, y un meneo de vez en cuando
    if (canPull) {
      const em = this.add.particles(0, 0, 'spark', {
        x: { min: cx - 92, max: cx + 92 }, y: { min: gy - 70, max: gy + 110 }, lifespan: 1500, speed: { min: 4, max: 14 }, angle: { min: 250, max: 290 },
        scale: { start: 0.9, end: 0 }, alpha: { start: 0.9, end: 0 }, frequency: 240, blendMode: 'ADD', tint: 0xfff0a0,
      }).setDepth(40);
      const confetti = this.add.particles(0, 0, 'px', {
        x: { min: cx - 100, max: cx + 100 }, y: 108, lifespan: 3200, speedY: { min: 14, max: 26 }, speedX: { min: -7, max: 7 },
        scale: { start: 1.6, end: 0.8 }, alpha: { start: 0.75, end: 0 }, frequency: 380, tint: [0xffd36b, 0xff7aa8, 0x7fe3f5, 0xb8ec6a, 0xb47aff],
      }).setDepth(39);
      this.gachaStops.push(() => em.destroy(), () => confetti.destroy());
      const teaser = this.time.addEvent({
        delay: 5200, loop: true,
        callback: () => {
          if (this.busy || !machine.active) return;
          this.tweens.add({ targets: machine, x: { from: -1.5, to: 1.5 }, duration: 50, yoyo: true, repeat: 5, onComplete: () => machine.setX(0) });
          sfx.charge(1);
        },
      });
      this.gachaStops.push(() => teaser.remove(false));
    }

    // botones: tirar una vez y tirar diez
    const by = 328;
    if (complete) {
      this.content.add(makeButton(this, cx, by, { color: 'gold', w: 172, h: 34, text: '¡COMPLETA!', size: 15 }));
    } else {
      const wide = showTen ? 116 : 172;
      const btn = makeButton(this, showTen ? cx - 30 : cx, by, {
        color: canPull ? 'purple' : 'gray', w: wide, h: 34, text: '¡TIRAR!', size: showTen ? 13 : 15,
        onClick: () => this.pullMany(1, machine, knob, caps, lights),
      });
      // «¡TIRAR!  ◉ 1»: el grupo entero queda centrado en el botón
      const sz = showTen ? 13 : 15;
      (btn.list[1] as Phaser.GameObjects.Text).x = showTen ? -12 : -14;
      btn.add(this.add.image(showTen ? 17 : 22, -2, 'token'));
      btn.add(label(this, showTen ? 30 : 36, -2, String(GACHA.cost), sz, { weight: '700', strokeThickness: 2, stroke: 'rgba(20,26,51,0.55)', shadowY: 1 }));
      if (canPull) this.tweens.add({ targets: btn, scale: 1.04, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.content.add(btn);
      if (showTen) {
        const ten = makeButton(this, cx + 62, by, {
          color: canTen ? 'gold' : 'gray', w: 52, h: 34, text: '×10', size: 14,
          onClick: () => this.pullMany(10, machine, knob, caps, lights),
        });
        this.content.add(ten);
        if (canTen) this.tweens.add({ targets: ten, scale: 1.05, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 300 });
      }
      if (!canPull) {
        const need = GACHA.cost - progress.tokens;
        this.content.add(label(this, cx, 306, need === 1 ? 'Te falta 1 ficha' : `Te faltan ${need} fichas`, 7, { color: '#ffb0b0', strokeThickness: 2 }));
      }
    }

    // probabilidades actuales (toca una rareza para ver qué premios tiene)
    const hd = this.add.graphics();
    hd.lineStyle(1, 0xffd36b, 0.55).lineBetween(cx - 98, 351, cx - 42, 351).lineBetween(cx + 42, 351, cx + 98, 351);
    hd.fillStyle(0xffd36b).fillRect(cx - 41, 349.5, 3, 3).fillRect(cx + 38, 349.5, 3, 3);
    hd.fillStyle(0xffd36b, 0.6).fillRect(cx - 99, 349.5, 2, 3).fillRect(cx + 97, 349.5, 2, 3);
    this.content.add(hd);
    this.content.add(label(this, cx, 351, 'PROBABILIDADES', 8, { color: PAL.sand, strokeThickness: 2 }));
    RARITY_ORDER.forEach((rarity, i) => {
      const o = odds[rarity];
      const R = RARITIES[rarity];
      const color = hex(R.color);
      const done = o.left === 0;
      const got = o.total ? (o.total - o.left) / o.total : 1;
      const card = this.add.container(cx + (i - 1.5) * 51, 378.5);
      // la legendaria sin completar tiene un halo suave que late
      if (rarity === 'legendary' && !done) {
        const gl = this.add.image(0, 0, 'glow').setTint(color).setBlendMode('ADD').setScale(0.75).setAlpha(0.28);
        card.add(gl);
        this.tweens.add({ targets: gl, alpha: 0.1, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      const g = this.add.graphics();
      // cuerpo oscuro con borde de la rareza (dorado si está completa) y franja de color arriba con su nombre
      g.fillStyle(0x35282c).fillRoundedRect(-23, -19, 46, 38, 4);
      g.fillStyle(0x1d1520, 0.96).fillRoundedRect(-22, -18, 44, 36, 3);
      g.fillStyle(color, done ? 0.12 : 0.2).fillRoundedRect(-22, -18, 44, 36, 3);
      g.fillStyle(color, done ? 0.55 : 0.95).fillRoundedRect(-22, -18, 44, 11, { tl: 3, tr: 3, bl: 0, br: 0 });
      g.fillStyle(0xffffff, 0.22).fillRect(-20, -17, 40, 2);
      g.lineStyle(1, done ? 0xffd36b : color, done ? 1 : 0.9).strokeRoundedRect(-22.5, -18.5, 45, 37, 3.5);
      // barra de lo conseguido de esta rareza
      g.fillStyle(0x0f0a14).fillRoundedRect(-17, 12, 34, 4, 2);
      if (got > 0) {
        g.fillStyle(color).fillRoundedRect(-17, 12, Math.max(3, 34 * got), 4, 2);
        g.fillStyle(0xffffff, 0.35).fillRect(-16, 12.5, Math.max(0, 34 * got - 2), 1);
      }
      card.add(g);
      card.add(label(this, 0, -12.5, R.name, 6, { color: '#2a1c20', stroke: false, shadow: false }));
      card.add(label(this, 0, -1, done ? 'OK' : `${percentage(o.chance)}%`, 11, { color: R.color, strokeThickness: 2 }));
      card.add(label(this, 0, 8, done ? 'Completa' : `${o.total - o.left}/${o.total}`, 6, { color: done ? '#ffd36b' : CREAM, strokeThickness: 1 }));
      card.setSize(46, 38).setInteractive({ useHandCursor: true });
      card.on('pointerover', () => this.tweens.add({ targets: card, scale: 1.06, duration: 90 }));
      card.on('pointerout', () => this.tweens.add({ targets: card, scale: 1, duration: 90 }));
      card.on('pointerup', () => {
        if (this.busy) return;
        sfx.click();
        this.showRarityList(rarity);
      });
      // entran una a una
      card.setScale(0.8).setAlpha(0);
      this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 220, delay: 250 + i * 70, ease: 'Back.easeOut' });
      this.content.add(card);
    });
    this.content.add(label(this, cx, 405.5, 'Sin repetidos · las probabilidades cambian con tu colección', 6, { color: CREAM }));
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
    if (p.kind === 'aura') {
      const c = this.add.container(x, y);
      this.auraPreview(c, auraById(p.id), 0.8, 0, 0);
      return c;
    }
    const k = p.kind === 'ball' ? ballScale(ballTypeById(p.id)) : 1;
    const s = this.add.sprite(x, y, `ball-${p.kind === 'skin' ? p.id : progress.skin}`, 0).setScale(1.8 * k);
    this.spinBall(s);
    return s;
  }

  /** Anillos de luz que se expanden desde un punto (explosión al abrir una cápsula; más anillos cuanto más rara) */
  ringBurst(x: number, y: number, color: number, n = 3, depth = 58) {
    for (let i = 0; i < n; i++) {
      const g = this.add.graphics().setDepth(depth);
      const o = { r: 6, a: 0.9 };
      this.tweens.add({
        targets: o, r: 64 + i * 26, a: 0, duration: 650 + i * 120, delay: i * 110, ease: 'Cubic.easeOut',
        onUpdate: () => g.clear().lineStyle(Math.max(1, 3 - i * 0.6), color, o.a).strokeCircle(x, y, o.r),
        onComplete: () => g.destroy(),
      });
    }
  }

  /** Una ficha vuela desde la cartera hasta la ranura de la máquina (en curva y dando vueltas) */
  insertToken(i: number, onDone?: () => void) {
    const slot = { x: W / 2 - 9, y: GACHA_MACHINE_Y + 79 };
    const from = { x: W - 54, y: 22 };
    const mid = { x: (from.x + slot.x) / 2 + 24, y: 14 };
    const t = this.add.image(from.x, from.y, 'token').setDepth(60).setScale(1.2);
    const o = { p: 0 };
    this.tweens.add({
      targets: o, p: 1, duration: 430, delay: i * 110, ease: 'Sine.easeIn',
      onUpdate: () => {
        const p = o.p;
        const q = 1 - p;
        t.setPosition(q * q * from.x + 2 * q * p * mid.x + p * p * slot.x, q * q * from.y + 2 * q * p * mid.y + p * p * slot.y)
          .setAngle(p * 540).setScale(1.2 - p * 0.55);
      },
      onComplete: () => {
        t.destroy();
        sfx.coin();
        this.sparks.explode(5, slot.x, slot.y);
        onDone?.();
      },
    });
  }

  /**
   * Tirada: entran las fichas, la manivela gira, las cápsulas dan vueltas dentro de la bola, la máquina tiembla,
   * una cápsula de la rareza que ha salido baja por la boca y se abre. Con ×10 se enseñan todos los premios juntos.
   */
  pullMany(count: number, machine: Phaser.GameObjects.Container, knob: Phaser.GameObjects.Container, caps: Capsule[], lights: Phaser.Tweens.Tween) {
    if (this.busy) return;
    const n = Math.min(count, Math.floor(progress.tokens / GACHA.cost), progress.remainingPrizes().length);
    if (n < 1 || (count > 1 && n < count)) {
      sfx.denied();
      this.tweens.add({ targets: this.content, x: 3, duration: 40, yoyo: true, repeat: 2 });
      return;
    }
    this.busy = true;
    const coins = Math.min(3, n);
    for (let i = 0; i < coins; i++) {
      this.insertToken(i, i === coins - 1 ? () => this.spin(n, machine, knob, caps, lights) : undefined);
    }
  }

  spin(n: number, machine: Phaser.GameObjects.Container, knob: Phaser.GameObjects.Container, caps: Capsule[], lights: Phaser.Tweens.Tween) {
    const prizes: Prize[] = [];
    for (let i = 0; i < n; i++) {
      const p = progress.pull();
      if (p) prizes.push(p);
    }
    if (!prizes.length) {
      this.busy = false;
      return;
    }
    // de menos a más rara: el mejor premio sale el último
    prizes.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
    const best = prizes[prizes.length - 1];
    const color = hex(RARITIES[best.rarity].color);
    this.updateWallet();
    const cx = W / 2;
    const gy = GACHA_MACHINE_Y;
    const dur = 1000 + Math.min(n, 10) * 70;

    sfx.click();
    lights.timeScale = 4;
    this.tweens.killTweensOf(knob);
    this.tweens.add({ targets: knob, angle: knob.angle + 720 + n * 36, duration: dur, ease: 'Cubic.easeInOut' });
    this.tweens.add({ targets: machine, x: { from: -2, to: 2 }, duration: 45, yoyo: true, repeat: Math.round(dur / 90), onComplete: () => machine.setX(0) });
    // remolino de cápsulas
    for (const k of caps) this.tweens.killTweensOf(k.c);
    this.tweens.addCounter({
      from: 0, to: 1, duration: dur, ease: 'Sine.easeInOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        for (const k of caps) {
          if (!k.c.active) continue;
          const a = k.a + t * Math.PI * 4;
          const r = k.r * (1 - Math.sin(t * Math.PI) * 0.35);
          k.c.setPosition(cx + Math.cos(a) * r, gy + Math.sin(a) * r).setAngle(k.ang + t * 720);
        }
      },
    });
    [0.2, 0.4, 0.6, 0.8].forEach((f, i) => this.time.delayedCall(dur * f, () => sfx.charge(Math.min(3, i + 1))));

    // la cápsula del premio se va hacia la boca de la máquina
    const pick = caps.find((k) => k.rarity === best.rarity);
    this.time.delayedCall(dur, () => {
      if (pick?.c.active) this.tweens.add({ targets: pick.c, x: cx + 30, y: gy + 62, scale: 0.3, alpha: 0, duration: 200, ease: 'Quad.easeIn' });
    });

    const cap = this.add.container(cx + 31, gy + 96).setDepth(60).setScale(0.6).setAlpha(0);
    const top = this.add.image(0, -5, 'capsule-top').setTint(color);
    const bot = this.add.image(0, 5, 'capsule-bottom');
    cap.add([top, bot]);
    this.time.delayedCall(dur + 200, () => {
      cap.setAlpha(1);
      if (this.gachaFlap?.active) this.tweens.add({ targets: this.gachaFlap, scaleY: 0.15, duration: 110, yoyo: true, hold: 520 });
      sfx.land(300);
      this.tweens.add({
        targets: cap, y: gy + 106, duration: 220, ease: 'Bounce.easeOut',
        onComplete: () => this.reveal(cap, top, bot, prizes, color),
      });
    });
  }

  /** La cápsula sube al centro y tiembla: cuanto más rara, más tiempo, más luz y más fuerte */
  reveal(cap: Phaser.GameObjects.Container, top: Phaser.GameObjects.Image, bot: Phaser.GameObjects.Image, prizes: Prize[], color: number) {
    const cx = W / 2;
    const cy = 190;
    const best = prizes[prizes.length - 1];
    const tier = RARITY_ORDER.indexOf(best.rarity); // 0 común … 3 legendaria
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
            this.ringBurst(cx, cy, color, 1 + tier);
            if (tier >= 1) this.cameras.main.flash(120 + tier * 60, 255, 255, 255);
            if (tier === 3) this.shake(250, 0.008);
            this.tweens.add({ targets: top, y: -26, angle: -25, alpha: 0, duration: 400, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: bot, y: 24, angle: 15, alpha: 0, duration: 400, ease: 'Quad.easeOut' });
            this.tweens.add({ targets: glow, alpha: 0, duration: 400, onComplete: () => glow.destroy() });
            if (prizes.length === 1) this.showPrize(prizes[0], color, blocker, cap);
            else this.showResults(prizes, color, blocker, cap);
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
    // franja del color de la rareza en la parte de arriba
    const band = this.add.graphics().setDepth(56);
    band.fillStyle(color, 0.2).fillRoundedRect(cx - 104, cy - 100, 208, 46, 6);
    band.fillStyle(0xffffff, 0.08).fillRoundedRect(cx - 104, cy - 100, 208, 10, 6);
    items.push(band);
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

    let shown: Phaser.GameObjects.Graphics | Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
    let size = 2.6;
    if (prize.kind === 'trail') {
      shown = this.trailPreview(trailById(prize.id), 0, 0, 30).setPosition(cx, cy).setDepth(57);
    } else if (prize.kind === 'aura') {
      shown = this.add.container(cx, cy).setDepth(57);
      this.auraPreview(shown, auraById(prize.id), 1, 0, 0);
      size = 3.2;
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

    // título, estrellas de rareza (1 a 4) y cinta con el nombre
    const t3 = label(this, cx, cy - 76, tier >= 2 ? `¡${r.name.toUpperCase()}!` : '¡NUEVO!', 18, { color: tier >= 2 ? r.color : PAL.sand, strokeThickness: 4 }).setDepth(57);
    this.tweens.add({ targets: t3, scale: { from: 0, to: 1 }, duration: 350, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t3, scale: 1.12, duration: 420, yoyo: true, repeat: -1, delay: 350 });
    for (let i = 0; i <= tier; i++) {
      const st = this.add.image(cx + (i - tier / 2) * 14, cy - 56, 'star-sm').setTint(color).setDepth(57).setScale(0);
      this.tweens.add({ targets: st, scale: 1.3, duration: 260, delay: 450 + i * 130, ease: 'Back.easeOut', onStart: () => sfx.coin() });
      items.push(st);
    }
    const ribbon = this.add.graphics().setDepth(56);
    ribbon.fillStyle(0x35282c, 0.95).fillRoundedRect(cx - 98, cy + 43, 196, 26, 6);
    ribbon.fillStyle(color, 0.32).fillRoundedRect(cx - 96, cy + 45, 192, 22, 5);
    items.push(ribbon);
    const t1 = label(this, cx, cy + 56, prize.name, 18, { color: '#ffffff' }).setDepth(57);
    const t2 = label(this, cx, cy + 76, `${KIND_NAMES[prize.kind]} · ${r.name}`, 10, { color: r.color }).setDepth(57);
    items.push(t1, t2, t3);
    const { have, total } = progress.gachaCollected();
    const sub = prize.kind === 'ball' ? ballTypeById(prize.id).desc : `Colección ${have}/${total}`;
    items.push(label(this, cx, cy + 92, sub, 8, { color: CREAM, strokeThickness: 2, wrap: 196 }).setDepth(57));
    // barra de colección
    const pg = this.add.graphics().setDepth(57);
    pg.fillStyle(0x1a1020).fillRoundedRect(cx - 61, cy + 100, 122, 6, 2);
    pg.fillStyle(color).fillRoundedRect(cx - 60, cy + 101, Math.max(3, (120 * have) / total), 4, 1);
    items.push(pg);

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

  /** Resultado de una tirada múltiple: todos los premios en una cuadrícula, de menos a más raro, y el mejor el último */
  showResults(prizes: Prize[], color: number, blocker: Phaser.GameObjects.Rectangle, cap: Phaser.GameObjects.Container) {
    const cx = W / 2;
    const cy = H / 2;
    const cols = 5;
    const rows = Math.ceil(prizes.length / cols);
    const h = 104 + rows * 54;
    const best = prizes[prizes.length - 1];
    const R = RARITIES[best.rarity];
    const tier = RARITY_ORDER.indexOf(best.rarity);
    const items: Phaser.GameObjects.GameObject[] = [blocker, cap];
    const top = cy - h / 2;
    items.push(panel(this, cx, cy, 224, h, 'panel9').setDepth(56));
    const band = this.add.graphics().setDepth(56);
    band.fillStyle(color, 0.2).fillRoundedRect(cx - 106, top + 6, 212, 44, 6);
    items.push(band);
    const glow = this.add.image(cx, top + 22, 'glow').setTint(color).setBlendMode('ADD').setScale(1.6, 0.7).setAlpha(0.45).setDepth(56);
    this.tweens.add({ targets: glow, alpha: 0.2, duration: 800, yoyo: true, repeat: -1 });
    items.push(glow);
    const title = label(this, cx, top + 22, `¡${prizes.length} PREMIOS!`, 16, { color: PAL.sand, strokeThickness: 4 }).setDepth(57);
    this.tweens.add({ targets: title, scale: { from: 0, to: 1 }, duration: 350, ease: 'Back.easeOut' });
    const sub = label(this, cx, top + 40, `Mejor: ${best.name} · ${R.name}`, 8, { color: R.color, strokeThickness: 2 }).setDepth(57);
    items.push(title, sub);

    prizes.forEach((p, i) => {
      const inRow = Math.min(cols, prizes.length - Math.floor(i / cols) * cols);
      const x = cx + ((i % cols) - (inRow - 1) / 2) * 40;
      const y = top + 80 + Math.floor(i / cols) * 54;
      const rc = hex(RARITIES[p.rarity].color);
      const pt = RARITY_ORDER.indexOf(p.rarity);
      const cell = this.add.container(x, y).setDepth(57).setScale(0).setAlpha(0);
      cell.add(this.add.nineslice(0, 0, 'btn9-white', 0, 36, 46, 5, 5, 5, 7));
      cell.add(this.add.rectangle(0, 17, 26, 3, rc));
      if (pt >= 2) cell.add(this.add.image(0, -2, 'glow').setTint(rc).setBlendMode('ADD').setScale(0.45).setAlpha(0.5));
      cell.add(this.prizeIcon(p, 0, -6));
      cell.add(label(this, 0, 10, p.name, 5, { color: '#35282c', stroke: false, shadow: false }));
      items.push(cell);
      this.tweens.add({
        targets: cell, scale: 1, alpha: 1, duration: 260, delay: 350 + i * 130, ease: 'Back.easeOut',
        onStart: () => {
          sfx.star(Math.min(4, Math.floor((i / prizes.length) * 5)));
          this.sparks.explode(4 + pt * 3, x, y);
          if (pt >= 2) this.ringBurst(x, y, rc, 1, 58);
        },
      });
    });
    // al final, el broche: luz y temblor según el mejor premio
    this.time.delayedCall(350 + prizes.length * 130 + 150, () => {
      if (tier >= 1) this.cameras.main.flash(100 + tier * 50, 255, 255, 255);
      if (tier === 3) this.shake(220, 0.007);
    });

    const close = () => {
      for (const o of items) o.destroy();
      this.busy = false;
      this.show('gacha');
    };
    items.push(makeButton(this, cx, top + h - 22, { color: 'green', w: 100, h: 26, text: 'Seguir', size: 12, onClick: close }).setDepth(57));
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
