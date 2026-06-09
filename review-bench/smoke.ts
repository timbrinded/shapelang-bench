import {
  exists,
  joinPath,
  makeDir,
  modifiedTime,
  parseArgs,
  readJson,
  tempDir,
  writeJson,
} from "../src/bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import { smokeFixturesDir, toolName } from "./config.ts";
import { benchmarkDataPath, loadBenchmarkData, modelDir } from "./martian.ts";
import { listPrs } from "./prs.ts";
import { phase1Index } from "./index-shapes.ts";
import { phase2Review } from "./run-review.ts";
import { scoreCondition } from "./score.ts";
import { summarizeReview } from "./summarize-review.ts";
import { aggregateTool } from "./scoring.ts";
import type { BenchmarkData, EvaluationsFile } from "./types.ts";

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ ${message}`);
    failures += 1;
  }
}
function approx(a: number, b: number, tol = 0.001): boolean {
  return Math.abs(a - b) < tol;
}

// Hermetic end-to-end smoke: runs Phase 1 -> Phase 2 -> score(stub) -> summarize
// against tiny fixtures and asserts the known oracle. No network/model spend.
async function hermetic(): Promise<void> {
  console.log("== hermetic smoke (no network, no model) ==");
  const scratch = await tempDir("review-smoke-");
  const offlineDir = joinPath(scratch, "offline");
  await makeDir(joinPath(offlineDir, "results"));

  const fixtureData = await readJson<BenchmarkData>(joinPath(smokeFixturesDir, "benchmark_data.json"));
  await writeJson(benchmarkDataPath(offlineDir), fixtureData);

  const ctx: ReviewContext = {
    offlineDir,
    indexDir: joinPath(scratch, "index"),
    runsDir: joinPath(scratch, "runs"),
    judgeModel: "stub-judge",
    reviewerModel: "smoke",
    smoke: true,
    timeoutMs: 60_000,
  };

  const prs = listPrs(await loadBenchmarkData(ctx.offlineDir));
  check(prs.length >= 1, `enumerated ${prs.length} fixture PR(s)`);

  // Phase 1 + cache behaviour.
  const built = await phase1Index(ctx, prs, { reuseIndex: true, reindex: false });
  const indexKeyName = [...built.keys()][0]!;
  const marker = joinPath(built.get(indexKeyName)!, "INDEX.json");
  check(await exists(marker), "Phase 1 wrote an index marker");
  const mtimeBefore = await modifiedTime(marker);
  await phase1Index(ctx, prs, { reuseIndex: true, reindex: false });
  check((await modifiedTime(marker)) === mtimeBefore, "Phase 1 reused the cached index (no rebuild)");

  // Phase 2 for both conditions.
  await phase2Review(ctx, prs, "baseline");
  await phase2Review(ctx, prs, "shape");
  const data = await loadBenchmarkData(ctx.offlineDir);
  const firstEntry = Object.values(data)[0]!;
  const tools = new Set(firstEntry.reviews.map((review) => review.tool));
  check(tools.has(toolName("baseline")) && tools.has(toolName("shape")), "Phase 2 injected both tools into benchmark_data");
  check(await exists(joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "candidates.json")), "Phase 2 wrote candidates.json");

  // Score (stub judge) + summarize.
  await scoreCondition(ctx, "baseline", "stub");
  const evaluations: EvaluationsFile = await scoreCondition(ctx, "shape", "stub");
  check(
    await exists(joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "evaluations.json")),
    "score wrote evaluations.json",
  );

  console.log("-- summary --");
  await summarizeReview(ctx, evaluations);

  // Oracle: shape = 1 tp / 1 fp / 0 fn -> P 0.5, R 1.0, F1 0.667.
  const shape = aggregateTool(evaluations, toolName("shape"));
  check(shape.tp === 1 && shape.fp === 1 && shape.fn === 0, `shape tp/fp/fn = 1/1/0 (got ${shape.tp}/${shape.fp}/${shape.fn})`);
  check(approx(shape.precision, 0.5), `shape precision 0.5 (got ${shape.precision.toFixed(3)})`);
  check(approx(shape.recall, 1.0), `shape recall 1.0 (got ${shape.recall.toFixed(3)})`);
  check(approx(shape.f1, 2 / 3), `shape F1 0.667 (got ${shape.f1.toFixed(3)})`);

  // Baseline catches nothing in the fixture -> shape strictly improves.
  const baseline = aggregateTool(evaluations, toolName("baseline"));
  check(baseline.tp === 0, `baseline tp = 0 (got ${baseline.tp})`);
  check(shape.f1 > baseline.f1, "shape F1 > baseline F1");
}

// Live smoke: one real PR through the real rig (Codex + shp + gh + uv + judge).
async function live(args: Record<string, string>): Promise<void> {
  console.log("== live smoke (1 real PR; needs shp, gh, uv, MARTIAN_API_KEY) ==");
  const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
  const data = await loadBenchmarkData(ctx.offlineDir);
  const subset = args.prs ? args.prs.split(",") : [listPrs(data)[0]!.goldenUrl];
  const prs = listPrs(data, subset).slice(0, 1);
  check(prs.length === 1, `selected 1 PR: ${prs[0]?.goldenUrl}`);

  await phase1Index(ctx, prs, { reuseIndex: true, reindex: args.reindex === "true" });
  await phase2Review(ctx, prs, "baseline");
  await phase2Review(ctx, prs, "shape");
  await scoreCondition(ctx, "baseline", "codex");
  const evaluations = await scoreCondition(ctx, "shape", "codex");
  await summarizeReview(ctx, evaluations);
}

const args = parseArgs();
if (args.live === "true") {
  await live(args);
} else {
  await hermetic();
}

if (failures > 0) {
  console.error(`\nSMOKE FAILED: ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("\nSMOKE PASSED");
}
