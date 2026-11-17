// Permite ejecutar las herramientas .ts con Node (>= 22.18) sin dependencias:
// Node ya entiende TypeScript (quita los tipos); este hook solo añade la extensión .ts
// a los imports sin extensión que usa el código del juego ('../constants' → '../constants.ts').
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
      throw err;
    }
  },
});
