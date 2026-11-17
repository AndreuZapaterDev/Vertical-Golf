import type Phaser from 'phaser';
import { W, H, VIEW } from '../constants';

/** Ajusta la cámara de una escena fija (menús, UI, fondo) al área lógica W×H */
export function fitCamera(scene: Phaser.Scene) {
  const cam = scene.cameras.main;
  cam.setZoom(VIEW.Z);
  cam.centerOn(W / 2, H / 2);
  return cam;
}
