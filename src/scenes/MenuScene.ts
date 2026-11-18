import { transitionTo } from './TransitionScene';
import Phaser from 'phaser';
import { W, H, PAL, GAME_VERSION } from '../constants';
import { openSettings, type SettingsPanel } from '../ui/settings';
import { applyLook } from '../ui/looks';
import { LEVELS } from '../data/levels';
import { UPGRADES } from '../data/upgrades';
import { progress } from '../systems/progress';
import { sfx, music } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { label, gradientFill, makeButton, iconButton, panel } from '../ui/widgets';
import { isSupabaseEnabled } from '../services/supabase';

/**
 * Pantalla inicial. Lo que se ve detrás NO es un fondo dibujado: es una partida de verdad (DemoScene) con un hoyo
 * aleatorio que juega sola una IA, y que va cambiando de mundo (Pradera, Playa, Pantano…). Este menú se pinta encima.
 */
export default class MenuScene extends Phaser.Scene {
  resetPanel: Phaser.GameObjects.Container | null = null;
  settingsPanel: SettingsPanel | null = null;
  /** cartelito con el nombre del mundo que se está viendo de fondo */
  worldTag!: Phaser.GameObjects.Text;

  constructor() {
    super('Menu');
  }

  create() {
    fitCamera(this);
    const next = progress.nextLevelIndex();
    const nextLevel = LEVELS[next];

    // Partida de fondo: empieza en el mundo de tu siguiente hoyo y luego va pasando por los demás
    this.scene.stop('Demo');
    this.scene.launch('Demo', { theme: nextLevel.theme });
    const onDemoHole = (info: { worldName: string }) => this.showWorld(info.worldName);
    this.game.events.on('demo-hole', onDemoHole);

    // degradados arriba y abajo: el logo y los botones se leen sobre cualquier fondo
    // (con Graphics y no con una textura escalada: el borde de una textura estirada dejaba una línea fina visible)
    const INK = 0x0e122c;
    this.add.graphics().setDepth(-5)
      .fillGradientStyle(INK, INK, INK, INK, 0.78, 0.78, 0, 0).fillRect(0, 0, W, 178)
      .fillGradientStyle(INK, INK, INK, INK, 0, 0, 0.8, 0.8).fillRect(0, H - 150, W, 150);

    // Logo, con un halo que respira y destellos
    const glow = this.add.image(W / 2, 80, 'glow').setTint(0xb8ec6a).setBlendMode('ADD').setScale(3.4, 1.7).setAlpha(0.28);
    this.tweens.add({ targets: glow, alpha: 0.14, scaleX: 3.9, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const t1 = label(this, W / 2, 52, 'VERTICAL', 26, { strokeThickness: 5, shadowY: 3 });
    const t2 = label(this, W / 2, 90, 'GOLF', 56, { strokeThickness: 7, shadowY: 4, stroke: '#2c5a35' });
    gradientFill(t1, [[0.2, '#ffffff'], [0.9, '#ffe8c8']]);
    gradientFill(t2, [[0.15, '#e8ff9a'], [0.55, '#86d35a'], [0.95, '#3c9a46']]);
    this.tweens.add({ targets: [t1, t2], y: '-=3', duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    label(this, W / 2, 128, 'Golpea, rebota y sube hasta el hoyo', 10);
    this.time.addEvent({
      delay: 650,
      loop: true,
      callback: () => {
        const s = this.add.image(Phaser.Math.Between(40, W - 40), Phaser.Math.Between(40, 112), 'star-px').setAlpha(0).setScale(0.4).setTint(0xfff6c8);
        this.tweens.add({
          targets: s, alpha: 1, scale: Phaser.Math.FloatBetween(1, 1.8), angle: 45, duration: 260, yoyo: true,
          onComplete: () => s.destroy(),
        });
      },
    });

    // nombre del mundo que se ve de fondo
    panel(this, W / 2, 281, 112, 15, 'hud9').setAlpha(0.8);
    this.worldTag = label(this, W / 2, 281, '', 8, { color: PAL.sand, strokeThickness: 2 });

    // Botones
    panel(this, W / 2, 351, 206, 118, 'panel9').setAlpha(0.95);
    label(this, W / 2, 302, 'SIGUIENTE PARTIDA', 8, { color: '#f0dcc0', strokeThickness: 2 });
    const play = makeButton(this, W / 2, 326, { color: 'green', w: 144, h: 32, text: 'JUGAR', size: 18, onClick: () => this.go('Game', { levelIndex: next }) });
    this.tweens.add({ targets: play, scale: 1.04, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    panel(this, W / 2, 350, 178, 15, 'field9');
    label(this, W / 2, 350, `${nextLevel.worldName} · Hoyo ${nextLevel.number} · ${nextLevel.name}`, 8, { color: PAL.sand });
    makeButton(this, W / 2 - 45, 378, { color: 'gold', w: 86, h: 26, text: 'MUNDOS', size: 12, onClick: () => this.go('Worlds') });
    const shop = makeButton(this, W / 2 + 45, 378, { color: 'blue', w: 86, h: 26, text: '   TIENDA', size: 12, onClick: () => this.go('Shop', { back: 'Menu' }) });
    shop.add(this.add.image(-28, -2, 'up-power'));
    // aviso si hay alguna mejora o bola que ya puedes comprar
    const canBuy = UPGRADES.some((u) => (progress.nextCost(u.id) ?? Infinity) <= progress.coins) || progress.canPull();
    if (canBuy) {
      const badge = label(this, W / 2 + 85, 367, '!', 10, { color: '#ffffff', stroke: '#ef4d5e', strokeThickness: 4 });
      this.tweens.add({ targets: badge, scale: 1.3, duration: 400, yoyo: true, repeat: -1 });
    }

    panel(this, 84, 14, 160, 20, 'hud9');
    this.add.image(12, 14, 'star-sm');
    label(this, 20, 14, `${progress.totalStars()}/${LEVELS.length * 3}`, 8, { ox: 0 });
    this.add.rectangle(56, 14, 1, 13, 0xc8bfb4, 0.6);
    this.add.image(63, 14, 'coin');
    label(this, 71, 14, `${progress.coins}`, 8, { ox: 0, color: PAL.sand });
    this.add.rectangle(108, 14, 1, 13, 0xc8bfb4, 0.6);
    this.add.image(115, 14, 'token');
    label(this, 123, 14, `${progress.tokens}`, 8, { ox: 0, color: '#d8b8ff' });

    // Ajustes (música, efectos, vibración, temblor)
    this.settingsPanel = null;
    const openPanel = () => {
      if (this.settingsPanel) return;
      this.settingsPanel = openSettings(this, {
        onClose: () => (this.settingsPanel = null),
        // el modo DEV y borrar la partida viven en los ajustes
        extras: { onDevChange: () => this.scene.restart(), onReset: () => this.confirmReset() },
      });
    };
    iconButton(this, W - 16, 14, 'gear', openPanel);
    if (progress.devMode) label(this, W - 38, 14, 'DEV', 8, { color: PAL.orange, weight: '700', strokeThickness: 2 });

    this.resetPanel = null;
    // estilo de imagen elegido en los ajustes (se ve al momento en el menú; la partida de fondo lo aplica ella misma)
    applyLook(this.cameras.main);
    const offLook = progress.onSettingsChange((key) => {
      if (key === 'look') applyLook(this.cameras.main);
    });
    this.events.once('shutdown', () => {
      offLook();
      this.game.events.off('demo-hole', onDemoHole);
      this.scene.stop('Demo');
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.resetPanel) this.closeReset();
      else this.settingsPanel?.close();
    });
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (!this.settingsPanel && !this.resetPanel) this.go('Game', { levelIndex: next });
    });
    music.play('menu');
    music.setPaused(false);

    label(this, W / 2, H - 9, isSupabaseEnabled ? '● online' : '○ offline', 8, { color: '#f0dcc0', strokeThickness: 2 }).setDepth(20);
    // versión del juego, abajo a la izquierda
    label(this, 6, H - 9, `v${GAME_VERSION}`, 8, { color: '#f0dcc0', strokeThickness: 2, ox: 0 }).setDepth(20);
  }

  /** Cambia el cartelito del mundo que se ve de fondo (con un pequeño fundido) */
  showWorld(name: string) {
    if (!this.worldTag?.active) return;
    this.tweens.killTweensOf(this.worldTag);
    this.worldTag.setText(name.toUpperCase()).setAlpha(0);
    this.tweens.add({ targets: this.worldTag, alpha: 1, duration: 500, delay: 300 });
  }

  /** Ventana de confirmación: borra todo el progreso y reinicia el menú */
  confirmReset() {
    if (this.resetPanel) return;
    sfx.click();
    const c = this.add.container(W / 2, H / 2).setDepth(95);
    const blocker = this.add.rectangle(0, 0, W, H, 0x35282c, 0.7).setInteractive();
    blocker.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => e?.stopPropagation?.());
    c.add([
      blocker,
      panel(this, 0, 0, 200, 132),
      label(this, 0, -46, '¿BORRAR PARTIDA?', 14, { weight: '700', color: '#ff9a8a', strokeThickness: 3 }),
      label(this, 0, -18, 'Se borrarán hoyos, estrellas, monedas, mejoras y bolas. No se puede deshacer.', 8, { wrap: 170, color: '#fff8ec', strokeThickness: 2 }),
      makeButton(this, -46, 34, { color: 'white', w: 78, h: 26, text: 'CANCELAR', size: 10, onClick: () => this.closeReset() }),
      makeButton(this, 46, 34, {
        color: 'orange', w: 78, h: 26, text: 'BORRAR', size: 11,
        onClick: () => {
          progress.resetAll();
          sfx.hazard();
          this.closeReset();
          this.scene.restart();
        },
      }),
    ]);
    c.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.resetPanel = c;
  }

  closeReset() {
    this.resetPanel?.destroy();
    this.resetPanel = null;
  }

  go(key: string, data?: object) {
    sfx.whoosh();
    transitionTo(this, () => this.scene.start(key, data));
  }
}
