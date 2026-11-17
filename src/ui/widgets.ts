import type Phaser from 'phaser';
import { FONT, FONT_SCALE, PAL, VIEW } from '../constants';
import { sfx } from '../systems/audio';

export interface LabelOpts {
  color?: string;
  align?: string;
  lineSpacing?: number;
  /** ancho máximo antes de partir líneas */
  wrap?: number;
  stroke?: string | false;
  strokeThickness?: number;
  shadow?: false;
  shadowY?: number;
  shadowColor?: string;
  /** origen x/y (0.5 por defecto) */
  ox?: number;
  oy?: number;
  /** solo informativo: la fuente pixel no tiene pesos */
  weight?: string;
}

export type IconButton = Phaser.GameObjects.Container & { icon: Phaser.GameObjects.Image };

/** Manejador de pointerdown de Phaser (pointer, x local, y local, evento) */
type PointerDownHandler = (p: Phaser.Input.Pointer, x: number, y: number, e?: Phaser.Types.Input.EventData) => void;
export const stopEvent: PointerDownHandler = (_p, _x, _y, e) => e?.stopPropagation?.();

/**
 * Texto nítido a alta resolución (resolution = zoom), con contorno y sombra.
 * size en píxeles lógicos (8–40).
 */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, size = 10, opts: LabelOpts = {}) {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT,
    fontSize: `${Math.round(size * FONT_SCALE)}px`,
    color: opts.color ?? PAL.white,
    align: opts.align ?? 'center',
    lineSpacing: opts.lineSpacing ?? 1,
    resolution: VIEW.Z,
  };
  if (opts.wrap) style.wordWrap = { width: opts.wrap };
  if (opts.stroke !== false) {
    style.stroke = opts.stroke ?? '#141a33';
    style.strokeThickness = opts.strokeThickness ?? Math.max(2, Math.round(size / 6));
  }
  if (opts.shadow !== false) {
    style.shadow = { offsetX: 0, offsetY: opts.shadowY ?? Math.max(1, Math.round(size / 10)), color: opts.shadowColor ?? 'rgba(10,8,30,0.6)', blur: 0, stroke: true, fill: true };
  }
  return scene.add.text(x, y, text, style).setOrigin(opts.ox ?? 0.5, opts.oy ?? 0.5);
}

/** Relleno en degradado vertical para un texto */
export function gradientFill(text: Phaser.GameObjects.Text, stops: [number, string][]) {
  const g = text.context.createLinearGradient(0, 0, 0, text.height);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  text.setFill(g);
  return text;
}

/** Panel con marco pixel (NineSlice) */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, key = 'panel9') {
  const slice = key === 'hud9' ? 3 : 4;
  return scene.add.nineslice(x, y, key, 0, w, h, slice, slice, slice, slice);
}

function pressable(scene: Phaser.Scene, target: Phaser.GameObjects.Container, onClick?: () => void) {
  const y0 = target.y;
  target.on('pointerover', () => scene.tweens.add({ targets: target, scale: 1.05, duration: 90 }));
  target.on('pointerout', () => {
    scene.tweens.add({ targets: target, scale: 1, duration: 90 });
    target.y = y0;
  });
  target.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e?: Phaser.Types.Input.EventData) => {
    e?.stopPropagation?.(); // que el toque no llegue a la escena de juego (no empieza a apuntar)
    sfx.unlock();
    target.y = y0 + 1;
  });
  target.on('pointerup', () => {
    target.y = y0;
    sfx.click();
    onClick?.();
  });
}

/** Botón NineSlice con texto */
export interface ButtonOpts {
  color?: string;
  w?: number;
  h?: number;
  text: string;
  size?: number;
  onClick?: () => void;
}

export function makeButton(scene: Phaser.Scene, x: number, y: number, { color = 'green', w = 96, h = 26, text, size = 12, onClick }: ButtonOpts) {
  const c = scene.add.container(x, y);
  const bg = scene.add.nineslice(0, 0, `btn9-${color}`, 0, w, h, 5, 5, 5, 7);
  const t = label(scene, 0, -2, text, size, { weight: '700', strokeThickness: 2, stroke: 'rgba(20,26,51,0.55)', shadowY: 1 });
  c.add([bg, t]);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });
  pressable(scene, c, onClick);
  return c;
}

/** Botón cuadrado con icono */
export function iconButton(scene: Phaser.Scene, x: number, y: number, icon: string, onClick?: () => void): IconButton {
  const img = scene.add.image(0, -1, `icon-${icon}`);
  const c = Object.assign(scene.add.container(x, y), { icon: img });
  const bg = scene.add.nineslice(0, 0, 'btn9-white', 0, 17, 18, 5, 5, 5, 7);
  c.add([bg, img]);
  c.setSize(17, 18);
  c.setInteractive({ useHandCursor: true });
  pressable(scene, c, onClick);
  return c;
}
