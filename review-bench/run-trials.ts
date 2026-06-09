import { exists, joinPath, parseArgs, readJson } from "../src/bun-utils.ts";
import { realContext } from "./context.ts";
import { reviewConditions, toolName, type ReviewCondition } from "./config.ts";
import { loadBenchmarkData, modelDir } from "./martian.ts";
import { listPrs } from "./prs.ts";
import { changedSourceFiles, phase1Index } from "./index-shapes.ts";
import { phase2Review } from "./run-review.ts";
import { scoreCondition } from "./score.ts";
import type { EvalResult, EvaluationsFile } from "./types.ts";

// Repeated-trials sweep: N independent baseline+shape reviews per PR (the reviewer
// is nondeterministic), each scored under its own trial-suffixed tool, then mean
// F1 ± spread per condition — paired per PR. Built for run_in_background.
const args = parseArgs();
const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
const trials = Number(args.trials ?? 5);
const reindex = args.reindex === "true";
const data = await loadBenchmarkData(ctx.offlineDir);
const requested = listPrs(data, args.prs ? args.prs.split(",") : undefined);

// Language guard: only run PRs whose changed files are in an AST-supported
// language (TS/JS/Go/Python/Rust). Skip Java/Ruby/etc. — no shp AST there.
const prs = [];
for (const pr of requested) {
  if ((await changedSourceFiles(pr)).length > 0) {
    prs.push(pr);
  } else {
    console.log(`skip ${pr.repoName}#${pr.prNumber}: no AST-supported source files (unsupported language)`);
  }
}

console.log(
  `trials=${trials} per condition; PRs=${prs.length}/${requested.length}; reviewer=${ctx.reviewerModel} judge=${ctx.judgeModel}`,
);

// Phase 1 once per PR (cached unless --reindex).
for (const pr of prs) {
  try {
    await phase1Index(ctx, [pr], { reuseIndex: !reindex, reindex });
  } catch (error) {
    console.error(`index FAILED ${pr.goldenUrl}: ${(error as Error).message}`);
  }
}

// Phase 2 + score, per trial, per condition.
for (const pr of prs) {
  for (let trial = 1; trial <= trials; trial += 1) {
    for (const condition of reviewConditions) {
      try {
        await phase2Review(ctx, [pr], condition, trial);
        await scoreCondition(ctx, condition, "codex", trial);
        console.log(`  ${pr.repoName}#${pr.prNumber} ${condition} t${trial} done`);
      } catch (error) {
        console.error(`  ${pr.repoName}#${pr.prNumber} ${condition} t${trial} FAILED: ${(error as Error).message}`);
      }
    }
  }
}

// ---- analysis ----
function f1Of(result?: EvalResult): number | null {
  if (!result || result.skipped) return null;
  const tp = result.tp ?? 0;
  const fp = result.fp ?? 0;
  const fn = result.fn ?? 0;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}
function stats(xs: number[]): { n: number; mean: number; min: number; max: number; sd: number } {
  if (xs.length === 0) return { n: 0, mean: 0, min: 0, max: 0, sd: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { n: xs.length, mean, min: Math.min(...xs), max: Math.max(...xs), sd };
}
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const evaluationsPath = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "evaluations.json");
const evaluations: EvaluationsFile = (await exists(evaluationsPath))
  ? await readJson<EvaluationsFile>(evaluationsPath)
  : {};

const pooled: Record<ReviewCondition, number[]> = { baseline: [], shape: [] };
const rows: Array<Record<string, string | number>> = [];
for (const pr of prs) {
  const url = pr.goldenUrl;
  const row: Record<string, string | number> = { pr: `${pr.repoName}#${pr.prNumber}` };
  for (const condition of reviewConditions) {
    const xs: number[] = [];
    for (let trial = 1; trial <= trials; trial += 1) {
      const value = f1Of(evaluations[url]?.[toolName(condition, trial)]);
      if (value !== null) {
        xs.push(value);
        pooled[condition].push(value);
      }
    }
    const s = stats(xs);
    row[`${condition} mean`] = pct(s.mean);
    row[`${condition} range`] = `${pct(s.min)}–${pct(s.max)}`;
    row[`${condition} n`] = s.n;
  }
  rows.push(row);
}

console.log("\n=== PER-PR (mean F1 across trials) ===");
console.table(rows);

console.log("=== OVERALL (pooled PRs × trials) ===");
for (const condition of reviewConditions) {
  const s = stats(pooled[condition]);
  console.log(
    `  ${condition.padEnd(8)} mean F1 ${pct(s.mean)}  (sd ${pct(s.sd)}, range ${pct(s.min)}–${pct(s.max)}, n=${s.n})`,
  );
}
const baseline = stats(pooled.baseline);
const shape = stats(pooled.shape);
console.log(
  `\n  shape − baseline mean F1: ${((shape.mean - baseline.mean) * 100).toFixed(1)} pts ` +
    `(baseline ${pct(baseline.mean)} → shape ${pct(shape.mean)})`,
);
