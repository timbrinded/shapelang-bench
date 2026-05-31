import { runsDir } from "./config.ts";
import { basename, exists, joinPath, listFiles, parseArgs, readJson, writeJson } from "./bun-utils.ts";

// Analysis for the corrected experiment: conformance to the ORIGINAL spec as a
// function of generation, control vs shapelang. Decay = drop from gen 0 to the
// final generation. The hypothesis is that shapelang decays less.

const args = parseArgs();
const experiment = args.experiment ?? "decay";
const expRoot = joinPath(runsDir, experiment);
const bootstrapIterations = Number(args.bootstrap ?? 5000);
const permutationIterations = Number(args.permutations ?? 10000);
const MIN_TRIALS = Number(args.minTrials ?? 5);
const DECAY_EPS = 0.02;
const ALPHA = 0.05;

type Eval = {
  taskId: string;
  condition: string;
  generation: number | null;
  functionalPassRate: number | null;
  rigFailure: boolean;
  failureClass: string;
  shapeConformant: boolean | null;
};

async function loadEvals(root: string): Promise<Eval[]> {
  if (!(await exists(root))) return [];
  const files = (await listFiles(root)).filter((f) => basename(f) === "evaluation.json");
  const out: Eval[] = [];
  for (const file of files) {
    try {
      const e = await readJson<any>(file);
      out.push({
        taskId: e.taskId,
        condition: e.condition ?? "control",
        generation: e.generation ?? null,
        functionalPassRate: e.functionalPassRate ?? null,
        rigFailure: Boolean(e.rigFailure),
        failureClass: e.failureClass ?? "unknown",
        shapeConformant: e.structure?.shape?.conformant ?? null,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const round = (x: number, dp = 4) => (Number.isFinite(x) ? Number(x.toFixed(dp)) : NaN);

function bootstrapCI(xs: number[], iterations: number, alpha = 0.05): [number, number] {
  if (xs.length === 0) return [NaN, NaN];
  if (xs.length === 1) return [xs[0], xs[0]];
  const means: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let s = 0;
    for (let j = 0; j < xs.length; j += 1) s += xs[Math.floor(Math.random() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor((alpha / 2) * means.length)], means[Math.min(means.length - 1, Math.floor((1 - alpha / 2) * means.length))]];
}

function permutationTest(a: number[], b: number[], iterations: number): number {
  if (!a.length || !b.length) return NaN;
  const observed = Math.abs(mean(a) - mean(b));
  const pooled = [...a, ...b];
  const nA = a.length;
  let extreme = 0;
  for (let i = 0; i < iterations; i += 1) {
    for (let j = pooled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(Math.random() * (j + 1));
      [pooled[j], pooled[k]] = [pooled[k], pooled[j]];
    }
    if (Math.abs(mean(pooled.slice(0, nA)) - mean(pooled.slice(nA))) >= observed - 1e-12) extreme += 1;
  }
  return (extreme + 1) / (iterations + 1);
}

function slope(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return NaN;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? NaN : num / den;
}

const evals = await loadEvals(expRoot);
if (evals.length === 0) {
  console.log(`No evaluations under ${expRoot}. Run: bun src/bench.ts --experiment ${experiment} ...`);
  process.exit(0);
}

const tasks = [...new Set(evals.map((e) => e.taskId))].sort();
const conditions = [...new Set(evals.map((e) => e.condition))];
const gens = [...new Set(evals.filter((e) => e.generation !== null).map((e) => e.generation as number))].sort((a, b) => a - b);

// rates(task, condition, gen) -> functional pass rates (rig failures excluded).
function rates(task: string, condition: string, gen: number): number[] {
  return evals
    .filter((e) => e.taskId === task && e.condition === condition && e.generation === gen && !e.rigFailure && e.functionalPassRate !== null)
    .map((e) => e.functionalPassRate as number);
}

// Per-cell table.
const cellRows: any[] = [];
for (const task of tasks) {
  for (const condition of conditions) {
    for (const gen of gens) {
      const r = rates(task, condition, gen);
      const all = evals.filter((e) => e.taskId === task && e.condition === condition && e.generation === gen);
      if (all.length === 0) continue;
      const [lo, hi] = bootstrapCI(r, bootstrapIterations);
      const shapeApplicable = all.filter((e) => e.shapeConformant !== null);
      cellRows.push({
        task,
        condition,
        gen,
        trials: all.length,
        measured: r.length,
        rigFail: all.filter((e) => e.rigFailure).length,
        origConformance: round(mean(r), 3),
        ci95: `[${round(lo, 3)}, ${round(hi, 3)}]`,
        shapeConformantRate: shapeApplicable.length ? round(shapeApplicable.filter((e) => e.shapeConformant).length / shapeApplicable.length, 2) : "n/a",
      });
    }
  }
}
console.log(`\n=== Original-spec conformance by generation (rig failures excluded) — '${experiment}' ===`);
console.table(cellRows);

// Rig health (validity gate).
const rigByCond = new Map<string, { total: number; rig: number; classes: Record<string, number> }>();
for (const e of evals) {
  const r = rigByCond.get(e.condition) ?? { total: 0, rig: 0, classes: {} };
  r.total += 1;
  if (e.rigFailure) r.rig += 1;
  r.classes[e.failureClass] = (r.classes[e.failureClass] ?? 0) + 1;
  rigByCond.set(e.condition, r);
}
console.log(`\n=== Rig health by condition (must be low + balanced) ===`);
console.table([...rigByCond.entries()].map(([condition, r]) => ({ condition, runs: r.total, rigFailures: r.rig, rigRate: round(r.rig / r.total), classes: Object.entries(r.classes).map(([k, v]) => `${k}:${v}`).join(" ") })));

// Trajectories + decay + control-vs-shapelang contrast.
const finalGen = gens.length ? gens[gens.length - 1] : 0;
const traj: any[] = [];
const verdicts: any[] = [];
for (const task of tasks) {
  for (const condition of conditions) {
    const pts = gens.map((g) => ({ x: g, y: mean(rates(task, condition, g)) })).filter((p) => Number.isFinite(p.y));
    if (pts.length) {
      traj.push({
        task,
        condition,
        gen0: round(pts[0].y, 3),
        genFinal: round(pts[pts.length - 1].y, 3),
        decay: round(pts[0].y - pts[pts.length - 1].y, 3),
        slopePerGen: round(slope(pts), 4),
        points: pts.map((p) => `g${p.x}:${round(p.y, 2)}`).join(" "),
      });
    }
  }

  // Verdict: shapelang reduces original-spec decay vs control.
  const ctlFinal = rates(task, "control", finalGen);
  const shpFinal = rates(task, "shapelang", finalGen);
  const ctlPts = gens.map((g) => ({ x: g, y: mean(rates(task, "control", g)) })).filter((p) => Number.isFinite(p.y));
  const shpPts = gens.map((g) => ({ x: g, y: mean(rates(task, "shapelang", g)) })).filter((p) => Number.isFinite(p.y));
  const ctlDecay = ctlPts.length >= 2 ? ctlPts[0].y - ctlPts[ctlPts.length - 1].y : NaN;
  const shpDecay = shpPts.length >= 2 ? shpPts[0].y - shpPts[shpPts.length - 1].y : NaN;
  const underpowered = ctlFinal.length < MIN_TRIALS || shpFinal.length < MIN_TRIALS;

  let status: string;
  if (!ctlFinal.length || !shpFinal.length) {
    status = "insufficient-data";
  } else if (!(ctlDecay > DECAY_EPS)) {
    status = "no-decay"; // control did not degrade across generations on this task
  } else {
    const pFinal = permutationTest(ctlFinal, shpFinal, permutationIterations);
    const shapelangBetter = mean(shpFinal) - mean(ctlFinal) > 0 && pFinal < ALPHA && shpDecay < ctlDecay;
    status = shapelangBetter ? "shapelang-reduces-decay" : "shapelang-not-supported";
  }
  verdicts.push({
    task,
    status,
    underpowered,
    controlDecay: round(ctlDecay, 3),
    shapelangDecay: round(shpDecay, 3),
    controlFinal: round(mean(ctlFinal), 3),
    shapelangFinal: round(mean(shpFinal), 3),
    deltaFinal: round(mean(shpFinal) - mean(ctlFinal), 3),
    pFinal: ctlFinal.length && shpFinal.length ? round(permutationTest(ctlFinal, shpFinal, permutationIterations), 4) : NaN,
  });
}
console.log(`\n=== Per (task,condition) original-spec conformance trajectory + decay ===`);
console.table(traj);
console.log(`\n=== Pre-registered verdicts: does shapelang reduce original-spec decay vs control? (underpowered = n<${MIN_TRIALS}) ===`);
console.table(verdicts);

await writeJson(joinPath(expRoot, "analysis.json"), {
  experiment,
  evaluatedRuns: evals.length,
  cells: cellRows,
  rigHealth: [...rigByCond.entries()].map(([condition, r]) => ({ condition, runs: r.total, rigRate: round(r.rig / r.total) })),
  trajectories: traj,
  verdicts,
  generatedAt: new Date().toISOString(),
});
console.log(`\nwrote analysis to ${joinPath(expRoot, "analysis.json")}`);
