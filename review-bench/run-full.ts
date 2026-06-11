import { exists, joinPath, parseArgs, readJson, writeJson } from "../src/bun-utils.ts";
import { realContext } from "./context.ts";
import { reviewConditions, toolName } from "./config.ts";
import {
  benchmarkDataPath,
  injectTool,
  loadBenchmarkData,
  mergeCandidates,
  modelDir,
} from "./martian.ts";
import { changedSourceFiles, phase1Index } from "./index-shapes.ts";
import { assertRealRunPrereqs } from "./preflight.ts";
import { listPrs } from "./prs.ts";
import { realReview } from "./run-review.ts";
import { scoreCondition } from "./score.ts";
import type { EvalResult, EvaluationsFile, ReviewComment } from "./types.ts";

// Full Martian sweep with trials. Index each supported repo ONCE, run all supported
// PRs (chosen conditions) N times with bounded concurrency, score with the Codex
// judge, and print per-repo shape-vs-baseline (trial-pooled) + a published leaderboard.
// Baseline is a fixed control: run it once (--conditions baseline) and reuse; iterate
// the shape skill with --conditions shape.
const args = parseArgs();
const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
await assertRealRunPrereqs({ needShp: true });
const concurrency = Number(args.concurrency ?? 4);
const trials = Number(args.trials ?? 1);
const reindex = args.reindex === "true";
const conditions = (args.conditions ? args.conditions.split(",") : [...reviewConditions]) as Array<
  (typeof reviewConditions)[number]
>;
const publishedModel = args["published-model"] ?? "openai/gpt-5.2";
const publishedTools = (
  args.published ??
  "coderabbit,bugbot,greptile,qodo,copilot,devin,augment,claude-code,macroscope,baz,gemini,sourcery"
).split(",");

const data = await loadBenchmarkData(ctx.offlineDir);
const requested = listPrs(data, args.prs ? args.prs.split(",") : undefined);

const prs = [];
for (const pr of requested) {
  if ((await changedSourceFiles(pr)).length > 0) prs.push(pr);
}
console.log(
  `full sweep: ${prs.length}/${requested.length} supported PRs; conditions=${conditions.join("+")}; trials=${trials}; concurrency=${concurrency}`,
);

await phase1Index(ctx, prs, { reuseIndex: !reindex, reindex });

// Phase 2 — all (pr × condition × trial) review calls, concurrent, no shared writes.
type Job = { pr: (typeof prs)[number]; condition: (typeof reviewConditions)[number]; trial: number };
const jobs: Job[] = [];
for (const pr of prs)
  for (const condition of conditions)
    for (let trial = 1; trial <= trials; trial += 1) jobs.push({ pr, condition, trial });

const byTool = new Map<string, Map<string, ReviewComment[]>>();
let done = 0;
let failures = 0;
// Mirror of run-fanout.ts: when the Codex subscription hits its usage limit,
// every remaining review fails identically; abort the sweep so a partial run is
// never injected or presented as a result (this regenerates the FIXED baseline,
// so silent degradation here would poison every future shape-vs-baseline delta).
let usageLimitHit = false;
async function worker(): Promise<void> {
  for (;;) {
    if (usageLimitHit) return;
    const job = jobs.shift();
    if (!job) return;
    const tool = toolName(job.condition, job.trial);
    let comments: ReviewComment[] | null = null;
    for (let attempt = 1; attempt <= 2 && comments === null && !usageLimitHit; attempt += 1) {
      try {
        comments = await realReview(ctx, job.pr, job.condition, job.trial);
      } catch (error) {
        const msg = (error as Error).message;
        if (/\[USAGE-LIMIT\/MODEL\]/.test(msg)) {
          if (!usageLimitHit) console.error(`  ABORT: Codex usage limit / model error — stopping sweep.\n  ${msg}`);
          usageLimitHit = true;
        } else if (attempt === 2) {
          failures += 1;
          console.error(`  FAIL ${job.pr.repoName}#${job.pr.prNumber} ${tool}: ${msg}`);
        }
      }
    }
    if (comments !== null) {
      if (!byTool.has(tool)) byTool.set(tool, new Map());
      byTool.get(tool)!.set(job.pr.goldenUrl, comments);
    }
    done += 1;
    console.log(`  [${done}/${jobs.length + done}] ${job.pr.repoName}#${job.pr.prNumber} ${tool}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

if (usageLimitHit) {
  console.error(
    `\n=== SWEEP ABORTED (Codex usage limit) — nothing scored, no leaderboard written. ===\n` +
      `Re-run after the limit resets. Collected ${done}/${jobs.length + done} reviews before aborting.`,
  );
  process.exit(2);
}

// Serial injection (avoids benchmark_data races), then score each tool.
for (const condition of conditions) {
  for (let trial = 1; trial <= trials; trial += 1) {
    const tool = toolName(condition, trial);
    const map = byTool.get(tool);
    if (!map) continue;
    const benchData = await loadBenchmarkData(ctx.offlineDir);
    injectTool(benchData, tool, map);
    await writeJson(benchmarkDataPath(ctx.offlineDir), benchData);
    await mergeCandidates(joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "candidates.json"), tool, map);
  }
}
for (const condition of conditions)
  for (let trial = 1; trial <= trials; trial += 1) await scoreCondition(ctx, condition, "codex", trial);

// ---- analysis ----
const evalPath = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "evaluations.json");
const evals: EvaluationsFile = (await exists(evalPath)) ? await readJson<EvaluationsFile>(evalPath) : {};
const urls = new Set(prs.map((pr) => pr.goldenUrl));
const repoOf = (url: string) => (url.includes("/pull/") ? url.split("/")[url.split("/").length - 3]! : url);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function f1(tp: number, fp: number, fn: number): number {
  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}
// Pool tp/fp/fn over (urls matching filter) × trials for a condition.
function pooled(
  condition: (typeof reviewConditions)[number],
  urlFilter: (u: string) => boolean,
): { tp: number; fp: number; fn: number; n: number } {
  let tp = 0, fp = 0, fn = 0, n = 0;
  for (const [url, tools] of Object.entries(evals)) {
    if (!urls.has(url) || !urlFilter(url)) continue;
    for (let trial = 1; trial <= trials; trial += 1) {
      const r: EvalResult | undefined = tools[toolName(condition, trial)];
      if (!r || r.skipped) continue;
      tp += r.tp ?? 0; fp += r.fp ?? 0; fn += r.fn ?? 0; n += 1;
    }
  }
  return { tp, fp, fn, n };
}

const repos = [...new Set([...urls].map(repoOf))].sort();
console.log(`\n=== per-repo shape vs baseline (trial-pooled F1, n=${trials}) ===`);
const rows = repos.map((repo) => {
  const b = pooled("baseline", (u) => repoOf(u) === repo);
  const s = pooled("shape", (u) => repoOf(u) === repo);
  return {
    repo,
    samples: `${b.n}|${s.n}`,
    baseF1: pct(f1(b.tp, b.fp, b.fn)),
    shapeF1: pct(f1(s.tp, s.fp, s.fn)),
    delta: `${((f1(s.tp, s.fp, s.fn) - f1(b.tp, b.fp, b.fn)) * 100).toFixed(1)}`,
  };
});
const bAll = pooled("baseline", () => true);
const sAll = pooled("shape", () => true);
rows.push({
  repo: "OVERALL",
  samples: `${bAll.n}|${sAll.n}`,
  baseF1: pct(f1(bAll.tp, bAll.fp, bAll.fn)),
  shapeF1: pct(f1(sAll.tp, sAll.fp, sAll.fn)),
  delta: `${((f1(sAll.tp, sAll.fp, sAll.fn) - f1(bAll.tp, bAll.fp, bAll.fn)) * 100).toFixed(1)}`,
});
console.table(rows);

// Coverage caveat (mirror of run-fanout.ts): a condition scored on fewer
// entries than (PRs × trials) ran into review failures — its F1 is NOT
// comparable and must never be read as a clean result.
const expectedPerCondition = prs.length * trials;
const shortfalls = conditions
  .map((condition) => ({ condition, n: pooled(condition, () => true).n }))
  .filter(({ n }) => n < expectedPerCondition);
if (shortfalls.length > 0) {
  console.warn(
    `\n⚠️  INCOMPLETE COVERAGE — these conditions were scored on fewer than ${expectedPerCondition} entries ` +
      `(review failures); their F1 is NOT comparable:\n` +
      shortfalls.map(({ condition, n }) => `   ${condition}: ${n}/${expectedPerCondition}`).join("\n"),
  );
}
if (failures > 0) console.warn(`\n⚠️  ${failures} review(s) failed (non-usage-limit). See FAIL lines above.`);

// Leaderboard vs published (our tools pooled over trials; published n=1).
const board: Array<{ tool: string; f1: number; judge: string }> = [];
for (const condition of reviewConditions) {
  const a = pooled(condition, () => true);
  board.push({ tool: toolName(condition), f1: f1(a.tp, a.fp, a.fn), judge: ctx.judgeModel });
}
const publishedPath = joinPath(modelDir(ctx.offlineDir, publishedModel), "evaluations.json");
if (await exists(publishedPath)) {
  const pub: EvaluationsFile = await readJson(publishedPath);
  for (const tool of publishedTools) {
    let tp = 0, fp = 0, fn = 0, n = 0;
    for (const [url, tools] of Object.entries(pub)) {
      if (!urls.has(url)) continue;
      const r = tools[tool];
      if (!r || r.skipped) continue;
      tp += r.tp ?? 0; fp += r.fp ?? 0; fn += r.fn ?? 0; n += 1;
    }
    if (n > 0) board.push({ tool, f1: f1(tp, fp, fn), judge: publishedModel });
  }
}
board.sort((a, b) => b.f1 - a.f1);
console.log(`\n=== leaderboard over ${urls.size} PRs (ours judge=${ctx.judgeModel}; published=${publishedModel}) ===`);
console.table(board.map((r, i) => ({ rank: i + 1, tool: r.tool, F1: pct(r.f1), judge: r.judge })));
