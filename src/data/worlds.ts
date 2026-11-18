import { MEADOW } from './worlds/meadow';
import { BEACH } from './worlds/beach';
import type { ThemeKey } from '../constants';
import type { LevelDef } from './levels';

export interface WorldDef {
  id: string;
  name: string;
  tagline: string;
  theme: ThemeKey;
  /** color de los botones de sus hoyos */
  button: 'green' | 'gold' | 'blue' | 'purple' | 'orange';
  /** mini-escenario que se pinta en la tarjeta del mapa de mundos */
  preview: string[];
  levels: LevelDef[];
  comingSoon?: boolean;
}

/**
 * Mundos del juego, en orden. Cada uno tiene su tema visual (constants.js → THEMES),
 * su música (systems/audio.js → SONGS) y su lista de hoyos.
 * Un mundo se desbloquea al completar todos los hoyos del anterior.
 *
 *   preview  mini-escenario (20 columnas) que se pinta en la tarjeta del mapa de mundos
 *   button   color de los botones de sus hoyos ('green' | 'gold' | 'blue' | 'purple' | 'orange')
 */
export const WORLDS: WorldDef[] = [
  {
    id: 'meadow',
    name: 'Pradera',
    tagline: 'El campo de golf',
    theme: 'meadow',
    button: 'green',
    preview: ['.................', '...........r./###', '##WWW#..sss######', '#################'],
    levels: MEADOW,
  },
  {
    id: 'beach',
    name: 'Playa',
    tagline: 'Arena, olas y palmeras',
    theme: 'beach',
    button: 'gold',
    preview: ['.................', '......../#\\......', 'WWWWW##########WW', '#################'],
    levels: BEACH,
  },
  {
    id: 'swamp',
    name: 'Pantano',
    tagline: 'Barro, nenúfares y niebla',
    theme: 'swamp',
    button: 'purple',
    preview: ['.................', '#\\...........###', '##WWWW##WWWWW####', '#################'],
    levels: [],
    comingSoon: true,
  },
];

export const worldById = (id: string) => WORLDS.find((w) => w.id === id);
