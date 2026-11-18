import Phaser from 'phaser';
import { W, H, PAL, hex, THEMES, type ThemeKey } from '../constants';
import { MECHANICS } from '../data/levels';
import { progress } from '../systems/progress';
import { sfx, music } from '../systems/audio';
import { fitCamera } from '../ui/camera';
import { bakeTexture, roundRectPath } from '../gfx/bake';
import { label, makeButton, iconButton, panel, stopEvent } from '../ui/widgets';
import { openSettings, type SettingsPanel } from '../ui/settings';
import type GameScene from './GameScene';
import type { HudState, CompleteInfo, ToastOpts } from './GameScene';

function scoreName(strokes: number, par: number) {
  if (strokes === 1) return '¡HOYO EN UNO!';
  const d = strokes - par;
  if (d <= -3) return '¡ALBATROS!';
  if (d === -2) return '¡EAGLE!';
  if (d === -1) return '¡BIRDIE!';
  if (d === 0) return '¡PAR!';
  if (d === 1) return 'BOGEY';
  if (d === 2) return 'DOBLE BOGEY';
  return `+${d}`;
}

/** HUD y ventanas superpuestas. Se comunica con GameScene a través de un EventEmitter (bus). */
export default class UIScene extends Phaser.Scene {
  bus!: Phaser.Events.EventEmitter;
  gs!: GameScene;
  info!: HudState;
  toast: Phaser.GameObjects.Container | null = null;
  paused = false;
  pauseMenu: Phaser.GameObjects.Container | null = null;
  settingsPanel: SettingsPanel | null = null;
  /** qué hace ENTER en la ventana de fin de hoyo */
  completeAction: (() => void) | null = null;
  tutorial: Phaser.GameObjects.GameObject[] | null = null;
  introCard: Phaser.GameObjects.Container | null = null;
  onHidden!: () => void;

  strokesText!: Phaser.GameObjects.Text;
  windGauge!: Phaser.GameObjects.Container;
  windTxt!: Phaser.GameObjects.Text;
  windChev: Phaser.GameObjects.Text[] = [];
  windParticles: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  shieldIcon?: Phaser.GameObjects.Image;
  shieldText?: Phaser.GameObjects.Text;
  brakeBtn?: Phaser.GameObjects.Container;
  brakeText?: Phaser.GameObjects.Text;
  brakeHint?: Phaser.GameObjects.Text;
  barTop = 0;
  barBot = 0;
  barX = 0;
  barFill!: Phaser.GameObjects.Image;
  barBall!: Phaser.GameObjects.Sprite;

  constructor() {
    super('UI');
  }

  init(data: { bus: Phaser.Events.EventEmitter; gameScene: GameScene }) {
    this.bus = data.bus;
    this.gs = data.gameScene;
    this.info = this.gs.getHudState();
    this.toast = null;
    this.paused = false;
    this.pauseMenu = null;
    this.settingsPanel = null;
    this.completeAction = null;
    this.tutorial = null;
    this.introCard = null;
    this.shieldIcon = undefined;
    this.brakeBtn = undefined;
  }

  create() {
    fitCamera(this);
    const I = this.info;

    this.add.image(W / 2, H / 2, 'vignette').setDisplaySize(W, H).setAlpha(0.55);
    this.ambientFx(I.theme);

    // HUD superior
    panel(this, 30, 15, 54, 24, 'hud9');
    label(this, 30, 10, `HOYO ${I.hole}`, 10, { weight: '700' });
    label(this, 30, 21, `PAR ${I.par}`, 8, { color: '#f0dcc0', strokeThickness: 2 });

    panel(this, W / 2, 16, 52, 28, 'hud9');
    this.strokesText = label(this, W / 2, 12, '0', 18, { weight: '700', color: PAL.sand });
    label(this, W / 2, 25, 'GOLPES', 7, { color: '#f0dcc0', strokeThickness: 2 });

    iconButton(this, W - 13, 15, 'pause', () => this.pause());
    iconButton(this, W - 33, 15, 'restart', () => this.gs.restartLevel());


    // indicador de viento: cambia si el hoyo tiene bandas de viento distintas según la altura
    this.buildWindGauge();
    this.setWind(I.wind);
    this.bus.on('wind', (w: number) => this.setWind(w, true), this);

    this.buildProgressBar();
    this.buildAbilities(I);

    this.sparks =this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: { min: 30, max: 90 }, angle: { min: 0, max: 360 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
    }).setDepth(60);

    this.bus.on('hud', this.onHud, this);
    this.bus.on('progress', this.onProgress, this);
    this.bus.on('play', this.onPlay, this);
    this.bus.on('shot', this.onShot, this);
    this.bus.on('toast', this.showToast, this);
    this.bus.on('complete', this.showComplete, this);
    this.bus.on('brake', this.onBrake, this);
    this.bus.on('shield', this.onShield, this);

    this.setupKeys();
    // Si cambias de pestaña o bloqueas el móvil, el juego queda en pausa
    this.onHidden = () => this.pause();
    this.game.events.on('hidden', this.onHidden);
    this.events.once('shutdown', () => {
      this.game.events.off('hidden', this.onHidden);
      music.setPaused(false);
    });

    this.showIntroCard();
  }

  // ---------------------------------------------------------------- Pausa y teclado

  setupKeys() {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-ESC', () => {
      if (this.settingsPanel) this.settingsPanel.close();
      else if (this.paused) this.resume();
      else if (this.gs.aiming) this.gs.cancelAim();
      else this.pause();
    });
    kb.on('keydown-P', () => {
      if (this.settingsPanel) return;
      if (this.paused) this.resume();
      else this.pause();
    });
    kb.on('keydown-ENTER', () => {
      if (this.completeAction) {
        const go = this.completeAction;
        this.completeAction = null;
        sfx.click();
        go();
      } else if (this.paused && !this.settingsPanel) this.resume();
    });
  }

  pause() {
    if (this.paused || !this.gs.canPause?.()) return;
    this.gs.cancelAim();
    this.paused = true;
    this.scene.pause('Game');
    music.setPaused(true);
    sfx.pause();

    const I = this.info;
    const c = this.add.container(W / 2, H / 2).setDepth(70);
    const blocker = this.add.rectangle(0, 0, W, H, hex('#35282c'), 0.55).setInteractive();
    blocker.on('pointerdown', stopEvent);
    c.add(blocker);
    c.add(panel(this, 0, 0, 176, 210));
    c.add(label(this, 0, -84, 'PAUSA', 22, { weight: '700', color: PAL.sand, strokeThickness: 4 }));
    c.add(label(this, 0, -60, `${I.worldName} · Hoyo ${I.hole}`, 10, { color: '#f0dcc0', strokeThickness: 2 }));
    c.add(label(this, 0, -46, `Golpes ${this.gs.strokes} · Par ${I.par}`, 10, { color: '#f0dcc0', strokeThickness: 2 }));
    const btn = (y: number, color: string, text: string, cb: () => void) => c.add(makeButton(this, 0, y, { color, w: 120, h: 26, text, size: 13, onClick: cb }));
    btn(-16, 'green', 'Continuar', () => this.resume());
    btn(16, 'blue', 'Reiniciar', () => this.gs.restartLevel());
    btn(48, 'gold', 'Ajustes', () => {
      if (this.settingsPanel) return;
      this.settingsPanel = openSettings(this, { depth: 90, onClose: () => (this.settingsPanel = null) });
    });
    btn(80, 'orange', 'Menú principal', () => this.gs.goToMenu());
    c.setAlpha(0).setScale(0.92);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.pauseMenu = c;
  }

  resume() {
    if (!this.paused) return;
    this.settingsPanel?.close();
    this.paused = false;
    const c = this.pauseMenu;
    this.pauseMenu = null;
    if (c) this.tweens.add({ targets: c, alpha: 0, duration: 120, onComplete: () => c.destroy() });
    this.scene.resume('Game');
    music.setPaused(false);
    sfx.resume();
  }

  // ---------------------------------------------------------------- Habilidades

  buildAbilities(I: HudState) {
    // Salvavidas: icono + contador bajo el marcador del hoyo
    if (I.shields > 0) {
      this.shieldIcon = this.add.image(12, 38, 'up-shield');
      this.shieldText = label(this, 21, 38, `×${I.shields}`, 9, { ox: 0, strokeThickness: 2 });
    }
    // Freno aéreo: botón grande abajo a la derecha (también tecla ESPACIO)
    if (I.brakes > 0) {
      const c = this.add.container(W - 30, H - 26);
      const bg = this.add.nineslice(0, 0, 'btn9-orange', 0, 34, 30, 5, 5, 5, 7);
      const ic = this.add.image(0, -3, 'up-brake');
      this.brakeText = label(this, 10, 6, `${I.brakes}`, 10, { strokeThickness: 2 });
      c.add([bg, ic, this.brakeText]);
      c.setSize(34, 30).setInteractive({ useHandCursor: true });
      c.on('pointerdown', (p: Phaser.Input.Pointer, lx: number, ly: number, e?: Phaser.Types.Input.EventData) => {
        stopEvent(p, lx, ly, e);
        this.gs.useBrake();
      });
      this.brakeBtn = c;
      this.brakeHint = label(this, W - 30, H - 48, 'FRENO', 7, { color: '#ffc59a', strokeThickness: 2 });
    }
  }

  onBrake(n: number) {
    if (!this.brakeBtn) return;
    this.brakeText?.setText(String(n));
    this.tweens.add({ targets: this.brakeBtn, scale: { from: 1.25, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  }

  onShield(n: number) {
    if (!this.shieldIcon) return;
    this.shieldText?.setText(`×${n}`);
    this.tweens.add({ targets: this.shieldIcon, scale: { from: 1.8, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    if (n === 0) this.shieldIcon.setAlpha(0.35);
  }

  update() {
    if (this.brakeBtn) {
      const ok = this.gs.canBrake();
      this.brakeBtn.setAlpha(ok ? 1 : this.gs.brakes > 0 ? 0.45 : 0.2);
      this.brakeHint?.setAlpha(ok ? 1 : 0);
    }
  }

  /** Partículas ambientales: hojas (día), pétalos (atardecer), luciérnagas (noche) */
  ambientFx(theme: ThemeKey) {
    const kind = THEMES[theme]?.ambient || 'leaf';
    if (kind === 'firefly') {
      this.add.particles(0, 0, 'glow', {
        x: { min: 0, max: W }, y: { min: 60, max: H }, lifespan: 4000, speedX: { min: -6, max: 6 }, speedY: { min: -8, max: 3 },
        scale: { min: 0.06, max: 0.12 }, tint: 0xd8ff8a, blendMode: 'ADD', frequency: 450,
        alpha: { onEmit: () => 0, onUpdate: (_p: unknown, _k: string, t: number) => Math.max(0, Math.sin(t * Math.PI * 3)) * Math.sin(t * Math.PI) },
      });
      return;
    }
    this.add.particles(0, 0, kind, {
      x: { min: -10, max: W }, y: -6, lifespan: 10000, speedX: { min: 4, max: 14 }, speedY: { min: 10, max: 20 },
      rotate: { start: 0, end: 360 }, frequency: 1400, alpha: 0.9,
    });
  }

  /** Medidor de viento bajo el contador de golpes: "VIENTO" y flechas animadas que avanzan en la dirección del viento (más flechas = más fuerte) */
  buildWindGauge() {
    this.windGauge = this.add.container(W / 2, 45).setVisible(false);
    this.windTxt = label(this, 0, 0, 'VIENTO', 6, { color: PAL.cyan, strokeThickness: 1 });
    this.windChev = [0, 1, 2].map(() => label(this, 0, 0, '›', 11, { color: PAL.cyan, strokeThickness: 1 }));
    this.windGauge.add([panel(this, 0, 0, 62, 15, 'hud9'), this.windTxt, ...this.windChev]);
  }

  /** Muestra (o actualiza) el viento: medidor con flechas y rayas suaves que cruzan la pantalla. Con 0 se oculta todo. */
  setWind(wind: number, changed = false) {
    for (const p of this.windParticles) p.destroy();
    this.windParticles = [];
    for (const c of this.windChev) this.tweens.killTweensOf(c);
    this.tweens.killTweensOf(this.windGauge);
    if (!wind) {
      this.windGauge.setVisible(false);
      return;
    }
    const dir = Math.sign(wind);
    const n = Math.abs(wind) >= 45 ? 3 : Math.abs(wind) >= 25 ? 2 : 1;
    this.windTxt.setX(-dir * 12);
    this.windChev.forEach((c, i) => {
      c.setText(dir > 0 ? '›' : '‹').setX(dir * (12 + i * 7));
      if (i < n) {
        c.setAlpha(0.3);
        this.tweens.add({ targets: c, alpha: 1, duration: 340, yoyo: true, repeat: -1, delay: i * 130, ease: 'Sine.easeInOut' });
      } else c.setAlpha(0.12);
    });
    this.windGauge.setVisible(true).setScale(1);
    // al cambiar de viento en pleno hoyo, el medidor da un pequeño salto para que se note
    if (changed) this.tweens.add({ targets: this.windGauge, scale: { from: 1.25, to: 1 }, duration: 380, ease: 'Back.easeOut' });
    this.windFx(wind);
  }

  /** Rayas finas y hojas que cruzan la pantalla con el viento: casi transparentes y por detrás del HUD, para que se noten sin molestar */
  windFx(wind: number) {
    const dir = Math.sign(wind);
    const a = Math.abs(wind);
    const k = Math.min(1, a / 45); // 0 = brisa, 1 = racha fuerte
    const sp = 55 + a * 4;
    const common = {
      x: dir > 0 ? -24 : W + 24,
      y: { min: 50, max: H - 10 },
      speedX: dir > 0 ? { min: sp, max: sp * 1.5 } : { min: -sp * 1.5, max: -sp },
    };
    const streaks = this.add
      .particles(0, 0, 'streak', { ...common, lifespan: 3400, scaleX: { min: 2 + 3 * k, max: 4 + 7 * k }, alpha: { start: 0.24 + 0.16 * k, end: 0 }, frequency: 170 - 100 * k })
      .setDepth(-5);
    const leaves = this.add
      .particles(0, 0, 'leaf', { ...common, lifespan: 3200, speedY: { min: -8, max: 14 }, rotate: { start: 0, end: 360 * dir }, alpha: { start: 0.8, end: 0 }, frequency: 750 - 400 * k })
      .setDepth(-5);
    this.windParticles.push(streaks, leaves);
  }

  // ---------------------------------------------------------------- HUD

  buildProgressBar() {
    const x = W - 6;
    this.barTop = 70;
    this.barBot = H - 50;
    // marco de la barra: pre-dibujado a 4× (un Graphics se vuelve a triangular en cada fotograma)
    const len = this.barBot - this.barTop;
    const K = 4;
    this.add.image(x - 3, this.barTop - 2, bakeTexture(this, 'hud-bar', 6, len + 4, (c, k) => {
      c.fillStyle = 'rgba(53,40,44,0.8)';
      roundRectPath(c, 0, 0, 6 * k, (len + 4) * k, 3 * k);
      c.fill();
      c.fillStyle = '#5a4448';
      roundRectPath(c, 1.5 * k, 2 * k, 3 * k, len * k, 1.5 * k);
      c.fill();
    }, { scale: K, linear: true })).setOrigin(0).setScale(1 / K);
    this.add.image(x, this.barTop - 8, 'glow').setTint(0xfff1b0).setBlendMode('ADD').setScale(0.3).setAlpha(0.7);
    this.add.sprite(x - 1, this.barTop - 3, 'flag', 0).setOrigin(1, 1).setFlipX(true).setScale(0.8).play('flag-wave');
    this.add.image(x, this.barTop - 8, 'px').setDisplaySize(1, 12); // palo de la bandera
    this.barX = x;
    // relleno verde: una imagen estirada (en vez de redibujar un Graphics en cada fotograma)
    this.barFill = this.add.image(x - 1.5, this.barBot, 'px').setOrigin(0, 1).setTint(hex('#b8ec6a')).setVisible(false);
    this.barBall = this.add.sprite(x, this.barBot, `ball-${progress.skin}`, 0);
  }

  onProgress(t: number) {
    const y = this.barBot - (this.barBot - this.barTop) * t;
    this.barBall.y = y;
    const h = this.barBot - y;
    this.barFill.setVisible(h > 2).setDisplaySize(3, Math.max(h, 0.01));
  }

  onHud({ strokes }: { strokes: number }) {
    if (this.strokesText.text !== String(strokes)) {
      this.strokesText.setText(String(strokes));
      this.tweens.add({ targets: this.strokesText, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    }
  }

  // ---------------------------------------------------------------- Intro / tutorial / avisos

  showIntroCard() {
    const I = this.info;
    sfx.tee();
    const c = this.add.container(W / 2, Math.round(H * 0.4));
    c.add([
      panel(this, 0, 0, 176, 84),
      label(this, 0, -24, `HOYO ${I.hole}`, 22, { weight: '700', color: PAL.sand, strokeThickness: 4 }),
      label(this, 0, 2, I.name, 13, { weight: '600' }),
      label(this, 0, 22, `Par ${I.par}  ·  ${I.heightM} m`, 9, { color: '#f0dcc0', strokeThickness: 2 }),
    ]);
    const tap = label(this, 0, 58, 'Toca para empezar', 10);
    c.add(tap);
    this.tweens.add({ targets: tap, alpha: 0.25, duration: 600, yoyo: true, repeat: -1 });
    c.setScale(0.8).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 350, ease: 'Back.easeOut' });
    this.introCard = c;
  }

  onPlay() {
    if (this.introCard) {
      const c = this.introCard;
      this.introCard = null;
      this.tweens.add({ targets: c, alpha: 0, scale: 0.9, duration: 200, onComplete: () => c.destroy() });
    }
    if (this.info.tutorial) this.showTutorial();
    if (this.info.intro) {
      const m = MECHANICS[this.info.intro];
      this.time.delayedCall(250, () => this.showToast({ title: m.title, text: m.text, color: m.color, duration: 5000 }));
    }
  }

  showTutorial() {
    const hand = this.add.image(W / 2, H * 0.55, 'hand');
    // en ordenador también se explica el teclado
    const keyboard = !this.sys.game.device.input.touch && this.input.keyboard;
    const h = keyboard ? 62 : 50;
    const y = 64 + h / 2; // arriba, bajo el HUD: abajo taparía la bola en la salida
    const p = panel(this, W / 2, y, 200, h);
    const text = keyboard
      ? 'Arrastra hacia abajo y suelta\npara lanzar la bola\nTeclado: flechas + ESPACIO\nRueda pulsada: mover el mapa'
      : 'Arrastra hacia abajo y suelta\npara lanzar la bola\nDos dedos: mover el mapa';
    const txt = label(this, W / 2, y, text, 10, { lineSpacing: 2 });
    this.tweens.add({ targets: hand, y: { from: H * 0.5, to: H * 0.66 }, alpha: { from: 1, to: 0.3 }, duration: 900, repeat: -1, repeatDelay: 300, ease: 'Cubic.easeInOut' });
    this.tutorial = [hand, p, txt];
  }

  onShot() {
    if (this.tutorial) {
      const t = this.tutorial;
      this.tutorial = null;
      this.tweens.add({ targets: t, alpha: 0, duration: 250, onComplete: () => t.forEach((o: Phaser.GameObjects.GameObject) => o.destroy()) });
      // primer hoyo con islas: se explica qué pasa si te caes
      if (this.info.open) {
        const m = MECHANICS.edge;
        this.time.delayedCall(400, () => this.showToast({ title: m.title, text: m.text, color: m.color, duration: 5000 }));
      }
    }
  }

  showToast({ title, text, color = PAL.sand, duration = 4000 }: ToastOpts) {
    if (this.toast) this.toast.destroy();
    const c = this.add.container(W / 2, 58).setDepth(40);
    const body = label(this, 0, 0, text, 10, { wrap: 190, oy: 0, strokeThickness: 2 });
    const h = Math.round(26 + body.height);
    const p = panel(this, 0, h / 2, 208, h).setOrigin(0.5);
    const head = label(this, 0, 10, title, 12, { color, weight: '700' });
    body.y = 18;
    c.add([p, head, body]);
    c.setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.time.delayedCall(duration, () => {
      if (!c.active) return;
      this.tweens.add({ targets: c, alpha: 0, y: c.y - 8, duration: 250, onComplete: () => c.destroy() });
    });
    this.toast = c;
  }

  // ---------------------------------------------------------------- Fin de nivel

  showComplete(r: CompleteInfo) {
    if (this.toast) this.toast.destroy();
    const blocker = this.add.rectangle(W / 2, H / 2, W, H, hex('#35282c'), 0).setInteractive().setDepth(50);
    this.tweens.add({ targets: blocker, fillAlpha: 0.65, duration: 300 });

    const py = Math.round(H / 2 + 8);
    const p = this.add.container(W / 2, H + 170).setDepth(51);
    p.add(panel(this, 0, 0, 204, 256));

    // rayos detrás de las estrellas
    const rays = this.add.image(0, -62, 'ray').setOrigin(0.5, 1).setTint(0xffd36b).setBlendMode('ADD').setAlpha(0);
    p.add(rays);

    // cinta del título
    p.add(this.add.nineslice(0, -128, 'btn9-gold', 0, 184, 30, 5, 5, 5, 7));
    p.add(label(this, 0, -130, scoreName(r.strokes, r.par), 18, { weight: '700', stroke: '#7a3a00', strokeThickness: 3 }));
    p.add(label(this, 0, -100, `${r.worldName} · Hoyo ${r.hole} · ${r.name}`, 10, { color: '#f0dcc0', strokeThickness: 2 }));

    const starPos = [[-38, -64], [0, -72], [38, -64]];
    const starScale = (i: number) => (i === 1 ? 1.25 : 1);
    const stars = starPos.map(([sx, sy], i) => {
      p.add(this.add.image(sx, sy, 'star-empty').setScale(starScale(i)));
      const s = this.add.image(sx, sy, 'star').setScale(0);
      p.add(s);
      return s;
    });

    ([['Golpes', r.strokes], ['Par', r.par]] as [string, number][]).forEach(([k, v], i) => {
      const x = -36 + i * 72;
      p.add(label(this, x, -32, k, 9, { color: '#f0dcc0', strokeThickness: 2 }));
      p.add(label(this, x, -15, String(v), 18, { weight: '700' }));
    });

    // Monedas ganadas (contador animado + desglose)
    p.add(panel(this, 0, 12, 150, 22, 'hud9'));
    const coinIcon = this.add.image(-50, 12, 'coin');
    const coinText = label(this, -42, 12, '+0', 13, { ox: 0, color: PAL.sand });
    p.add([coinIcon, coinText]);
    // fichas del gachapón
    const tokIcon = this.add.image(22, 12, 'token');
    const tokText = label(this, 30, 12, `+${r.tokens}`, 13, { ox: 0, color: '#d8b8ff' });
    p.add([tokIcon, tokText]);
    this.tweens.add({ targets: tokIcon, scale: { from: 1.8, to: 1 }, duration: 400, delay: 700, ease: 'Back.easeOut' });
    const detail = (r.coinLines || []).map((l) => `${l.label} +${l.amount}`).join('  ·  ');
    p.add(label(this, 0, 31, detail, 7, { color: '#f0dcc0', strokeThickness: 2, wrap: 190 }));

    if (r.isBest) {
      const b = label(this, 0, 50, '¡Nuevo récord!', 11, { color: PAL.orange, weight: '700' });
      p.add(b);
      this.tweens.add({ targets: b, scale: 1.12, duration: 400, yoyo: true, repeat: -1 });
    } else if (r.worldJustCompleted) {
      const b = label(this, 0, 50, `¡${r.worldName} completada!`, 11, { color: PAL.grassL, weight: '700' });
      p.add(b);
      this.tweens.add({ targets: b, scale: 1.12, duration: 400, yoyo: true, repeat: -1 });
    } else if (!r.hasNext) {
      p.add(label(this, 0, 50, `${r.worldName}: ${r.worldStars}/${r.worldStarsMax} estrellas`, 10, { color: PAL.grassL, weight: '700' }));
    }

    p.add(makeButton(this, -46, 78, { color: 'blue', w: 84, text: 'Repetir', onClick: () => this.gs.restartLevel() }));
    if (r.hasNext) p.add(makeButton(this, 46, 78, { color: 'green', w: 84, text: 'Siguiente', onClick: () => this.gs.goToLevel(r.levelIndex + 1) }));
    else p.add(makeButton(this, 46, 78, { color: 'green', w: 84, text: 'Hoyos', onClick: () => this.gs.goToHoles() }));

    const link = (x: number, text: string, cb: () => void) => {
      const t = label(this, x, 108, text, 10, { color: '#f0dcc0' }).setInteractive({ useHandCursor: true });
      t.on('pointerup', () => {
        sfx.click();
        cb();
      });
      p.add(t);
    };
    link(-46, 'Menú principal', () => this.gs.goToMenu());
    link(46, '⬆ Mejoras', () => this.gs.goToShop());

    this.time.delayedCall(900, () => {
      if (!r.coins) return;
      this.tweens.addCounter({
        from: 0,
        to: r.coins,
        duration: Math.min(1200, 250 + r.coins * 12),
        onUpdate: (tw) => {
          const v = Math.round(tw.getValue() ?? 0);
          if (coinText.text !== `+${v}`) {
            coinText.setText(`+${v}`);
            if (v % 3 === 0) sfx.coin();
          }
        },
        onComplete: () => {
          this.tweens.add({ targets: coinIcon, scale: { from: 1.8, to: 1 }, duration: 300, ease: 'Back.easeOut' });
          this.sparks.explode(10, W / 2 - 50, py + 12);
        },
      });
    });

    this.tweens.add({
      targets: p,
      y: py,
      duration: 500,
      ease: 'Back.easeOut',
      onComplete: () => {
        // ENTER = botón principal (Siguiente o Menú)
        this.completeAction = r.hasNext ? () => this.gs.goToLevel(r.levelIndex + 1) : () => this.gs.goToHoles();
        this.tweens.add({ targets: rays, alpha: 0.35, duration: 600 });
        this.tweens.add({ targets: rays, angle: 360, duration: 12000, repeat: -1 });
        for (let i = 0; i < r.stars; i++) {
          this.tweens.add({
            targets: stars[i],
            scale: starScale(i),
            angle: { from: -30, to: 0 },
            duration: 300,
            delay: 120 + i * 300,
            ease: 'Back.easeOut',
            onStart: () => {
              sfx.star(i);
              this.sparks.explode(10, W / 2 + starPos[i][0], py + starPos[i][1]);
            },
          });
        }
        if (r.stars === 3) this.time.delayedCall(1000, () => this.celebrate());
      },
    });
  }

  celebrate() {
    const rain = this.add.particles(0, -4, 'px', {
      x: { min: 0, max: W },
      lifespan: 2800,
      speedY: { min: 60, max: 130 },
      speedX: { min: -20, max: 20 },
      rotate: { min: 0, max: 360 },
      tint: [hex('#ef4d5e'), hex('#ffd36b'), hex('#b8ec6a'), hex('#5aa8f0'), hex('#ff8a5c')],
      frequency: 25,
    }).setDepth(49);
    this.time.delayedCall(1600, () => rain.stop());
  }
}
