import Phaser from 'phaser';
import { canvasTexture } from './terrain';

/**
 * Dibuja una vez en un canvas y devuelve la clave de la textura.
 *
 * Los `Graphics` de Phaser se vuelven a triangular y a enviar a la GPU en CADA fotograma, aunque no
 * cambien: para formas fijas (carriles, marcos, flechas) sale mucho más barato pintarlas aquí una vez
 * y usar un `Image`. `scale` dibuja a más resolución (se usa con `linear` y `setScale(1/scale)`).
 */
export function bakeTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D, scale: number) => void,
  { scale = 1, linear = false } = {},
): string {
  if (scene.textures.exists(key)) return key;
  const tex = canvasTexture(scene, key, Math.ceil(w * scale), Math.ceil(h * scale));
  const c = tex.getContext();
  c.imageSmoothingEnabled = !!linear;
  draw(c, scale);
  tex.refresh();
  if (linear) tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return key;
}

/** Rectángulo con las esquinas redondeadas (sin depender de `roundRect`) */
export function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

/** '#rrggbb' + opacidad → 'rgba(...)' */
export const rgba = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
