import {
  exists,
  joinPath,
  listFiles,
  parseArgs,
  readJson,
  readText,
  writeJson,
} from "../src/bun-utils.ts";
import { realContext } from "./context.ts";
import { variantsDir, toolName } from "./config.ts";
import {
  benchmarkDataPath,
  injectTool,
  loadBenchmarkData,
  mergeCandidates,
  modelDir,
} from "./martian.ts";
import { phase1Index } from "./index-shapes.ts";
import { listPrs } from "./prs.ts";
import { realReviewVariant, type ReviewVariant } from "./run-review.ts";
import { scoreToolCodex } from "./score.ts";
import type { EvalResult, EvaluationsFile, PrSpec, ReviewComment } from "./types.ts";

// ============================================================================
// Fan-out harness: benchmark MANY shape-review skill variants in ONE sweep.
//
// Each variant is a complete shape-review SKILL.md body under
//   review-bench/artifacts/variants/<id>.md
// The harness runs every (variant × PR × trial) review concurrently (each in its
// own run dir, no shared writes), then SERIALLY injects + scores each variant
// tool (those steps touch shared benchmark_data/candidates/evaluations JSON), and
// prints a ranked leaderboard of per-variant F1 vs the FIXED baseline control.
//
// The baseline (`shapelang-baseline-t*`) is reused from prior runs — it is the
// stable yardstick and is never re-run here. The supported-PR universe is derived
// from the PRs the baseline already covers (guarantees an aligned comparison and
// skips slow `gh` language probing).
//
//   bun run review:fanout                       # all variants, all PRs, t1
//   bun run review:fanout --trials 3            # confirmation depth
//   bun run review:fanout --per-repo 2          # 2 PRs/repo (fast screening)
//   bun run review:fanout --variants v-a,v-b    # subset of variants
//   bun run review:fanout --prs cal.com,grafana # subset by repo/number
// ============================================================================

const args = parseArgs();
const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
const trials = Number(args.trials ?? 1);
const perRepo = args["per-repo"] ? Number(args["per-repo"]) : 0;
const concurrency = Math.max(1, Number(args.concurrency ?? 6));

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
function f1(tp: number, fp: number, fn: number): number {
  const p = tp + fp > 0 ? tp / (tp + fp) : 0;
  const r = tp + fn > 0 ? tp / (tp + fn) : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}
const repoOf = (url: string): string =>
  url.includes("/pull/") ? url.split("/")[url.split("/").length - 3]! : url;

// ---- variants ----
const variantTool = (id: string, trial: number): string => `shapelang-${id}-t${trial}`;

async function loadVariants(): Promise<ReviewVariant[]> {
  const files = (await listFiles(variantsDir)).filter((f) => f.endsWith(".md"));
  const wanted = args.variants ? new Set(args.variants.split(",").map((s) => s.trim())) : null;
  const variants: ReviewVariant[] = [];
  for (const file of files) {
    const id = file.slice(variantsDir.length + 1).replace(/\.md$/, "").replaceAll("/", "-");
    if (wanted && !wanted.has(id)) continue;
    variants.push({ id, skillText: await readText(file) });
  }
  return variants.sort((a, b) => a.id.localeCompare(b.id));
}

// ---- PR universe ----
async function loadEvaluations(): Promise<EvaluationsFile> {
  const path = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "evaluations.json");
  return (await exists(path)) ? readJson<EvaluationsFile>(path) : {};
}

// PRs the fixed baseline already covers (AST-supported, scored). This is the
// comparison universe; it also means baseline reuse is always aligned.
function baselineCoveredUrls(evals: EvaluationsFile): Set<string> {
  const urls = new Set<string>();
  for (const [url, tools] of Object.entries(evals)) {
    for (let trial = 1; trial <= 3; trial += 1) {
      const r = tools[toolName("baseline", trial)];
      if (r && !r.skipped) {
        urls.add(url);
        break;
      }
    }
  }
  return urls;
}

function samplePerRepo(prs: PrSpec[], k: number): PrSpec[] {
  if (k <= 0) return prs;
  const byRepo = new Map<string, PrSpec[]>();
  for (const pr of prs) {
    const list = byRepo.get(pr.repoName) ?? [];
    list.push(pr);
    byRepo.set(pr.repoName, list);
  }
  const out: PrSpec[] = [];
  for (const list of byRepo.values()) {
    list.sort((a, b) => a.prNumber - b.prNumber);
    out.push(...list.slice(0, k));
  }
  return out;
}

// ---- pooled F1 over (url-filter) × trials for a given tool family ----
function pooled(
  evals: EvaluationsFile,
  toolFor: (trial: number) => string,
  maxTrial: number,
  urls: Set<string>,
  urlFilter: (u: string) => boolean,
): { tp: number; fp: number; fn: number; n: number } {
  let tp = 0, fp = 0, fn = 0, n = 0;
  for (const [url, tools] of Object.entries(evals)) {
    if (!urls.has(url) || !urlFilter(url)) continue;
    for (let trial = 1; trial <= maxTrial; trial += 1) {
      const r: EvalResult | undefined = tools[toolFor(trial)];
      if (!r || r.skipped) continue;
      tp += r.tp ?? 0; fp += r.fp ?? 0; fn += r.fn ?? 0; n += 1;
    }
  }
  return { tp, fp, fn, n };
}

// ---- main ----
const data = await loadBenchmarkData(ctx.offlineDir);
const evalsBefore = await loadEvaluations();
const covered = baselineCoveredUrls(evalsBefore);

let prs = listPrs(data, args.prs ? args.prs.split(",") : undefined);
if (covered.size > 0) prs = prs.filter((pr) => covered.has(pr.goldenUrl));
prs = samplePerRepo(prs, perRepo);

const variants = await loadVariants();
if (variants.length === 0) {
  console.error(`no variants found in ${variantsDir} (create review-bench/artifacts/variants/<id>.md)`);
  process.exit(1);
}
const urlSet = new Set(prs.map((p) => p.goldenUrl));
const repos = [...new Set(prs.map((p) => p.repoName))].sort();

console.log(
  `fan-out: ${variants.length} variant(s) × ${prs.length} PR(s) × ${trials} trial(s) ` +
    `= ${variants.length * prs.length * trials} reviews; concurrency=${concurrency}`,
);
console.log(`  variants: ${variants.map((v) => v.id).join(", ")}`);
console.log(`  repos:    ${repos.join(", ")}`);
if (covered.size === 0) console.log("  WARNING: no baseline scores found — leaderboard deltas will be vs 0.");

// Index is one-per-repo and already cached; reuse it (no rebuild).
await phase1Index(ctx, prs, { reuseIndex: true, reindex: false });

// ---- Phase 2: all (variant × pr × trial) reviews, concurrent, no shared writes ----
type Job = { pr: PrSpec; variant: ReviewVariant; trial: number; tool: string };
const jobs: Job[] = [];
for (const variant of variants)
  for (const pr of prs)
    for (let trial = 1; trial <= trials; trial += 1)
      jobs.push({ pr, variant, trial, tool: variantTool(variant.id, trial) });

const total = jobs.length;
const expectedPerTool = prs.length * trials;
const byTool = new Map<string, Map<string, ReviewComment[]>>();
let done = 0;
let failures = 0;
// When the Codex subscription hits its usage limit, EVERY remaining review will
// fail identically and produce nothing (the round-2 trap: empty reviews score as
// real 0.0% F1). Detect that signal and abort the whole sweep so we don't grind
// through hundreds of doomed reviews AND so the leaderboard/scoring step below is
// skipped entirely (an aborted sweep must never be presented as a result).
let usageLimitHit = false;
async function worker(): Promise<void> {
  for (;;) {
    if (usageLimitHit) return;
    const job = jobs.shift();
    if (!job) return;
    let comments: ReviewComment[] | null = null;
    for (let attempt = 1; attempt <= 2 && comments === null && !usageLimitHit; attempt += 1) {
      try {
        comments = await realReviewVariant(ctx, job.pr, job.variant, job.trial);
      } catch (error) {
        const msg = (error as Error).message;
        if (/\[USAGE-LIMIT\/MODEL\]/.test(msg)) {
          if (!usageLimitHit) console.error(`  ABORT: Codex usage limit / model error — stopping sweep.\n  ${msg}`);
          usageLimitHit = true;
        } else if (attempt === 2) {
          failures += 1;
          console.error(`  FAIL ${job.pr.repoName}#${job.pr.prNumber} ${job.tool}: ${msg}`);
        }
      }
    }
    if (comments !== null) {
      if (!byTool.has(job.tool)) byTool.set(job.tool, new Map());
      byTool.get(job.tool)!.set(job.pr.goldenUrl, comments);
    }
    done += 1;
    console.log(`  [${done}/${total}] ${job.pr.repoName}#${job.pr.prNumber} ${job.tool}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

if (usageLimitHit) {
  console.error(
    `\n=== SWEEP ABORTED (Codex usage limit) — nothing scored, no leaderboard written. ===\n` +
      `Re-run after the limit resets. Collected ${done}/${total} reviews before aborting.`,
  );
  process.exit(2);
}

// ---- Serial injection (avoids benchmark_data races), then merge candidates ----
const tools = [...byTool.keys()].sort();
for (const tool of tools) {
  const map = byTool.get(tool)!;
  const benchData = await loadBenchmarkData(ctx.offlineDir);
  injectTool(benchData, tool, map);
  await writeJson(benchmarkDataPath(ctx.offlineDir), benchData);
  await mergeCandidates(joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "candidates.json"), tool, map);
}

// ---- Serial scoring (shared evaluations.json + judge cache → must be serial) ----
for (const tool of tools) {
  console.log(`scoring ${tool} …`);
  try {
    await scoreToolCodex(ctx, tool);
  } catch (error) {
    const msg = (error as Error).message;
    if (/\[USAGE-LIMIT\/MODEL\]/.test(msg)) {
      console.error(
        `\n=== SCORING ABORTED (Codex usage limit during judging) — no leaderboard written. ===\n` +
          `  ${msg}\n` +
          `  Evaluations were written incrementally per PR; NO bogus verdicts were cached ` +
          `(the judge throws instead of caching false). Re-run after the limit resets to finish scoring.`,
      );
      process.exit(2);
    }
    throw error;
  }
}

// ---- Analysis ----
const evals = await loadEvaluations();
const baselineMax = 3;
const base = (filter: (u: string) => boolean) =>
  pooled(evals, (t) => toolName("baseline", t), baselineMax, urlSet, filter);

type Row = Record<string, string | number>;

const rows: Row[] = [];
for (const variant of variants) {
  const vAll = pooled(evals, (t) => variantTool(variant.id, t), trials, urlSet, () => true);
  const bAll = base(() => true);
  const vF1 = f1(vAll.tp, vAll.fp, vAll.fn);
  const bF1 = f1(bAll.tp, bAll.fp, bAll.fn);
  // Coverage: scored entries vs expected (PRs × trials). A variant scored on fewer
  // entries than expected ran into review failures — its F1 is NOT comparable to the
  // baseline and must be read with a loud caveat, never ranked as a clean result.
  const cov = `${vAll.n}/${expectedPerTool}`;
  const row: Row = {
    variant: variant.id,
    overall: pct(vF1),
    delta: `${((vF1 - bF1) * 100).toFixed(1)}`,
    cov,
    n: vAll.n,
  };
  for (const repo of repos) {
    const v = pooled(evals, (t) => variantTool(variant.id, t), trials, urlSet, (u) => repoOf(u) === repo);
    const b = base((u) => repoOf(u) === repo);
    row[repo] = `${((f1(v.tp, v.fp, v.fn) - f1(b.tp, b.fp, b.fn)) * 100).toFixed(1)}`;
  }
  rows.push(row);
}
rows.sort((a, b) => Number(b.delta) - Number(a.delta));

const bAll = base(() => true);
console.log(
  `\n=== baseline (fixed control, n≤3 pooled) overall F1 ${pct(f1(bAll.tp, bAll.fp, bAll.fn))} over ${prs.length} PRs ===`,
);
console.log(`=== variant leaderboard (Δ F1 pts vs baseline; per-repo Δ columns) ===`);
console.table(rows);

const incomplete = rows.filter((r) => Number(r.n) < expectedPerTool);
if (incomplete.length > 0) {
  console.warn(
    `\n⚠️  INCOMPLETE COVERAGE — these variants were scored on fewer than ${expectedPerTool} entries ` +
      `(review failures); their F1 is NOT comparable to baseline:\n` +
      incomplete.map((r) => `   ${r.variant}: ${r.cov}`).join("\n"),
  );
}
if (failures > 0) console.warn(`\n⚠️  ${failures} review(s) failed (non-usage-limit). See FAIL lines above.`);

// ---- Persist a machine-readable report ----
const reportPath = joinPath(ctx.runsDir, `fanout-${Date.now()}.json`);
await writeJson(reportPath, {
  trials,
  perRepo,
  prs: prs.map((p) => p.goldenUrl),
  repos,
  baselineOverallF1: f1(bAll.tp, bAll.fp, bAll.fn),
  variants: rows,
});
console.log(`\nreport: ${reportPath}`);
