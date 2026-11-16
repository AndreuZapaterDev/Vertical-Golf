import { FONT, FONT_SCALE, PAL, VIEW } from '../constants.js';
import { sfx } from '../systems/audio.js';

/**
 * Texto nítido a alta resolución (resolution = zoom), con contorno y sombra.
 * size en píxeles lógicos (8–40).
 */
export function label(scene, x, y, text, size = 10, opts = {}) {
  const style = {
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
export function gradientFill(text, stops) {
  const g = text.context.createLinearGradient(0, 0, 0, text.height);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  text.setFill(g);
  return text;
}

/** Panel con marco pixel (NineSlice) */
export function panel(scene, x, y, w, h, key = 'panel9') {
  const slice = key === 'hud9' ? 3 : 4;
  return scene.add.nineslice(x, y, key, 0, w, h, slice, slice, slice, slice);
}

function pressable(scene, target, onClick) {
  const y0 = target.y;
  target.on('pointerover', () => scene.tweens.add({ targets: target, scale: 1.05, duration: 90 }));
  target.on('pointerout', () => {
    scene.tweens.add({ targets: target, scale: 1, duration: 90 });
    target.y = y0;
  });
  target.on('pointerdown', () => {
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
export function makeButton(scene, x, y, { color = 'green', w = 96, h = 26, text, size = 12, onClick }) {
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
export function iconButton(scene, x, y, icon, onClick) {
  const c = scene.add.container(x, y);
  const bg = scene.add.nineslice(0, 0, 'btn9-white', 0, 17, 18, 5, 5, 5, 7);
  const img = scene.add.image(0, -1, `icon-${icon}`);
  c.add([bg, img]);
  c.setSize(17, 18);
  c.setInteractive({ useHandCursor: true });
  c.icon = img;
  pressable(scene, c, onClick);
  return c;
}
