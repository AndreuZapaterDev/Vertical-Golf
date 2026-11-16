# Vertical Golf

Juego 2D hecho con **Phaser 3** + **Vite**, ejecutado en **Docker** y preparado para **Supabase**.

## Arrancar (desarrollo)

```bash
cp .env.example .env      # solo la primera vez (puede quedarse vacío)
docker compose up --build
```

Abre http://localhost:5173. Los cambios en `src/` se recargan solos.

Si añades dependencias nuevas a `package.json`, reconstruye: `docker compose up --build -V`.

## Producción

```bash
docker compose --profile prod up --build game-prod
```

Abre http://localhost:8080 (nginx sirviendo el build estático).

## Estructura

```
src/
  main.js                 # punto de entrada (espera a la fuente Jersey 10)
  config.js               # configuración de Phaser (zoom entero según la pantalla)
  constants.js            # física, materiales y paletas de los mundos
  data/levels.js          # los 12 niveles dibujados como mapas de texto
  gfx/terrain.js          # pinta el terreno de un mapa como una sola textura pixel art
  gfx/textures.js         # sprites e interfaz pixel art (bola, bandera, sierras, botones…)
  gfx/background.js       # fondo de cuadros de los menús
  systems/audio.js        # efectos de sonido sintetizados con WebAudio
  systems/progress.js     # progreso guardado en localStorage
  ui/                     # textos, botones, paneles y cámara
  scenes/                 # Boot, Menu, LevelSelect, Game, UI
  services/supabase.js    # cliente Supabase + saveScore / getTopScores
supabase/schema.sql       # tabla `scores` con RLS
```

## Cómo se ve

Pixel art plano: terreno de tierra con contorno y vetas, hierba con festón, rampas, charcas de agua
y fondo de cuadros. El mundo lógico mide 240 px de ancho (casillas de 12 px) y las cámaras hacen
zoom entero, así el arte se ve nítido y los textos van a alta resolución.

## Progresión (monedas y mejoras)

Al completar un hoyo se ganan monedas: +5 por terminar, +15 por cada estrella nueva, +10 por cada gema
nueva, +10 bajo par y +25 por hoyo en uno. Se gastan en la tienda (**Mejoras**):

| Mejora | Efecto |
|---|---|
| Potencia | Golpes hasta un 25 % más fuertes |
| Visor | Trayectoria visible más larga (empieza corta) |
| Agarre | La bola frena antes al aterrizar |
| Imán de hoyo | El hoyo atrae la bola desde más lejos |
| Freno aéreo | Botón (o ESPACIO) que frena la bola en el aire, 1–3 usos por hoyo |
| Salvavidas | Anula la penalización de agua/sierras, 1–2 por hoyo |
| Imán de gemas | Las gemas cercanas vuelan hacia la bola |

También hay 6 bolas comprables, cada una con su estela. Precios y valores en `src/data/upgrades.js`;
el guardado (localStorage) en `src/systems/progress.js`.

## Crear o editar niveles

Cada nivel es un mapa de texto de **18 columnas** en `src/data/levels.js` (las paredes laterales
y el suelo se añaden solos). Fila de arriba = parte alta del nivel.

| Símbolo | Qué es | Símbolo | Qué es |
|---|---|---|---|
| . | vacío | # | tierra con hierba |
| `/` | rampa que sube a la derecha | `\` | rampa que sube a la izquierda |
| = | plataforma fina | s | arena (búnker) |
| i | hielo | W | agua (+1 golpe) |
| M | seta saltarina (golpe ×1.4) | P | plataforma móvil |
| C | bloque frágil | O | bumper |
| X / Y | sierra fija / móvil | * | gema |
| S | salida | H | hoyo |

Física **Matter.js**: todo el terreno es sólido por todos lados; las casillas se fusionan en
rectángulos grandes y cada diagonal de rampa en un solo triángulo para que la bola ruede sin engancharse.
Estrellas: ≤ par → 3, ≤ par+2 → 2, resto → 1.

## Atajos de desarrollo

- `?level=7` entra directamente al nivel 7
- `?debug` muestra los cuerpos físicos
- Tecla `R` reinicia el nivel, `Esc` cancela el apuntado

## Conectar Supabase

1. Crea un proyecto en https://supabase.com.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Pon `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env` (Project Settings → API).
4. Reinicia el contenedor: `docker compose up`.

El menú muestra si Supabase está conectado. Sin credenciales, el juego funciona offline.

## Controles

Arrastra hacia atrás desde cualquier punto y suelta para golpear la bola (como un tirachinas). Verás la trayectoria prevista y la potencia. Solo puedes golpear cuando la bola está parada (aparece un anillo pulsante). Las plataformas se atraviesan desde abajo.
