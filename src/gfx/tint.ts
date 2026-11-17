import Phaser from 'phaser';

/**
 * Tiñe un objeto de un color plano (silueta), p. ej. para sombras proyectadas.
 * Phaser 4 eliminó `setTintFill(color)`: ahora es `setTint(color)` + modo de tinte FILL.
 */
export function tintFill<T extends Phaser.GameObjects.Image>(obj: T, color: number): T {
  obj.setTint(color).setTintMode(Phaser.TintModes.FILL);
  return obj;
}
