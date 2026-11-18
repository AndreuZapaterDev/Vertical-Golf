import { MEADOW } from './worlds/meadow';
import { BEACH } from './worlds/beach';
import { SWAMP } from './worlds/swamp';
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
    levels: SWAMP,
  },
  {
    id: 'jungle',
    name: 'Selva',
    tagline: 'Lianas, ruinas y tótems',
    theme: 'jungle',
    button: 'green',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'candy',
    name: 'Mundo de caramelo',
    tagline: 'Golosinas y ríos de chocolate',
    theme: 'candy',
    button: 'purple',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'west',
    name: 'Oeste',
    tagline: 'Cañones, trenes y matorrales',
    theme: 'west',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'temple',
    name: 'Templo antiguo',
    tagline: 'Pirámides, trampas y antorchas',
    theme: 'temple',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'castle',
    name: 'Castillo medieval',
    tagline: 'Torres, catapultas y dragones',
    theme: 'castle',
    button: 'blue',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'haunted',
    name: 'Mansión encantada',
    tagline: 'Fantasmas, cementerios y calabazas',
    theme: 'haunted',
    button: 'purple',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'cave',
    name: 'Cueva',
    tagline: 'Minas, cristales y murciélagos',
    theme: 'cave',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'sea',
    name: 'Fondo marino',
    tagline: 'Corales, burbujas y corrientes',
    theme: 'sea',
    button: 'blue',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'ice',
    name: 'Hielo',
    tagline: 'Glaciares y ventiscas',
    theme: 'ice',
    button: 'blue',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'volcano',
    name: 'Volcán',
    tagline: 'Lava, ceniza y fuego',
    theme: 'volcano',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'industrial',
    name: 'Zona industrial',
    tagline: 'Fábricas, tuberías y cintas',
    theme: 'industrial',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'nuclear',
    name: 'Zona nuclear',
    tagline: 'Reactores, radiación y neón',
    theme: 'nuclear',
    button: 'green',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'neon',
    name: 'Ciudad neón',
    tagline: 'Rascacielos, ciberespacio y luces',
    theme: 'neon',
    button: 'purple',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'circus',
    name: 'Circo',
    tagline: 'Carpas, norias y cañones humanos',
    theme: 'circus',
    button: 'orange',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'sky',
    name: 'Cielo',
    tagline: 'Nubes, islas flotantes y rayos',
    theme: 'sky',
    button: 'blue',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'space',
    name: 'Espacio',
    tagline: 'Estaciones y baja gravedad',
    theme: 'space',
    button: 'purple',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
  {
    id: 'deepspace',
    name: 'Espacio profundo',
    tagline: 'Planetas, agujeros negros y gravedad',
    theme: 'deepspace',
    button: 'purple',
    preview: ['.................', '.................', '#################', '#################'],
    levels: [],
    comingSoon: true,
  },
];

export const worldById = (id: string) => WORLDS.find((w) => w.id === id);
