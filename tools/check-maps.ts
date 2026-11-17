/**
 * Validador de hoyos: simula todos los golpes posibles con la física real del juego y dice si cada
 * hoyo es jugable, cuántos golpes hacen falta y qué par le corresponde.
 *
 *   npm run maps                 todos los hoyos
 *   npm run maps -- meadow-3 5   solo esos (por id o por número en la lista)
 *   npm run maps -- --map        además pinta la ruta recomendada sobre el mapa
 *
 * Se valida con una cuenta nueva (sin mejoras): cualquier hoyo debe poder jugarse sin comprar nada.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { LEVELS, parseLevel } from '../src/data/levels';
import { explore, drawRoute, shootGrid, type Report } from './mapcheck/explore';
import { LevelSim, type Rest, type Outcome } from './mapcheck/sim';

interface Job { id: number; index: number; rest: Rest }
interface Result { index: number; text: string; ok: boolean; warn: boolean; summary: string }

const pct = (v: number) => `${Math.round(v * 100)}%`.padStart(4);
const deg = (a: number) => `${Math.round(-a)}°`.padStart(4);

function describe(rep: Report, withMap: boolean, index: number): Result {
  const L = parseLevel(index);
  const lines: string[] = [];
  const ok = Number.isFinite(rep.minStrokes) && rep.deadEnds.length === 0 && !rep.capped;
  const shaky = rep.route.filter((s) => s.reliability < 0.5 || s.risk > 0.35);
  const parOff = rep.par !== rep.suggestedPar;
  const warn = ok && (parOff || shaky.length > 0);
  const tag = !ok ? 'ERROR' : warn ? 'AVISO' : 'OK';
  lines.push(`\n[${tag}] ${rep.id} · ${rep.name}`);
  if (!Number.isFinite(rep.minStrokes)) lines.push('  ✗ El hoyo NO se puede alcanzar desde la salida.');
  else {
    lines.push(
      `  golpes: mínimo ${rep.minStrokes} · jugador real ≈ ${rep.expected.toFixed(1)} → par sugerido ${rep.suggestedPar}` +
        (parOff ? `  (ahora par ${rep.par})` : `  (par ${rep.par} ✓)`),
    );
  }
  if (rep.capped) lines.push('  ✗ Demasiados sitios de reposo: exploración cortada (¿islas enormes o rampas sin fondo?)');
  if (rep.deadEnds.length) lines.push(`  ✗ ${rep.deadEnds.length} sitio(s) sin salida (marcados con x): la bola puede quedarse atrapada`);
  lines.push('  ruta recomendada (ángulo sobre la horizontal: 90° = recto arriba, <90 derecha, >90 izquierda):');
  rep.route.forEach((s, i) => {
    const c = (s.node.rest.x / T_).toFixed(1).padStart(5);
    const r = (s.node.rest.y / T_).toFixed(1).padStart(5);
    const res = s.result.k === 'sink' ? '→ ¡dentro!' : s.result.k === 'pen' ? `→ ${s.result.why}` : '';
    const flag = s.reliability < 0.5 ? '  ⚠ golpe muy preciso' : s.risk > 0.35 ? '  ⚠ mucho riesgo' : '';
    lines.push(`   ${String(i + 1).padStart(2)}. desde col ${c} fila ${r}: ${deg(s.angle)} al ${pct(s.power)}  fiable ${pct(s.reliability)}  riesgo ${pct(s.risk)} ${res}${flag}`);
  });
  if (withMap) lines.push(drawRoute(L, rep));
  lines.push(`  (${rep.nodes} sitios, ${rep.shots} golpes simulados)`);
  const summary = `${rep.id.padEnd(10)} ${rep.name.padEnd(14)} par ${String(rep.par).padStart(2)}  sugerido ${String(rep.suggestedPar).padStart(2)}  mín ${String(rep.minStrokes).padStart(2)}  esperado ${rep.expected.toFixed(1).padStart(5)}  ${tag}`;
  return { index, text: lines.join('\n'), ok, warn, summary };
}
const T_ = 12;

if (isMainThread) {
  const args = process.argv.slice(2);
  const withMap = args.includes('--map');
  const picks = args.filter((a) => !a.startsWith('--'));
  const indices = picks.length
    ? picks.map((p) => (/^\d+$/.test(p) ? Number(p) - 1 : LEVELS.findIndex((l) => l.id === p))).filter((i) => i >= 0 && i < LEVELS.length)
    : LEVELS.map((_, i) => i);
  if (!indices.length) {
    console.error('No hay hoyos con ese id. Ids:', LEVELS.map((l) => l.id).join(', '));
    process.exit(2);
  }
  const t0 = performance.now();
  console.log(`Validando ${indices.length} hoyo(s) con la física del juego (cuenta sin mejoras)…`);

  // Pool de workers: cada uno simula la rejilla de golpes desde un sitio de reposo
  const pending = new Map<number, (g: Outcome[][][]) => void>();
  const idle: Worker[] = [];
  const waiting: { job: Job; done: (g: Outcome[][][]) => void }[] = [];
  let nextId = 0;
  const dispatch = () => {
    while (idle.length && waiting.length) {
      const w = idle.pop()!;
      const { job, done } = waiting.shift()!;
      pending.set(job.id, done);
      w.postMessage(job);
    }
  };
  const pool = Array.from({ length: Math.max(1, cpus().length - 1) }, () => {
    const w = new Worker(new URL(import.meta.url));
    w.on('message', ({ id, grid }: { id: number; grid: Outcome[][][] }) => {
      const done = pending.get(id)!;
      pending.delete(id);
      idle.push(w);
      dispatch();
      done(grid);
    });
    w.on('error', (e) => {
      console.error(e);
      process.exit(2);
    });
    idle.push(w);
    return w;
  });
  const shooterFor = (index: number) => (rest: Rest) =>
    new Promise<Outcome[][][]>((done) => {
      waiting.push({ job: { id: nextId++, index, rest }, done });
      dispatch();
    });

  const results = await Promise.all(
    indices.map(async (index) => {
      const rep = await explore(parseLevel(index), shooterFor(index));
      const res = describe(rep, withMap, index);
      console.log(res.text);
      return res;
    }),
  );
  for (const w of pool) await w.terminate();
  console.log('\nResumen');
  for (const r of results) console.log('  ' + r.summary);
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
} else {
  const sims = new Map<number, LevelSim>();
  parentPort!.on('message', ({ id, index, rest }: Job) => {
    let sim = sims.get(index);
    if (!sim) sims.set(index, (sim = new LevelSim(parseLevel(index))));
    parentPort!.postMessage({ id, grid: shootGrid(sim, rest) });
  });
}
