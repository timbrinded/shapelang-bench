import { levels as allLevels, runsDir } from "./config.ts";
import { basename, exists, joinPath, listFiles, parseArgs, readJson, writeJson } from "./bun-utils.ts";

// Analysis for the constraint-decay experiment. Two evaluation axes, per the
// paper: behavioral Assert% and static structural compliance. Decay = drop from
// L0 to the deepest level. Question: does the shapelang arm decay less / hold
// structural compliance better than control?

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
  level: string;
  assert: number | null;
  rigFailure: boolean;
  failureClass: string;
  structurePassed: boolean | null;
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
        level: e.level,
        assert: e.functionalPassRate ?? null,
        rigFailure: Boolean(e.rigFailure),
        failureClass: e.failureClass ?? "unknown",
        structurePassed: e.structure?.passed ?? null,
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

const evals = await loadEvals(expRoot);
if (evals.length === 0) {
  console.log(`No evaluations under ${expRoot}. Run: bun src/bench.ts --experiment ${experiment} ...`);
  process.exit(0);
}

const tasks = [...new Set(evals.map((e) => e.taskId))].sort();
const conditions = [...new Set(evals.map((e) => e.condition))];
const presentLevels = allLevels.filter((l) => evals.some((e) => e.level === l));
const firstLevel = presentLevels[0];
const lastLevel = presentLevels[presentLevels.length - 1];

// Non-rig assertion rates for a cell.
function asserts(task: string, condition: string, level: string): number[] {
  return evals
    .filter((e) => e.taskId === task && e.condition === condition && e.level === level && !e.rigFailure && e.assert !== null)
    .map((e) => e.assert as number);
}
function structRate(task: string, condition: string, level: string): number {
  const rows = evals.filter((e) => e.taskId === task && e.condition === condition && e.level === level && !e.rigFailure && e.structurePassed !== null);
  return rows.length ? rows.filter((e) => e.structurePassed).length / rows.length : NaN;
}
function shapeRate(task: string, condition: string, level: string): number {
  const rows = evals.filter((e) => e.taskId === task && e.condition === condition && e.level === level && e.shapeConformant !== null);
  return rows.length ? rows.filter((e) => e.shapeConformant).length / rows.length : NaN;
}

// Per-cell table.
const cellRows: any[] = [];
for (const task of tasks) {
  for (const condition of conditions) {
    for (const level of presentLevels) {
      const all = evals.filter((e) => e.taskId === task && e.condition === condition && e.level === level);
      if (!all.length) continue;
      const a = asserts(task, condition, level);
      const [lo, hi] = bootstrapCI(a, bootstrapIterations);
      cellRows.push({
        task,
        condition,
        level,
        trials: all.length,
        measured: a.length,
        rigFail: all.filter((e) => e.rigFailure).length,
        assertMean: round(mean(a), 3),
        ci95: `[${round(lo, 3)}, ${round(hi, 3)}]`,
        structPassRate: round(structRate(task, condition, level), 2),
        shapeConfRate: round(shapeRate(task, condition, level), 2),
      });
    }
  }
}
console.log(`\n=== Per-cell: behavioral Assert% + structural compliance + shp conformance — '${experiment}' ===`);
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

// Decay trajectory + verdict.
const decayRows: any[] = [];
const verdicts: any[] = [];
for (const task of tasks) {
  for (const condition of conditions) {
    const traj = presentLevels.map((l) => `${l}:${round(mean(asserts(task, condition, l)), 2)}`).join(" ");
    const structTraj = presentLevels.map((l) => `${l}:${round(structRate(task, condition, l), 2)}`).join(" ");
    const decay = round(mean(asserts(task, condition, firstLevel)) - mean(asserts(task, condition, lastLevel)), 3);
    decayRows.push({ task, condition, assert: traj, decayL0toLn: decay, structure: structTraj });
  }

  // Verdict: does shapelang reduce decay vs control? (per task, at the deepest level)
  const ctlLast = asserts(task, "control", lastLevel);
  const shpLast = asserts(task, "shapelang", lastLevel);
  const ctlDecay = mean(asserts(task, "control", firstLevel)) - mean(asserts(task, "control", lastLevel));
  const shpDecay = mean(asserts(task, "shapelang", firstLevel)) - mean(asserts(task, "shapelang", lastLevel));
  const underpowered = ctlLast.length < MIN_TRIALS || shpLast.length < MIN_TRIALS;

  let status: string;
  if (!ctlLast.length || !shpLast.length) {
    status = "insufficient-data";
  } else if (!(ctlDecay > DECAY_EPS)) {
    status = "no-decay"; // control didn't degrade -> nothing to rescue on this task
  } else {
    const pAssert = permutationTest(ctlLast, shpLast, permutationIterations);
    const better = mean(shpLast) - mean(ctlLast) > 0 && pAssert < ALPHA && shpDecay < ctlDecay;
    status = better ? "shapelang-reduces-decay" : "shapelang-not-supported";
  }
  verdicts.push({
    task,
    status,
    underpowered,
    controlDecay: round(ctlDecay, 3),
    shapelangDecay: round(shpDecay, 3),
    [`control@${lastLevel}`]: round(mean(ctlLast), 3),
    [`shapelang@${lastLevel}`]: round(mean(shpLast), 3),
    deltaAssert: round(mean(shpLast) - mean(ctlLast), 3),
    pAssert: ctlLast.length && shpLast.length ? round(permutationTest(ctlLast, shpLast, permutationIterations), 4) : NaN,
    [`structControl@${lastLevel}`]: round(structRate(task, "control", lastLevel), 2),
    [`structShapelang@${lastLevel}`]: round(structRate(task, "shapelang", lastLevel), 2),
  });
}
console.log(`\n=== Constraint-decay trajectories (Assert% and structural compliance, ${firstLevel}->${lastLevel}) ===`);
console.table(decayRows);
console.log(`\n=== Pre-registered verdicts: does shapelang reduce constraint decay vs control? (underpowered = n<${MIN_TRIALS}) ===`);
console.table(verdicts);

await writeJson(joinPath(expRoot, "analysis.json"), {
  experiment,
  evaluatedRuns: evals.length,
  cells: cellRows,
  rigHealth: [...rigByCond.entries()].map(([condition, r]) => ({ condition, runs: r.total, rigRate: round(r.rig / r.total) })),
  decay: decayRows,
  verdicts,
  generatedAt: new Date().toISOString(),
});
console.log(`\nwrote analysis to ${joinPath(expRoot, "analysis.json")}`);
