/**
 * Comprueba la partida de fondo del menú sin pantalla: genera hoyos aleatorios y los juega con la IA (DemoPilot.planShot)
 * sobre la misma física del juego. Uso: npm run demo
 */
import { createRequire } from 'node:module';
import { generateDemoHole, DEMO_THEMES } from '../src/systems/demoLevel';
import { DemoSim, type Rest, type MatterLib } from '../src/systems/demoSim';
import { planShot } from '../src/systems/demoPilot';
import { seeded } from '../src/systems/demoLevel';
import { BALL_R, TILE as T } from '../src/constants';

const require = createRequire(import.meta.url);
const LIB = new URL('../node_modules/phaser/src/physics/matter-js/lib/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const M: MatterLib = {
  Engine: require(LIB + 'core/Engine.js'), Events: require(LIB + 'core/Events.js'), Bodies: require(LIB + 'factory/Bodies.js'),
  Body: require(LIB + 'body/Body.js'), Composite: require(LIB + 'body/Composite.js'), Pairs: require(LIB + 'collision/Pairs.js'),
};

const N = Number(process.argv[2] ?? 25);
let total = 0, solved = 0, shotsSum = 0, worstMs = 0, planMsSum = 0, planCount = 0, fails: string[] = [];
for (const theme of DEMO_THEMES) {
  let ok = 0, shots = 0;
  for (let i = 0; i < N; i++) {
    const seed = 1000 * (DEMO_THEMES.indexOf(theme) + 1) + i;
    const { L, stops } = generateDemoHole(theme, seed);
    const sim = new DemoSim(L, M);
    const rand = seeded(seed + 7);
    let rest: Rest = { x: L.start.c * T + T / 2, y: (L.start.r + 1) * T - BALL_R, mat: 'grass' };
    let done = false, n = 0;
    while (!done && n < 30) {
      const t0 = performance.now();
      const gen = planShot(sim, stops, rest, rand);
      let r = gen.next();
      while (!r.done) r = gen.next();
      const ms = performance.now() - t0;
      planMsSum += ms; planCount++; worstMs = Math.max(worstMs, ms);
      const shot = r.value;
      if (!shot) break;
      const o = sim.shoot(rest, shot.angle, shot.power);
      n++;
      if (o.kind === 'sink') done = true;
      else if (o.kind === 'rest') rest = o.rest;
      else rest = { x: L.start.c * T + T / 2, y: (L.start.r + 1) * T - BALL_R, mat: 'grass' }; // agua / fuera: vuelve a la salida (peor caso)
    }
    total++;
    if (done) { ok++; solved++; shots += n; shotsSum += n; } else fails.push(`${theme} #${seed} (${n} golpes)`);
  }
  console.log(`${theme.padEnd(8)} resueltos ${ok}/${N}  golpes de media ${(shots / Math.max(1, ok)).toFixed(1)}`);
}
console.log(`TOTAL ${solved}/${total}  media ${(shotsSum / Math.max(1, solved)).toFixed(1)} golpes | plan: media ${(planMsSum / planCount).toFixed(0)} ms, peor ${worstMs.toFixed(0)} ms`);
if (fails.length) console.log('Sin resolver:', fails.slice(0, 12).join(', '));
