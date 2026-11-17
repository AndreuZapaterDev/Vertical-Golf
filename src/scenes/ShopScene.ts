import Phaser from 'phaser';
import { W, H, PAL } from '../constants';
import { Background } from '../gfx/background';
import { UPGRADES, SKINS } from '../data/upgrades';
import { progress } from '../systems/progress';
import { sfx } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, makeButton, iconButton, panel } from '../ui/widgets';
import { transitionTo } from './TransitionScene';

const CREAM = '#f0dcc0';

/** Tienda: mejoras de la cuenta (habilidades) y bolas */
type Tab = 'upgrades' | 'skins';

export default class ShopScene extends Phaser.Scene {
  back = 'Menu';
  tab: Tab = 'upgrades';
  bg!: Background;
  coinText!: Phaser.GameObjects.Text;
  tabs!: Record<Tab, Phaser.GameObjects.Container>;
  content!: Phaser.GameObjects.Container;
  sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('Shop');
  }

  init(data?: { back?: string; tab?: Tab }) {
    this.back = data?.back || 'Menu';
    this.tab = data?.tab || 'upgrades';
  }

  create() {
    fitCamera(this);
    this.bg = new Background(this, 'sunset');

    label(this, W / 2, 22, 'MEJORAS', 22, { color: PAL.sand, strokeThickness: 4 });
    iconButton(this, 16, 22, 'back', () => transitionTo(this, () => this.scene.start(this.back)));

    // monedas
    panel(this, W - 34, 22, 56, 20, 'hud9');
    this.add.image(W - 54, 22, 'coin');
    this.coinText = label(this, W - 45, 22, String(progress.coins), 11, { ox: 0, color: PAL.sand });

    // pestañas
    this.tabs = {
      upgrades: makeButton(this, W / 2 - 52, 50, { color: 'gold', w: 98, h: 22, text: 'Habilidades', size: 11, onClick: () => this.show('upgrades') }),
      skins: makeButton(this, W / 2 + 52, 50, { color: 'gold', w: 98, h: 22, text: 'Bolas', size: 11, onClick: () => this.show('skins') }),
    };

    this.content = this.add.container(0, 0);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(50);
    this.show(this.tab);
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const [k, b] of Object.entries(this.tabs)) b.setAlpha(k === tab ? 1 : 0.55);
    this.content.removeAll(true);
    this.coinText.setText(String(progress.coins));
    if (tab === 'upgrades') this.buildUpgrades();
    else this.buildSkins();
  }

  flash(x: number, y: number) {
    this.sparks.explode(12, x, y);
    this.tweens.add({ targets: this.coinText, scale: { from: 1.4, to: 1 }, duration: 250, ease: 'Back.easeOut' });
  }

  buildUpgrades() {
    const top = 72;
    const rowH = 48;
    UPGRADES.forEach((u, i) => {
      const y = top + 22 + i * rowH;
      const lvl = progress.upgradeLevel(u.id);
      const max = u.costs.length;
      const cost = progress.nextCost(u.id);
      const afford = cost != null && progress.coins >= cost;

      const on = progress.isUpgradeOn(u.id);
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
      card.add(label(this, -82 + max * 10 + 3, 13, on ? u.fmt(u.values[lvl]) : 'Apagada', 7, { ox: 0, color: on ? '#ffffff' : '#c8bfb4', strokeThickness: 2 }));

      // interruptor: solo para las mejoras ya compradas
      if (lvl > 0) {
        card.add(makeButton(this, 38, 12, {
          color: on ? 'green' : 'gray', w: 30, h: 14, text: on ? 'ON' : 'OFF', size: 7,
          onClick: () => {
            progress.toggleUpgrade(u.id);
            sfx.click();
            this.show('upgrades');
          },
        }));
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

  buildSkins() {
    const xs = [48, 120, 192];
    SKINS.forEach((s, i) => {
      const x = xs[i % 3];
      const y = 120 + Math.floor(i / 3) * 128;
      const owned = progress.ownsSkin(s.id);
      const equipped = progress.skin === s.id;
      const c = this.add.container(x, y);
      c.add(panel(this, 0, 0, 66, 112, 'hud9'));
      if (equipped) {
        const glow = this.add.image(0, -22, 'glow').setTint(0xffd36b).setBlendMode('ADD').setScale(0.9).setAlpha(0.5);
        c.add(glow);
        this.tweens.add({ targets: glow, alpha: 0.2, duration: 700, yoyo: true, repeat: -1 });
      }
      const ball = this.add.sprite(0, -22, `ball-${s.id}`, 0).setScale(3);
      c.add(ball);
      this.tweens.addCounter({
        from: 0, to: 4, duration: 900, repeat: -1,
        onUpdate: (t) => {
          if (ball.active) ball.setFrame(Math.floor(t.getValue() ?? 0) % 4);
        },
      });
      c.add(label(this, 0, 14, s.name, 11, { color: equipped ? PAL.sand : '#ffffff' }));

      let btn: Phaser.GameObjects.Container;
      if (equipped) btn = makeButton(this, 0, 38, { color: 'gold', w: 56, h: 22, text: 'Usando', size: 10 });
      else if (owned) {
        btn = makeButton(this, 0, 38, { color: 'blue', w: 56, h: 22, text: 'Usar', size: 10, onClick: () => {
          progress.equipSkin(s.id);
          sfx.click();
          this.show('skins');
        } });
      } else {
        const afford = progress.coins >= s.cost;
        btn = makeButton(this, 0, 38, { color: afford ? 'green' : 'gray', w: 56, h: 22, text: `${s.cost}`, size: 10, onClick: () => {
          if (progress.buySkin(s.id)) {
            sfx.buy();
            this.show('skins');
            this.flash(x, y - 22);
          } else {
            sfx.denied();
            this.tweens.add({ targets: c, x: x + 3, duration: 40, yoyo: true, repeat: 2 });
          }
        } });
        btn.add(this.add.image(-14, -2, 'coin'));
        (btn.list[1] as Phaser.GameObjects.Text).x = 5;
      }
      c.add(btn);
      c.setScale(0.8).setAlpha(0);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 220, delay: i * 50, ease: 'Back.easeOut' });
      this.content.add(c);
    });
    this.content.add(label(this, W / 2, 380, 'Cada bola deja una estela de su color', 9, { color: CREAM, strokeThickness: 2 }));
  }

  update(_: number, delta: number) {
    this.bg.update(delta / 1000);
  }
}
