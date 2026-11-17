import type Phaser from 'phaser';
import { W, H, PAL, hex } from '../constants';
import { progress, type Settings } from '../systems/progress';
import { sfx, haptic } from '../systems/audio';
import { label, makeButton, panel, stopEvent } from './widgets';

const STEPS = 5; // el volumen va de 0 a 100 % en saltos de 20 %

export type SettingsPanel = Phaser.GameObjects.Container & { close: () => void; closing: boolean };

/**
 * Ventana de ajustes (música, efectos, vibración y temblor de cámara).
 * Se usa desde el menú principal y desde la pausa. Devuelve el contenedor con .close().
 */
export function openSettings(scene: Phaser.Scene, { onClose, depth = 80 }: { onClose?: () => void; depth?: number } = {}): SettingsPanel {
  const c = Object.assign(scene.add.container(W / 2, H / 2).setDepth(depth), { close: () => {}, closing: false });
  const blocker = scene.add.rectangle(0, 0, W, H, hex('#35282c'), 0.6).setInteractive();
  blocker.on('pointerdown', stopEvent);
  c.add(blocker);
  c.add(panel(scene, 0, 0, 204, 200));
  c.add(label(scene, 0, -80, 'AJUSTES', 18, { weight: '700', color: PAL.sand, strokeThickness: 3 }));

  const rowLabel = (y: number, text: string) => c.add(label(scene, -88, y, text, 11, { ox: 0, strokeThickness: 2 }));

  // --- volumen: [-] ■■■□□ [+]
  const volumeRow = (y: number, key: 'music' | 'sfx', text: string) => {
    rowLabel(y, text);
    const bars = scene.add.graphics();
    c.add(bars);
    const draw = () => {
      const v = Math.round(progress.settings[key] * STEPS);
      bars.clear();
      for (let i = 0; i < STEPS; i++) {
        const x = 28 + i * 8;
        bars.fillStyle(hex('#35282c'), 1).fillRect(x - 1, y - 5 - i, 7, 10 + i);
        bars.fillStyle(i < v ? hex('#b8ec6a') : hex('#5a4448'), 1).fillRect(x, y - 4 - i, 5, 8 + i);
      }
    };
    const change = (d: number) => {
      const v = Math.round(progress.settings[key] * STEPS);
      const nv = Math.min(STEPS, Math.max(0, v + d));
      if (nv === v) return sfx.denied();
      progress.setSetting(key, nv / STEPS);
      draw();
      if (key === 'sfx') sfx.click();
    };
    c.add(makeButton(scene, 16, y, { color: 'white', w: 18, h: 18, text: '-', size: 12, onClick: () => change(-1) }));
    c.add(makeButton(scene, 82, y, { color: 'white', w: 18, h: 18, text: '+', size: 12, onClick: () => change(1) }));
    draw();
  };

  // --- interruptor SÍ / NO
  const toggleRow = (y: number, key: Extract<keyof Settings, 'vibration' | 'shake'>, text: string, onEnable?: () => void) => {
    rowLabel(y, text);
    const btn = makeButton(scene, 50, y, { color: 'green', w: 58, h: 20, text: '', size: 11, onClick: () => {
      progress.setSetting(key, !progress.settings[key]);
      draw();
      if (progress.settings[key]) onEnable?.();
    } });
    const draw = () => {
      const on = progress.settings[key];
      (btn.list[0] as Phaser.GameObjects.NineSlice).setTexture(on ? 'btn9-green' : 'btn9-gray');
      (btn.list[1] as Phaser.GameObjects.Text).setText(on ? 'SÍ' : 'NO');
    };
    c.add(btn);
    draw();
  };

  volumeRow(-46, 'music', 'Música');
  volumeRow(-18, 'sfx', 'Efectos');
  toggleRow(12, 'vibration', 'Vibración', () => haptic(40));
  toggleRow(40, 'shake', 'Temblor', () => scene.cameras.main.shake(120, 0.006));

  const close = () => {
    if (!c.active || c.closing) return;
    c.closing = true;
    scene.tweens.add({ targets: c, alpha: 0, duration: 150, onComplete: () => c.destroy() });
    onClose?.();
  };
  c.close = close;
  c.add(makeButton(scene, 0, 78, { color: 'blue', w: 96, h: 26, text: 'Listo', size: 13, onClick: close }));

  c.setAlpha(0);
  scene.tweens.add({ targets: c, alpha: 1, duration: 150 });
  return c;
}
