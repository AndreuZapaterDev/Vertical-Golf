# Vertical Golf

Juego 2D hecho con **Phaser 4** + **TypeScript** + **Vite**, ejecutado en **Docker** y preparado para **Supabase**.

## Arrancar (desarrollo)

```bash
cp .env.example .env      # solo la primera vez (puede quedarse vacío)
docker compose up --build
```

Abre http://localhost:5173. Los cambios en `src/` se recargan solos.

Si añades dependencias nuevas a `package.json`, reconstruye: `docker compose up --build -V`.

Comprobar los tipos de TypeScript (Vite no lo hace al compilar): `npm run typecheck`
(o `docker compose exec game npm run typecheck`).

## Jugar en el móvil

Con el servidor de desarrollo arrancado, abre en el móvil (conectado a la misma wifi que el PC)
`http://<IP-del-PC>:<puerto>` (por ejemplo `http://192.168.1.20:5173`; la IP sale con `ipconfig`).
Si Windows pregunta por el firewall, permite el acceso en redes privadas.

- Arrastra y suelta para golpear; **dos dedos** mueven el mapa.
- El primer toque pone el juego a pantalla completa (en iPhone no se puede: usa "Añadir a pantalla de inicio").
- Se puede instalar como app desde el menú del navegador ("Añadir a pantalla de inicio").

## Producción

```bash
docker compose --profile prod up --build game-prod
```

Abre http://localhost:8080 (nginx sirviendo el build estático).

## Estructura

```
src/
  main.ts                 # punto de entrada (espera a la fuente Jersey 10)
  config.ts               # configuración de Phaser (zoom entero según la pantalla)
  constants.ts            # física, materiales y paletas de los mundos
  data/worlds.ts          # los mundos (Pradera, Playa, Pantano…) en orden
  data/worlds/meadow.ts   # los 9 hoyos de la Pradera, dibujados como mapas de texto
  data/levels.ts          # lista plana de hoyos + parser de mapas + textos de mecánicas
  gfx/terrain.ts          # pinta el terreno de un mapa como una sola textura pixel art
  gfx/textures.ts         # sprites e interfaz pixel art (bola, bandera, sierras, botones…)
  gfx/background.ts       # fondo de cuadros de los menús
  systems/audio.ts        # efectos de sonido sintetizados con WebAudio
  systems/progress.ts     # progreso guardado en localStorage
  ui/                     # textos, botones, paneles y cámara
  scenes/                 # Boot, Menu, Worlds (mapa de mundos), LevelSelect (hoyos), Game, UI
  services/supabase.ts    # cliente Supabase + saveScore / getTopScores
supabase/schema.sql       # tabla `scores` con RLS
```

## Cómo se ve

Pixel art plano: terreno de tierra con contorno y vetas, hierba con festón, rampas, charcas de agua
y fondo de cuadros. El mundo lógico mide 240 px de ancho (casillas de 12 px) y las cámaras hacen
zoom entero, así el arte se ve nítido y los textos van a alta resolución.

## Progresión (monedas y mejoras)

Al completar un hoyo se ganan dos cosas:

- **Monedas** (para las mejoras): +3 por terminar, +8 por cada estrella nueva, +5 bajo par y +15 por hoyo en uno.
- **Fichas** (para el gachapón): +1 cada vez que terminas un hoyo y +1 extra si es con 3 estrellas.

En la **Tienda** hay tres pestañas: **Habilidades** (mejoras con monedas; las compradas se pueden encender
y apagar con ON/OFF sin perder niveles), **Gachapón** (3 fichas por tirada: tipos de pelota, skins y rastros
de rareza común, rara, épica o legendaria; sin repetidos: solo sale lo que te falta y las probabilidades se recalculan con tu colección) y **Colección** (equipar pelota,
skin y rastro por separado: cualquier skin y cualquier rastro valen para cualquier tipo de pelota).
Los tipos de pelota cambian la física (agarre, rebote, tamaño, potencia, gravedad, viento, imán del hoyo) y se
suman a las mejoras. Los premios están en `src/data/cosmetics.ts`. Las mejoras:

| Mejora | Efecto |
|---|---|
| Potencia | Golpes hasta un 25 % más fuertes |
| Visor | Trayectoria visible más larga (empieza corta) |
| Agarre | La bola frena antes al aterrizar |
| Imán de hoyo | El hoyo atrae la bola desde más lejos |
| Freno aéreo | Botón (o ESPACIO) que frena la bola en el aire, 1–3 usos por hoyo |
| Salvavidas | Anula la penalización de agua/sierras/caídas, 1–2 por hoyo |

Precios y valores de las mejoras en `src/data/upgrades.ts`;
el guardado (localStorage) en `src/systems/progress.ts`.

## Mundos

El juego se organiza en mundos, cada uno con su aspecto, su música y sus hoyos:

| Mundo | Estado | Mecánicas |
|---|---|---|
| **Pradera** (campo de golf) | 9 hoyos largos (pares 9–18), validados con `npm run maps` | rampas, rough, agua, búnker, setas, plataformas móviles, viento |
| **Playa** | próximamente | — |
| **Pantano** | próximamente | — |

Un mundo se desbloquea al completar todos los hoyos del anterior; dentro de un mundo, cada hoyo se
abre al completar el anterior. El guardado va por id de hoyo (`meadow-3`), así que añadir hoyos o
mundos no rompe el progreso. En Supabase cada hoyo se guarda como `mundo·100 + hoyo` (101, 102…).

**Añadir un mundo:** crea `src/data/worlds/<id>.ts` con sus hoyos, añádelo a `WORLDS` en
`src/data/worlds.ts`, define su paleta en `THEMES` (`src/constants.ts`) y, si quieres, su canción
en `SONGS` (`src/systems/audio.ts`).

## Crear o editar hoyos

Cada hoyo es un mapa de texto de **18 columnas** (las paredes laterales y el suelo se añaden solos).
Fila de arriba = parte alta del hoyo. El césped junto al hoyo se pinta solo como *green*.
Para que llene la pantalla, el mapa debe tener **33 filas o más**.

| Símbolo | Qué es | Símbolo | Qué es |
|---|---|---|---|
| . | vacío | # | tierra con hierba |
| `/` | rampa que sube a la derecha | `\` | rampa que sube a la izquierda |
| r | rough (hierba alta: frena, golpe ×0.8) | = | plataforma fina |
| s | arena (búnker, golpe ×0.75) | | |
| i | hielo | W | agua (+1 golpe) |
| M | seta saltarina (golpe ×1.4) | P | plataforma móvil |
| C | bloque frágil | O | bumper |
| X / Y | sierra fija / móvil | | |
| S | salida | H | hoyo |

Física **Matter.js**: todo el terreno es sólido por todos lados; las casillas se fusionan en
rectángulos grandes y cada diagonal de rampa en un solo triángulo para que la bola ruede sin engancharse.
Estrellas: ≤ par → 3, ≤ par+2 → 2, resto → 1.

## Diseñar hoyos (y comprobar que se pueden jugar)

`npm run maps` simula con la física real del juego (el mismo Matter, sin pantalla) todos los golpes posibles
desde cada sitio donde puede quedar parada la bola, con una cuenta nueva (sin mejoras). Para cada hoyo dice:

- si se puede llegar al hoyo desde la salida y si hay sitios sin salida donde la bola queda atrapada
- el mínimo de golpes y los de un jugador real (con error de unos 3° y un 5 % de potencia) → **par sugerido**
- la ruta recomendada, con la fiabilidad y el riesgo de cada golpe (avisa de golpes demasiado precisos o arriesgados)

```bash
npm run maps                  # todos los hoyos (unos 8-14 min con hoyos largos; uno solo tarda 1-2 min)
npm run maps -- meadow-3 5    # solo esos (por id o por número en la lista)
npm run maps -- 7 --map       # además dibuja la ruta sobre el mapa (S = salida, 2, 3… = desde dónde se golpea)
```

Hace falta Node ≥ 22.18 en tu máquina (no en Docker). Si cambias la física en `GameScene.tick()/update()`,
cambia también `tools/mapcheck/sim.ts`. Las formas del terreno se comparten en `src/data/terrainShapes.ts`.

Reglas que siguen los hoyos de la Pradera (con `MAX_SPEED` 420: un golpe al 100 % sube unas 14 filas; los saltos normales son de 6–8 filas y se resuelven con 75–100 % de potencia):

- recorridos largos (7–17 islas, de ~50 a ~85 filas) y cada hoyo más largo que el anterior
- cada hoyo presenta una mecánica y la repite varias veces a lo largo del recorrido
- saltos de la ruta normal de 6–8 filas de subida; islas de llegada anchas (10+ casillas) y sin otra isla encima. Las islas deben tener grosor 2 (con 3 el hueco entre islas casi iguala a la bola)
- los golpes al 100 % son los más fáciles de ejecutar (el arrastre se topa), así que no son un problema; lo que se vigila es la fiabilidad de cada golpe de la ruta
- plataformas finas `=`: se atraviesan desde abajo, así que un disparo recto sube varias de golpe; conviene intercalar islas macizas o separarlas más de ~14 filas
- setas: pon varias juntas (`MMM`): el hueco de una sola casilla roza con los bordes y los disparos desde ella salen muy imprecisos. Para que la seta sea necesaria, el salto debe superar las ~14 filas que alcanza un golpe normal
- las plataformas finas `=` solo son sólidas por arriba: se atraviesan al subir desde abajo
- el par es el que sugiere la herramienta: golpes del jugador real redondeados

## Rendimiento

- **Tope de fps en pantallas rápidas:** al arrancar se mide el refresco real; con 100 Hz o más el juego se limita a su
  mitad/tercio exacto (144 Hz → 72 fps, 120 Hz → 60, 240 Hz → 60). En 60 Hz no cambia nada (`capFrameRate` en `src/main.ts`).
- **Nada de `Graphics` para formas fijas:** Phaser vuelve a triangular y enviar cada `Graphics` a la GPU en cada fotograma,
  aunque no cambie. Las formas estáticas (carriles, marco de la barra, flecha del hoyo) se pintan una vez con
  `bakeTexture` (`src/gfx/bake.ts`) y se usan como imágenes. Los `Graphics` dinámicos (apuntado, rastro, anillo) se ocultan cuando están vacíos.
- **Física en pausa con la bola parada:** si la bola está lista para golpear y no hay plataformas móviles ni bloques frágiles,
  no se avanza la simulación (`physicsIdle` en `GameScene`).

## Atajos de desarrollo

- `?level=7` entra directamente al hoyo 7 de la lista (Pradera = 1–9)
- `?debug` muestra los cuerpos físicos
- Tecla `R` reinicia el nivel

## Conectar Supabase

1. Crea un proyecto en https://supabase.com.
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Pon `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env` (Project Settings → API).
4. Reinicia el contenedor: `docker compose up`.

El menú muestra si Supabase está conectado. Sin credenciales, el juego funciona offline.

## Controles

Arrastra hacia atrás desde cualquier punto y suelta para golpear la bola (como un tirachinas). Verás la trayectoria prevista y la potencia. Solo puedes golpear cuando la bola está parada (aparece un anillo pulsante). Las plataformas se atraviesan desde abajo.

| Teclado | Acción |
|---|---|
| ← → / A D | Girar la dirección del golpe (MAYÚS = ajuste fino) |
| ↑ ↓ / W S | Más / menos potencia |
| ESPACIO / ENTER | Golpear (si no estás apuntando, empieza a apuntar). En el aire, ESPACIO usa el freno |
| ESC | Cancela el apuntado; si no apuntas, pausa / continúa |
| P | Pausa / continúa |
| R | Reiniciar el hoyo |
| ENTER (al acabar el hoyo) | Siguiente hoyo |

El juego se pausa solo si cambias de pestaña o bloqueas el móvil.

## Ajustes

Desde el engranaje del menú o desde la pausa: volumen de **música** y **efectos**, **vibración** (móviles)
y **temblor** de cámara. Se guardan con el progreso (`src/systems/progress.ts`), que valida los datos al
cargar y mantiene una copia de seguridad en `localStorage`.

La música se genera en tiempo real (`src/systems/audio.ts`): cada mundo tiene su tempo, acordes y escala,
y la melodía se inventa por frases (A A B A) que van cambiando.
