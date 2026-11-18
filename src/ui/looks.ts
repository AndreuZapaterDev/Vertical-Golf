import type Phaser from 'phaser';
import { progress, type LookId } from '../systems/progress';

/**
 * Estilos de imagen: un filtro de color sobre la cámara del juego (Phaser 4: camera.filters).
 * "Normal" no añade ningún filtro (imagen tal cual). Los demás ajustan saturación, contraste y tono.
 */
export const LOOKS: Record<LookId, { name: string }> = {
  normal: { name: 'Normal' },
  vivid: { name: 'Vivo' },
  soft: { name: 'Suave' },
  cine: { name: 'Cine' },
};

/** Pone en la cámara el filtro del estilo elegido (y quita el anterior). */
export function applyLook(camera: Phaser.Cameras.Scene2D.Camera, look: LookId = progress.settings.look) {
  const list = camera.filters?.external;
  if (!list) return; // sin WebGL no hay filtros
  list.clear();
  if (look === 'normal') return;
  const cm = list.addColorMatrix().colorMatrix;
  if (look === 'vivid') {
    cm.saturate(0.35, false);
    cm.contrast(0.1, true);
  } else if (look === 'soft') {
    cm.saturate(-0.12, false);
    cm.contrast(-0.06, true);
  } else if (look === 'cine') {
    cm.contrast(0.18, false);
    cm.saturate(0.15, true);
    // tono cálido: sube un poco el rojo y baja el azul
    cm.multiply([1.05, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.92, 0, 0, 0, 0, 0, 1, 0], true);
  }
}
