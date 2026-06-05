import {
  exists,
  joinPath,
  parseArgs,
  readJson,
  readText,
  removePath,
  runProcess,
  writeJson,
  writeText,
} from "../bun-utils.ts";
import { realContext, type ReviewContext } from "./context.ts";
import {
  reviewConditions,
  smokeFixturesDir,
  toolName,
  type ReviewCondition,
} from "./config.ts";
import {
  benchmarkDataPath,
  injectTool,
  loadBenchmarkData,
  mergeCandidates,
  modelDir,
} from "./martian.ts";
import { indexKey, listPrs } from "./prs.ts";
import { indexDirFor, resolveBaseSha, writeShpShim } from "./index-shapes.ts";
import { runCodexAgent } from "./agent.ts";
import { buildReviewPrompt, parseReviewComments } from "./skill-prompt.ts";
import type { PrSpec, ReviewComment } from "./types.ts";

// Smoke driver: read a canned reviewer output from fixtures (no Codex/gh/shp).
async function smokeReview(condition: ReviewCondition): Promise<ReviewComment[]> {
  const path = joinPath(smokeFixturesDir, `review-${condition}.json`);
  const items = await readJson<Array<{ path?: string | null; line?: number | null; body: string }>>(
    path,
  );
  return items.map((item) => ({
    path: item.path ?? null,
    line: item.line ?? null,
    body: item.body,
    created_at: null,
  }));
}

// Real driver: fetch the diff, run the shape-review skill via Codex, parse review.json.
async function realReview(
  ctx: ReviewContext,
  pr: PrSpec,
  condition: ReviewCondition,
): Promise<ReviewComment[]> {
  const diffResult = await runProcess("gh", ["pr", "diff", String(pr.prNumber), "--repo", pr.repo], {
    cwd: ".",
    env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
    timeoutMs: 120_000,
  });
  const diff = diffResult.stdout;

  const runDir = joinPath(ctx.runsDir, `review-${condition}-${pr.repoName}-${pr.prNumber}`);
  const workDir = joinPath(runDir, "work");
  await writeText(joinPath(workDir, ".gitkeep"), "");

  // Shape condition: copy the whole-codebase model into ./shape (a REAL dir, so
  // `shp graph`/`explain` discover it — they do not follow a symlinked shape/),
  // and put `shp` on PATH. The agent PULLS what it needs (no pre-injected blob).
  let pathPrefix: string | undefined;
  if (condition === "shape") {
    const baseSha = await resolveBaseSha(pr);
    const indexDir = indexDirFor(ctx, indexKey(pr.repoName, baseSha));
    const shapeCopy = joinPath(workDir, "shape");
    await removePath(shapeCopy);
    await runProcess("cp", ["-R", joinPath(indexDir, "shape"), shapeCopy], {
      cwd: ".",
      env: { ...Bun.env, PATH: Bun.env.PATH ?? "" },
      timeoutMs: 120_000,
    });
    const binDir = joinPath(ctx.indexDir, ".bin");
    await writeShpShim(binDir);
    pathPrefix = binDir;
  }

  const prompt = await buildReviewPrompt(pr, diff, condition);
  const { lastMessage } = await runCodexAgent({
    prompt,
    workDir,
    runDir,
    model: ctx.reviewerModel,
    timeoutMs: ctx.timeoutMs,
    copyAuth: true,
    pathPrefix,
  });

  const reviewPath = joinPath(workDir, "review.json");
  const raw = (await exists(reviewPath)) ? await readText(reviewPath) : lastMessage;
  return parseReviewComments(raw);
}

// Phase 2 — produce our tool's reviews for each PR and wire them into the
// Martian pipeline inputs (benchmark_data.json + candidates.json). The ONLY
// scored phase. Returns the reviews keyed by golden URL.
export async function phase2Review(
  ctx: ReviewContext,
  prs: PrSpec[],
  condition: ReviewCondition,
  trial?: number,
): Promise<Map<string, ReviewComment[]>> {
  const tool = toolName(condition, trial);
  const reviewsByUrl = new Map<string, ReviewComment[]>();

  for (const pr of prs) {
    const comments = ctx.smoke
      ? await smokeReview(condition)
      : await realReview(ctx, pr, condition);
    reviewsByUrl.set(pr.goldenUrl, comments);
  }

  // step3 iterates over benchmark_data reviews, so our tool must be present there.
  const data = await loadBenchmarkData(ctx.offlineDir);
  injectTool(data, tool, reviewsByUrl);
  await writeJson(benchmarkDataPath(ctx.offlineDir), data);

  // Write candidates directly (line-level comments are direct candidates), so
  // the judge does not need the LLM extraction step for our tool.
  const candidatesFile = joinPath(modelDir(ctx.offlineDir, ctx.judgeModel), "candidates.json");
  await mergeCandidates(candidatesFile, tool, reviewsByUrl);

  await writeJson(
    joinPath(ctx.runsDir, `reviews-${tool}.json`),
    Object.fromEntries(reviewsByUrl),
  );
  return reviewsByUrl;
}

if (import.meta.main) {
  const args = parseArgs();
  const condition = (args.condition ?? "baseline") as ReviewCondition;
  if (!reviewConditions.includes(condition)) {
    throw new Error(`unknown condition: ${condition}`);
  }
  const ctx = realContext(args.model ? { reviewerModel: args.model } : {});
  const data = await loadBenchmarkData(ctx.offlineDir);
  const prs = listPrs(data, args.prs ? args.prs.split(",") : undefined);
  const reviews = await phase2Review(ctx, prs, condition);
  console.log(`Phase 2 (${condition}) complete: ${reviews.size} PR(s) reviewed as ${toolName(condition)}`);
}
