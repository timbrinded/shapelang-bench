import { parseArgs } from "../src/bun-utils.ts";
import { realContext } from "./context.ts";
import { loadBenchmarkData } from "./martian.ts";
import { listPrs } from "./prs.ts";
import { phase1Index } from "./index-shapes.ts";
import { phase2Review } from "./run-review.ts";
import { scoreCondition } from "./score.ts";
import { summarizeReview } from "./summarize-review.ts";

// End-to-end sweep over a PR subset: Phase 1 (index) -> Phase 2 (baseline+shape)
// per PR (resilient: a failing PR is logged and skipped), then judge both
// conditions with the Codex judge and print the head-to-head. Built for
// `run_in_background` — progress goes to stdout.
const args = parseArgs();
const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
const data = await loadBenchmarkData(ctx.offlineDir);
const prs = listPrs(data, args.prs ? args.prs.split(",") : undefined);
const reindex = args.reindex === "true";

console.log(`suite: ${prs.length} PR(s); reviewer=${ctx.reviewerModel} judge=${ctx.judgeModel}`);

let ok = 0;
let failed = 0;
for (const pr of prs) {
  const start = Date.now();
  console.log(`\n=== [${ok + failed + 1}/${prs.length}] ${pr.goldenUrl} ===`);
  try {
    await phase1Index(ctx, [pr], { reuseIndex: !reindex, reindex });
    await phase2Review(ctx, [pr], "baseline");
    await phase2Review(ctx, [pr], "shape");
    ok += 1;
    console.log(`done in ${((Date.now() - start) / 1000).toFixed(0)}s`);
  } catch (error) {
    failed += 1;
    console.error(`FAILED ${pr.goldenUrl}: ${(error as Error).message}`);
  }
}

console.log(`\n=== reviews complete: ${ok} ok, ${failed} failed; scoring ===`);
await scoreCondition(ctx, "baseline", "codex");
const evaluations = await scoreCondition(ctx, "shape", "codex");
console.log("\n=== HEAD-TO-HEAD ===");
await summarizeReview(ctx, evaluations);
